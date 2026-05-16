import type { Tema } from './types';

/** KV anahtar önekleri */
export const KV_KEYS = {
	TASLAK_LISTESI: 'taslak:liste',
	ARSIV_LISTESI: 'arsiv:liste',
	GOREV_LISTESI: 'gorev:liste',
	taslak: (id: string) => `taslak:${id}`,
	gorev: (id: string) => `gorev:${id}`,
	oturum: (chatId: string) => `oturum:${chatId}`,
} as const;

/** LinkedIn liderlik serisi tema havuzu */
export const TEMALAR: Tema[] = [
	{
		id: 'vizyon',
		etiket: 'Vizyon ve Strateji',
		aciklama: 'Uzun vadeli yön, stratejik düşünme ve netlik',
	},
	{
		id: 'ekip',
		etiket: 'Ekip Yönetimi',
		aciklama: 'Güven, motivasyon ve yüksek performanslı ekipler',
	},
	{
		id: 'degisim',
		etiket: 'Değişim Liderliği',
		aciklama: 'Dönüşüm, direnç ve adaptasyon',
	},
	{
		id: 'iletisim',
		etiket: 'İletişim ve Etki',
		aciklama: 'Hikâye anlatımı, ikna ve şeffaflık',
	},
	{
		id: 'ogrenme',
		etiket: 'Öğrenme ve Gelişim',
		aciklama: 'Sürekli gelişim, geri bildirim ve merak',
	},
	{
		id: 'etik',
		etiket: 'Etik ve Güven',
		aciklama: 'Dürüstlük, sorumluluk ve güven inşası',
	},
	{
		id: 'cesitlilik',
		etiket: 'Çeşitlilik ve Kapsayıcılık',
		aciklama: 'Farklı bakış açıları ve kapsayıcı kültür',
	},
	{
		id: 'kriz',
		etiket: 'Kriz Yönetimi',
		aciklama: 'Belirsizlikte sakinlik ve karar alma',
	},
];

export const ANTHROPIC_MODEL = 'claude-sonnet-4-5';

