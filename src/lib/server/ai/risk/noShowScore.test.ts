import { describe, it, expect } from 'vitest';
import {
	scoreNoShow,
	riskBand,
	historyFromCustomer,
	RISK_HIGH,
	RISK_MEDIUM,
	type ScorableBooking,
	type CustomerHistory
} from './noShowScore.js';

// A fixed "now" so lead-time signals are deterministic: 2026-06-25 12:00 UTC.
const NOW = Date.parse('2026-06-25T12:00:00.000Z');

function bk(over: Partial<ScorableBooking> = {}): ScorableBooking {
	return {
		party_size: 2,
		// Default ~1 day out (steady middle — no lead-time signal either way).
		starts_at: '2026-06-26T18:00:00.000Z',
		source: 'online',
		tables: [],
		hasDeposit: false,
		...over
	};
}

describe('riskBand', () => {
	it('maps scores to bands at the cut points', () => {
		expect(riskBand(0)).toBe('low');
		expect(riskBand(RISK_MEDIUM - 1)).toBe('low');
		expect(riskBand(RISK_MEDIUM)).toBe('medium');
		expect(riskBand(RISK_HIGH - 1)).toBe('medium');
		expect(riskBand(RISK_HIGH)).toBe('high');
		expect(riskBand(100)).toBe('high');
	});
});

describe('scoreNoShow — bounds & determinism', () => {
	it('always returns an integer in 0..100', () => {
		const r = scoreNoShow(bk(), {}, NOW);
		expect(Number.isInteger(r.score)).toBe(true);
		expect(r.score).toBeGreaterThanOrEqual(0);
		expect(r.score).toBeLessThanOrEqual(100);
	});

	it('is deterministic for the same inputs', () => {
		const a = scoreNoShow(bk({ party_size: 8 }), { noShowCount: 2 }, NOW);
		const b = scoreNoShow(bk({ party_size: 8 }), { noShowCount: 2 }, NOW);
		expect(a.score).toBe(b.score);
		expect(a.factors).toEqual(b.factors);
	});

	it('clamps an extreme high-risk booking to 100', () => {
		const r = scoreNoShow(
			bk({ party_size: 12, source: 'online', hasDeposit: false }),
			{ noShowCount: 5, cancelCount: 6 },
			NOW
		);
		expect(r.score).toBe(100);
		expect(r.band).toBe('high');
	});

	it('clamps a strongly de-risked booking to 0 (never negative)', () => {
		const r = scoreNoShow(
			bk({ source: 'walkin', hasDeposit: true, party_size: 2 }),
			{ vip: true },
			NOW
		);
		expect(r.score).toBeGreaterThanOrEqual(0);
		expect(r.band).toBe('low');
	});
});

describe('scoreNoShow — signals', () => {
	it('prior no-shows raise the score and surface a factor', () => {
		const clean = scoreNoShow(bk(), {}, NOW);
		const repeat = scoreNoShow(bk(), { noShowCount: 2 }, NOW);
		expect(repeat.score).toBeGreaterThan(clean.score);
		expect(repeat.factors.some((f) => f.code === 'prior_no_shows')).toBe(true);
	});

	it('weights a no-show RATE softer when many prior bookings are known', () => {
		const oneOffAmongMany = scoreNoShow(bk(), { noShowCount: 1, priorBookings: 40 }, NOW);
		const oneOffNewish = scoreNoShow(bk(), { noShowCount: 1, priorBookings: 1 }, NOW);
		const fNew = oneOffNewish.factors.find((f) => f.code === 'prior_no_shows')!;
		const fMany = oneOffAmongMany.factors.find((f) => f.code === 'prior_no_shows')!;
		expect(fMany.weight).toBeLessThan(fNew.weight);
	});

	it('a held deposit lowers risk vs no deposit', () => {
		const withDeposit = scoreNoShow(bk({ hasDeposit: true }), {}, NOW);
		const without = scoreNoShow(bk({ hasDeposit: false }), {}, NOW);
		expect(withDeposit.score).toBeLessThan(without.score);
		expect(withDeposit.factors.some((f) => f.code === 'deposit_held')).toBe(true);
		expect(without.factors.some((f) => f.code === 'no_deposit')).toBe(true);
	});

	it('a large party raises risk', () => {
		const small = scoreNoShow(bk({ party_size: 2 }), {}, NOW);
		const big = scoreNoShow(bk({ party_size: 10 }), {}, NOW);
		expect(big.score).toBeGreaterThan(small.score);
		expect(big.factors.some((f) => f.code === 'party_large')).toBe(true);
	});

	it('walk-ins are treated as the lowest-risk source', () => {
		const online = scoreNoShow(bk({ source: 'online' }), {}, NOW);
		const walkin = scoreNoShow(bk({ source: 'walkin' }), {}, NOW);
		expect(walkin.score).toBeLessThan(online.score);
		expect(walkin.factors.some((f) => f.code === 'source_walkin')).toBe(true);
	});

	it('last-minute bookings get a short-lead factor', () => {
		// 1 hour after NOW.
		const r = scoreNoShow(bk({ starts_at: '2026-06-25T13:00:00.000Z' }), {}, NOW);
		expect(r.factors.some((f) => f.code === 'lead_short')).toBe(true);
	});

	it('bookings made far in advance get a long-lead factor', () => {
		// 60 days after NOW.
		const r = scoreNoShow(bk({ starts_at: '2026-08-24T18:00:00.000Z' }), {}, NOW);
		expect(r.factors.some((f) => f.code === 'lead_long')).toBe(true);
	});

	it('flags weekend dinner slots', () => {
		// 2026-06-27 is a Saturday; 19:00 UTC = dinner.
		const r = scoreNoShow(bk({ starts_at: '2026-06-27T19:00:00.000Z' }), {}, NOW);
		expect(r.factors.some((f) => f.code === 'weekend_dinner')).toBe(true);
	});

	it('VIP guests are trusted (lower risk)', () => {
		const normal = scoreNoShow(bk(), {}, NOW);
		const vip = scoreNoShow(bk(), { vip: true }, NOW);
		expect(vip.score).toBeLessThan(normal.score);
		expect(vip.factors.some((f) => f.code === 'vip')).toBe(true);
	});

	it('orders factors by absolute impact, most impactful first', () => {
		const r = scoreNoShow(bk({ party_size: 10 }), { noShowCount: 2 }, NOW);
		for (let i = 1; i < r.factors.length; i++) {
			expect(Math.abs(r.factors[i - 1].weight)).toBeGreaterThanOrEqual(
				Math.abs(r.factors[i].weight)
			);
		}
	});

	it('tolerates an unparseable start time without throwing', () => {
		const r = scoreNoShow(bk({ starts_at: 'not-a-date' }), {}, NOW);
		expect(Number.isInteger(r.score)).toBe(true);
		expect(r.factors.some((f) => f.code === 'lead_short' || f.code === 'lead_long')).toBe(false);
	});
});

describe('historyFromCustomer', () => {
	it('maps stored customer counts, defaulting missing fields', () => {
		expect(historyFromCustomer(undefined)).toEqual({
			noShowCount: 0,
			cancelCount: 0,
			vip: false
		});
		const h: CustomerHistory = historyFromCustomer({
			no_show_count: 3,
			cancel_count: 1,
			vip: true
		});
		expect(h).toEqual({ noShowCount: 3, cancelCount: 1, vip: true });
	});
});
