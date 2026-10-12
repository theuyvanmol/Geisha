// GET|POST /api/cron/feedback — the morning-after "How was your visit?" email.
//
// ResDiary parity: every guest who BOOKED ONLINE and came in is asked to score
// the visit 0–5. Scheduled daily at 10:00 UTC from vercel.json (11:00 BST /
// 10:00 GMT), which covers everyone who dined the day before; the 48-hour
// lookback lets one missed run catch up. The rules are in feedback/rules.ts.
//
// IDEMPOTENT: a booking with a non-failed `feedback_request` row in
// geisha_messages is never emailed again, so re-running the same morning sends
// nothing. A failed send retries on the next run (while still inside the window).
//
// `?dry=1` reports who WOULD be emailed and sends nothing — safe against live data.
//
// Auth is central in hooks.server.ts for every /api/cron/* route (CRON_SECRET).

import { json } from '@sveltejs/kit';
import { pb } from '$lib/server/db/pb.js';
import { getRestaurant, toPbDateFilter } from '$lib/server/booking/queries.js';
import { isCustomerBlocked } from '$lib/server/booking/crm.js';
import { bookingReference } from '$lib/bookings/reference';
import type { Booking, BrandId, Customer, Message, Restaurant } from '$lib/server/db/types.js';
import { acquireLock, releaseLock, type LockHandle } from '$lib/server/db/lock.js';
import { getGuestFeedbackConfigForSend } from '$lib/server/feedback/config.js';
import { sendFeedbackRequest } from '$lib/server/feedback/email.js';
import { feedbackStoreReady } from '$lib/server/feedback/store.js';
import {
	FEEDBACK_TEMPLATE,
	LOOKBACK_HOURS,
	feedbackEligibility
} from '$lib/server/feedback/rules.js';
import type { RequestHandler } from './$types';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
const BRANDS: BrandId[] = ['asia', 'fusion'];

type BookingWithCustomer = Booking & { expand?: { customer?: Customer } };

export interface FeedbackSweepResult {
	enabled: boolean;
	checked: number;
	/** Booking references emailed (or, on a dry run, that would be). */
	sent: string[];
	failed: string[];
	/** Why the rest were left alone, counted. */
	skipped: Record<string, number>;
	/** Set when the whole brand was skipped for a reason other than being switched off. */
	error?: string;
}

/** How long a sweep may hold its lock before a crashed run's lock lapses. */
const LOCK_TTL_MS = 5 * 60_000;

async function sweepBrand(brand: BrandId, now: Date, dry: boolean): Promise<FeedbackSweepResult> {
	const result: FeedbackSweepResult = { enabled: true, checked: 0, sent: [], failed: [], skipped: {} };

	let restaurant: Restaurant;
	try {
		restaurant = await getRestaurant(brand);
	} catch {
		return { ...result, enabled: false };
	}

	try {
		if (!(await getGuestFeedbackConfigForSend(restaurant.id)).enabled) {
			return { ...result, enabled: false };
		}
	} catch {
		return { ...result, error: 'Could not read the feedback settings, so nothing was sent.' };
	}
	if (dry) return selectAndSend(restaurant, now, true, result);

	// The already-sent list is read once, before the send loop. Two overlapping runs
	// (a repeated cron delivery, a manual call during the real one) would both read
	// it empty and email every guest twice — so only one run per brand at a time.
	let lock: LockHandle;
	try {
		lock = await acquireLock(`feedback-sweep:${restaurant.id}`, LOCK_TTL_MS, 1_000);
	} catch {
		return { ...result, error: 'Another run is already sending for this restaurant; skipped.' };
	}
	try {
		return await selectAndSend(restaurant, now, false, result);
	} finally {
		await releaseLock(lock);
	}
}

async function selectAndSend(
	restaurant: Restaurant,
	now: Date,
	dry: boolean,
	result: FeedbackSweepResult
): Promise<FeedbackSweepResult> {
	const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1);
	const c = await pb();
	const since = toPbDateFilter(new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000).toISOString());
	const until = toPbDateFilter(now.toISOString());

	const [bookings, logged] = await Promise.all([
		c.collection('geisha_bookings').getFullList<BookingWithCustomer>({
			filter:
				`restaurant=${q(restaurant.id)} && source="online" && ` +
				`(status="completed" || status="seated") && starts_at>=${q(since)} && starts_at<${q(until)}`,
			expand: 'customer'
		}),
		// Everything already emailed for the same window of visits. Filtered through
		// the booking relation rather than the message's own timestamp, so it can't
		// miss a request however late in the window it was sent.
		c.collection('geisha_messages').getFullList<Message>({
			filter:
				`template=${q(FEEDBACK_TEMPLATE)} && status!="failed" && ` +
				`booking.restaurant=${q(restaurant.id)} && booking.starts_at>=${q(since)}`,
			fields: 'booking'
		})
	]);
	const alreadySent = new Set(logged.map((m) => m.booking));
	result.checked = bookings.length;

	for (const b of bookings) {
		const customer = b.expand?.customer ?? null;
		const verdict = feedbackEligibility(b, customer, now, {
			blocked: isCustomerBlocked(customer),
			timezone: restaurant.timezone
		});
		if (!verdict.ok) {
			skip(verdict.reason);
			continue;
		}
		if (alreadySent.has(b.id)) {
			skip('already_sent');
			continue;
		}
		const ref = bookingReference(b.id);
		if (dry) {
			result.sent.push(ref);
			continue;
		}
		const { sent, reason } = await sendFeedbackRequest(b, customer as Customer, restaurant, now);
		if (sent) result.sent.push(ref);
		else if (reason === 'no_link') skip('no_link_secret');
		else result.failed.push(ref);
	}

	return result;
}

export const POST: RequestHandler = async ({ url }) => {
	const dry = url.searchParams.get('dry') === '1';
	if (!(await feedbackStoreReady())) {
		return json({
			ok: false,
			dry,
			error: 'geisha_feedback is not deployed yet — nothing sent (run the 1786200000 migration).'
		});
	}
	const now = new Date();
	const byBrand: Record<string, FeedbackSweepResult> = {};
	for (const brand of BRANDS) byBrand[brand] = await sweepBrand(brand, now, dry);
	return json({ ok: true, dry, ...byBrand });
};

/** Vercel Cron issues a GET. Safe to repeat — see the idempotency note above. */
export const GET: RequestHandler = POST;
