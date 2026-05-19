/**
 * Haftalık yayın takvimi — her Pazartesi 09:00 Türkiye (UTC 06:00).
 * Kuyruk: en eski taslak bir sonraki Pazartesi, sonrakiler +7 gün.
 */

/** Türkiye sabah yayın saati = UTC 06:00 */
const YAYIN_SAATI_UTC = 6;

/** Liste sırasından FIFO yayın sırası (0 = en yakın Pazartesi) */
export function planliYayinSirasiHesapla(listeUzunlugu: number, indeks: number): number {
	return listeUzunlugu - 1 - indeks;
}

/** Sıradaki N. Pazartesi yayın anı (0 = ilk uygun Pazartesi) */
export function pazartesiYayinTarihi(haftaOfseti: number, simdi = new Date()): Date {
	const d = new Date(simdi);
	const utcGun = d.getUTCDay(); // 0 Pazar, 1 Pazartesi, …

	let gunEkle: number;
	if (utcGun === 1) {
		// Pazartesi: slot geçtiyse bir sonraki hafta
		const slotGecti = d.getUTCHours() >= YAYIN_SAATI_UTC;
		gunEkle = slotGecti ? 7 : 0;
	} else if (utcGun === 0) {
		gunEkle = 1;
	} else {
		gunEkle = 8 - utcGun;
	}

	d.setUTCDate(d.getUTCDate() + gunEkle + haftaOfseti * 7);
	d.setUTCHours(YAYIN_SAATI_UTC, 0, 0, 0);
	return d;
}

/** Planlanan yayın tarihini kullanıcıya göster */
export function planliYayinTarihMetni(iso: string): string {
	const d = new Date(iso);
	const tarih = d.toLocaleDateString('tr-TR', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'Europe/Istanbul',
	});
	return `${tarih}, 09:00`;
}

/** Bugün bu taslağın yayın günü mü (UTC gün karşılaştırması) */
export function bugunPlanliYayinMi(planlananYayin: string, simdi = new Date()): boolean {
	const hedef = new Date(planlananYayin);
	return (
		hedef.getUTCFullYear() === simdi.getUTCFullYear() &&
		hedef.getUTCMonth() === simdi.getUTCMonth() &&
		hedef.getUTCDate() === simdi.getUTCDate()
	);
}

/** Cron Pazartesi 06:00 UTC'de mi çalışıyor */
export function simdiPazartesiMi(simdi = new Date()): boolean {
	return simdi.getUTCDay() === 1;
}

/** Yayın kuyruğunu planlanan Pazartesi tarihine göre sıralar (en yakın önce) */
export function planliTaslaklariSirala<T extends { planlananYayin?: string }>(
	taslaklar: T[],
): T[] {
	return [...taslaklar].sort((a, b) => {
		const ta = a.planlananYayin ? new Date(a.planlananYayin).getTime() : Number.MAX_SAFE_INTEGER;
		const tb = b.planlananYayin ? new Date(b.planlananYayin).getTime() : Number.MAX_SAFE_INTEGER;
		return ta - tb;
	});
}
