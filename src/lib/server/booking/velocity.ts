// Per-guest booking velocity guard for the PUBLIC booking endpoint.
//
// WHY THIS EXISTS
// ───────────────
// POST /api/bookings hands out a scarce, revenue-bearing resource — a table — to
// anyone on the internet, and until now did so without limit. The realistic attack
// is not clever: a twenty-line script books every slot for the next fortnight under
// made-up names, the diary fills with parties that never arrive, and the restaurant
// turns away real guests all week. That is a straightforward way to cost the client
// a lot of money, and it needs no skill at all.
//
// The per-IP limiter in $lib/server/util/rateLimit.ts is the first line, but it
// lives in a serverless instance's memory, so a script rotating addresses gets more
// than its nominal share. THIS check is the exact one: it asks the database what
// this particular guest already holds, which no amount of IP rotation changes.
//
// DESIGN NOTES
// ────────────
//  • It runs BEFORE createBooking, so a refused attempt writes nothing at all.
//  • It costs at most two PocketBase reads, and only on the create path — never on
//    the availability lookups the widget fires as a guest browses dates.
//  • It is scoped to ONLINE bookings by identity. Staff bookings never reach this
//    endpoint (they go through the diary's form actions), so a host taking six
//    bookings for one regular is unaffected.
//  • It FAILS OPEN. If the lookup errors, the guest books. An anti-abuse guard must
//    never become the reason a paying customer cannot get a table — and if
//    PocketBase is genuinely unreachable, createBooking is about to fail anyway and
//    will say so properly.
//
// The thresholds are deliberately far above real guest behaviour. The aim is to
// make bulk abuse impractical, not to police an unusual but legitimate booking.

import { pb } from '../db/pb.js';
import { getRestaurant } from './queries.js';
import type { BrandId, Booking, Customer } from '../db/types.js';

/** Statuses that still hold a table. A cancelled booking should not count against
 *  a guest who changed their mind — otherwise cancelling twice locks them out. */
const LIVE_STATUSES = ['pending_payment', 'confirmed', 'seated', 'completed'];

/** Live, future bookings one guest may hold across the whole forward window. */
const MAX_UPCOMING = 6;

/** Live bookings one guest may hold on a SINGLE date. Two covers the genuine case
 *  (a large party split across two tables, booked twice); three is not a guest. */
const MAX_PER_DATE = 2;

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export interface VelocityVerdict {
	ok: boolean;
	/** Guest-facing text. Rendered verbatim, so it must read like the restaurant
	 *  talking, not like a security control. Empty when ok. */
	message: string;
}

const ALLOW: VelocityVerdict = { ok: true, message: '' };

/**
 * Should this guest be allowed to create another online booking?
 *
 * Identity is resolved the same way {@link upsertCustomer} resolves it — email
 * first, phone as the secondary key — so the count follows the same guest record
 * the booking will actually be attached to. A brand-new email/phone has no history
 * and is always allowed through; the IP limiter is what covers that case.
 */
export async function checkBookingVelocity(input: {
	brand: BrandId;
	email: string;
	phone?: string;
	/** The date being booked, 'YYYY-MM-DD'. */
	date: string;
}): Promise<VelocityVerdict> {
	const email = input.email.trim();
	const phone = (input.phone ?? '').trim();
	if (!email && !phone) return ALLOW; // nothing to key on; the IP limit stands alone

	try {
		const c = await pb();
		const restaurant = await getRestaurant(input.brand);

		// 1) Who is this? Email is the identity key, phone the fallback — mirroring
		//    upsertCustomer, so we count the record the booking will be filed under.
		const match = email ? `email=${q(email)}` : `phone=${q(phone)}`;
		let customer: Customer;
		try {
			customer = await c.collection('geisha_customers').getFirstListItem<Customer>(match);
		} catch {
			return ALLOW; // first-time guest: no history to judge, so no grounds to refuse
		}

		// 2) Everything live this guest holds from now on. One read; the forward
		//    booking window is weeks, not years, so this list stays small.
		//    `starts_at` is compared as a PocketBase datetime — see toPbDateFilter's
		//    note on the space-vs-T trap; a bare date bound is safe here because we
		//    only need "from the start of today onwards".
		const statusFilter = LIVE_STATUSES.map((s) => `status=${q(s)}`).join(' || ');
		const todayStart = `${new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })} 00:00:00`;
		const upcoming = await c.collection('geisha_bookings').getFullList<Booking>({
			filter:
				`restaurant=${q(restaurant.id)} && customer=${q(customer.id)} && ` +
				`starts_at>=${q(todayStart)} && (${statusFilter})`,
			fields: 'id,starts_at,source'
		});

		// Staff-made bookings are not the abuse we are guarding against, and a
		// regular whom the host books in every week must not be locked out of the
		// website. Only bookings the guest made themselves count towards the cap.
		const online = upcoming.filter((b) => b.source === 'online' || b.source === '');

		if (online.length >= MAX_UPCOMING) {
			return {
				ok: false,
				message:
					'You already have several upcoming reservations with us. Please give us a ring so we can arrange another one for you.'
			};
		}

		const sameDate = online.filter((b) => (b.starts_at ?? '').slice(0, 10) === input.date);
		if (sameDate.length >= MAX_PER_DATE) {
			return {
				ok: false,
				message:
					'It looks like you already have a table booked with us that day. If you need a bigger party or a second table, please call us and we will sort it out.'
			};
		}

		return ALLOW;
	} catch (err) {
		// FAIL OPEN, loudly. A spam guard that blocks real bookings when the database
		// hiccups costs the restaurant more than the spam it prevents.
		console.warn('[velocity] check failed, allowing booking through:', err);
		return ALLOW;
	}
}
