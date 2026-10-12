// Advancing a booking once its payment has cleared.
//
// TWO CALLERS, ON PURPOSE
// -----------------------
//   1. POST /api/webhooks/stripe — Stripe telling the server directly. The
//      source of truth, and the only path that works if the guest closes the tab
//      the instant they hit Pay.
//   2. POST /api/bookings/[id]/payment-complete — the widget saying "the card
//      form succeeded", which then RE-READS the intent from Stripe before acting.
//
// Why both: webhooks are reliable but not instant, and a guest staring at a
// spinner for eight seconds after paying assumes it failed and pays again. The
// reconcile path lets the widget move on immediately. Neither trusts the browser
// — (2) verifies against Stripe's own copy of the intent before confirming
// anything, so a forged "I paid" POST confirms nothing.
//
// Both funnel through confirmPaidBooking(), which is idempotent: it only acts on
// a booking still in 'pending_payment', so whichever arrives second is a no-op
// and the guest never gets two confirmation emails.

import { pb } from '../db/pb.js';
import type { Booking, Customer, Payment, Restaurant } from '../db/types.js';
import { markPayment } from './payments.js';
import { writeAudit } from './audit.js';
import { sendBookingConfirmation, confirmationExtras } from '../email/confirmations.js';

/** Statuses that mean the guest has done their part. */
const CONFIRMS = new Set(['Authorized', 'Captured']);

export interface ConfirmOutcome {
	/** 'confirmed' on the transition; 'already' when someone beat us to it;
	 *  'pending' when the payment hasn't cleared; 'missing' for a bad id. */
	outcome: 'confirmed' | 'already' | 'pending' | 'missing';
	bookingStatus?: string;
}

/**
 * Record a cleared payment status and, when it clears, confirm the booking and
 * send its confirmation email.
 *
 * `status` must already be mapped to the geisha_payments vocabulary — callers
 * get it from stripe.mapStatus(), so the provider's own vocabulary never leaks
 * past the payments layer.
 */
export async function confirmPaidBooking(
	payment: Payment,
	status: 'Created' | 'Authorized' | 'Captured' | 'Reversed' | 'Refunded' | 'Canceled'
): Promise<ConfirmOutcome> {
	// A refund is stamped too: the deposit report dates it by reversed_at, as Stripe
	// does. If our own refund already stamped it, markPayment keeps that first time.
	await markPayment(payment.id, status, {
		...(status === 'Captured' ? { captured_at: new Date().toISOString() } : {}),
		...(status === 'Reversed' || status === 'Canceled' || status === 'Refunded'
			? { reversed_at: new Date().toISOString() }
			: {})
	});

	if (!CONFIRMS.has(status)) return { outcome: 'pending' };

	const c = await pb();
	const booking = await c
		.collection('geisha_bookings')
		.getOne<Booking>(payment.booking)
		.catch(() => null);
	if (!booking) return { outcome: 'missing' };
	if (booking.status !== 'pending_payment') {
		return { outcome: 'already', bookingStatus: booking.status };
	}

	const confirmed = await c
		.collection('geisha_bookings')
		.update<Booking>(booking.id, { status: 'confirmed' });
	await writeAudit(
		'system',
		'confirm_on_payment',
		'geisha_bookings',
		booking.id,
		booking,
		confirmed
	);

	// Email is best-effort — a bounced confirmation must not undo a paid booking.
	try {
		const [customer, restaurant] = await Promise.all([
			c.collection('geisha_customers').getOne<Customer>(confirmed.customer),
			c.collection('geisha_restaurants').getOne<Restaurant>(confirmed.restaurant)
		]);
		await sendBookingConfirmation(
			confirmed,
			customer,
			restaurant,
			paymentNoteFor(payment),
			await confirmationExtras(confirmed)
		);
	} catch (err) {
		console.error('[confirmPayment] confirmation email failed:', err);
	}

	return { outcome: 'confirmed', bookingStatus: confirmed.status };
}

/** The one line about money that goes in the confirmation email. */
export function paymentNoteFor(payment: Payment): string {
	if (payment.kind === 'deposit') {
		return `A deposit of £${(payment.amount / 100).toFixed(2)} has been taken and will be deducted from your final bill.`;
	}
	return `We've securely stored your card for the no-show policy. You won't be charged unless you don't arrive.`;
}
