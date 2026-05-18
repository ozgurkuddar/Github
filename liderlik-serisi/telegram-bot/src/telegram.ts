/** Telegram Bot API yardımcıları */

export interface TelegramInlineKeyboard {
	inline_keyboard: { text: string; callback_data: string }[][];
}

interface SendMessageOptions {
	parse_mode?: 'HTML' | 'Markdown';
	reply_markup?: TelegramInlineKeyboard;
	disable_web_page_preview?: boolean;
}

async function telegramFetch(
	token: string,
	method: string,
	body: Record<string, unknown>,
): Promise<Response> {
	return fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

/** Metin mesajı gönderir; 4096 karakter sınırında parçalar */
export async function mesajGonder(
	token: string,
	chatId: string,
	metin: string,
	secenekler?: SendMessageOptions,
): Promise<void> {
	const parcalar = metinParcala(metin, 4000);
	for (const parca of parcalar) {
		const body: Record<string, unknown> = {
			chat_id: chatId,
			text: parca,
			...secenekler,
		};
		// reply_markup yalnızca son parçada
		if (parcalar.length > 1 && parca !== parcalar[parcalar.length - 1]) {
			delete body.reply_markup;
		}
		const res = await telegramFetch(token, 'sendMessage', body);
		if (!res.ok) {
			const err = await res.text();
			console.error('Telegram sendMessage hatası:', err);
		}
	}
}

export async function callbackYanitla(
	token: string,
	callbackQueryId: string,
	metin?: string,
): Promise<void> {
	await telegramFetch(token, 'answerCallbackQuery', {
		callback_query_id: callbackQueryId,
		text: metin,
		show_alert: false,
	});
}

/** Telegram yerleşik komut menüsü (setMyCommands) */
export async function komutMenuGuncelle(token: string): Promise<void> {
	const komutlar = [
		{ command: 'yeni', description: 'Yeni LinkedIn postu oluştur' },
		{ command: 'taslaklar', description: 'Planlanmış postları göster' },
		{ command: 'yayinlandi', description: 'Yayınlanan postları göster' },
		{ command: 'istatistik', description: 'Paylaşım istatistiklerini göster' },
		{ command: 'komutlar', description: 'Tüm komutları listele' },
		{ command: 'konser', description: 'Konser takibi (yakında)' },
		{ command: 'ucak', description: 'Uçak bileti takibi (yakında)' },
	];
	const res = await telegramFetch(token, 'setMyCommands', { commands: komutlar });
	if (!res.ok) {
		const err = await res.text();
		console.error('Telegram setMyCommands hatası:', err);
	}
}

function metinParcala(metin: string, max: number): string[] {
	if (metin.length <= max) return [metin];
	const parcalar: string[] = [];
	let kalan = metin;
	while (kalan.length > 0) {
		if (kalan.length <= max) {
			parcalar.push(kalan);
			break;
		}
		let kesim = kalan.lastIndexOf('\n\n', max);
		if (kesim < max * 0.5) kesim = kalan.lastIndexOf('\n', max);
		if (kesim < max * 0.3) kesim = max;
		parcalar.push(kalan.slice(0, kesim));
		kalan = kalan.slice(kesim).trimStart();
	}
	return parcalar;
}

/** HTML özel karakterlerini kaçırır */
export function htmlKacir(metin: string): string {
	return metin
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
