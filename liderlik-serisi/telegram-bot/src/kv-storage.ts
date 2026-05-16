import { KV_KEYS } from './constants';
import type { Draft, DraftStatus, ScheduledTask, UserSession } from './types';

/** KV listesini JSON olarak okur */
async function listeOku(kv: KVNamespace, anahtar: string): Promise<string[]> {
	const ham = await kv.get(anahtar);
	if (!ham) return [];
	try {
		const parsed = JSON.parse(ham) as string[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** KV listesini JSON olarak yazar */
async function listeYaz(kv: KVNamespace, anahtar: string, ids: string[]): Promise<void> {
	await kv.put(anahtar, JSON.stringify(ids));
}

export async function taslakKaydet(kv: KVNamespace, taslak: Draft): Promise<void> {
	await kv.put(KV_KEYS.taslak(taslak.id), JSON.stringify(taslak));
	const listeAnahtar =
		taslak.durum === 'arsiv' ? KV_KEYS.ARSIV_LISTESI : KV_KEYS.TASLAK_LISTESI;
	const liste = await listeOku(kv, listeAnahtar);
	if (!liste.includes(taslak.id)) {
		liste.unshift(taslak.id);
		await listeYaz(kv, listeAnahtar, liste);
	}
}

export async function taslakGetir(kv: KVNamespace, id: string): Promise<Draft | null> {
	const ham = await kv.get(KV_KEYS.taslak(id));
	if (!ham) return null;
	return JSON.parse(ham) as Draft;
}

export async function taslaklariListele(
	kv: KVNamespace,
	durum: DraftStatus,
	limit = 10,
): Promise<Draft[]> {
	const anahtar = durum === 'arsiv' ? KV_KEYS.ARSIV_LISTESI : KV_KEYS.TASLAK_LISTESI;
	const ids = (await listeOku(kv, anahtar)).slice(0, limit);
	const taslaklar: Draft[] = [];
	for (const id of ids) {
		const t = await taslakGetir(kv, id);
		if (t && t.durum === durum) taslaklar.push(t);
	}
	return taslaklar;
}

/** Taslağı arşive taşır */
export async function taslakArsivle(kv: KVNamespace, id: string): Promise<Draft | null> {
	const taslak = await taslakGetir(kv, id);
	if (!taslak || taslak.durum === 'arsiv') return taslak;

	const taslakIds = (await listeOku(kv, KV_KEYS.TASLAK_LISTESI)).filter((x) => x !== id);
	await listeYaz(kv, KV_KEYS.TASLAK_LISTESI, taslakIds);

	const guncel: Draft = { ...taslak, durum: 'arsiv' };
	await taslakKaydet(kv, guncel);
	return guncel;
}

export async function gorevKaydet(kv: KVNamespace, gorev: ScheduledTask): Promise<void> {
	await kv.put(KV_KEYS.gorev(gorev.id), JSON.stringify(gorev));
	const liste = await listeOku(kv, KV_KEYS.GOREV_LISTESI);
	if (!liste.includes(gorev.id)) {
		liste.push(gorev.id);
		await listeYaz(kv, KV_KEYS.GOREV_LISTESI, liste);
	}
}

export async function gorevGuncelle(kv: KVNamespace, gorev: ScheduledTask): Promise<void> {
	await kv.put(KV_KEYS.gorev(gorev.id), JSON.stringify(gorev));
}

/** Planlanan zamanı geçmiş ve henüz gönderilmemiş görevler */
export async function bekleyenGorevler(kv: KVNamespace): Promise<ScheduledTask[]> {
	const ids = await listeOku(kv, KV_KEYS.GOREV_LISTESI);
	const simdi = Date.now();
	const sonuc: ScheduledTask[] = [];

	for (const id of ids) {
		const ham = await kv.get(KV_KEYS.gorev(id));
		if (!ham) continue;
		const gorev = JSON.parse(ham) as ScheduledTask;
		if (!gorev.gonderildi && new Date(gorev.planlanan).getTime() <= simdi) {
			sonuc.push(gorev);
		}
	}
	return sonuc;
}

export async function oturumKaydet(
	kv: KVNamespace,
	chatId: string,
	oturum: UserSession,
): Promise<void> {
	// Çok adımlı akış için 2 saat TTL
	await kv.put(KV_KEYS.oturum(chatId), JSON.stringify(oturum), {
		expirationTtl: 7200,
	});
}

export async function oturumGetir(
	kv: KVNamespace,
	chatId: string,
): Promise<UserSession | null> {
	const ham = await kv.get(KV_KEYS.oturum(chatId));
	if (!ham) return null;
	return JSON.parse(ham) as UserSession;
}

export async function oturumSil(kv: KVNamespace, chatId: string): Promise<void> {
	await kv.delete(KV_KEYS.oturum(chatId));
}
