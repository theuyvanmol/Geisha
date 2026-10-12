// POST /api/waitlist — join the waitlist for a fully-booked / capped date.
// Body: { brand, date, partySize, windowFrom, windowTo,
//         customer:{name,email,phone?,marketingConsent?} }
// Public + brand-locked. Captures a geisha_waitlist row (status 'waiting'); the
// notify-when-free sweep (WP-AVAIL-6) later matches freed tables to these.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { joinWaitlist, WaitlistError } from '$lib/server/booking/index.js';
import { getRestaurant, getSettings } from '$lib/server/booking/queries.js';
import { rateLimit, clientKey, WAITLIST_JOIN } from '$lib/server/util/rateLimit.js';
import { hasSurname, SURNAME_REQUIRED } from '$lib/guestName.js';
import type { RequestHandler } from './$types';

const Body = z.object({
	brand: z.enum(['asia', 'fusion']),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	partySize: z.number().int().min(1).max(50),
	windowFrom: z.string().regex(/^\d{2}:\d{2}$/),
	windowTo: z.string().regex(/^\d{2}:\d{2}$/),
	customer: z.object({
		// First name AND surname, as for a booking (see $lib/guestName.ts).
		name: z
			.string()
			.transform((s) => s.trim())
			.pipe(z.string().min(1).max(120).refine(hasSurname, SURNAME_REQUIRED)),
		email: z.string().email(),
		phone: z.string().max(40).optional(),
		marketingConsent: z.boolean().optional()
	})
});

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// Public write endpoint: same burst guard as the booking create path. A flooded
	// waitlist is less costly than a flooded diary, but it still feeds the
	// notify-when-free sweep and the guest comms that go out from it.
	const burst = rateLimit(`waitlist:${clientKey(request, getClientAddress)}`, WAITLIST_JOIN);
	if (!burst.ok) {
		throw error(429, 'Please wait a few minutes before joining the waitlist again.');
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	const parsed = Body.safeParse(raw);
	if (!parsed.success) {
		// The surname message is written for the guest, so show it on its own rather
		// than as "customer.name: …". Anything else keeps its field path.
		const issues = parsed.error.issues;
		throw error(
			400,
			issues.some((i) => i.message === SURNAME_REQUIRED)
				? SURNAME_REQUIRED
				: issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
		);
	}
	const data = parsed.data;

	if (data.windowFrom > data.windowTo) {
		throw error(400, 'The window start must be on or before the window end.');
	}

	// Large parties book by phone (mirrors BookingPanel's bigParty rule).
	try {
		const restaurant = await getRestaurant(data.brand);
		const settings = await getSettings(restaurant.id);
		if (data.partySize > settings.online_party_max) {
			throw error(409, `Parties over ${settings.online_party_max} must join the waitlist by phone.`);
		}
	} catch (err) {
		// A thrown SvelteKit error has a numeric `status`; re-throw it untouched.
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[api/waitlist] settings lookup failed:', err);
		throw error(500, 'Could not join the waitlist. Please try again.');
	}

	try {
		const result = await joinWaitlist(data);
		return json({ id: result.id }, { status: 201 });
	} catch (err) {
		if (err instanceof WaitlistError) {
			throw error(err.code === 'duplicate' ? 409 : 400, err.message);
		}
		console.error('[api/waitlist] unexpected error:', err);
		throw error(500, 'Could not join the waitlist. Please try again.');
	}
};
