// WHICH SERVICE A STAFF SEAT OUTSIDE EVERY BOOKING WINDOW IS FILED UNDER.
//
// A booking's service is the period whose [start_time, last_booking_time] window
// contains its start. A staff MANUAL SEAT (a walk-in, an explicit table pick) is
// allowed outside every such window — a guest standing at the pass is seated whenever
// they turn up — so it needs a second rule, and create.ts and amend.ts share this one.
//
// It used to be "the period whose START is nearest". That filed a walk-in seated at
// 16:45 at Asia under Dinner: Daytime stops taking bookings at 16:30 but runs until
// 17:00, and 17:00 is closer to 16:45 than 12:00 is. The diary counted those parties in
// Daytime (it reads a bar's start against the service bands) while the run-sheet, which
// reads the stored service_period, counted them in Dinner — the owner's "the walk-ins on
// the run-sheet don't match" (18 Sep: two 16:45 walk-ins moved 4 covers into Dinner).
//
// So the service RUNNING at that moment — [start_time, end_time) — wins. Only a seat
// when no service is running (before opening, after close, Fusion's 16:45–17:00
// changeover) falls back to the nearest start, as before.

import { fromZonedTime } from 'date-fns-tz';

interface PeriodWindow {
	days_of_week?: number[];
	start_time: string;
	end_time: string;
}

/** A period with the window a BOOKING may be placed in. */
interface BookablePeriod extends PeriodWindow {
	last_booking_time: string;
}

/**
 * The service a booking is FILED under — the figure the run-sheet and the
 * Reservations-vs-Walk-ins report count it in.
 *
 * A RESERVATION belongs to the service whose booking window [start_time,
 * last_booking_time] contains it; null when none does (the caller decides: refuse
 * an online booking, or let a staff seat through on manualSeatPeriod).
 *
 * A WALK-IN belongs to the service that was RUNNING when they sat. The two rules
 * part company at exactly one moment — a service whose last booking goes out as it
 * ends. Fusion Lunch takes its last booking at 16:45 and ends at 16:45, and the
 * diary snaps a walk-in's bar back to its 15-minute cell, so parties seated at
 * 16:50 and 16:52 were stored at 16:45 and counted in a lunch that was over
 * (23 Sep 2026: Fusion dinner read 1 walk-in instead of 3). A 16:45 RESERVATION is
 * still the last lunch sitting, which is why only walk-ins take the running rule.
 */
export function periodForSeat<T extends BookablePeriod>(
	periods: T[],
	dow: number,
	localDay: string,
	ms: number,
	tz: string,
	opts: { walkin?: boolean } = {}
): T | null {
	if (opts.walkin) return manualSeatPeriod(periods, dow, localDay, ms, tz);
	const at = (hhmm: string) => fromZonedTime(`${localDay}T${hhmm}:00`, tz).getTime();
	return (
		periods.find(
			(p) =>
				p.days_of_week?.includes(dow) && ms >= at(p.start_time) && ms <= at(p.last_booking_time)
		) ?? null
	);
}

/**
 * The period a staff manual seat at `ms` is filed under when no period's booking window
 * contains it: the one running on this weekday, else the nearest start on this weekday,
 * else the nearest start on any day. Null only when there are no periods at all.
 */
export function manualSeatPeriod<T extends PeriodWindow>(
	periods: T[],
	dow: number,
	localDay: string,
	ms: number,
	tz: string
): T | null {
	const at = (hhmm: string) => fromZonedTime(`${localDay}T${hhmm}:00`, tz).getTime();
	const today = periods.filter((p) => p.days_of_week?.includes(dow));
	const running = today.find((p) => ms >= at(p.start_time) && ms < at(p.end_time));
	if (running) return running;
	const dist = (p: T) => Math.abs(ms - at(p.start_time));
	const byNearest = (a: T, b: T) => dist(a) - dist(b);
	return today.sort(byNearest)[0] ?? periods.slice().sort(byNearest)[0] ?? null;
}
