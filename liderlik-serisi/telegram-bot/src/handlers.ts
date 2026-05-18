import { aciOner, taslakRevizeEt, taslakUret } from './anthropic';
import { TEMALAR } from './constants';
import {
	gorevKaydet,
	oturumGetir,
	oturumKaydet,
	oturumSil,
	taslakArsivle,
	taslakGetir,
	taslakSil,
	taslakYayinlandi,
	taslaklariListele,
} from './kv-storage';
import {
	callbackYanitla,
	htmlKacir,
	komutMenuGuncelle,
	mesajGonder,
	type TelegramInlineKeyboard,
} from './telegram';
import type { Draft, GuncelTaslak, ScheduledTask, UserSession } from './types';

export interface BotEnv {
	LIDERLIK_KV: KVNamespace;
	TELEGRAM_TOKEN: string;
	TELEGRAM_CHAT_ID: string;
	ANTHROPIC_API_KEY: string;
}

const BAGLAM_SORUSU =
	'Bu tema için bağlam veya notun var mı?\n(Örn: güncel olay, kişisel gözlem, paylaşmak istediğin bir fikir)\n\nBoş geçmek için /atla yazabilirsin.';

const KOMUT_LISTESI_METNI = `<b>Liderlik Serisi Bot — Komutlar</b>

/yeni — Yeni LinkedIn postu oluştur
/taslaklar — Planlanmış/bekleyen postları göster
/yayinlandi — Yayınlanan postları göster
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

/** /taslaklar — planlanmış/bekleyen postlar */
export async function komutTaslaklar(env: BotEnv, chatId: string): Promise<void> {
	const taslaklar = await taslaklariListele(env.LIDERLIK_KV, 'taslak', 8);
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

/** /yeni akışında tam taslak — revize ve arşivle butonları */
async function taslakMesajiGonder(
	env: BotEnv,
	chatId: string,
	t: Draft,
): Promise<void> {
	const tarih = new Date(t.olusturulma).toLocaleDateString('tr-TR');
	const metin = `📝 <b>Taslak</b> · <b>${htmlKacir(t.temaEtiket)}</b> (${tarih})

<b>Açı:</b> ${htmlKacir(t.aci)}

<b>İçerik:</b>
${htmlKacir(t.icerik)}`;

	const klavye: TelegramInlineKeyboard = {
		inline_keyboard: [
			[
				{ text: '✏ Revize et', callback_data: `revize:${t.id}` },
				{ text: '✅ Arşivle', callback_data: `arsiv:${t.id}` },
			],
		],
	};

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin, {
		parse_mode: 'HTML',
		reply_markup: klavye,
	});
}

/** /taslaklar listesinde kısa önizleme — yayınlandı ve sil */
async function planliTaslakMesajiGonder(env: BotEnv, chatId: string, t: Draft): Promise<void> {
	const tarih = new Date(t.olusturulma).toLocaleDateString('tr-TR');
	const onizleme =
		t.icerik.length > 200 ? `${t.icerik.slice(0, 200)}…` : t.icerik;

	const metin = `📝 <b>${htmlKacir(t.temaEtiket)}</b> · ${tarih}

<b>Açı:</b> ${htmlKacir(t.aci)}

${htmlKacir(onizleme)}`;

	const klavye: TelegramInlineKeyboard = {
		inline_keyboard: [
			[
				{ text: '✅ Yayınlandı', callback_data: `yayinla:${t.id}` },
				{ text: '🗑 Sil', callback_data: `sil:${t.id}` },
			],
		],
	};

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, metin, {
		parse_mode: 'HTML',
		reply_markup: klavye,
	});
}

/** /yayinlandi listesinde — yalnızca sil */
async function yayinlananTaslakMesajiGonder(env: BotEnv, chatId: string, t: Draft): Promise<void> {
	const tarih = t.yayinTarihi
		? new Date(t.yayinTarihi).toLocaleDateString('tr-TR')
		: new Date(t.olusturulma).toLocaleDateString('tr-TR');

	const metin = `✅ <b>${htmlKacir(t.temaEtiket)}</b> · Yayın: ${tarih}

<b>Açı:</b> ${htmlKacir(t.aci)}`;

	const klavye: TelegramInlineKeyboard = {
		inline_keyboard: [[{ text: '🗑 Sil', callback_data: `sil:${t.id}` }]],
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

		const guncelOturum: UserSession = {
			...oturum,
			adim: 'aci_bekleniyor',
			baglam,
			acilar,
		};
		await oturumKaydet(env.LIDERLIK_KV, chatId, guncelOturum);

		const klavye: TelegramInlineKeyboard = {
			inline_keyboard: acilar.map((aci, i) => [
				{
					text: aciButonMetni(aci, i + 1),
					callback_data: `aci:${i}`,
				},
			]),
		};

		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			`🎯 <b>${htmlKacir(tema.etiket)}</b> için 3 açı önerisi:\n\nAşağıdan birini seç:`,
			{ parse_mode: 'HTML', reply_markup: klavye },
		);
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
	if (!oturum || oturum.adim !== 'aci_bekleniyor' || !oturum.acilar) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Oturum süresi doldu; /yeni ile başla');
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

		await taslakMesajiGonder(env, chatId, taslak);
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

	const guncel = await taslakArsivle(env.LIDERLIK_KV, taslak);
	await ikiGunSonraGoreviEkle(env, guncel);
	await oturumSil(env.LIDERLIK_KV, chatId);

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Planlanmış listeye alındı');
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`✅ <b>${htmlKacir(guncel.temaEtiket)}</b> planlanmış taslaklara kaydedildi.\n2 gün sonra hatırlatma gönderilecek.`,
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

/** 2 gün sonra 09:00 TR (UTC 06:00) için hatırlatma görevi */
async function ikiGunSonraGoreviEkle(env: BotEnv, taslak: Draft): Promise<void> {
	const hedef = ikiGunSonraSabahUtc06();
	const gorev: ScheduledTask = {
		id: crypto.randomUUID(),
		mesaj: `🔔 <b>Hatırlatma</b>\n\n<b>${taslak.temaEtiket}</b> planlandı — paylaşım zamanı geldi mi?\n\nAçı: ${taslak.aci.slice(0, 200)}${taslak.aci.length > 200 ? '…' : ''}`,
		planlanan: hedef.toISOString(),
		gonderildi: false,
		olusturulma: new Date().toISOString(),
	};
	await gorevKaydet(env.LIDERLIK_KV, gorev);
}

/** Türkiye 09:00 = UTC 06:00 — 2 gün sonra */
function ikiGunSonraSabahUtc06(): Date {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + 2);
	d.setUTCHours(6, 0, 0, 0);
	return d;
}
