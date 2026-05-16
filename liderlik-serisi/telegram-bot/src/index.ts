/**
 * LinkedIn Liderlik Serisi — Telegram Bot Worker
 * Webhook, Anthropic taslak üretimi ve KV depolama
 */

import { zamanlanmisGorevCalistir } from './cron';
import {
	aciSecildi,
	arsivleTaslak,
	komutArsiv,
	komutTaslaklar,
	komutYardim,
	komutYeni,
	notAlindi,
	oturumMesajiIsle,
	revizeBaslat,
	temaSecildi,
	type BotEnv,
} from './handlers';
import { oturumGetir } from './kv-storage';

// --- Telegram güncelleme tipleri (minimal) ---

interface TelegramUser {
	id: number;
}

interface TelegramChat {
	id: number;
}

interface TelegramMessage {
	message_id: number;
	chat: TelegramChat;
	from?: TelegramUser;
	text?: string;
}

interface TelegramCallbackQuery {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	data?: string;
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
}

function envDenBotEnv(env: Env): BotEnv {
	return {
		LIDERLIK_KV: env.LIDERLIK_KV,
		TELEGRAM_TOKEN: env.TELEGRAM_TOKEN,
		TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
		ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
	};
}

/** Sadece yetkili chat'ten gelen istekleri kabul et */
function yetkiliChat(chatId: string, env: BotEnv): boolean {
	return chatId === env.TELEGRAM_CHAT_ID;
}

async function guncellemeIsle(env: BotEnv, update: TelegramUpdate): Promise<void> {
	if (update.callback_query) {
		await callbackIsle(env, update.callback_query);
		return;
	}
	if (update.message?.text) {
		await mesajIsle(env, update.message);
	}
}

async function mesajIsle(env: BotEnv, message: TelegramMessage): Promise<void> {
	const chatId = String(message.chat.id);
	if (!yetkiliChat(chatId, env)) return;

	const metin = message.text?.trim() ?? '';
	const komut = metin.split(/\s+/)[0]?.toLowerCase();

	switch (komut) {
		case '/start':
		case '/yardim':
		case '/help':
			await komutYardim(env, chatId);
			break;
		case '/yeni':
			await komutYeni(env, chatId);
			break;
		case '/taslaklar':
			await komutTaslaklar(env, chatId);
			break;
		case '/arsiv':
			await komutArsiv(env, chatId);
			break;
		case '/atla': {
			const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
			if (oturum?.adim === 'not_bekleniyor') {
				await notAlindi(env, chatId, '/atla');
				break;
			}
			break;
		}
		default:
			if (metin.startsWith('/')) {
				await komutYardim(env, chatId);
			} else {
				const islendi = await oturumMesajiIsle(env, chatId, metin);
				if (!islendi) {
					const oturum = await oturumGetir(env.LIDERLIK_KV, chatId);
					if (oturum) {
						await komutYardim(env, chatId);
					}
				}
			}
			break;
	}
}

async function callbackIsle(env: BotEnv, query: TelegramCallbackQuery): Promise<void> {
	const chatId = query.message?.chat.id;
	if (!chatId) return;
	const chatIdStr = String(chatId);
	if (!yetkiliChat(chatIdStr, env)) return;

	const data = query.data ?? '';

	if (data.startsWith('tema:')) {
		const temaId = data.slice('tema:'.length);
		await temaSecildi(env, chatIdStr, temaId, query.id);
		return;
	}

	if (data.startsWith('aci:')) {
		const indeks = Number.parseInt(data.slice('aci:'.length), 10);
		if (!Number.isNaN(indeks)) {
			await aciSecildi(env, chatIdStr, indeks, query.id);
		}
		return;
	}

	if (data.startsWith('revize:')) {
		const taslakId = data.slice('revize:'.length);
		await revizeBaslat(env, chatIdStr, taslakId, query.id);
		return;
	}

	if (data.startsWith('arsiv:')) {
		const taslakId = data.slice('arsiv:'.length);
		await arsivleTaslak(env, chatIdStr, taslakId, query.id);
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const botEnv = envDenBotEnv(env);

		// Sağlık kontrolü
		if (url.pathname === '/' && request.method === 'GET') {
			return new Response('Liderlik Serisi Telegram Bot — aktif', {
				headers: { 'Content-Type': 'text/plain; charset=utf-8' },
			});
		}

		// Telegram webhook
		if (url.pathname === '/webhook' && request.method === 'POST') {
			let update: TelegramUpdate;
			try {
				update = (await request.json()) as TelegramUpdate;
			} catch {
				return new Response('Geçersiz JSON', { status: 400 });
			}

			ctx.waitUntil(
				guncellemeIsle(botEnv, update).catch((err) => {
					console.error('Webhook işleme hatası:', err);
				}),
			);

			return new Response('OK');
		}

		return new Response('Not Found', { status: 404 });
	},

	async scheduled(
		controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	): Promise<void> {
		const botEnv = envDenBotEnv(env);
		// 0 6 * * * → Türkiye saatiyle 09:00
		if (controller.cron === '0 6 * * *') {
			ctx.waitUntil(
				zamanlanmisGorevCalistir(botEnv).catch((err) => {
					console.error('Cron hatası:', err);
				}),
			);
		}
	},
} satisfies ExportedHandler<Env>;
