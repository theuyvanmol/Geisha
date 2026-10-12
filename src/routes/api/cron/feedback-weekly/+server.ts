// GET|POST /api/cron/feedback-weekly — the Monday guest-feedback summary.
//
// One email per restaurant to its owners and managers (or the list in Settings →
// Guest feedback emails), covering last Monday–Sunday: average score against the
// week before, replies, and every comment, lowest first. Scheduled Mondays at
// 08:00 UTC from vercel.json (09:00 BST / 08:00 GMT). The content is built in
// feedback/weekly.ts and sent by feedback/weeklySend.ts.
//
// IDEMPOTENT per restaurant per week (see weeklySend.ts), so a repeated cron
// delivery sends nothing.
//
// Query params (all optional):
//   ?dry=1             — build it and report who WOULD get it; sends nothing
//   ?preview=1         — with dry=1, also return the rendered HTML
//   ?brand=asia|fusion — one restaurant only (default: both)
//   ?week=YYYY-MM-DD   — summarise the Monday–Sunday week containing this date
//   ?force=1           — send even if this week's summary already went out
//
// Auth is central in hooks.server.ts for every /api/cron/* route (CRON_SECRET).

import { json } from '@sveltejs/kit';
import type { BrandId } from '$lib/server/db/types.js';
import { feedbackStoreReady } from '$lib/server/feedback/store.js';
import { sendWeeklySummary } from '$lib/server/feedback/weeklySend.js';
import type { RequestHandler } from './$types';

const BRANDS: BrandId[] = ['asia', 'fusion'];

export const POST: RequestHandler = async ({ url }) => {
	const dry = url.searchParams.get('dry') === '1';
	if (!(await feedbackStoreReady())) {
		return json({ ok: false, dry, error: 'geisha_feedback is not deployed — nothing sent.' });
	}
	const brandParam = url.searchParams.get('brand');
	const brands: BrandId[] =
		brandParam === 'asia' || brandParam === 'fusion' ? [brandParam] : BRANDS;
	const opts = {
		dry,
		preview: dry && url.searchParams.get('preview') === '1',
		force: url.searchParams.get('force') === '1',
		week: url.searchParams.get('week') ?? undefined
	};

	const now = new Date();
	const results: Record<string, unknown> = {};
	for (const brand of brands) {
		try {
			results[brand] = await sendWeeklySummary(brand, now, opts);
		} catch (err) {
			console.error('[feedback-weekly]', brand, err);
			results[brand] = { error: 'Could not build or send the summary; nothing was recorded.' };
		}
	}
	return json({ ok: true, dry, ...results });
};

/** Vercel Cron issues a GET. Safe to repeat — see the idempotency note above. */
export const GET: RequestHandler = POST;
