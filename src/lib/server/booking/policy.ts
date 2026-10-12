// Booking policy — deposit / no-show rules (GEISHA_WEBSITE_SPEC.md §6, owner #4).
//
// The deposit/no-show policy is now a CONFIGURABLE, priority-ordered RULES ENGINE
// backed by geisha_deposit_rules — managers edit rules in /admin/settings/deposits
// instead of the thresholds being hardcoded. paymentRequirementFor() matches the
// (party size, day-of-week, date, service period) against the rules; the
// lowest-`priority` matching rule wins.
//
// Back-compat: when NO rules are supplied (e.g. pre-migration, or a unit caller
// that doesn't load them) it falls back to the historical hardcoded policy below,
// which is exactly what migration 1772700600 seeded:
//   • Fri/Sat, 3–5 people: card AUTHORISATION HOLD (Manual capture); £5pp on
//     no-show / late cancel.
//   • 6+ people, any day: £10pp DEPOSIT (immediate charge), deducted from the
//     bill, non-refundable on no-show / late cancel (see LATE_CANCELLATION_HOURS).
//   • Online bookings for parties up to `online_party_max` (30); 31+ → phone
//     (staff bypass the cap entirely via createBooking/amend staff actors).
//   • "Late" = inside LATE_CANCELLATION_HOURS of the booking start (12h).
//
// All money is in pence. The pure functions here stay DB-free — the caller loads
// the rules (queries.getDepositRules) and passes them in, mirroring the pacing
// engine, so this module remains unit-testable.

import type { DepositCapture, DepositKind } from '../db/types.js';
import { getPromotion } from '../../data/promotions.js';
import {
	isLateCancellationAt,
	LATE_CANCELLATION_HOURS,
	LATE_CANCELLATION_LABEL
} from '../../bookings/lateWindow.js';

export interface PolicySettings {
	online_party_max: number;
	deposit_per_person_6plus_pence: number;
	noshow_fee_per_person_fri_sat_pence: number;
	release_after_minutes: number;
}

export type PaymentRequirementKind = 'none' | 'noshow_hold' | 'deposit';

export interface PaymentRequirement {
	kind: PaymentRequirementKind;
	/** Total amount in pence (per-person fee × party size). */
	amountPence: number;
	perPersonPence: number;
	/** Capture mode the payment intent should use ('auto' = charge now,
	 *  'manual' = authorise-only hold). Empty for `kind: 'none'`. */
	capture?: DepositCapture;
	/** Human-readable explanation for the booking UI. */
	reason: string;
	/** When the matched rule belongs to a promotion (ResDiary "Promotions"): the
	 *  promotion id + its guest-facing name and full T&C wording. Used to stamp
	 *  booking.promotion and to show the exact terms before the guest pays. */
	promotion?: string;
	promotionName?: string;
	promotionTerms?: string;
}

/**
 * A deposit rule resolved for the engine (the pure, DB-free shape that
 * queries.getDepositRules normalises geisha_deposit_rules rows into). Mirrors the
 * pacing engine's PacingRule. `servicePeriodId` undefined = applies to any
 * period; `dow` empty = every day; `partyMax` 0 = no upper bound; `dateFrom` /
 * `dateTo` (ISO 'YYYY-MM-DD') optional for seasonal overrides.
 */
export interface DepositRuleResolved {
	priority: number;
	servicePeriodId?: string;
	partyMin: number;
	partyMax: number; // 0 = unbounded
	dow: number[]; // [0..6]; empty = all days
	dateFrom?: string;
	dateTo?: string;
	kind: DepositKind;
	perPersonPence: number;
	capture: DepositCapture;
	/** Optional promotion id this rule belongs to (ResDiary "Promotions"): its
	 *  title + T&C wording get stamped onto the booking and shown to the guest.
	 *  undefined = a bare deposit rule with no promotion. */
	promotion?: string;
}

const FRI = 5;
const SAT = 6;

/** Day-of-week 0..6 (Sun..Sat) for an instant, in the given timezone. */
function localDow(startsAt: Date, timezone: string): number {
	const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
		startsAt
	);
	return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd] ?? startsAt.getDay();
}

/** Local 'YYYY-MM-DD' for an instant in the given timezone (for date-range match). */
function localDate(startsAt: Date, timezone: string): string {
	// en-CA renders ISO-style YYYY-MM-DD.
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(startsAt);
}

/**
 * Does a rule match this (party size, dow, local date, service period)?
 *   • partyMin ≤ size, and (partyMax 0 = unbounded, else size ≤ partyMax)
 *   • dow empty = any day, else must include this day
 *   • dateFrom/dateTo (inclusive, lexicographic = calendar order) when present
 *   • servicePeriodId blank = any period, else must equal
 */
function ruleMatches(
	rule: DepositRuleResolved,
	partySize: number,
	dow: number,
	date: string,
	servicePeriodId?: string
): boolean {
	if (partySize < rule.partyMin) return false;
	if (rule.partyMax > 0 && partySize > rule.partyMax) return false;
	if (rule.dow.length > 0 && !rule.dow.includes(dow)) return false;
	if (rule.dateFrom && date < rule.dateFrom) return false;
	if (rule.dateTo && date > rule.dateTo) return false;
	if (rule.servicePeriodId && rule.servicePeriodId !== servicePeriodId) return false;
	return true;
}

/**
 * Pick the winning deposit rule: the lowest-`priority` rule that matches. Ties on
 * priority are broken by the order rules are supplied (stable). Returns null when
 * no rule matches (→ caller uses the seeded/legacy fallback).
 */
export function selectDepositRule(
	rules: DepositRuleResolved[],
	partySize: number,
	dow: number,
	date: string,
	servicePeriodId?: string
): DepositRuleResolved | null {
	let best: DepositRuleResolved | null = null;
	for (const r of rules) {
		if (!ruleMatches(r, partySize, dow, date, servicePeriodId)) continue;
		if (!best || r.priority < best.priority) best = r;
	}
	return best;
}

/** Promotion (ResDiary "Promotions") fields for a matched rule, if it links one.
 *  When the promotion carries its own T&C wording that becomes the guest-facing
 *  `reason` (the exact terms the restaurant wants shown), overriding the generic
 *  default. */
function promotionFields(rule: DepositRuleResolved): Pick<
	PaymentRequirement,
	'promotion' | 'promotionName' | 'promotionTerms'
> {
	const promo = getPromotion(rule.promotion);
	if (!promo) return {};
	return {
		promotion: promo.id,
		promotionName: promo.title,
		promotionTerms: promo.message || undefined
	};
}

/** Build a PaymentRequirement from a matched rule + party size. */
function requirementFromRule(rule: DepositRuleResolved, partySize: number): PaymentRequirement {
	const promo = promotionFields(rule);
	if (rule.kind === 'none' || rule.perPersonPence <= 0) {
		return { kind: 'none', perPersonPence: 0, amountPence: 0, reason: '', ...promo };
	}
	const perPersonPence = rule.perPersonPence;
	const amountPence = perPersonPence * partySize;
	const pounds = (perPersonPence / 100).toFixed(2);
	if (rule.kind === 'deposit') {
		return {
			kind: 'deposit',
			perPersonPence,
			amountPence,
			capture: rule.capture || 'auto',
			reason:
				promo.promotionTerms ||
				`A deposit of £${pounds} per person is required for this booking. This is deducted from your final bill.`,
			...promo
		};
	}
	// noshow_hold
	return {
		kind: 'noshow_hold',
		perPersonPence,
		amountPence,
		capture: rule.capture || 'manual',
		reason:
			promo.promotionTerms ||
			`Card details are required for this booking. A fee of £${pounds} per person applies only in case of a no-show or late cancellation (less than ${LATE_CANCELLATION_LABEL} before).`,
		...promo
	};
}

/** The historical hardcoded policy, used as the fallback when no rule matches. */
function legacyRequirement(
	partySize: number,
	dow: number,
	settings: PolicySettings
): PaymentRequirement {
	// 6+ on any day → deposit (immediate charge).
	if (partySize >= 6) {
		const perPersonPence = settings.deposit_per_person_6plus_pence;
		return {
			kind: 'deposit',
			perPersonPence,
			amountPence: perPersonPence * partySize,
			capture: 'auto',
			reason: `A deposit of £${(perPersonPence / 100).toFixed(2)} per person is required for parties of 6 or more. This is deducted from your final bill.`
		};
	}
	// Fri/Sat, 3–5 people → card hold (manual capture) for the no-show fee.
	if ((dow === FRI || dow === SAT) && partySize >= 3 && partySize <= 5) {
		const perPersonPence = settings.noshow_fee_per_person_fri_sat_pence;
		return {
			kind: 'noshow_hold',
			perPersonPence,
			amountPence: perPersonPence * partySize,
			capture: 'manual',
			reason: `Card details are required for Friday/Saturday bookings of 3–5 guests. A fee of £${(perPersonPence / 100).toFixed(2)} per person applies only in case of a no-show or late cancellation (less than ${LATE_CANCELLATION_LABEL} before).`
		};
	}
	return { kind: 'none', perPersonPence: 0, amountPence: 0, reason: '' };
}

/**
 * What payment (if any) is required to confirm a booking.
 *
 * When `rules` (from geisha_deposit_rules, via queries.getDepositRules) are
 * supplied and one matches, the engine result is used — the lowest-priority
 * matching rule wins. When no rule matches (or none are supplied at all), it
 * falls back to the seeded/legacy hardcoded policy in `settings`, so the system
 * is back-compatible and never hard-fails if rules are absent.
 *
 * `servicePeriodId` lets a rule target a single service (e.g. a higher Saturday
 * dinner deposit); omit it to match only period-agnostic rules.
 */
export function paymentRequirementFor(
	partySize: number,
	startsAt: Date,
	timezone: string,
	settings: PolicySettings,
	rules: DepositRuleResolved[] = [],
	servicePeriodId?: string
): PaymentRequirement {
	const dow = localDow(startsAt, timezone);
	if (rules.length > 0) {
		const date = localDate(startsAt, timezone);
		const matched = selectDepositRule(rules, partySize, dow, date, servicePeriodId);
		if (matched) return requirementFromRule(matched, partySize);
	}
	return legacyRequirement(partySize, dow, settings);
}

/**
 * How close to the booking a cancellation counts as LATE — and so forfeits the
 * deposit / incurs the no-show fee.
 *
 * TWELVE HOURS, and this constant exists so it can only be twelve in one place.
 *
 * The two live systems disagreed, and had for years. The WordPress booking page
 * said "less than 8 hours before booking time"; ResDiary's own promotion T&Cs —
 * the wording a guest actually reads inside the booking widget, on all three
 * promotions — said "under 12 hours notice". Our engine had 8, so a guest who
 * cancelled 10 hours out was TOLD they forfeited and was in fact refunded.
 *
 * Twelve wins because it is the point-of-sale term: it is what the guest agrees
 * to at the moment they hand over a card, in ResDiary today and in our own
 * widget (which renders the option's T&Cs verbatim). Marketing copy beside the
 * form does not override the terms attached to the payment.
 *
 * That makes the WordPress page's "8 hours" text a live contradiction while the
 * iframe sits next to it — it has to be changed to 12 as part of the changeover.
 * See CHANGEOVER_TRIAL.md.
 *
 * Every guest-facing sentence about the window is interpolated from this value,
 * so the number and the behaviour cannot drift apart again.
 *
 * THE VALUE LIVES IN $lib/bookings/lateWindow, not here, because the cancel
 * dialogs need it too and client code cannot import $lib/server. They used to
 * carry their own copy, still saying 8 hours long after this became 12 — so the
 * dialog told a host a deposit would be refunded while the server kept it.
 */
export { LATE_CANCELLATION_HOURS, LATE_CANCELLATION_LABEL };

/**
 * Is a cancellation "late" (within {@link LATE_CANCELLATION_HOURS} of the start)?
 *
 * A late cancellation keeps an already-paid deposit. It does NOT charge a card on
 * file — nothing automatic does any more; see payments.settleNoShowMoney.
 */
export function isLateCancellation(startsAt: Date, now: Date): boolean {
	return isLateCancellationAt(startsAt.getTime(), now.getTime());
}

/**
 * Is a captured deposit refundable on cancellation? §6: deposits are
 * non-refundable on a no-show / late cancellation (inside the window above); an
 * in-time cancellation gets the deposit back. This is simply the inverse of
 * {@link isLateCancellation} — named separately so the cancel-in-time branch
 * reads intent-first ("is the deposit refundable?").
 */
export function depositRefundable(now: Date, startsAt: Date): boolean {
	return !isLateCancellation(startsAt, now);
}

/** Does this party size exceed the online cap (must phone instead)? */
export function exceedsOnlineCap(partySize: number, settings: PolicySettings): boolean {
	return partySize > settings.online_party_max;
}
