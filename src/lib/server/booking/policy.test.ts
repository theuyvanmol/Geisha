import { describe, it, expect } from 'vitest';
import {
	paymentRequirementFor,
	selectDepositRule,
	isLateCancellation,
	LATE_CANCELLATION_HOURS,
	LATE_CANCELLATION_LABEL,
	exceedsOnlineCap,
	type DepositRuleResolved,
	type PolicySettings
} from './policy.js';

const SETTINGS: PolicySettings = {
	online_party_max: 8,
	deposit_per_person_6plus_pence: 1000, // £10
	noshow_fee_per_person_fri_sat_pence: 500, // £5
	release_after_minutes: 20
};

const TZ = 'Europe/London';

// helper: an instant for a given local London day/time.
// 2025-06-06 is a Friday, 2025-06-07 Saturday, 2025-06-04 Wednesday.
const FRI = '2025-06-06';
const SAT = '2025-06-07';
const WED = '2025-06-04';
function at(date: string, hhmm = '19:00') {
	return new Date(`${date}T${hhmm}:00+01:00`); // BST in June
}

// The rule set the migration seeds (the engine's source of truth).
const SEEDED_RULES: DepositRuleResolved[] = [
	{
		priority: 10,
		partyMin: 6,
		partyMax: 0,
		dow: [],
		kind: 'deposit',
		perPersonPence: 1000,
		capture: 'auto'
	},
	{
		priority: 20,
		partyMin: 1,
		partyMax: 0,
		dow: [5, 6],
		kind: 'noshow_hold',
		perPersonPence: 500,
		capture: 'manual'
	}
];

describe('paymentRequirementFor — legacy fallback (no rules supplied)', () => {
	it('requires a £10pp deposit for parties of 6+ on any day', () => {
		const r = paymentRequirementFor(6, at(WED), TZ, SETTINGS);
		expect(r.kind).toBe('deposit');
		expect(r.amountPence).toBe(6000);
		expect(r.perPersonPence).toBe(1000);
		expect(r.capture).toBe('auto');
	});

	it('requires a £5pp no-show hold for Fri 3–5 covers', () => {
		const r = paymentRequirementFor(4, at(FRI), TZ, SETTINGS);
		expect(r.kind).toBe('noshow_hold');
		expect(r.amountPence).toBe(2000);
		expect(r.capture).toBe('manual');
	});

	it('requires a hold for Sat 3–5 covers', () => {
		const r = paymentRequirementFor(3, at(SAT), TZ, SETTINGS);
		expect(r.kind).toBe('noshow_hold');
		expect(r.amountPence).toBe(1500);
	});

	it('requires nothing for a Fri party of 2', () => {
		expect(paymentRequirementFor(2, at(FRI), TZ, SETTINGS).kind).toBe('none');
	});

	it('requires nothing for a midweek party of 4', () => {
		expect(paymentRequirementFor(4, at(WED), TZ, SETTINGS).kind).toBe('none');
	});

	it('deposit (6+) takes precedence over the Fri/Sat hold band', () => {
		// 6 on a Friday → deposit, not hold
		const r = paymentRequirementFor(6, at(FRI), TZ, SETTINGS);
		expect(r.kind).toBe('deposit');
	});
});

describe('paymentRequirementFor — configurable rules engine', () => {
	it('uses the seeded deposit rule for 6+ (lowest priority wins)', () => {
		const r = paymentRequirementFor(6, at(FRI), TZ, SETTINGS, SEEDED_RULES);
		expect(r.kind).toBe('deposit');
		expect(r.amountPence).toBe(6000);
		expect(r.capture).toBe('auto');
	});

	it('uses the seeded no-show hold for Fri/Sat parties (any size, per the seed)', () => {
		const r = paymentRequirementFor(4, at(SAT), TZ, SETTINGS, SEEDED_RULES);
		expect(r.kind).toBe('noshow_hold');
		expect(r.amountPence).toBe(2000);
		expect(r.capture).toBe('manual');
	});

	it('the seeded Fri/Sat hold applies to a party of 2 (unbanded) under the engine', () => {
		// Differs from the legacy fallback (which restricts the hold to 3–5): the
		// seeded rule is party_min 1, so the engine charges a hold here.
		const r = paymentRequirementFor(2, at(FRI), TZ, SETTINGS, SEEDED_RULES);
		expect(r.kind).toBe('noshow_hold');
		expect(r.amountPence).toBe(1000);
	});

	it('returns none when no rule matches (midweek small party)', () => {
		const r = paymentRequirementFor(2, at(WED), TZ, SETTINGS, SEEDED_RULES);
		expect(r.kind).toBe('none');
		expect(r.amountPence).toBe(0);
	});

	it('falls back to the legacy policy when the rules array is empty', () => {
		const r = paymentRequirementFor(6, at(WED), TZ, SETTINGS, []);
		expect(r.kind).toBe('deposit');
		expect(r.amountPence).toBe(6000);
	});

	it('honours a date-range seasonal override', () => {
		const xmas: DepositRuleResolved = {
			priority: 1, // beats the seeded rules
			partyMin: 1,
			partyMax: 0,
			dow: [],
			dateFrom: '2025-12-01',
			dateTo: '2025-12-31',
			kind: 'deposit',
			perPersonPence: 2500,
			capture: 'auto'
		};
		const inDec = paymentRequirementFor(2, at('2025-12-20'), TZ, SETTINGS, [xmas, ...SEEDED_RULES]);
		expect(inDec.kind).toBe('deposit');
		expect(inDec.amountPence).toBe(5000);
		// outside the window the override doesn't apply
		const inJune = paymentRequirementFor(2, at(WED), TZ, SETTINGS, [xmas, ...SEEDED_RULES]);
		expect(inJune.kind).toBe('none');
	});

	it('matches a service-period-scoped rule only for that period', () => {
		const dinnerOnly: DepositRuleResolved = {
			priority: 5,
			servicePeriodId: 'dinner',
			partyMin: 1,
			partyMax: 0,
			dow: [],
			kind: 'deposit',
			perPersonPence: 1500,
			capture: 'auto'
		};
		const r = paymentRequirementFor(2, at(WED), TZ, SETTINGS, [dinnerOnly], 'dinner');
		expect(r.kind).toBe('deposit');
		expect(r.amountPence).toBe(3000);
		// a different period shouldn't match the dinner-scoped rule
		const lunch = paymentRequirementFor(2, at(WED), TZ, SETTINGS, [dinnerOnly], 'lunch');
		expect(lunch.kind).toBe('none');
	});

	it("a 'none' rule can suppress a charge for a band (priority-first)", () => {
		const vip: DepositRuleResolved = {
			priority: 1,
			partyMin: 6,
			partyMax: 0,
			dow: [],
			kind: 'none',
			perPersonPence: 0,
			capture: 'auto'
		};
		const r = paymentRequirementFor(8, at(WED), TZ, SETTINGS, [vip, ...SEEDED_RULES]);
		expect(r.kind).toBe('none');
	});
});

describe('paymentRequirementFor — promotion linking (ResDiary "Promotions")', () => {
	// 'standard' is a real promotion in $lib/data/promotions with T&C wording;
	// 'standard-legacy' is a bare promotion (title only, no message).
	it('attaches the promotion name + terms and uses the terms as the reason', () => {
		const promoRule: DepositRuleResolved = {
			priority: 1,
			partyMin: 6,
			partyMax: 0,
			dow: [],
			kind: 'deposit',
			perPersonPence: 1000,
			capture: 'auto',
			promotion: 'standard'
		};
		const r = paymentRequirementFor(6, at(WED), TZ, SETTINGS, [promoRule]);
		expect(r.kind).toBe('deposit');
		expect(r.promotion).toBe('standard');
		expect(r.promotionName).toBe('Standard Booking');
		expect(r.promotionTerms).toContain('deposit of £10 per head');
		// the guest-facing reason is the promotion's exact T&Cs, not the generic default
		expect(r.reason).toBe(r.promotionTerms);
	});

	it('keeps the generic reason when the linked promotion has no T&C text', () => {
		// 'weekend-legacy' is the wording-less duplicate row that exists in the live
		// ResDiary. It previously named 'standard-legacy', which was a guessed row
		// and is gone now the promotions were transcribed from the real table.
		const promoRule: DepositRuleResolved = {
			priority: 1,
			partyMin: 1,
			partyMax: 0,
			dow: [],
			kind: 'deposit',
			perPersonPence: 1000,
			capture: 'auto',
			promotion: 'weekend-legacy'
		};
		const r = paymentRequirementFor(2, at(WED), TZ, SETTINGS, [promoRule]);
		expect(r.promotion).toBe('weekend-legacy');
		expect(r.promotionName).toBe('Weekend Bookings');
		expect(r.promotionTerms).toBeUndefined();
		expect(r.reason).toContain('deposit of £10.00 per person');
	});

	it('carries the promotion even on a no-charge (T&C-only) rule', () => {
		const tcOnly: DepositRuleResolved = {
			priority: 1,
			partyMin: 1,
			partyMax: 0,
			dow: [],
			kind: 'none',
			perPersonPence: 0,
			capture: 'auto',
			promotion: 'standard'
		};
		const r = paymentRequirementFor(2, at(WED), TZ, SETTINGS, [tcOnly]);
		expect(r.kind).toBe('none');
		expect(r.promotion).toBe('standard');
		expect(r.promotionName).toBe('Standard Booking');
	});

	it('ignores an unknown promotion id (no promotion fields set)', () => {
		const bad: DepositRuleResolved = {
			priority: 1,
			partyMin: 1,
			partyMax: 0,
			dow: [],
			kind: 'deposit',
			perPersonPence: 500,
			capture: 'auto',
			promotion: 'does-not-exist'
		};
		const r = paymentRequirementFor(2, at(WED), TZ, SETTINGS, [bad]);
		expect(r.kind).toBe('deposit');
		expect(r.promotion).toBeUndefined();
		expect(r.promotionName).toBeUndefined();
	});
});

describe('selectDepositRule', () => {
	it('picks the lowest-priority matching rule', () => {
		const r = selectDepositRule(SEEDED_RULES, 6, 5, '2025-06-06');
		expect(r?.priority).toBe(10); // deposit (6+) beats the priority-20 hold
	});
	it('returns null when nothing matches', () => {
		expect(selectDepositRule(SEEDED_RULES, 2, 3, '2025-06-04')).toBeNull();
	});
});

describe('isLateCancellation', () => {
	// The window is TWELVE hours (LATE_CANCELLATION_HOURS). It was eight, which
	// contradicted the T&Cs every guest agrees to at the point of payment — all
	// three ResDiary promotions say "under 12 hours notice".
	it('is late within 12 hours of the booking', () => {
		const start = at(WED, '20:00');
		const now = at(WED, '15:00'); // 5h before
		expect(isLateCancellation(start, now)).toBe(true);
	});

	it('is late at 11 hours — the case the old 8-hour window got wrong', () => {
		// A guest cancelling here was TOLD they forfeited their deposit and was in
		// fact refunded, because the copy said 12 and the engine enforced 8.
		const start = at(WED, '20:00');
		const now = at(WED, '09:00'); // 11h before
		expect(isLateCancellation(start, now)).toBe(true);
	});

	it('is not late more than 12 hours before', () => {
		const start = at(WED, '20:00');
		const now = at(WED, '07:00'); // 13h before
		expect(isLateCancellation(start, now)).toBe(false);
	});

	it('treats exactly 12 hours as in time (the boundary is exclusive)', () => {
		const start = at(WED, '20:00');
		const now = at(WED, '08:00'); // exactly 12h
		expect(isLateCancellation(start, now)).toBe(false);
	});

	it('states the same window it enforces', () => {
		// The guest-facing sentences interpolate LATE_CANCELLATION_LABEL, so this
		// is what stops the copy and the behaviour drifting apart again.
		expect(LATE_CANCELLATION_LABEL).toBe(`${LATE_CANCELLATION_HOURS} hours`);
		const start = at(WED, '20:00');
		const justInside = new Date(start.getTime() - (LATE_CANCELLATION_HOURS * 60 - 1) * 60_000);
		const justOutside = new Date(start.getTime() - (LATE_CANCELLATION_HOURS * 60 + 1) * 60_000);
		expect(isLateCancellation(start, justInside)).toBe(true);
		expect(isLateCancellation(start, justOutside)).toBe(false);
	});
});

describe('exceedsOnlineCap', () => {
	it('flags 9 as over the cap of 8', () => {
		expect(exceedsOnlineCap(9, SETTINGS)).toBe(true);
		expect(exceedsOnlineCap(8, SETTINGS)).toBe(false);
	});
});
