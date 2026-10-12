// Reporting queries — covers / occupancy aggregation over a date range.
//
// Pure PocketBase aggregation (NOT the LLM): the AI tool wraps this, never the
// other way round. Computed server-side and paginated so the 1GB no-swap droplet
// never loads thousands of rows at once (see IMPLEMENTATION_PLAN.md WP-CRM-5).
//
// Also the home of the shared CSV serialiser (toCsv) consumed by WP-CRM-3/6.
// Server-only (imports the superuser client via queries.ts helpers).

import { pb } from '../db/pb.js';
import type { Booking, BookingSource, BrandId } from '../db/types.js';
import { getRestaurant, getTables, toPbDateFilter } from './queries.js';
import { listPeriods } from './admin.js';

/** Statuses that count toward covers (a seated/served guest). Mirrors the
 *  occupancy set used by the availability engine; cancelled/no_show are tracked
 *  separately so the report can show lost covers without double-counting. */
const COUNTED_STATUSES = new Set(['pending_payment', 'confirmed', 'seated', 'completed']);

/** Largest range we will aggregate, to bound work on the droplet. */
const MAX_RANGE_DAYS = 366;

/** Page size for the bookings fetch loop — modest to keep memory low. */
const PAGE_SIZE = 200;

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

// ---------------------------------------------------------------------------
// Public report shape
// ---------------------------------------------------------------------------

export interface CoversReport {
	brand: BrandId;
	from: string; // 'YYYY-MM-DD' (inclusive)
	to: string; // 'YYYY-MM-DD' (inclusive)
	totals: {
		bookings: number;
		covers: number;
		avgPartySize: number;
		cancelled: number;
		noShows: number;
	};
	byDay: Array<{
		date: string; // local 'YYYY-MM-DD'
		bookings: number;
		covers: number;
		cancelled: number;
		noShows: number;
	}>;
	byPeriod: Array<{
		periodId: string;
		periodName: string;
		bookings: number;
		covers: number;
	}>;
	occupancy: Array<{
		date: string;
		periodId: string;
		coversSeated: number;
		capacity: number; // sum of seats_max over bookable tables (a seat-capacity proxy)
		utilisation: number; // coversSeated / capacity, clamped 0..1
	}>;
}

// ---------------------------------------------------------------------------
// Date helpers (all wall-clock, Europe/London via the restaurant timezone)
// ---------------------------------------------------------------------------

/** Bucket an absolute instant into its local calendar date 'YYYY-MM-DD'.
 *  Uses en-CA (which renders YYYY-MM-DD) in the restaurant timezone so a booking
 *  that crosses a DST boundary still lands on the correct local day. */
export function localDate(instant: Date, timezone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(instant);
}

// The walk-in test lives in its own leaf module (admin.ts needs it too, and
// cannot import this file back). Re-exported here so the reports that have
// always read it from reporting.js keep working.
export { isWalkinBooking } from './walkin.js';

/** Inclusive day count between two 'YYYY-MM-DD' strings (UTC-noon to dodge DST). */
export function rangeDays(from: string, to: string): number {
	const a = Date.parse(`${from}T12:00:00Z`);
	const b = Date.parse(`${to}T12:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
	return Math.floor((b - a) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// Pure aggregation — bucket a flat list of bookings into a CoversReport.
// Exposed for unit tests so the engine can be exercised without a live PB.
// ---------------------------------------------------------------------------

export function bucketCovers(args: {
	brand: BrandId;
	from: string;
	to: string;
	timezone: string;
	capacity: number;
	bookings: Booking[];
	periodNames: Map<string, string>;
}): CoversReport {
	const { brand, from, to, timezone, capacity, bookings, periodNames } = args;

	let totalBookings = 0;
	let totalCovers = 0;
	let totalCancelled = 0;
	let totalNoShows = 0;

	type DayAgg = { bookings: number; covers: number; cancelled: number; noShows: number };
	const byDay = new Map<string, DayAgg>();
	const byPeriod = new Map<string, { bookings: number; covers: number }>();
	const occ = new Map<string, { date: string; periodId: string; coversSeated: number }>();

	for (const b of bookings) {
		const instant = new Date(b.starts_at);
		if (Number.isNaN(instant.getTime())) continue;
		const date = localDate(instant, timezone);

		const day = byDay.get(date) ?? { bookings: 0, covers: 0, cancelled: 0, noShows: 0 };

		if (b.status === 'cancelled') {
			totalCancelled++;
			day.cancelled++;
			byDay.set(date, day);
			continue;
		}
		if (b.status === 'no_show') {
			totalNoShows++;
			day.noShows++;
			byDay.set(date, day);
			continue;
		}
		if (!COUNTED_STATUSES.has(b.status)) {
			byDay.set(date, day);
			continue;
		}

		const covers = b.party_size || 0;
		totalBookings++;
		totalCovers += covers;
		day.bookings++;
		day.covers += covers;
		byDay.set(date, day);

		const pid = b.service_period || '';
		const per = byPeriod.get(pid) ?? { bookings: 0, covers: 0 };
		per.bookings++;
		per.covers += covers;
		byPeriod.set(pid, per);

		const okey = `${date} ${pid}`;
		const o = occ.get(okey) ?? { date, periodId: pid, coversSeated: 0 };
		o.coversSeated += covers;
		occ.set(okey, o);
	}

	const byDayArr = [...byDay.entries()]
		.map(([date, v]) => ({ date, ...v }))
		.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

	const byPeriodArr = [...byPeriod.entries()]
		.map(([periodId, v]) => ({
			periodId,
			periodName: periodNames.get(periodId) ?? (periodId ? periodId : '(unassigned)'),
			...v
		}))
		.sort((x, y) => y.covers - x.covers);

	const occupancyArr = [...occ.values()]
		.map((o) => ({
			date: o.date,
			periodId: o.periodId,
			coversSeated: o.coversSeated,
			capacity,
			utilisation: capacity > 0 ? Math.min(1, Math.max(0, o.coversSeated / capacity)) : 0
		}))
		.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.periodId < y.periodId ? -1 : 1));

	return {
		brand,
		from,
		to,
		totals: {
			bookings: totalBookings,
			covers: totalCovers,
			avgPartySize: totalBookings > 0 ? totalCovers / totalBookings : 0,
			cancelled: totalCancelled,
			noShows: totalNoShows
		},
		byDay: byDayArr,
		byPeriod: byPeriodArr,
		occupancy: occupancyArr
	};
}

// ---------------------------------------------------------------------------
// Paginated fetch — bounds memory by pulling PAGE_SIZE rows at a time.
// ---------------------------------------------------------------------------

/** Fetch every booking for a restaurant whose start instant falls in the
 *  [fromISO, toISO] window, one page at a time. Returns the flat array. The
 *  window is widened by callers to span the local-date range; bucketing then
 *  re-filters by local date. */
async function pageBookings(
	restaurantId: string,
	fromISO: string,
	toISO: string
): Promise<ReportBooking[]> {
	const c = await pb();
	const from = toPbDateFilter(fromISO);
	const to = toPbDateFilter(toISO);
	const filter = `restaurant=${q(restaurantId)} && starts_at>=${q(from)} && starts_at<=${q(to)}`;

	const out: ReportBooking[] = [];
	let page = 1;
	// Loop pages until PB reports no more (totalPages from the list result).
	for (;;) {
		const res = await c.collection('geisha_bookings').getList<ReportBooking>(page, PAGE_SIZE, {
			filter,
			sort: 'starts_at',
			// The guest name is load-bearing for isWalkinBooking — a walk-in typed
			// into the ordinary Book form carries no other walk-in signal.
			expand: 'customer'
		});
		out.push(...res.items);
		if (page >= res.totalPages || res.items.length === 0) break;
		page++;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Shared range fetch.
// ---------------------------------------------------------------------------

/**
 * ONE booking pull for a local date range, reusable by every report built over
 * that same range.
 *
 * PERF: the reports page shows Covers, No-shows and Reservations-vs-Walk-ins for
 * a single range, and each report used to run its own identical `pageBookings`
 * over that range — three copies of the same query, the same rows, the same
 * local-date re-filter, one after another. Fetch once, bucket three times: the
 * bucket functions are already pure, so nothing else has to change.
 *
 * Every report entry point still takes its own fetch path when called alone (the
 * CSV export endpoints do), so this is an optimisation, not a new requirement.
 */
/** A report booking with the guest expanded — see isWalkinBooking's third test. */
export type ReportBooking = Booking & {
	expand?: { customer?: { name?: string } | null } | null;
};

export interface ReportBookings {
	from: string; // 'YYYY-MM-DD' inclusive
	to: string; // 'YYYY-MM-DD' inclusive
	restaurantId: string;
	timezone: string;
	/** Already re-filtered to the exact local-date window. */
	bookings: ReportBooking[];
}

/** Shared guard: reject a malformed or oversized range before any I/O. */
export function assertReportRange(fromDate: string, toDate: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
		throw new Error("Dates must be 'YYYY-MM-DD'.");
	}
	if (fromDate > toDate) {
		throw new Error('The start date must be on or before the end date.');
	}
	const span = rangeDays(fromDate, toDate);
	if (Number.isNaN(span)) throw new Error('Invalid date range.');
	if (span > MAX_RANGE_DAYS) {
		throw new Error(`Date range too large (${span} days); the maximum is ${MAX_RANGE_DAYS} days.`);
	}
}

export async function fetchReportBookings(
	brand: BrandId,
	fromDate: string,
	toDate: string
): Promise<ReportBookings> {
	assertReportRange(fromDate, toDate);

	const restaurant = await getRestaurant(brand);
	const tz = restaurant.timezone || 'Europe/London';

	// Widen the absolute window by a day on each side so a booking that starts
	// late on the boundary day (UTC) still lands inside the fetch; the re-filter
	// below then trims to the exact local-date range.
	const fromISO = `${fromDate}T00:00:00.000Z`;
	const toISO = new Date(Date.parse(`${toDate}T00:00:00.000Z`) + 2 * 86_400_000).toISOString();

	const bookings = await pageBookings(restaurant.id, fromISO, toISO);
	const inRange = bookings.filter((b) => {
		const instant = new Date(b.starts_at);
		if (Number.isNaN(instant.getTime())) return false;
		const d = localDate(instant, tz);
		return d >= fromDate && d <= toDate;
	});

	return {
		from: fromDate,
		to: toDate,
		restaurantId: restaurant.id,
		timezone: tz,
		bookings: inRange
	};
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Covers / occupancy report for a brand over an inclusive local date range.
 * Pure PB aggregation — never the LLM. Rejects ranges over MAX_RANGE_DAYS.
 *
 * `pre` is an already-fetched pull for the SAME brand and range (see
 * fetchReportBookings) — pass it when several reports share one range and this
 * skips its own booking query.
 */
export async function getCoversReport(
	brand: BrandId,
	fromDate: string,
	toDate: string,
	pre?: ReportBookings
): Promise<CoversReport> {
	assertReportRange(fromDate, toDate);

	const shared = pre ?? (await fetchReportBookings(brand, fromDate, toDate));
	const tz = shared.timezone;

	const [tables, periods] = await Promise.all([getTables(shared.restaurantId), listPeriods(brand)]);

	// Seat-capacity proxy: sum of seats_max over the bookable tables. Crude
	// (ignores turns/time-of-day) — labelled 'seat utilisation' in the UI.
	const capacity = tables
		.filter((t) => t.bookable)
		.reduce((sum, t) => sum + (t.seats_max || 0), 0);

	const periodNames = new Map(periods.map((p) => [p.id, p.name]));
	const inRange = shared.bookings;

	return bucketCovers({
		brand,
		from: fromDate,
		to: toDate,
		timezone: tz,
		capacity,
		bookings: inRange,
		periodNames
	});
}

// ===========================================================================
// WP-CRM-6 — no-show rate + channel breakdown report.
// ===========================================================================

/** The booking sources we report a channel row for, plus a catch-all bucket. */
const REPORTED_SOURCES: BookingSource[] = ['online', 'phone', 'walkin', 'ai'];
/** Human labels for the channel column (the empty/unknown source folds here). */
const SOURCE_LABELS: Record<string, string> = {
	online: 'Online',
	phone: 'Phone',
	walkin: 'Walk-in',
	ai: 'AI assistant',
	unknown: 'Unknown'
};

/** A booking is "resolved" (its outcome is known) once it's been honoured,
 *  cancelled or marked a no-show — the denominator for a no-show RATE. Live,
 *  not-yet-happened bookings (pending_payment/confirmed) are excluded so the rate
 *  isn't diluted by the future. */
const RESOLVED_STATUSES = new Set(['seated', 'completed', 'cancelled', 'no_show']);

export interface NoShowReport {
	brand: BrandId;
	from: string; // 'YYYY-MM-DD' inclusive
	to: string; // 'YYYY-MM-DD' inclusive
	totals: {
		resolved: number; // honoured + cancelled + no_show (the rate denominator)
		honoured: number; // seated + completed
		cancelled: number;
		noShows: number;
		noShowRate: number; // noShows / resolved, 0..1
		cancelRate: number; // cancelled / resolved, 0..1
	};
	byChannel: Array<{
		source: string; // canonical source key ('online'|'phone'|'walkin'|'ai'|'unknown')
		label: string;
		resolved: number;
		honoured: number;
		cancelled: number;
		noShows: number;
		noShowRate: number;
	}>;
	byDay: Array<{
		date: string; // local 'YYYY-MM-DD'
		resolved: number;
		noShows: number;
		cancelled: number;
		noShowRate: number;
	}>;
}

/** Fold any stored source into a canonical channel key. */
function channelKey(source: Booking['source']): string {
	return source && (REPORTED_SOURCES as string[]).includes(source) ? source : 'unknown';
}

/**
 * Pure aggregation: bucket a flat list of bookings into a NoShowReport. Counts a
 * no-show RATE over *resolved* bookings only (live/future bookings are ignored so
 * the rate reflects realised outcomes), broken down by booking channel and by
 * local calendar day. Exposed for unit tests (no live PB).
 */
export function bucketNoShows(args: {
	brand: BrandId;
	from: string;
	to: string;
	timezone: string;
	bookings: Booking[];
}): NoShowReport {
	const { brand, from, to, timezone, bookings } = args;

	type Agg = { resolved: number; honoured: number; cancelled: number; noShows: number };
	const blank = (): Agg => ({ resolved: 0, honoured: 0, cancelled: 0, noShows: 0 });

	const totals = blank();
	const byChannel = new Map<string, Agg>();
	const byDay = new Map<string, Agg>();

	for (const b of bookings) {
		if (!RESOLVED_STATUSES.has(b.status)) continue;
		const instant = new Date(b.starts_at);
		if (Number.isNaN(instant.getTime())) continue;
		const date = localDate(instant, timezone);
		const ch = channelKey(b.source);

		const day = byDay.get(date) ?? blank();
		const chan = byChannel.get(ch) ?? blank();

		const tally = (a: Agg) => {
			a.resolved++;
			if (b.status === 'no_show') a.noShows++;
			else if (b.status === 'cancelled') a.cancelled++;
			else a.honoured++; // seated | completed
		};
		tally(totals);
		tally(day);
		tally(chan);

		byDay.set(date, day);
		byChannel.set(ch, chan);
	}

	const rate = (n: number, d: number) => (d > 0 ? n / d : 0);

	const byChannelArr = [...byChannel.entries()]
		.map(([source, a]) => ({
			source,
			label: SOURCE_LABELS[source] ?? source,
			resolved: a.resolved,
			honoured: a.honoured,
			cancelled: a.cancelled,
			noShows: a.noShows,
			noShowRate: rate(a.noShows, a.resolved)
		}))
		.sort((x, y) => y.noShows - x.noShows || y.resolved - x.resolved);

	const byDayArr = [...byDay.entries()]
		.map(([date, a]) => ({
			date,
			resolved: a.resolved,
			noShows: a.noShows,
			cancelled: a.cancelled,
			noShowRate: rate(a.noShows, a.resolved)
		}))
		.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

	return {
		brand,
		from,
		to,
		totals: {
			resolved: totals.resolved,
			honoured: totals.honoured,
			cancelled: totals.cancelled,
			noShows: totals.noShows,
			noShowRate: rate(totals.noShows, totals.resolved),
			cancelRate: rate(totals.cancelled, totals.resolved)
		},
		byChannel: byChannelArr,
		byDay: byDayArr
	};
}

/**
 * No-show / cancellation report for a brand over an inclusive local date range,
 * with a per-channel breakdown. Pure PB aggregation — never the LLM. Reuses the
 * paginated fetch + local-date re-filter from the covers report. Rejects ranges
 * over MAX_RANGE_DAYS.
 */
export async function getNoShowReport(
	brand: BrandId,
	fromDate: string,
	toDate: string,
	pre?: ReportBookings
): Promise<NoShowReport> {
	assertReportRange(fromDate, toDate);

	const shared = pre ?? (await fetchReportBookings(brand, fromDate, toDate));

	return bucketNoShows({
		brand,
		from: fromDate,
		to: toDate,
		timezone: shared.timezone,
		bookings: shared.bookings
	});
}

// ---------------------------------------------------------------------------
// Shared CSV serialiser (WP-CRM-3/6 also consume this).
// ---------------------------------------------------------------------------

/**
 * Serialise rows to RFC 4180 CSV with a UTF-8 BOM (so Excel reads it as UTF-8).
 * Every field is quoted and embedded quotes are doubled — safe for commas,
 * newlines and leading-zero strings alike.
 */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
	const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
	const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
	return `﻿${lines.join('\r\n')}\r\n`;
}
