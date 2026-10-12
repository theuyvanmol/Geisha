// POST /api/cron/release — expires abandoned unpaid holds (§S1-4). It no longer
// no-shows late bookings (the §6 20-minute rule) — see booking/release.ts.
// Protected by a shared secret so it isn't publicly triggerable. Authentication
// is enforced centrally in hooks.server.ts for every /api/cron/* route via the
//   x-cron-secret: <CRON_SECRET>
// header (503 if CRON_SECRET unset, 401 if the header doesn't match). By the
// time this handler runs the request is already authorised, so it just does the
// work. Schedule it (e.g. every 5 min) from PocketBase cron, a system crontab,
// or any external scheduler, sending the x-cron-secret header.

import { json } from '@sveltejs/kit';
import { runReleaseSweepAll } from '$lib/server/booking/release.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const result = await runReleaseSweepAll(new Date());
	return json({ ok: true, ...result });
};

/**
 * Vercel Cron issues a GET and offers no way to change the method, so the same
 * work has to be reachable that way or the schedule silently 405s forever.
 *
 * Safe to expose as a GET despite the write: the route is already behind the
 * CRON_SECRET gate in hooks.server.ts, and the sweep is idempotent — running it
 * twice releases nothing it hasn't already released.
 */
export const GET: RequestHandler = POST;
