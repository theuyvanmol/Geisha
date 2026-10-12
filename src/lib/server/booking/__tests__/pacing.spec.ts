import { describe, it, expect } from 'vitest';
import {
	coversInWindow,
	selectPacingRule,
	slotWithinSlotCap,
	withinPeriodCap,
	type PacingRule
} from '../pacing.js';
import type { BookingFootprint } from '../availability.js';

// All windows are epoch-ms, so these tests are timezone-agnostic.
const at = (iso: string) => Date.parse(iso);

function fp(startIso: string, party: number): BookingFootprint {
	return { tableIds: ['t1'], startsAt: startIso, endsAt: startIso, partySize: party };
}

describe('coversInWindow', () => {
	const existing = [
		fp('2025-06-02T19:00:00Z', 4),
		fp('2025-06-02T19:10:00Z', 2),
		fp('2025-06-02T19:30:00Z', 6) // outside a 15-min window starting 19:00
	];

	it('sums party sizes of footprints whose START lands in [start,end)', () => {
		const start = at('2025-06-02T19:00:00Z');
		const end = start + 15 * 60_000;
		expect(coversInWindow(start, end, existing)).toBe(6); // 4 + 2
	});

	it('is half-open: a footprint exactly at end is excluded', () => {
		const start = at('2025-06-02T19:00:00Z');
		const end = at('2025-06-02T19:30:00Z'); // the 6-cover booking starts here
		// includes 19:00 + 19:10, excludes 19:30
		expect(coversInWindow(start, end, existing)).toBe(6);
	});

	it('treats a missing partySize as 0 (back-compat footprint)', () => {
		const start = at('2025-06-02T19:00:00Z');
		const end = start + 60 * 60_000;
		const legacy: BookingFootprint[] = [
			{ tableIds: ['t1'], startsAt: '2025-06-02T19:00:00Z', endsAt: '2025-06-02T21:00:00Z' }
		];
		expect(coversInWindow(start, end, legacy)).toBe(0);
	});
});

describe('selectPacingRule — most-specific wins', () => {
	const global: PacingRule = { dow: [], maxCoversPerSlot: 5, maxCoversPerPeriod: 0 };
	const dowOnly: PacingRule = { dow: [5], maxCoversPerSlot: 6, maxCoversPerPeriod: 0 };
	const periodOnly: PacingRule = {
		servicePeriodId: 'dinner',
		dow: [],
		maxCoversPerSlot: 7,
		maxCoversPerPeriod: 0
	};
	const periodAndDow: PacingRule = {
		servicePeriodId: 'dinner',
		dow: [5],
		maxCoversPerSlot: 8,
		maxCoversPerPeriod: 0
	};

	it('period + dow beats period-only beats dow-only beats global', () => {
		const all = [global, dowOnly, periodOnly, periodAndDow];
		// Friday (5), dinner — the most specific rule
		expect(selectPacingRule('dinner', 5, all)).toBe(periodAndDow);
	});

	it('period-only wins over global on a non-listed day', () => {
		// Monday (1): periodAndDow & dowOnly don't match; periodOnly does
		expect(selectPacingRule('dinner', 1, [global, dowOnly, periodOnly, periodAndDow])).toBe(
			periodOnly
		);
	});

	it('dow-only wins over global for a different period', () => {
		// Friday (5), lunch: period rules don't match; dowOnly does
		expect(selectPacingRule('lunch', 5, [global, dowOnly, periodOnly, periodAndDow])).toBe(dowOnly);
	});

	it('falls back to the global rule when nothing more specific matches', () => {
		expect(selectPacingRule('lunch', 1, [global, dowOnly, periodOnly])).toBe(global);
	});

	it('returns null when no rule matches', () => {
		const fridayOnly: PacingRule = { dow: [5], maxCoversPerSlot: 5, maxCoversPerPeriod: 0 };
		expect(selectPacingRule('dinner', 1, [fridayOnly])).toBeNull();
		expect(selectPacingRule('dinner', 1, [])).toBeNull();
	});
});

describe('slotWithinSlotCap', () => {
	const rule: PacingRule = { dow: [], maxCoversPerSlot: 10, maxCoversPerPeriod: 0 };
	const slotStart = at('2025-06-02T19:00:00Z');
	const existing = [fp('2025-06-02T19:05:00Z', 8)];

	it('allows adding covers up to the cap', () => {
		expect(slotWithinSlotCap(rule, slotStart, 15, 2, existing)).toBe(true); // 8 + 2 = 10
	});
	it('blocks adding covers past the cap', () => {
		expect(slotWithinSlotCap(rule, slotStart, 15, 3, existing)).toBe(false); // 8 + 3 > 10
	});
	it('null rule or 0 cap means unlimited', () => {
		expect(slotWithinSlotCap(null, slotStart, 15, 999, existing)).toBe(true);
		expect(
			slotWithinSlotCap(
				{ dow: [], maxCoversPerSlot: 0, maxCoversPerPeriod: 0 },
				slotStart,
				15,
				999,
				existing
			)
		).toBe(true);
	});

	it('stays DST-correct: covers are counted on epoch-ms windows', () => {
		// 2025-03-30 is the UK spring-forward day (01:00 -> 02:00). A booking at
		// 02:30 local is a single, unambiguous instant; the cap math must use it
		// as epoch-ms and not be confused by the skipped wall-clock hour.
		const dstSlot = Date.parse('2025-03-30T01:30:00Z'); // = 02:30 BST
		const dstExisting = [fp('2025-03-30T01:35:00Z', 8)]; // inside the 15-min window
		expect(slotWithinSlotCap(rule, dstSlot, 15, 2, dstExisting)).toBe(true); // 10
		expect(slotWithinSlotCap(rule, dstSlot, 15, 3, dstExisting)).toBe(false); // 11 > 10
	});
});

describe('withinPeriodCap', () => {
	const rule: PacingRule = { dow: [], maxCoversPerSlot: 0, maxCoversPerPeriod: 40 };
	const start = at('2025-06-02T17:00:00Z');
	const end = at('2025-06-02T23:00:00Z');
	const existing = [
		fp('2025-06-02T17:30:00Z', 16),
		fp('2025-06-02T19:00:00Z', 16),
		fp('2025-06-02T23:30:00Z', 8) // after the period close — not counted
	];

	it('counts covers across the whole period window', () => {
		expect(withinPeriodCap(rule, start, end, 8, existing)).toBe(true); // 32 + 8 = 40
		expect(withinPeriodCap(rule, start, end, 9, existing)).toBe(false); // 41 > 40
	});
	it('null rule or 0 cap means unlimited', () => {
		expect(withinPeriodCap(null, start, end, 999, existing)).toBe(true);
		expect(
			withinPeriodCap(
				{ dow: [], maxCoversPerSlot: 0, maxCoversPerPeriod: 0 },
				start,
				end,
				999,
				existing
			)
		).toBe(true);
	});
});
