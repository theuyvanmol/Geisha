// Running order (ResDiary parity) — PURE helpers for sorting, filtering and CSV
// export of the day's bookings list, so they're unit-testable without a browser.
// The run-sheet page renders this; the CSV endpoint reuses csvFromRows().

export interface RunningOrderRow {
	time: string;
	ends: string;
	startMs: number;
	partySize: number;
	guest: string;
	tableLabels: string[];
	section: string;
	period: string;
	channel: string;
	/** Seated off the street rather than reserved ahead (drives the walk-in split). */
	walkin: boolean;
	phone: string;
	status: string;
	occasion: string;
	preorder: string;
	allergies: string[];
	dietary: string[];
	/** Marked VIP on the guest record (counted in the summary bar). */
	vip?: boolean;
	/** Any allergy signal at all — the summary bar's alert count. */
	hasAllergy?: boolean;
}

export type SortKey = 'time' | 'guest' | 'partySize' | 'section' | 'status';

/** The run-sheet's headline totals. Derived from whatever rows are ON SCREEN —
 *  filter the run-sheet to Lunch and these must be Lunch's numbers, not the day's. */
export interface RunningOrderSummary {
	bookings: number;
	covers: number;
	reservations: number;
	reservationCovers: number;
	walkins: number;
	walkinCovers: number;
	allergyAlerts: number;
	vips: number;
}

/**
 * Total a set of run-sheet rows.
 *
 * Deliberately takes the rows rather than the day: the run-sheet's Service / Area
 * pickers narrow the list, and the headline totals have to narrow with it. They
 * used to be computed once on the server over the whole day, so picking "Lunch"
 * re-drew the table underneath an unchanged set of numbers — the owner read that
 * (correctly) as the filter not working.
 */
export function summariseRows(rows: RunningOrderRow[]): RunningOrderSummary {
	const s: RunningOrderSummary = {
		bookings: 0,
		covers: 0,
		reservations: 0,
		reservationCovers: 0,
		walkins: 0,
		walkinCovers: 0,
		allergyAlerts: 0,
		vips: 0
	};
	for (const r of rows) {
		const pax = r.partySize || 0;
		s.bookings += 1;
		s.covers += pax;
		if (r.walkin) {
			s.walkins += 1;
			s.walkinCovers += pax;
		} else {
			s.reservations += 1;
			s.reservationCovers += pax;
		}
		if (r.hasAllergy ?? r.allergies.length > 0) s.allergyAlerts += 1;
		if (r.vip) s.vips += 1;
	}
	return s;
}

/** The optional running-order columns the operator can show/hide (ResDiary's
 *  "choose which columns appear"). Time / Guest / Allergies are always shown. */
export type OptionalColumn = 'phone' | 'area' | 'service' | 'channel' | 'status' | 'occasion' | 'preorder';
export const OPTIONAL_COLUMNS: { key: OptionalColumn; label: string }[] = [
	{ key: 'area', label: 'Table / area' },
	{ key: 'service', label: 'Service' },
	{ key: 'status', label: 'Status' },
	{ key: 'channel', label: 'Channel' },
	{ key: 'phone', label: 'Phone' },
	{ key: 'occasion', label: 'Occasion' },
	{ key: 'preorder', label: 'Preorder' }
];

/** One 'HH:mm' slot with the covers arriving in it (ResDiary's "bookings/covers
 *  per cover per time slot" condensed running order). `walkins`/`walkinCovers` are
 *  the share of that slot that walked in rather than reserved — a subset of
 *  `bookings`/`covers`, never an addition to them. */
export interface CoversSlot {
	time: string;
	bookings: number;
	covers: number;
	walkins: number;
	walkinCovers: number;
}

/** Aggregate rows into per-time-slot covers totals, ordered by time. Each row's
 *  `time` ('HH:mm') is the slot key; bookings + covers accumulate. */
export function coversPerSlot(rows: RunningOrderRow[]): CoversSlot[] {
	const byTime = new Map<string, CoversSlot>();
	for (const r of rows) {
		const slot = byTime.get(r.time) ?? {
			time: r.time,
			bookings: 0,
			covers: 0,
			walkins: 0,
			walkinCovers: 0
		};
		slot.bookings += 1;
		slot.covers += r.partySize;
		if (r.walkin) {
			slot.walkins += 1;
			slot.walkinCovers += r.partySize;
		}
		byTime.set(r.time, slot);
	}
	return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/** Sort a copy of the rows by a column (time is the natural default). */
export function sortRows<T extends RunningOrderRow>(rows: T[], key: SortKey, dir: 1 | -1 = 1): T[] {
	const cmp = (a: T, b: T): number => {
		switch (key) {
			case 'time':
				return a.startMs - b.startMs;
			case 'guest':
				return a.guest.localeCompare(b.guest);
			case 'partySize':
				return a.partySize - b.partySize;
			case 'section':
				return (a.section || '~').localeCompare(b.section || '~');
			case 'status':
				return a.status.localeCompare(b.status);
		}
	};
	return [...rows].sort((a, b) => cmp(a, b) * dir || a.startMs - b.startMs);
}

/** Filter rows to a service period and/or section ('' = no filter). */
export function filterRows<T extends RunningOrderRow>(rows: T[], period = '', section = ''): T[] {
	return rows.filter((r) => (!period || r.period === period) && (!section || r.section === section));
}

/**
 * The area names worth offering once `period` is chosen — i.e. the areas that
 * service actually uses, sorted.
 *
 * The two pickers are ANDed, so listing every area the DAY used lets the operator
 * build a pair that matches nothing: pick Lunch + Back Section, switch to Dinner,
 * and the sheet empties even though dinner is fully booked — the area came along
 * for the ride and nothing dines in the back at dinner. Narrowing the options (and
 * clearing a selection that falls out of them) makes that pair unconstructable.
 */
export function sectionsFor<T extends RunningOrderRow>(rows: T[], period = ''): string[] {
	const out = new Set<string>();
	for (const r of filterRows(rows, period)) if (r.section) out.add(r.section);
	return [...out].sort();
}

/** RFC-4180-ish CSV cell: quote when it contains a comma, quote, or newline. */
export function csvCell(value: string): string {
	const v = value ?? '';
	return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const CSV_COLUMNS: { header: string; get: (r: RunningOrderRow) => string }[] = [
	{ header: 'Time', get: (r) => r.time },
	{ header: 'Ends', get: (r) => r.ends },
	{ header: 'Covers', get: (r) => String(r.partySize) },
	{ header: 'Guest', get: (r) => r.guest },
	{ header: 'Phone', get: (r) => r.phone },
	{ header: 'Tables', get: (r) => r.tableLabels.join(' + ') },
	{ header: 'Section', get: (r) => r.section },
	{ header: 'Service', get: (r) => r.period },
	{ header: 'Channel', get: (r) => r.channel },
	{ header: 'Walk-in', get: (r) => (r.walkin ? 'Yes' : '') },
	{ header: 'Status', get: (r) => r.status },
	{ header: 'Occasion', get: (r) => r.occasion },
	{ header: 'Preorder', get: (r) => r.preorder },
	{ header: 'Allergies', get: (r) => r.allergies.join('; ') },
	{ header: 'Dietary', get: (r) => r.dietary.join('; ') }
];

/** Build the full CSV text (header + one row per booking) for export/print. */
export function csvFromRows(rows: RunningOrderRow[]): string {
	const head = CSV_COLUMNS.map((c) => csvCell(c.header)).join(',');
	const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(c.get(r))).join(','));
	return [head, ...body].join('\r\n');
}
