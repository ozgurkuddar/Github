import { aciOner, taslakRevizeEt, taslakUret } from './anthropic';
import { TEMALAR } from './constants';
import {
	gorevKaydet,
	oturumGetir,
	oturumKaydet,
	oturumSil,
	taslakArsivle,
	taslakGetir,
	taslakKaydet,
	taslaklariListele,
} from './kv-storage';
import { callbackYanitla, htmlKacir, mesajGonder, type TelegramInlineKeyboard } from './telegram';
import type { Draft, ScheduledTask, UserSession } from './types';

export interface BotEnv {
	LIDERLIK_KV: KVNamespace;
	TELEGRAM_TOKEN: string;
	TELEGRAM_CHAT_ID: string;
	ANTHROPIC_API_KEY: string;
}

const BAGLAM_SORUSU =
	'Bu tema için bağlam veya notun var mı?\n(Örn: güncel olay, kişisel gözlem, paylaşmak istediğin bir fikir)\n\nBoş geçmek için /atla yazabilirsin.';

/** /start ve yardım metni */
export async function komutYardim(env: BotEnv, chatId: string): Promise<void> {
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`<b>Liderlik Serisi Bot</b>

LinkedIn liderlik serisi postlarını planlamana yardımcı olur.

<b>Komutlar</b>
/yeni — Yeni post: tema seç, not ekle, açı seç, taslak üret
/taslaklar — Aktif taslakları listele
/arsiv — Arşivlenmiş postları listele
/yardim — Bu mesaj`,
		{ parse_mode: 'HTML' },
	);
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

/** /taslaklar */
export async function komutTaslaklar(env: BotEnv, chatId: string): Promise<void> {
	const taslaklar = await taslaklariListele(env.LIDERLIK_KV, 'taslak', 8);
	if (taslaklar.length === 0) {
		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			'Henüz aktif taslak yok. /yeni ile başlayabilirsin.',
		);
		return;
	}
	for (const t of taslaklar) {
		await taslakMesajiGonder(env, chatId, t, true);
	}
}

/** /arsiv */
export async function komutArsiv(env: BotEnv, chatId: string): Promise<void> {
	const arsiv = await taslaklariListele(env.LIDERLIK_KV, 'arsiv', 8);
	if (arsiv.length === 0) {
		await mesajGonder(env.TELEGRAM_TOKEN, chatId, 'Arşiv boş.');
		return;
	}
	for (const t of arsiv) {
		await taslakMesajiGonder(env, chatId, t, false);
	}
}

/** Arşivdeki önceki konuları Claude'a tekrar önlemek için toplar */
async function oncekiKonulariGetir(kv: KVNamespace): Promise<string[]> {
	const arsiv = await taslaklariListele(kv, 'arsiv', 15);
	return arsiv.map((t) => `${t.temaEtiket}: ${t.aci}`);
}

/** Taslak mesajı — revize ve arşiv butonlarıyla */
async function taslakMesajiGonder(
	env: BotEnv,
	chatId: string,
	t: Draft,
	aksiyonButonlari: boolean,
): Promise<void> {
	const tarih = new Date(t.olusturulma).toLocaleDateString('tr-TR');
	const baslik = t.durum === 'arsiv' ? '📦 Arşiv' : '📝 Taslak';
	const metin = `${baslik} · <b>${htmlKacir(t.temaEtiket)}</b> (${tarih})

<b>Açı:</b> ${htmlKacir(t.aci)}

<b>İçerik:</b>
${htmlKacir(t.icerik)}`;

	const klavye: TelegramInlineKeyboard | undefined =
		aksiyonButonlari && t.durum === 'taslak'
			? {
					inline_keyboard: [
						[
							{ text: '✏ Revize et', callback_data: `revize:${t.id}` },
							{ text: '✅ Arşivle', callback_data: `arsiv:${t.id}` },
						],
					],
				}
			: undefined;

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

	// Oturum: önce tema_secildi, ardından not_bekleniyor
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
		await taslakKaydet(env.LIDERLIK_KV, taslak);

		await oturumKaydet(env.LIDERLIK_KV, chatId, {
			...oturum,
			adim: 'taslak_gosterildi',
			secilenAci,
			taslakId: id,
		});

		await taslakMesajiGonder(env, chatId, taslak, true);
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
	const taslak = await taslakGetir(env.LIDERLIK_KV, taslakId);
	if (!taslak || taslak.durum !== 'taslak') {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Taslak bulunamadı');
		return;
	}

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Revize modu');

	await oturumKaydet(env.LIDERLIK_KV, chatId, {
		adim: 'revize_bekleniyor',
		temaId: taslak.tema,
		temaEtiket: taslak.temaEtiket,
		taslakId: taslak.id,
	});

	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`✏ <b>${htmlKacir(taslak.temaEtiket)}</b> taslağını revize edelim.\n\nNe değiştirelim?`,
		{ parse_mode: 'HTML' },
	);
}

/** Revize notu alındı — Claude ile yeniden yaz */
export async function revizeNotuAlindi(
	env: BotEnv,
	chatId: string,
	revizeNotu: string,
): Promise<void> {
	const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
	if (!oturum || oturum.adim !== 'revize_bekleniyor' || !oturum.taslakId) return;

	const taslak = await taslakGetir(env.LIDERLIK_KV, oturum.taslakId);
	if (!taslak) {
		await oturumSil(env.LIDERLIK_KV, chatId);
		return;
	}

	await mesajGonder(env.TELEGRAM_TOKEN, chatId, '⏳ Taslak revize ediliyor…');

	try {
		const yeniIcerik = await taslakRevizeEt(env.ANTHROPIC_API_KEY, taslak, revizeNotu);
		const guncel: Draft = { ...taslak, icerik: yeniIcerik };
		await taslakKaydet(env.LIDERLIK_KV, guncel);

		await oturumKaydet(env.LIDERLIK_KV, chatId, {
			...oturum,
			adim: 'taslak_gosterildi',
		});

		await taslakMesajiGonder(env, chatId, guncel, true);
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

/** Arşivle callback — KV'ye kaydet, 2 gün sonrasına hatırlatma görevi ekle */
export async function arsivleTaslak(
	env: BotEnv,
	chatId: string,
	taslakId: string,
	callbackQueryId: string,
): Promise<void> {
	const guncel = await taslakArsivle(env.LIDERLIK_KV, taslakId);
	if (!guncel) {
		await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Taslak bulunamadı');
		return;
	}

	await ikiGunSonraGoreviEkle(env, guncel);
	await oturumSil(env.LIDERLIK_KV, chatId);

	await callbackYanitla(env.TELEGRAM_TOKEN, callbackQueryId, 'Arşive alındı');
	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`✅ <b>${htmlKacir(guncel.temaEtiket)}</b> arşive taşındı.\n2 gün sonra hatırlatma gönderilecek.`,
		{ parse_mode: 'HTML' },
	);
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
		mesaj: `🔔 <b>Hatırlatma</b>\n\n<b>${taslak.temaEtiket}</b> arşivlendi — paylaşım zamanı geldi mi?\n\nAçı: ${taslak.aci.slice(0, 200)}${taslak.aci.length > 200 ? '…' : ''}`,
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
