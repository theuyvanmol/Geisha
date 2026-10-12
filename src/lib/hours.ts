// Public opening hours, derived from the SAME bookable service periods the admin
// diary and the availability engine read (geisha_service_periods).
//
// Why this file exists: the guest site used to carry its own hardcoded hours
// table (src/lib/data/brand.ts) plus an editable `brand_info.hours` blob, while
// the diary ran off the service periods. Three sources, and they drifted —
// Fusion's footer said "12pm – 10pm" Mon–Thu while the diary (correctly) ran
// dinner to 23:00. Now the periods are the only source: this module turns them
// into every shape the public pages need (per-day rows, a collapsed list, a
// one-line strap, schema.org windows) so no page has to format times itself.
//
// Pure + client-safe. The server-side loader lives in
// src/lib/server/booking/hours.ts; the shapes are here so components can type
// against them.

import type { BrandId, DayHours } from '$lib/data/brand';

/** One bookable service on a given day, straight off the period record. */
export type HoursPeriod = { name: string; from: string; to: string; lastBooking: string };

export type HoursDay = {
	/** 'Monday' */
	day: string;
	/** 'Mon' */
	short: string;
	/** 0 = Sunday, matching ServicePeriod.days_of_week */
	dow: number;
	/** Services running this day, earliest first. Empty = closed. */
	periods: HoursPeriod[];
	/** Earliest start / latest end across the day's services, 'HH:mm'. */
	open: string | null;
	close: string | null;
	/** Latest last_booking_time across the day's services, 'HH:mm'. */
	lastBooking: string | null;
	/** Display string, e.g. '12pm – 11pm' or 'Closed'. */
	display: string;
};

export type PublicHours = {
	brand: BrandId;
	/** Always 7 entries, ordered Monday → Sunday. */
	days: HoursDay[];
	/** One row per day (Mon→Sun) for a full hours list. */
	summary: DayHours[];
	/** Consecutive days with identical hours merged, e.g. 'Monday – Saturday'. */
	compact: DayHours[];
	/** One-liner for tiles/meta, e.g. 'Open daily 12pm – 11pm'. */
	strap: string;
	/** e.g. 'Last bookings 9:15pm.' — derived from last_booking_time. */
	lastBookingNote: string;
	/** Editable editorial note (brand_info.hoursNote); kitchen/last-orders copy. */
	note: string;
	/** false when the service periods were unreachable and static copy was used. */
	live: boolean;
};

const DAY_NAMES = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
] as const;

/** Public reading order: Monday first, Sunday last. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const CLOSED = 'Closed';

/** '12:00' → '12pm', '19:30' → '7:30pm', '16:45' → '4:45pm'. */
export function fmtTime(t: string | null | undefined): string {
	const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
	if (!m) return t ?? '';
	const h24 = Number(m[1]) % 24;
	const min = m[2];
	const ap = h24 >= 12 ? 'pm' : 'am';
	const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
	return min === '00' ? `${h12}${ap}` : `${h12}:${min}${ap}`;
}

/** Inverse of fmtTime, for parsing the legacy '12pm – 11pm' static copy. */
export function parse12h(t: string): string {
	const m = t.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
	if (!m) return '00:00';
	let h = parseInt(m[1], 10);
	const min = m[2] ?? '00';
	const ap = m[3].toLowerCase();
	if (ap === 'pm' && h !== 12) h += 12;
	if (ap === 'am' && h === 12) h = 0;
	return `${String(h).padStart(2, '0')}:${min}`;
}

/** Minimal shape of a geisha_service_periods row (kept structural so the pure
 *  builder doesn't have to import the server-only db types). */
export type PeriodInput = {
	name: string;
	days_of_week: number[];
	start_time: string;
	end_time: string;
	last_booking_time: string;
};

/**
 * Turn the active service periods into every display shape the public pages need.
 *
 * A day with no period is genuinely closed — that's the same rule the engine
 * uses (listPeriodsForDate filters on days_of_week), so "Closed" here means
 * "the diary will not sell you a table".
 */
export function buildPublicHours(
	brand: BrandId,
	periods: PeriodInput[],
	note = ''
): PublicHours {
	const days: HoursDay[] = WEEK_ORDER.map((dow) => {
		const forDay = periods
			.filter((p) => Array.isArray(p.days_of_week) && p.days_of_week.includes(dow))
			.sort((a, b) => a.start_time.localeCompare(b.start_time))
			.map((p) => ({
				name: p.name,
				from: p.start_time,
				to: p.end_time,
				lastBooking: p.last_booking_time
			}));

		const open = forDay.length ? forDay[0].from : null;
		// Latest end, not the last period's end — periods aren't guaranteed to be
		// ordered by end time (a short late service could finish before a long one).
		const close = forDay.length
			? forDay.reduce((max, p) => (p.to > max ? p.to : max), forDay[0].to)
			: null;
		const lastBooking = forDay.length
			? forDay.reduce(
					(max, p) => (p.lastBooking && p.lastBooking > max ? p.lastBooking : max),
					forDay[0].lastBooking ?? ''
				) || null
			: null;

		return {
			day: DAY_NAMES[dow],
			short: DAY_NAMES[dow].slice(0, 3),
			dow,
			periods: forDay,
			open,
			close,
			lastBooking,
			display: open && close ? `${fmtTime(open)} – ${fmtTime(close)}` : CLOSED
		};
	});

	return {
		brand,
		days,
		summary: days.map((d) => ({ day: d.day, hours: d.display })),
		compact: collapse(days, (d) => d.display),
		strap: strapFor(days),
		lastBookingNote: lastBookingNoteFor(days),
		note,
		live: true
	};
}

/**
 * Fallback built from the static marketing copy in brand.ts, used only when the
 * service periods can't be read (PB down / pre-migration). Marked `live: false`
 * so callers can tell it apart; the site still renders rather than 500ing.
 */
export function staticPublicHours(
	brand: BrandId,
	staticHours: DayHours[],
	note = ''
): PublicHours {
	const byName = new Map(staticHours.map((h) => [h.day.toLowerCase(), h.hours]));
	const days: HoursDay[] = WEEK_ORDER.map((dow) => {
		const name = DAY_NAMES[dow];
		const display = byName.get(name.toLowerCase()) ?? CLOSED;
		const [openRaw, closeRaw] = display.split(/[–-]/).map((s) => s.trim());
		const closed = display === CLOSED || !openRaw || !closeRaw;
		return {
			day: name,
			short: name.slice(0, 3),
			dow,
			periods: [],
			open: closed ? null : parse12h(openRaw),
			close: closed ? null : parse12h(closeRaw),
			lastBooking: null,
			display
		};
	});

	return {
		brand,
		days,
		summary: days.map((d) => ({ day: d.day, hours: d.display })),
		compact: collapse(days, (d) => d.display),
		strap: strapFor(days),
		lastBookingNote: '',
		note,
		live: false
	};
}

/** Merge consecutive days (in Mon→Sun order) that share a value. */
function collapse(days: HoursDay[], value: (d: HoursDay) => string): DayHours[] {
	const out: DayHours[] = [];
	for (const d of days) {
		const v = value(d);
		const last = out[out.length - 1];
		if (last && last.hours === v) last.day = `${last.day.split(' – ')[0]} – ${d.day}`;
		else out.push({ day: d.day, hours: v });
	}
	return out;
}

/** Same as collapse but with short day names, for the compact strap. */
function collapseShort(days: HoursDay[], value: (d: HoursDay) => string): DayHours[] {
	const out: DayHours[] = [];
	for (const d of days) {
		const v = value(d);
		const last = out[out.length - 1];
		if (last && last.hours === v) last.day = `${last.day.split('–')[0]}–${d.short}`;
		else out.push({ day: d.short, hours: v });
	}
	return out;
}

function strapFor(days: HoursDay[]): string {
	const openDays = days.filter((d) => d.display !== CLOSED);
	if (!openDays.length) return '';
	const uniform = openDays.length === 7 && openDays.every((d) => d.display === openDays[0].display);
	if (uniform) return `Open daily ${openDays[0].display}`;
	return collapseShort(days, (d) => d.display)
		.filter((g) => g.hours !== CLOSED)
		.map((g) => `${g.day} ${g.hours}`)
		.join(' · ');
}

function lastBookingNoteFor(days: HoursDay[]): string {
	const withLast = days.filter((d) => d.lastBooking);
	if (!withLast.length) return '';
	const uniform = withLast.every((d) => d.lastBooking === withLast[0].lastBooking);
	if (uniform) return `Last bookings ${fmtTime(withLast[0].lastBooking)}.`;
	const groups = collapseShort(days, (d) => (d.lastBooking ? fmtTime(d.lastBooking) : CLOSED))
		.filter((g) => g.hours !== CLOSED)
		.map((g) => `${g.day} ${g.hours}`)
		.join(' · ');
	return `Last bookings — ${groups}.`;
}

/** schema.org openingHoursSpecification entries, 24h, closed days omitted. */
export function openingHoursSpecification(hours: PublicHours) {
	const dayMap: Record<string, string> = {
		Monday: 'Mo',
		Tuesday: 'Tu',
		Wednesday: 'We',
		Thursday: 'Th',
		Friday: 'Fr',
		Saturday: 'Sa',
		Sunday: 'Su'
	};
	return hours.days
		.filter((d) => d.open && d.close)
		.map((d) => ({
			'@type': 'OpeningHoursSpecification',
			dayOfWeek: dayMap[d.day],
			opens: d.open as string,
			closes: d.close as string
		}));
}
