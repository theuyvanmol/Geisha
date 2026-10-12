// mf-guest-comms — PURE recipient selection (the "WHO" half of the engine).
//
// MOONSHOT PRINCIPLE: choosing who to message is a deterministic stats/date query,
// NOT an LLM job. This module is pure arithmetic/date logic over already-fetched
// rows — no PB, no AI, no clock except the `now` you pass in — so it's fully unit
// testable and identical across Vercel instances. The engine (engine.ts) does the
// I/O (fetch rows → call these selectors → draft → queue); the LLM only writes the
// COPY for the candidates these functions pick.

import type { Booking, Customer } from '../db/types.js';
import type { BookingWithCustomer, CommsCandidate } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A customer is messageable for a kind only if we have somewhere to send it and
 *  they're not erased. Marketing-consent is enforced per-kind in the engine. */
export function isContactable(c: Customer | undefined | null): c is Customer {
	return Boolean(c && c.email && !c.deleted_at);
}

/** True if `iso` falls within the inclusive [from, to] window (ms compare). */
function within(iso: string, fromMs: number, toMs: number): boolean {
	const t = Date.parse(iso);
	return Number.isFinite(t) && t >= fromMs && t <= toMs;
}

/**
 * THANK-YOU — bookings that COMPLETED in a recent window get a warm post-visit
 * note. Window is [now - lookbackHours, now] on `ends_at` (fallback starts_at),
 * so a sweep that runs a few hours after service catches the night's covers
 * exactly once (idempotency in the engine prevents re-touching on later sweeps).
 */
export function selectThankYou(
	bookings: BookingWithCustomer[],
	now: Date,
	lookbackHours = 18
): CommsCandidate[] {
	const toMs = now.getTime();
	const fromMs = toMs - lookbackHours * 60 * 60 * 1000;
	const out: CommsCandidate[] = [];
	for (const b of bookings) {
		if (b.status !== 'completed') continue;
		const when = b.ends_at || b.starts_at;
		if (!within(when, fromMs, toMs)) continue;
		const customer = b.expand?.customer;
		if (!isContactable(customer)) continue;
		out.push({
			kind: 'thank_you',
			booking: b,
			customer,
			reason: `Completed a ${b.party_size}-cover visit on ${dateLabel(b.starts_at)}`
		});
	}
	return out;
}

/**
 * WIN-BACK — customers whose MOST-RECENT booking (across the passed history) was
 * a completed visit longer ago than `lapsedDays`, and who have nothing upcoming.
 * Customer-level (no booking attached). De-duped per customer. Excludes guests
 * with no completed visit at all (never-visited isn't a "win-BACK").
 *
 * @param bookings ALL recent bookings for the brand, customer expanded.
 * @param now      the sweep clock.
 * @param lapsedDays a visit older than this with nothing upcoming = lapsed.
 */
export function selectWinBack(
	bookings: BookingWithCustomer[],
	now: Date,
	lapsedDays = 120
): CommsCandidate[] {
	const nowMs = now.getTime();
	const lapsedBeforeMs = nowMs - lapsedDays * DAY_MS;

	// Group by customer: track last completed visit + whether anything is upcoming.
	type Agg = {
		customer: Customer;
		lastVisitMs: number;
		hasUpcoming: boolean;
		lastBooking: Booking;
	};
	const byCust = new Map<string, Agg>();

	for (const b of bookings) {
		const customer = b.expand?.customer;
		if (!isContactable(customer)) continue;
		const startMs = Date.parse(b.starts_at);
		if (!Number.isFinite(startMs)) continue;

		const upcoming =
			startMs > nowMs &&
			(b.status === 'confirmed' || b.status === 'pending_payment' || b.status === 'seated');

		const existing = byCust.get(customer.id);
		if (!existing) {
			byCust.set(customer.id, {
				customer,
				lastVisitMs: b.status === 'completed' ? startMs : -Infinity,
				hasUpcoming: upcoming,
				lastBooking: b
			});
			continue;
		}
		if (upcoming) existing.hasUpcoming = true;
		if (b.status === 'completed' && startMs > existing.lastVisitMs) {
			existing.lastVisitMs = startMs;
			existing.lastBooking = b;
		}
	}

	const out: CommsCandidate[] = [];
	for (const agg of byCust.values()) {
		if (agg.hasUpcoming) continue; // they're already coming back
		if (!Number.isFinite(agg.lastVisitMs)) continue; // never actually visited
		if (agg.lastVisitMs > lapsedBeforeMs) continue; // visited recently enough
		const daysSince = Math.floor((nowMs - agg.lastVisitMs) / DAY_MS);
		out.push({
			kind: 'win_back',
			customer: agg.customer,
			reason: `No visit in ${daysSince} days (last: ${dateLabel(new Date(agg.lastVisitMs).toISOString())})`
		});
	}
	return out;
}

/**
 * OCCASION — an upcoming booking whose `occasion` field names a celebration gets
 * a personalised acknowledgement. Selected when the booking is within the next
 * `aheadDays` and still live (confirmed/pending). This is the simplest, schema-
 * faithful occasion source (a birthday field on the customer would be a separate
 * additive migration the spec flags as optional — not added here).
 */
export function selectOccasion(
	bookings: BookingWithCustomer[],
	now: Date,
	aheadDays = 7
): CommsCandidate[] {
	const fromMs = now.getTime();
	const toMs = fromMs + aheadDays * DAY_MS;
	const out: CommsCandidate[] = [];
	for (const b of bookings) {
		const occ = normaliseOccasion(b.occasion);
		if (!occ) continue;
		if (b.status !== 'confirmed' && b.status !== 'pending_payment') continue;
		if (!within(b.starts_at, fromMs, toMs)) continue;
		const customer = b.expand?.customer;
		if (!isContactable(customer)) continue;
		out.push({
			kind: 'occasion',
			booking: b,
			customer,
			occasion: occ,
			reason: `${capitalise(occ)} booking on ${dateLabel(b.starts_at)}`
		});
	}
	return out;
}

/**
 * REMINDER — live bookings ~24h out (the engine's pre-service touch). OFF by
 * default (the transactional reminder cron already covers this); exposed so an
 * owner who prefers AI-personalised reminders can switch it on. Window mirrors
 * the transactional cron (±windowHours around now + 24h).
 */
export function selectReminder(
	bookings: BookingWithCustomer[],
	now: Date,
	windowHours = 6
): CommsCandidate[] {
	const leadMs = now.getTime() + DAY_MS;
	const fromMs = leadMs - windowHours * 60 * 60 * 1000;
	const toMs = leadMs + windowHours * 60 * 60 * 1000;
	const out: CommsCandidate[] = [];
	for (const b of bookings) {
		if (b.status !== 'confirmed') continue;
		if (!within(b.starts_at, fromMs, toMs)) continue;
		const customer = b.expand?.customer;
		if (!isContactable(customer)) continue;
		out.push({
			kind: 'reminder',
			booking: b,
			customer,
			reason: `Booked for ${dateLabel(b.starts_at)} (~24h away)`
		});
	}
	return out;
}

// --- small pure helpers -----------------------------------------------------

/** Recognise a celebration occasion from the free-text booking.occasion field.
 *  Returns a normalised lowercase phrase, or '' if it isn't a real occasion. */
export function normaliseOccasion(raw: string | undefined | null): string {
	const s = (raw || '').trim().toLowerCase();
	if (!s) return '';
	// Treat clearly non-celebratory / placeholder values as "no occasion".
	if (['none', 'n/a', 'na', '-', 'no', 'business', 'work'].includes(s)) return '';
	return s;
}

function capitalise(s: string): string {
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** 'Sat 12 Jul' in Europe/London — used in reasons (display only, no parsing). */
function dateLabel(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'Europe/London'
	});
}
