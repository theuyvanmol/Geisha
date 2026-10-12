// POST /api/bookings/[id]/payment-issue
//
// The widget reports here when the CARD STEP goes wrong in the guest's browser.
//
// WHY THE WEBHOOK ISN'T ENOUGH. Stripe tells us about failures it knows about —
// a declined card raises payment_intent.payment_failed. It knows nothing about
// the failures that happen before an attempt ever reaches it: js.stripe.com
// blocked by an ad blocker or a corporate proxy, the Payment Element refusing to
// mount inside the iframe, the guest's connection dropping mid-confirm. Those end
// the booking just as dead, and until now left no trace at all — the booking sat
// in pending_payment and expired, indistinguishable from someone who wandered off.
//
// NOTHING HERE IS TRUSTED. The body is free text from a browser, so it is written
// to the audit trail and nowhere else: it changes no status, moves no money and
// gates nothing. Its only reader is a human asking "are guests getting errors?".
// Unauthenticated for the same reason the create and payment-complete routes are
// — the guest hitting the problem has no session — and rate-limited so it can't
// be used to flood the log.

import { json, error } from '@sveltejs/kit';
import { pb } from '$lib/server/db/pb.js';
import { writeAudit } from '$lib/server/booking/audit.js';
import { describeOrigin } from '$lib/server/booking/origin.js';
import { rateLimit, clientKey, AVAILABILITY_READ } from '$lib/server/util/rateLimit.js';
import type { Booking, Payment } from '$lib/server/db/types.js';
import type { RequestHandler } from './$types';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
const clip = (v: unknown, max: number): string =>
	typeof v === 'string' ? v.trim().slice(0, max) : '';

/**
 * Where in the card step it broke — a closed set, so the report can group by it.
 * 'abandon' is the guest leaving the card step without paying (sent on page-hide):
 * before it, a guest who looked at the form and left, or left while it was still
 * loading, was indistinguishable from one who never got there.
 */
const STAGES = new Set(['load', 'mount', 'confirm', 'reconcile', 'abandon']);

export const POST: RequestHandler = async ({ params, request, url, getClientAddress }) => {
	const burst = rateLimit(`payissue:${clientKey(request, getClientAddress)}`, AVAILABILITY_READ);
	if (!burst.ok) throw error(429, 'Too many requests — please wait a moment.');

	const id = params.id;
	if (!id) throw error(400, 'Missing booking id.');

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		// A beacon sent on page-hide can arrive without a parseable body. Still worth
		// recording that SOMETHING failed on this booking.
	}

	const c = await pb();
	const booking = await c
		.collection('geisha_bookings')
		.getOne<Booking>(id)
		.catch(() => null);
	// Unknown id: acknowledge and drop. Reporting "no such booking" would turn this
	// into a way to test whether a booking id exists.
	if (!booking) return json({ ok: true });

	const payment = await c
		.collection('geisha_payments')
		.getFirstListItem<Payment>(`booking=${q(id)}`)
		.catch(() => null);

	const stage = clip(body.stage, 20);
	await writeAudit('customer', 'payment_issue', 'geisha_bookings', id, null, {
		booking: id,
		stage: STAGES.has(stage) ? stage : 'unknown',
		code: clip(body.code, 60),
		message: clip(body.message, 300),
		kind: payment?.kind ?? '',
		amount: payment?.amount ?? 0,
		intent: payment?.dojo_payment_intent_id ?? '',
		bookingStatus: booking.status,
		// The same origin block the booking itself carries, so a cluster of failures
		// can be read against one embed/browser rather than guessed at.
		origin: describeOrigin(request, url.host),
		source: 'widget'
	});

	return json({ ok: true });
};
