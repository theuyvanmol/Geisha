// Demand forecaster (MF-DEMAND-FORECAST) — PURE, NO LLM.
//
// Learns expected covers per (brand, day-of-week, service period, slot) from
// historical bookings using a seasonal-naive + moving-average blend, then derives
// a recommended "covers cap" curve that the WAVE2 pacing engine can consult. This
// is honest, deterministic arithmetic (the moonshot principle): we average what
// actually happened on past same-weekday services, we never ask a model to invent
// a number.
//
// Cold start (too little history for a cell) falls back to a conservative flat cap
// read from a setting, so a brand-new restaurant — or a brand-new slot — still gets
// a sane curve instead of a wild guess.
//
// Deliberately DB-free: every function takes its data as arguments. queries.ts /
// the nightly cron load the rows from PocketBase and hand the flat booking list +
// period definitions in; the cron then persists the resulting curve to the
// `pacing_curve` setting. Exposed piecewise so the unit tests can exercise the
// engine without a live PocketBase.

import type { Booking, BrandId, ServicePeriod } from '../db/types.js';

/** The geisha_settings key the nightly cron stores the pacing curve under, and
 *  that the read tool + the diary pacing bar load it from. Single source of truth
 *  so producer and consumers never drift. */
export const PACING_CURVE_KEY = 'pacing_curve';

// ---------------------------------------------------------------------------
// Tunables — all overridable per call so the cron / tests stay in control.
// ---------------------------------------------------------------------------

/** Statuses that represent realised demand (a party that showed up or was on the
 *  books and counted toward covers). Mirrors the reporting module's COUNTED set so
 *  the forecaster and the covers report never disagree about what a "cover" is. */
const REALISED_STATUSES = new Set(['pending_payment', 'confirmed', 'seated', 'completed']);

export interface ForecastConfig {
	/** Slot granularity in minutes. Each slot bucket is [t, t+interval). */
	slotIntervalMinutes: number;
	/** How many past same-weekday occurrences to average (the "season" window). */
	seasonalWeeks: number;
	/** Minimum distinct historical occurrences a cell needs before we trust its
	 *  average; below this it is treated as cold-start. */
	minOccurrences: number;
	/** Conservative flat cap (covers) used for cold-start cells, per slot. */
	coldStartSlotCap: number;
	/** Conservative flat cap (covers) used for cold-start cells, per period. */
	coldStartPeriodCap: number;
	/** Headroom multiplier applied to expected demand to get the recommended cap
	 *  (e.g. 1.15 = allow 15% over the historical average before pacing bites). */
	headroom: number;
	/** Smoothing weight for the seasonal-naive term vs the overall moving average
	 *  (0..1): blended = seasonalWeight*seasonal + (1-seasonalWeight)*movingAvg. */
	seasonalWeight: number;
}

export const DEFAULT_FORECAST_CONFIG: ForecastConfig = {
	slotIntervalMinutes: 15,
	seasonalWeeks: 8,
	minOccurrences: 2,
	coldStartSlotCap: 12,
	coldStartPeriodCap: 80,
	headroom: 1.15,
	seasonalWeight: 0.6
};

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Expected demand for one (dow, period, slot) cell + how it was derived. */
export interface SlotForecast {
	slot: string; // local 'HH:mm' the slot begins
	/** Expected covers for this slot (blended seasonal + moving average). */
	expectedCovers: number;
	/** Recommended per-slot covers cap = ceil(expectedCovers * headroom), floored
	 *  at the cold-start cap so the cap is never lower than the conservative floor. */
	recommendedCap: number;
	/** How many distinct historical occurrences fed the average. */
	sampleSize: number;
	/** True when sampleSize < minOccurrences and the cold-start floor dominated. */
	coldStart: boolean;
}

/** A forecast for one (dow, period): per-slot demand + a period-level cap. */
export interface PeriodForecast {
	dow: number; // 0=Sun..6=Sat
	periodId: string;
	periodName: string;
	/** Expected total covers across the period (blended). */
	expectedCovers: number;
	/** Recommended per-period covers cap. */
	recommendedPeriodCap: number;
	sampleSize: number; // distinct service occurrences observed
	coldStart: boolean;
	slots: SlotForecast[];
}

/** The full persisted curve, keyed by `dow:periodId` for O(1) pacing lookups. */
export interface PacingCurve {
	brand: BrandId;
	generatedAt: string; // ISO datetime the curve was computed
	timezone: string;
	config: ForecastConfig;
	/** Map key is `${dow}:${periodId}`. */
	cells: Record<string, PeriodForecast>;
}

// ---------------------------------------------------------------------------
// Date / slot helpers — local wall-clock via the restaurant timezone.
// ---------------------------------------------------------------------------

/** Parts of an instant in a timezone: local date, day-of-week, and 'HH:mm'. */
export function localParts(
	instant: Date,
	timezone: string
): { date: string; dow: number; hhmm: string } {
	const dtf = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		weekday: 'short',
		hour12: false
	});
	const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
	const date = `${parts.year}-${parts.month}-${parts.day}`;
	// en-CA renders 24h but emits '24' for midnight in some engines — normalise.
	const hour = parts.hour === '24' ? '00' : parts.hour;
	const hhmm = `${hour}:${parts.minute}`;
	const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	return { date, dow: DOW[parts.weekday] ?? 0, hhmm };
}

/** Snap an 'HH:mm' to the start of its slot of `intervalMin` minutes. */
export function slotKey(hhmm: string, intervalMin: number): string {
	const [h, m] = hhmm.split(':').map(Number);
	const total = h * 60 + m;
	const snapped = Math.floor(total / intervalMin) * intervalMin;
	const sh = Math.floor(snapped / 60);
	const sm = snapped % 60;
	return `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// History bucketing — pure: flat bookings -> per-cell, per-occurrence covers.
// ---------------------------------------------------------------------------

/**
 * A "cell" is one (dow, periodId). Within a cell we track covers per *occurrence*
 * (a single calendar date on which that service ran) and per slot within that
 * date, so the forecaster can average across occurrences rather than summing all
 * history into one number.
 */
export interface CellHistory {
	dow: number;
	periodId: string;
	/** date -> total covers that date (the per-occurrence period totals). */
	periodCoversByDate: Map<string, number>;
	/** date -> (slot -> covers) for the per-occurrence slot demand. */
	slotCoversByDate: Map<string, Map<string, number>>;
}

/**
 * Bucket a flat list of historical bookings into per-cell, per-occurrence covers.
 * Only realised bookings count (cancelled / no_show are excluded — they are not
 * demand we want to plan capacity for). Returns a map keyed `${dow}:${periodId}`.
 */
export function bucketHistory(
	bookings: Booking[],
	timezone: string,
	slotIntervalMinutes: number
): Map<string, CellHistory> {
	const cells = new Map<string, CellHistory>();

	for (const b of bookings) {
		if (!REALISED_STATUSES.has(b.status)) continue;
		const covers = b.party_size || 0;
		if (covers <= 0) continue;
		const instant = new Date(b.starts_at);
		if (Number.isNaN(instant.getTime())) continue;

		const { date, dow, hhmm } = localParts(instant, timezone);
		const periodId = b.service_period || '';
		const cellKey = `${dow}:${periodId}`;

		let cell = cells.get(cellKey);
		if (!cell) {
			cell = {
				dow,
				periodId,
				periodCoversByDate: new Map(),
				slotCoversByDate: new Map()
			};
			cells.set(cellKey, cell);
		}

		cell.periodCoversByDate.set(date, (cell.periodCoversByDate.get(date) ?? 0) + covers);

		const slot = slotKey(hhmm, slotIntervalMinutes);
		let slots = cell.slotCoversByDate.get(date);
		if (!slots) {
			slots = new Map();
			cell.slotCoversByDate.set(date, slots);
		}
		slots.set(slot, (slots.get(slot) ?? 0) + covers);
	}

	return cells;
}

// ---------------------------------------------------------------------------
// Forecasting math — seasonal-naive + moving-average blend per cell.
// ---------------------------------------------------------------------------

/** Blend the most-recent `seasonalWeeks` occurrences (seasonal-naive: weight the
 *  recent same-weekday services) with the overall mean (moving average), per the
 *  config's seasonalWeight. `series` is per-occurrence values, oldest→newest. */
export function blendSeries(series: number[], config: ForecastConfig): number {
	if (series.length === 0) return 0;
	const overallMean = series.reduce((a, v) => a + v, 0) / series.length;
	const recent = series.slice(-config.seasonalWeeks);
	const seasonalMean = recent.reduce((a, v) => a + v, 0) / recent.length;
	return config.seasonalWeight * seasonalMean + (1 - config.seasonalWeight) * overallMean;
}

/** Recommended cap for an expected-covers figure: headroom over expected demand,
 *  rounded up, with a small absolute floor so a well-sampled-but-quiet cell never
 *  caps at zero. The conservative cold-start caps are applied separately (only
 *  when there isn't enough history) so a warm cell is trusted, not over-floored. */
export function recommendedCap(expectedCovers: number, headroom: number, minCap = 1): number {
	return Math.max(minCap, Math.ceil(expectedCovers * headroom));
}

/**
 * Forecast one cell from its history. Returns per-slot expected demand + caps and
 * a period-level cap. Cold-start (fewer than minOccurrences distinct service dates)
 * yields the conservative flat caps and coldStart=true.
 */
export function forecastCell(
	cell: CellHistory,
	periodName: string,
	config: ForecastConfig
): PeriodForecast {
	// Per-occurrence period totals, oldest occurrence first (date strings sort).
	const dates = [...cell.periodCoversByDate.keys()].sort();
	const periodSeries = dates.map((d) => cell.periodCoversByDate.get(d) ?? 0);
	const sampleSize = dates.length;
	const cold = sampleSize < config.minOccurrences;

	const expectedPeriod = blendSeries(periodSeries, config);
	const recommendedPeriodCap = cold
		? config.coldStartPeriodCap
		: recommendedCap(expectedPeriod, config.headroom);

	// Build a per-slot series: for each slot seen across occurrences, collect the
	// covers it saw on each date (absent => 0 for that occurrence), then blend.
	const slotsSeen = new Set<string>();
	for (const slotMap of cell.slotCoversByDate.values()) {
		for (const s of slotMap.keys()) slotsSeen.add(s);
	}

	const slots: SlotForecast[] = [...slotsSeen]
		.sort()
		.map((slot) => {
			const series = dates.map((d) => cell.slotCoversByDate.get(d)?.get(slot) ?? 0);
			const expected = blendSeries(series, config);
			const slotCold = sampleSize < config.minOccurrences;
			return {
				slot,
				expectedCovers: round1(expected),
				recommendedCap: slotCold
					? config.coldStartSlotCap
					: recommendedCap(expected, config.headroom),
				sampleSize,
				coldStart: slotCold
			};
		});

	return {
		dow: cell.dow,
		periodId: cell.periodId,
		periodName,
		expectedCovers: round1(expectedPeriod),
		recommendedPeriodCap,
		sampleSize,
		coldStart: cold,
		slots
	};
}

/** Round to one decimal place (expected-covers readability). */
function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Curve assembly — the structure the cron persists and pacing/diary consume.
// ---------------------------------------------------------------------------

/**
 * Build the full pacing curve from a flat history. Pure: takes the bookings,
 * the active service periods, the timezone and the config. The cron calls this
 * and stores the result in the `pacing_curve` setting. Cells with no history at
 * all simply don't appear — the pacing engine treats an absent cell as uncapped
 * (its existing behaviour), and `getDemandForecast` reports cold-start defaults.
 */
export function buildPacingCurve(args: {
	brand: BrandId;
	bookings: Booking[];
	periods: ServicePeriod[];
	timezone: string;
	now: Date;
	config?: Partial<ForecastConfig>;
}): PacingCurve {
	const config: ForecastConfig = { ...DEFAULT_FORECAST_CONFIG, ...(args.config ?? {}) };
	const periodNames = new Map(args.periods.map((p) => [p.id, p.name]));

	const history = bucketHistory(args.bookings, args.timezone, config.slotIntervalMinutes);

	const cells: Record<string, PeriodForecast> = {};
	for (const [key, cell] of history) {
		const name = periodNames.get(cell.periodId) ?? (cell.periodId || '(unassigned)');
		cells[key] = forecastCell(cell, name, config);
	}

	return {
		brand: args.brand,
		generatedAt: args.now.toISOString(),
		timezone: args.timezone,
		config,
		cells
	};
}

// ---------------------------------------------------------------------------
// Read-side: resolve a forecast for a specific date against a stored curve.
// ---------------------------------------------------------------------------

/** A forecast for a single date: the per-period cells that run on its weekday. */
export interface DateForecast {
	brand: BrandId;
	date: string; // 'YYYY-MM-DD'
	dow: number;
	generatedAt: string | null; // when the underlying curve was computed
	/** True when the curve was missing/empty so cold-start defaults were used. */
	coldStart: boolean;
	periods: PeriodForecast[];
}

/** Day-of-week for a 'YYYY-MM-DD' (UTC-noon to dodge DST), 0=Sun..6=Sat. */
export function dowOf(date: string): number {
	const t = Date.parse(`${date}T12:00:00Z`);
	if (Number.isNaN(t)) return 0;
	return new Date(t).getUTCDay();
}

/**
 * Resolve the forecast for one date from a stored curve. Returns the cells whose
 * dow matches the date. When the curve is absent/empty, synthesises conservative
 * cold-start cells for every period active on that weekday so the caller always
 * gets a usable answer (cold-start flagged honestly).
 */
export function forecastForDate(
	date: string,
	curve: PacingCurve | null,
	periods: ServicePeriod[],
	config: ForecastConfig = DEFAULT_FORECAST_CONFIG
): DateForecast {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new Error("Date must be 'YYYY-MM-DD'.");
	}
	const dow = dowOf(date);

	const matched: PeriodForecast[] = [];
	if (curve) {
		for (const cell of Object.values(curve.cells)) {
			if (cell.dow === dow) matched.push(cell);
		}
	}

	if (matched.length > 0) {
		matched.sort((a, b) => a.periodName.localeCompare(b.periodName));
		return {
			brand: curve!.brand,
			date,
			dow,
			generatedAt: curve!.generatedAt,
			coldStart: matched.every((m) => m.coldStart),
			periods: matched
		};
	}

	// Cold start: synthesise a conservative cell per period that runs this weekday.
	const cfg = curve?.config ?? config;
	const active = periods.filter(
		(p) => p.active !== false && (Array.isArray(p.days_of_week) ? p.days_of_week.includes(dow) : true)
	);
	const periodsOut: PeriodForecast[] = active.map((p) => ({
		dow,
		periodId: p.id,
		periodName: p.name,
		expectedCovers: 0,
		recommendedPeriodCap: cfg.coldStartPeriodCap,
		sampleSize: 0,
		coldStart: true,
		slots: []
	}));

	return {
		brand: (curve?.brand ?? 'asia') as BrandId,
		date,
		dow,
		generatedAt: curve?.generatedAt ?? null,
		coldStart: true,
		periods: periodsOut
	};
}
