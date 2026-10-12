// Reading and writing guest feedback (geisha_feedback) for the public
// /feedback/[token] page. The token has already been verified by the caller; the
// booking id it yields is the only id trusted here.

import { pb } from '../db/pb.js';
import type { Booking, BrandId, Customer, GuestFeedback, Restaurant } from '../db/types.js';
import { getGuestFeedbackConfig } from './config.js';
import { cleanComment, offersGoogleReview, parseScore } from './rules.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export interface FeedbackContext {
	booking: Booking;
	customer: Customer | null;
	restaurant: Restaurant;
	/** The guest's earlier answer from this link, if any. */
	feedback: GuestFeedback | null;
}

/** Null when the booking is gone. Never throws for a missing answer or customer. */
export async function loadFeedbackContext(bookingId: string): Promise<FeedbackContext | null> {
	const c = await pb();
	let booking: Booking;
	try {
		booking = await c.collection('geisha_bookings').getOne<Booking>(bookingId);
	} catch {
		return null;
	}
	const [restaurant, customer, feedback] = await Promise.all([
		c.collection('geisha_restaurants').getOne<Restaurant>(booking.restaurant),
		booking.customer
			? c
					.collection('geisha_customers')
					.getOne<Customer>(booking.customer)
					.catch(() => null)
			: Promise.resolve(null),
		c
			.collection('geisha_feedback')
			.getFirstListItem<GuestFeedback>(`booking=${q(booking.id)}`)
			.catch(() => null)
	]);
	return { booking, customer, restaurant, feedback };
}

export class FeedbackInputError extends Error {}

export interface SubmitResult {
	score: number;
	/** Set only when the guest should be offered the Google review button. */
	googleReviewUrl: string;
}

/**
 * Save (or replace) the guest's answer. Nothing is emailed to staff, whatever the
 * score — low scores are read in Reports → Feedback (the owner's call).
 */
export async function submitFeedback(
	ctx: FeedbackContext,
	rawScore: unknown,
	rawComment: unknown,
	now = new Date()
): Promise<SubmitResult> {
	const score = parseScore(rawScore);
	if (score === null) throw new FeedbackInputError('Please choose a score from 0 to 5.');
	const comment = cleanComment(rawComment);

	const c = await pb();
	const fields = {
		score,
		comment,
		visit_at: ctx.booking.starts_at,
		submitted_at: now.toISOString(),
		source: 'email'
	};

	let row: GuestFeedback;
	const existing =
		ctx.feedback ??
		(await c
			.collection('geisha_feedback')
			.getFirstListItem<GuestFeedback>(`booking=${q(ctx.booking.id)}`)
			.catch(() => null));
	if (existing) {
		row = await c.collection('geisha_feedback').update<GuestFeedback>(existing.id, fields);
	} else {
		try {
			row = await c.collection('geisha_feedback').create<GuestFeedback>({
				...fields,
				restaurant: ctx.restaurant.id,
				booking: ctx.booking.id
			});
		} catch (err) {
			// A double-tap raced us past the unique booking index: update the winner.
			const winner = await c
				.collection('geisha_feedback')
				.getFirstListItem<GuestFeedback>(`booking=${q(ctx.booking.id)}`)
				.catch(() => null);
			if (!winner) throw err;
			row = await c.collection('geisha_feedback').update<GuestFeedback>(winner.id, fields);
		}
	}

	const config = await getGuestFeedbackConfig(ctx.restaurant.brand as BrandId);

	return {
		score: row.score,
		googleReviewUrl: offersGoogleReview(row.score, config.googleReviewUrl)
			? config.googleReviewUrl
			: ''
	};
}

/** The "Stop feedback emails" link. Idempotent. */
export async function optOutOfFeedback(ctx: FeedbackContext): Promise<void> {
	if (!ctx.customer) return;
	const c = await pb();
	await c.collection('geisha_customers').update(ctx.customer.id, { feedback_opt_out: true });
}

/**
 * Has the geisha_feedback migration been deployed? The cron checks before
 * emailing anyone: sending links to a page that can't save an answer would waste
 * the one email each guest gets.
 */
export async function feedbackStoreReady(): Promise<boolean> {
	try {
		const c = await pb();
		await c.collection('geisha_feedback').getList(1, 1, { fields: 'id' });
		return true;
	} catch {
		return false;
	}
}
