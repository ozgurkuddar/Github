import {
	eksikPlanliYayinlariDoldur,
	gorevKaydet,
	taslakIcinAktifGorevVar,
	taslaklariListele,
} from './kv-storage';
import type { BotEnv } from './types';
import { planliTaslaklariSirala } from './schedule';
import { htmlKacir } from './telegram';
import type { Draft, ScheduledTask } from './types';

export { planliTaslaklariSirala } from './schedule';

/** Planlı Pazartesi 09:00 için yayın hatırlatması oluşturur */
export async function pazartesiYayinGoreviEkle(env: BotEnv, taslak: Draft): Promise<void> {
	if (!taslak.planlananYayin) return;
	if (await taslakIcinAktifGorevVar(env.LIDERLIK_KV, taslak.id)) return;

	const aciOzet =
		taslak.aci.length > 200 ? `${taslak.aci.slice(0, 200)}…` : taslak.aci;

	const gorev: ScheduledTask = {
		id: crypto.randomUUID(),
		taslakId: taslak.id,
		mesaj: `📅 <b>Bugün yayın günü</b>\n\n<b>${htmlKacir(taslak.temaEtiket)}</b> postunu LinkedIn'de paylaşma zamanı.\n\n<b>Açı:</b> ${htmlKacir(aciOzet)}\n\nYayınladıktan sonra /taslaklar → <b>Yayınlandı</b> ile işaretle.`,
		planlanan: taslak.planlananYayin,
		gonderildi: false,
		olusturulma: new Date().toISOString(),
	};
	await gorevKaydet(env.LIDERLIK_KV, gorev);
}

/** Eski taslaklar için eksik planlananYayin ve Pazartesi görevlerini tamamlar */
export async function eksikPazartesiGorevleriniOlustur(env: BotEnv): Promise<void> {
	await eksikPlanliYayinlariDoldur(env.LIDERLIK_KV);
	const taslaklar = await taslaklariListele(env.LIDERLIK_KV, 'taslak', 20);
	const simdi = Date.now();

	for (const t of taslaklar) {
		if (!t.planlananYayin || new Date(t.planlananYayin).getTime() <= simdi) continue;
		await pazartesiYayinGoreviEkle(env, t);
	}
}

/** Cron ve /taslaklar için sıralı kuyruk listesi */
export async function planliTaslakKuyrugu(env: BotEnv, limit = 10): Promise<Draft[]> {
	await eksikPlanliYayinlariDoldur(env.LIDERLIK_KV);
	await eksikPazartesiGorevleriniOlustur(env);
	return planliTaslaklariSirala(await taslaklariListele(env.LIDERLIK_KV, 'taslak', limit));
}
