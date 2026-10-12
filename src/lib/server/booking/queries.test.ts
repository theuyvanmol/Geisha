import { describe, it, expect } from 'vitest';
import { toPbDateFilter } from './queries.js';

// Regression guard for a real bug: PocketBase stores datetimes with a SPACE and
// compares lexicographically, so filter bounds built from JS ISO strings ("T")
// matched nothing — letting overlapping bookings pass the availability check.
describe('toPbDateFilter', () => {
	it('replaces the ISO "T" separator with a space', () => {
		expect(toPbDateFilter('2026-06-01T00:00:00.000Z')).toBe('2026-06-01 00:00:00.000Z');
	});

	it('is a no-op for an already space-formatted value', () => {
		expect(toPbDateFilter('2026-06-01 18:00:00.000Z')).toBe('2026-06-01 18:00:00.000Z');
	});

	it('produces a bound that sorts correctly against stored values', () => {
		// stored value uses a space; the "T" form would sort AFTER it (the bug)
		const stored = '2026-06-01 18:00:00.000Z';
		const goodLower = toPbDateFilter('2026-06-01T00:00:00.000Z');
		const goodUpper = toPbDateFilter('2026-06-01T23:59:59.999Z');
		expect(goodLower <= stored && stored <= goodUpper).toBe(true);
		// demonstrate the original bug: raw "T" lower bound is NOT <= stored
		expect('2026-06-01T00:00:00.000Z' <= stored).toBe(false);
	});
});
