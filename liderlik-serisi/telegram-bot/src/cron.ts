import { bekleyenGorevler, gorevGuncelle } from './kv-storage';
import type { BotEnv } from './types';
import { bugunPlanliYayinMi, planliYayinTarihMetni, simdiPazartesiMi } from './schedule';
import { htmlKacir, mesajGonder } from './telegram';
import { planliTaslakKuyrugu } from './yayin-planlama';

/** Cron: Pazartesi hatırlatmaları + sıradaki yayınların özeti */
export async function zamanlanmisGorevCalistir(env: BotEnv): Promise<void> {
	const chatId = env.TELEGRAM_CHAT_ID;

	const taslaklar = await planliTaslakKuyrugu(env, 10);

	// Zamanı gelmiş Pazartesi yayın hatırlatmaları
	const gorevler = await bekleyenGorevler(env.LIDERLIK_KV);
	for (const gorev of gorevler) {
		await mesajGonder(env.TELEGRAM_TOKEN, chatId, gorev.mesaj, {
			parse_mode: 'HTML',
		});
		gorev.gonderildi = true;
		await gorevGuncelle(env.LIDERLIK_KV, gorev);
	}

	// Haftalık özet yalnızca Pazartesi sabahı; bugünkü post ayrı görevle gider
	if (!simdiPazartesiMi()) return;

	const gelecek = taslaklar.filter(
		(t) => t.planlananYayin && !bugunPlanliYayinMi(t.planlananYayin),
	);

	if (gelecek.length === 0) return;

	const satirlar = gelecek
		.map(
			(t) =>
				`• <b>${htmlKacir(t.temaEtiket)}</b> — ${htmlKacir(planliYayinTarihMetni(t.planlananYayin!))}`,
		)
		.join('\n');

	await mesajGonder(
		env.TELEGRAM_TOKEN,
		chatId,
		`🗓 <b>Haftalık yayın planı</b>\n\n<b>Sırada:</b>\n${satirlar}\n\nDetay için /taslaklar`,
		{ parse_mode: 'HTML' },
	);
}
