// Anomaly detection over rolling operational counts (MF-ANOMALY-ALERTS) —
// PURE, NO LLM.
//
// Watches three daily operational metrics — new bookings made, cancellations,
// and no-shows — and flags a day whose count departs sharply from its own recent
// baseline. The maths is honest, deterministic statistics (the moonshot
// principle): a robust z-score against a trailing window plus an absolute
// floor/threshold so a tiny, noisy baseline can't raise a panic over a one-off.
// We NEVER ask a model whether something is anomalous — that's arithmetic. (The
// cron uses an LLM only to phrase the resulting heads-up in plain English.)
//
// Deliberately DB-free: every function takes its data as plain numbers. The cron
// (api/cron/anomaly) loads the daily counts from PocketBase and hands the trailing
// series + today's value in, then writes any returned anomaly to geisha_alerts.
// Exposed piecewise so the unit tests can exercise the detector without a live PB.

/** The operational metrics we monitor. Each is a per-day count. */
export type AnomalyMetric = 'bookings' | 'cancellations' | 'no_shows';

/** Severity bands derived from how far a value sits from its baseline. */
export type AnomalySeverity = 'info' | 'warning' | 'critical';

/** Direction of the departure — a metric can spike or drop below baseline. */
export type AnomalyDirection = 'spike' | 'drop';

export interface AnomalyConfig {
	/** How many trailing days form the baseline window. */
	windowDays: number;
	/** Robust z (|value-median| / (1.4826·MAD)) at/above which we flag at all. */
	zWarning: number;
	/** Robust z at/above which the anomaly is critical. */
	zCritical: number;
	/**
	 * Minimum absolute deviation (in counts) from the baseline median before we
	 * flag, regardless of z. Stops a near-flat series (MAD≈0) from screaming about
	 * a +1 wobble — you need a materially different day, not just a statistically
	 * different one.
	 */
	minAbsDeviation: number;
	/**
	 * Minimum number of trailing observations required before the detector trusts
	 * its baseline. Below this it stays silent (cold start) rather than guessing.
	 */
	minSamples: number;
	/**
	 * Metrics where only an upward departure matters (more cancellations/no-shows
	 * is bad; fewer is fine and not worth an alert). Bookings are watched both ways
	 * (a sudden collapse in new bookings is itself a signal worth surfacing).
	 */
	spikeOnly: AnomalyMetric[];
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
	windowDays: 28,
	zWarning: 3,
	zCritical: 4.5,
	minAbsDeviation: 3,
	minSamples: 7,
	spikeOnly: ['cancellations', 'no_shows']
};

/** Median of a numeric series (returns 0 for an empty series). */
export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Median Absolute Deviation, scaled by 1.4826 so it estimates the standard
 * deviation of a normal distribution. Robust to outliers (unlike a plain stdev,
 * which the very spikes we're hunting would inflate, masking themselves).
 */
export function scaledMad(values: number[], med: number): number {
	if (values.length === 0) return 0;
	const deviations = values.map((v) => Math.abs(v - med));
	return median(deviations) * 1.4826;
}

/** Baseline statistics for a trailing series. */
export interface Baseline {
	median: number;
	/** Scaled MAD — a robust spread estimate; 0 when the window is perfectly flat. */
	spread: number;
	samples: number;
}

/** Summarise a trailing window into the robust baseline the detector compares to. */
export function baselineOf(history: number[]): Baseline {
	const med = median(history);
	return { median: med, spread: scaledMad(history, med), samples: history.length };
}

/** A flagged anomaly: the metric, how far out it was, and a structured reason. */
export interface Anomaly {
	metric: AnomalyMetric;
	direction: AnomalyDirection;
	severity: AnomalySeverity;
	/** Today's observed count. */
	value: number;
	/** The baseline median the value is judged against. */
	baseline: number;
	/** Signed deviation from baseline (value − baseline). */
	deviation: number;
	/** Robust z-score (Infinity when spread is 0 but the abs-floor was cleared). */
	z: number;
	samples: number;
	/** A terse, deterministic one-liner (the LLM may rephrase, never invent). */
	summary: string;
}

/** Round a z to one decimal for readable summaries/payloads. */
function round1(n: number): number {
	return Number.isFinite(n) ? Math.round(n * 10) / 10 : n;
}

/**
 * Evaluate ONE metric's latest value against its trailing history. Returns an
 * {@link Anomaly} when the departure clears BOTH the z threshold AND the absolute
 * deviation floor (and the direction is one we care about for this metric), else
 * null. Pure — no clock, no DB.
 */
export function detectMetric(
	metric: AnomalyMetric,
	value: number,
	history: number[],
	config: AnomalyConfig = DEFAULT_ANOMALY_CONFIG
): Anomaly | null {
	const base = baselineOf(history);
	if (base.samples < config.minSamples) return null; // cold start — stay silent

	const deviation = value - base.median;
	const direction: AnomalyDirection = deviation >= 0 ? 'spike' : 'drop';

	// Skip directions we don't care about for this metric (e.g. fewer no-shows).
	if (config.spikeOnly.includes(metric) && direction !== 'spike') return null;

	const absDev = Math.abs(deviation);
	if (absDev < config.minAbsDeviation) return null; // immaterial wobble

	// Robust z. With a flat window (spread 0) the z is Infinity; we already know
	// the abs-deviation floor was cleared, so treat that as a strong signal.
	const z = base.spread > 0 ? absDev / base.spread : Infinity;
	if (z < config.zWarning) return null;

	const severity: AnomalySeverity = z >= config.zCritical ? 'critical' : 'warning';

	const label = METRIC_LABEL[metric];
	const dirWord = direction === 'spike' ? 'above' : 'below';
	const zText = Number.isFinite(z) ? `${round1(z)}σ` : 'far';
	const summary =
		`${label}: ${value} today vs a usual ${round1(base.median)} ` +
		`(${dirWord} baseline, ${zText}, n=${base.samples}).`;

	return {
		metric,
		direction,
		severity,
		value,
		baseline: round1(base.median),
		deviation: round1(deviation),
		z: round1(z),
		samples: base.samples,
		summary
	};
}

/** Friendly metric labels for summaries + alert messages. */
export const METRIC_LABEL: Record<AnomalyMetric, string> = {
	bookings: 'New bookings',
	cancellations: 'Cancellations',
	no_shows: 'No-shows'
};

/** The per-metric daily series the detector needs for one evaluation run. */
export interface MetricSeries {
	metric: AnomalyMetric;
	/** Today's (the target date's) count. */
	value: number;
	/** Trailing counts, OLDEST→NEWEST, excluding the target date. */
	history: number[];
}

/**
 * Evaluate every supplied metric series and return the anomalies found, ordered
 * most-severe (then largest-z) first. The single entry point the cron calls per
 * brand/date. Pure: the cron does all PB I/O and hands the series in.
 */
export function detectAnomalies(
	series: MetricSeries[],
	config: AnomalyConfig = DEFAULT_ANOMALY_CONFIG
): Anomaly[] {
	const out: Anomaly[] = [];
	for (const s of series) {
		const hit = detectMetric(s.metric, s.value, s.history, config);
		if (hit) out.push(hit);
	}
	const rank: Record<AnomalySeverity, number> = { critical: 2, warning: 1, info: 0 };
	out.sort((a, b) => rank[b.severity] - rank[a.severity] || (b.z - a.z || 0));
	return out;
}
