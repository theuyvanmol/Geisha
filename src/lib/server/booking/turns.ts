// TURN PREDICTION — "when does this table free up?" for the live floor.
//
// Service hosts need a forward view: a party was seated at 19:05, it's a 4-top
// on a 120-min dinner turn, so it should free around 21:05 — and if it's now
// 21:30 it's lingering (overdue). From that we can rank which tables open next
// and match them to parties still waiting.
//
// ACCURACY: the booking's stored `ends_at` is set at CREATE time from a coarse
// per-period default (turnMinutesFor). That's fine as a fallback, but the most
// accurate estimate uses how long THIS venue's parties of a similar size have
// ACTUALLY sat in the recent past (cleared_at − seated_at from floor_state). So
// estimateTurnMinutes prefers the historical median for the party-size bucket
// once there are enough samples, and only falls back to the period default when
// history is too thin to trust. Everything here is PURE (no I/O) so it's unit-
// testable and reused identically on the live board and any planning view.

import type { ServicePeriod } from '../db/types.js';
import { turnMinutesFor } from './availability.js';

/** One past seating used to learn turn times: a completed (cleared) occupancy. */
export interface TurnSample {
	partySize: number;
	/** Actual minutes the table was occupied (cleared_at − seated_at), > 0. */
	minutes: number;
}

/** Party-size buckets — small/medium/large parties turn at different rates, and
 *  bucketing keeps each group's sample count high enough for a stable median. */
export function partyBucket(partySize: number): 'small' | 'medium' | 'large' {
	if (partySize <= 2) return 'small';
	if (partySize <= 5) return 'medium';
	return 'large';
}

/** Minimum samples in a bucket before we trust its median over the period default. */
export const MIN_SAMPLES = 5;

function median(nums: number[]): number {
	const s = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Best estimate of how long a party of `partySize` will occupy a table, in
 * minutes. Uses the median actual turn of recent same-bucket seatings when there
 * are at least MIN_SAMPLES of them; otherwise the period's engine default. The
 * historical value is clamped to a sane band so one freak 4-hour sitting (or a
 * mis-cleared 2-minute row) can't skew the board.
 */
export function estimateTurnMinutes(
	partySize: number,
	period: ServicePeriod | null,
	samples: TurnSample[]
): { minutes: number; basis: 'historical' | 'default' } {
	// Same party-size ladder whether or not a period is resolved (turnMinutesFor no
	// longer depends on the period, so the period-less path matches it exactly).
	const fallback = turnMinutesFor(partySize, period ?? ({} as ServicePeriod));
	const bucket = partyBucket(partySize);
	const relevant = samples
		.filter((s) => partyBucket(s.partySize) === bucket && s.minutes > 0)
		// drop obvious noise: < 20 min isn't a real sitting, > 6h is a data error
		.filter((s) => s.minutes >= 20 && s.minutes <= 360)
		.map((s) => s.minutes);
	if (relevant.length < MIN_SAMPLES) return { minutes: fallback, basis: 'default' };
	const learned = median(relevant);
	// keep within ±60% of the period default so history refines, never replaces,
	// the operator's configured turn — protects against a skewed sample set.
	const lo = Math.round(fallback * 0.4);
	const hi = Math.round(fallback * 1.6);
	return { minutes: Math.min(hi, Math.max(lo, learned)), basis: 'historical' };
}

export interface FreePrediction {
	/** Epoch ms the table is expected to free. */
	freeAtMs: number;
	/** Whole minutes from `nowMs` until free; negative once overdue. */
	minutesUntilFree: number;
	/** True once we're past the predicted free time (party is lingering). */
	overdue: boolean;
	/** Minutes the table has been occupied so far (for "seated 35 min ago"). */
	seatedForMinutes: number;
	/** Which input drove the estimate — surfaced so the UI can hint confidence. */
	basis: 'historical' | 'default';
}

/**
 * Predict when a seated table frees. `seatedAtMs` is the real seat time from
 * floor_state; `turnMinutes` comes from estimateTurnMinutes. Pure arithmetic so
 * it's trivially correct and testable.
 */
export function predictFree(
	seatedAtMs: number,
	turnMinutes: number,
	nowMs: number,
	basis: 'historical' | 'default'
): FreePrediction {
	const freeAtMs = seatedAtMs + turnMinutes * 60_000;
	const minutesUntilFree = Math.round((freeAtMs - nowMs) / 60_000);
	return {
		freeAtMs,
		minutesUntilFree,
		overdue: nowMs > freeAtMs,
		seatedForMinutes: Math.max(0, Math.round((nowMs - seatedAtMs) / 60_000)),
		basis
	};
}
