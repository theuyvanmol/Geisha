// POST /api/cron/anomaly — operational anomaly sweep (MF-ANOMALY-ALERTS).
//
// For each brand it counts three daily operational metrics — new bookings made,
// cancellations, and no-shows — over a trailing window, runs the PURE z-score /
// threshold detector (src/lib/server/ai/anomaly.ts) on the target date's value
// against its own recent baseline, and writes any anomaly to geisha_alerts. The
// detection is DETERMINISTIC arithmetic (NO LLM); an LLM is used ONLY to phrase
// the plain-English heads-up message (a graceful fallback to the detector's own
// terse summary when AI isn't configured). IDEMPOTENT: one unacknowledged alert
// per (restaurant, kind, metric, window/date) — a re-run updates it in place
// rather than piling duplicates, so the cron can run as often as you like.
//
// Protected by the shared secret enforced centrally in hooks.server.ts for every
// /api/cron/* route via the `x-cron-secret: <CRON_SECRET>` header (503 if
// CRON_SECRET unset, 401 if it doesn't match). By the time this handler runs the
// request is already authorised, so it just does the work. Schedule it daily
// (e.g. each morning after the day's bookings have settled).
//
// Query params (all optional):
//   ?date=YYYY-MM-DD   — evaluate this local date (default: today, Europe/London)
//   ?brand=asia|fusion — sweep one brand only (default: both)

import { json } from '@sveltejs/kit';
import { pb } from '$lib/server/db/pb.js';
import type { BrandId, Restaurant } from '$lib/server/db/types.js';
import { getRestaurant, toPbDateFilter } from '$lib/server/booking/queries.js';
import { writeAudit } from '$lib/server/booking/audit.js';
import {
	detectAnomalies,
	METRIC_LABEL,
	type Anomaly,
	type AnomalyMetric,
	type MetricSeries
} from '$lib/server/ai/anomaly.js';
import type { RequestHandler } from './$types';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

const BRANDS: BrandId[] = ['asia', 'fusion'];

// The alert `kind` this cron owns — used for the idempotent upsert key. Kept a
// local const (NOT exported): a SvelteKit endpoint module may only export the
// HTTP verbs + a handful of reserved names, so a public export here breaks the
// build. The read tool (toolsInsights get_alerts) filters by acknowledged state,
// not by kind, so it never needs to import this.
const ANOMALY_ALERT_KIND = 'anomaly';

/** Trailing window of days used as the baseline for the detector. */
const WINDOW_DAYS = 28;

const TZ = 'Europe/London';

/** Today's local calendar date in the restaurant timezone, as 'YYYY-MM-DD'. */
function todayLocal(now: Date): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}

/** Add `days` (may be negative) to a 'YYYY-MM-DD', returning 'YYYY-MM-DD'. */
function addDays(date: string, days: number): string {
	const t = Date.parse(`${date}T12:00:00Z`);
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'UTC',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(t + days * 86_400_000));
}

/** Inclusive list of 'YYYY-MM-DD' from `from` to `to` (ascending). */
function dateRange(from: string, to: string): string[] {
	const out: string[] = [];
	let d = from;
	// Guard against pathological inputs — cap the loop generously.
	for (let i = 0; i < 400 && d <= to; i++) {
		out.push(d);
		d = addDays(d, 1);
	}
	return out;
}

/**
 * Build a `localDate -> count` map for a metric over [fromDate, toDate] by paging
 * the relevant bookings and bucketing them by the chosen timestamp's local date.
 *
 *  - bookings:      count by `created` local date (when the booking was MADE).
 *  - cancellations: status 'cancelled', counted by `updated` local date.
 *  - no_shows:      status 'no_show',  counted by `updated` local date.
 *
 * Returns 0 for any date with no rows (the detector needs a dense series).
 */
async function countByLocalDate(
	restaurantId: string,
	metric: AnomalyMetric,
	fromDate: string,
	toDate: string
): Promise<Map<string, number>> {
	const c = await pb();

	// The PB datetime field we bucket on, and any status constraint.
	const dateField = metric === 'bookings' ? 'created' : 'updated';
	const statusClause =
		metric === 'cancellations'
			? ` && status=${q('cancelled')}`
			: metric === 'no_shows'
				? ` && status=${q('no_show')}`
				: '';

	// Window the query on the chosen field. Widen by a day each side so a row whose
	// UTC instant lands just outside the local-date edge is still seen, then bucket
	// precisely by local date below.
	const from = toPbDateFilter(`${addDays(fromDate, -1)}T00:00:00.000Z`);
	const to = toPbDateFilter(`${addDays(toDate, 1)}T23:59:59.999Z`);
	const filter =
		`restaurant=${q(restaurantId)} && ${dateField}>=${q(from)} && ${dateField}<=${q(to)}` +
		statusClause;

	const counts = new Map<string, number>();
	let page = 1;
	const PAGE_SIZE = 200;
	for (;;) {
		const res = await c
			.collection('geisha_bookings')
			.getList<Record<string, unknown>>(page, PAGE_SIZE, { filter, sort: dateField });
		for (const row of res.items) {
			const raw = row[dateField];
			if (typeof raw !== 'string' || !raw) continue;
			const local = localDateOf(raw);
			if (local < fromDate || local > toDate) continue;
			counts.set(local, (counts.get(local) ?? 0) + 1);
		}
		if (page >= res.totalPages || res.items.length === 0) break;
		page++;
	}
	return counts;
}

/** Local 'YYYY-MM-DD' of a PB datetime string (space or T separator). */
function localDateOf(pbDate: string): string {
	const iso = pbDate.replace(' ', 'T');
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return '';
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(t));
}

/** Turn a date->count map into a dense ordered array over the given dates. */
function denseSeries(counts: Map<string, number>, dates: string[]): number[] {
	return dates.map((d) => counts.get(d) ?? 0);
}

/**
 * Phrase a plain-English heads-up for an anomaly via the LLM (text-only, no
 * tools). Returns the detector's own deterministic summary unchanged if AI isn't
 * configured or the call fails — the alert ALWAYS has a usable message. The LLM
 * only rewords known facts; it is given no freedom to invent numbers.
 */
async function phraseHeadsUp(brand: BrandId, a: Anomaly): Promise<string> {
	const facts =
		`metric=${METRIC_LABEL[a.metric]}, today=${a.value}, usual=${a.baseline}, ` +
		`direction=${a.direction}, severity=${a.severity}, robustZ=${a.z}, window=${WINDOW_DAYS}d`;
	try {
		const { runAgent, isConfiguredAsync } = await import('$lib/server/ai/geminiAgent.js');
		if (!(await isConfiguredAsync())) return a.summary;
		const system =
			`You write a SINGLE short, calm heads-up sentence for restaurant managers at ` +
			`Geisha ${brand === 'asia' ? 'Asia' : 'Fusion'} about an operational anomaly that a ` +
			`deterministic monitor has ALREADY detected. Use ONLY the numbers given — never invent ` +
			`or round differently. No greetings, no markdown, no emoji. Max 25 words. State what ` +
			`changed and (briefly) that it's worth a look.`;
		const result = await runAgent(system, facts, [], []);
		if (!result.configured || result.errored) return a.summary;
		const text = result.answer.trim();
		// Defensive: fall back if the model returned nothing usable or rambled.
		return text && text.length <= 240 ? text : a.summary;
	} catch {
		return a.summary;
	}
}

/**
 * Idempotently upsert the alert row for one anomaly. The natural key is
 * (restaurant, kind=anomaly, metric, window=<date>): an existing UNACKNOWLEDGED
 * row for the same key is updated in place; otherwise a new row is created. An
 * already-acknowledged row for that key is left alone (the manager has seen it)
 * and a fresh one is created only if the situation re-fires on a later date.
 */
async function upsertAlert(
	restaurantId: string,
	date: string,
	a: Anomaly,
	message: string
): Promise<'created' | 'updated'> {
	const c = await pb();
	const windowKey = `${date}/${WINDOW_DAYS}d`;
	const filter =
		`restaurant=${q(restaurantId)} && kind=${q(ANOMALY_ALERT_KIND)} && ` +
		`metric=${q(a.metric)} && window=${q(windowKey)} && acknowledged=false`;
	const data = {
		restaurant: restaurantId,
		kind: ANOMALY_ALERT_KIND,
		metric: a.metric,
		severity: a.severity,
		window: windowKey,
		message,
		acknowledged: false
	};
	try {
		const existing = await c.collection('geisha_alerts').getFirstListItem(filter);
		await c.collection('geisha_alerts').update(existing.id, data);
		return 'updated';
	} catch {
		await c.collection('geisha_alerts').create(data);
		return 'created';
	}
}

export interface AnomalySweepResult {
	brand: BrandId;
	ok: boolean;
	date: string;
	evaluated: number; // metrics checked
	anomalies: number; // metrics flagged
	created: number;
	updated: number;
	flagged: Array<{ metric: AnomalyMetric; severity: string; message: string }>;
	skipped?: string;
}

/** Sweep one brand for a target date. Degrades gracefully per brand. */
async function sweepBrand(brand: BrandId, date: string): Promise<AnomalySweepResult> {
	const base: AnomalySweepResult = {
		brand,
		ok: false,
		date,
		evaluated: 0,
		anomalies: 0,
		created: 0,
		updated: 0,
		flagged: []
	};

	let restaurant: Restaurant;
	try {
		restaurant = await getRestaurant(brand);
	} catch {
		return { ...base, skipped: 'restaurant not provisioned' };
	}

	// The full span we need counts for: the trailing window plus the target date.
	const windowStart = addDays(date, -WINDOW_DAYS);
	const historyDates = dateRange(windowStart, addDays(date, -1));
	const metrics: AnomalyMetric[] = ['bookings', 'cancellations', 'no_shows'];

	let series: MetricSeries[];
	try {
		series = await Promise.all(
			metrics.map(async (metric): Promise<MetricSeries> => {
				const counts = await countByLocalDate(restaurant.id, metric, windowStart, date);
				return {
					metric,
					value: counts.get(date) ?? 0,
					history: denseSeries(counts, historyDates)
				};
			})
		);
	} catch (e) {
		console.error('[anomaly] count query failed', brand, e);
		return { ...base, skipped: 'count query failed' };
	}

	const anomalies = detectAnomalies(series);
	const result: AnomalySweepResult = { ...base, ok: true, evaluated: metrics.length };

	for (const a of anomalies) {
		const message = await phraseHeadsUp(brand, a);
		let outcome: 'created' | 'updated';
		try {
			outcome = await upsertAlert(restaurant.id, date, a, message);
		} catch (err) {
			console.error('[anomaly] failed to write alert', brand, a.metric, err);
			continue;
		}
		result.anomalies++;
		if (outcome === 'created') result.created++;
		else result.updated++;
		result.flagged.push({ metric: a.metric, severity: a.severity, message });

		// Record the insight history too (queryable independent of the live alert).
		try {
			await (await pb()).collection('geisha_ai_insights').create({
				restaurant: restaurant.id,
				kind: 'anomaly',
				subject_id: `${a.metric}:${date}`,
				score: typeof a.z === 'number' && Number.isFinite(a.z) ? a.z : 999,
				payload: {
					date,
					metric: a.metric,
					direction: a.direction,
					severity: a.severity,
					value: a.value,
					baseline: a.baseline,
					deviation: a.deviation,
					samples: a.samples,
					window_days: WINDOW_DAYS,
					message
				}
			});
		} catch (err) {
			console.error('[anomaly] failed to write insight', brand, a.metric, err);
		}
	}

	// One audit line summarising the automated sweep (actor 'ai', no human).
	await writeAudit('ai', 'anomaly_swept', 'geisha_alerts', `${brand}:${date}`, null, {
		evaluated: result.evaluated,
		anomalies: result.anomalies,
		created: result.created,
		updated: result.updated
	});

	return result;
}

export const POST: RequestHandler = async ({ url }) => {
	const now = new Date();
	const dateParam = url.searchParams.get('date');
	const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayLocal(now);
	const brandParam = url.searchParams.get('brand');

	const brands: BrandId[] =
		brandParam === 'asia' || brandParam === 'fusion' ? [brandParam] : BRANDS;

	const results: AnomalySweepResult[] = [];
	for (const brand of brands) {
		results.push(await sweepBrand(brand, date));
	}
	return json({ ok: true, date, results });
};
