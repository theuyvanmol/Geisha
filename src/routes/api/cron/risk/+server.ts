// POST /api/cron/risk — morning no-show RISK recompute (MOONSHOT: arithmetic).
//
// Recomputes the deterministic no-show risk score for every LIVE booking on the
// target date and PERSISTS it onto the booking (risk_score / risk_factors) plus a
// geisha_ai_insights row, so the diary + live floor can surface an amber/red dot
// without recomputing on every page load. NO LLM — pure heuristics from
// noShowScore.ts via runRiskScoring. Schedule it early each morning (e.g. 06:00).
//
// Protected by the shared secret enforced centrally in hooks.server.ts for every
// /api/cron/* route via the `x-cron-secret: <CRON_SECRET>` header (503 if
// CRON_SECRET unset, 401 if it doesn't match). By the time this handler runs the
// request is already authorised, so it just does the work.
//
// Query params (all optional):
//   ?date=YYYY-MM-DD  — score this local date (default: today, Europe/London)
//   ?brand=asia|fusion — score one brand only (default: both)

import { json } from '@sveltejs/kit';
import { runRiskScoring, runRiskScoringAll } from '$lib/server/ai/risk/noShowRisk.js';
import type { RequestHandler } from './$types';

/** Today's local calendar date in the restaurant timezone, as 'YYYY-MM-DD'. */
function todayLocal(now: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/London',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}

export const POST: RequestHandler = async ({ url }) => {
	const now = new Date();
	const dateParam = url.searchParams.get('date');
	const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayLocal(now);
	const brand = url.searchParams.get('brand');

	if (brand === 'asia' || brand === 'fusion') {
		const result = await runRiskScoring(brand, date, now.getTime());
		return json({ ok: true, date, [brand]: result });
	}

	const byBrand = await runRiskScoringAll(date, now.getTime());
	return json({ ok: true, date, ...byBrand });
};
