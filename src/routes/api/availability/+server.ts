// GET /api/availability?brand=asia&date=2025-06-07&party=4
// Returns bookable slots for the customer widget.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getAvailability } from '$lib/server/booking/index.js';
import { rateLimit, clientKey, AVAILABILITY_READ } from '$lib/server/util/rateLimit.js';
import type { RequestHandler } from './$types';

const Query = z.object({
	brand: z.enum(['asia', 'fusion']),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
	party: z.coerce.number().int().min(1).max(50)
});

export const GET: RequestHandler = async ({ url, request, getClientAddress }) => {
	// A read, so the limit is loose by design — the widget legitimately fires several
	// of these as a guest scrolls through dates, and throttling a real guest's browsing
	// breaks the booking flow for no security gain. This ceiling only catches a
	// scraper or a crude flood, both of which cost real PocketBase round-trips on a
	// 1GB box shared with other services.
	const burst = rateLimit(`avail:${clientKey(request, getClientAddress)}`, AVAILABILITY_READ);
	if (!burst.ok) throw error(429, 'Too many lookups just now — please try again in a moment.');

	const parsed = Query.safeParse({
		brand: url.searchParams.get('brand'),
		date: url.searchParams.get('date'),
		party: url.searchParams.get('party')
	});
	if (!parsed.success) {
		throw error(400, parsed.error.issues.map((i) => i.message).join('; '));
	}

	const { brand, date, party } = parsed.data;

	const result = await getAvailability(brand, date, party);

	return json({
		brand,
		date,
		partySize: party,
		requiresPhone: result.requiresPhone,
		// Closure info (WP-AVAIL-2) so the widget can say "closed for a private
		// event" rather than a generic "fully booked", and so the waitlist option
		// (WP-AVAIL-5) is hidden on closed dates.
		closed: result.closed ?? false,
		closureReason: result.closureReason ?? '',
		// Effective booking horizon echoed back (WP-AVAIL-3) for picker constraints.
		bookingWindow: result.bookingWindow ?? null,
		slots: result.slots.map((s) => ({
			time: s.time,
			available: s.available,
			// Per-slot reason (WP-AVAIL-1/2/3): 'full' | 'slot_cap' | 'period_cap' |
			// 'too_soon' | 'beyond_window' — lets the widget explain an empty grid.
			unavailableReason: s.unavailableReason ?? null
		}))
	});
};
