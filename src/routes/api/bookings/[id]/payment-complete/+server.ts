// POST /api/bookings/[id]/payment-complete
//
// The booking widget calls this the moment Stripe's card form reports success,
// so the guest isn't left watching a spinner until the webhook lands. It exists
// alongside the webhook, not instead of it: webhooks are reliable but not
// instant, and several seconds of "please wait" after a successful payment is
// exactly how you get a second payment.
//
// NOTHING THE BROWSER SAYS IS TRUSTED. The body carries no status and no amount
// — the route looks the payment up by booking id and then asks STRIPE what
// happened. A forged POST therefore confirms nothing that Stripe wouldn't have
// confirmed a few seconds later anyway.
//
// Public and unauthenticated, like the booking create it follows. The only thing
// a caller can do with someone else's booking id is cause us to re-read that
// booking's intent from Stripe and apply the result — which is the correct
// outcome regardless of who asked.

import { json, error } from '@sveltejs/kit';
import { pb } from '$lib/server/db/pb.js';
import { confirmPaidBooking } from '$lib/server/booking/confirmPayment.js';
import { brandForBooking } from '$lib/server/booking/payments.js';
import {
	getPaymentIntent,
	getSetupIntent,
	intentKind,
	mapStatus,
	isStripeIntent
} from '$lib/server/payments/stripe.js';
import { rateLimit, clientKey, AVAILABILITY_READ } from '$lib/server/util/rateLimit.js';
import type { Booking, Payment } from '$lib/server/db/types.js';
import type { RequestHandler } from './$types';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	// Each call costs a Stripe round-trip, so it gets the same loose ceiling as
	// the other public reads — enough for a guest retrying, not enough to be a
	// free proxy onto our Stripe account.
	const burst = rateLimit(`paycomplete:${clientKey(request, getClientAddress)}`, AVAILABILITY_READ);
	if (!burst.ok) throw error(429, 'Too many requests — please wait a moment.');

	const id = params.id;
	if (!id) throw error(400, 'Missing booking id.');

	const c = await pb();
	const booking = await c
		.collection('geisha_bookings')
		.getOne<Booking>(id)
		.catch(() => null);
	if (!booking) throw error(404, 'Booking not found.');

	// Already confirmed (webhook won the race) — say so and let the widget move on.
	if (booking.status !== 'pending_payment') {
		return json({ confirmed: booking.status === 'confirmed', status: booking.status });
	}

	const payment = await c
		.collection('geisha_payments')
		.getFirstListItem<Payment>(`booking=${q(id)}`)
		.catch(() => null);
	if (!payment) {
		return json({ confirmed: false, status: booking.status, reason: 'no payment' });
	}

	const intentId = payment.dojo_payment_intent_id;
	if (!isStripeIntent(intentId)) {
		// A legacy stub id — it refers to no real intent, so there is nothing to read.
		return json({ confirmed: false, status: booking.status, reason: 'not a Stripe payment' });
	}

	const brand = await brandForBooking(id);

	try {
		const kind = intentKind(intentId);
		const status =
			kind === 'setup_intent'
				? mapStatus('setup_intent', (await getSetupIntent(intentId, brand)).status)
				: mapStatus('payment_intent', (await getPaymentIntent(intentId, brand)).status);

		const result = await confirmPaidBooking(payment, status);
		return json({
			confirmed: result.outcome === 'confirmed' || result.outcome === 'already',
			status: result.bookingStatus ?? booking.status,
			paymentStatus: status
		});
	} catch (err) {
		// A Stripe read failure is NOT a booking failure — the webhook will still
		// arrive. Report "not yet" so the widget shows its pending message.
		console.error('[payment-complete] Stripe read failed:', err);
		return json({ confirmed: false, status: booking.status, reason: 'provider unavailable' });
	}
};
