// Un-finishing a table must put the sitting back.
//
// Reported: a walk-in on the board as a FIVE MINUTE bar, still seated. Its history:
//
//   15:48:46 Georgia Fox: Made
//   15:48:47 Georgia Fox: Not Arrived → Fully Seated
//   15:49:53 Georgia Fox: → Finished          ← clearBooking truncated ends_at
//   15:50:14 Georgia Fox: Finished → Fully Seated
//
// clearBooking truncates ends_at to the moment the table was finished, on purpose: a
// finished bar should show how long the party ACTUALLY stayed, and free the table from
// now on. But re-seating restored only the STATUS. The truncation stayed, so a Finish
// tapped by mistake permanently shortened a LIVE sitting — here to the 5-minute floor
// clearBooking clamps to — and the board then believed table 2 freed immediately.
//
// The clear writes an audit row carrying the booking as it was, so the window it cut is
// recoverable exactly, including a sitting the host had deliberately resized. That is the
// value restored here — never a recomputed guess.

import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };

const bookings: Record<string, Row> = {};
let floorState: Row[] = [];
let auditLog: Row[] = [];

const collection = (name: string) => ({
	getOne: async (id: string) => {
		if (name === 'geisha_bookings') {
			if (!bookings[id]) throw new Error('not found: ' + id);
			return { ...bookings[id] };
		}
		return { id, name: 'Test', email: 'x@example.com', timezone: 'Europe/London' };
	},
	update: async (id: string, data: Record<string, unknown>) => {
		if (name === 'geisha_bookings') {
			bookings[id] = { ...bookings[id], ...data };
			return { ...bookings[id] };
		}
		const row = floorState.find((r) => r.id === id);
		if (row) Object.assign(row, data);
		return row ?? { id, ...data };
	},
	create: async (data: Record<string, unknown>) => {
		if (name === 'geisha_audit_log') {
			const row = { id: 'a' + (auditLog.length + 1), created: new Date().toISOString(), ...data } as Row;
			auditLog.push(row);
			return row;
		}
		const row = { id: 'fs' + (floorState.length + 1), ...data } as Row;
		if (name === 'geisha_floor_state') floorState.push(row);
		return row;
	},
	delete: async (id: string) => {
		floorState = floorState.filter((r) => r.id !== id);
		return true;
	},
	getFullList: async () => (name === 'geisha_floor_state' ? floorState.map((r) => ({ ...r })) : []),
	// Enough of PocketBase's filter syntax for the one lookup the restore does:
	// entity_id="…" && action="clear_booking", newest first.
	getFirstListItem: async (filter: string) => {
		if (name !== 'geisha_audit_log') throw new Error('not found');
		const idMatch = /entity_id="([^"]+)"/.exec(filter);
		const actionMatch = /action="([^"]+)"/.exec(filter);
		const hit = [...auditLog]
			.reverse()
			.find(
				(r) =>
					(!idMatch || r.entity_id === idMatch[1]) && (!actionMatch || r.action === actionMatch[1])
			);
		if (!hit) throw new Error('not found');
		return { ...hit };
	}
});

vi.mock('../db/pb.js', () => ({ pb: async () => ({ collection }) }));
vi.mock('./payments.js', () => ({
	settleNoShowMoney: async () => ({ kind: 'none' }),
	releaseHold: async () => {},
	refundDeposit: async () => {}
}));
vi.mock('../email/confirmations.js', () => ({ sendCancellation: async () => {} }));
vi.mock('./crm.js', () => ({
	recomputeCustomerCounters: async () => {},
	setCustomerBlocked: async () => {}
}));

const { seatBooking, clearBooking, resetArrival } = await import('./mutate.js');

const START = '2026-09-09T18:00:00.000Z';
const FULL_END = '2026-09-09T20:00:00.000Z'; // the two-hour sitting it was booked for

function seed(id: string, over: Partial<Row> = {}) {
	bookings[id] = {
		id,
		status: 'seated',
		floor_status: '',
		starts_at: START,
		ends_at: FULL_END,
		party_size: 2,
		tables: ['t1'],
		customer: 'c1',
		restaurant: 'r1',
		...over
	} as Row;
	return bookings[id];
}

beforeEach(() => {
	for (const k of Object.keys(bookings)) delete bookings[k];
	floorState = [];
	auditLog = [];
});

describe('un-finishing restores the sitting the finish cut short', () => {
	it('re-seating a finished booking puts its end time back', async () => {
		seed('b1');
		// Finished five minutes in — clearBooking clamps to its 5-minute floor.
		await clearBooking('b1', '2026-09-09T18:04:00.000Z', 'staff', 'staff-1');
		expect(bookings.b1.status).toBe('completed');
		expect(bookings.b1.ends_at).toBe('2026-09-09T18:05:00.000Z'); // truncated

		await seatBooking('b1', '2026-09-09T18:06:00.000Z', 'staff', undefined, 'staff-1');

		expect(bookings.b1.status).toBe('seated');
		expect(bookings.b1.ends_at).toBe(FULL_END); // left truncated before the fix
	});

	it('reset-arrival on a finished booking puts its end time back too', async () => {
		seed('b2');
		await clearBooking('b2', '2026-09-09T18:04:00.000Z', 'staff', 'staff-1');
		expect(bookings.b2.ends_at).toBe('2026-09-09T18:05:00.000Z');

		await resetArrival('b2', 'staff', 'staff-1');

		expect(bookings.b2.status).toBe('confirmed');
		expect(bookings.b2.ends_at).toBe(FULL_END);
	});

	it('restores a sitting the host had deliberately resized, not a recomputed turn', async () => {
		// A 45-minute sitting the host shortened by hand. Recomputing the party's standard
		// turn would hand back two hours and quietly undo their edit; the audit snapshot
		// gives back exactly what was there.
		const RESIZED_END = '2026-09-09T18:45:00.000Z';
		seed('b3', { ends_at: RESIZED_END });
		await clearBooking('b3', '2026-09-09T18:20:00.000Z', 'staff', 'staff-1');
		expect(bookings.b3.ends_at).toBe('2026-09-09T18:15:00.000Z'); // back to its cell's start

		await seatBooking('b3', '2026-09-09T18:21:00.000Z', 'staff', undefined, 'staff-1');
		expect(bookings.b3.ends_at).toBe(RESIZED_END);
	});

	it('seating a normal upcoming booking leaves its window alone', async () => {
		seed('b4', { status: 'confirmed' });
		await seatBooking('b4', '2026-09-09T18:00:00.000Z', 'staff', undefined, 'staff-1');
		expect(bookings.b4.status).toBe('seated');
		expect(bookings.b4.ends_at).toBe(FULL_END);
	});

	it('does not lengthen a booking whose clear never truncated it', async () => {
		// Clearing a booking from ANOTHER day is data cleanup, not a live finish, so
		// clearBooking leaves ends_at alone. Re-seating must not invent a change either.
		seed('b5', { starts_at: '2026-09-01T18:00:00.000Z', ends_at: '2026-09-01T20:00:00.000Z' });
		await clearBooking('b5', '2026-09-09T18:04:00.000Z', 'staff', 'staff-1');
		expect(bookings.b5.ends_at).toBe('2026-09-01T20:00:00.000Z'); // untouched

		await seatBooking('b5', '2026-09-09T18:06:00.000Z', 'staff', undefined, 'staff-1');
		expect(bookings.b5.ends_at).toBe('2026-09-01T20:00:00.000Z');
	});
});

// Owner, 2026-09-19: "when you finish the table, make the time block go back, not
// forward". A finish lands on the start of the diary's 15-minute cell, never after it,
// and never past the booked end.
describe('Finish cuts the sitting back, never forward', () => {
	it('ends a sitting finished mid-cell at the start of that cell', async () => {
		seed('f1');
		floorState.push({ id: 'fs-f1', booking: 'f1', table: 't1', seated_at: START });
		await clearBooking('f1', '2026-09-09T19:05:00.000Z', 'staff', 'staff-1');
		expect(bookings.f1.status).toBe('completed');
		expect(bookings.f1.ends_at).toBe('2026-09-09T19:00:00.000Z'); // not 19:05, drawn to 19:15
		// the exact minute is still on the seating, for turn times
		expect(floorState.find((r) => r.id === 'fs-f1')?.cleared_at).toBe('2026-09-09T19:05:00.000Z');
	});

	it('keeps a finish that lands exactly on a cell boundary', async () => {
		seed('f2');
		await clearBooking('f2', '2026-09-09T19:30:00.000Z', 'staff', 'staff-1');
		expect(bookings.f2.ends_at).toBe('2026-09-09T19:30:00.000Z');
	});

	it('never lengthens a party that overstayed its booking', async () => {
		seed('f3');
		await clearBooking('f3', '2026-09-09T20:10:00.000Z', 'staff', 'staff-1');
		expect(bookings.f3.status).toBe('completed');
		expect(bookings.f3.ends_at).toBe(FULL_END); // was stretched to 20:10
	});

	it('never collapses a sitting finished in its first minutes', async () => {
		seed('f4');
		await clearBooking('f4', '2026-09-09T18:02:00.000Z', 'staff', 'staff-1');
		expect(bookings.f4.ends_at).toBe('2026-09-09T18:05:00.000Z'); // the 5-minute floor
	});
});
