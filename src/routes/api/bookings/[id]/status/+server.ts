// GET /api/bookings/[id]/status — public, read-only booking + payment status.
//
// The booking widget polls this after the card-collection step (e.g. once the
// guest confirms the card) to learn whether the Stripe webhook
// has confirmed the booking yet. The WEBHOOK remains the source of truth: this
// endpoint only reports the current persisted state, it never advances it.
//
// Only non-sensitive fields are exposed (status, payment kind/status, amount) —
// no customer PII, table allocation, or provider secrets.

import { json, error } from '@sveltejs/kit';
import { pb } from '$lib/server/db/pb.js';
import type { Booking, Payment } from '$lib/server/db/types.js';
import type { RequestHandler } from './$types';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export const GET: RequestHandler = async ({ params }) => {
	const id = params.id;
	if (!id) throw error(400, 'Missing booking id.');

	const c = await pb();

	const booking = await c
		.collection('geisha_bookings')
		.getOne<Booking>(id)
		.catch(() => null);
	if (!booking) throw error(404, 'Booking not found.');

	const payment = await c
		.collection('geisha_payments')
		.getFirstListItem<Payment>(`booking=${q(id)}`)
		.catch(() => null);

	// 'confirmed' once the webhook reports Authorized/Captured; until then a
	// payment-bearing booking sits in 'pending_payment'.
	const awaitingPayment = booking.status === 'pending_payment';

	return json({
		booking: {
			id: booking.id,
			status: booking.status,
			startsAt: booking.starts_at,
			partySize: booking.party_size
		},
		payment: payment
			? { kind: payment.kind, status: payment.status, amountPence: payment.amount }
			: null,
		confirmed: booking.status === 'confirmed',
		awaitingPayment
	});
};
