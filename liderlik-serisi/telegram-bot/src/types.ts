/** Taslak durumu — taslak: planlanmış/bekleyen, yayinlandi: paylaşıldı */
export type DraftStatus = 'taslak' | 'yayinlandi';

/** KV'de saklanan LinkedIn post taslağı */
export interface Draft {
	id: string;
	tema: string;
	temaEtiket: string;
	aci: string;
	icerik: string;
	durum: DraftStatus;
	olusturulma: string;
	/** Yayınlandı işaretlendiğinde ISO tarih */
	yayinTarihi?: string;
}

/** Oturumda tutulan güncel taslak metni (revize sonrası güncellenir) */
export interface GuncelTaslak {
	aci: string;
	icerik: string;
}

/** Zamanlanmış Telegram bildirimi */
export interface ScheduledTask {
	id: string;
	mesaj: string;
	/** ISO 8601 — bu tarih/saat geçince gönderilir */
	planlanan: string;
	gonderildi: boolean;
	olusturulma: string;
}

/** /yeni ve /taslaklar revize akışındaki oturum adımları */
export type OturumAdim =
	| 'tema_secildi'
	| 'not_bekleniyor'
	| 'aci_bekleniyor'
	| 'taslak_gosterildi'
	| 'revize_bekleniyor'
	| 'revizetaslak_bekleniyor'
	| 'revizetaslak_gosterildi';

/** /yeni akışı için kullanıcı oturum durumu (KV) */
export interface UserSession {
	adim: OturumAdim;
	temaId: string;
	temaEtiket: string;
	/** Kullanıcının paylaştığı bağlam/not */
	baglam?: string;
	/** Claude'un önerdiği 3 açı (tam metin) */
	acilar?: string[];
	secilenAci?: string;
	/** Üretilen taslağın id'si */
	taslakId?: string;
	/** Her revize sonrası güncellenen metin — Arşivle bunu kaydeder */
	guncel_taslak?: GuncelTaslak;
}

/** Liderlik serisi tema tanımı */
export interface Tema {
	id: string;
	etiket: string;
	aciklama: string;
}
