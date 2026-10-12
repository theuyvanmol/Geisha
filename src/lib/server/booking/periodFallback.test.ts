import { describe, it, expect } from 'vitest';
import { fromZonedTime } from 'date-fns-tz';
import { manualSeatPeriod, periodForSeat } from './periodFallback';

const TZ = 'Europe/London';
const DAY = '2026-09-18'; // a Friday (dow 5), BST
const DOW = 5;
const at = (hhmm: string) => fromZonedTime(`${DAY}T${hhmm}:00`, TZ).getTime();

// The live service periods (read from the droplet 2026-09-19).
const ALL = [0, 1, 2, 3, 4, 5, 6];
const MON_SAT = [1, 2, 3, 4, 5, 6];
const asia = [
	{
		id: 'daytime',
		days_of_week: ALL,
		start_time: '12:00',
		last_booking_time: '16:30',
		end_time: '17:00'
	},
	{
		id: 'dinner',
		days_of_week: ALL,
		start_time: '17:00',
		last_booking_time: '21:15',
		end_time: '23:00'
	}
];
const fusion = [
	{
		id: 'lunch',
		days_of_week: MON_SAT,
		start_time: '12:00',
		last_booking_time: '16:45',
		end_time: '16:45'
	},
	{
		id: 'dinner',
		days_of_week: MON_SAT,
		start_time: '17:00',
		last_booking_time: '21:30',
		end_time: '23:00'
	},
	{
		id: 'sunday',
		days_of_week: [0],
		start_time: '12:00',
		last_booking_time: '18:00',
		end_time: '19:30'
	}
];

const pick = (periods: typeof asia, hhmm: string, dow = DOW) =>
	manualSeatPeriod(periods, dow, DAY, at(hhmm), TZ)?.id;

describe('manualSeatPeriod', () => {
	it('files an Asia walk-in seated after last bookings but before Daytime ends under Daytime', () => {
		// 18 Sep: two walk-ins at 16:45 were filed under Dinner by the nearest-start rule.
		expect(pick(asia, '16:45')).toBe('daytime');
		expect(pick(asia, '16:59')).toBe('daytime');
	});

	it('hands over to Dinner at the moment Dinner starts', () => {
		expect(pick(asia, '17:00')).toBe('dinner');
	});

	it('files a seat after Dinner has ended under the nearest service (Dinner)', () => {
		expect(pick(asia, '23:15')).toBe('dinner');
	});

	it('files a seat before opening under the nearest service (Daytime)', () => {
		expect(pick(asia, '11:30')).toBe('daytime');
	});

	it("files a seat in Fusion's 16:45–17:00 changeover under Dinner (nothing is running)", () => {
		expect(pick(fusion, '16:50')).toBe('dinner');
	});

	it("only considers the day's own services when one is running", () => {
		// Sunday: Fusion runs only its Sunday service; 18:30 is inside it.
		expect(pick(fusion, '18:30', 0)).toBe('sunday');
	});

	it('falls back to any day when the weekday has no services', () => {
		const lunchOnlyWeekdays = [{ ...fusion[0] }];
		expect(pick(lunchOnlyWeekdays, '13:00', 0)).toBe('lunch');
	});

	it('returns null when there are no periods at all', () => {
		expect(manualSeatPeriod([], DOW, DAY, at('13:00'), TZ)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Which service a booking is FILED under — the number the run-sheet counts.
//
// 23 Sep 2026, the owner: "still the walk-ins for both Asia and Fusion are not
// accurate". Two Fusion parties seated at 16:50 and 16:52 sat under Lunch on the
// run-sheet, so Dinner read 1 walk-in instead of 3. The diary snaps a walk-in's bar
// back to its 15-minute cell, so both were stored as 16:45 — which is the last
// minute Fusion Lunch takes bookings, so the booking-window rule claimed them
// before the running-service rule (added 19 Sep) could be asked.
//
// A WALK-IN is therefore filed by the service running when they sat; a RESERVATION
// keeps the booking-window rule, so 16:45 stays the last lunch sitting.
// ---------------------------------------------------------------------------

describe('periodForSeat', () => {
	const seat = (periods: typeof fusion, hhmm: string, walkin: boolean, dow = DOW) =>
		periodForSeat(periods, dow, DAY, at(hhmm), TZ, { walkin })?.id ?? null;

	it('files a Fusion walk-in on the 16:45 cell under Dinner — lunch service has ended', () => {
		expect(seat(fusion, '16:45', true)).toBe('dinner');
	});

	it('leaves a 16:45 Fusion RESERVATION under Lunch — it is the last lunch sitting', () => {
		expect(seat(fusion, '16:45', false)).toBe('lunch');
	});

	it('keeps an Asia walk-in at 16:45 under Daytime, which runs until 17:00', () => {
		expect(seat(asia, '16:45', true)).toBe('daytime');
	});

	it('files ordinary walk-ins under the service they sat in', () => {
		expect(seat(fusion, '13:00', true)).toBe('lunch');
		expect(seat(fusion, '19:00', true)).toBe('dinner');
		expect(seat(asia, '12:30', true)).toBe('daytime');
	});

	it('gives a reservation NO service when it falls outside every booking window', () => {
		// The caller decides what to do about that: refuse an online booking, or let a
		// staff seat through on the manual-seat rule.
		expect(seat(fusion, '16:50', false)).toBeNull();
		expect(seat(asia, '16:45', false)).toBeNull();
	});
});
