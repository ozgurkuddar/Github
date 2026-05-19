import { KV_KEYS } from './constants';
import { pazartesiYayinTarihi, planliYayinSirasiHesapla } from './schedule';
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

/** Duruma göre liste anahtarı */
function listeAnahtari(durum: DraftStatus): string {
	return durum === 'yayinlandi' ? KV_KEYS.YAYINLANDI_LISTESI : KV_KEYS.TASLAK_LISTESI;
}

/** Taslağı diğer listeden çıkarır (durum değişiminde) */
async function listedenCikar(kv: KVNamespace, id: string, haricDurum?: DraftStatus): Promise<void> {
	const listeler: { durum: DraftStatus; anahtar: string }[] = [
		{ durum: 'taslak', anahtar: KV_KEYS.TASLAK_LISTESI },
		{ durum: 'yayinlandi', anahtar: KV_KEYS.YAYINLANDI_LISTESI },
	];
	for (const { durum, anahtar } of listeler) {
		if (haricDurum === durum) continue;
		const liste = (await listeOku(kv, anahtar)).filter((x) => x !== id);
		await listeYaz(kv, anahtar, liste);
	}
}

export async function taslakKaydet(kv: KVNamespace, taslak: Draft): Promise<void> {
	await kv.put(KV_KEYS.taslak(taslak.id), JSON.stringify(taslak));

	// Önce her iki listeden de temizle, sonra doğru listeye ekle
	await listedenCikar(kv, taslak.id, taslak.durum);

	const anahtar = listeAnahtari(taslak.durum);
	const liste = await listeOku(kv, anahtar);
	if (!liste.includes(taslak.id)) {
		liste.unshift(taslak.id);
		await listeYaz(kv, anahtar, liste);
	}
}

export async function taslakGetir(kv: KVNamespace, id: string): Promise<Draft | null> {
	const ham = await kv.get(KV_KEYS.taslak(id));
	if (!ham) return null;
	return JSON.parse(ham) as Draft;
}

/** Planlanmış veya yayınlanmış taslakları listeler */
export async function taslaklariListele(
	kv: KVNamespace,
	durum: DraftStatus,
	limit = 10,
): Promise<Draft[]> {
	const ids = (await listeOku(kv, listeAnahtari(durum))).slice(0, limit);
	const taslaklar: Draft[] = [];
	for (const id of ids) {
		const t = await taslakGetir(kv, id);
		if (t && t.durum === durum) taslaklar.push(t);
	}
	return taslaklar;
}

/** /istatistik için — listedeki tüm taslakları limit olmadan getirir */
export async function tumTaslaklariListele(
	kv: KVNamespace,
	durum: DraftStatus,
): Promise<Draft[]> {
	const ids = await listeOku(kv, listeAnahtari(durum));
	const taslaklar: Draft[] = [];
	for (const id of ids) {
		const t = await taslakGetir(kv, id);
		if (t && t.durum === durum) taslaklar.push(t);
	}
	return taslaklar;
}

/**
 * Arşivle — planlanmış listeye (taslak:liste) kaydeder.
 * İçerik çağırandan gelir (oturumdaki guncel_taslak ile birleştirilmiş hali).
 */
export async function taslakArsivle(kv: KVNamespace, taslak: Draft): Promise<Draft> {
	const guncel: Draft = { ...taslak, durum: 'taslak' };
	await taslakKaydet(kv, guncel);
	return guncel;
}

/** Taslak listesinden çıkarıp yayınlandı listesine taşır */
export async function taslakYayinlandi(kv: KVNamespace, id: string): Promise<Draft | null> {
	const taslak = await taslakGetir(kv, id);
	if (!taslak || taslak.durum === 'yayinlandi') return taslak;

	const guncel: Draft = {
		...taslak,
		durum: 'yayinlandi',
		yayinTarihi: new Date().toISOString(),
	};
	await taslakKaydet(kv, guncel);
	return guncel;
}

/** KV kaydını ve her iki listeden id'yi siler */
export async function taslakSil(kv: KVNamespace, id: string): Promise<boolean> {
	const taslak = await taslakGetir(kv, id);
	if (!taslak) return false;

	await listedenCikar(kv, id);
	await kv.delete(KV_KEYS.taslak(id));
	return true;
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

/** Planlanmış taslak kuyruğu id listesi (en yeni önde) */
export async function planliTaslakIdleri(kv: KVNamespace): Promise<string[]> {
	return listeOku(kv, KV_KEYS.TASLAK_LISTESI);
}

/**
 * Kuyruktaki taslaklara planlananYayin atar (eski kayıtlar için).
 * Sıra: en eski taslak → en yakın Pazartesi, sonrakiler +7 gün.
 */
export async function eksikPlanliYayinlariDoldur(kv: KVNamespace): Promise<void> {
	const ids = await planliTaslakIdleri(kv);
	for (let i = 0; i < ids.length; i++) {
		const taslak = await taslakGetir(kv, ids[i]);
		if (!taslak || taslak.durum !== 'taslak' || taslak.planlananYayin) continue;

		const sira = planliYayinSirasiHesapla(ids.length, i);
		const guncel: Draft = {
			...taslak,
			planlananYayin: pazartesiYayinTarihi(sira).toISOString(),
		};
		await kv.put(KV_KEYS.taslak(guncel.id), JSON.stringify(guncel));
	}
}

/** Arşiv sonrası bu taslağın Pazartesi yayın tarihini kuyruk sırasına göre yazar */
export async function taslakPlanliYayinAta(kv: KVNamespace, taslak: Draft): Promise<Draft> {
	const ids = await planliTaslakIdleri(kv);
	const idx = ids.indexOf(taslak.id);
	if (idx === -1) return taslak;

	const sira = planliYayinSirasiHesapla(ids.length, idx);
	const guncel: Draft = {
		...taslak,
		planlananYayin: pazartesiYayinTarihi(sira).toISOString(),
	};
	await kv.put(KV_KEYS.taslak(guncel.id), JSON.stringify(guncel));
	return guncel;
}

/** Taslak yayınlandığında veya silindiğinde bekleyen Pazartesi hatırlatmasını iptal eder */
export async function taslakGorevleriniIptal(kv: KVNamespace, taslakId: string): Promise<void> {
	const ids = await listeOku(kv, KV_KEYS.GOREV_LISTESI);
	for (const id of ids) {
		const ham = await kv.get(KV_KEYS.gorev(id));
		if (!ham) continue;
		const gorev = JSON.parse(ham) as ScheduledTask;
		if (gorev.taslakId === taslakId && !gorev.gonderildi) {
			gorev.gonderildi = true;
			await gorevGuncelle(kv, gorev);
		}
	}
}

/** Gelecekteki Pazartesi hatırlatması var mı */
export async function taslakIcinAktifGorevVar(
	kv: KVNamespace,
	taslakId: string,
): Promise<boolean> {
	const ids = await listeOku(kv, KV_KEYS.GOREV_LISTESI);
	for (const id of ids) {
		const ham = await kv.get(KV_KEYS.gorev(id));
		if (!ham) continue;
		const gorev = JSON.parse(ham) as ScheduledTask;
		if (gorev.taslakId === taslakId && !gorev.gonderildi) return true;
	}
	return false;
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

/** /yeni akışı oturum süresi — 24 saat (saniye) */
const OTURUM_TTL_SANIYE = 24 * 60 * 60;

export async function oturumKaydet(
	kv: KVNamespace,
	chatId: string,
	oturum: UserSession,
): Promise<void> {
	// Çok adımlı akış; acilar ve diğer alanlar bu süre boyunca KV'de kalır
	await kv.put(KV_KEYS.oturum(chatId), JSON.stringify(oturum), {
		expirationTtl: OTURUM_TTL_SANIYE,
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

const ESKI_ARSIV_LISTESI = 'arsiv:liste';

/**
 * Kerelik taşıma: eski arsiv:liste kayıtlarını taslak:liste'ye alır (durum: taslak).
 * Tamamlanınca arsiv:liste anahtarını siler. Taşınan kayıt sayısını döner.
 */
export async function eskiVeriTasi(kv: KVNamespace): Promise<number> {
	const ids = await listeOku(kv, ESKI_ARSIV_LISTESI);
	if (ids.length === 0) {
		if (await kv.get(ESKI_ARSIV_LISTESI)) {
			await kv.delete(ESKI_ARSIV_LISTESI);
		}
		return 0;
	}

	let sayac = 0;
	for (const id of ids) {
		const taslak = await taslakGetir(kv, id);
		if (!taslak) continue;

		const guncel: Draft = { ...taslak, durum: 'taslak' };
		await taslakKaydet(kv, guncel);
		sayac++;
	}

	await kv.delete(ESKI_ARSIV_LISTESI);
	return sayac;
}
