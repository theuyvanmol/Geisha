// Diary day payload as JSON — the client's day cache warms neighbouring days
// through this so a day step paints instantly instead of freezing the board for
// a whole cross-region loader round-trip.
//
// It calls the SAME loadDiaryDay() the page loader calls, so a prefetched day is
// exactly what a navigation would have produced — the cached paint can never
// disagree with the truth that lands a moment later.
//
// Access: hooks.server.ts already gates /api/admin/* against the shared access
// map (server+ for this catch-all), and returns a JSON 401/403 rather than a
// redirect — which is what a background fetch wants.

import { json, error } from '@sveltejs/kit';
import { loadDiaryDay } from '$lib/server/service/diaryDay.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const brand = url.searchParams.get('brand') === 'fusion' ? 'fusion' : 'asia';
	const date = url.searchParams.get('date') || '';
	const floorId = url.searchParams.get('floor') || undefined;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw error(400, 'A date (YYYY-MM-DD) is required.');

	const day = await loadDiaryDay({ brand, date, floorId });
	// Never cached by a proxy/browser: a diary day is live service data, and the
	// client owns its own (short, revalidated) cache of it.
	setHeaders({ 'cache-control': 'no-store' });
	return json(day);
};
