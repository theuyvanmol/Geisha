// The card step's own trouble reports.
//
// 2026-09-11: 19 of 23 lapsed online bookings never pressed Pay, and nothing on our
// side could say whether the card form had loaded, loaded slowly, or loaded and was
// looked at — the widget reported errors, but a guest simply LEAVING left no trace.
// The widget now reports that as stage 'abandon'; the route must record it as such
// rather than folding it into 'unknown', or the report can't be grouped by it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { audit } = vi.hoisted(() => ({ audit: vi.fn(async () => undefined) }));

vi.mock('$lib/server/booking/audit.js', () => ({ writeAudit: audit }));
vi.mock('$lib/server/booking/origin.js', () => ({ describeOrigin: () => ({ kind: 'direct' }) }));
vi.mock('$lib/server/util/rateLimit.js', () => ({
	rateLimit: () => ({ ok: true }),
	clientKey: () => 'k',
	AVAILABILITY_READ: {}
}));
vi.mock('$lib/server/db/pb.js', () => ({
	pb: async () => ({
		collection: (name: string) => ({
			getOne: async () => ({ id: 'bk_1', status: 'pending_payment' }),
			getFirstListItem: async () =>
				name === 'geisha_payments'
					? { kind: 'deposit', amount: 8000, dojo_payment_intent_id: 'pi_1' }
					: null
		})
	})
}));

import { POST } from './+server';

function post(body: unknown) {
	const url = new URL('https://geisha.test/api/bookings/bk_1/payment-issue');
	return POST({
		params: { id: 'bk_1' },
		request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
		url,
		getClientAddress: () => '1.2.3.4'
	} as never);
}

beforeEach(() => audit.mockClear());

describe('POST /api/bookings/[id]/payment-issue', () => {
	it("records a guest leaving the card step as stage 'abandon'", async () => {
		await post({
			stage: 'abandon',
			code: 'left_card_step',
			message: 'card form ready after 11.0s'
		});
		const after = (audit.mock.calls[0] as unknown[])[5] as Record<string, unknown>;
		expect(after.stage).toBe('abandon');
		expect(after.code).toBe('left_card_step');
	});

	it('still files an unrecognised stage as unknown', async () => {
		await post({ stage: 'teleport', code: 'x' });
		const after = (audit.mock.calls[0] as unknown[])[5] as Record<string, unknown>;
		expect(after.stage).toBe('unknown');
	});
});
