import { ANTHROPIC_MODEL } from './constants';
import type { Draft, Tema } from './types';

export interface LiderlikTaslagi {
	aci: string;
	icerik: string;
}

interface AnthropicMessageResponse {
	content: { type: string; text: string }[];
}

/** Anthropic Messages API çağrısı */
async function anthropicMesaj(
	apiKey: string,
	sistemTalimat: string,
	kullaniciMesaj: string,
	maxTokens = 2048,
): Promise<string> {
	const res = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
		},
		body: JSON.stringify({
			model: ANTHROPIC_MODEL,
			max_tokens: maxTokens,
			system: sistemTalimat,
			messages: [{ role: 'user', content: kullaniciMesaj }],
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Anthropic API hatası (${res.status}): ${err}`);
	}

	const data = (await res.json()) as AnthropicMessageResponse;
	return data.content?.find((b) => b.type === 'text')?.text ?? '';
}

/**
 * Tema ve bağlama göre 3 farklı post açısı önerir.
 * oncekiKonular: arşivdeki paylaşılmış konular — tekrarı azaltmak için modele verilir.
 */
export async function aciOner(
	apiKey: string,
	tema: Tema,
	baglam: string,
	oncekiKonular: string[],
): Promise<string[]> {
	const sistemTalimat = `Sen Türkçe yazan bir liderlik içerik stratejistisin.
LinkedIn'de "Liderlik Serisi" adlı bir post serisi için çalışıyorsun.
Yanıtını YALNIZCA geçerli JSON olarak ver; başka metin ekleme.

JSON şeması: ["açı 1", "açı 2", "açı 3"]

Her açı 1-2 cümle, birbirinden belirgin farklı ve özgün olsun.
Daha önce kullanılmış konuları tekrarlama; yeni perspektifler sun.`;

	const oncekiBlok =
		oncekiKonular.length > 0
			? `\n\nDaha önce işlenmiş konular (bunlardan kaçın):\n${oncekiKonular.map((k, i) => `${i + 1}. ${k}`).join('\n')}`
			: '';

	const baglamBlok = baglam.trim()
		? `\n\nKullanıcının notu/bağlamı:\n${baglam}`
		: '\n\nKullanıcı ek bağlam paylaşmadı.';

	const kullaniciMesaj = `Tema: ${tema.etiket}
Tema açıklaması: ${tema.aciklama}${baglamBlok}${oncekiBlok}

Bu tema için LinkedIn liderlik serisi postunda kullanılabilecek 3 farklı stratejik açı öner.`;

	const metin = await anthropicMesaj(apiKey, sistemTalimat, kullaniciMesaj, 1024);
	return jsonDiziAyikla(metin);
}

/** Seçilen açıya göre tam LinkedIn taslağı üretir */
export async function taslakUret(
	apiKey: string,
	tema: Tema,
	baglam: string,
	secilenAci: string,
): Promise<LiderlikTaslagi> {
	const sistemTalimat = `Sen Türkçe yazan bir liderlik içerik stratejistisin.
LinkedIn'de "Liderlik Serisi" adlı bir post serisi için çalışıyorsun.
Yanıtını YALNIZCA geçerli JSON olarak ver; başka metin ekleme.

JSON şeması:
{
  "aci": "Seçilen açının 1-2 cümlelik özeti",
  "icerik": "LinkedIn post taslağı: kısa giriş, 3-5 madde veya paragraf, güçlü kapanış, emoji kullanabilirsin (ölçülü), 800-1200 karakter civarı"
}`;

	const baglamBlok = baglam.trim()
		? `\nKullanıcının notu/bağlamı: ${baglam}`
		: '';

	const kullaniciMesaj = `Tema: ${tema.etiket}
Tema açıklaması: ${tema.aciklama}
Seçilen stratejik açı: ${secilenAci}${baglamBlok}

Bu açıyla LinkedIn liderlik serisi post taslağı yaz.`;

	const metin = await anthropicMesaj(apiKey, sistemTalimat, kullaniciMesaj);
	return jsonTaslakAyikla(metin, secilenAci);
}

/** Kullanıcı geri bildirimine göre taslağı yeniden yazar */
export async function taslakRevizeEt(
	apiKey: string,
	taslak: Draft,
	revizeNotu: string,
): Promise<string> {
	const sistemTalimat = `Sen Türkçe yazan bir liderlik içerik stratejistisin.
LinkedIn post taslağını kullanıcının isteğine göre revize edeceksin.
Yanıtını YALNIZCA geçerli JSON olarak ver; başka metin ekleme.

JSON şeması:
{
  "icerik": "Revize edilmiş LinkedIn post metni"
}`;

	const kullaniciMesaj = `Tema: ${taslak.temaEtiket}
Stratejik açı: ${taslak.aci}

Mevcut taslak:
${taslak.icerik}

Kullanıcının revize isteği:
${revizeNotu}

Taslağı buna göre güncelle; açıyı koru, içeriği iyileştir.`;

	const metin = await anthropicMesaj(apiKey, sistemTalimat, kullaniciMesaj);
	const parsed = jsonTaslakAyikla(metin, taslak.aci);
	return parsed.icerik;
}

/** Model yanıtından JSON dizi çıkarır (3 açı) */
function jsonDiziAyikla(metin: string): string[] {
	const temiz = kodBloguTemizle(metin);

	try {
		const parsed = JSON.parse(temiz) as unknown;
		if (!Array.isArray(parsed) || parsed.length < 3) {
			throw new Error('Dizi eksik');
		}
		const acilar = parsed.slice(0, 3).map((a) => String(a).trim()).filter(Boolean);
		if (acilar.length < 3) throw new Error('Yetersiz açı');
		return acilar;
	} catch {
		// Satır satır yedek ayrıştırma
		const satirlar = temiz
			.split('\n')
			.map((s) => s.replace(/^[\d\-•*."'\s]+/, '').trim())
			.filter((s) => s.length > 20);
		if (satirlar.length >= 3) return satirlar.slice(0, 3);
		return [
			'Liderlikte netlik: kararları görünür kılmak',
			'Ekip güveni: söylediğinle yaptığın arasındaki mesafe',
			'Değişimde sabır: küçük kazanımları kutlamak',
		];
	}
}

/** Model yanıtından taslak JSON çıkarır */
function jsonTaslakAyikla(metin: string, varsayilanAci: string): LiderlikTaslagi {
	const temiz = kodBloguTemizle(metin);

	try {
		const parsed = JSON.parse(temiz) as LiderlikTaslagi;
		if (!parsed.icerik) throw new Error('Eksik içerik');
		return {
			aci: parsed.aci?.trim() || varsayilanAci,
			icerik: parsed.icerik,
		};
	} catch {
		return {
			aci: varsayilanAci,
			icerik: metin.slice(0, 3500),
		};
	}
}

function kodBloguTemizle(metin: string): string {
	return metin
		.replace(/^```json\s*/i, '')
		.replace(/^```\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}
