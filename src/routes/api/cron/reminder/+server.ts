// POST /api/cron/reminder — pre-service reminder sweep (core no-show reducer).
//
// Finds confirmed bookings ~24h out that haven't had a reminder sent yet and
// emails the guest a friendly "see you tomorrow" note (template 'reminder'),
// logging every outcome to geisha_messages. IDEMPOTENT: a booking that already
// has a 'reminder' message row is skipped, so the cron can run as often as you
// like (e.g. hourly) without double-sending.
//
// Protected by a shared secret enforced centrally in hooks.server.ts for every
// /api/cron/* route via the `x-cron-secret: <CRON_SECRET>` header (503 if
// CRON_SECRET unset, 401 if it doesn't match). By the time this handler runs the
// request is already authorised, so it just does the work. Schedule it from
// PocketBase cron, a system crontab, or any external scheduler.

import { json } from '@sveltejs/kit';
import { pb } from '$lib/server/db/pb.js';
import type { Booking, BrandId, Customer, Restaurant } from '$lib/server/db/types.js';
import { getRestaurant, toPbDateFilter } from '$lib/server/booking/queries.js';
import { sendReminder, REMINDER_TEMPLATE } from '$lib/server/email/confirmations.js';
import type { RequestHandler } from './$types';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

const BRANDS: BrandId[] = ['asia', 'fusion'];

// Window around "now + 24h" in which a confirmed booking is considered due for a
// reminder. A wide-ish window (±6h) tolerates a cron that runs only a few times a
// day; idempotency (one 'reminder' row per booking) prevents duplicate sends, so
// overlapping windows on successive runs are harmless.
const LEAD_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 6 * 60 * 60 * 1000;

interface BookingWithCustomer extends Booking {
	expand?: { customer?: Customer };
}

export interface ReminderResult {
	checked: number;
	sent: string[]; // booking ids a reminder was sent for
	skipped: string[]; // already reminded / no email
	failed: string[]; // send attempted but Resend reported failure
}

/** True if a 'reminder' message row already exists for this booking (idempotency). */
async function alreadyReminded(bookingId: string): Promise<boolean> {
	const c = await pb();
	try {
		await c
			.collection('geisha_messages')
			.getFirstListItem(`booking=${q(bookingId)} && template=${q(REMINDER_TEMPLATE)}`);
		return true;
	} catch {
		return false; // 404 from getFirstListItem = no such row
	}
}

/** Sweep one brand: send reminders to confirmed bookings ~24h out. */
async function sweepBrand(brand: BrandId, now: Date): Promise<ReminderResult> {
	let restaurant: Restaurant;
	try {
		restaurant = await getRestaurant(brand);
	} catch {
		// Brand/restaurant not provisioned yet — degrade gracefully.
		return { checked: 0, sent: [], skipped: [], failed: [] };
	}

	const c = await pb();
	const from = toPbDateFilter(new Date(now.getTime() + LEAD_MS - WINDOW_MS).toISOString());
	const to = toPbDateFilter(new Date(now.getTime() + LEAD_MS + WINDOW_MS).toISOString());

	const due = await c.collection('geisha_bookings').getFullList<BookingWithCustomer>({
		filter:
			`restaurant=${q(restaurant.id)} && status=${q('confirmed')} && ` +
			`starts_at>=${q(from)} && starts_at<=${q(to)}`,
		expand: 'customer'
	});

	const result: ReminderResult = { checked: due.length, sent: [], skipped: [], failed: [] };

	for (const b of due) {
		// Idempotency guard — skip anything already reminded.
		if (await alreadyReminded(b.id)) {
			result.skipped.push(b.id);
			continue;
		}

		// Resolve the customer (expanded, else direct read). No customer/email → skip.
		let customer = b.expand?.customer;
		if (!customer && b.customer) {
			try {
				customer = await c.collection('geisha_customers').getOne<Customer>(b.customer);
			} catch {
				customer = undefined;
			}
		}
		if (!customer || !customer.email) {
			result.skipped.push(b.id);
			continue;
		}

		const { sent } = await sendReminder(b, customer, restaurant);
		if (sent) result.sent.push(b.id);
		else result.failed.push(b.id);
	}

	return result;
}

export const POST: RequestHandler = async () => {
	const now = new Date();
	const byBrand: Record<string, ReminderResult> = {};
	for (const brand of BRANDS) {
		byBrand[brand] = await sweepBrand(brand, now);
	}
	return json({ ok: true, ...byBrand });
};

/**
 * Vercel Cron issues a GET — see the note on the release route. Idempotent by
 * the same mechanism the sweep already relies on: a booking that has been sent
 * its reminder is skipped, so a second run in the same day sends nothing.
 */
export const GET: RequestHandler = POST;
