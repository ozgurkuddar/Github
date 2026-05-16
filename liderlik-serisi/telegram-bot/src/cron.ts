import { bekleyenGorevler, gorevGuncelle, taslaklariListele } from './kv-storage';
import { htmlKacir, mesajGonder } from './telegram';
import type { BotEnv } from './handlers';

/** Cron: bekleyen görevleri gönder + günlük özet */
export async function zamanlanmisGorevCalistir(env: BotEnv): Promise<void> {
	const chatId = env.TELEGRAM_CHAT_ID;

	// KV'deki zamanı gelmiş görevler
	const gorevler = await bekleyenGorevler(env.LIDERLIK_KV);
	for (const gorev of gorevler) {
		await mesajGonder(env.TELEGRAM_TOKEN, chatId, gorev.mesaj, {
			parse_mode: 'HTML',
		});
		gorev.gonderildi = true;
		await gorevGuncelle(env.LIDERLIK_KV, gorev);
	}

	// Aktif taslak özeti (her sabah)
	const taslaklar = await taslaklariListele(env.LIDERLIK_KV, 'taslak', 5);
	if (taslaklar.length > 0) {
		const satirlar = taslaklar
			.map((t) => `• ${htmlKacir(t.temaEtiket)} — ${new Date(t.olusturulma).toLocaleDateString('tr-TR')}`)
			.join('\n');
		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			`☀️ <b>Günaydın — Liderlik Serisi</b>\n\n<b>Aktif taslaklar (${taslaklar.length}):</b>\n${satirlar}\n\nDetay için /taslaklar`,
			{ parse_mode: 'HTML' },
		);
	} else if (gorevler.length === 0) {
		await mesajGonder(
			env.TELEGRAM_TOKEN,
			chatId,
			'☀️ <b>Günaydın!</b>\n\nBugün için bekleyen görev yok. Yeni post için /yeni kullanabilirsin.',
			{ parse_mode: 'HTML' },
		);
	}
}
