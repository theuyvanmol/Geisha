// Closures / blackout / private-hire predicates (BOOKING_SYSTEM_PLAN §4, WP-AVAIL-2).
//
// Deliberately PURE: these functions take the closure rules as arguments and do
// no database access. The DB read lives in queries.ts (getClosures); the engine
// and the write path call these predicates with the rows passed in. That keeps
// the rules fully unit-testable offline and reusable by availability + create.
//
// Closures are wall-clock CALENDAR dates (Europe/London), never instants. They
// are compared as 'YYYY-MM-DD' strings — which is date-correct because that
// format sorts lexicographically in calendar order — so we never convert them
// through Date()/UTC and never risk a timezone off-by-one.
//
// The two date predicates (weekday-of-date, does-this-rule-span-this-date) are shared
// with the admin Close-Outs CALENDAR, which is client-side and so cannot import from
// $lib/server. They live in $lib/service/closureCalendar.ts and are re-exported here:
// one implementation means the grid a manager paints can never disagree with the
// availability engine about which days a rule bites on.

import { dayOfWeekOf, closureSpansDate } from '../../service/closureCalendar.js';

export { dayOfWeekOf };

/**
 * Sentinel `section` value meaning "the WHOLE RESTAURANT", not one floor section.
 *
 * ResDiary lets you shut the entire restaurant for a slice of a service ("close the
 * restaurant 19:00–20:00"), not only for a whole day or a whole service. A section-scope
 * row carrying this sentinel does exactly that: every table, for the sub-window if one
 * is set, else the whole service. Stored in the same `section` text column, so it needs
 * no migration — and '*' can never collide with a real floor-section name.
 */
export const ALL_SECTIONS = '*';

/** True when a close-out targets the whole restaurant rather than one section/table. */
export const isWholeRestaurant = (rule: { section?: string; table?: string }): boolean =>
	!rule.table && rule.section === ALL_SECTIONS;

/** A single closure rule, normalised from a geisha_closures row. */
export interface ClosureRule {
	/** Inclusive first day, 'YYYY-MM-DD'. */
	dateFrom: string;
	/** Inclusive last day, 'YYYY-MM-DD'. Equal to dateFrom for a single day. */
	dateTo: string;
	/**
	 * 'full' closes the whole date; 'period' closes one service period; 'section'
	 * closes part of the room for one service (the diary "CloseOuts" grid). A
	 * 'section' row can target a whole floor SECTION (`section`) OR a single TABLE
	 * (`table`), for the WHOLE service or a sub-window (`timeFrom`/`timeTo`).
	 */
	scope: 'full' | 'period' | 'section';
	/** The closed service period id (required when scope === 'period' | 'section'). */
	servicePeriodId?: string;
	/** The closed floor-section name (section-scope, whole-section close-out). */
	section?: string;
	/**
	 * A single closed table id (section-scope, table close-out). When set it takes
	 * precedence over `section` — the block targets just this table.
	 */
	table?: string;
	/**
	 * Optional sub-service window ('HH:mm', local) the close-out applies to. Both set
	 * = block only [timeFrom, timeTo]; absent = the whole service period window.
	 */
	timeFrom?: string;
	timeTo?: string;
	/** 'holiday' | 'private_hire' | 'maintenance' (free-form for display). */
	kind: string;
	/** Human-readable reason (ResDiary "Description") shown to staff/guests. */
	reason: string;
	/** ResDiary "Name" — short label for the close-out. */
	name?: string;
	/**
	 * ResDiary "Periodic" mode: weekdays (0=Sun … 6=Sat) the close-out bites on WITHIN its
	 * date range. Empty/undefined = every day in the range (a one-off / "Manual" close-out).
	 */
	daysOfWeek?: number[];
	/**
	 * ResDiary "Type": which booking channel this close-out blocks — 'common' (both),
	 * 'internal' (in-house/staff only), 'online' (web only). Absent = 'common'.
	 */
	channelType?: 'common' | 'internal' | 'online';
	/** ResDiary "Colour": hex for the diary block. */
	colour?: string;
}

/**
 * True iff `date` falls within [dateFrom, dateTo] and (if periodic) on a listed weekday.
 * Delegates to the shared calendar predicate (see the file header).
 */
const spans = (rule: ClosureRule, date: string): boolean => closureSpansDate(rule, date);

/**
 * Filter close-outs to those that block a given booking CHANNEL (ResDiary "Type"). An
 * online guest isn't stopped by an 'internal'-only close-out, and a staff/in-house booking
 * isn't stopped by an 'online'-only one; 'common' (the default) blocks both. Diary DISPLAY
 * passes everything (staff should still see an online-only block); only the ENFORCEMENT
 * paths (availability = online, createBooking staff = internal) pre-filter with this.
 */
export function closuresForChannel(
	closures: ClosureRule[],
	channel: 'online' | 'internal'
): ClosureRule[] {
	const blocked = channel === 'online' ? 'internal' : 'online';
	return closures.filter((c) => (c.channelType ?? 'common') !== blocked);
}

/**
 * True if a FULL-scope closure spans `date` — i.e. the whole day is closed
 * regardless of service period.
 */
export function isDateClosed(date: string, closures: ClosureRule[] = []): boolean {
	return closures.some((c) => c.scope === 'full' && spans(c, date));
}

/**
 * True if the given service period is closed on `date`: either a full-day
 * closure spans the date, OR a period-scoped closure for that exact period id
 * spans it.
 */
export function isPeriodClosed(
	date: string,
	periodId: string,
	closures: ClosureRule[] = []
): boolean {
	if (isDateClosed(date, closures)) return true;
	return closures.some(
		(c) => c.scope === 'period' && c.servicePeriodId === periodId && spans(c, date)
	);
}

/**
 * Is a specific floor SECTION closed for a service period on `date`? True when the
 * whole day is closed, the service period is closed, OR a section-scope closeout for
 * that exact section + period spans the date. Section names compared verbatim.
 */
export function isSectionClosed(
	date: string,
	periodId: string,
	section: string,
	closures: ClosureRule[] = []
): boolean {
	if (isPeriodClosed(date, periodId, closures)) return true;
	return closures.some(
		(c) =>
			c.scope === 'section' &&
			c.servicePeriodId === periodId &&
			// A whole-restaurant close-out (section '*') closes EVERY section. Note it only
			// counts here when it shuts the whole service — a '*' row with a sub-window
			// blocks specific times, which the footprint/occupancy path handles instead.
			((c.section ?? '') === section || (isWholeRestaurant(c) && !c.timeFrom && !c.timeTo)) &&
			spans(c, date)
	);
}

/**
 * The set of floor-section names closed for a WHOLE service on `date` — i.e. the
 * section grid's checkboxes: a section-scope closeout with a `section`, NO specific
 * `table`, and NO sub-window (`timeFrom`/`timeTo`). Table close-outs and time-window
 * close-outs are surfaced separately by {@link sectionCloseoutsFor}. Used to seed the
 * CloseOuts grid's ticked cells and (via the availability engine) to build occupancy.
 */
export function closedSectionsFor(
	date: string,
	periodId: string,
	closures: ClosureRule[] = []
): Set<string> {
	const out = new Set<string>();
	for (const c of closures) {
		if (
			c.scope === 'section' &&
			c.servicePeriodId === periodId &&
			(c.section ?? '') !== '' &&
			// the whole-restaurant sentinel isn't a grid cell — it's listed on its own
			!isWholeRestaurant(c) &&
			!c.table &&
			!c.timeFrom &&
			!c.timeTo &&
			spans(c, date)
		) {
			out.add(c.section ?? '');
		}
	}
	return out;
}

/**
 * Every section-scope close-out (whole-section, single-table, and/or time-windowed)
 * that applies to `date` — for a given period, or for ALL periods when `periodId` is
 * omitted. This is the raw list the availability engine turns into synthetic table
 * occupancy, and the diary uses to draw close-out overlays and list active blocks.
 */
export function sectionCloseoutsFor(
	date: string,
	periodId: string | undefined,
	closures: ClosureRule[] = []
): ClosureRule[] {
	return closures.filter(
		(c) =>
			c.scope === 'section' &&
			(periodId === undefined || c.servicePeriodId === periodId) &&
			spans(c, date)
	);
}

/** Every closure rule that applies to `date` (full, period or section-scoped). */
export function activeClosuresFor(date: string, closures: ClosureRule[] = []): ClosureRule[] {
	return closures.filter((c) => spans(c, date));
}

/**
 * The reason to surface for a closed date: prefer a full-day closure's reason,
 * else the first applicable period closure's reason, else ''.
 */
export function closureReasonFor(date: string, closures: ClosureRule[] = []): string {
	const active = activeClosuresFor(date, closures);
	const full = active.find((c) => c.scope === 'full');
	return (full ?? active[0])?.reason ?? '';
}
