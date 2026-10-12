// GET /api/availability/month?brand=fusion&year=2026&month=8&party=2
//
// Per-date status for one calendar month, so the guest widget's inline date
// picker can colour the grid the way ResDiary's did. One request per month view
// instead of one per day — see monthAvailability.ts for why that matters against
// the shared droplet.
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getMonthAvailability } from '$lib/server/booking/monthAvailability.js';
import { rateLimit, clientKey, AVAILABILITY_READ } from '$lib/server/util/rateLimit.js';
import type { RequestHandler } from './$types';

const Query = z.object({
	brand: z.enum(['asia', 'fusion']),
	year: z.coerce.number().int().min(2020).max(2100),
	month: z.coerce.number().int().min(1).max(12),
	party: z.coerce.number().int().min(1).max(50)
});

export const GET: RequestHandler = async ({ url, request, getClientAddress, setHeaders }) => {
	// Shares the availability bucket: a guest paging through months is doing the
	// same kind of read as a guest paging through days, and this costs strictly
	// less than the 31 day-requests it replaces.
	const burst = rateLimit(`availmonth:${clientKey(request, getClientAddress)}`, AVAILABILITY_READ);
	if (!burst.ok) throw error(429, 'Too many lookups just now — please try again in a moment.');

	const parsed = Query.safeParse({
		brand: url.searchParams.get('brand'),
		year: url.searchParams.get('year'),
		month: url.searchParams.get('month'),
		party: url.searchParams.get('party')
	});
	if (!parsed.success) throw error(400, parsed.error.issues.map((i) => i.message).join('; '));

	const { brand, year, month, party } = parsed.data;
	const result = await getMonthAvailability(brand, year, month, party);

	// A short private cache. Availability genuinely moves as bookings land, so this
	// is deliberately brief — long enough to make paging back and forth through
	// months feel instant, short enough that a date can't stay green for long after
	// it fills. Private: the grid is party-size specific, never share it in a CDN.
	setHeaders({ 'cache-control': 'private, max-age=30' });

	return json(result);
};
