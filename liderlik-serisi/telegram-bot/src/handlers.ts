import { aciOner, taslakRevizeEt, taslakUret } from './anthropic';
import { TEMALAR } from './constants';
import {
	eskiVeriTasi,
	oturumGetir,
	oturumKaydet,
	oturumSil,
	taslakArsivle,
	taslakGetir,
	taslakGorevleriniIptal,
	taslakKaydet,
	taslakPlanliYayinAta,
	taslakSil,
	taslakYayinlandi,
	taslaklariListele,
	tumTaslaklariListele,
} from './kv-storage';
import { planliYayinTarihMetni } from './schedule';
import { pazartesiYayinGoreviEkle, planliTaslakKuyrugu } from './yayin-planlama';
import {
	callbackYanitla,
	htmlKacir,
	komutMenuGuncelle,
	mesajGonder,
	type TelegramInlineKeyboard,
} from './telegram';
import type { BotEnv, Draft, GuncelTaslak, UserSession } from './types';

export type { BotEnv };

const BAGLAM_SORUSU =
	'Bu tema için bağlam veya notun var mı?\n(Örn: güncel olay, kişisel gözlem, paylaşmak istediğin bir fikir)\n\nBoş geçmek için /atla yazabilirsin.';

/** Oturum KV'de yoksa veya süresi dolmuşsa gösterilir */
const OTURUM_SURESI_DOLDU_METNI =
	'⏱ Oturum süresi doldu. /yeni yazarak yeniden başlayabilirsin.';

const KOMUT_LISTESI_METNI = `<b>Liderlik Serisi Bot — Komutlar</b>

/yeni — Yeni LinkedIn postu oluştur
/taslaklar — Haftalık yayın kuyruğu (Pazartesi)
/yayinlandi — Yayınlanan postları göster
/istatistik — Paylaşım istatistiklerini göster
/komutlar — Bu listeyi göster
/konser — Konser takibi (yakında)
/ucak — Uçak bileti takibi (yakında)`;

/** Worker deploy veya /start sonrası Telegram komut menüsünü günceller */
export async function botKomutMenusunuGuncelle(env: BotEnv): Promise<void> {
	await komutMenuGuncelle(env.TELEGRAM_TOKEN);
}

/** /start — hoş geldin ve komut menüsü */
export async function komutStart(env: BotEnv, chatId: string): Promise<void> {
	await botKomutMenusunuGuncelle(env);
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`<b>Liderlik Serisi Bot</b>

LinkedIn liderlik serisi postlarını planlamana yardımcı olur.

${KOMUT_LISTESI_METNI}`,
		{ parse_mode: 'HTML' },
	);
}

/** /komutlar — tüm komutları listele */
export async function komutKomutlar(env: BotEnv, chatId: string): Promise<void> {
	await mesajGonder(env.TELEGRAM_TOKEN, chatId, KOMUT_LISTESI_METNI, { parse_mode: 'HTML' });
}

/** /yeni — tema seçim klavyesi */
export async function komutYeni(env: BotEnv, chatId: string): Promise<void> {
	await oturumSil(env.LIDERLIK_KV, chatId);

	const satirlar: { text: string; callback_data: string }[][] = [];
	for (let i = 0; i < TEMALAR.length; i += 2) {
		const satir = TEMALAR.slice(i, i + 2).map((t) => ({
			text: t.etiket,
			callback_data: `tema:${t.id}`,
		}));
		satirlar.push(satir);
	}

	const klavye: TelegramInlineKeyboard = { inline_keyboard: satirlar };
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		'📌 <b>Liderlik Serisi</b>\n\nHangi tema ile devam edelim? Aşağıdan seç:',
		{ parse_mode: 'HTML', reply_markup: klavye },
	);
}

/** /taslaklar — haftalık kuyruk (en yakın Pazartesi önce) */
export async function komutTaslaklar(env: BotEnv, chatId: string): Promise<void> {
	const taslaklar = await planliTaslakKuyrugu(env, 8);
	if (taslaklar.length === 0) {
		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			'Henüz planlanmış taslak yok. /yeni ile başlayabilirsin.',
		);
		return;
	}
	for (const t of taslaklar) {
		await planliTaslakMesajiGonder(env, chatId, t);
	}
}

/** /yayinlandi — paylaşılmış postlar */
export async function komutYayinlandi(env: BotEnv, chatId: string): Promise<void> {
	const yayinlananlar = await taslaklariListele(env.LIDERLIK_KV, 'yayinlandi', 8);
	if (yayinlananlar.length === 0) {
		await mesajGonder(env.TELEGRAM_TOKEN, chatId, 'Henüz yayınlanmış post yok.');
		return;
	}
	for (const t of yayinlananlar) {
		await yayinlananTaslakMesajiGonder(env, chatId, t);
	}
}

/** /istatistik — KV'deki taslak ve yayın verilerinden özet rapor üretir */
export async function komutIstatistik(env: BotEnv, chatId: string): Promise<void> {
	const metin = await istatistikMetniOlustur(env.LIDERLIK_KV);
	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin, { parse_mode: 'HTML' });
}

/** Yayınlanan postlardan tema sayıları, tarih aralığı ve en popüler temayı hesaplar */
async function istatistikMetniOlustur(kv: KVNamespace): Promise<string> {
	const [planliTaslaklar, yayinlananlar] = await Promise.all([
		tumTaslaklariListele(kv, 'taslak'),
		tumTaslaklariListele(kv, 'yayinlandi'),
	]);

	// Tema id → paylaşım sayısı (yayınlananlar)
	const temaSayilari = new Map<string, number>();
	for (const t of yayinlananlar) {
		temaSayilari.set(t.tema, (temaSayilari.get(t.tema) ?? 0) + 1);
	}

	// Bilinen temalar + KV'de kalan eski/bilinmeyen tema id'leri
	const dagilimSatirlari: { etiket: string; sayi: number }[] = [];
	const islenenIdler = new Set<string>();
	for (const tema of TEMALAR) {
		const sayi = temaSayilari.get(tema.id) ?? 0;
		dagilimSatirlari.push({ etiket: tema.etiket, sayi });
		islenenIdler.add(tema.id);
	}
	for (const [temaId, sayi] of temaSayilari) {
		if (islenenIdler.has(temaId)) continue;
		const ornek = yayinlananlar.find((t) => t.tema === temaId);
		dagilimSatirlari.push({ etiket: ornek?.temaEtiket ?? temaId, sayi });
	}
	dagilimSatirlari.sort((a, b) => b.sayi - a.sayi);

	const enYuksek = dagilimSatirlari.length > 0 ? dagilimSatirlari[0].sayi : 0;
	const enCokTemalar =
		enYuksek > 0
			? dagilimSatirlari.filter((d) => d.sayi === enYuksek).map((d) => d.etiket)
			: [];

	// yayinTarihi yoksa olusturulma kullanılır (eski kayıtlar)
	let ilkYayin: Date | null = null;
	let sonYayin: Date | null = null;
	for (const t of yayinlananlar) {
		const tarih = new Date(t.yayinTarihi ?? t.olusturulma);
		if (!ilkYayin || tarih < ilkYayin) ilkYayin = tarih;
		if (!sonYayin || tarih > sonYayin) sonYayin = tarih;
	}

	const tarihFormatla = (d: Date) =>
		d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

	const dagilimBlok =
		yayinlananlar.length === 0
			? 'Henüz yayınlanmış post yok.'
			: dagilimSatirlari
					.map((d) => {
						const cubuk = temaCubukOlustur(d.sayi, enYuksek);
						return `  ${cubuk} <b>${htmlKacir(d.etiket)}</b> · ${d.sayi}`;
					})
					.join('\n');

	const enCokMetin =
		enCokTemalar.length === 0
			? 'Henüz paylaşım yok'
			: enCokTemalar.length === 1
				? `${htmlKacir(enCokTemalar[0])} (${enYuksek} paylaşım)`
				: `${enCokTemalar.map((e) => htmlKacir(e)).join(', ')} (${enYuksek}'er paylaşım)`;

	const ilkTarihMetin = ilkYayin ? tarihFormatla(ilkYayin) : '—';
	const sonTarihMetin = sonYayin ? tarihFormatla(sonYayin) : '—';

	return `📊 <b>Paylaşım İstatistikleri</b>

📝 <b>Planlanmış taslak:</b> ${planliTaslaklar.length}
✅ <b>Yayınlanan post:</b> ${yayinlananlar.length}

📂 <b>Temaya göre dağılım</b>
${dagilimBlok}

🏆 <b>En çok kullanılan tema:</b> ${enCokMetin}

📅 <b>İlk paylaşım:</b> ${ilkTarihMetin}
🕐 <b>Son paylaşım:</b> ${sonTarihMetin}`;
}

/** Yayın sayısına göre görsel mini çubuk (en fazla 8 blok) */
function temaCubukOlustur(sayi: number, maksimum: number): string {
	if (sayi === 0 || maksimum === 0) return '▫️';
	const blok = Math.max(1, Math.round((sayi / maksimum) * 8));
	return '🟩'.repeat(blok);
}

/** /tasima — eski arsiv:liste kayıtlarını taslak:liste'ye taşır (kerelik) */
export async function komutTasima(env: BotEnv, chatId: string): Promise<void> {
	const sayi = await eskiVeriTasi(env.LIDERLIK_KV);
	if (sayi === 0) {
		await mesajGonder(env.TELEGRAM_TOKEN, chatId, 'Taşınacak eski arşiv kaydı bulunamadı.');
		return;
	}
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`✅ ${sayi} kayıt arşivden planlanmış taslaklara taşındı.`,
	);
}

/** /arsiv — eski komut; yönlendirme mesajı */
export async function komutArsiv(env: BotEnv, chatId: string): Promise<void> {
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		'/arsiv kaldırıldı.\n\nPlanlanmış postlar için /taslaklar\nYayınlananlar için /yayinlandi',
	);
}

/** Claude'un tekrar etmemesi için önceki konuları toplar */
async function oncekiKonulariGetir(kv: KVNamespace): Promise<string[]> {
	const [planli, yayinlanan] = await Promise.all([
		taslaklariListele(kv, 'taslak', 10),
		taslaklariListele(kv, 'yayinlandi', 10),
	]);
	return [...planli, ...yayinlanan].map((t) => `${t.temaEtiket}: ${t.aci}`);
}

/** Oturumdaki güncel metni taslağa uygular */
function taslakGuncelMetinle(taslak: Draft, guncel?: GuncelTaslak): Draft {
	if (!guncel) return taslak;
	return { ...taslak, aci: guncel.aci, icerik: guncel.icerik };
}

/** Oturuma güncel taslak alanını yazar */
function guncelTaslakAlani(taslak: Draft): GuncelTaslak {
	return { aci: taslak.aci, icerik: taslak.icerik };
}

/** Oturum yoksa veya geçersizse kullanıcıya bilgi verir */
async function oturumSuresiDolduIsle(
	env: BotEnv,
	chatId: string,
	callbackQueryId?: string,
): Promise<void> {
	if (callbackQueryId) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Oturum sona erdi');
	}
	await mesajGonder(env.TELEGRAM_TOKEN, chatId, OTURUM_SURESI_DOLDU_METNI);
}

/** 3 açı butonu + altta "Farklı açılar öner" satırı */
function acilarKlavyeOlustur(acilar: string[]): TelegramInlineKeyboard {
	const satirlar = acilar.map((aci, i) => [
		{
			text: aciButonMetni(aci, i + 1),
			callback_data: `aci:${i}`,
		},
	]);
	satirlar.push([{ text: '🔄 Farklı açılar öner', callback_data: 'yeniaci' }]);
	return { inline_keyboard: satirlar };
}

/** Oturumdaki acilar dizisini inline klavye ile gösterir (KV'den yeniden üretmez) */
async function acilarOnerisiGonder(
	env: BotEnv,
	chatId: string,
	temaEtiket: string,
	acilar: string[],
): Promise<void> {
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`🎯 <b>${htmlKacir(temaEtiket)}</b> için 3 açı önerisi:\n\nAşağıdan birini seç:`,
		{ parse_mode: 'HTML', reply_markup: acilarKlavyeOlustur(acilar) },
	);
}

/** /yeni akışında tam taslak — revize, arşivle; isteğe bağlı açılara dön */
async function taslakMesajiGonder(
	env: BotEnv,
	chatId: string,
	t: Draft,
	secenekler?: { acilaraDon?: boolean },
): Promise<void> {
	const tarih = new Date(t.olusturulma).toLocaleDateString('tr-TR');
	const metin = `📝 <b>Taslak</b> · <b>${htmlKacir(t.temaEtiket)}</b> (${tarih})

<b>Açı:</b> ${htmlKacir(t.aci)}

<b>İçerik:</b>
${htmlKacir(t.icerik)}`;

	const satirlar: { text: string; callback_data: string }[][] = [
		[
			{ text: '✏ Revize et', callback_data: `revize:${t.id}` },
			{ text: '✅ Arşivle', callback_data: `arsiv:${t.id}` },
		],
	];
	if (secenekler?.acilaraDon) {
		satirlar.push([{ text: '⬅ Açılara dön', callback_data: 'acilarageri' }]);
	}

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin, {
		parse_mode: 'HTML',
		reply_markup: { inline_keyboard: satirlar },
	});
}

/** Liste görünümü için içeriğin ilk N karakterini döndürür */
function icerikOnizleme(icerik: string, uzunluk = 100): string {
	return icerik.length > uzunluk ? `${icerik.slice(0, uzunluk)}…` : icerik;
}

/** Tam metin ekranındaki inline butonlar — duruma göre */
function tamMetinKlavyeOlustur(t: Draft): TelegramInlineKeyboard {
	if (t.durum === 'taslak') {
		return {
			inline_keyboard: [
				[
					{ text: '✅ Yayınlandı', callback_data: `yayinla:${t.id}` },
					{ text: '✏ Revize et', callback_data: `revizetaslak:${t.id}` },
				],
				[{ text: '🗑 Sil', callback_data: `sil:${t.id}` }],
			],
		};
	}
	return {
		inline_keyboard: [[{ text: '🗑 Sil', callback_data: `sil:${t.id}` }]],
	};
}

/** Tam metin mesajının üst bilgi satırları (tema, tarih, açı) */
function tamMetinBaslikOlustur(t: Draft): string {
	const tarih =
		t.durum === 'yayinlandi' && t.yayinTarihi
			? new Date(t.yayinTarihi).toLocaleDateString('tr-TR')
			: new Date(t.olusturulma).toLocaleDateString('tr-TR');
	const durumEtiketi = t.durum === 'yayinlandi' ? '✅ Yayınlandı' : '📝 Taslak';
	return `${durumEtiketi} · <b>${htmlKacir(t.temaEtiket)}</b> · ${tarih}

<b>Açı:</b> ${htmlKacir(t.aci)}`;
}

/** tammetin:ID — KV'den tam içeriği gösterir; 4000+ karakterde ikiye böler */
export async function tamMetinGoster(
	env: BotEnv,
	chatId: string,
	taslakId: string,
	callbackQueryId: string,
): Promise<void> {
	const taslak = await taslakGetir(env.LIDERLIK_KV, taslakId);
	if (!taslak) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Taslak bulunamadı');
		return;
	}

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Tam metin');

	const klavye = tamMetinKlavyeOlustur(taslak);
	const baslik = tamMetinBaslikOlustur(taslak);
	const ICERIK_PARCA_LIMIT = 4000;

	if (taslak.icerik.length <= ICERIK_PARCA_LIMIT) {
		const metin = `${baslik}

<b>İçerik:</b>
${htmlKacir(taslak.icerik)}`;
		await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin, {
			parse_mode: 'HTML',
			reply_markup: klavye,
		});
		return;
	}

	// Telegram mesaj sınırına takılmamak için uzun içeriği iki parçada gönder
	const parca1 = taslak.icerik.slice(0, ICERIK_PARCA_LIMIT);
	const parca2 = taslak.icerik.slice(ICERIK_PARCA_LIMIT);
	const metin1 = `${baslik}

<b>İçerik (1/2):</b>
${htmlKacir(parca1)}`;
	const metin2 = `<b>İçerik (2/2):</b>
${htmlKacir(parca2)}`;

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin1, { parse_mode: 'HTML' });
	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin2, {
		parse_mode: 'HTML',
		reply_markup: klavye,
	});
}

/** /taslaklar listesinde kısa önizleme — tema, yayın günü, açı */
async function planliTaslakMesajiGonder(env: BotEnv, chatId: string, t: Draft): Promise<void> {
	const onizleme = icerikOnizleme(t.icerik);
	const yayinSatiri = t.planlananYayin
		? `\n📅 <b>Yayın:</b> ${htmlKacir(planliYayinTarihMetni(t.planlananYayin))}`
		: '';

	const metin = `📝 <b>${htmlKacir(t.temaEtiket)}</b>${yayinSatiri}

<b>Açı:</b> ${htmlKacir(t.aci)}

${htmlKacir(onizleme)}`;

	const klavye: TelegramInlineKeyboard = {
		inline_keyboard: [
			[
				{ text: '✅ Yayınlandı', callback_data: `yayinla:${t.id}` },
				{ text: '🗑 Sil', callback_data: `sil:${t.id}` },
			],
			[
				{ text: '✏ Revize et', callback_data: `revizetaslak:${t.id}` },
				{ text: '📄 Tam Metni Gör', callback_data: `tammetin:${t.id}` },
			],
		],
	};

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin, {
		parse_mode: 'HTML',
		reply_markup: klavye,
	});
}

/** Planlı taslak revize sonucu — KV'ye kaydet veya tekrar revize et */
async function revizeTaslakSonucMesajiGonder(
	env: BotEnv,
	chatId: string,
	t: Draft,
): Promise<void> {
	const tarih = new Date(t.olusturulma).toLocaleDateString('tr-TR');
	const metin = `📝 <b>Revize edildi</b> · <b>${htmlKacir(t.temaEtiket)}</b> (${tarih})

<b>Açı:</b> ${htmlKacir(t.aci)}

<b>İçerik:</b>
${htmlKacir(t.icerik)}`;

	const klavye: TelegramInlineKeyboard = {
		inline_keyboard: [
			[
				{ text: '✅ Arşivle (Güncelle)', callback_data: `taslakkaydet:${t.id}` },
				{ text: '✏ Tekrar Revize Et', callback_data: `revizetaslak:${t.id}` },
			],
		],
	};

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin, {
		parse_mode: 'HTML',
		reply_markup: klavye,
	});
}

/** /yayinlandi listesinde — tema, tarih, açı, ilk 100 karakter ve sil */
async function yayinlananTaslakMesajiGonder(env: BotEnv, chatId: string, t: Draft): Promise<void> {
	const tarih = t.yayinTarihi
		? new Date(t.yayinTarihi).toLocaleDateString('tr-TR')
		: new Date(t.olusturulma).toLocaleDateString('tr-TR');
	const onizleme = icerikOnizleme(t.icerik);

	const metin = `✅ <b>${htmlKacir(t.temaEtiket)}</b> · Yayın: ${tarih}

<b>Açı:</b> ${htmlKacir(t.aci)}

${htmlKacir(onizleme)}`;

	const klavye: TelegramInlineKeyboard = {
		inline_keyboard: [
			[
				{ text: '🗑 Sil', callback_data: `sil:${t.id}` },
				{ text: '📄 Tam Metni Gör', callback_data: `tammetin:${t.id}` },
			],
		],
	};

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin, {
		parse_mode: 'HTML',
		reply_markup: klavye,
	});
}

/** Tema seçildi — bağlam/not sorusuna geç */
export async function temaSecildi(
	env: BotEnv,
	chatId: string,
	temaId: string,
	callbackQueryId: string,
): Promise<void> {
	const tema = TEMALAR.find((t) => t.id === temaId);
	if (!tema) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Geçersiz tema');
		return;
	}

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, `${tema.etiket} seçildi`);

	await oturumKaydet(env.LIDERLIK_KV, chatId, {
		adim: 'tema_secildi',
		temaId: tema.id,
		temaEtiket: tema.etiket,
	});

	await oturumKaydet(env.LIDERLIK_KV, chatId, {
		adim: 'not_bekleniyor',
		temaId: tema.id,
		temaEtiket: tema.etiket,
	});

	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`📌 <b>${htmlKacir(tema.etiket)}</b> seçildi.\n\n${BAGLAM_SORUSU}`,
		{ parse_mode: 'HTML' },
	);
}

/** Kullanıcı not yazdı veya /atla ile geçti — 3 açı öner */
export async function notAlindi(env: BotEnv, chatId: string, metin: string): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	if (!oturum || oturum.adim !== 'not_bekleniyor') return;

	const tema = TEMALAR.find((t) => t.id === oturum.temaId);
	if (!tema) {
		await oturumSil(env.LIDERLIK_KV, chatId);
		return;
	}

	const baglam = metin.trim() === '/atla' ? '' : metin.trim();

	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`⏳ <b>${htmlKacir(tema.etiket)}</b> için 3 farklı açı hazırlanıyor…`,
		{ parse_mode: 'HTML' },
	);

	try {
		const oncekiKonular = await oncekiKonulariGetir(env.LIDERLIK_KV);
		const acilar = await aciOner(env.ANTHROPIC_API_KEY, tema, baglam, oncekiKonular);

		// Üretilen 3 açı oturumda saklanır; acilarageri yeniden Claude çağırmadan bunları kullanır
		const guncelOturum: UserSession = {
			...oturum,
			adim: 'aci_bekleniyor',
			baglam,
			acilar,
		};
		await oturumKaydet(env.LIDERLIK_KV, chatId, guncelOturum);

		await acilarOnerisiGonder(env, chatId, tema.etiket, acilar);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
		await oturumSil(env.LIDERLIK_KV, chatId);
		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			`❌ Açı önerileri oluşturulamadı: ${htmlKacir(msg)}`,
			{ parse_mode: 'HTML' },
		);
	}
}

/** Inline butondan açı seçildi — tam taslak üret */
export async function aciSecildi(
	env: BotEnv,
	chatId: string,
	aciIndeks: number,
	callbackQueryId: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	if (!oturum || oturum.adim !== 'aci_bekleniyor' || !oturum.acilar?.length) {
		await oturumSuresiDolduIsle(env, chatId, callbackQueryId);
		return;
	}

	const secilenAci = oturum.acilar[aciIndeks];
	if (!secilenAci) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Geçersiz açı');
		return;
	}

	const tema = TEMALAR.find((t) => t.id === oturum.temaId);
	if (!tema) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Tema bulunamadı');
		return;
	}

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Açı seçildi');

	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`⏳ Seçilen açıyla LinkedIn taslağı yazılıyor…`,
	);

	try {
		const uretilen = await taslakUret(
			env.ANTHROPIC_API_KEY,
			tema,
			oturum.baglam ?? '',
			secilenAci,
		);

		const id = crypto.randomUUID();
		const taslak: Draft = {
			id,
			tema: tema.id,
			temaEtiket: tema.etiket,
			aci: uretilen.aci,
			icerik: uretilen.icerik,
			durum: 'taslak',
			olusturulma: new Date().toISOString(),
		};

		const guncelTaslak = guncelTaslakAlani(taslak);

		await oturumKaydet(env.LIDERLIK_KV, chatId, {
			...oturum,
			adim: 'taslak_gosterildi',
			secilenAci,
			taslakId: id,
			guncel_taslak: guncelTaslak,
		});

		await taslakMesajiGonder(env, chatId, taslak, { acilaraDon: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
		await oturumSil(env.LIDERLIK_KV, chatId);
		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			`❌ Taslak oluşturulamadı: ${htmlKacir(msg)}`,
			{ parse_mode: 'HTML' },
		);
	}
}

/** Taslaktan önceki 3 açıya dön — oturumdaki acilar dizisini tekrar gösterir */
export async function acilaraGeri(
	env: BotEnv,
	chatId: string,
	callbackQueryId: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	if (!oturum?.acilar?.length) {
		await oturumSuresiDolduIsle(env, chatId, callbackQueryId);
		return;
	}

	if (oturum.adim !== 'aci_bekleniyor' && oturum.adim !== 'taslak_gosterildi') {
		await oturumSuresiDolduIsle(env, chatId, callbackQueryId);
		return;
	}

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Açılar');

	await oturumKaydet(env.LIDERLIK_KV, chatId, {
		...oturum,
		adim: 'aci_bekleniyor',
	});

	await acilarOnerisiGonder(env, chatId, oturum.temaEtiket, oturum.acilar);
}

/** Claude ile yeni 3 açı üretir; oturumdaki önceki açıları prompt'a ekler */
export async function yeniAciOner(
	env: BotEnv,
	chatId: string,
	callbackQueryId: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	if (!oturum || oturum.adim !== 'aci_bekleniyor' || !oturum.acilar?.length) {
		await oturumSuresiDolduIsle(env, chatId, callbackQueryId);
		return;
	}

	const tema = TEMALAR.find((t) => t.id === oturum.temaId);
	if (!tema) {
		await oturumSuresiDolduIsle(env, chatId, callbackQueryId);
		return;
	}

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Yeni açılar hazırlanıyor');

	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`⏳ <b>${htmlKacir(tema.etiket)}</b> için yeni 3 açı hazırlanıyor…`,
		{ parse_mode: 'HTML' },
	);

	try {
		const oncekiKonular = await oncekiKonulariGetir(env.LIDERLIK_KV);
		// Bu oturumda gösterilmiş açıları tekrar etmemesi için modele ver
		const oturumdakiAcilar = oturum.acilar.map(
			(a, i) => `Bu oturumda daha önce önerilen açı ${i + 1}: ${a}`,
		);
		const acilar = await aciOner(
			env.ANTHROPIC_API_KEY,
			tema,
			oturum.baglam ?? '',
			[...oncekiKonular, ...oturumdakiAcilar],
		);

		await oturumKaydet(env.LIDERLIK_KV, chatId, {
			...oturum,
			adim: 'aci_bekleniyor',
			acilar,
		});

		await acilarOnerisiGonder(env, chatId, tema.etiket, acilar);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			`❌ Yeni açı önerileri oluşturulamadı: ${htmlKacir(msg)}`,
			{ parse_mode: 'HTML' },
		);
	}
}

/** "Revize et" butonu — kullanıcıdan değişiklik notu iste */
export async function revizeBaslat(
	env: BotEnv,
	chatId: string,
	taslakId: string,
	callbackQueryId: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	let taslak: Draft | null = null;

	if (oturum?.taslakId === taslakId && oturum.guncel_taslak) {
		taslak = {
			id: taslakId,
			tema: oturum.temaId,
			temaEtiket: oturum.temaEtiket,
			aci: oturum.guncel_taslak.aci,
			icerik: oturum.guncel_taslak.icerik,
			durum: 'taslak',
			olusturulma: new Date().toISOString(),
		};
	} else {
		taslak = await taslakGetir(env.LIDERLIK_KV, taslakId);
	}

	if (!taslak) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Taslak bulunamadı');
		return;
	}

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Revize modu');

	await oturumKaydet(env.LIDERLIK_KV, chatId, {
		adim: 'revize_bekleniyor',
		temaId: taslak.tema,
		temaEtiket: taslak.temaEtiket,
		taslakId: taslak.id,
		guncel_taslak: guncelTaslakAlani(taslak),
	});

	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`✏ <b>${htmlKacir(taslak.temaEtiket)}</b> taslağını revize edelim.\n\nNe değiştirelim?`,
		{ parse_mode: 'HTML' },
	);
}

/** /taslaklar — planlı taslağı revize et (KV'den oku, oturuma al) */
export async function revizeTaslakBaslat(
	env: BotEnv,
	chatId: string,
	taslakId: string,
	callbackQueryId: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	let taslak = await taslakGetir(env.LIDERLIK_KV, taslakId);

	if (!taslak) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Taslak bulunamadı');
		return;
	}

	// Oturumda daha önce revize edilmiş metin varsa onu göster
	if (oturum?.taslakId === taslakId && oturum.guncel_taslak) {
		taslak = taslakGuncelMetinle(taslak, oturum.guncel_taslak);
	}

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Revize modu');

	await oturumKaydet(env.LIDERLIK_KV, chatId, {
		adim: 'revizetaslak_bekleniyor',
		temaId: taslak.tema,
		temaEtiket: taslak.temaEtiket,
		taslakId: taslak.id,
		guncel_taslak: guncelTaslakAlani(taslak),
	});

	const tarih = new Date(taslak.olusturulma).toLocaleDateString('tr-TR');
	const metin = `📝 <b>${htmlKacir(taslak.temaEtiket)}</b> · ${tarih}

<b>Açı:</b> ${htmlKacir(taslak.aci)}

<b>İçerik:</b>
${htmlKacir(taslak.icerik)}`;

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin, { parse_mode: 'HTML' });
	await mesajGonder(env.TELEGRAM_TOKEN, chatId, 'Ne değiştirelim? Revizyon notunu yaz:');
}

/** Planlı taslak revizyon notu — Claude ile içeriği günceller */
async function revizeTaslakNotuAlindi(
	env: BotEnv,
	chatId: string,
	revizeNotu: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	if (!oturum || oturum.adim !== 'revizetaslak_bekleniyor' || !oturum.taslakId) return;

	const kvTaslak = await taslakGetir(env.LIDERLIK_KV, oturum.taslakId);
	if (!kvTaslak) {
		await oturumSil(env.LIDERLIK_KV, chatId);
		return;
	}

	const mevcut = oturum.guncel_taslak
		? taslakGuncelMetinle(kvTaslak, oturum.guncel_taslak)
		: kvTaslak;

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, '⏳ Taslak revize ediliyor…');

	try {
		const yeniIcerik = await taslakRevizeEt(env.ANTHROPIC_API_KEY, mevcut, revizeNotu);
		const guncelTaslak: GuncelTaslak = { aci: mevcut.aci, icerik: yeniIcerik };

		await oturumKaydet(env.LIDERLIK_KV, chatId, {
			...oturum,
			adim: 'revizetaslak_gosterildi',
			guncel_taslak: guncelTaslak,
		});

		const gosterim: Draft = { ...kvTaslak, icerik: yeniIcerik };
		await revizeTaslakSonucMesajiGonder(env, chatId, gosterim);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			`❌ Revize başarısız: ${htmlKacir(msg)}`,
			{ parse_mode: 'HTML' },
		);
	}
}

/** Arşivle (Güncelle) — oturumdaki revize içeriği KV'deki aynı id'ye yazar */
export async function taslakKaydetGuncelle(
	env: BotEnv,
	chatId: string,
	taslakId: string,
	callbackQueryId: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	const taslak = await taslakGetir(env.LIDERLIK_KV, taslakId);

	if (!taslak) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Taslak bulunamadı');
		return;
	}

	if (
		!oturum?.guncel_taslak ||
		oturum.taslakId !== taslakId ||
		(oturum.adim !== 'revizetaslak_gosterildi' && oturum.adim !== 'revizetaslak_bekleniyor')
	) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Güncel revize bulunamadı');
		return;
	}

	const guncel: Draft = {
		...taslak,
		icerik: oturum.guncel_taslak.icerik,
	};
	await taslakKaydet(env.LIDERLIK_KV, guncel);
	await oturumSil(env.LIDERLIK_KV, chatId);

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Kaydedildi');
	await mesajGonder(env.TELEGRAM_TOKEN, chatId, '✅ Taslak güncellendi');
}

/** Revize notu alındı — Claude ile yeniden yaz, oturumdaki guncel_taslak güncellenir */
export async function revizeNotuAlindi(
	env: BotEnv,
	chatId: string,
	revizeNotu: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	if (!oturum || oturum.adim !== 'revize_bekleniyor' || !oturum.taslakId) return;

	const mevcut = oturum.guncel_taslak
		? {
				id: oturum.taslakId,
				tema: oturum.temaId,
				temaEtiket: oturum.temaEtiket,
				aci: oturum.guncel_taslak.aci,
				icerik: oturum.guncel_taslak.icerik,
				durum: 'taslak' as const,
				olusturulma: new Date().toISOString(),
			}
		: await taslakGetir(env.LIDERLIK_KV, oturum.taslakId);

	if (!mevcut) {
		await oturumSil(env.LIDERLIK_KV, chatId);
		return;
	}

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, '⏳ Taslak revize ediliyor…');

	try {
		const yeniIcerik = await taslakRevizeEt(env.ANTHROPIC_API_KEY, mevcut, revizeNotu);
		const guncelTaslak: GuncelTaslak = { aci: mevcut.aci, icerik: yeniIcerik };

		await oturumKaydet(env.LIDERLIK_KV, chatId, {
			...oturum,
			adim: 'taslak_gosterildi',
			guncel_taslak: guncelTaslak,
		});

		const gosterim: Draft = { ...mevcut, icerik: yeniIcerik };
		await taslakMesajiGonder(env, chatId, gosterim);
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			`❌ Revize başarısız: ${htmlKacir(msg)}`,
			{ parse_mode: 'HTML' },
		);
	}
}

/** Arşivle — oturumdaki son revize metnini taslak:liste'ye kaydeder */
export async function arsivleTaslak(
	env: BotEnv,
	chatId: string,
	taslakId: string,
	callbackQueryId: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	let taslak = await taslakGetir(env.LIDERLIK_KV, taslakId);

	// Oturumdaki güncel metin öncelikli (henüz KV'ye yazılmamış revizeler)
	if (oturum?.taslakId === taslakId && oturum.guncel_taslak) {
		const temel: Draft = taslak ?? {
			id: taslakId,
			tema: oturum.temaId,
			temaEtiket: oturum.temaEtiket,
			aci: oturum.guncel_taslak.aci,
			icerik: oturum.guncel_taslak.icerik,
			durum: 'taslak',
			olusturulma: new Date().toISOString(),
		};
		taslak = taslakGuncelMetinle(temel, oturum.guncel_taslak);
	}

	if (!taslak) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Taslak bulunamadı');
		return;
	}

	const arsivlenen = await taslakArsivle(env.LIDERLIK_KV, taslak);
	const guncel = await taslakPlanliYayinAta(env.LIDERLIK_KV, arsivlenen);
	await pazartesiYayinGoreviEkle(env, guncel);
	await oturumSil(env.LIDERLIK_KV, chatId);

	const yayinMetni = guncel.planlananYayin
		? planliYayinTarihMetni(guncel.planlananYayin)
		: 'yakında';

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Planlanmış listeye alındı');
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`✅ <b>${htmlKacir(guncel.temaEtiket)}</b> haftalık yayın kuyruğuna eklendi.\n\n📅 <b>Yayın:</b> ${htmlKacir(yayinMetni)}\n\nPazartesi sabahı hatırlatma gönderilecek.`,
		{ parse_mode: 'HTML' },
	);
}

/** Yayınlandı — taslak listesinden yayinlandi listesine taşır */
export async function yayinlaTaslak(
	env: BotEnv,
	chatId: string,
	taslakId: string,
	callbackQueryId: string,
): Promise<void> {
	const guncel = await taslakYayinlandi(env.LIDERLIK_KV, taslakId);
	if (!guncel) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Taslak bulunamadı');
		return;
	}

	await taslakGorevleriniIptal(env.LIDERLIK_KV, taslakId);

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Yayınlandı olarak işaretlendi');
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`✅ <b>${htmlKacir(guncel.temaEtiket)}</b> yayınlandı listesine taşındı.`,
		{ parse_mode: 'HTML' },
	);
}

/** Sil — KV ve listeden kaldırır */
export async function silTaslak(
	env: BotEnv,
	chatId: string,
	taslakId: string,
	callbackQueryId: string,
): Promise<void> {
	const silindi = await taslakSil(env.LIDERLIK_KV, taslakId);
	if (!silindi) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Taslak bulunamadı');
		return;
	}

	await taslakGorevleriniIptal(env.LIDERLIK_KV, taslakId);

	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	if (oturum?.taslakId === taslakId) {
		await oturumSil(env.LIDERLIK_KV, chatId);
	}

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Silindi');
	await mesajGonder(env.TELEGRAM_TOKEN, chatId, '🗑 Taslak silindi.');
}

/** Oturum adımına göre gelen metin mesajını yönlendir */
export async function oturumMesajiIsle(env: BotEnv, chatId: string, metin: string): Promise<boolean> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	if (!oturum) return false;

	switch (oturum.adim) {
		case 'not_bekleniyor':
			await notAlindi(env, chatId, metin);
			return true;
		case 'revize_bekleniyor':
			await revizeNotuAlindi(env, chatId, metin);
			return true;
		case 'revizetaslak_bekleniyor':
			await revizeTaslakNotuAlindi(env, chatId, metin);
			return true;
		default:
			return false;
	}
}

/** Telegram inline buton metni (64 karakter sınırı) */
function aciButonMetni(aci: string, numara: number): string {
	const onEk = `${numara}. `;
	const max = 60;
	const govde = aci.length > max - onEk.length ? `${aci.slice(0, max - onEk.length - 1)}…` : aci;
	return onEk + govde;
}
