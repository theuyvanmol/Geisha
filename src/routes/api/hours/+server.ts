// GET /api/hours?brand=asia — public opening hours from the LIVE bookable
// service periods (geisha_service_periods), so what the guest sees matches what
// the diary will actually book.
//
// The site itself no longer needs this endpoint — every public page gets the
// same payload server-rendered via the brand layout load (`data.hours`), which
// avoids a fetch-on-mount flash. It stays for external callers and as a cheap
// way to eyeball what the site is advertising.
//
// The grouping/formatting lives in $lib/server/booking/hours.ts + $lib/hours.ts
// so this route and the pages can't drift. Never 500s: getPublicHours falls back
// to the static copy and flags it with `live: false`.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getPublicHours } from '$lib/server/booking/hours';
import type { RequestHandler } from './$types';

const Query = z.object({ brand: z.enum(['asia', 'fusion']) });

export const GET: RequestHandler = async ({ url }) => {
	const parsed = Query.safeParse({ brand: url.searchParams.get('brand') });
	if (!parsed.success) throw error(400, 'brand must be asia or fusion');

	const hours = await getPublicHours(parsed.data.brand);
	return json({
		brand: hours.brand,
		live: hours.live,
		// `days` keeps its original shape (open days only, each with its services)
		// for any existing consumer.
		days: hours.days
			.filter((d) => d.periods.length)
			.map((d) => ({ day: d.day, periods: d.periods })),
		// Display-ready forms, the same ones the pages render.
		summary: hours.summary,
		compact: hours.compact,
		strap: hours.strap,
		lastBookingNote: hours.lastBookingNote,
		note: hours.note
	});
};
