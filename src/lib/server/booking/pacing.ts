// Pacing engine — covers caps per slot and per service period (WP-AVAIL-1).
//
// Deliberately PURE, mirroring availability.ts: every function takes its data
// (the resolved rules + existing booking footprints) as arguments and never
// touches the database or the clock. The API/admin layers load geisha_pacing_rules
// from PocketBase (queries.getPacingRules) and pass the normalised rules in.
//
// A "cover" is one seat in a party. A slot becomes unavailable once the covers
// already booked in it (or across the whole service period) plus the new party
// would exceed the configured cap — so the kitchen/front-of-house is never
// flooded even when physical tables remain free.
//
// All covers math is done on epoch-ms windows (never local HH:mm string
// compares) so it stays DST-correct; callers build the instants the same way the
// availability engine does and pass start/end ms in.

import type { BookingFootprint } from './availability.js';

/**
 * A pacing rule resolved for the engine. `maxCoversPerSlot`/`maxCoversPerPeriod`
 * of 0 mean "unlimited" (the historical, uncapped behaviour). `servicePeriodId`
 * undefined = applies to all periods; `dow` empty = applies every day.
 */
export interface PacingRule {
	servicePeriodId?: string;
	dow: number[];
	maxCoversPerSlot: number;
	maxCoversPerPeriod: number;
}

function toInstant(d: Date | string): number {
	return (d instanceof Date ? d : new Date(d)).getTime();
}

/**
 * Sum the party sizes of every footprint whose START instant falls within
 * [startMs, endMs). Attributing a booking to a window by its START (not its full
 * span) keeps the per-slot and per-period accounting unambiguous: a long turn is
 * counted once, against the slot/period it begins in, so two overlapping periods
 * never double-count the same booking.
 */
export function coversInWindow(
	startMs: number,
	endMs: number,
	existing: BookingFootprint[]
): number {
	let covers = 0;
	for (const b of existing) {
		const s = toInstant(b.startsAt);
		if (s >= startMs && s < endMs) covers += b.partySize ?? 0;
	}
	return covers;
}

/**
 * Pick the most-specific rule that applies to a (period, dow). Precedence,
 * highest first:
 *   1. period + dow   (rule names this period AND lists this dow)
 *   2. period         (rule names this period, all days)
 *   3. dow            (global rule that lists this dow)
 *   4. global         (no period, no dow restriction)
 * Returns null when no rule matches (→ uncapped, today's behaviour).
 */
export function selectPacingRule(
	periodId: string,
	dow: number,
	rules: PacingRule[]
): PacingRule | null {
	const matches = (r: PacingRule) =>
		(!r.servicePeriodId || r.servicePeriodId === periodId) &&
		(r.dow.length === 0 || r.dow.includes(dow));
	const specificity = (r: PacingRule) =>
		(r.servicePeriodId === periodId ? 2 : 0) + (r.dow.includes(dow) ? 1 : 0);

	let best: PacingRule | null = null;
	let bestScore = -1;
	for (const r of rules) {
		if (!matches(r)) continue;
		const score = specificity(r);
		if (score > bestScore) {
			best = r;
			bestScore = score;
		}
	}
	return best;
}

/**
 * Would adding `addingCovers` to the slot beginning at `slotStartMs` stay within
 * the rule's per-slot cap? The slot window is [slotStart, slotStart + interval).
 * No rule, or a cap of 0, means unlimited → always true.
 */
export function slotWithinSlotCap(
	rule: PacingRule | null,
	slotStartMs: number,
	slotIntervalMin: number,
	addingCovers: number,
	existing: BookingFootprint[]
): boolean {
	if (!rule || rule.maxCoversPerSlot <= 0) return true;
	const endMs = slotStartMs + slotIntervalMin * 60_000;
	const covers = coversInWindow(slotStartMs, endMs, existing);
	return covers + addingCovers <= rule.maxCoversPerSlot;
}

/**
 * Would adding `addingCovers` to the period spanning [periodStartMs, periodEndMs)
 * stay within the rule's per-period cap? Counts every footprint whose start lands
 * inside the period window. No rule, or a cap of 0, means unlimited → true.
 */
export function withinPeriodCap(
	rule: PacingRule | null,
	periodStartMs: number,
	periodEndMs: number,
	addingCovers: number,
	existing: BookingFootprint[]
): boolean {
	if (!rule || rule.maxCoversPerPeriod <= 0) return true;
	const covers = coversInWindow(periodStartMs, periodEndMs, existing);
	return covers + addingCovers <= rule.maxCoversPerPeriod;
}
