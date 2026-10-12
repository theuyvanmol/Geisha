// POST /api/cron/forecast — nightly demand-forecast sweep (MF-DEMAND-FORECAST).
//
// For each brand it pulls the trailing window of historical bookings, runs the
// PURE forecaster (src/lib/server/ai/forecast.ts) to learn expected covers per
// (dow, period, slot), and persists the resulting recommended covers-cap curve to
// the `pacing_curve` setting. The WAVE2 pacing engine + the /admin/diary pacing
// bar consult that curve; the read tool get_demand_forecast resolves it per date.
//
// NO LLM — deterministic seasonal-naive + moving-average arithmetic (the moonshot
// principle: honest stats, never an invented number).
//
// Protected by a shared secret enforced centrally in hooks.server.ts for every
// /api/cron/* route via the `x-cron-secret: <CRON_SECRET>` header (503 if
// CRON_SECRET unset, 401 if it doesn't match). By the time this handler runs the
// request is already authorised, so it just does the work. Schedule it nightly.

import { json } from '@sveltejs/kit';
import { pb } from '$lib/server/db/pb.js';
import type { Booking, BrandId, Restaurant, ServicePeriod, Setting } from '$lib/server/db/types.js';
import { getRestaurant, toPbDateFilter } from '$lib/server/booking/queries.js';
import { buildPacingCurve, DEFAULT_FORECAST_CONFIG, PACING_CURVE_KEY } from '$lib/server/ai/forecast.js';
import type { RequestHandler } from './$types';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

const BRANDS: BrandId[] = ['asia', 'fusion'];

// PACING_CURVE_KEY is the single source of truth in ai/forecast.ts (imported above).

/** How many days of history to learn from. Wide enough to span ~13 same-weekday
 *  occurrences so the seasonal window (default 8 weeks) is well fed. */
const HISTORY_DAYS = 120;

/** Page size for the bookings fetch — modest to keep the 1GB droplet calm. */
const PAGE_SIZE = 200;

export interface ForecastSweepResult {
	brand: BrandId;
	ok: boolean;
	cells: number; // distinct (dow, period) cells learned
	bookingsConsidered: number;
	skipped?: string; // reason, when ok=false
}

/** Pull every booking for a restaurant whose start falls in [fromISO, toISO]. */
async function pageBookings(restaurantId: string, fromISO: string, toISO: string): Promise<Booking[]> {
	const c = await pb();
	const from = toPbDateFilter(fromISO);
	const to = toPbDateFilter(toISO);
	const filter = `restaurant=${q(restaurantId)} && starts_at>=${q(from)} && starts_at<=${q(to)}`;
	const out: Booking[] = [];
	let page = 1;
	for (;;) {
		const res = await c
			.collection('geisha_bookings')
			.getList<Booking>(page, PAGE_SIZE, { filter, sort: 'starts_at' });
		out.push(...res.items);
		if (page >= res.totalPages || res.items.length === 0) break;
		page++;
	}
	return out;
}

/** Read a numeric forecast-config override from settings, if present. */
function numSetting(rows: Setting[], key: string): number | undefined {
	const v = rows.find((r) => r.key === key)?.value;
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Upsert the pacing_curve setting for a restaurant (create if absent). */
async function persistCurve(restaurantId: string, value: unknown): Promise<void> {
	const c = await pb();
	try {
		const existing = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${q(restaurantId)} && key=${q(PACING_CURVE_KEY)}`);
		await c.collection('geisha_settings').update(existing.id, { value });
	} catch {
		// 404 from getFirstListItem = no row yet — create it.
		await c.collection('geisha_settings').create({
			restaurant: restaurantId,
			key: PACING_CURVE_KEY,
			value
		});
	}
}

/** Forecast one brand and persist its curve. Degrades gracefully per brand. */
async function sweepBrand(brand: BrandId, now: Date): Promise<ForecastSweepResult> {
	let restaurant: Restaurant;
	try {
		restaurant = await getRestaurant(brand);
	} catch {
		return { brand, ok: false, cells: 0, bookingsConsidered: 0, skipped: 'restaurant not provisioned' };
	}

	const c = await pb();
	const tz = restaurant.timezone || 'Europe/London';

	const fromISO = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString();
	// Only learn from history up to now — don't let future bookings skew the average.
	const toISO = now.toISOString();

	const [bookings, periods, settings] = await Promise.all([
		pageBookings(restaurant.id, fromISO, toISO),
		c
			.collection('geisha_service_periods')
			.getFullList<ServicePeriod>({ filter: `restaurant=${q(restaurant.id)}` }),
		c.collection('geisha_settings').getFullList<Setting>({ filter: `restaurant=${q(restaurant.id)}` })
	]);

	// Optional per-brand overrides for the cold-start floors + slot granularity, so
	// an operator can tune conservatism via existing settings without a code change.
	const config = {
		slotIntervalMinutes:
			numSetting(settings, 'slot_interval_minutes') ?? DEFAULT_FORECAST_CONFIG.slotIntervalMinutes,
		coldStartSlotCap: numSetting(settings, 'forecast_cold_slot_cap'),
		coldStartPeriodCap: numSetting(settings, 'forecast_cold_period_cap')
	};
	// Strip undefined so buildPacingCurve's defaults apply for any unset override.
	const configClean = Object.fromEntries(
		Object.entries(config).filter(([, v]) => v !== undefined)
	) as Parameters<typeof buildPacingCurve>[0]['config'];

	const curve = buildPacingCurve({
		brand,
		bookings,
		periods,
		timezone: tz,
		now,
		config: configClean
	});

	await persistCurve(restaurant.id, curve);

	return {
		brand,
		ok: true,
		cells: Object.keys(curve.cells).length,
		bookingsConsidered: bookings.length
	};
}

export const POST: RequestHandler = async () => {
	const now = new Date();
	const results: ForecastSweepResult[] = [];
	for (const brand of BRANDS) {
		results.push(await sweepBrand(brand, now));
	}
	return json({ ok: true, results });
};
