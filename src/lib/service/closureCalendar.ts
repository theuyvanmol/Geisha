// Shared close-out CALENDAR model (ResDiary "Close-Outs" year grid).
//
// The Close-Outs page paints whole DATES closed or open across a date range — months
// down the page, weekday-aligned columns across it. Everything here is PURE and works
// on 'YYYY-MM-DD' CALENDAR strings (Europe/London wall-clock), never Date instants, so
// the grid can never drift a day across a timezone or a DST boundary. It is imported by
// BOTH the client page (to paint) and the server (to enforce), which is why it lives in
// $lib/service and not $lib/server.
//
// The date predicates (dayOfWeekOf / closureSpansDate) are the single source of truth
// for "does this rule bite on this date" — $lib/server/booking/closures.ts re-uses them
// so the calendar can never disagree with the availability engine.

/** A closure rule as the calendar needs to see it (a normalised geisha_closures row). */
export interface CalendarClosure {
	id: string;
	/** Inclusive first day, 'YYYY-MM-DD'. */
	dateFrom: string;
	/** Inclusive last day, 'YYYY-MM-DD' (equal to dateFrom for a single day). */
	dateTo: string;
	scope: 'full' | 'period' | 'section';
	/** The closed service period id (period- and section-scope). */
	servicePeriodId?: string;
	/** Floor-section name (section-scope); '*' is the whole-restaurant sentinel. */
	section?: string;
	/** A single closed table id (section-scope). */
	table?: string;
	/** Optional 'HH:mm' sub-window. */
	timeFrom?: string;
	timeTo?: string;
	/** Periodic weekdays (0=Sun … 6=Sat) the rule bites on; empty = every day in range. */
	daysOfWeek?: number[];
	name?: string;
	reason?: string;
	colour?: string;
	channelType?: 'common' | 'internal' | 'online';
}

/**
 * Day-of-week (0=Sun … 6=Sat) for a 'YYYY-MM-DD' CALENDAR date. Pure — no Date()/UTC,
 * so it is timezone-proof (a calendar date has exactly one weekday). Sakamoto's method.
 */
export function dayOfWeekOf(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
	const yy = m < 3 ? y - 1 : y;
	return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7;
}

/**
 * True iff `date` falls inside [dateFrom, dateTo] and — for a PERIODIC rule — on one of
 * its listed weekdays. A blank dateTo means a single day on dateFrom; an empty weekday
 * list means every day in the range (a one-off / "Manual" close-out).
 */
export function closureSpansDate(
	rule: { dateFrom: string; dateTo?: string; daysOfWeek?: number[] },
	date: string
): boolean {
	const to = rule.dateTo || rule.dateFrom;
	if (date < rule.dateFrom || date > to) return false;
	if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
		return rule.daysOfWeek.includes(dayOfWeekOf(date));
	}
	return true;
}

/** True when the rule recurs on weekdays rather than covering its whole range. */
export const isPeriodic = (c: { daysOfWeek?: number[] }): boolean =>
	Array.isArray(c.daysOfWeek) && c.daysOfWeek.length > 0;

// --- calendar-date arithmetic ('YYYY-MM-DD' in, 'YYYY-MM-DD' out) -------------
// Date.UTC is safe here: we only ever add whole days to a UTC midnight and read the
// date parts back, which is exact for calendar arithmetic and free of DST.

/** `date` shifted by whole days. */
export function shiftDay(date: string, delta: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export const nextDay = (date: string) => shiftDay(date, 1);
export const prevDay = (date: string) => shiftDay(date, -1);

/** Hard cap on how many days any one expansion may produce (runaway guard). */
export const MAX_RANGE_DAYS = 800;

/** Every date from `from` to `to` inclusive, capped at {@link MAX_RANGE_DAYS}. */
export function eachDate(from: string, to: string): string[] {
	if (!from || !to || to < from) return [];
	const out: string[] = [];
	let d = from;
	for (let i = 0; i < MAX_RANGE_DAYS && d <= to; i++) {
		out.push(d);
		d = nextDay(d);
	}
	return out;
}

/** Collapse a set of dates into inclusive contiguous [from,to] runs, in date order. */
export function toRanges(dates: Iterable<string>): { from: string; to: string }[] {
	const sorted = [...new Set(dates)].sort();
	const out: { from: string; to: string }[] = [];
	for (const d of sorted) {
		const last = out[out.length - 1];
		if (last && nextDay(last.to) === d) last.to = d;
		else out.push({ from: d, to: d });
	}
	return out;
}

// --- the month grid -----------------------------------------------------------

const MONTH_LABELS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

/** Weekday column headers, Monday-first (matching the ResDiary grid). */
export const WEEKDAY_HEADS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * The most week-columns a month row can ever need: a 31-day month starting on a Sunday
 * occupies six. Rows are TRIMMED to the widest month actually shown (see
 * {@link calendarMonths}) so a range of short months doesn't drag a scrollbar of empty
 * columns behind it — this is the ceiling, not the rendered width.
 */
export const WEEKS_PER_MONTH = 6;

/** One cell of a month row: a real date, or a leading/trailing blank. */
export interface CalCell {
	/** 'YYYY-MM-DD', or null for the padding cells before the 1st / after the last. */
	date: string | null;
	/** Day-of-month number (null cells have none). */
	day: number | null;
	/** 0=Sun … 6=Sat, for Sunday styling. */
	weekday: number;
	/** False when the date lies outside the viewed range (rendered inert). */
	inRange: boolean;
}

/** One month row of the calendar. */
export interface CalMonth {
	year: number;
	/** 1-12. */
	month: number;
	/** e.g. 'Jul 2026'. */
	label: string;
	/** Monday-first cells. Every row in one calendar has the SAME length, trimmed to the
	 *  widest month shown, so the columns line up down the page with no dead width. */
	cells: CalCell[];
}

/** How many columns the rows of a built calendar use (0 for an empty calendar). */
export const columnCount = (months: CalMonth[]): number => months[0]?.cells.length ?? 0;

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) =>
	`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Build the month rows covering [from, to] — one row per calendar month touched, each a
 * fixed 6×7 Monday-first grid so every column lines up down the page. Dates outside the
 * viewed range are still drawn (so a month never looks truncated) but flagged
 * `inRange: false` and rendered inert.
 *
 * Capped at 24 months: the page is a scannable overview, not a decade.
 */
export function calendarMonths(from: string, to: string): CalMonth[] {
	if (!from || !to || to < from) return [];
	const [fy, fm] = from.split('-').map(Number);
	const [ty, tm] = to.split('-').map(Number);
	const total = Math.min((ty - fy) * 12 + (tm - fm) + 1, 24);
	const out: CalMonth[] = [];
	for (let i = 0; i < total; i++) {
		const y = fy + Math.floor((fm - 1 + i) / 12);
		const m = ((fm - 1 + i) % 12) + 1;
		const first = iso(y, m, 1);
		// Monday-first offset: JS dow 0=Sun becomes column 6.
		const offset = (dayOfWeekOf(first) + 6) % 7;
		const len = daysInMonth(y, m);
		const cells: CalCell[] = [];
		for (let c = 0; c < WEEKS_PER_MONTH * 7; c++) {
			const dayNum = c - offset + 1;
			const weekday = (c + 1) % 7; // column 0 = Monday = JS dow 1
			if (dayNum < 1 || dayNum > len) {
				cells.push({ date: null, day: null, weekday, inRange: false });
				continue;
			}
			const date = iso(y, m, dayNum);
			cells.push({ date, day: dayNum, weekday, inRange: date >= from && date <= to });
		}
		out.push({ year: y, month: m, label: `${MONTH_LABELS[m - 1]} ${y}`, cells });
	}
	// Trim every row to the widest month on show. A 6-week grid is the worst case (a
	// 31-day month starting Sunday); most ranges need five, and leaving the extra week in
	// pushed a scrollbar's worth of empty columns onto the page.
	const used = out.reduce((max, m) => {
		const last = m.cells.reduce((n, c, i) => (c.date ? i : n), 0);
		return Math.max(max, last + 1);
	}, 0);
	// Keep whole weeks so the repeating weekday header still lines up.
	const cols = Math.ceil(used / 7) * 7;
	for (const m of out) m.cells = m.cells.slice(0, cols);
	return out;
}

// --- per-day state ------------------------------------------------------------

/** What is closed on one date, split by how completely it shuts the day. */
export interface DayState {
	/** A whole-day (scope 'full') closure, if any — the day takes no bookings at all. */
	full: CalendarClosure | null;
	/** Period-scope closures biting this date (a whole service shut). */
	periods: CalendarClosure[];
	/** Section / table / time-window close-outs biting this date (part of the room). */
	partial: CalendarClosure[];
}

const EMPTY_DAY: DayState = { full: null, periods: [], partial: [] };

/** Everything closed on `date`, bucketed by scope. */
export function dayState(date: string, closures: CalendarClosure[]): DayState {
	let full: CalendarClosure | null = null;
	const periods: CalendarClosure[] = [];
	const partial: CalendarClosure[] = [];
	for (const c of closures) {
		if (!closureSpansDate(c, date)) continue;
		if (c.scope === 'full') full ??= c;
		else if (c.scope === 'period') periods.push(c);
		else partial.push(c);
	}
	if (!full && !periods.length && !partial.length) return EMPTY_DAY;
	return { full, periods, partial };
}

/**
 * The state of every date in [from, to] as a lookup — one pass over the rules per day,
 * which is what the grid needs (a few hundred cells × a handful of rules).
 */
export function dayStates(
	from: string,
	to: string,
	closures: CalendarClosure[]
): Map<string, DayState> {
	const out = new Map<string, DayState>();
	for (const d of eachDate(from, to)) {
		const s = dayState(d, closures);
		if (s !== EMPTY_DAY) out.set(d, s);
	}
	return out;
}

/**
 * The fallback fill for a closed day cell — ResDiary's "Bookings unavailable" red. A
 * close-out that carries its own `colour` paints in that instead, so a recurring rule
 * reads as its own legend entry.
 */
export const MANUAL_CLOSED_COLOUR = '#e01b24';

/** A short human summary of what's closed on a day, for the cell tooltip. */
export function dayTooltip(
	date: string,
	state: DayState | undefined,
	periodName: (id: string | undefined) => string
): string {
	if (!state) return `${date} — open`;
	const bits: string[] = [];
	if (state.full) bits.push(`Closed all day${state.full.name ? ` (${state.full.name})` : ''}`);
	for (const p of state.periods) bits.push(`${periodName(p.servicePeriodId)} closed`);
	for (const p of state.partial) {
		const where = p.table ? 'a table' : p.section === '*' ? 'all areas' : p.section || 'an area';
		const when = p.timeFrom && p.timeTo ? ` ${p.timeFrom}–${p.timeTo}` : '';
		bits.push(`${where}${when} closed`);
	}
	return `${date} — ${bits.join('; ')}`;
}
