// POST /api/bookings — create a reservation.
// Body: { brand, date, time, partySize, customer:{name,email,phone?,marketingConsent?},
//         specialRequests?, occasion? }
// Returns the created booking, any payment requirement (deposit / no-show hold),
// and — when a payment is required — a `paymentSession` block the booking widget
// uses to collect the card: an inline Stripe client secret, with a graceful
// 'manual_fallback' when Stripe isn't configured. The Stripe webhook remains the
// source of truth for confirming the booking.
//
// It ALSO returns the two things a guest used to leave with nothing of:
//   • `reference` — a 7-char quotable booking reference (ResDiary parity), and
//   • `manageUrl` — the tokenised /book/[token] self-service link (change/cancel).
// Email is not wired up yet, which makes showing both on screen more important,
// not less: without them the guest has literally no evidence the booking exists.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { createBooking, BookingError } from '$lib/server/booking/index.js';
import { buildManagementUrl } from '$lib/server/booking/selfservice.js';
import { checkBookingVelocity } from '$lib/server/booking/velocity.js';
import { rateLimit, clientKey, BOOKING_CREATE } from '$lib/server/util/rateLimit.js';
import { describeOrigin } from '$lib/server/booking/origin.js';
import { writeAudit } from '$lib/server/booking/audit.js';
import { deferWork } from '$lib/server/util/defer.js';
import { bookingReference } from './reference.js';
import { hasSurname, SURNAME_REQUIRED } from '$lib/guestName.js';
import type { RequestHandler } from './$types';

/**
 * A phone number a human could actually ring back. Digits (7–15 of them, which
 * covers every E.164 number) plus the usual decoration. Deliberately permissive
 * about format and strict about "is there a number in here at all" — the sweep
 * booked a table whose only contact number was the string `abc`, and the house
 * policy releases the table 20 minutes after the booking time "if we don't hear
 * from you", so an uncontactable guest is a lost cover.
 */
const PHONE_OK = /^[+()\-.\s\d]{7,40}$/;
const phoneDigits = (s: string) => s.replace(/\D/g, '').length;

// `.trim()` BEFORE the length checks, everywhere: a name of three spaces used to
// pass `min(1)` and land a nameless row in the diary, and `  Name  ` was stored
// (and greeted) with its padding intact.
const trimmed = z.string().transform((s) => s.trim());

const Body = z.object({
	brand: z.enum(['asia', 'fusion']),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose a valid date.'),
	time: z.string().regex(/^\d{2}:\d{2}$/, 'Please choose a valid time.'),
	partySize: z
		.number({ message: 'Please tell us how many guests are coming.' })
		.int('Please enter a whole number of guests.')
		.min(1, 'Please enter at least 1 guest.')
		.max(50, 'That party is too large to book online — please call us.'),
	customer: z.object({
		// First name AND surname: a table under "Paul" is one of five Pauls at the door.
		// The forms ask for both; this catches an old copy of a form or a direct POST.
		name: trimmed.pipe(
			z
				.string()
				.min(2, 'Please enter the name the table should be under.')
				.max(120, 'That name is too long.')
				.refine(hasSurname, SURNAME_REQUIRED)
		),
		email: trimmed.pipe(
			z
				.string()
				.email('Please enter a valid email address, e.g. name@example.com.')
				.max(200, 'That email address is too long.')
		),
		phone: trimmed
			.pipe(
				z
					.string()
					.max(40, 'That phone number is too long.')
					.refine((v) => v === '' || (PHONE_OK.test(v) && phoneDigits(v) >= 7), {
						message: 'Please enter a valid phone number, e.g. 07700 900123.'
					})
			)
			.optional(),
		marketingConsent: z.boolean().optional()
	}),
	specialRequests: trimmed
		.pipe(z.string().max(2000, 'Please keep special requests under 2000 characters.'))
		.optional(),
	occasion: trimmed.pipe(z.string().max(120, 'Please keep the occasion under 120 characters.')).optional(),
	// Optional set-menu pre-order: the id of a menu in the brand's `set_menus`
	// catalogue. Resolved + snapshotted server-side (an unknown id is ignored);
	// persists into booking.preorder, degrading gracefully pre-migration.
	preorder: z.string().max(60).optional(),
	// The bookable OPTION the guest selected (ResDiary's mandatory "option"
	// step) — see GET /api/booking-options. Re-resolved against the slot
	// server-side, so an unknown or out-of-window id simply falls back to the
	// standard rules rather than erroring.
	option: z.string().max(60).optional()
});

export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	// ABUSE GUARD, layer 1 of 2 — per-IP burst limit.
	//
	// This endpoint consumes a scarce, revenue-bearing resource (a table) and was
	// reachable from the open internet with no throttle: a trivial script could fill
	// every slot with fake reservations and close the restaurant's book for the night.
	// Cheap and stateless; the exact, per-guest check is layer 2, below, after we
	// know who is booking. See $lib/server/util/rateLimit.ts for why it is two layers.
	const ip = clientKey(request, getClientAddress);
	const burst = rateLimit(`book:${ip}`, BOOKING_CREATE);
	if (!burst.ok) {
		throw error(
			429,
			'That is a lot of bookings from one place in a short time. Please wait a few minutes, or call us and we will take it over the phone.'
		);
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	const parsed = Body.safeParse(raw);
	if (!parsed.success) {
		// Plain-English, no field paths: this string is rendered straight to the
		// customer. The sweep caught us showing them
		// `{"message":"customer.email: Invalid email address"}`.
		const messages = [...new Set(parsed.error.issues.map((i) => i.message))];
		throw error(400, messages.join(' '));
	}

	// ABUSE GUARD, layer 2 of 2 — per-guest velocity, straight from the database.
	//
	// The IP limit above is per warm serverless instance and so is beatable by a
	// distributed script. This one is exact: it asks how many live bookings this
	// email/phone already holds. Deliberately AFTER validation (we need the parsed
	// contact details) and BEFORE createBooking (so nothing is written).
	const velocity = await checkBookingVelocity({
		brand: parsed.data.brand,
		email: parsed.data.customer.email,
		phone: parsed.data.customer.phone,
		date: parsed.data.date
	});
	if (!velocity.ok) throw error(429, velocity.message);

	try {
		// Map the wire fields onto createBooking's names: `preorder` is a set-menu
		// id, `option` is a bookable-option id.
		const { preorder, option, ...rest } = parsed.data;
		const result = await createBooking({
			...rest,
			setMenuId: preorder,
			optionId: option,
			source: 'online'
		});
		const id = result.booking.id;

		// Record WHERE this came from — the embed on the client's site, someone
		// opening the widget URL directly, or something we can't classify. Written
		// as its own audit row (no schema migration, and the booking row stays about
		// the reservation). actor='customer' is the point: nothing in the back office
		// can write that value, so the trail distinguishes a guest booking from a
		// staff one without anyone having to read the source to believe it.
		// Deferred + best-effort: a booking must never fail because a log didn't write.
		const origin = describeOrigin(request, url.host);
		deferWork(
			() => writeAudit('customer', 'booking_origin', 'geisha_bookings', id, null, origin),
			'booking origin'
		);

		return json(
			{
				booking: {
					id,
					// Quotable on the phone; derived from the id, so stable forever.
					reference: bookingReference(id),
					status: result.booking.status,
					startsAt: result.booking.starts_at,
					endsAt: result.booking.ends_at,
					partySize: result.booking.party_size
				},
				// Self-service change/cancel. '' when no link secret is configured —
				// the widget then simply doesn't offer the link. `ends_at` scopes the
				// token's life to the booking rather than a flat 180 days.
				manageUrl: buildManagementUrl(id, url.origin, result.booking.ends_at),
				payment: result.payment,
				paymentConfigured: result.paymentConfigured ?? false,
				paymentSession: result.paymentSession ?? null
			},
			{ status: 201 }
		);
	} catch (err) {
		if (err instanceof BookingError) {
			const status =
				err.code === 'blocked'
					? 403
					: err.code === 'phone_required' || err.code === 'no_availability'
						? 409
						: 400;
			throw error(status, err.message);
		}
		console.error('[api/bookings] unexpected error:', err);
		throw error(500, 'Could not create the booking. Please try again.');
	}
};
