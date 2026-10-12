// Booking details rows — ONE ROW PER BOOKING over a date range.
//
// This is the ResDiary "Booking Details report": the flat, wide export managers
// actually download and pivot in Excel. Every other report on /admin/reports is
// an aggregate (covers per day, no-shows per channel, …); this is the underlying
// grain they are all rolled up FROM, which is why it exists as its own module
// rather than as another bucket* function in reporting.ts.
//
// Deliberately NOT rendered on screen — a month of bookings is thousands of
// cells and the browser is the wrong place for it. It is export-only, reached
// from the Download menu on any tab.
//
// Mirrors the conventions the other report builders already follow:
//   • paginated fetch, modest page size (1GB no-swap droplet)
//   • widened absolute fetch window, then re-filtered by LOCAL calendar date so
//     a late-evening booking on a boundary day lands on the right day
//   • pure row shaping split from the I/O so it can be unit-tested with no PB
//
// `leadTimeDays` is computed here rather than in a report of its own: it is the
// whole content of ResDiary's "Lead Time report" and it costs one subtraction,
// so every download carries it as a column.

import { pb } from '../db/pb.js';
import type { Booking, BrandId, Customer, DiningTable } from '../db/types.js';
import { getRestaurant, getTables, toPbDateFilter } from './queries.js';
import { listPeriods } from './admin.js';
import { localDate, rangeDays } from './reporting.js';
import { allergyLabel } from '../ai/allergy.js';

/** Largest range we will export, matching the aggregate reports' bound. */
const MAX_RANGE_DAYS = 366;
const PAGE_SIZE = 200;

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** A booking with its customer expanded (same shape admin.ts uses). */
interface BookingWithCustomer extends Booking {
	expand?: { customer?: Customer };
}

/** One exported booking. Field order here is the CSV column order. */
export interface BookingDetailRow {
	reference: string;
	date: string; // local 'YYYY-MM-DD'
	time: string; // local 'HH:mm'
	endTime: string; // local 'HH:mm'
	durationMinutes: number | '';
	status: string;
	covers: number;
	guest: string;
	email: string;
	phone: string;
	source: string;
	channel: string;
	service: string; // service period name
	tables: string; // 'T4 + T5'
	bookedOn: string; // local 'YYYY-MM-DD' the booking was created
	leadTimeDays: number | ''; // whole days between bookedOn and date
	occasion: string;
	promotion: string;
	specialRequests: string;
	noteToRestaurant: string;
	allergies: string;
	dietary: string;
	vip: string; // 'Yes' / ''
	preorder: string;
	confirmed: string; // 'Yes' / ''
}

/** Owner-facing column headings, in the same order as BookingDetailRow. */
export const BOOKING_DETAIL_HEADERS: string[] = [
	'Reference',
	'Date',
	'Time',
	'End',
	'Duration (min)',
	'Status',
	'Covers',
	'Guest',
	'Email',
	'Phone',
	'Source',
	'Channel',
	'Service',
	'Tables',
	'Booked on',
	'Lead time (days)',
	'Occasion',
	'Promotion',
	'Special requests',
	'Note to restaurant',
	'Allergies',
	'Dietary',
	'VIP',
	'Pre-order',
	'Confirmed'
];

/** Owner-facing status wording. The DB enum leaks jargon otherwise — the same
 *  fix the Deposits tab applies to the payment processor's vocabulary. */
const STATUS_LABEL: Record<string, string> = {
	pending_payment: 'Pending payment',
	confirmed: 'Confirmed',
	seated: 'Seated',
	completed: 'Completed',
	cancelled: 'Cancelled',
	no_show: 'No-show'
};

const SOURCE_LABEL: Record<string, string> = {
	online: 'Online',
	phone: 'Phone',
	walkin: 'Walk-in',
	ai: 'AI assistant'
};

/** Local 'HH:mm' for an instant, in the restaurant's wall-clock zone. */
function localTime(instant: Date, timezone: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: timezone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(instant);
}

/** Whole days between two local 'YYYY-MM-DD' dates (UTC-noon dodges DST). */
function daysBetween(from: string, to: string): number | '' {
	const a = Date.parse(`${from}T12:00:00Z`);
	const b = Date.parse(`${to}T12:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b)) return '';
	return Math.round((b - a) / 86_400_000);
}

/**
 * Read one array off `booking.dietary_flags` and label it.
 *
 * `dietary_flags` is an AllergyFlags payload (see ai/allergy.ts):
 *   { allergies: string[], dietary: string[], hasAllergy, summary, source }
 * — NOT the customer's DietaryFlags boolean map, despite the similar name. It is
 * typed `unknown` on the Booking, so this stays defensive about the shape and
 * pulls the named array rather than iterating keys: a generic "keep the truthy
 * keys" walk over this object yields the literal string "allergies; dietary;
 * source", which is exactly the wrong thing and reads as real data.
 */
function bookingFlagList(value: unknown, field: 'allergies' | 'dietary'): string[] {
	if (!value || typeof value !== 'object') return [];
	const list = (value as Record<string, unknown>)[field];
	if (!Array.isArray(list)) return [];
	return list.filter((k): k is string => typeof k === 'string' && k.length > 0);
}

/** The customer's own `dietary` — stored as the array form of DietaryFlags. */
function customerDietary(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((k): k is string => typeof k === 'string' && k.length > 0)
		// 'other:no coriander' is stored inline; show the free text, not the key.
		.map((k) => (k.startsWith('other:') ? k.slice('other:'.length) : k));
}

/** De-duplicate while preserving order, then join for a CSV cell. */
function joinUnique(parts: string[]): string {
	return [...new Set(parts.map((p) => p.trim()).filter(Boolean))].join('; ');
}

/** Strip HTML and collapse whitespace — CSV cells must stay single-line. */
function plain(value: unknown): string {
	if (value == null) return '';
	return String(value)
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Summarise a pre-order snapshot as '2 × Omakase' (or '' when absent). */
function preorderText(b: Booking): string {
	const p = b.preorder as { name?: string; menuName?: string; quantity?: number } | undefined;
	if (!p) return '';
	const name = p.name || p.menuName || '';
	if (!name) return '';
	return p.quantity ? `${p.quantity} × ${name}` : name;
}

// ---------------------------------------------------------------------------
// Pure shaping — bookings in, rows out. No I/O, so this is unit-testable.
// ---------------------------------------------------------------------------

export function shapeBookingRows(args: {
	timezone: string;
	bookings: BookingWithCustomer[];
	periodNames: Map<string, string>;
	tableLabels: Map<string, string>;
}): BookingDetailRow[] {
	const { timezone, bookings, periodNames, tableLabels } = args;
	const rows: BookingDetailRow[] = [];

	for (const b of bookings) {
		const start = new Date(b.starts_at);
		if (Number.isNaN(start.getTime())) continue;
		const end = new Date(b.ends_at);
		const hasEnd = !Number.isNaN(end.getTime());

		const date = localDate(start, timezone);
		// `created` is a PB system field; absent only on hand-crafted fixtures.
		const createdInstant = b.created ? new Date(b.created) : null;
		const bookedOn =
			createdInstant && !Number.isNaN(createdInstant.getTime())
				? localDate(createdInstant, timezone)
				: '';

		// The booking's own guest snapshot wins over the SHARED customer record —
		// the same precedence admin.ts's withGuestSnapshot applies for the diary.
		const customer = b.expand?.customer;
		const guest = b.guest_name?.trim() || customer?.name || '';
		const phone = b.guest_phone?.trim() || customer?.phone || '';

		rows.push({
			reference: b.id,
			date,
			time: localTime(start, timezone),
			endTime: hasEnd ? localTime(end, timezone) : '',
			durationMinutes: hasEnd ? Math.round((end.getTime() - start.getTime()) / 60_000) : '',
			status: STATUS_LABEL[b.status] ?? b.status ?? '',
			covers: b.party_size || 0,
			guest,
			email: customer?.email || '',
			phone,
			source: SOURCE_LABEL[b.source] ?? (b.source || 'Unknown'),
			channel: b.channel || '',
			service: periodNames.get(b.service_period || '') || '',
			tables: (b.tables || []).map((id) => tableLabels.get(id) || id).join(' + '),
			bookedOn,
			// A walk-in has no lead time by definition — it is entered at or after
			// the guest sits down, so the subtraction yields 0 or a negative that
			// reads as a data error in a column headed "Lead time (days)". Blank
			// it. A negative on a BOOKED cover is left alone: that one is real,
			// and it means the booking was typed in after the visit.
			leadTimeDays: bookedOn && b.source !== 'walkin' ? daysBetween(bookedOn, date) : '',
			occasion: b.occasion || '',
			promotion: b.promotion || '',
			specialRequests: plain(b.special_requests),
			noteToRestaurant: plain(b.note_to_restaurant),
			// Two distinct columns, from two layers each: the booking's extracted
			// flags plus whatever the guest's own record carries. Allergies are
			// safety-critical, so they never collapse into the dietary column.
			allergies: joinUnique([
				...bookingFlagList(b.dietary_flags, 'allergies').map(allergyLabel),
				plain(customer?.allergies)
			]),
			dietary: joinUnique([
				...bookingFlagList(b.dietary_flags, 'dietary').map(allergyLabel),
				...customerDietary(customer?.dietary).map(allergyLabel)
			]),
			vip: customer?.vip ? 'Yes' : '',
			preorder: preorderText(b),
			confirmed: b.confirmed ? 'Yes' : ''
		});
	}

	// Chronological — the order a manager reads a diary in.
	rows.sort((a, z) => (a.date + a.time).localeCompare(z.date + z.time));
	return rows;
}

/** Row order must match BOOKING_DETAIL_HEADERS. */
export function bookingRowToCells(r: BookingDetailRow): (string | number)[] {
	return [
		r.reference,
		r.date,
		r.time,
		r.endTime,
		r.durationMinutes,
		r.status,
		r.covers,
		r.guest,
		r.email,
		r.phone,
		r.source,
		r.channel,
		r.service,
		r.tables,
		r.bookedOn,
		r.leadTimeDays,
		r.occasion,
		r.promotion,
		r.specialRequests,
		r.noteToRestaurant,
		r.allergies,
		r.dietary,
		r.vip,
		r.preorder,
		r.confirmed
	];
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

async function pageBookingsWithCustomer(
	restaurantId: string,
	fromISO: string,
	toISO: string
): Promise<BookingWithCustomer[]> {
	const c = await pb();
	const from = toPbDateFilter(fromISO);
	const to = toPbDateFilter(toISO);
	const filter = `restaurant=${q(restaurantId)} && starts_at>=${q(from)} && starts_at<=${q(to)}`;

	const out: BookingWithCustomer[] = [];
	let page = 1;
	for (;;) {
		const res = await c.collection('geisha_bookings').getList<BookingWithCustomer>(page, PAGE_SIZE, {
			filter,
			sort: 'starts_at',
			expand: 'customer'
		});
		out.push(...res.items);
		if (page >= res.totalPages || res.items.length === 0) break;
		page++;
	}
	return out;
}

/**
 * Every booking in an inclusive local date range, one row each.
 *
 * `includeCancelled` defaults TRUE — unlike the covers/walk-ins reports, which
 * exist to count trade that stood. A details export is the audit view: leaving
 * cancellations out of it silently would make the row count disagree with the
 * Covers tab's own "147 bookings were taken for this range in total" line.
 */
export async function getBookingDetailRows(
	brand: BrandId,
	fromDate: string,
	toDate: string,
	options: { includeCancelled?: boolean } = {}
): Promise<BookingDetailRow[]> {
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

	const includeCancelled = options.includeCancelled ?? true;

	const restaurant = await getRestaurant(brand);
	const tz = restaurant.timezone || 'Europe/London';

	// Widen the absolute fetch window by a day either side, then re-filter by
	// local date below (identical to getCoversReport).
	const fromISO = `${fromDate}T00:00:00.000Z`;
	const toISO = new Date(Date.parse(`${toDate}T00:00:00.000Z`) + 2 * 86_400_000).toISOString();

	const [bookings, tables, periods] = await Promise.all([
		pageBookingsWithCustomer(restaurant.id, fromISO, toISO),
		getTables(restaurant.id),
		listPeriods(brand)
	]);

	const inRange = bookings.filter((b) => {
		const instant = new Date(b.starts_at);
		if (Number.isNaN(instant.getTime())) return false;
		const d = localDate(instant, tz);
		if (d < fromDate || d > toDate) return false;
		if (!includeCancelled && (b.status === 'cancelled' || b.status === 'no_show')) return false;
		return true;
	});

	return shapeBookingRows({
		timezone: tz,
		bookings: inRange,
		periodNames: new Map(periods.map((p) => [p.id, p.name])),
		tableLabels: new Map((tables as DiningTable[]).map((t) => [t.id, t.label]))
	});
}
