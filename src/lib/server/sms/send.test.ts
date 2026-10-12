import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ------------------------------------------------------------------
// $env/dynamic/private is a SvelteKit virtual module — mock it so the env-only
// path is deterministic and we don't accidentally hit a real provider URL.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

// The key resolver is dynamically imported inside send.ts; mock it so we can flip
// "configured" on/off per test without a live PocketBase.
const { mockKey } = vi.hoisted(() => ({ mockKey: { value: '' as string } }));
vi.mock('../integrations/keys.js', () => ({
	getIntegrationKeyAny: async (name: string) => {
		if (name === 'sms_api_key') return mockKey.value;
		if (name === 'sms_from') return mockKey.value ? 'Geisha' : '';
		return '';
	}
}));

// Capture rows written to geisha_messages. pb() is dynamically imported in logSms.
const created: Array<Record<string, unknown>> = [];
vi.mock('../db/pb.js', () => ({
	pb: async () => ({
		collection: (_name: string) => ({
			create: async (data: Record<string, unknown>) => {
				created.push(data);
				return { id: 'msg_1', ...data };
			}
		})
	})
}));

import { sendSms, smsConfigured, sendAndLogSms, logSms } from './send.js';

beforeEach(() => {
	created.length = 0;
	mockKey.value = '';
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('smsConfigured', () => {
	it('is false when no key is set', async () => {
		expect(await smsConfigured()).toBe(false);
	});

	it('is true once a provider key is resolvable', async () => {
		mockKey.value = 'sms_live_abc123';
		expect(await smsConfigured()).toBe(true);
	});
});

describe('sendSms — unconfigured (graceful no-op)', () => {
	it('returns { sent:false, skipped:true } and never calls fetch', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);

		const r = await sendSms({ to: '+447700900000', body: 'hi' });

		expect(r).toEqual({ sent: false, skipped: true });
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('sendSms — configured (HTTP mocked)', () => {
	beforeEach(() => {
		mockKey.value = 'sms_live_abc123';
	});

	it('POSTs from/to/body with a Bearer key and returns { sent:true, id }', async () => {
		const fetchSpy = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ id: 'sms_remote_1' }),
			text: async () => ''
		}));
		vi.stubGlobal('fetch', fetchSpy);

		const r = await sendSms({ to: '+447700900000', body: 'Your table is booked' });

		expect(r).toEqual({ sent: true, id: 'sms_remote_1' });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sms_live_abc123');
		const payload = JSON.parse(String(init.body));
		expect(payload).toMatchObject({ to: '+447700900000', body: 'Your table is booked', from: 'Geisha' });
	});

	it('returns { sent:false } (no throw) on a provider error response', async () => {
		const fetchSpy = vi.fn(async () => ({
			ok: false,
			status: 422,
			json: async () => ({}),
			text: async () => 'bad number'
		}));
		vi.stubGlobal('fetch', fetchSpy);

		const r = await sendSms({ to: 'nope', body: 'hi' });
		expect(r).toEqual({ sent: false });
	});

	it('returns { sent:false } (no throw) when fetch rejects', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
		const r = await sendSms({ to: '+447700900000', body: 'hi' });
		expect(r).toEqual({ sent: false });
	});
});

describe('logSms', () => {
	it('writes a geisha_messages row with channel:sms and the given status', async () => {
		await logSms(
			{ to: '+447700900000', body: 'Reminder text' },
			{ customer: 'cust_1', booking: 'bk_1', template: 'reminder' },
			'sent'
		);
		expect(created).toHaveLength(1);
		const row = created[0];
		expect(row).toMatchObject({
			channel: 'sms',
			customer: 'cust_1',
			booking: 'bk_1',
			template: 'reminder',
			status: 'sent',
			subject: '',
			body: 'Reminder text'
		});
		expect(row.sent_at).toBeTruthy(); // stamped for 'sent'
	});

	it('leaves sent_at empty for a non-sent status', async () => {
		await logSms(
			{ to: '+447700900000', body: 'x' },
			{ customer: 'cust_1', template: 'reminder' },
			'skipped'
		);
		expect(created[0].sent_at).toBe('');
		expect(created[0].booking).toBe(''); // optional booking defaults to ''
	});
});

describe('sendAndLogSms', () => {
	it('no-op (unconfigured) logs a single skipped row and returns skipped', async () => {
		vi.stubGlobal('fetch', vi.fn());
		const r = await sendAndLogSms(
			{ to: '+447700900000', body: 'hi' },
			{ customer: 'cust_1', booking: 'bk_1', template: 'reminder' }
		);
		expect(r).toEqual({ sent: false, skipped: true });
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ channel: 'sms', status: 'skipped' });
	});

	it('configured success logs a sent row', async () => {
		mockKey.value = 'sms_live_abc123';
		vi.stubGlobal('fetch', vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ id: 'sms_remote_2' }),
			text: async () => ''
		})));
		const r = await sendAndLogSms(
			{ to: '+447700900000', body: 'hi' },
			{ customer: 'cust_1', template: 'reminder' }
		);
		expect(r).toEqual({ sent: true, id: 'sms_remote_2' });
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ channel: 'sms', status: 'sent' });
	});

	it('configured failure logs a failed row', async () => {
		mockKey.value = 'sms_live_abc123';
		vi.stubGlobal('fetch', vi.fn(async () => ({
			ok: false,
			status: 500,
			json: async () => ({}),
			text: async () => 'boom'
		})));
		const r = await sendAndLogSms(
			{ to: '+447700900000', body: 'hi' },
			{ customer: 'cust_1', template: 'reminder' }
		);
		expect(r).toEqual({ sent: false });
		expect(created[0]).toMatchObject({ channel: 'sms', status: 'failed' });
	});
});
