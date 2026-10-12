// GET /api/admin/bookings/[id]/history — one booking's change history.
//
// Feeds the diary popover's "History" modal. ResDiary opens its booking history
// in a window of its own (booking_history.aspx) rather than navigating away, and
// the reason is the service floor: a host checking why a table moved must not
// lose the diary they are working in. The booking page renders the same data
// inline at #history, so the two stay in step by both reading getBookingHistory.
//
// Read-only, so any signed-in staff member may call it — the same tier that can
// already see the booking on the diary.

import { json, error } from '@sveltejs/kit';
import { getBookingHistory } from '$lib/server/booking/history.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.staff) throw error(401, 'Sign in required.');
	const history = await getBookingHistory(params.id);
	return json({ history });
};
