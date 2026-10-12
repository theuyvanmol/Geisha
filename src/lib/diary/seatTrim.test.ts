import { describe, it, expect } from 'vitest';
import { seatedBarStartMin, seatTrimFloors } from './seatTrim.js';

// The grid in these tests opens at 12:00 (axis minute 0). A 19:00–21:00 booking is
// therefore booked 420 → 540.
const BOOKED_START = 420; // 19:00
const BOOKED_END = 540; // 21:00
const at = (min: number | null, over: Partial<Parameters<typeof seatedBarStartMin>[0]> = {}) =>
	seatedBarStartMin({
		bookedStartMin: BOOKED_START,
		bookedEndMin: BOOKED_END,
		seatMin: min,
		clearedMin: null,
		...over
	});

describe('seatedBarStartMin', () => {
	it('leaves an unseated booking at its booked start', () => {
		expect(at(null)).toBe(BOOKED_START);
	});

	it('slides RIGHT to the seat time when the party sat down late', () => {
		expect(at(435)).toBe(435); // sat 19:15
	});

	it('slides LEFT to the seat time when the party sat down early', () => {
		expect(at(405)).toBe(405); // sat 18:45
	});

	it('leaves an exactly-on-time seat where it was booked', () => {
		expect(at(BOOKED_START)).toBe(BOOKED_START);
	});

	it('returns a NEGATIVE minute when they were sat before service opened', () => {
		// A 12:15 lunch booking (min 15 → 120) whose party was sat at 11:50, ten minutes
		// before the grid's left edge. The caller clamps this to 0, so the bar snaps flush
		// to the very left of the diary.
		expect(
			seatedBarStartMin({
				bookedStartMin: 15,
				bookedEndMin: 120,
				seatMin: -10,
				clearedMin: null
			})
		).toBe(-10);
	});

	it('keeps a sliver visible for a seat time on the booking end', () => {
		expect(at(BOOKED_END - 1)).toBe(BOOKED_END - 1);
	});

	it('IGNORES a stamp at or past the booked end (re-timed after seating)', () => {
		expect(at(BOOKED_END)).toBe(BOOKED_START);
		expect(at(BOOKED_END + 90)).toBe(BOOKED_START);
	});

	it('IGNORES a stamp more than one whole sitting before the booked start', () => {
		// The sitting is 120 min, so 19:00 − 120 = 17:00 (min 300) is the earliest credible
		// stamp. 16:59 is history from another service — or, in the live data, a future
		// booking hand-seated days beforehand.
		expect(at(300)).toBe(300); // exactly one sitting early — still honoured
		expect(at(299)).toBe(BOOKED_START);
		expect(at(-4000)).toBe(BOOKED_START); // stamped on an entirely different day
	});

	it('IGNORES an early stamp whose sitting already CLEARED before the booked start', () => {
		// Sat 18:10 and gone again by 18:50, on a booking since re-timed to 19:00: close
		// enough to pass the one-sitting bound, but the whole visit precedes the window.
		expect(at(370, { clearedMin: 410 })).toBe(BOOKED_START);
	});

	it('HONOURS an early stamp when the party stayed into the booked window', () => {
		// Sat 18:45, still there at 20:30 — a genuine early arrival, not stale history.
		expect(at(405, { clearedMin: 510 })).toBe(405);
	});

	it('honours an early stamp while the party is still down (no clear yet)', () => {
		expect(at(405, { clearedMin: null })).toBe(405);
	});

	it('trims a booking that starts before the grid, from a seat time inside it', () => {
		expect(
			seatedBarStartMin({
				bookedStartMin: -30,
				bookedEndMin: 90,
				seatMin: 15,
				clearedMin: null
			})
		).toBe(15);
	});
});

describe('seatTrimFloors', () => {
	// Fusion table 4, 9 Aug: Nicky 12:00–13:30 (min 0–90), Aaron 13:30–14:41 (90–161)
	// seated 13:28. His trimmed bar reached back to 13:28 and flagged both as overbooked.
	const NICKY = { bookingId: 'nicky', bookedStartMin: 0, endMin: 90 };
	const AARON = { bookingId: 'aaron', bookedStartMin: 90, endMin: 161 };

	it('floors a following sitting at the moment the table freed', () => {
		expect(seatTrimFloors([NICKY, AARON]).get('aaron')).toBe(90); // = Nicky's 13:30 finish
	});

	it('leaves the first sitting on a table unfloored', () => {
		expect(seatTrimFloors([NICKY, AARON]).has('nicky')).toBe(false);
	});

	it('never floors a bar later than its own booked start', () => {
		// The outgoing party is held past the newcomer's booked time — a genuine overbook.
		// The floor stops at 90, so the ⚠ and the split row both stand.
		const held = { bookingId: 'held', bookedStartMin: 0, endMin: 120 };
		expect(seatTrimFloors([held, AARON]).get('aaron')).toBe(90);
	});

	it('floors from the LATEST end when several sittings precede it', () => {
		const early = { bookingId: 'early', bookedStartMin: 0, endMin: 30 };
		const mid = { bookingId: 'mid', bookedStartMin: 15, endMin: 95 };
		expect(seatTrimFloors([early, mid, AARON]).get('aaron')).toBe(90);
	});

	it('returns nothing for a table with a single sitting', () => {
		expect(seatTrimFloors([AARON]).size).toBe(0);
		expect(seatTrimFloors([]).size).toBe(0);
	});

	it('floors a booking that runs from before the grid at 0, not below', () => {
		const overnight = { bookingId: 'overnight', bookedStartMin: -60, endMin: 20 };
		const next = { bookingId: 'next', bookedStartMin: 20, endMin: 100 };
		expect(seatTrimFloors([overnight, next]).get('next')).toBe(20);
		expect(seatTrimFloors([next, overnight]).has('overnight')).toBe(false);
	});

	it('is order-independent — the input is sorted into booked order', () => {
		expect(seatTrimFloors([AARON, NICKY])).toEqual(seatTrimFloors([NICKY, AARON]));
	});
});
