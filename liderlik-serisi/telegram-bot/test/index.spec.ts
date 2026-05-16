import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Liderlik Serisi Telegram Bot', () => {
	it('GET / sağlık kontrolü döner', async () => {
		const request = new Request('http://example.com/');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('aktif');
	});

	it('POST /webhook geçersiz JSON için 400 döner', async () => {
		const request = new Request('http://example.com/webhook', {
			method: 'POST',
			body: 'not-json',
			headers: { 'Content-Type': 'application/json' },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
	});

	it('POST /webhook geçerli güncelleme için OK döner', async () => {
		const request = new Request('http://example.com/webhook', {
			method: 'POST',
			body: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: 0 }, text: '/start' } }),
			headers: { 'Content-Type': 'application/json' },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('OK');
	});
});
