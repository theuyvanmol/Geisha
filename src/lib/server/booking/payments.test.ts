// Unit coverage for the payment glue (WP-S1-6 / WP-S1-7): the manual
// money actions (refundDepositManual / releaseHoldManual) and the in-time
// cancellation deposit refund wired into cancelBooking. PocketBase, the Stripe
// REST module and the email sender are mocked; the real guard / idempotency
// logic runs.
//
// THE INTENT ID SHAPE IS LOAD-BEARING. Stripe models the two money shapes with
// two different objects, and the payment row stores whichever id it got:
//   • a DEPOSIT is a PaymentIntent  → 'pi_…'   → refundable
//   • a GUARANTEE is a SetupIntent  → 'seti_…' → releasable, chargeable later
// Every money operation routes on that prefix, so a fixture with the wrong shape
// silently no-ops. That is deliberate: asking to refund a stored card, or to
// release a captured deposit, is a bug worth turning into a no-op rather than an
// exception mid-service.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Payment } from '../db/types.js';

/** A deposit — money already taken, so refundable. */
const DEPOSIT_INTENT = 'pi_test_deposit_abc123';
/** A card guarantee — a stored card, so releasable and chargeable, never refundable. */
const GUARANTEE_INTENT = 'seti_test_guarantee_abc123';

// --- in-memory PocketBase fake (mirrors amend.test.ts) ----------------------

type Row = Record<string, unknown> & { id: string };
const store: Record<string, Row[]> = {};
let idSeq = 0;

function matches(row: Row, filter?: string): boolean {
	if (!filter) return true;
	for (const clause of filter.split('&&')) {
		const t = clause.trim();
		if (!t) continue;
		const m = t.match(/^([\w.]+)\s*=\s*"([^"]*)"$/);
		if (m) {
			if (String(row[m[1]] ?? '') !== m[2]) return false;
			continue;
		}
	}
	return true;
}

function collection(name: string) {
	store[name] ??= [];
	const rows = () => store[name];
	return {
		async getOne<T>(id: string): Promise<T> {
			const r = rows().find((x) => x.id === id);
			if (!r) throw Object.assign(new Error('not found'), { status: 404 });
			return structuredClone(r) as T;
		},
		async getFirstListItem<T>(filter: string): Promise<T> {
			const r = rows().find((x) => matches(x, filter));
			if (!r) throw Object.assign(new Error('not found'), { status: 404 });
			return structuredClone(r) as T;
		},
		async getFullList<T>(opts?: { filter?: string }): Promise<T[]> {
			return rows()
				.filter((x) => matches(x, opts?.filter))
				.map((x) => structuredClone(x)) as T[];
		},
		async create<T>(data: Record<string, unknown>): Promise<T> {
			const row: Row = { id: `${name}_${++idSeq}`, created: '', updated: '', ...data };
			rows().push(row);
			return structuredClone(row) as T;
		},
		async update<T>(id: string, data: Record<string, unknown>): Promise<T> {
			const r = rows().find((x) => x.id === id);
			if (!r) throw Object.assign(new Error('not found'), { status: 404 });
			Object.assign(r, data);
			return structuredClone(r) as T;
		},
		async delete(id: string): Promise<void> {
			store[name] = rows().filter((x) => x.id !== id);
		}
	};
}

const fakePb = { collection };
vi.mock('../db/pb.js', () => ({
	pb: async () => fakePb,
	coll: async (n: string) => fakePb.collection(n)
}));

// --- Stripe module mock -----------------------------------------------------
// `configured` toggles the no-key graceful path. The money calls record their
// args and echo back a status so the glue's markPayment runs.
//
// intentKind and mapStatus are the REAL implementations, not stubs: they are the
// routing logic under test here (which id shape goes to which operation), so
// faking them would hide exactly the mistake these tests exist to catch.

let configured = true;
const refundPaymentIntent = vi.fn(async () => ({ id: 're_1', status: 'succeeded' as const }));
const releaseGuarantee = vi.fn(async () => ({ id: 'seti_1', status: 'canceled' as const }));
const chargeGuarantee = vi.fn(async () => ({ id: 'pi_1', status: 'succeeded' as const }));

vi.mock('../payments/stripe.js', () => ({
	isConfiguredAsync: async () => configured,
	refundPaymentIntent: (...a: unknown[]) => refundPaymentIntent(...(a as [])),
	releaseGuarantee: (...a: unknown[]) => releaseGuarantee(...(a as [])),
	chargeGuarantee: (...a: unknown[]) => chargeGuarantee(...(a as [])),
	createDepositIntent: vi.fn(),
	createGuaranteeIntent: vi.fn(),
	ensureCustomer: vi.fn(),
	intentKind: (id: string) =>
		id.startsWith('pi_') ? 'payment_intent' : id.startsWith('seti_') ? 'setup_intent' : 'unknown',
	mapStatus: (object: string, status: string) =>
		status === 'canceled'
			? 'Canceled'
			: object === 'setup_intent'
				? status === 'succeeded'
					? 'Authorized'
					: 'Created'
				: status === 'succeeded'
					? 'Captured'
					: 'Created'
}));

// Email is best-effort and irrelevant here.
vi.mock('../email/confirmations.js', () => ({
	sendBookingConfirmation: async () => ({ sent: true }),
	sendCancellation: async () => ({ sent: true })
}));

// Import AFTER mocks.
const { refundDepositManual, releaseHoldManual, chargeNoShowManual, chargeNoShowFee, settleNoShowMoney } =
	await import('./payments.js');
const { cancelBooking, markNoShow } = await import('./mutate.js');
const { confirmPaidBooking } = await import('./confirmPayment.js');
const { depositRefundable, isLateCancellation } = await import('./policy.js');
// cancelBooking now runs its payment/refund side-effects via deferWork (off the
// response); in tests there's no waitUntil context so they run un-awaited. flushDeferred
// awaits them so the refund assertions below are deterministic.
const { flushDeferred } = await import('../util/defer.js');

// --- helpers ----------------------------------------------------------------

function reset() {
	for (const k of Object.keys(store)) delete store[k];
	idSeq = 0;
	configured = true;
	refundPaymentIntent.mockClear();
	releaseGuarantee.mockClear();
	chargeGuarantee.mockClear();
	store['geisha_bookings'] = [];
	store['geisha_payments'] = [];
	store['geisha_audit_log'] = [];
	store['geisha_customers'] = [{ id: 'cust1', created: '', updated: '', name: 'A', email: '', phone: '' }];
	store['geisha_restaurants'] = [{ id: 'rest1', created: '', updated: '', brand: 'asia', timezone: 'Europe/London' }];
}

function seedPayment(over: Partial<Payment> & { booking: string }): Payment {
	const row: Row = {
		id: `pay_${++idSeq}`,
		created: '',
		updated: '',
		dojo_payment_intent_id: DEPOSIT_INTENT,
		kind: 'deposit',
		amount: 6000,
		status: 'Captured',
		captured_at: '2026-06-01T10:00:00.000Z',
		reversed_at: '',
		...over
	};
	store['geisha_payments'].push(row);
	// Every payment needs its booking to exist: the money paths resolve the brand
	// (and so the Stripe key) from booking → restaurant, so a payment without a
	// booking would silently exercise the unbranded fallback instead of the real
	// routing.
	if (!store['geisha_bookings'].some((b) => b.id === over.booking)) {
		store['geisha_bookings'].push({
			id: over.booking,
			created: '',
			updated: '',
			restaurant: 'rest1',
			customer: 'cust1'
		});
	}
	return row as unknown as Payment;
}

function audits(action: string) {
	return store['geisha_audit_log'].filter((r) => r.action === action);
}

beforeEach(reset);

// ---------------------------------------------------------------------------

describe('depositRefundable (§6 — inverse of late cancel)', () => {
	const start = new Date('2026-06-01T20:00:00.000Z');
	it('is refundable when cancelling well in advance (≥12h)', () => {
		// 07:00 = 13h before. Was 09:00 (11h) when the window was 8 hours; under the
		// 12-hour window that is now a LATE cancellation, which is the whole point
		// of the change.
		expect(depositRefundable(new Date('2026-06-01T07:00:00.000Z'), start)).toBe(true);
	});
	it('is NOT refundable on a late (<12h) cancellation', () => {
		expect(depositRefundable(new Date('2026-06-01T15:00:00.000Z'), start)).toBe(false);
	});
	it('is NOT refundable at 11 hours — the case the old 8-hour window got wrong', () => {
		expect(depositRefundable(new Date('2026-06-01T09:00:00.000Z'), start)).toBe(false);
	});
	it('is exactly the inverse of isLateCancellation', () => {
		const now = new Date('2026-06-01T13:30:00.000Z');
		expect(depositRefundable(now, start)).toBe(!isLateCancellation(start, now));
	});
});

describe('refundDepositManual', () => {
	it('refunds a captured deposit with a stable idempotency key + audit', async () => {
		const p = seedPayment({ booking: 'bk1', status: 'Captured', amount: 6000 });
		const res = await refundDepositManual('bk1', 'full', 'goodwill', 'staff', 'staff42');

		expect(res.outcome).toBe('refunded');
		// The trailing 'asia' is the brand: it selects which Stripe account/key the
		// call runs against, so every money call must name the brand it belongs to.
		expect(refundPaymentIntent).toHaveBeenCalledWith(
			DEPOSIT_INTENT,
			6000,
			`manual-refund-${p.id}`,
			'goodwill',
			'asia'
		);
		expect(res.payment?.status).toBe('Refunded');

		const log = audits('refund_deposit_manual');
		expect(log).toHaveLength(1);
		expect(log[0].actor).toBe('staff');
		expect(log[0].on_behalf_of).toBe('staff42');
		expect((log[0].after as { refundedPence: number }).refundedPence).toBe(6000);
	});

	it('honours a partial refund amount (clamped to the captured total)', async () => {
		seedPayment({ booking: 'bk2', status: 'Captured', amount: 6000 });
		await refundDepositManual('bk2', 2500, 'partial', 'staff');
		expect(refundPaymentIntent).toHaveBeenCalledWith(
			DEPOSIT_INTENT,
			2500,
			expect.any(String),
			'partial',
			'asia'
		);

		// over-asking is clamped to the captured amount
		refundPaymentIntent.mockClear();
		seedPayment({ booking: 'bk2b', status: 'Captured', amount: 6000 });
		await refundDepositManual('bk2b', 99999, 'oops', 'staff');
		expect(refundPaymentIntent).toHaveBeenCalledWith(
			DEPOSIT_INTENT,
			6000,
			expect.any(String),
			'oops',
			'asia'
		);
	});

	it('is skipped (no provider call) for a non-captured payment — status guard', async () => {
		seedPayment({ booking: 'bk3', status: 'Authorized', kind: 'noshow_hold', dojo_payment_intent_id: GUARANTEE_INTENT });
		const res = await refundDepositManual('bk3', 'full', 'x');
		expect(res.outcome).toBe('skipped');
		expect(refundPaymentIntent).not.toHaveBeenCalled();
		expect(audits('refund_deposit_manual')).toHaveLength(0);
	});

	it('is skipped when no payment exists', async () => {
		const res = await refundDepositManual('missing', 'full', 'x');
		expect(res.outcome).toBe('skipped');
		expect(res.payment).toBeNull();
		expect(refundPaymentIntent).not.toHaveBeenCalled();
	});

	it('is skipped (no-op) when no payment provider is configured', async () => {
		configured = false;
		seedPayment({ booking: 'bk4', status: 'Captured' });
		const res = await refundDepositManual('bk4', 'full', 'x');
		expect(res.outcome).toBe('skipped');
		expect(res.reason).toMatch(/no payment provider configured/i);
		expect(refundPaymentIntent).not.toHaveBeenCalled();
	});

	it('is skipped for a Stripe card guarantee, which holds nothing to refund', async () => {
		// Routing by intent-id shape: a `seti_…` is a stored card, not a captured
		// payment, so the refund must not fire and the row must not change.
		seedPayment({ booking: 'bk4b', status: 'Captured', dojo_payment_intent_id: 'seti_1Abc' });
		const res = await refundDepositManual('bk4b', 'full', 'x');
		expect(res.outcome).toBe('skipped');
		expect(refundPaymentIntent).not.toHaveBeenCalled();
	});
});

describe('releaseHoldManual', () => {
	it('reverses an authorised no-show hold + audits', async () => {
		seedPayment({ booking: 'bk5', kind: 'noshow_hold', dojo_payment_intent_id: GUARANTEE_INTENT, status: 'Authorized', captured_at: '' });
		const res = await releaseHoldManual('bk5', 'waiving fee', 'staff', 'mgr9');

		expect(res.outcome).toBe('released');
		expect(releaseGuarantee).toHaveBeenCalledWith(GUARANTEE_INTENT, 'asia');
		expect(res.payment?.status).toBe('Reversed');
		expect(res.payment?.reversed_at).toBeTruthy();

		const log = audits('release_hold_manual');
		expect(log).toHaveLength(1);
		expect(log[0].on_behalf_of).toBe('mgr9');
	});

	it('is skipped for a captured deposit (only Authorized holds release)', async () => {
		seedPayment({ booking: 'bk6', kind: 'deposit', status: 'Captured' });
		const res = await releaseHoldManual('bk6', 'x');
		expect(res.outcome).toBe('skipped');
		expect(releaseGuarantee).not.toHaveBeenCalled();
	});

	it('is skipped when an already-reversed hold is released again (idempotent guard)', async () => {
		seedPayment({ booking: 'bk7', kind: 'noshow_hold', dojo_payment_intent_id: GUARANTEE_INTENT, status: 'Reversed', reversed_at: 'x' });
		const res = await releaseHoldManual('bk7', 'x');
		expect(res.outcome).toBe('skipped');
		expect(releaseGuarantee).not.toHaveBeenCalled();
	});
});

/** A booking with a card on file — the shape that can actually be charged. */
function seedGuarantee(bookingId: string, status: string, startsAt?: string) {
	store['geisha_bookings'].push({
		id: bookingId,
		created: '',
		updated: '',
		restaurant: 'rest1',
		customer: 'cust1',
		party_size: 2,
		starts_at: startsAt ?? new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
		ends_at: startsAt ?? new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
		tables: [],
		source: 'online',
		status
	});
	seedPayment({
		booking: bookingId,
		kind: 'noshow_hold',
		dojo_payment_intent_id: GUARANTEE_INTENT,
		status: 'Authorized',
		amount: 2000,
		// A card guarantee has never been captured — seedPayment's default stamps a
		// captured_at that would make "was this card charged?" assertions meaningless.
		captured_at: ''
	});
}

describe('chargeNoShowFee — a guest who attended is never billed', () => {
	// The live bug this guards: isLateCancellation is `startsAt - now < 12h`, which
	// is true for the WHOLE PAST — so cancelling a finished sitting took the "late"
	// branch and charged the card that releaseHold() deliberately leaves on file
	// after an honoured guarantee. A guest with a still-valid manage link could
	// trigger a real charge against themselves months later.
	it.each(['completed', 'seated'])('refuses to charge a %s booking', async (status) => {
		seedGuarantee(`bk_${status}`, status);
		await chargeNoShowFee(`bk_${status}`);
		expect(chargeGuarantee).not.toHaveBeenCalled();
		const p = store['geisha_payments'].find((r) => r.booking === `bk_${status}`);
		expect(p?.status).toBe('Authorized'); // untouched
	});

	it('still charges a genuine no-show when asked to', async () => {
		seedGuarantee('bk_noshow', 'no_show');
		await chargeNoShowFee('bk_noshow');
		expect(chargeGuarantee).toHaveBeenCalledTimes(1);
		const p = store['geisha_payments'].find((r) => r.booking === 'bk_noshow');
		expect(p?.captured_at).toBeTruthy();
	});
});

// THE POINT OF THE WHOLE CHANGE (ResDiary parity). ResDiary's cancellation
// reasons have no charge flag: cancelling never bills a card, and its two "Card
// Manually Charged" reasons exist because a human took the fee separately. Ours
// billed off the clock, so correcting a booking made against the wrong brand
// charged the guest £20 with no way to stop it.
describe('cancelling / no-showing never charges a filed card', () => {
	it('leaves the card on file when cancelling inside the late window', async () => {
		seedGuarantee('bk_late', 'confirmed', new Date(Date.now() + 2 * 3600 * 1000).toISOString());

		await cancelBooking('bk_late', 'staff', { reason: 'operator_error' });
		await flushDeferred();

		expect(chargeGuarantee).not.toHaveBeenCalled();
		const p = store['geisha_payments'].find((r) => r.booking === 'bk_late');
		// On file and untouched — a manager can still charge it deliberately.
		expect(p?.status).toBe('Authorized');
		expect(p?.captured_at).toBeFalsy();
	});

	// A booking in the past is "late" by every clock test there is, which is how a
	// finished sitting used to get billed.
	it('leaves the card on file when cancelling a booking in the past', async () => {
		seedGuarantee('bk_past', 'confirmed', new Date(Date.now() - 48 * 3600 * 1000).toISOString());

		await cancelBooking('bk_past', 'staff', { reason: 'change_of_plans' });
		await flushDeferred();

		expect(chargeGuarantee).not.toHaveBeenCalled();
		expect(store['geisha_payments'].find((r) => r.booking === 'bk_past')?.status).toBe('Authorized');
	});

	it('leaves the card on file when marking a no-show', async () => {
		seedGuarantee('bk_ns', 'confirmed');

		await markNoShow('bk_ns', 'staff');
		await flushDeferred();

		expect(chargeGuarantee).not.toHaveBeenCalled();
		expect(store['geisha_payments'].find((r) => r.booking === 'bk_ns')?.status).toBe('Authorized');
		// The booking still lands on the no-show report — only the money changed.
		expect(store['geisha_bookings'].find((b) => b.id === 'bk_ns')?.status).toBe('no_show');
	});

	// The other half of the line: an already-PAID deposit is not a charge. Keeping
	// it moves no money, and it is the policy the guest agreed to at booking, so a
	// late cancel must still forfeit it rather than quietly hand it back.
	it('still forfeits an already-captured deposit on a late cancel', async () => {
		const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
		store['geisha_bookings'].push({
			id: 'bk_dep', created: '', updated: '', restaurant: 'rest1', customer: 'cust1',
			party_size: 6, starts_at: soon, ends_at: soon, tables: [], status: 'confirmed', source: 'online'
		});
		seedPayment({ booking: 'bk_dep', kind: 'deposit', status: 'Captured', amount: 6000 });

		await cancelBooking('bk_dep', 'staff', { reason: 'change_of_plans' });
		await flushDeferred();

		expect(refundPaymentIntent).not.toHaveBeenCalled();
		expect(store['geisha_payments'].find((r) => r.booking === 'bk_dep')?.status).toBe('Captured');
	});

	it('settleNoShowMoney reports a forfeited deposit but never a captured fee', async () => {
		seedGuarantee('bk_card', 'confirmed');
		expect(await settleNoShowMoney('bk_card')).toMatchObject({ kind: 'none' });

		seedPayment({ booking: 'bk_dep2', kind: 'deposit', status: 'Captured', amount: 6000 });
		expect(await settleNoShowMoney('bk_dep2')).toMatchObject({
			kind: 'deposit_forfeited',
			amountPence: 6000
		});
		expect(chargeGuarantee).not.toHaveBeenCalled();
	});
});

describe('chargeNoShowManual — the only route that bills a card', () => {
	it('charges the filed card and audits who did it', async () => {
		seedGuarantee('bk_m1', 'no_show');

		const res = await chargeNoShowManual('bk_m1', 'Guest did not arrive.', 'staff', 'staff_7');

		expect(res.outcome).toBe('charged');
		expect(chargeGuarantee).toHaveBeenCalledTimes(1);
		const audit = audits('charge_no_show_manual');
		expect(audit).toHaveLength(1);
		expect(audit[0].on_behalf_of ?? audit[0].onBehalfOf).toBeTruthy();
	});

	it('refuses a booking whose guest attended, and writes no audit', async () => {
		seedGuarantee('bk_m2', 'completed');

		const res = await chargeNoShowManual('bk_m2', 'Oops.', 'staff');

		expect(res.outcome).toBe('skipped');
		expect(chargeGuarantee).not.toHaveBeenCalled();
		expect(audits('charge_no_show_manual')).toHaveLength(0);
	});

	it('refuses a deposit booking — that money has already been paid', async () => {
		seedPayment({ booking: 'bk_m3', kind: 'deposit', status: 'Captured', amount: 6000 });

		const res = await chargeNoShowManual('bk_m3', 'Fee.', 'staff');

		expect(res.outcome).toBe('skipped');
		expect(res.reason).toContain('deposit');
		expect(chargeGuarantee).not.toHaveBeenCalled();
	});

	it('is a no-op with no payment on the booking', async () => {
		store['geisha_bookings'].push({
			id: 'bk_m4', created: '', updated: '', restaurant: 'rest1', customer: 'cust1', status: 'no_show'
		});
		expect((await chargeNoShowManual('bk_m4', 'Fee.', 'staff')).outcome).toBe('skipped');
		expect(chargeGuarantee).not.toHaveBeenCalled();
	});
});

describe('cancelBooking — §6 in-time deposit refund', () => {
	function seedBooking(id: string, startsAt: string) {
		store['geisha_bookings'].push({
			id, created: '', updated: '', restaurant: 'rest1', customer: 'cust1',
			party_size: 6, starts_at: startsAt, ends_at: startsAt, tables: [],
			status: 'confirmed', source: 'online'
		});
	}

	it('refunds a captured deposit when cancelled in good time (≥8h before)', async () => {
		const far = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
		seedBooking('bkA', far);
		seedPayment({ booking: 'bkA', kind: 'deposit', status: 'Captured', amount: 6000 });

		await cancelBooking('bkA', 'staff');
		await flushDeferred(); // the refund now runs off the response
		expect(refundPaymentIntent).toHaveBeenCalledTimes(1);
		expect(refundPaymentIntent).toHaveBeenCalledWith(
			DEPOSIT_INTENT,
			6000,
			expect.stringContaining('refund-'),
			expect.any(String),
			'asia'
		);
		const p = store['geisha_payments'].find((r) => r.booking === 'bkA');
		expect(p?.status).toBe('Refunded');
	});

	it('does NOT refund the deposit on a late (<8h) cancellation', async () => {
		const soon = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
		seedBooking('bkB', soon);
		seedPayment({ booking: 'bkB', kind: 'deposit', status: 'Captured', amount: 6000 });

		await cancelBooking('bkB', 'staff');
		await flushDeferred(); // the (skipped) refund path now runs off the response
		expect(refundPaymentIntent).not.toHaveBeenCalled();
		const p = store['geisha_payments'].find((r) => r.booking === 'bkB');
		expect(p?.status).toBe('Captured'); // forfeited, not refunded
	});
});

// ---------------------------------------------------------------------------
// A refund records WHEN the money went back.
//
// The deposit report's "by payment date" view dates a refund by reversed_at, the
// way Stripe dates it. Until 21 Sep 2026 no refund path stamped it, so a refund
// had no date of its own and the view could not match Stripe's refunds.
// ---------------------------------------------------------------------------

describe('refunds record when the money went back', () => {
	const WHEN = '2026-09-19T22:45:32.000Z';
	const rowOf = (id: string) => store['geisha_payments'].find((r) => r.id === id);

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(WHEN));
	});
	afterEach(() => vi.useRealTimers());

	it('stamps a manager refund', async () => {
		const p = seedPayment({ booking: 'bkR1', status: 'Captured' });
		await refundDepositManual('bkR1', 'full', 'goodwill', 'staff');
		expect(rowOf(p.id)?.reversed_at).toBe(WHEN);
	});

	it('stamps the refund made when a guest cancels in good time', async () => {
		const p = seedPayment({ booking: 'bkR2', status: 'Captured' });
		const row = store['geisha_bookings'].find((b) => b.id === 'bkR2')!;
		const far = new Date(Date.parse(WHEN) + 48 * 3600 * 1000).toISOString();
		Object.assign(row, { party_size: 6, starts_at: far, ends_at: far, tables: [], status: 'confirmed', source: 'online' });

		await cancelBooking('bkR2', 'staff');
		await flushDeferred();
		expect(rowOf(p.id)?.status).toBe('Refunded');
		expect(rowOf(p.id)?.reversed_at).toBe(WHEN);
	});

	it('stamps a refund Stripe reports to us, e.g. one made in the Stripe dashboard', async () => {
		const p = seedPayment({ booking: 'bkR3', status: 'Captured' });
		await confirmPaidBooking(p, 'Refunded');
		expect(rowOf(p.id)?.status).toBe('Refunded');
		expect(rowOf(p.id)?.reversed_at).toBe(WHEN);
	});

	it('keeps the first time when our refund and Stripe’s webhook both report it', async () => {
		const p = seedPayment({ booking: 'bkR4', status: 'Captured' });
		await refundDepositManual('bkR4', 'full', 'goodwill', 'staff');

		vi.setSystemTime(new Date('2026-09-19T22:45:40.000Z'));
		await confirmPaidBooking(rowOf(p.id) as unknown as Payment, 'Refunded');
		expect(rowOf(p.id)?.reversed_at).toBe(WHEN);
	});
});
