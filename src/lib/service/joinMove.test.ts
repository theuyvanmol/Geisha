import { describe, it, expect } from 'vitest';
import {
	shiftTableSet,
	sameTableSet,
	swapTableSets,
	moveCandidates,
	swapCandidates,
	type RowOrder
} from './joinMove';

// A board: section "Window" holds T1..T4, section "Bar" holds B1..B2, in display order.
const ORDER = ['T1', 'T2', 'T3', 'T4', 'B1', 'B2'];
const SECTION: Record<string, string> = {
	T1: 'Window',
	T2: 'Window',
	T3: 'Window',
	T4: 'Window',
	B1: 'Bar',
	B2: 'Bar'
};
const rows: RowOrder = { order: ORDER, sectionOf: (t) => SECTION[t] ?? null };

describe('shiftTableSet', () => {
	it('lands a single-table booking on the row it was dropped on', () => {
		expect(shiftTableSet(['T1'], 'T1', 'T3', rows)).toEqual(['T3']);
	});

	it('KEEPS every table of a joined party — the collapse-to-one-table bug', () => {
		// Party across T1+T2, dragged down one row → T2+T3, still two tables.
		expect(shiftTableSet(['T1', 'T2'], 'T1', 'T2', rows)).toEqual(['T2', 'T3']);
	});

	it('shifts a 3-table party as a block', () => {
		expect(shiftTableSet(['T1', 'T2', 'T3'], 'T1', 'T2', rows)).toEqual(['T2', 'T3', 'T4']);
	});

	it('keeps the exact same tables when dropped back on its own row (re-time only)', () => {
		expect(shiftTableSet(['T2', 'T3'], 'T2', 'T2', rows)).toEqual(['T2', 'T3']);
	});

	it('shifts upward too', () => {
		expect(shiftTableSet(['T3', 'T4'], 'T3', 'T2', rows)).toEqual(['T2', 'T3']);
	});

	it('handles a non-contiguous set (a party on T1 + T3)', () => {
		expect(shiftTableSet(['T1', 'T3'], 'T1', 'T2', rows)).toEqual(['T2', 'T4']);
	});

	it('refuses a shift that runs off the end of the board', () => {
		expect(shiftTableSet(['T3', 'T4'], 'T3', 'B2', rows)).toBeNull();
	});

	it('refuses a shift that would split a one-section party across two sections', () => {
		// T3+T4 dragged down one row would become T4+B1 — Window and Bar aren't pushed together.
		expect(shiftTableSet(['T3', 'T4'], 'T3', 'T4', rows)).toBeNull();
	});

	it('allows a joined party to move wholly into another section', () => {
		expect(shiftTableSet(['T3', 'T4'], 'T3', 'B1', rows)).toEqual(['B1', 'B2']);
	});

	it('refuses when a table is no longer on the board', () => {
		expect(shiftTableSet(['T1', 'GONE'], 'T1', 'T2', rows)).toBeNull();
	});

	it('refuses an unknown drop row', () => {
		expect(shiftTableSet(['T1', 'T2'], 'T1', 'NOPE', rows)).toBeNull();
	});
});

// 2026-09-11, Asia: Angel (8) on table 2 and EOHA (14) joined on 3+4. Dropping one onto the
// other EXCHANGED the sets — EOHA onto the single 8-top, Angel onto both tables — so the host
// got an over-capacity warning and a layout nobody wanted. A swap is two parties trading
// PLACES: each keeps its own number of tables.
describe('swapTableSets', () => {
	it('exchanges the sets when both parties hold the same number of tables', () => {
		expect(swapTableSets(['T1'], ['T3'], rows)).toEqual({ dragged: ['T3'], partner: ['T1'] });
		expect(swapTableSets(['T1', 'T2'], ['T3', 'T4'], rows)).toEqual({
			dragged: ['T3', 'T4'],
			partner: ['T1', 'T2']
		});
	});

	it('trades places in place, each party keeping its own table count (the Angel/EOHA case)', () => {
		// Single on T2 dragged onto the pair on T3+T4 → the pair moves up to T2+T3, the single to T4.
		expect(swapTableSets(['T2'], ['T3', 'T4'], rows)).toEqual({
			dragged: ['T4'],
			partner: ['T2', 'T3']
		});
	});

	it('gives the same layout whichever of the two is dragged', () => {
		expect(swapTableSets(['T3', 'T4'], ['T2'], rows)).toEqual({
			dragged: ['T2', 'T3'],
			partner: ['T4']
		});
	});

	it('works with the joined party above the single one', () => {
		expect(swapTableSets(['T1', 'T2'], ['T3'], rows)).toEqual({
			dragged: ['T2', 'T3'],
			partner: ['T1']
		});
	});

	it('trades places when the two are apart, each landing where the other was', () => {
		expect(swapTableSets(['T1'], ['T3', 'T4'], rows)).toEqual({
			dragged: ['T4'],
			partner: ['T1', 'T2']
		});
	});

	it('refuses a trade that would split a one-section party across two sections', () => {
		// The Bar pair moving up to start at T4 would sit on T4 + B1 — not pushed together.
		expect(swapTableSets(['T4'], ['B1', 'B2'], rows)).toBeNull();
	});

	it('refuses parties of different sizes that share a table — there is no clean trade', () => {
		expect(swapTableSets(['T2'], ['T2', 'T3'], rows)).toBeNull();
	});

	it('refuses when a table is no longer on the board', () => {
		expect(swapTableSets(['T1'], ['GONE', 'T3'], rows)).toBeNull();
	});
});

describe('sameTableSet', () => {
	it('is true for the same tables in any order', () => {
		expect(sameTableSet(['T1', 'T2'], ['T2', 'T1'])).toBe(true);
	});
	it('is false for different sizes or members', () => {
		expect(sameTableSet(['T1'], ['T1', 'T2'])).toBe(false);
		expect(sameTableSet(['T1', 'T2'], ['T1', 'T3'])).toBe(false);
	});
});

// Owner, 2026-10-02 (Asia): Jaysen Gray, a 5 joined on 41+42, dragged onto table 27 — a 6-top on
// the LAST row of its section. The two-table block had nowhere to go, so the diary refused the
// drop outright. Staff must be able to put a booking wherever they want: when the block can't
// go there, the party lands on the table it was dropped on.
describe('moveCandidates', () => {
	it('offers the shifted block first, then the dropped table on its own', () => {
		expect(moveCandidates(['T1', 'T2'], 'T1', 'T2', rows)).toEqual([['T2', 'T3'], ['T2']]);
	});

	it('falls back to the dropped table when the block would leave its section', () => {
		// T3+T4 dropped on T4 → T4+B1 crosses into Bar → only T4 alone is left
		expect(moveCandidates(['T3', 'T4'], 'T3', 'T4', rows)).toEqual([['T4']]);
	});

	it('falls back to the dropped table when the block runs off the board', () => {
		expect(moveCandidates(['B1', 'B2'], 'B1', 'B2', rows)).toEqual([['B2']]);
	});

	it('a single-table booking only ever has the dropped table', () => {
		expect(moveCandidates(['T1'], 'T1', 'T3', rows)).toEqual([['T3']]);
	});

	it('a re-time on its own row keeps every table (never collapses the party)', () => {
		expect(moveCandidates(['T1', 'T2'], 'T1', 'T1', rows)).toEqual([['T1', 'T2']]);
	});
});

describe('swapCandidates', () => {
	it('tries the in-place trade first, then a straight exchange of the two sets', () => {
		// 1 on T1, 2 on T3+T4 → in place: the pair moves up to T1+T2, the single down to T4
		expect(swapCandidates(['T1'], ['T3', 'T4'], rows)).toEqual([
			{ dragged: ['T4'], partner: ['T1', 'T2'] },
			{ dragged: ['T3', 'T4'], partner: ['T1'] }
		]);
	});

	it('falls back to the exchange when the in-place trade would leave the section', () => {
		// The 2 Oct case: a pair on B1+B2 dropped on a single on T4, the last row of Window.
		// In place, the pair would sit on T4+B1 — across two sections — so only the exchange is left.
		expect(swapCandidates(['B1', 'B2'], ['T4'], rows)).toEqual([
			{ dragged: ['T4'], partner: ['B1', 'B2'] }
		]);
	});

	it('equal counts are a single exchange', () => {
		expect(swapCandidates(['T1'], ['B1'], rows)).toEqual([{ dragged: ['B1'], partner: ['T1'] }]);
	});
});
