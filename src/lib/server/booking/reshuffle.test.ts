import { describe, it, expect } from 'vitest';
import { planReshuffleCore, type PlanBooking } from './reshuffle.js';
import type { BookingFootprint } from './availability.js';
import type { DiningTable, TableJoin } from '../db/types.js';

// --- fixtures ---------------------------------------------------------------

function table(over: Partial<DiningTable> & { id: string; seats_min: number; seats_max: number }): DiningTable {
	return {
		created: '', updated: '', restaurant: 'r1',
		label: over.id, section: 'Main', bookable: true,
		x: 0, y: 0, width: 90, height: 90, shape: 'rect',
		...over
	};
}

const TABLES: DiningTable[] = [
	table({ id: 't1', seats_min: 1, seats_max: 2 }),
	table({ id: 't2', seats_min: 1, seats_max: 2 }),
	table({ id: 't3', seats_min: 1, seats_max: 2 }),
	table({ id: 't4', seats_min: 2, seats_max: 4 }),
	table({ id: 't5', seats_min: 2, seats_max: 4 }),
	table({ id: 't6', seats_min: 4, seats_max: 6 }),
	table({ id: 't7', seats_min: 4, seats_max: 6 }),
	table({ id: 'w1', seats_min: 1, seats_max: 2, bookable: false }) // walk-in only — never auto-allocated
];

const JOINS: TableJoin[] = [
	{ id: 'j45', created: '', updated: '', restaurant: 'r1', table_a: 't4', table_b: 't5' },
	{ id: 'j12', created: '', updated: '', restaurant: 'r1', table_a: 't1', table_b: 't2' },
	{ id: 'j67', created: '', updated: '', restaurant: 'r1', table_a: 't6', table_b: 't7' }
];

const AT = (hhmm: string): number => {
	const [h, m] = hhmm.split(':').map(Number);
	return (h * 60 + m) * 60_000;
};
const hhmm = (msVal: number): string => {
	const t = Math.round(msVal / 60_000);
	return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const label = (ids: string[]): string => ids.join('+') || '—';

const bk = (
	id: string, party: number, from: string, to: string, tables: string[], status = 'confirmed'
): PlanBooking => ({ id, party, startMs: AT(from), endMs: AT(to), tables, status, name: id });

// Convenience wrapper: the dragged booking is always present in `bookings`.
function plan(opts: {
	bookings: PlanBooking[];
	draggedId: string;
	target: string[];
	from: string;
	to: string;
	closeouts?: BookingFootprint[];
}) {
	return planReshuffleCore({
		tables: TABLES,
		joins: JOINS,
		ranks: {},
		closeoutFootprints: opts.closeouts ?? [],
		bookings: opts.bookings,
		draggedId: opts.draggedId,
		targetTableIds: opts.target,
		startMs: AT(opts.from),
		endMs: AT(opts.to),
		label,
		hhmm
	});
}

const closeout = (tableId: string, from: string, to: string): BookingFootprint => ({
	tableIds: [tableId], startsAt: new Date(AT(from)), endsAt: new Date(AT(to)), partySize: 0
});

// --- tests ------------------------------------------------------------------

describe('planReshuffleCore', () => {
	it('proposes NO moves when the target table is free (the plain move already fits)', () => {
		const r = plan({
			bookings: [bk('D', 4, '19:00', '20:30', ['t4'])],
			draggedId: 'D',
			target: ['t5'], // t5 empty
			from: '19:00',
			to: '20:30'
		});
		expect(r.ok).toBe(true);
		expect(r.moves).toEqual([]);
	});

	it('reseats a single displaced booking to a free table', () => {
		const r = plan({
			bookings: [
				bk('D', 4, '12:00', '13:30', ['t2']), // dragged, currently elsewhere
				bk('B', 4, '19:00', '21:00', ['t4']) // occupies the target
			],
			draggedId: 'D',
			target: ['t4'],
			from: '19:00',
			to: '20:30'
		});
		expect(r.ok).toBe(true);
		expect(r.moves).toHaveLength(1);
		expect(r.moves[0].bookingId).toBe('B');
		expect(r.moves[0].toTables).toEqual(['t5']); // only other 2–4 top
	});

	it('reseats MULTIPLE displaced bookings (join target displaces two)', () => {
		const r = plan({
			bookings: [
				bk('D', 8, '12:00', '13:30', ['t1']),
				bk('B', 4, '19:00', '21:00', ['t4']),
				bk('C', 4, '19:00', '21:00', ['t5'])
			],
			draggedId: 'D',
			target: ['t4', 't5'], // an 8-top join
			from: '19:00',
			to: '20:30'
		});
		expect(r.ok).toBe(true);
		const moved = Object.fromEntries(r.moves.map((m) => [m.bookingId, m.toTables]));
		expect(Object.keys(moved).sort()).toEqual(['B', 'C']);
		// both re-homed to the free 4–6 tops, never back onto the target
		expect(moved.B.concat(moved.C).sort()).toEqual(['t6', 't7']);
	});

	it('reseats a JOINED displaced booking onto another fitting join', () => {
		const r = plan({
			bookings: [
				bk('D', 2, '12:00', '13:30', ['t1']),
				bk('B', 8, '19:00', '21:00', ['t4', 't5']) // a joined party of 8
			],
			draggedId: 'D',
			target: ['t4'], // dragged only needs t4, but that breaks B's join
			from: '19:00',
			to: '20:30'
		});
		expect(r.ok).toBe(true);
		expect(r.moves).toHaveLength(1);
		expect(r.moves[0].bookingId).toBe('B');
		expect(r.moves[0].toTables.sort()).toEqual(['t6', 't7']); // the only free 8-cap join
	});

	it('fails when a SEATED party occupies the target (never bumps a seated guest)', () => {
		const r = plan({
			bookings: [
				bk('D', 4, '12:00', '13:30', ['t2']),
				bk('S', 4, '19:00', '21:00', ['t4'], 'seated')
			],
			draggedId: 'D',
			target: ['t4'],
			from: '19:00',
			to: '20:30'
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/can't be moved/i);
		expect(r.moves).toEqual([]);
	});

	it('fails when the party is too big for the target table', () => {
		const r = plan({
			bookings: [bk('D', 6, '12:00', '13:30', ['t6'])],
			draggedId: 'D',
			target: ['t1'], // seats 2
			from: '19:00',
			to: '20:30'
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/too small/i);
	});

	it('fails when a displaced booking has nowhere free to go (no single AND no join)', () => {
		// Every table that could seat a party of 4 — singly or as a join — is taken.
		const r = plan({
			bookings: [
				bk('D', 4, '12:00', '13:30', ['t3']),
				bk('B', 4, '19:00', '21:00', ['t4']),
				bk('X', 4, '19:00', '21:00', ['t5']), // t5 taken
				bk('Y', 6, '19:00', '21:00', ['t6']), // t6 taken
				bk('Z', 6, '19:00', '21:00', ['t7']), // t7 taken
				bk('P', 2, '19:00', '21:00', ['t1']), // kills the t1+t2 join
				bk('Q', 2, '19:00', '21:00', ['t2'])
			],
			draggedId: 'D',
			target: ['t4'],
			from: '19:00',
			to: '20:30'
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/no free table/i);
	});

	it('refuses a drop onto a CLOSED-OUT target table', () => {
		const r = plan({
			bookings: [bk('D', 4, '12:00', '13:30', ['t1'])],
			draggedId: 'D',
			target: ['t4'],
			from: '19:00',
			to: '20:30',
			closeouts: [closeout('t4', '18:00', '22:00')]
		});
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/closed out/i);
	});

	it('never re-homes a displaced booking onto a closed-out table', () => {
		// B displaced from t4; t5 is CLOSED, so it must go to a 4–6 top instead of the nearer t5.
		const r = plan({
			bookings: [
				bk('D', 4, '12:00', '13:30', ['t1']),
				bk('B', 4, '19:00', '21:00', ['t4'])
			],
			draggedId: 'D',
			target: ['t4'],
			from: '19:00',
			to: '20:30',
			closeouts: [closeout('t5', '18:00', '22:00')]
		});
		expect(r.ok).toBe(true);
		expect(r.moves).toHaveLength(1);
		expect(r.moves[0].bookingId).toBe('B');
		expect(r.moves[0].toTables).not.toContain('t5'); // avoided the closed table
		expect(r.moves[0].toTables).toEqual(['t6']); // next smallest fit
	});

	it('does NOT displace a booking on the target table whose time does not overlap', () => {
		const r = plan({
			bookings: [
				bk('D', 4, '12:00', '13:30', ['t2']),
				bk('Late', 4, '21:00', '23:00', ['t4']) // same table, but after the drop window
			],
			draggedId: 'D',
			target: ['t4'],
			from: '19:00',
			to: '20:30' // ends before Late starts
		});
		expect(r.ok).toBe(true);
		expect(r.moves).toEqual([]);
	});
});
