// Per-date availability for a whole calendar month — the data behind the guest
// widget's inline date picker.
//
// WHY THIS EXISTS
// ---------------
// The embed widget used a native <input type="date">. Chrome renders no visible
// calendar affordance for it inside the frame, so guests saw a bare `07/08/2026`
// box with no hint a picker existed — and, worse, no sense of WHICH days are
// bookable. ResDiary showed a month grid with the open dates coloured, and losing
// that on the step where people decide whether to bother is a real downgrade.
//
// WHY NOT 31 CALLS TO getAvailability()
// -------------------------------------
// getAvailability() re-loads the entire configuration (periods, tables, joins,
// chains, auto-join policy, settings, pacing, ranks) on every call. Asking it for
// a month would be ~10 PocketBase round-trips per day, ~310 for a grid — against a
// 1GB droplet shared with three other clients' instances.
//
// checkAvailability() is a PURE function, so this loads the configuration ONCE,
// pulls the month's closures and occupying bookings in one ranged query each, and
// then runs the engine in memory per date. ~10 round-trips for the whole grid,
// and the per-date result is identical to what the day view would report — the
// calendar can never promise a date the booking step then refuses.
import { addDays, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { checkAvailability } from './availability.js';
import { closuresForChannel } from './closures.js';
import {
	getRestaurant,
	getActivePeriods,
	getTables,
	getJoins,
	getOccupyingBookings,
	getClosures,
	getPacingRules,
	getSettings
} from './queries.js';
import { getTableRanks } from './ranking.js';
import { getChainsByRestaurant } from './chains.js';
import { getAutoJoinByRestaurant, policyFor } from './autojoin.js';
import type { BrandId } from '../db/types.js';

/**
 * What the grid paints for one date.
 *   • 'open'    — at least one bookable slot for this party size
 *   • 'full'    — the restaurant runs, but nothing fits this party
 *   • 'closed'  — a closure, or no service period runs on this weekday
 *   • 'past'    — earlier than today, or inside the lead-time cut-off
 *   • 'beyond'  — past the booking window (settings.booking_window_days)
 * Only 'open' is selectable.
 */
export type DayStatus = 'open' | 'full' | 'closed' | 'past' | 'beyond';

export interface MonthDay {
	/** 'YYYY-MM-DD' */
	date: string;
	status: DayStatus;
	/** Shown as a tooltip on a closed date, when the closure names a reason. */
	reason?: string;
}

export interface MonthAvailability {
	brand: BrandId;
	/** 1-12. */
	month: number;
	year: number;
	partySize: number;
	/** Earliest / latest selectable date WITHIN THIS MONTH. */
	minDate: string;
	maxDate: string;
	/**
	 * The global booking horizon — today, and the last date bookable online
	 * (settings.booking_window_days). The month grid needs this to decide whether
	 * the prev/next arrows lead anywhere: "the furthest month we happen to have
	 * loaded" can't answer that without walking forward a month at a time, which
	 * disables the arrow on the very first render.
	 */
	horizon: { firstDate: string; lastDate: string };
	days: MonthDay[];
}

function daysInMonth(year: number, month: number): string[] {
	const out: string[] = [];
	// month is 1-12; day 0 of the NEXT month is the last day of this one.
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
	for (let d = 1; d <= last; d++) {
		out.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
	}
	return out;
}

export async function getMonthAvailability(
	brand: BrandId,
	year: number,
	month: number,
	partySize: number
): Promise<MonthAvailability> {
	const restaurant = await getRestaurant(brand);
	const tz = restaurant.timezone || 'Europe/London';
	const dates = daysInMonth(year, month);
	const first = dates[0];
	const last = dates[dates.length - 1];

	const [periods, tables, joins, chains, autoJoin, settings, closures, pacing, tableRanks] =
		await Promise.all([
			getActivePeriods(restaurant.id),
			getTables(restaurant.id),
			getJoins(restaurant.id),
			getChainsByRestaurant(restaurant.id).catch(() => []),
			getAutoJoinByRestaurant(restaurant.id),
			getSettings(restaurant.id),
			// One ranged query for the month instead of one per day.
			getClosures(restaurant.id, first, last),
			getPacingRules(restaurant.id),
			getTableRanks(brand)
		]);

	// Occupancy for the whole month in a single query. The +1 day / 06:00 tail
	// mirrors getAvailability(): a late sitting on the last night still occupies
	// tables past midnight, and dropping it would make that evening look emptier
	// than it is.
	const fromISO = `${first}T00:00:00.000Z`;
	const toISO = `${format(addDays(new Date(`${last}T00:00:00Z`), 1), 'yyyy-MM-dd')}T06:00:00.000Z`;
	const existing = await getOccupyingBookings(restaurant.id, fromISO, toISO);

	// The online channel only — this is the guest widget. An in-house-only close-out
	// must not grey out a date the public can still book.
	const onlineClosures = closuresForChannel(closures, 'online');
	const onlineJoins = policyFor(autoJoin, 'online');
	const nowMs = Date.now();

	const days: MonthDay[] = dates.map((date) => {
		const result = checkAvailability({
			date,
			partySize,
			timezone: tz,
			periods,
			tables,
			joins,
			chains,
			autoJoin: onlineJoins,
			// checkAvailability does its own date filtering on these, so handing it
			// the month's full set is correct — and far cheaper than slicing per day.
			existing,
			closures: onlineClosures,
			pacing,
			tableRanks,
			onlinePartyMax: settings.online_party_max,
			slotIntervalMinutes: settings.slot_interval_minutes,
			nowMs,
			bookingWindowDays: settings.booking_window_days,
			leadTimeMinutes: settings.lead_time_minutes,
			leadTimeMode: settings.lead_time_mode
		});

		if (result.slots.some((s) => s.available)) return { date, status: 'open' };

		if (result.closed) {
			return { date, status: 'closed', reason: result.closureReason || undefined };
		}

		// Nothing bookable — say WHY, using the reasons the engine already produced
		// per slot, so the grid's colour matches the message the day view would give.
		const reasons = new Set(result.slots.map((s) => s.unavailableReason).filter(Boolean));
		if (!result.slots.length) return { date, status: 'closed' };
		if (reasons.size && [...reasons].every((r) => r === 'beyond_window')) {
			return { date, status: 'beyond' };
		}
		if (reasons.size && [...reasons].every((r) => r === 'too_soon')) {
			return { date, status: 'past' };
		}
		return { date, status: 'full' };
	});

	const selectable = days.filter((d) => d.status === 'open').map((d) => d.date);

	// Horizon in the RESTAURANT's day, not the server's or the guest's — a booking
	// window is "N days from today in Newcastle", and a UTC-midnight server would
	// be a day out for part of every evening.
	const todayLocal = formatInTimeZone(new Date(nowMs), tz, 'yyyy-MM-dd');
	const windowDays = settings.booking_window_days ?? 0;
	const lastDate =
		windowDays > 0
			? format(addDays(new Date(`${todayLocal}T00:00:00Z`), windowDays), 'yyyy-MM-dd')
			: // No cap configured: let the guest page a year out rather than trapping
				// them on the current month.
				format(addDays(new Date(`${todayLocal}T00:00:00Z`), 365), 'yyyy-MM-dd');

	return {
		brand,
		month,
		year,
		partySize,
		minDate: selectable[0] ?? first,
		maxDate: selectable[selectable.length - 1] ?? last,
		horizon: { firstDate: todayLocal, lastDate },
		days
	};
}
