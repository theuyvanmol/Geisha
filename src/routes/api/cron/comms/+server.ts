// POST /api/cron/comms — autonomous personalised guest-comms sweep
// (mf-guest-comms). Selects bookings/customers needing a touch (post-visit
// thank-you, win-back for lapsed guests, birthday/occasion, optional AI
// reminder), DRAFTS personalised copy per recipient (runAgent text-only, with a
// deterministic fallback), and queues each to geisha_messages as a 'draft'
// (review-first) — or sends immediately for any kind the owner has set to
// auto-send. IDEMPOTENT: a guest already touched for that kind in the dedupe
// window is skipped, so the cron can run nightly + hourly across multiple
// instances without double-messaging.
//
// Protected by the shared secret enforced centrally in hooks.server.ts for every
// /api/cron/* route via the `x-cron-secret: <CRON_SECRET>` header (503 if
// CRON_SECRET unset, 401 on mismatch). By the time this handler runs the request
// is already authorised, so it just does the work. Schedule it from PocketBase
// cron, a system crontab, or any external scheduler.

import { json } from '@sveltejs/kit';
import { runCommsSweepAll } from '$lib/server/comms/engine.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
	const results = await runCommsSweepAll(new Date());
	return json({ ok: true, results });
};
