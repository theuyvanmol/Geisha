// POST /api/cron/briefing — nightly AI manager briefing (MF-NIGHTLY-BRIEFING).
//
// Each morning, per brand: assemble a STRUCTURED snapshot (getDashboard,
// getBookingsForDay, no-show risk, allergy flags, demand-forecast pacing, recent
// review themes) and have the LLM write a crisp brief AROUND those numbers
// (text-only runAgent, 'use only the provided data' system prompt). The briefing
// is stored as a geisha_ai_insights row (kind 'nightly_briefing', one per brand
// per local date) and emailed to the manager recipients via send.ts.
//
// IDEMPOTENT: assembleBriefing reuses an existing briefing row for the date, so a
// repeated cron run neither re-bills the LLM nor duplicates the insight; the email
// is sent ONLY when this run actually created the briefing (created=true), unless
// ?force=1 is passed to regenerate + resend. The 'Tonight' card on /admin reads the
// stored row back, so the in-app surface works even with no email key.
//
// Protected by the shared secret enforced centrally in hooks.server.ts for every
// /api/cron/* route via the `x-cron-secret: <CRON_SECRET>` header (503 if
// CRON_SECRET unset, 401 if it doesn't match). Schedule it early each morning.
//
// Query params (all optional):
//   ?date=YYYY-MM-DD   — brief this local date (default: today, Europe/London)
//   ?brand=asia|fusion — one brand only (default: both)
//   ?force=1           — regenerate even if a briefing already exists, and resend

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { BrandId } from '$lib/server/db/types.js';
import { getSettingValue } from '$lib/server/booking/admin.js';
import { assembleBriefing, briefingEmailHtml, type StoredBriefing } from '$lib/server/ai/briefing.js';
import { send } from '$lib/server/email/send.js';
import type { RequestHandler } from './$types';

const BRANDS: BrandId[] = ['asia', 'fusion'];

/** Today's local calendar date in the restaurant timezone, as 'YYYY-MM-DD'. */
function todayLocal(now: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/London',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}

/** A loose email check — enough to drop obvious junk before handing to Resend. */
function isEmail(s: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Resolve the manager recipient list for a brand: the 'briefing_recipients'
 * geisha_settings row first (string[] or comma/newline-separated string), then the
 * BRIEFING_RECIPIENTS env fallback. Returns a de-duped list of valid addresses.
 */
async function recipientsFor(brand: BrandId): Promise<string[]> {
	let raw: unknown;
	try {
		raw = await getSettingValue(brand, 'briefing_recipients');
	} catch {
		raw = undefined;
	}
	if (raw == null || raw === '') raw = env.BRIEFING_RECIPIENTS ?? '';

	const list: string[] = Array.isArray(raw)
		? raw.map((x) => String(x))
		: String(raw).split(/[,;\n]/);

	return [...new Set(list.map((s) => s.trim()).filter(isEmail))];
}

interface BrandBriefResult {
	brand: BrandId;
	ok: boolean;
	created: boolean;
	aiWritten: boolean;
	emailed: number; // recipients a send succeeded for
	recipients: number;
	skipped?: string;
}

async function briefBrand(
	brand: BrandId,
	date: string,
	now: Date,
	force: boolean
): Promise<BrandBriefResult> {
	let briefing: StoredBriefing;
	let created: boolean;
	try {
		const res = await assembleBriefing(brand, date, { now, force });
		briefing = res.briefing;
		created = res.created;
	} catch (err) {
		console.error('[briefing] assemble failed', brand, err);
		return {
			brand,
			ok: false,
			created: false,
			aiWritten: false,
			emailed: 0,
			recipients: 0,
			skipped: 'restaurant not provisioned or assemble failed'
		};
	}

	// Only email on first creation (or a forced regenerate) — re-runs stay silent.
	let emailed = 0;
	let recipients = 0;
	if (created || force) {
		const to = await recipientsFor(brand);
		recipients = to.length;
		if (to.length) {
			const subject = `${briefing.restaurantName} — Tonight (${date})`;
			const html = briefingEmailHtml(briefing);
			for (const addr of to) {
				const { sent } = await send({ to: addr, subject, html });
				if (sent) emailed++;
			}
		}
	}

	return { brand, ok: true, created, aiWritten: briefing.aiWritten, emailed, recipients };
}

export const POST: RequestHandler = async ({ url }) => {
	const now = new Date();
	const dateParam = url.searchParams.get('date');
	const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayLocal(now);
	const force = url.searchParams.get('force') === '1';
	const brandParam = url.searchParams.get('brand');

	const brands: BrandId[] =
		brandParam === 'asia' || brandParam === 'fusion' ? [brandParam] : BRANDS;

	const results: BrandBriefResult[] = [];
	for (const brand of brands) {
		results.push(await briefBrand(brand, date, now, force));
	}

	return json({ ok: true, date, results });
};
