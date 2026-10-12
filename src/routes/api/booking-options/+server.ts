// GET /api/booking-options?brand=fusion&date=2026-08-07&time=13:00&party=2
//
// The options step of the booking widget — ResDiary's "An option is required for
// this booking" screen. Returns the bookable options for that exact slot, default
// first, each with its guest-facing copy, T&Cs and the deposit it would take for
// THIS party size.
//
// Public and read-only. Degrades to a single "Standard Booking" rather than an
// error: a guest who can't load the options can't get past the step, so an
// outage here would silently close the book.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { fromZonedTime } from 'date-fns-tz';
import { getRestaurant } from '$lib/server/booking/queries.js';
import { listBookingOptions } from '$lib/server/booking/options.js';
import { slotRequirement } from '$lib/server/booking/slotDeposit.js';
import { rateLimit, clientKey, AVAILABILITY_READ } from '$lib/server/util/rateLimit.js';
import type { RequestHandler } from './$types';

const Query = z.object({
	brand: z.enum(['asia', 'fusion']),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
	time: z.string().regex(/^\d{2}:\d{2}$/, 'time must be HH:mm'),
	party: z.coerce.number().int().min(1).max(50)
});

/** What the widget falls back to when anything below fails. */
const STANDARD_ONLY = [
	{
		id: 'standard',
		title: 'Standard Booking',
		blurb: 'A table from our full à la carte menu.',
		isDefault: true,
		depositPence: 0,
		depositKind: 'none' as const
	}
];

export const GET: RequestHandler = async ({ url, request, getClientAddress }) => {
	// Same loose ceiling as /api/availability — the widget fires one of these per
	// slot the guest taps, so it must not throttle real browsing.
	const burst = rateLimit(`opts:${clientKey(request, getClientAddress)}`, AVAILABILITY_READ);
	if (!burst.ok) throw error(429, 'Too many lookups just now — please try again in a moment.');

	const parsed = Query.safeParse({
		brand: url.searchParams.get('brand'),
		date: url.searchParams.get('date'),
		time: url.searchParams.get('time'),
		party: url.searchParams.get('party')
	});
	if (!parsed.success) throw error(400, parsed.error.issues.map((i) => i.message).join('; '));

	const { brand, date, time, party } = parsed.data;

	try {
		const restaurant = await getRestaurant(brand);
		const tz = restaurant.timezone || 'Europe/London';
		const startsAt = fromZonedTime(`${date}T${time}:00`, tz);
		// What the deposit rules will take for this slot, so an ordinary large table's
		// option says "£80 deposit" here rather than first on the card screen. Display
		// only, and never allowed to cost the guest this step: a failure just shows no
		// deposit, exactly as before.
		const inherited = await slotRequirement(
			brand,
			restaurant.id,
			date,
			time,
			startsAt,
			tz,
			party
		).catch((err) => {
			console.error('[api/booking-options] deposit preview unavailable:', err);
			return undefined;
		});
		const options = await listBookingOptions(brand, startsAt, tz, party, undefined, inherited);
		return json({
			brand,
			date,
			time,
			partySize: party,
			options: options.length ? options : STANDARD_ONLY
		});
	} catch (err) {
		console.error('[api/booking-options] falling back to standard only:', err);
		return json({ brand, date, time, partySize: party, options: STANDARD_ONLY });
	}
};
