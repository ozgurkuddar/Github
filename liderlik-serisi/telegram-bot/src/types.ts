/** Taslak durumu */
export type DraftStatus = 'taslak' | 'arsiv';

/** KV'de saklanan LinkedIn post taslağı */
export interface Draft {
	id: string;
	tema: string;
	temaEtiket: string;
	aci: string;
	icerik: string;
	durum: DraftStatus;
	olusturulma: string;
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

/** /yeni akışındaki oturum adımları */
export type OturumAdim =
	| 'tema_secildi'
	| 'not_bekleniyor'
	| 'aci_bekleniyor'
	| 'taslak_gosterildi'
	| 'revize_bekleniyor';

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
}

/** Liderlik serisi tema tanımı */
export interface Tema {
	id: string;
	etiket: string;
	aciklama: string;
}
