// Waitlist capture (WP-AVAIL-5).
//
// When a guest's requested date/party has no available slot (fully booked or
// capped), they can join a waitlist for a time window; the request is recorded
// for the notify-when-free sweep (WP-AVAIL-6, which adds the matching/offer
// logic on top of these capture + read primitives).
//
// Times: window_from / window_to are wall-clock 'HH:mm' (Europe/London), matching
// the service-period times the engine works in — never converted to UTC. The
// `date` is a 'YYYY-MM-DD' calendar date. Server-only (talks to PocketBase).

import { pb } from '../db/pb.js';
import type { AuditActor, BrandId, Waitlist } from '../db/types.js';
import { getRestaurant, upsertCustomer } from './queries.js';
import { writeAudit } from './audit.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** A waitlist row with the customer expanded (for the admin/diary read). */
export interface WaitlistRow extends Waitlist {
	expand?: { customer?: { id: string; name: string; email: string; phone: string } };
}

export interface JoinWaitlistInput {
	brand: BrandId;
	date: string; // 'YYYY-MM-DD'
	partySize: number;
	windowFrom: string; // 'HH:mm' — earliest acceptable seating
	windowTo: string; // 'HH:mm' — latest acceptable seating
	customer: { name: string; email: string; phone?: string; marketingConsent?: boolean };
}

/** Thrown for invalid waitlist input (bad window / duplicate). */
export class WaitlistError extends Error {
	constructor(
		message: string,
		readonly code: 'invalid' | 'duplicate' = 'invalid'
	) {
		super(message);
	}
}

const HHMM = /^\d{2}:\d{2}$/;

/**
 * Capture a waitlist request: upsert the customer (reusing the booking flow's
 * upsertCustomer so a repeat email never duplicates a customer) and create a
 * geisha_waitlist row with status 'waiting'. Soft anti-spam: refuses an identical
 * waiting entry (same customer + date + window) that already exists.
 */
export async function joinWaitlist(input: JoinWaitlistInput): Promise<{ id: string }> {
	const { brand, date, partySize, windowFrom, windowTo } = input;

	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new WaitlistError('A valid date is required.');
	if (!HHMM.test(windowFrom) || !HHMM.test(windowTo)) {
		throw new WaitlistError('A valid time window (HH:mm) is required.');
	}
	if (windowFrom > windowTo) {
		throw new WaitlistError('The window start must be on or before the window end.');
	}
	if (!Number.isInteger(partySize) || partySize < 1) {
		throw new WaitlistError('Party size must be at least 1.');
	}

	const restaurant = await getRestaurant(brand);
	const customer = await upsertCustomer(input.customer);
	const c = await pb();

	// Soft per-customer/day dedupe: don't pile up identical waiting rows.
	const dupe = await c
		.collection('geisha_waitlist')
		.getFirstListItem<Waitlist>(
			`restaurant=${q(restaurant.id)} && customer=${q(customer.id)} && date=${q(date)} && window_from=${q(windowFrom)} && window_to=${q(windowTo)} && status=${q('waiting')}`
		)
		.catch(() => null);
	if (dupe) {
		throw new WaitlistError("You're already on the waitlist for that date and time.", 'duplicate');
	}

	const row = await c.collection('geisha_waitlist').create<Waitlist>({
		restaurant: restaurant.id,
		customer: customer.id,
		date,
		party_size: partySize,
		window_from: windowFrom,
		window_to: windowTo,
		status: 'waiting',
		notified_at: ''
	});

	await writeAudit('customer', 'join_waitlist', 'geisha_waitlist', row.id, null, row);
	return { id: row.id };
}

/**
 * Waitlist entries for a brand (optionally a single date), oldest first so the
 * fairest (earliest-created) entry is offered first by the WP-AVAIL-6 sweep.
 * Degrades to [] if the collection isn't present yet (pre-migration). Stable,
 * documented export consumed by /admin/diary (owned by another stream).
 */
export async function listWaitlist(brand: BrandId, date?: string): Promise<WaitlistRow[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	try {
		let filter = `restaurant=${q(restaurant.id)}`;
		// geisha_waitlist.date is a DATE field — PB stores it as a datetime
		// ('YYYY-MM-DD 00:00:00.000Z'), so an exact `date="YYYY-MM-DD"` never matches.
		// Match the whole calendar day as [date, nextDay): the lower bound is the bare
		// 'YYYY-MM-DD' (sorts at/below any same-day datetime AND a bare date string),
		// the upper bound is the next day exclusive.
		if (date) {
			const next = new Date(`${date}T00:00:00Z`);
			next.setUTCDate(next.getUTCDate() + 1);
			const nextDay = next.toISOString().slice(0, 10);
			filter += ` && date>=${q(date)} && date<${q(nextDay)}`;
		}
		return await c.collection('geisha_waitlist').getFullList<WaitlistRow>({
			filter,
			sort: 'created',
			expand: 'customer'
		});
	} catch {
		return [];
	}
}

/** Mark a waitlist entry cancelled (guest gave up, or staff cleared it). */
export async function cancelWaitlistEntry(id: string, actor: AuditActor = 'staff'): Promise<void> {
	const c = await pb();
	const before = await c.collection('geisha_waitlist').getOne<Waitlist>(id);
	const row = await c
		.collection('geisha_waitlist')
		.update<Waitlist>(id, { status: 'cancelled' });
	await writeAudit(actor, 'cancel_waitlist', 'geisha_waitlist', id, before, row);
}

// --- in-service waitlist (ResDiary W8List) ----------------------------------
// Staff manage walk-in demand during service from the diary: add a party to the
// list, notify them their table is ready ("Send"), and seat/convert them into a
// booking. These mirror joinWaitlist's customer-upsert + audit, but are STAFF
// actions (no anti-spam dedupe — a host adding a queue is deliberate).

export interface AddWaitlistInput {
	brand: BrandId;
	date: string; // 'YYYY-MM-DD'
	partySize: number;
	windowFrom: string; // 'HH:mm'
	windowTo: string; // 'HH:mm'
	customer: { name: string; email?: string; phone?: string };
}

/** Staff add a walk-in party to today's waitlist (status 'waiting'). */
export async function addWaitlistWalkIn(input: AddWaitlistInput): Promise<WaitlistRow> {
	const { brand, date, partySize, windowFrom, windowTo } = input;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new WaitlistError('A valid date is required.');
	if (!HHMM.test(windowFrom) || !HHMM.test(windowTo)) {
		throw new WaitlistError('A valid time window (HH:mm) is required.');
	}
	if (windowFrom > windowTo) {
		throw new WaitlistError('The window start must be on or before the window end.');
	}
	if (!Number.isInteger(partySize) || partySize < 1) {
		throw new WaitlistError('Party size must be at least 1.');
	}
	const restaurant = await getRestaurant(brand);
	const customer = await upsertCustomer({
		name: input.customer.name || 'Walk-in',
		email: input.customer.email ?? '',
		phone: input.customer.phone
	});
	const c = await pb();
	// window_from / window_to are DATE fields in PocketBase — a bare 'HH:mm' is
	// dropped to empty on write. Store the window as full datetimes on `date` so it
	// round-trips; readers format back to 'HH:mm'.
	const row = await c.collection('geisha_waitlist').create<WaitlistRow>({
		restaurant: restaurant.id,
		customer: customer.id,
		date,
		party_size: partySize,
		window_from: `${date}T${windowFrom}:00`,
		window_to: `${date}T${windowTo}:00`,
		status: 'waiting',
		notified_at: ''
	});
	await writeAudit('staff', 'add_waitlist', 'geisha_waitlist', row.id, null, row);
	// re-read with the customer expanded so the diary can show the name immediately
	return c
		.collection('geisha_waitlist')
		.getOne<WaitlistRow>(row.id, { expand: 'customer' })
		.catch(() => row);
}

/**
 * "Send" — notify a waiting party their table is ready. Flips the row to
 * 'offered' and stamps notified_at; the actual email/SMS is the caller's job
 * (reuses the confirmation infra). nowISO is passed in to keep this deterministic.
 */
export async function markWaitlistOffered(
	id: string,
	nowISO: string,
	actor: AuditActor = 'staff'
): Promise<WaitlistRow> {
	const c = await pb();
	const before = await c.collection('geisha_waitlist').getOne<Waitlist>(id);
	const row = await c
		.collection('geisha_waitlist')
		.update<WaitlistRow>(id, { status: 'offered', notified_at: nowISO });
	await writeAudit(actor, 'offer_waitlist', 'geisha_waitlist', id, before, row);
	return row;
}

/** Mark a waitlist entry claimed (it became a booking / was seated). */
export async function markWaitlistClaimed(id: string, actor: AuditActor = 'staff'): Promise<void> {
	const c = await pb();
	const before = await c.collection('geisha_waitlist').getOne<Waitlist>(id);
	const row = await c.collection('geisha_waitlist').update<Waitlist>(id, { status: 'claimed' });
	await writeAudit(actor, 'claim_waitlist', 'geisha_waitlist', id, before, row);
}
