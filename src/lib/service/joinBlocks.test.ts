import { describe, it, expect } from 'vitest';
import { joinBlocks, blockKey, type JoinRow } from './joinBlocks';

const row = (tableId: string, bookingIds: string[], laneCount = 1): JoinRow => ({
	tableId,
	bars: bookingIds.map((bookingId) => ({ bookingId })),
	laneCount
});

describe('joinBlocks', () => {
	it('leaves a single-table booking alone', () => {
		const { spanOf, hidden } = joinBlocks([row('t1', ['b1']), row('t2', [])]);
		expect(spanOf.size).toBe(0);
		expect(hidden.size).toBe(0);
	});

	it('merges a party spread across adjacent tables into one block', () => {
		// the owner's case: a 10-cover party on four pushed-together tables
		const rows = [row('t1', ['b1']), row('t2', ['b1']), row('t3', ['b1']), row('t4', ['b1'])];
		const { spanOf, unitsOf, hidden } = joinBlocks(rows);
		expect(spanOf.get(blockKey('b1', 't1'))).toBe(4);
		expect(unitsOf.get(blockKey('b1', 't1'))).toBe(4);
		expect([...hidden]).toEqual([blockKey('b1', 't2'), blockKey('b1', 't3'), blockKey('b1', 't4')]);
	});

	it('keeps other bookings on the spanned rows untouched', () => {
		const rows = [row('t1', ['b1']), row('t2', ['b1', 'b2'])];
		const { hidden } = joinBlocks(rows);
		expect(hidden.has(blockKey('b1', 't2'))).toBe(true);
		expect(hidden.has(blockKey('b2', 't2'))).toBe(false);
	});

	it('draws a run per group when the joined tables are not adjacent', () => {
		const rows = [row('t1', ['b1']), row('t2', ['b1']), row('t3', []), row('t4', ['b1'])];
		const { spanOf, hidden } = joinBlocks(rows);
		expect(spanOf.get(blockKey('b1', 't1'))).toBe(2);
		// the lone far table keeps its own bar — nothing spans over it
		expect(spanOf.has(blockKey('b1', 't4'))).toBe(false);
		expect(hidden.has(blockKey('b1', 't4'))).toBe(false);
		expect([...hidden]).toEqual([blockKey('b1', 't2')]);
	});

	it('never merges across a row that is split into sub-lanes', () => {
		const rows = [row('t1', ['b1']), row('t2', ['b1', 'b2'], 2), row('t3', ['b1'])];
		const { spanOf, hidden } = joinBlocks(rows);
		expect(spanOf.size).toBe(0);
		expect(hidden.size).toBe(0);
	});

	it('sums lane counts only over rows it actually merges', () => {
		const rows = [row('t1', ['b1']), row('t2', ['b1']), row('t3', ['b2', 'b3'], 2)];
		const { unitsOf } = joinBlocks(rows);
		expect(unitsOf.get(blockKey('b1', 't1'))).toBe(2);
	});
});
