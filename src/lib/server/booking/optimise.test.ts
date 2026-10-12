import { describe, it, expect } from 'vitest';
import { proposeSeatingPlan, type PlannerBooking, type OptimiseInput } from './optimise.js';
import type { DiningTable, ServicePeriod, TableJoin } from '../db/types.js';

// --- fixtures ---------------------------------------------------------------

function table(
	over: Partial<DiningTable> & { id: string; seats_min: number; seats_max: number }
): DiningTable {
	return {
		created: '',
		updated: '',
		restaurant: 'r1',
		label: over.id,
		section: 'Main',
		bookable: true,
		x: 0,
		y: 0,
		width: 90,
		height: 90,
		shape: 'rect',
		...over
	};
}

const TABLES: DiningTable[] = [
	table({ id: 't2a', label: 'T2a', seats_min: 1, seats_max: 2 }),
	table({ id: 't2b', label: 'T2b', seats_min: 1, seats_max: 2 }),
	table({ id: 't4', label: 'T4', seats_min: 2, seats_max: 4 }),
	table({ id: 't6', label: 'T6', seats_min: 4, seats_max: 6 }),
	table({ id: 'walkin', label: 'WB', seats_min: 1, seats_max: 2, bookable: false }),
	table({ id: 'tvip', label: 'V1', seats_min: 2, seats_max: 4, section: 'VIP' }),
	table({ id: 'twin', label: 'W1', seats_min: 2, seats_max: 4, section: 'Window' })
];

const JOINS: TableJoin[] = [
	{ id: 'j1', created: '', updated: '', restaurant: 'r1', table_a: 't2a', table_b: 't2b' },
	{ id: 'j2', created: '', updated: '', restaurant: 'r1', table_a: 't4', table_b: 't6' }
];

const DINNER: ServicePeriod = {
	id: 'dinner',
	created: '',
	updated: '',
	restaurant: 'r1',
	name: 'Dinner',
	days_of_week: [0, 1, 2, 3, 4, 5, 6],
	start_time: '17:00',
	end_time: '23:00',
	last_booking_time: '21:00',
	default_turn_minutes: 120,
	active: true
};

const DATE = '2025-06-02';
function inst(hhmm: string): string {
	return `${DATE}T${hhmm}:00Z`;
}

function bk(over: Partial<PlannerBooking> & { id: string; partySize: number }): PlannerBooking {
	return {
		startsAt: inst('18:00'),
		endsAt: inst('20:00'),
		tableIds: [],
		status: 'confirmed',
		servicePeriodId: 'dinner',
		...over
	};
}

function plan(bookings: PlannerBooking[], over: Partial<OptimiseInput> = {}) {
	return proposeSeatingPlan({
		date: DATE,
		tables: TABLES,
		joins: JOINS,
		periods: [DINNER],
		bookings,
		defaultTurnMinutes: 120,
		...over
	});
}

// --- tests ------------------------------------------------------------------

describe('proposeSeatingPlan — packing', () => {
	it('seats an unassigned party of 2 on the smallest fitting table', () => {
		const p = plan([bk({ id: 'b1', partySize: 2 })]);
		expect(p.moves).toHaveLength(1);
		expect(p.moves[0].toTableIds).toEqual(['t2a']);
		expect(p.moves[0].fromTableIds).toEqual([]);
		expect(p.unseated).toHaveLength(0);
	});

	it('minimises wasted seats — a party of 3 takes the 4-top, not the 6-top', () => {
		const p = plan([bk({ id: 'b1', partySize: 3 })]);
		expect(p.moves[0].toTableIds).toEqual(['t4']);
		expect(p.moves[0].wastedAfter).toBe(1);
	});

	it('never seats on a walk-in-only table even when the bookables are full', () => {
		// Two 2-tops at the same window force the third 2-party elsewhere — but
		// never onto the walk-in-only table.
		const p = plan([
			bk({ id: 'b1', partySize: 2 }),
			bk({ id: 'b2', partySize: 2 }),
			bk({ id: 'b3', partySize: 2 })
		]);
		const all = p.moves.flatMap((m) => m.toTableIds);
		expect(all).not.toContain('walkin');
	});

	it('uses a registered join for a party larger than any single table', () => {
		// party of 9 needs t4(4)+t6(6) = 10 seats
		const p = plan([bk({ id: 'big', partySize: 9 })]);
		expect(p.moves[0].toTableIds.sort()).toEqual(['t4', 't6']);
		expect(p.moves[0].createsJoin).toBe(true);
	});

	it('reports a party it cannot seat as unseated (no move proposed)', () => {
		// 12 exceeds even the biggest join (10) — cannot be placed.
		const p = plan([bk({ id: 'huge', partySize: 12 })]);
		expect(p.moves).toHaveLength(0);
		expect(p.unseated).toEqual([
			{ bookingId: 'huge', partySize: 12, startsAt: new Date(inst('18:00')).toISOString() }
		]);
	});
});

describe('proposeSeatingPlan — pinning seated parties', () => {
	it('never moves a seated party and reserves its table', () => {
		// b1 is SEATED on t4; b2 (party of 3, also fits t4) must go elsewhere.
		const p = plan([
			bk({ id: 'b1', partySize: 3, status: 'seated', tableIds: ['t4'] }),
			bk({ id: 'b2', partySize: 3 })
		]);
		// the seated booking is never a move
		expect(p.moves.find((m) => m.bookingId === 'b1')).toBeUndefined();
		expect(p.pinned).toBe(1);
		// b2 is placed on a DIFFERENT table than the occupied t4
		const b2 = p.moves.find((m) => m.bookingId === 'b2');
		expect(b2).toBeDefined();
		expect(b2!.toTableIds).not.toContain('t4');
	});

	it('lets two non-overlapping bookings share the same table across the day', () => {
		const p = plan([
			bk({ id: 'early', partySize: 2, startsAt: inst('17:00'), endsAt: inst('19:00') }),
			bk({ id: 'late', partySize: 2, startsAt: inst('19:30'), endsAt: inst('21:30') })
		]);
		const early = p.moves.find((m) => m.bookingId === 'early')!;
		const late = p.moves.find((m) => m.bookingId === 'late')!;
		// both can use t2a since their turns don't overlap
		expect(early.toTableIds).toEqual(['t2a']);
		expect(late.toTableIds).toEqual(['t2a']);
	});

	it('keeps two OVERLAPPING bookings on different tables', () => {
		const p = plan([
			bk({ id: 'a', partySize: 2, startsAt: inst('18:00'), endsAt: inst('20:00') }),
			bk({ id: 'b', partySize: 2, startsAt: inst('18:30'), endsAt: inst('20:30') })
		]);
		const a = p.moves.find((m) => m.bookingId === 'a')!;
		const b = p.moves.find((m) => m.bookingId === 'b')!;
		expect(a.toTableIds).not.toEqual(b.toTableIds);
	});
});

describe('proposeSeatingPlan — diff & idempotence', () => {
	it('proposes NO moves when every booking is already optimally placed', () => {
		const p = plan([
			bk({ id: 'b1', partySize: 2, tableIds: ['t2a'] }),
			bk({ id: 'b2', partySize: 3, tableIds: ['t4'] })
		]);
		expect(p.moves).toHaveLength(0);
		expect(p.summary.movesCount).toBe(0);
	});

	it('is idempotent — applying the plan then re-running yields no further moves', () => {
		const bookings = [
			bk({ id: 'b1', partySize: 2, tableIds: ['t6'] }), // wasteful: 2 on a 6-top
			bk({ id: 'b2', partySize: 6, tableIds: [] })
		];
		const first = plan(bookings);
		expect(first.moves.length).toBeGreaterThan(0);
		// apply the diff
		const applied = bookings.map((b) => {
			const mv = first.moves.find((m) => m.bookingId === b.id);
			return mv ? { ...b, tableIds: mv.toTableIds } : b;
		});
		const second = plan(applied);
		expect(second.moves).toHaveLength(0);
	});

	it('reduces total wasted seats vs the current allocation', () => {
		const p = plan([
			bk({ id: 'b1', partySize: 2, tableIds: ['t6'] }), // 4 wasted
			bk({ id: 'b2', partySize: 4, tableIds: ['t4'] }) // 0 wasted
		]);
		expect(p.summary.wastedSeatsAfter).toBeLessThan(p.summary.wastedSeatsBefore);
	});
});

describe('proposeSeatingPlan — soft preferences', () => {
	it('honours a VIP preference for the VIP section when waste is otherwise tied', () => {
		// A VIP party of 3: t4, tvip and twin all fit with 1 wasted seat; VIP wins.
		const p = plan([bk({ id: 'v', partySize: 3, vip: true })]);
		expect(p.moves[0].toTableIds).toEqual(['tvip']);
	});

	it('honours a "window" note for the Window section on a tie', () => {
		const p = plan([bk({ id: 'w', partySize: 3, notes: 'Window seat please' })]);
		expect(p.moves[0].toTableIds).toEqual(['twin']);
	});

	it('does NOT sacrifice the hard objective (waste) for a soft preference', () => {
		// A VIP party of 1 — only the 2-tops give the tightest fit (1 wasted); the
		// VIP 4-top would waste 3. Tight fit must win over the section preference.
		const p = plan([bk({ id: 'v', partySize: 1, vip: true })]);
		expect(p.moves[0].wastedAfter).toBe(1);
		expect(p.moves[0].toTableIds[0]).not.toBe('tvip');
	});
});

describe('proposeSeatingPlan — prioritisation', () => {
	it('places the hardest (largest) party first so it is never starved', () => {
		// One 6-top, one 4-top free. A party of 6 and a party of 4 both confirmed.
		// The 6 must get t6 and the 4 must get t4 — large-first ordering guarantees it.
		const p = plan([bk({ id: 'small', partySize: 4 }), bk({ id: 'big', partySize: 6 })]);
		const big = p.moves.find((m) => m.bookingId === 'big')!;
		expect(big.toTableIds).toEqual(['t6']);
		expect(p.unseated).toHaveLength(0);
	});
});
