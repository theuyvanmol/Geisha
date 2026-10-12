// GET /api/bookings/limits?brand=asia — the booking rules the guest widgets must
// obey, straight from the live settings.
//
// Why this exists: the QA sweep found FIVE different "maximum party size" numbers
// across the site (Asia copy said 8, Fusion copy said 30, Fusion's picker stopped
// at 12, Asia's stepper allowed 31, the API allowed 50). ResDiary keeps one
// min/max/default online party size and hard-caps the selector with it. This
// endpoint makes `online_party_max` the single source of truth for BOTH the
// selector's cap AND the on-page copy, so they can never disagree again — no
// number is hardcoded in either widget's copy.
//
// It also echoes the forward booking horizon so the date inputs can carry a real
// `max` on first paint instead of only after an availability lookup (a fast
// typist used to get year 92026 past step 1).

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getRestaurant, getSettings } from '$lib/server/booking/queries.js';
import type { RequestHandler } from './$types';

const Query = z.object({ brand: z.enum(['asia', 'fusion']) });

/** 'YYYY-MM-DD' in the restaurant's wall-clock, N days from now. */
function londonDayPlus(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const parsed = Query.safeParse({ brand: url.searchParams.get('brand') });
	if (!parsed.success) throw error(400, 'Unknown restaurant.');

	const restaurant = await getRestaurant(parsed.data.brand);
	const settings = await getSettings(restaurant.id);

	// Short cache: these are policy settings, not availability. A minute of
	// staleness is harmless and keeps the widget's mount cheap.
	setHeaders({ 'cache-control': 'public, max-age=60' });

	const windowDays = settings.booking_window_days;
	return json({
		brand: parsed.data.brand,
		minParty: 1,
		maxParty: settings.online_party_max,
		defaultParty: Math.min(2, settings.online_party_max),
		windowDays,
		minDate: londonDayPlus(0),
		maxDate: londonDayPlus(windowDays)
	});
};
