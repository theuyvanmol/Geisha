import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldExpireUnpaid } from './release.js';
import type { Booking } from '../db/types.js';

const start = '2026-06-01T18:00:00.000Z';

/** A hold as the sweep sees it. The start rides along to name the scenario; the
 *  predicate deliberately ignores it. */
const bk = (status: Booking['status'], starts_at: string, created: string) =>
	({ status, starts_at, created }) as Pick<Booking, 'status' | 'starts_at' | 'created'>;

// §S1-4: a pending_payment booking whose card step was abandoned is expired once it's
// older than unpaid_hold_minutes — before its start or after it. (After used to be left
// to the auto no-show, which was removed for ResDiary parity — see release.ts.)
describe('shouldExpireUnpaid (§S1-4 unpaid-hold timeout)', () => {
	const hold = 15;
	// service starts well in the future for the pure pre-start cases
	const futureStart = '2026-06-01T20:00:00.000Z';

	it('is true for a pending_payment hold older than the hold window (20 min, hold 15)', () => {
		const created = '2026-06-01T18:00:00.000Z';
		const now = new Date('2026-06-01T18:20:00.000Z'); // 20 min after created, start still future
		expect(shouldExpireUnpaid(bk('pending_payment', futureStart, created), now, hold)).toBe(true);
	});

	it('is false for a young pending_payment hold (5 min old, hold 15)', () => {
		const created = '2026-06-01T18:00:00.000Z';
		const now = new Date('2026-06-01T18:05:00.000Z');
		expect(shouldExpireUnpaid(bk('pending_payment', futureStart, created), now, hold)).toBe(false);
	});

	it('is false exactly at the hold cutoff (strictly greater required)', () => {
		const created = '2026-06-01T18:00:00.000Z';
		const now = new Date('2026-06-01T18:15:00.000Z'); // exactly hold minutes
		expect(shouldExpireUnpaid(bk('pending_payment', futureStart, created), now, hold)).toBe(false);
	});

	it('is false for a confirmed booking (never expire a paid/confirmed hold)', () => {
		const created = '2026-06-01T18:00:00.000Z';
		const now = new Date('2026-06-01T19:00:00.000Z');
		expect(shouldExpireUnpaid(bk('confirmed', futureStart, created), now, hold)).toBe(false);
	});

	it('still expires an abandoned hold once its start has passed', () => {
		// created long ago AND past start: nothing else will clear it any more.
		const created = '2026-06-01T17:00:00.000Z';
		const now = new Date('2026-06-01T18:30:00.000Z'); // past `start`
		expect(shouldExpireUnpaid(bk('pending_payment', start, created), now, hold)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// runReleaseSweep integration: the pure predicate drives the one PB query; here we
// stub PB + the mutations to assert the sweep routes each candidate correctly and
// returns { checked, expired[] }.
// ---------------------------------------------------------------------------

const markNoShow = vi.fn();
const expireUnpaidHold = vi.fn();

vi.mock('./mutate.js', () => ({
	markNoShow: (...a: unknown[]) => markNoShow(...a),
	expireUnpaidHold: (...a: unknown[]) => expireUnpaidHold(...a)
}));

// queries used by the sweep: getRestaurant + getSettings are stubbed; the real
// toPbDateFilter is kept (it's pure) so the filter-bound code path runs.
vi.mock('./queries.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./queries.js')>();
	return {
		...actual,
		getRestaurant: vi.fn(async () => ({ id: 'rest_asia' })),
		getSettings: vi.fn(async () => ({ release_after_minutes: 20, unpaid_hold_minutes: 15 }))
	};
});

// PB stub: the sweep makes one getFullList call (the unpaid holds).
const getFullList = vi.fn();
vi.mock('../db/pb.js', () => ({
	pb: async () => ({ collection: () => ({ getFullList }) })
}));

describe('runReleaseSweep', () => {
	beforeEach(() => {
		markNoShow.mockReset();
		expireUnpaidHold.mockReset();
		getFullList.mockReset();
	});

	it('expires a stale unpaid hold and reports it in `expired`', async () => {
		const { runReleaseSweep } = await import('./release.js');
		const now = new Date('2026-06-01T18:30:00.000Z');

		getFullList.mockResolvedValueOnce([
			{
				id: 'bk_unpaid',
				status: 'pending_payment',
				starts_at: '2026-06-01T20:00:00.000Z',
				created: '2026-06-01T18:00:00.000Z'
			}
		]);
		// expireUnpaidHold returns the cancelled booking (it actually cancelled)
		expireUnpaidHold.mockResolvedValueOnce({ id: 'bk_unpaid', status: 'cancelled' });

		const res = await runReleaseSweep('asia', now);

		expect(expireUnpaidHold).toHaveBeenCalledWith('bk_unpaid', 'system');
		expect(res.expired).toEqual(['bk_unpaid']);
		expect(res.checked).toBe(1);
	});

	it('does not report an id whose expiry was raced away (status still pending_payment)', async () => {
		const { runReleaseSweep } = await import('./release.js');
		const now = new Date('2026-06-01T18:30:00.000Z');

		getFullList.mockResolvedValueOnce([
			{
				id: 'bk_paid_just_in_time',
				status: 'pending_payment',
				starts_at: '2026-06-01T20:00:00.000Z',
				created: '2026-06-01T18:00:00.000Z'
			}
		]);
		// TOCTOU: webhook confirmed it first; expireUnpaidHold no-ops, returns it unchanged
		expireUnpaidHold.mockResolvedValueOnce({ id: 'bk_paid_just_in_time', status: 'confirmed' });

		const res = await runReleaseSweep('asia', now);
		expect(res.expired).toEqual([]);
	});

	it('never marks a late booking a no-show (ResDiary: only a host does that)', async () => {
		const { runReleaseSweep } = await import('./release.js');
		const now = new Date('2026-06-01T19:30:00.000Z'); // 90 min past `start`

		getFullList.mockResolvedValueOnce([]);

		const res = await runReleaseSweep('asia', now);
		expect(markNoShow).not.toHaveBeenCalled();
		// The one query asks only for unpaid holds — a confirmed booking can't be a candidate.
		const filter: string = getFullList.mock.calls[0][0].filter;
		expect(filter).toContain('status="pending_payment"');
		expect(filter).not.toContain('confirmed');
		expect(res).toEqual({ checked: 0, expired: [] });
	});

	it('only reaches back a day for a hold whose start has passed', async () => {
		const { runReleaseSweep } = await import('./release.js');
		const now = new Date('2026-06-02T12:00:00.000Z');

		getFullList.mockResolvedValueOnce([]);
		await runReleaseSweep('asia', now);
		const filter: string = getFullList.mock.calls[0][0].filter;
		expect(filter).toContain('starts_at>="2026-06-01 12:00:00.000Z"');
	});
});
