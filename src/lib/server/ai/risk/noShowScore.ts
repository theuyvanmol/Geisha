// Deterministic no-show RISK scorer (MOONSHOT: arithmetic, NOT an LLM).
//
// Given one booking plus the guest's prior history, produce a 0-100 risk score
// and a human-readable list of the factors that moved it, so a host can see at a
// glance which covers are most likely to ghost and chase a deposit / over-book
// accordingly. Pure + side-effect-free: no PB, no clock — every input is passed
// in (the caller resolves `now`, the booking row and the customer counts), which
// makes the whole thing unit-testable without a live database.
//
// The model is a transparent additive heuristic, not a black box: a base rate
// plus a handful of signed adjustments, each surfaced as a `factor` so the score
// is fully explainable. Weights are deliberately modest and clamped to 0..100.
// Calibration can evolve; the SHAPE (explainable, deterministic) is the contract.
//
// Signals (per the spec): lead-time, party_size, source, day-of-week / period,
// deposit/hold presence, and the guest's prior no_show / cancel counts.

import type { Booking, Customer } from '../../db/types.js';

/** A single signed contribution to the score, with a plain-English reason. */
export interface RiskFactor {
	/** Stable machine code for the signal (e.g. 'prior_no_shows'). */
	code: string;
	/** Human-readable explanation shown in tooltips / the audit payload. */
	label: string;
	/** Signed point delta this factor applied to the score (+ = riskier). */
	weight: number;
}

export interface RiskResult {
	/** Integer 0..100. Higher = more likely to no-show. */
	score: number;
	/** Coarse band derived from `score` for badge colouring. */
	band: 'low' | 'medium' | 'high';
	/** Ordered (most impactful first) signed contributions. */
	factors: RiskFactor[];
}

/** History a booking's risk depends on. Defaults treat an unknown guest as new. */
export interface CustomerHistory {
	noShowCount?: number;
	cancelCount?: number;
	/** Total prior resolved bookings, if known — lets us weight a RATE, not a raw
	 *  count, so a regular with one old no-show isn't over-penalised. Optional. */
	priorBookings?: number;
	vip?: boolean;
}

/** Score-band cut points. ≥ HIGH = red dot; ≥ MEDIUM = amber; below = quiet. */
export const RISK_HIGH = 60;
export const RISK_MEDIUM = 35;

/** Map a numeric score to its coarse band. */
export function riskBand(score: number): RiskResult['band'] {
	if (score >= RISK_HIGH) return 'high';
	if (score >= RISK_MEDIUM) return 'medium';
	return 'low';
}

/** The subset of a booking the scorer reads. Accepts the full {@link Booking}. */
export type ScorableBooking = Pick<
	Booking,
	'party_size' | 'starts_at' | 'source' | 'tables'
> & {
	/** Whether a deposit / no-show hold is attached (resolved by the caller from
	 *  geisha_payments). Absence of any hold is itself a (small) risk signal. */
	hasDeposit?: boolean;
};

/** Base rate (points) every booking starts from before adjustments. */
const BASE_SCORE = 20;

/** Hours of lead time below which "booked very last-minute" risk applies. The
 *  signal is U-shaped: ultra-last-minute AND booked-very-far-ahead both ghost
 *  more than the steady middle. */
const SHORT_LEAD_HOURS = 3;
const LONG_LEAD_DAYS = 45;

/** Clamp to the reportable integer range. */
function clamp(n: number): number {
	return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Score a booking's no-show risk from its own shape + the guest's history.
 * Deterministic and pure — pass `nowMs` (defaults to Date.now()) so tests can
 * pin the clock. Every adjustment is recorded as a {@link RiskFactor}; the score
 * is BASE_SCORE plus the sum of factor weights, clamped 0..100.
 */
export function scoreNoShow(
	booking: ScorableBooking,
	history: CustomerHistory = {},
	nowMs: number = Date.now()
): RiskResult {
	const factors: RiskFactor[] = [];
	const add = (code: string, label: string, weight: number) => {
		if (weight !== 0) factors.push({ code, label, weight });
	};

	// --- prior behaviour (strongest signal) ---------------------------------
	const noShows = Math.max(0, history.noShowCount ?? 0);
	const cancels = Math.max(0, history.cancelCount ?? 0);
	const prior = Math.max(0, history.priorBookings ?? 0);

	if (noShows > 0) {
		// Each prior no-show is a heavy signal; if we know the prior-booking count
		// we weight the RATE so a one-off among many visits is softened.
		const rate = prior > 0 ? noShows / Math.max(prior, noShows) : 1;
		const w = Math.min(40, Math.round(noShows * 14 * (0.5 + 0.5 * rate)));
		add(
			'prior_no_shows',
			noShows === 1 ? '1 previous no-show' : `${noShows} previous no-shows`,
			w
		);
	}
	if (cancels > 0) {
		const w = Math.min(15, cancels * 4);
		add('prior_cancels', cancels === 1 ? '1 previous cancellation' : `${cancels} previous cancellations`, w);
	}

	// --- booking source ------------------------------------------------------
	// Walk-ins are already seated (no future no-show); phone/AI bookings tend to
	// honour more than anonymous online ones. Treated as small nudges.
	switch (booking.source) {
		case 'walkin':
			add('source_walkin', 'Walk-in (already in the building)', -15);
			break;
		case 'phone':
			add('source_phone', 'Booked by phone', -4);
			break;
		case 'online':
			add('source_online', 'Booked online', 4);
			break;
		// 'ai' and '' are neutral.
	}

	// --- party size ----------------------------------------------------------
	// Large parties carry more coordination risk; very large ones materially so.
	const party = booking.party_size || 0;
	if (party >= 8) add('party_large', `Large party of ${party}`, 12);
	else if (party >= 6) add('party_medium', `Party of ${party}`, 6);
	else if (party <= 1) add('party_single', 'Single cover', 2);

	// --- lead time (U-shaped) -----------------------------------------------
	const startMs = Date.parse(booking.starts_at);
	if (!Number.isNaN(startMs)) {
		const leadMs = startMs - nowMs;
		const leadHours = leadMs / 3_600_000;
		const leadDays = leadHours / 24;
		if (leadHours >= 0 && leadHours < SHORT_LEAD_HOURS) {
			add('lead_short', 'Booked at the last minute', 8);
		} else if (leadDays > LONG_LEAD_DAYS) {
			add('lead_long', `Booked ${Math.round(leadDays)} days ahead`, 6);
		}
	}

	// --- day of week / period -----------------------------------------------
	// Weekend dinners draw more speculative / occasion bookings that flake.
	if (!Number.isNaN(startMs)) {
		const dow = new Date(startMs).getUTCDay(); // 0=Sun..6=Sat (UTC ok for coarse dow)
		const hour = new Date(startMs).getUTCHours();
		const weekend = dow === 5 || dow === 6; // Fri/Sat
		const dinner = hour >= 18 || hour < 2;
		if (weekend && dinner) add('weekend_dinner', 'Weekend dinner slot', 6);
		else if (weekend) add('weekend', 'Weekend booking', 3);
	}

	// --- deposit / hold presence --------------------------------------------
	// A taken deposit/hold materially de-risks (guest has skin in the game); its
	// ABSENCE on an otherwise risky booking is the operational lever to pull.
	if (booking.hasDeposit) add('deposit_held', 'Deposit / card hold taken', -18);
	else add('no_deposit', 'No deposit on file', 3);

	// --- VIP trust -----------------------------------------------------------
	if (history.vip) add('vip', 'VIP / trusted regular', -10);

	const score = clamp(BASE_SCORE + factors.reduce((s, f) => s + f.weight, 0));

	// Most impactful first (by absolute weight) for tooltips/explainability.
	factors.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

	return { score, band: riskBand(score), factors };
}

/** Convenience: build {@link CustomerHistory} from a stored customer row. */
export function historyFromCustomer(c?: Pick<Customer, 'no_show_count' | 'cancel_count' | 'vip'>): CustomerHistory {
	return {
		noShowCount: c?.no_show_count ?? 0,
		cancelCount: c?.cancel_count ?? 0,
		vip: c?.vip ?? false
	};
}
