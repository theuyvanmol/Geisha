// Deposit report — Stripe deposits & card guarantees over a date range (ResDiary
// "Deposit report" parity: date range, payment method, restaurant, status,
// Summary/Details).
//
// HYBRID SOURCE (build decision): geisha_payments is the spine — it's the only
// record that maps a payment intent → booking → customer → restaurant → date,
// which is exactly what this report must filter and group by (the provider's own
// list API is account-wide with no brand/booking filter). We then LIVE-REFRESH
// each payment's status from Stripe so the money state shown is authoritative,
// falling back to the stored status when Stripe is unconfigured or a call fails —
// the report never 500s.
//
// The pure aggregation (bucketDeposits) is split from the PB/Stripe I/O so it can
// be unit-tested with no live services, matching reporting.ts's convention.

import { pb } from '../db/pb.js';
import type { Booking, BrandId, Customer, Payment, PaymentStatus, ServicePeriod } from '../db/types.js';
import { getRestaurant, getTables, toPbDateFilter } from './queries.js';
import { listPeriods } from './admin.js';
import { localDate, rangeDays } from './reporting.js';
import { bookingReference } from '$lib/bookings/reference.js';

/** Largest range we will aggregate, to bound work on the droplet. */
const MAX_RANGE_DAYS = 366;
const PAGE_SIZE = 200;
/** Cap on concurrent Stripe status refreshes so a big range can't stampede the API. */
const PROVIDER_CONCURRENCY = 6;

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

// ---------------------------------------------------------------------------
// Public report shape
// ---------------------------------------------------------------------------

/** Payment method filter = the payment KIND (deposit vs no-show hold). */
export type DepositMethod = 'all' | 'deposit' | 'noshow_hold';

export interface DepositReportOptions {
	/** Filter by payment kind ('all' keeps both). */
	method?: DepositMethod;
	/** Filter by (live) status, e.g. 'Captured' ('all' keeps every status). */
	status?: PaymentStatus | 'all';
	/** Include payments whose booking is cancelled/no-show (default false). */
	includeCancelled?: boolean;
}

/** One Details row — a single deposit/hold with its booking + live status.
 *
 *  The extra identity/provenance fields exist because the owner reconciles this
 *  against ResDiary's deposit report, which answers "who paid, and when" on one
 *  line: Visit Date / Time / Service / T# / P# / Name / Tel / Ref / Channel /
 *  Comments / Booking Date / Description / Amount / Payment Date+Media+Amount /
 *  Processed. Everything below maps to one of those columns. */
export interface DepositRow {
	paymentId: string;
	bookingId: string;
	date: string; // local 'YYYY-MM-DD' of the booking
	startsAt: string; // ISO booking start
	/** Local 'HH:MM' of the booking — ResDiary splits Visit Date and Time. */
	time: string;
	guest: string;
	/** Phone as booked (booking.guest_phone), else the account holder's. */
	phone: string;
	/** Guest-quotable booking reference — the code on their confirmation email. */
	reference: string;
	/** Table labels, e.g. '13' or '5, 6'. */
	tables: string;
	/** 'Online' / 'Internal' / 'Walk-in' — how the booking was taken. */
	channel: string;
	/** ResDiary's Comments column: the guest note, then "{party} × {promotion}". */
	comments: string;
	/** When the BOOKING was made (≠ the visit date, ≠ when they paid). */
	bookedAt: string;
	/** What the deposit was for, e.g. 'Large booking deposit'. */
	description: string;
	/** When the money actually moved (capture), or the hold was placed. */
	paidAt: string;
	/** Who processed it — 'Stripe' for a real intent, '' for a legacy stub. */
	media: string;
	/** Amount actually taken, in pence. 0 until captured. */
	takenPence: number;
	partySize: number;
	periodName: string;
	kind: 'deposit' | 'noshow_hold' | '';
	amountPence: number;
	/** Stored status on our row. */
	storedStatus: string;
	/** Live status from Stripe, or '' when not refreshed (falls back to stored). */
	liveStatus: string;
	/** The status the report displays (live if present, else stored). */
	status: string;
	capturedAt: string;
	reversedAt: string;
	bookingStatus: string;
	/** True when the live status came from Stripe (vs stored fallback). */
	live: boolean;
}

export interface DepositReport {
	brand: BrandId;
	from: string;
	to: string;
	/** Whether Stripe was configured (drives the "live" note in the UI). */
	providerConfigured: boolean;
	totals: {
		count: number;
		grossPence: number; // sum of all amounts in scope
		capturedPence: number; // amounts in a Captured state (money actually taken)
		heldPence: number; // Authorized holds not yet captured/reversed
		refundedPence: number;
	};
	byStatus: Array<{ status: string; count: number; amountPence: number }>;
	byMethod: Array<{ kind: string; label: string; count: number; amountPence: number }>;
	byPeriod: Array<{ periodName: string; count: number; amountPence: number }>;
	rows: DepositRow[];
}

const METHOD_LABEL: Record<string, string> = {
	deposit: 'Deposit',
	noshow_hold: 'No-show hold',
	'': 'Unknown'
};

// ---------------------------------------------------------------------------
// Pure aggregation — bucket resolved payment+booking pairs into the report.
// Exposed for unit tests (no live PB / Stripe).
// ---------------------------------------------------------------------------

/** A payment joined to the bits of its booking the report needs. Live status
 *  resolution has already happened by the time this runs. */
export interface JoinedDeposit {
	payment: Payment;
	booking: Booking | null;
	guest: string;
	periodName: string;
	/** Phone as booked, else the account holder's. Resolved by the caller because
	 *  it needs the customer rows. */
	phone?: string;
	/** Pre-resolved table labels for the booking's tables ('13', '5, 6'). */
	tables?: string;
	/** Resolved live status (or '' if not refreshed). */
	liveStatus: string;
	/** True when liveStatus came from Stripe. */
	live: boolean;
}

/**
 * States our own row records that the provider's intent CANNOT express, so a live
 * refresh must never overwrite them.
 *
 * Two real cases, both of which made this report lie about money:
 *
 *  • REFUNDED. Refunding a deposit leaves the PaymentIntent at `succeeded` — the
 *    refund is a separate object hanging off the charge. The live status therefore
 *    read back as 'Captured', so a refunded £60 was reported as money in the bank
 *    and the "Refunded" total stayed at £0.00.
 *
 *  • CAPTURED off a card guarantee. A no-show fee is charged on a NEW PaymentIntent;
 *    the row still points at the original SetupIntent, whose status stays
 *    `succeeded` → 'Authorized'. So a fee that really was taken reported as merely
 *    "held on the card" and was left out of "actually taken".
 *
 * In both cases our row is the one that knows what happened, because our code is
 * what made it happen.
 */
const TERMINAL_STORED_STATUSES = new Set(['Captured', 'Refunded', 'Reversed', 'Canceled']);

// ---------------------------------------------------------------------------
// Column helpers (pure — covered by depositReport.test.ts)
// ---------------------------------------------------------------------------

/** Local 'HH:MM' for a booking start. */
export function localTime(instant: Date, timezone: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: timezone
	}).format(instant);
}

/** How the booking was taken. `channel` is the ResDiary-parity label set on the
 *  diary; `source` is the older enum, so it is the fallback rather than a second
 *  source of truth. */
export function channelLabel(b: Booking | null): string {
	if (!b) return '';
	if (b.channel) return b.channel;
	// BookingSource is 'online' | 'phone' | 'walkin' | 'ai'. ResDiary calls anything
	// taken by the restaurant itself "Internal", which is both phone and the AI
	// concierge — the guest didn't self-serve on the website either way.
	switch (b.source || '') {
		case 'online':
			return 'Online';
		case 'walkin':
			return 'Walk-in';
		case 'phone':
		case 'ai':
			return 'Internal';
		default:
			return '';
	}
}

/** ResDiary's Comments column: the guest's own note first (it's the bit a manager
 *  is actually scanning for), then the "{party} × {promotion}" line it always
 *  prints. Either half may be missing. */
export function commentsFor(b: Booking | null): string {
	if (!b) return '';
	const note = (b.note_to_restaurant || b.special_requests || '').trim();
	const promo = (b.promotion || '').trim();
	const tally = promo && b.party_size ? `${b.party_size} × ${promo}` : promo;
	return [note, tally].filter(Boolean).join(' · ');
}

/** What the deposit was for. We have no per-rule description column, so this is
 *  built from the promotion the booking was stamped with (which IS the rule that
 *  charged them) and the payment kind. */
export function describeDeposit(p: Payment, b: Booking | null): string {
	const base = p.kind === 'noshow_hold' ? 'Card guarantee' : 'Deposit';
	const promo = (b?.promotion || '').trim();
	return promo ? `${promo} ${base.toLowerCase()}` : base;
}

/** Who took the money. Routing is by intent-id prefix (see payments/index.ts), so
 *  a `pi_`/`seti_` id is Stripe and a legacy `stub_` id is nobody. */
export function providerMedia(intentId: string): string {
	const id = intentId || '';
	if (id.startsWith('pi_') || id.startsWith('seti_')) return 'Stripe';
	return '';
}

/**
 * The status to display for a payment.
 *
 * The live provider status is used to ADVANCE a payment we still believe is in
 * flight ('Created' / 'Authorized' / unknown) — that is the whole point of the
 * refresh, and it catches a webhook we missed. It is never allowed to REGRESS a
 * terminal state we recorded ourselves.
 */
export function resolveDisplayStatus(storedStatus: string, liveStatus: string): string {
	const stored = storedStatus || '';
	if (TERMINAL_STORED_STATUSES.has(stored)) return stored;
	return liveStatus || stored;
}

export function bucketDeposits(args: {
	brand: BrandId;
	from: string;
	to: string;
	timezone: string;
	providerConfigured: boolean;
	joined: JoinedDeposit[];
	options: DepositReportOptions;
}): DepositReport {
	const { brand, from, to, timezone, providerConfigured, joined, options } = args;
	const method = options.method ?? 'all';
	const wantStatus = options.status ?? 'all';
	const includeCancelled = options.includeCancelled ?? false;

	const rows: DepositRow[] = [];
	for (const j of joined) {
		const p = j.payment;
		const b = j.booking;
		const displayStatus = resolveDisplayStatus(p.status || '', j.liveStatus);
		const bookingStatus = b?.status ?? '';

		// Apply filters.
		if (method !== 'all' && p.kind !== method) continue;
		if (wantStatus !== 'all' && displayStatus !== wantStatus) continue;
		// A cancelled / no-show booking whose money was taken and KEPT stays in: that
		// deposit is in the bank whatever happened to the table, and hiding it made
		// this report read short of Stripe. What the default leaves out is the noise
		// — holds that lapsed unpaid, cards on file for tables that never happened.
		if (
			!includeCancelled &&
			(bookingStatus === 'cancelled' || bookingStatus === 'no_show') &&
			displayStatus !== 'Captured'
		)
			continue;

		const startsAt = b?.starts_at ?? p.created;
		const instant = new Date(startsAt);
		const date = Number.isNaN(instant.getTime()) ? '' : localDate(instant, timezone);

		rows.push({
			paymentId: p.id,
			bookingId: p.booking,
			date,
			startsAt,
			time: Number.isNaN(instant.getTime()) ? '' : localTime(instant, timezone),
			guest: j.guest,
			phone: j.phone ?? b?.guest_phone ?? '',
			reference: p.booking ? bookingReference(p.booking) : '',
			tables: j.tables ?? '',
			channel: channelLabel(b),
			comments: commentsFor(b),
			bookedAt: b?.created ?? '',
			description: describeDeposit(p, b),
			// When the money moved. A capture has its own stamp; a hold that is still
			// only authorised has not been paid, so it reports the moment the hold was
			// placed rather than pretending nothing happened.
			paidAt: p.captured_at || (displayStatus === 'Authorized' ? p.created : ''),
			media: providerMedia(p.dojo_payment_intent_id),
			// Only a capture is money taken. An authorised hold is £0 of £X, which is
			// exactly what ResDiary's Processed column says.
			takenPence: displayStatus === 'Captured' ? p.amount || 0 : 0,
			partySize: b?.party_size ?? 0,
			periodName: j.periodName,
			kind: (p.kind as DepositRow['kind']) || '',
			amountPence: p.amount || 0,
			storedStatus: p.status || '',
			liveStatus: j.liveStatus,
			status: displayStatus,
			capturedAt: p.captured_at || '',
			reversedAt: p.reversed_at || '',
			bookingStatus,
			// Only claim "live" when the provider's status is what we are actually
			// showing — a terminal stored state that overrode it is ours, not theirs.
			live: j.live && displayStatus === j.liveStatus
		});
	}

	// Newest booking first for the Details table.
	rows.sort((a, b) => (a.startsAt < b.startsAt ? 1 : a.startsAt > b.startsAt ? -1 : 0));

	// Aggregations over the FILTERED rows.
	const byStatus = new Map<string, { count: number; amountPence: number }>();
	const byMethod = new Map<string, { count: number; amountPence: number }>();
	const byPeriod = new Map<string, { count: number; amountPence: number }>();
	let grossPence = 0;
	let capturedPence = 0;
	let heldPence = 0;
	let refundedPence = 0;

	for (const r of rows) {
		grossPence += r.amountPence;
		if (r.status === 'Captured') capturedPence += r.amountPence;
		else if (r.status === 'Authorized') heldPence += r.amountPence;
		else if (r.status === 'Refunded') refundedPence += r.amountPence;

		const s = byStatus.get(r.status || '(none)') ?? { count: 0, amountPence: 0 };
		s.count++;
		s.amountPence += r.amountPence;
		byStatus.set(r.status || '(none)', s);

		const m = byMethod.get(r.kind) ?? { count: 0, amountPence: 0 };
		m.count++;
		m.amountPence += r.amountPence;
		byMethod.set(r.kind, m);

		const pk = r.periodName || '(unassigned)';
		const per = byPeriod.get(pk) ?? { count: 0, amountPence: 0 };
		per.count++;
		per.amountPence += r.amountPence;
		byPeriod.set(pk, per);
	}

	return {
		brand,
		from,
		to,
		providerConfigured,
		totals: { count: rows.length, grossPence, capturedPence, heldPence, refundedPence },
		byStatus: [...byStatus.entries()]
			.map(([status, v]) => ({ status, ...v }))
			.sort((a, b) => b.amountPence - a.amountPence),
		byMethod: [...byMethod.entries()]
			.map(([kind, v]) => ({ kind, label: METHOD_LABEL[kind] ?? kind, ...v }))
			.sort((a, b) => b.amountPence - a.amountPence),
		byPeriod: [...byPeriod.entries()]
			.map(([periodName, v]) => ({ periodName, ...v }))
			.sort((a, b) => b.amountPence - a.amountPence),
		rows
	};
}

// ---------------------------------------------------------------------------
// By PAYMENT date — the view that matches Stripe.
//
// Everything above counts a deposit on the day the guest VISITS. Stripe counts it
// on the day the card was CHARGED, and the owner reconciles against Stripe every
// Monday — so the two never agreed (21 Sep 2026: Stripe £740, this report £700,
// both right). This view counts money on the day it moved:
//
//   • a charge on its captured_at — whatever became of the booking since, because
//     a cancelled or no-show guest's kept deposit is still money in the bank;
//   • a refund on its reversed_at, as a separate line, the way Stripe lists it.
//
// Both restaurants together: they share one Stripe account, so its total is theirs.
// Only payments this system took through Stripe — not the deposits copied in from
// ResDiary at the changeover, whose real charge dates we don't hold. Gift vouchers
// (Gift Up) share the Stripe account too and are never in here.
// Built from our own stamps only (no Stripe calls). captured_at trails Stripe's
// charge time by 2–4 s (measured on every live deposit, 21 Sep 2026), so it files
// each charge under the same day Stripe does.
//
// A refund is treated as the full deposit, as everywhere else in the system — a
// partial refund would over-state the refund here until the refunded amount is
// stored on the payment row.
// ---------------------------------------------------------------------------

/** Which date the Deposits report counts by. */
export type DepositBasis = 'paid' | 'visit';

/** A payment joined to its booking and restaurant, for the by-payment-date view. */
export interface PaidJoined {
	payment: Payment;
	booking: Booking | null;
	/** The booking's restaurant, or '' when the booking no longer exists. */
	brand: BrandId | '';
	guest: string;
	/** Phone as booked, else the account holder's (resolved by the caller). */
	phone?: string;
}

/** One movement of money: a charge taken, or a refund given back. */
export interface PaidMovement {
	paymentId: string;
	bookingId: string;
	type: 'taken' | 'refunded';
	/** When the money moved. */
	at: string;
	/** Local 'YYYY-MM-DD' and 'HH:MM' of the movement — the day Stripe files it under. */
	date: string;
	time: string;
	brand: BrandId | '';
	guest: string;
	phone: string;
	reference: string;
	/** The visit the money is for ('' when the booking is gone). */
	visitDate: string;
	visitTime: string;
	partySize: number;
	description: string;
	kind: 'deposit' | 'noshow_hold' | '';
	/** Always positive; `type` says which way it went. */
	amountPence: number;
	/** The payment's status now — a charge refunded since reads 'Refunded'. */
	status: string;
	bookingStatus: string;
}

export interface PaidTotals {
	/** Charges taken. */
	payments: number;
	/** Refunds given back. */
	refunds: number;
	takenPence: number;
	refundedPence: number;
	netPence: number;
}

export interface PaidDepositReport {
	from: string;
	to: string;
	totals: PaidTotals;
	/** Asia and Fusion always (a quiet week still shows its £0), then 'Unknown' when
	 *  money arrived for a booking that has since been deleted. */
	byBrand: Array<{ brand: BrandId | ''; label: string } & PaidTotals>;
	/** Each day money moved, oldest first — for ticking a week off against Stripe. */
	byDay: Array<{ date: string } & PaidTotals>;
	/** Newest first, as Stripe lists them. */
	rows: PaidMovement[];
}

const BRAND_LABEL: Record<string, string> = { asia: 'Asia', fusion: 'Fusion', '': 'Unknown' };

/** A PocketBase datetime ('2026-09-19 22:45:32.614Z') or ISO string as a Date. */
function instantOf(stamp: string): Date {
	return new Date((stamp || '').replace(' ', 'T'));
}

/** When a refund happened. Refunds made before 21 Sep 2026 carry no reversed_at;
 *  nothing writes a payment row once it is refunded, so for those the row's last
 *  update IS the refund and stands in for it. */
function refundedAt(p: Payment): string {
	return p.reversed_at || p.updated || '';
}

function emptyTotals(): PaidTotals {
	return { payments: 0, refunds: 0, takenPence: 0, refundedPence: 0, netPence: 0 };
}

function addMovement(t: PaidTotals, m: PaidMovement): void {
	if (m.type === 'taken') {
		t.payments++;
		t.takenPence += m.amountPence;
		t.netPence += m.amountPence;
	} else {
		t.refunds++;
		t.refundedPence += m.amountPence;
		t.netPence -= m.amountPence;
	}
}

export function bucketPaidDeposits(args: {
	from: string;
	to: string;
	timezone: string;
	joined: PaidJoined[];
}): PaidDepositReport {
	const { from, to, timezone, joined } = args;

	const rows: PaidMovement[] = [];
	for (const j of joined) {
		const p = j.payment;
		const b = j.booking;
		// Only money this system charged through Stripe. Deposits copied in from
		// ResDiary (`resdiary_external_…`) were charged by ResDiary on dates we don't
		// have — their captured_at is the import time — so they would land on the
		// wrong day. A legacy `stub_` never took anything.
		if (providerMedia(p.dojo_payment_intent_id) !== 'Stripe') continue;
		const visit = b ? instantOf(b.starts_at) : null;
		const visitDate = visit && !Number.isNaN(visit.getTime()) ? localDate(visit, timezone) : '';
		const visitTime = visit && !Number.isNaN(visit.getTime()) ? localTime(visit, timezone) : '';

		const movement = (type: PaidMovement['type'], at: string): PaidMovement | null => {
			const instant = instantOf(at);
			if (Number.isNaN(instant.getTime())) return null;
			const date = localDate(instant, timezone);
			if (date < from || date > to) return null;
			return {
				paymentId: p.id,
				bookingId: p.booking,
				type,
				at,
				date,
				time: localTime(instant, timezone),
				brand: j.brand,
				guest: j.guest,
				phone: j.phone ?? b?.guest_phone ?? '',
				reference: p.booking ? bookingReference(p.booking) : '',
				visitDate,
				visitTime,
				partySize: b?.party_size ?? 0,
				description: p.kind === 'noshow_hold' ? 'No-show fee' : describeDeposit(p, b),
				kind: (p.kind as PaidMovement['kind']) || '',
				amountPence: p.amount || 0,
				status: p.status || '',
				bookingStatus: b?.status ?? ''
			};
		};

		// captured_at is only ever stamped when money is taken, so it IS the charge —
		// even on a payment refunded since, whose money still arrived that day.
		const taken = p.captured_at ? movement('taken', p.captured_at) : null;
		if (taken) rows.push(taken);
		// Only a refund sends money back. A released guarantee ('Reversed') or an
		// abandoned intent ('Canceled') never moved any.
		const back = p.status === 'Refunded' ? movement('refunded', refundedAt(p)) : null;
		if (back) rows.push(back);
	}

	rows.sort((a, b) => instantOf(b.at).getTime() - instantOf(a.at).getTime());

	const totals = emptyTotals();
	const brands = new Map<BrandId | '', PaidTotals>([
		['asia', emptyTotals()],
		['fusion', emptyTotals()]
	]);
	const days = new Map<string, PaidTotals>();
	for (const m of rows) {
		addMovement(totals, m);
		if (!brands.has(m.brand)) brands.set(m.brand, emptyTotals());
		addMovement(brands.get(m.brand)!, m);
		if (!days.has(m.date)) days.set(m.date, emptyTotals());
		addMovement(days.get(m.date)!, m);
	}

	return {
		from,
		to,
		totals,
		byBrand: [...brands.entries()].map(([brand, t]) => ({
			brand,
			label: BRAND_LABEL[brand] ?? brand,
			...t
		})),
		byDay: [...days.entries()]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([date, t]) => ({ date, ...t })),
		rows
	};
}

// ---------------------------------------------------------------------------
// I/O: fetch payments+bookings for the range, live-refresh from Stripe, then bucket.
// ---------------------------------------------------------------------------

/** Page through every payment whose booking starts in the widened window. Rather
 *  than filter payments by date (they carry no booking date), we fetch the
 *  bookings in range first, then their payments — bounded + index-friendly. */
async function fetchBookingsInRange(
	restaurantId: string,
	fromISO: string,
	toISO: string
): Promise<Booking[]> {
	const c = await pb();
	const filter = `restaurant=${q(restaurantId)} && starts_at>=${q(toPbDateFilter(fromISO))} && starts_at<=${q(toPbDateFilter(toISO))}`;
	const out: Booking[] = [];
	let page = 1;
	for (;;) {
		const res = await c.collection('geisha_bookings').getList<Booking>(page, PAGE_SIZE, {
			filter,
			sort: 'starts_at'
		});
		out.push(...res.items);
		if (page >= res.totalPages || res.items.length === 0) break;
		page++;
	}
	return out;
}

/** Fetch the payment rows for a set of booking ids (chunked OR filter). */
async function fetchPaymentsForBookings(bookingIds: string[]): Promise<Payment[]> {
	if (bookingIds.length === 0) return [];
	const c = await pb();
	const out: Payment[] = [];
	// Chunk to keep the filter string sane on large ranges.
	const CHUNK = 40;
	for (let i = 0; i < bookingIds.length; i += CHUNK) {
		const slice = bookingIds.slice(i, i + CHUNK);
		const filter = slice.map((id) => `booking=${q(id)}`).join(' || ');
		const rows = await c
			.collection('geisha_payments')
			.getFullList<Payment>({ filter })
			.catch(() => [] as Payment[]);
		out.push(...rows);
	}
	return out;
}

/** Resolve customer display names AND phones for a set of customer ids
 *  (best-effort). The phone is the fallback for a booking with no guest_phone of
 *  its own — ResDiary prints a number on every line and a manager chasing a
 *  deposit needs to be able to ring them. */
async function fetchCustomerContacts(
	customerIds: string[]
): Promise<Map<string, { name: string; phone: string }>> {
	const out = new Map<string, { name: string; phone: string }>();
	const ids = [...new Set(customerIds.filter(Boolean))];
	if (ids.length === 0) return out;
	const c = await pb();
	const CHUNK = 40;
	for (let i = 0; i < ids.length; i += CHUNK) {
		const slice = ids.slice(i, i + CHUNK);
		const filter = slice.map((id) => `id=${q(id)}`).join(' || ');
		const rows = await c
			.collection('geisha_customers')
			.getFullList<Customer>({ filter })
			.catch(() => [] as Customer[]);
		for (const r of rows) out.set(r.id, { name: r.name || r.email || '', phone: r.phone || '' });
	}
	return out;
}

/** Reject a malformed, backwards or over-long range with a message for the manager. */
function assertRange(fromDate: string, toDate: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
		throw new Error("Dates must be 'YYYY-MM-DD'.");
	}
	if (fromDate > toDate) throw new Error('The start date must be on or before the end date.');
	const span = rangeDays(fromDate, toDate);
	if (Number.isNaN(span)) throw new Error('Invalid date range.');
	if (span > MAX_RANGE_DAYS) {
		throw new Error(`Date range too large (${span} days); the maximum is ${MAX_RANGE_DAYS} days.`);
	}
}

/** Run async `fn` over `items` with a bounded number in flight at once. */
async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	async function worker() {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			out[i] = await fn(items[i]);
		}
	}
	const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
	await Promise.all(workers);
	return out;
}

/**
 * Build the deposit report for a brand over an inclusive local date range.
 * Hybrid: geisha_payments (joined to bookings/customers/periods) is the spine,
 * with a bounded live Stripe status refresh per payment. Rejects ranges over
 * MAX_RANGE_DAYS. Never throws for a provider hiccup — falls back to stored status.
 */
export async function getDepositReport(
	brand: BrandId,
	fromDate: string,
	toDate: string,
	options: DepositReportOptions = {}
): Promise<DepositReport> {
	assertRange(fromDate, toDate);

	const restaurant = await getRestaurant(brand);
	const tz = restaurant.timezone || 'Europe/London';

	// Widen the fetch window a day each side; re-filter to the local range below.
	const fromISO = `${fromDate}T00:00:00.000Z`;
	const toISO = new Date(Date.parse(`${toDate}T00:00:00.000Z`) + 2 * 86_400_000).toISOString();

	const [bookings, periods] = await Promise.all([
		fetchBookingsInRange(restaurant.id, fromISO, toISO),
		listPeriods(brand)
	]);

	// Keep only bookings whose LOCAL date is in range, then map id -> booking.
	const inRange = bookings.filter((b) => {
		const instant = new Date(b.starts_at);
		if (Number.isNaN(instant.getTime())) return false;
		const d = localDate(instant, tz);
		return d >= fromDate && d <= toDate;
	});
	const bookingById = new Map(inRange.map((b) => [b.id, b]));
	const periodName = new Map(periods.map((p: ServicePeriod) => [p.id, p.name]));

	// PERF: these three don't depend on each other — the payment rows, the guests'
	// names and "is Stripe configured for this brand" were three awaits in a row,
	// each a full round-trip to the London droplet before the Stripe fan-out below
	// could even start. Same work, one wait.
	const { isConfiguredAsync, getPaymentIntent, getSetupIntent, intentKind, mapStatus } =
		await import('../payments/stripe.js');
	const [payments, customers, providerConfigured, tables] = await Promise.all([
		fetchPaymentsForBookings([...bookingById.keys()]),
		fetchCustomerContacts([...bookingById.values()].map((b) => b.customer)),
		isConfiguredAsync(brand),
		// Table LABELS, not ids — ResDiary's T# column prints the number on the floor.
		getTables(restaurant.id).catch(() => [])
	]);
	const tableLabel = new Map(tables.map((t) => [t.id, t.label]));

	// Live-refresh each payment's status from Stripe (bounded). Falls back silently
	// to the stored status — a report is worth rendering slightly stale, and is not
	// worth failing because one intent lookup timed out.
	const joined = await mapWithConcurrency<Payment, JoinedDeposit>(
		payments,
		PROVIDER_CONCURRENCY,
		async (p) => {
			const booking = bookingById.get(p.booking) ?? null;
			// The name the TABLE was under, falling back to the account holder's. The
			// customer row keeps whatever name that email first booked under, so a
			// deposit taken for "Smith, party of 12" was listed under a name nobody
			// on the floor would recognise.
			const contact = booking ? customers.get(booking.customer) : undefined;
			const guest = booking ? booking.guest_name?.trim() || contact?.name || '' : '';
			// Same precedence as the name: the number given for THIS booking wins over
			// the account holder's, which may be years old.
			const phone = booking ? booking.guest_phone?.trim() || contact?.phone || '' : '';
			const tableNames = booking
				? (booking.tables ?? [])
						.map((id) => tableLabel.get(id) ?? '')
						.filter(Boolean)
						.join(', ')
				: '';
			const pName = booking ? periodName.get(booking.service_period) ?? '' : '';
			let liveStatus = '';
			let live = false;
			if (providerConfigured) {
				// A deposit is a PaymentIntent and a card guarantee is a SetupIntent —
				// different endpoints, and asking the wrong one 404s. A legacy `stub_`
				// id is neither, so it is skipped and reports its stored status.
				const kind = intentKind(p.dojo_payment_intent_id);
				try {
					if (kind === 'payment_intent') {
						const intent = await getPaymentIntent(p.dojo_payment_intent_id, brand);
						liveStatus = mapStatus('payment_intent', intent.status);
						live = true;
					} else if (kind === 'setup_intent') {
						const intent = await getSetupIntent(p.dojo_payment_intent_id, brand);
						liveStatus = mapStatus('setup_intent', intent.status);
						live = true;
					}
				} catch {
					// leave liveStatus empty — the row falls back to the stored status
				}
			}
			return {
				payment: p,
				booking,
				guest,
				phone,
				tables: tableNames,
				periodName: pName,
				liveStatus,
				live
			};
		}
	);

	return bucketDeposits({
		brand,
		from: fromDate,
		to: toDate,
		timezone: tz,
		providerConfigured,
		joined,
		options
	});
}

/** Both restaurants are in Newcastle; the page's own "today" is London too. */
const PAID_TZ = 'Europe/London';

/** Fetch bookings by id (chunked OR filter), best-effort. */
async function fetchBookingsById(ids: string[]): Promise<Map<string, Booking>> {
	const out = new Map<string, Booking>();
	const unique = [...new Set(ids.filter(Boolean))];
	if (unique.length === 0) return out;
	const c = await pb();
	const CHUNK = 40;
	for (let i = 0; i < unique.length; i += CHUNK) {
		const filter = unique
			.slice(i, i + CHUNK)
			.map((id) => `id=${q(id)}`)
			.join(' || ');
		const rows = await c
			.collection('geisha_bookings')
			.getFullList<Booking>({ filter })
			.catch(() => [] as Booking[]);
		for (const b of rows) out.set(b.id, b);
	}
	return out;
}

/**
 * The by-payment-date report over an inclusive local date range, for BOTH
 * restaurants (see bucketPaidDeposits). Reads our own payment stamps only, so it
 * needs no Stripe call and cannot be thrown off by a slow one.
 */
export async function getPaidDepositReport(
	fromDate: string,
	toDate: string
): Promise<PaidDepositReport> {
	assertRange(fromDate, toDate);

	// Widen the fetch a day each side (UTC vs UK days); the bucket re-filters to the
	// local range. A payment is in play if it was charged or refunded in the window —
	// or refunded before refunds were stamped, in which case its last update is the
	// refund (see refundedAt).
	const lo = toPbDateFilter(new Date(Date.parse(`${fromDate}T00:00:00.000Z`) - 86_400_000).toISOString());
	const hi = toPbDateFilter(new Date(Date.parse(`${toDate}T00:00:00.000Z`) + 2 * 86_400_000).toISOString());
	const inWindow = (field: string) => `(${field}>=${q(lo)} && ${field}<${q(hi)})`;
	const filter = [
		inWindow('captured_at'),
		inWindow('reversed_at'),
		`(status="Refunded" && reversed_at="" && ${inWindow('updated')})`
	].join(' || ');

	const c = await pb();
	const [payments, asia, fusion] = await Promise.all([
		c.collection('geisha_payments').getFullList<Payment>({ filter }),
		getRestaurant('asia'),
		getRestaurant('fusion')
	]);
	const brandOfRestaurant = new Map<string, BrandId>([
		[asia.id, 'asia'],
		[fusion.id, 'fusion']
	]);

	const bookings = await fetchBookingsById(payments.map((p) => p.booking));
	const customers = await fetchCustomerContacts([...bookings.values()].map((b) => b.customer));

	const joined: PaidJoined[] = payments.map((p) => {
		const booking = bookings.get(p.booking) ?? null;
		// Same precedence as the visit view: the name and number given for THIS
		// booking, then the account holder's.
		const contact = booking ? customers.get(booking.customer) : undefined;
		return {
			payment: p,
			booking,
			brand: booking ? brandOfRestaurant.get(booking.restaurant) ?? '' : '',
			guest: booking ? booking.guest_name?.trim() || contact?.name || '' : '',
			phone: booking ? booking.guest_phone?.trim() || contact?.phone || '' : ''
		};
	});

	return bucketPaidDeposits({ from: fromDate, to: toDate, timezone: PAID_TZ, joined });
}
