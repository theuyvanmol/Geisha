import { describe, it, expect } from 'vitest';
import {
	canPlace,
	canSwap,
	swapWindows,
	occupantsOf,
	seatsMaxOf,
	seatsAcross,
	rowClashExcluding,
	isOverCapacity
} from './diaryValidation';
import type { DiarySection } from '$lib/server/booking/admin';

// Minimal sections builder — one 'Main' section with tables t1/t2/t3, bars placed by table.
type B = { bookingId: string; startMin: number; endMin: number; movable?: boolean };
function sections(spec: Record<string, B[]>): DiarySection[] {
	const rows = ['t1', 't2', 't3'].map((tableId) => ({
		tableId,
		label: tableId.toUpperCase(),
		seatsMax: 4,
		bars: (spec[tableId] ?? []) as unknown as DiarySection['rows'][number]['bars']
	}));
	return [{ name: 'Main', rows }];
}
const b = (bookingId: string, startMin: number, endMin: number, movable = true): B => ({
	bookingId,
	startMin,
	endMin,
	movable
});

describe('canPlace — move overlap on the target row', () => {
	it('allows a placement on an empty stretch', () => {
		const s = sections({ t1: [b('X', 60, 150)] });
		expect(canPlace(s, 't1', 200, 290, 'Y')).toBe(true); // no overlap
	});
	it('blocks a placement overlapping another booking', () => {
		const s = sections({ t1: [b('X', 60, 150)] });
		expect(canPlace(s, 't1', 120, 210, 'Y')).toBe(false); // overlaps X
	});
	it('ignores the moving booking itself (self-overlap is fine)', () => {
		const s = sections({ t1: [b('X', 60, 150)] });
		expect(canPlace(s, 't1', 60, 150, 'X')).toBe(true);
	});
	it('treats a temp walk-in as a real occupant for a move', () => {
		const s = sections({ t1: [b('temp-1', 60, 150)] });
		expect(canPlace(s, 't1', 120, 210, 'Y')).toBe(false);
	});
	it('an empty target table is always placeable', () => {
		const s = sections({ t2: [b('X', 60, 150)] });
		expect(canPlace(s, 't1', 60, 150, 'Y')).toBe(true);
	});
});

describe('swapWindows — honor-drop cross-table, positional same-table', () => {
	it('cross-table: dragged lands at the DROPPED time, partner keeps its own', () => {
		// dragged len 90, partner len 60. Dropped at 200 onto a different table.
		const w = swapWindows({ startMin: 60, endMin: 150 }, { startMin: 300, endMin: 360 }, 200, false);
		expect(w.dragged).toEqual({ startMin: 200, endMin: 290 }); // dragged @ dropped time, len 90
		expect(w.partner).toEqual({ startMin: 300, endMin: 360 }); // partner UNCHANGED
	});
	it('same-table: the two trade starts (positional, collision-free)', () => {
		const w = swapWindows({ startMin: 60, endMin: 150 }, { startMin: 300, endMin: 360 }, 200, true);
		expect(w.dragged).toEqual({ startMin: 300, endMin: 390 }); // dragged @ partner start, len 90
		expect(w.partner).toEqual({ startMin: 60, endMin: 120 }); // partner @ dragged start, len 60
	});
});

describe('canSwap — swap validity', () => {
	it('allows a clean swap of two bookings on different tables', () => {
		const s = sections({ t1: [b('A', 60, 150)], t2: [b('B', 60, 150)] });
		const r = canSwap(s, b('A', 60, 150), 't1', b('B', 60, 150), 't2', 60);
		expect(r.ok).toBe(true);
	});
	it('blocks when a THIRD booking clashes on the dragged bar’s dropped window', () => {
		// A(t1) dropped at 60 onto t2, but t2 ALSO has C overlapping A's incoming window.
		const s = sections({ t1: [b('A', 60, 150)], t2: [b('B', 60, 150), b('C', 60, 150)] });
		const r = canSwap(s, b('A', 60, 150), 't1', b('B', 60, 150), 't2', 60);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe('clash');
	});
	it('refuses an immovable partner', () => {
		const s = sections({ t1: [b('A', 60, 150)], t2: [b('B', 60, 150, false)] });
		const r = canSwap(s, b('A', 60, 150), 't1', b('B', 60, 150, false), 't2', 60);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe('immovable');
	});
	it('refuses a no-op (same table AND same time)', () => {
		const s = sections({ t1: [b('A', 60, 150), b('B', 60, 150)] });
		const r = canSwap(s, b('A', 60, 150), 't1', b('B', 60, 150), 't1', 60);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toBe('same-slot');
	});
	it('a temp third booking does NOT block a swap (server can’t see it)', () => {
		const s = sections({ t1: [b('A', 60, 150)], t2: [b('B', 60, 150), b('temp-9', 60, 150)] });
		const r = canSwap(s, b('A', 60, 150), 't1', b('B', 60, 150), 't2', 60);
		expect(r.ok).toBe(true);
	});
	it('allows a same-table swap at DIFFERENT times (trade slots)', () => {
		const s = sections({ t1: [b('A', 60, 150), b('B', 300, 390)] });
		const r = canSwap(s, b('A', 60, 150), 't1', b('B', 300, 390), 't1', 300);
		expect(r.ok).toBe(true);
	});
});

describe('helpers', () => {
	it('occupantsOf returns the bars on a table', () => {
		const s = sections({ t1: [b('A', 60, 150)] });
		expect(occupantsOf(s, 't1').map((x) => x.bookingId)).toEqual(['A']);
		expect(occupantsOf(s, 't3')).toEqual([]);
	});
	it('seatsMaxOf reads capacity from scaffold rows', () => {
		expect(seatsMaxOf([{ tableId: 't1', seatsMax: 6 }], 't1')).toBe(6);
		expect(seatsMaxOf([{ tableId: 't1', seatsMax: 6 }], 'gone')).toBe(0);
	});
	it('rowClashExcluding skips both participants and temp bars', () => {
		const s = sections({ t1: [b('A', 60, 150), b('B', 60, 150), b('temp-1', 60, 150)] });
		expect(rowClashExcluding(s, 't1', 60, 150, 'A', 'B')).toBeNull(); // only A,B,temp present
		expect(rowClashExcluding(s, 't1', 60, 150, 'A', 'X')?.bookingId).toBe('B'); // B now blocks
	});
});

describe('isOverCapacity — oversize seat (flagged, never shrunk)', () => {
	it('flags a party bigger than the table it sits on', () => {
		expect(isOverCapacity(6, 2)).toBe(true); // party of 6 dropped onto a 2-top
	});
	it('does not flag a party that fits', () => {
		expect(isOverCapacity(2, 6)).toBe(false);
	});
	it('does not flag an exact fit', () => {
		expect(isOverCapacity(4, 4)).toBe(false);
	});
	it('never flags when capacity is unknown (seatsMax 0 = table not found)', () => {
		expect(isOverCapacity(6, 0)).toBe(false);
	});
});

describe('seatsAcross — the seats a booking’s whole table set is rated for', () => {
	const rows = [
		{ tableId: 't10', seatsMax: 4 },
		{ tableId: 't11', seatsMax: 4 },
		{ tableId: 't32', seatsMax: 8 }
	];
	it('sums a pushed-together pair', () => {
		expect(seatsAcross(rows, ['t10', 't11'])).toBe(8);
	});
	it('reads a single table', () => {
		expect(seatsAcross(rows, ['t32'])).toBe(8);
	});
	it('is 0 for no tables (unassigned) so nothing is flagged', () => {
		expect(seatsAcross(rows, [])).toBe(0);
		expect(isOverCapacity(9, seatsAcross(rows, []))).toBe(false);
	});
	it('ignores the __unassigned__ placeholder alongside real tables', () => {
		expect(seatsAcross(rows, ['t10', '__unassigned__'])).toBe(4);
	});
	// A table missing from the board (a stale bar, a floor edit mid-service) means we do
	// NOT know the combination's real capacity — warning on a guess would cry wolf on a
	// party that fits, so the whole set reports unknown.
	it('reports 0 when any table in the set is unknown', () => {
		expect(seatsAcross(rows, ['t10', 'gone'])).toBe(0);
		expect(isOverCapacity(9, seatsAcross(rows, ['t10', 'gone']))).toBe(false);
	});
	it('a party of 9 on the 4+4 pair is over capacity; 8 is not', () => {
		expect(isOverCapacity(9, seatsAcross(rows, ['t10', 't11']))).toBe(true);
		expect(isOverCapacity(8, seatsAcross(rows, ['t10', 't11']))).toBe(false);
	});
});
