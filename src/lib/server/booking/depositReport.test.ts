// Unit tests for the PURE deposit-report aggregation (bucketDeposits). No PB /
// Stripe — the live-status refresh + fetch layer in depositReport.ts is not
// exercised here; we feed it already-joined rows with a resolved status.

import { describe, it, expect } from 'vitest';
import {
	bucketDeposits,
	bucketPaidDeposits,
	resolveDisplayStatus,
	type JoinedDeposit,
	type PaidJoined
} from './depositReport.js';
import type { Booking, BrandId, Payment } from '../db/types.js';
import { bookingReference } from '$lib/bookings/reference.js';

const TZ = 'Europe/London';

function payment(over: Partial<Payment> & { id: string }): Payment {
	return {
		created: '2026-06-27T12:00:00Z',
		updated: '2026-06-27T12:00:00Z',
		booking: 'b1',
		dojo_payment_intent_id: 'pi_' + over.id,
		kind: 'deposit',
		amount: 2000,
		status: 'Captured',
		captured_at: '2026-06-27T12:00:00Z',
		reversed_at: '',
		...over
	} as Payment;
}

function booking(over: Partial<Booking> & { id: string; starts_at: string }): Booking {
	return {
		created: '',
		updated: '',
		restaurant: 'r1',
		customer: 'c1',
		party_size: 4,
		ends_at: over.starts_at,
		tables: [],
		service_period: 'dinner',
		status: 'confirmed',
		source: 'online',
		special_requests: '',
		occasion: '',
		...over
	} as Booking;
}

/** Join a payment + booking with a resolved live status (as the I/O layer would). */
function joined(
	p: Payment,
	b: Booking | null,
	extra: Partial<JoinedDeposit> = {}
): JoinedDeposit {
	return {
		payment: p,
		booking: b,
		guest: b ? 'Jane Doe' : '',
		periodName: 'Dinner',
		liveStatus: '',
		live: false,
		...extra
	};
}

function run(rows: JoinedDeposit[], options = {}) {
	return bucketDeposits({
		brand: 'asia',
		from: '2026-06-01',
		to: '2026-06-30',
		timezone: TZ,
		providerConfigured: true,
		joined: rows,
		options
	});
}

describe('bucketDeposits — totals + breakdowns', () => {
	it('sums gross/captured/held/refunded and groups by status/method/period', () => {
		const rows = [
			joined(payment({ id: '1', kind: 'deposit', amount: 4000, status: 'Captured' }), booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z' })),
			joined(payment({ id: '2', kind: 'noshow_hold', amount: 2000, status: 'Authorized' }), booking({ id: 'b2', starts_at: '2026-06-28T19:00:00Z' })),
			joined(payment({ id: '3', kind: 'deposit', amount: 1000, status: 'Refunded' }), booking({ id: 'b3', starts_at: '2026-06-29T20:00:00Z' }))
		];
		const rep = run(rows);

		expect(rep.totals.count).toBe(3);
		expect(rep.totals.grossPence).toBe(7000);
		expect(rep.totals.capturedPence).toBe(4000);
		expect(rep.totals.heldPence).toBe(2000);
		expect(rep.totals.refundedPence).toBe(1000);

		expect(rep.byMethod.find((m) => m.kind === 'deposit')?.amountPence).toBe(5000);
		expect(rep.byMethod.find((m) => m.kind === 'noshow_hold')?.count).toBe(1);
		expect(rep.byStatus.find((s) => s.status === 'Captured')?.count).toBe(1);
		expect(rep.byPeriod.find((p) => p.periodName === 'Dinner')?.count).toBe(3);
	});

	it('prefers the live status over the stored one when present', () => {
		// Stored says Authorized, but Stripe now reports Captured.
		const rows = [
			joined(
				payment({ id: '1', status: 'Authorized', kind: 'noshow_hold', amount: 1500 }),
				booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z' }),
				{ liveStatus: 'Captured', live: true }
			)
		];
		const rep = run(rows);
		expect(rep.rows[0].status).toBe('Captured');
		expect(rep.totals.capturedPence).toBe(1500);
		expect(rep.totals.heldPence).toBe(0);
	});

	it('sorts details newest booking first', () => {
		const rows = [
			joined(payment({ id: 'old' }), booking({ id: 'b1', starts_at: '2026-06-20T18:00:00Z' })),
			joined(payment({ id: 'new' }), booking({ id: 'b2', starts_at: '2026-06-29T18:00:00Z' }))
		];
		const rep = run(rows);
		expect(rep.rows.map((r) => r.paymentId)).toEqual(['new', 'old']);
	});
});

describe('bucketDeposits — filters', () => {
	const base = () => [
		joined(payment({ id: 'dep', kind: 'deposit', status: 'Captured' }), booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z', status: 'completed' })),
		joined(payment({ id: 'hold', kind: 'noshow_hold', status: 'Authorized' }), booking({ id: 'b2', starts_at: '2026-06-28T18:00:00Z', status: 'confirmed' })),
		joined(payment({ id: 'canc', kind: 'deposit', status: 'Refunded' }), booking({ id: 'b3', starts_at: '2026-06-29T18:00:00Z', status: 'cancelled' }))
	];

	it('excludes cancelled/no-show bookings by default', () => {
		const rep = run(base());
		expect(rep.rows.map((r) => r.paymentId).sort()).toEqual(['dep', 'hold']);
	});

	it('includes cancelled bookings when asked', () => {
		const rep = run(base(), { includeCancelled: true });
		expect(rep.rows).toHaveLength(3);
	});

	it('filters by payment method', () => {
		const rep = run(base(), { method: 'noshow_hold', includeCancelled: true });
		expect(rep.rows.map((r) => r.paymentId)).toEqual(['hold']);
	});

	it('filters by (display) status', () => {
		const rep = run(base(), { status: 'Captured', includeCancelled: true });
		expect(rep.rows.map((r) => r.paymentId)).toEqual(['dep']);
	});

	it('still shows money taken and kept on a cancelled or no-show booking', () => {
		// The money is in the bank whatever happened to the table. Hiding it made the
		// report read short of Stripe by every deposit a guest forfeited.
		const at = '2026-06-27T18:00:00Z';
		const rep = run([
			joined(payment({ id: 'kept', kind: 'deposit', status: 'Captured' }), booking({ id: 'b1', starts_at: at, status: 'cancelled' })),
			joined(payment({ id: 'fee', kind: 'noshow_hold', status: 'Captured' }), booking({ id: 'b2', starts_at: at, status: 'no_show' })),
			// Stored as unpaid, but Stripe says the guest paid after the hold lapsed.
			joined(payment({ id: 'late', kind: 'deposit', status: 'Created', captured_at: '' }), booking({ id: 'b3', starts_at: at, status: 'cancelled' }), { liveStatus: 'Captured', live: true }),
			// Nothing was ever taken on these two, so they stay out of the default view.
			joined(payment({ id: 'lapsed', kind: 'deposit', status: 'Created', captured_at: '' }), booking({ id: 'b4', starts_at: at, status: 'cancelled' })),
			joined(payment({ id: 'card', kind: 'noshow_hold', status: 'Authorized', captured_at: '' }), booking({ id: 'b5', starts_at: at, status: 'no_show' }))
		]);
		expect(rep.rows.map((r) => r.paymentId).sort()).toEqual(['fee', 'kept', 'late']);
		expect(rep.totals.capturedPence).toBe(6000);
	});
});

// ---------------------------------------------------------------------------
// By PAYMENT date — the view that matches Stripe.
//
// 21 Sep 2026: the owner's Monday check had Stripe at £740 for 14–20 Sep and this
// report at £700, because the report counted deposits by the day the guest VISITS
// while Stripe counts them by the day the card was CHARGED. Both were right; they
// answered different questions. This view answers Stripe's.
// ---------------------------------------------------------------------------

describe('bucketPaidDeposits — counted on the day the money moved', () => {
	const WEEK = { from: '2026-09-14', to: '2026-09-20' };

	function paid(rows: PaidJoined[], range: { from: string; to: string } = WEEK) {
		return bucketPaidDeposits({ ...range, timezone: TZ, joined: rows });
	}

	function pj(p: Payment, b: Booking | null, brand: BrandId | '' = 'asia'): PaidJoined {
		return { payment: p, booking: b, brand, guest: b ? 'Jane Doe' : '' };
	}

	it('counts a deposit on the day the card was charged, not the day of the visit', () => {
		const rep = paid([
			// Paid in the week for a table in October: Stripe counts it this week.
			pj(payment({ id: 'later', amount: 7000, captured_at: '2026-09-19 10:12:00.000Z' }), booking({ id: 'b1', starts_at: '2026-10-03T17:00:00Z' })),
			// Paid the week before for a table this week: Stripe counted it last week.
			pj(payment({ id: 'earlier', amount: 6000, captured_at: '2026-09-10 16:32:22.492Z' }), booking({ id: 'b2', starts_at: '2026-09-18T18:30:00Z' }))
		]);
		expect(rep.rows.map((r) => r.paymentId)).toEqual(['later']);
		expect(rep.totals.takenPence).toBe(7000);
	});

	it('keeps money taken on a booking that was later cancelled or became a no-show', () => {
		const rep = paid([
			pj(payment({ id: 'c', amount: 6000, captured_at: '2026-09-15 09:00:00.000Z' }), booking({ id: 'b1', starts_at: '2026-09-16T18:00:00Z', status: 'cancelled' })),
			pj(payment({ id: 'n', amount: 8000, captured_at: '2026-09-16 09:00:00.000Z' }), booking({ id: 'b2', starts_at: '2026-09-17T18:00:00Z', status: 'no_show' }))
		]);
		expect(rep.totals.takenPence).toBe(14000);
	});

	it('never counts a card on file, or a deposit nobody paid, as money', () => {
		// Both rows were created and touched inside the week — only a capture counts.
		const touched = { created: '2026-09-16 10:00:00.000Z', updated: '2026-09-16 10:15:00.000Z' };
		const rep = paid([
			pj(payment({ id: 'card', kind: 'noshow_hold', status: 'Authorized', amount: 5000, captured_at: '', dojo_payment_intent_id: 'seti_card', ...touched }), booking({ id: 'b1', starts_at: '2026-09-16T18:00:00Z' })),
			pj(payment({ id: 'unpaid', status: 'Created', amount: 6000, captured_at: '', ...touched }), booking({ id: 'b2', starts_at: '2026-09-16T18:00:00Z', status: 'cancelled' })),
			pj(payment({ id: 'dropped', status: 'Canceled', amount: 6000, captured_at: '', reversed_at: '2026-09-16 10:15:00.000Z', ...touched }), booking({ id: 'b3', starts_at: '2026-09-16T18:00:00Z', status: 'cancelled' }))
		]);
		expect(rep.rows).toEqual([]);
		expect(rep.totals).toEqual({ payments: 0, refunds: 0, takenPence: 0, refundedPence: 0, netPence: 0 });
	});

	it('leaves out deposits copied in from ResDiary — ResDiary charged those, on its own dates', () => {
		// Two such rows exist (Fusion, £70 + £60), stamped with the IMPORT time, 7 Aug
		// 2026. Counting them made that week £130 higher than Stripe's.
		const rep = paid(
			[
				pj(payment({ id: 'imported', amount: 7000, captured_at: '2026-08-07 12:52:06.000Z', dojo_payment_intent_id: 'resdiary_external_83a3' }), booking({ id: 'b1', starts_at: '2026-08-15T18:00:00Z' }), 'fusion'),
				pj(payment({ id: 'ours', amount: 6000, captured_at: '2026-08-09 09:56:24.115Z', dojo_payment_intent_id: 'pi_3U2TR7' }), booking({ id: 'b2', starts_at: '2026-08-16T18:00:00Z' }), 'fusion')
			],
			{ from: '2026-08-03', to: '2026-08-09' }
		);
		expect(rep.rows.map((r) => r.paymentId)).toEqual(['ours']);
		expect(rep.totals.takenPence).toBe(6000);
	});

	it('counts a no-show fee charged on a card guarantee as money in', () => {
		const rep = paid([
			pj(payment({ id: 'fee', kind: 'noshow_hold', status: 'Captured', amount: 2000, captured_at: '2026-09-17 11:00:00.000Z', dojo_payment_intent_id: 'seti_fee' }), booking({ id: 'b1', starts_at: '2026-09-16T18:00:00Z', status: 'no_show' }))
		]);
		expect(rep.totals.takenPence).toBe(2000);
		expect(rep.rows[0].description).toBe('No-show fee');
	});

	it('reports a refund on the day it was given back, apart from the original charge', () => {
		// Paid £60 on 11 Sep, refunded 19 Sep at 23:45 UK time.
		const p = payment({ id: 'ref', status: 'Refunded', amount: 6000, captured_at: '2026-09-11 12:28:36.342Z', reversed_at: '2026-09-19 22:45:32.000Z' });
		const b = booking({ id: 'b1', starts_at: '2026-10-03T16:45:00Z', status: 'cancelled' });

		const week = paid([pj(p, b)]);
		expect(week.totals).toEqual({ payments: 0, refunds: 1, takenPence: 0, refundedPence: 6000, netPence: -6000 });
		expect(week.rows.map((r) => [r.type, r.date])).toEqual([['refunded', '2026-09-19']]);

		const weekBefore = paid([pj(p, b)], { from: '2026-09-07', to: '2026-09-13' });
		expect(weekBefore.totals).toEqual({ payments: 1, refunds: 0, takenPence: 6000, refundedPence: 0, netPence: 6000 });
	});

	it('dates a refund made before refund times were stored by when its row last changed', () => {
		const p = payment({ id: 'old', status: 'Refunded', amount: 6000, captured_at: '2026-09-11 12:28:36.342Z', reversed_at: '', updated: '2026-09-19 22:45:32.614Z' });
		const rep = paid([pj(p, booking({ id: 'b1', starts_at: '2026-10-03T16:45:00Z', status: 'cancelled' }))]);
		expect(rep.totals.refundedPence).toBe(6000);
		expect(rep.rows[0].date).toBe('2026-09-19');
	});

	it('lists both the charge and the refund when both fall inside the dates, newest first', () => {
		const p = payment({ id: 'both', status: 'Refunded', amount: 6000, captured_at: '2026-09-15 10:00:00.000Z', reversed_at: '2026-09-17 10:00:00.000Z' });
		const rep = paid([pj(p, booking({ id: 'b1', starts_at: '2026-09-25T18:00:00Z', status: 'cancelled' }))]);
		expect(rep.totals).toEqual({ payments: 1, refunds: 1, takenPence: 6000, refundedPence: 6000, netPence: 0 });
		expect(rep.rows.map((r) => r.type)).toEqual(['refunded', 'taken']);
	});

	it('uses UK days: a charge at 00:30 BST belongs to the new day', () => {
		const rep = paid([
			// 23:30 UTC Sun 13 Sep = 00:30 BST Mon 14 Sep → inside.
			pj(payment({ id: 'in', amount: 6000, captured_at: '2026-09-13 23:30:00.000Z' }), booking({ id: 'b1', starts_at: '2026-09-20T18:00:00Z' })),
			// 23:30 UTC Sun 20 Sep = 00:30 BST Mon 21 Sep → outside.
			pj(payment({ id: 'out', amount: 7000, captured_at: '2026-09-20 23:30:00.000Z' }), booking({ id: 'b2', starts_at: '2026-09-27T18:00:00Z' }))
		]);
		expect(rep.rows.map((r) => [r.paymentId, r.date])).toEqual([['in', '2026-09-14']]);
	});

	it('totals both restaurants, as their one Stripe account does, and splits them', () => {
		const rep = paid([
			pj(payment({ id: 'a', amount: 6000, captured_at: '2026-09-15 10:00:00.000Z' }), booking({ id: 'b1', starts_at: '2026-09-18T18:00:00Z' }), 'asia'),
			// A booking deleted since: the money still arrived, so it still counts.
			pj(payment({ id: 'x', amount: 2000, captured_at: '2026-09-18 10:00:00.000Z' }), null, '')
		]);
		expect(rep.totals.takenPence).toBe(8000);
		// Fusion is listed even on a week it took nothing, so the table never changes shape.
		expect(rep.byBrand.map((b) => [b.label, b.takenPence])).toEqual([
			['Asia', 6000],
			['Fusion', 0],
			['Unknown', 2000]
		]);
	});

	it('adds up each day, so the week can be ticked off against Stripe day by day', () => {
		const rep = paid([
			pj(payment({ id: '1', amount: 7000, captured_at: '2026-09-15 05:37:26.628Z' }), booking({ id: 'b1', starts_at: '2026-09-17T18:00:00Z' })),
			pj(payment({ id: '2', amount: 2000, captured_at: '2026-09-15 12:37:01.465Z' }), booking({ id: 'b2', starts_at: '2026-10-24T11:30:00Z' })),
			pj(payment({ id: '3', status: 'Refunded', amount: 6000, captured_at: '2026-09-11 12:28:36.342Z', reversed_at: '2026-09-19 22:45:32.000Z' }), booking({ id: 'b3', starts_at: '2026-10-03T16:45:00Z', status: 'cancelled' }))
		]);
		expect(rep.byDay).toEqual([
			{ date: '2026-09-15', payments: 2, refunds: 0, takenPence: 9000, refundedPence: 0, netPence: 9000 },
			{ date: '2026-09-19', payments: 0, refunds: 1, takenPence: 0, refundedPence: 6000, netPence: -6000 }
		]);
	});

	it('carries who, which restaurant and which visit onto each line', () => {
		const b = booking({ id: 'bk-ref', starts_at: '2026-10-03T17:00:00Z', party_size: 6, status: 'confirmed' });
		const rep = paid([
			{
				payment: payment({ id: 'p1', booking: 'bk-ref', amount: 7000, captured_at: '2026-09-19 10:12:00.000Z' }),
				booking: b,
				brand: 'asia',
				guest: 'Jake Adamson',
				phone: '07700 900123'
			}
		]);
		expect(rep.rows[0]).toMatchObject({
			type: 'taken',
			brand: 'asia',
			guest: 'Jake Adamson',
			phone: '07700 900123',
			date: '2026-09-19',
			time: '11:12', // 10:12 UTC is 11:12 BST
			visitDate: '2026-10-03',
			visitTime: '18:00',
			partySize: 6,
			amountPence: 7000,
			bookingStatus: 'confirmed'
		});
		expect(rep.rows[0].reference).not.toBe('bk-ref');
		expect(rep.rows[0].reference).toBe(bookingReference('bk-ref'));
	});

	it('reproduces Stripe for 14–20 Sep 2026: £740 in, £60 back', () => {
		// The real rows behind the 21 Sep complaint: [captured_at, pence, brand, visit,
		// booking status, payment status, refund time]. Stripe's payments list for the
		// week summed to £740 (Asia £600 + Fusion £140) with one £60 refund.
		const REAL: Array<[string, number, BrandId, string, Booking['status'], string, string]> = [
			['2026-09-10 16:32:22.492Z', 6000, 'asia', '2026-09-18T18:30:00Z', 'seated', 'Captured', ''],
			['2026-09-10 17:50:21.458Z', 6000, 'asia', '2026-09-11T17:15:00Z', 'seated', 'Captured', ''],
			['2026-09-11 08:25:20.064Z', 7000, 'asia', '2026-09-12T18:30:00Z', 'seated', 'Captured', ''],
			['2026-09-11 12:28:36.342Z', 6000, 'asia', '2026-10-03T16:45:00Z', 'cancelled', 'Refunded', '2026-09-19 22:45:32.614Z'],
			['2026-09-11 13:07:12.607Z', 8000, 'asia', '2026-09-19T13:45:00Z', 'completed', 'Captured', ''],
			['2026-09-11 14:19:16.996Z', 6000, 'fusion', '2026-09-18T18:30:00Z', 'seated', 'Captured', ''],
			['2026-09-13 13:59:48.814Z', 6000, 'fusion', '2026-09-13T16:30:00Z', 'seated', 'Captured', ''],
			['2026-09-14 17:03:21.231Z', 6000, 'asia', '2026-09-15T17:30:00Z', 'completed', 'Captured', ''],
			['2026-09-15 05:37:26.628Z', 7000, 'asia', '2026-09-17T18:00:00Z', 'seated', 'Captured', ''],
			['2026-09-15 12:37:01.465Z', 2000, 'asia', '2026-10-24T11:30:00Z', 'confirmed', 'Captured', ''],
			['2026-09-15 14:05:26.321Z', 6000, 'asia', '2026-09-18T18:00:00Z', 'seated', 'Captured', ''],
			['2026-09-15 17:48:11.530Z', 6000, 'asia', '2026-09-16T18:00:00Z', 'seated', 'Captured', ''],
			['2026-09-16 18:20:37.378Z', 6000, 'fusion', '2026-09-20T12:30:00Z', 'seated', 'Captured', ''],
			['2026-09-17 08:40:42.147Z', 7000, 'asia', '2026-09-17T18:15:00Z', 'completed', 'Captured', ''],
			['2026-09-17 20:51:44.875Z', 8000, 'fusion', '2026-10-03T19:00:00Z', 'confirmed', 'Captured', ''],
			['2026-09-18 13:42:29.549Z', 7000, 'asia', '2026-09-27T18:15:00Z', 'confirmed', 'Captured', ''],
			['2026-09-19 14:45:43.687Z', 6000, 'asia', '2026-09-20T13:00:00Z', 'completed', 'Captured', ''],
			['2026-09-19 18:57:54.583Z', 7000, 'asia', '2026-10-03T17:00:00Z', 'confirmed', 'Captured', ''],
			['2026-09-20 11:01:50.068Z', 6000, 'asia', '2026-09-21T11:30:00Z', 'confirmed', 'Captured', '']
		];
		const rows = REAL.map(([capturedAt, amount, brand, visit, bookingStatus, status, refundedAt], i) =>
			pj(
				payment({
					id: `real${i}`,
					booking: `bk${i}`,
					amount,
					status: status as Payment['status'],
					captured_at: capturedAt,
					reversed_at: '',
					// Rows refunded before this fix carry no reversed_at; their last
					// update IS the refund, as it was for this one.
					updated: refundedAt || capturedAt
				}),
				booking({ id: `bk${i}`, starts_at: visit, status: bookingStatus }),
				brand
			)
		);
		const rep = paid(rows);
		expect(rep.totals).toEqual({ payments: 12, refunds: 1, takenPence: 74000, refundedPence: 6000, netPence: 68000 });
		expect(rep.byBrand.map((b) => [b.label, b.takenPence])).toEqual([
			['Asia', 60000],
			['Fusion', 14000]
		]);
	});
});

// ---------------------------------------------------------------------------
// Regression: the live Stripe status must not overwrite a terminal state of ours.
//
// Both cases below were observed against the real system on 6 Aug 2026 and both
// made the report misstate money — in opposite directions.
// ---------------------------------------------------------------------------

describe('live provider status vs our own terminal states', () => {
	it('keeps Refunded when the PaymentIntent still reads succeeded', () => {
		// Refunding leaves the intent at `succeeded`; the refund is a separate object.
		// mapStatus('payment_intent','succeeded') = 'Captured', which used to win and
		// report a refunded £60 as money in the bank.
		expect(resolveDisplayStatus('Refunded', 'Captured')).toBe('Refunded');

		const p = payment({ id: 'ref60', kind: 'deposit', amount: 6000, status: 'Refunded' });
		const b = booking({ id: 'b1', starts_at: '2026-08-29T12:00:00Z', status: 'cancelled' });
		const rep = run([joined(p, b, { liveStatus: 'Captured', live: true })], {
			includeCancelled: true
		});

		expect(rep.rows[0].status).toBe('Refunded');
		expect(rep.totals.refundedPence).toBe(6000);
		expect(rep.totals.capturedPence).toBe(0);
		// It is our row talking, not Stripe's — don't badge it as live.
		expect(rep.rows[0].live).toBe(false);
	});

	it('keeps Captured for a no-show fee taken against a SetupIntent', () => {
		// The fee is charged on a NEW PaymentIntent; the row still points at the
		// SetupIntent, whose `succeeded` maps to 'Authorized'. That used to report a
		// fee we had actually taken as merely "held on the card".
		expect(resolveDisplayStatus('Captured', 'Authorized')).toBe('Captured');

		const p = payment({ id: 'fee20', kind: 'noshow_hold', amount: 2000, status: 'Captured' });
		const b = booking({ id: 'b2', starts_at: '2026-08-28T18:00:00Z', status: 'no_show' });
		const rep = run([joined(p, b, { liveStatus: 'Authorized', live: true })], {
			includeCancelled: true
		});

		expect(rep.rows[0].status).toBe('Captured');
		expect(rep.totals.capturedPence).toBe(2000);
		expect(rep.totals.heldPence).toBe(0);
	});

	it('STILL advances a payment we think is in flight', () => {
		// The refresh must keep doing its job: a webhook we missed should show up.
		expect(resolveDisplayStatus('Created', 'Captured')).toBe('Captured');
		expect(resolveDisplayStatus('Authorized', 'Captured')).toBe('Captured');
		expect(resolveDisplayStatus('', 'Authorized')).toBe('Authorized');

		const p = payment({ id: 'late', kind: 'deposit', amount: 5000, status: 'Created' });
		const b = booking({ id: 'b3', starts_at: '2026-08-29T18:00:00Z' });
		const rep = run([joined(p, b, { liveStatus: 'Captured', live: true })]);

		expect(rep.rows[0].status).toBe('Captured');
		expect(rep.totals.capturedPence).toBe(5000);
		expect(rep.rows[0].live).toBe(true);
	});

	it('falls back to the stored status when the provider lookup failed', () => {
		expect(resolveDisplayStatus('Authorized', '')).toBe('Authorized');
		expect(resolveDisplayStatus('Refunded', '')).toBe('Refunded');
	});
});

// ---------------------------------------------------------------------------
// ResDiary-parity Details columns — "who paid, and when".
//
// The Summary answers "how much"; the owner reconciles the Details table against
// ResDiary's deposit report, which puts the guest, their number, the booking ref
// and the payment date on one line. These pin the derived columns.
// ---------------------------------------------------------------------------

describe('Details columns (ResDiary parity)', () => {
	it('splits the visit into date + local time, and carries table labels through', () => {
		const rep = run([
			joined(payment({ id: 'p1' }), booking({ id: 'b1', starts_at: '2026-06-27T18:15:00Z' }), {
				tables: '13, 14'
			})
		]);
		const r = rep.rows[0];
		expect(r.date).toBe('2026-06-27');
		expect(r.time).toBe('19:15'); // BST — 18:15Z is 19:15 local
		expect(r.tables).toBe('13, 14');
	});

	it('prefers the number given for THIS booking over the account holder’s', () => {
		const rep = run([
			joined(
				payment({ id: 'p1' }),
				booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z', guest_phone: '07999 111222' })
			)
		]);
		expect(rep.rows[0].phone).toBe('07999 111222');
	});

	it('stamps the guest-quotable booking reference, not the raw id', () => {
		const rep = run([
			joined(payment({ id: 'p1', booking: 'b1' }), booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z' }))
		]);
		const ref = rep.rows[0].reference;
		expect(ref).toBeTruthy();
		expect(ref).not.toBe('b1');
	});

	it('maps the booking source to ResDiary’s channel words', () => {
		const chan = (source: Booking['source']) =>
			run([
				joined(payment({ id: 'p' + source }), booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z', source }))
			]).rows[0].channel;
		expect(chan('online')).toBe('Online');
		expect(chan('phone')).toBe('Internal');
		expect(chan('ai')).toBe('Internal');
		expect(chan('walkin')).toBe('Walk-in');
	});

	it('builds Comments from the guest note and the "N × promotion" tally', () => {
		const rep = run([
			joined(
				payment({ id: 'p1' }),
				booking({
					id: 'b1',
					starts_at: '2026-06-27T18:00:00Z',
					party_size: 6,
					promotion: 'Standard Booking',
					note_to_restaurant: '£70 dep'
				})
			)
		]);
		expect(rep.rows[0].comments).toBe('£70 dep · 6 × Standard Booking');
	});

	it('names the deposit after the promotion that charged it', () => {
		const withPromo = run([
			joined(
				payment({ id: 'p1', kind: 'deposit' }),
				booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z', promotion: 'Large booking' })
			)
		]).rows[0];
		expect(withPromo.description).toBe('Large booking deposit');

		const bare = run([
			joined(payment({ id: 'p2', kind: 'noshow_hold', status: 'Authorized' }), booking({ id: 'b2', starts_at: '2026-06-27T18:00:00Z' }))
		]).rows[0];
		expect(bare.description).toBe('Card guarantee');
	});

	it('reports money as TAKEN only on a capture — a hold is £0 of £X', () => {
		const captured = run([
			joined(payment({ id: 'p1', amount: 6000, status: 'Captured', captured_at: '2026-06-20T10:00:00Z' }), booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z' }))
		]).rows[0];
		expect(captured.takenPence).toBe(6000);
		expect(captured.paidAt).toBe('2026-06-20T10:00:00Z');

		const held = run([
			joined(
				payment({ id: 'p2', amount: 4000, status: 'Authorized', captured_at: '', created: '2026-06-21T09:00:00Z' }),
				booking({ id: 'b2', starts_at: '2026-06-27T18:00:00Z' })
			)
		]).rows[0];
		// The hold IS dated (when it was placed) but no money has moved.
		expect(held.takenPence).toBe(0);
		expect(held.paidAt).toBe('2026-06-21T09:00:00Z');
	});

	it('records when the booking was MADE, separately from the visit date', () => {
		const rep = run([
			joined(
				payment({ id: 'p1' }),
				booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z', created: '2026-06-01T09:30:00Z' })
			)
		]);
		expect(rep.rows[0].bookedAt).toBe('2026-06-01T09:30:00Z');
		expect(rep.rows[0].date).toBe('2026-06-27');
	});

	it('names the provider from the intent-id prefix, and nobody for a legacy stub', () => {
		const stripe = run([
			joined(payment({ id: 'p1', dojo_payment_intent_id: 'pi_abc' }), booking({ id: 'b1', starts_at: '2026-06-27T18:00:00Z' }))
		]).rows[0];
		expect(stripe.media).toBe('Stripe');

		const stub = run([
			joined(payment({ id: 'p2', dojo_payment_intent_id: 'stub_abc' }), booking({ id: 'b2', starts_at: '2026-06-27T18:00:00Z' }))
		]).rows[0];
		expect(stub.media).toBe('');
	});
});
