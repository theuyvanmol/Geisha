// The booking widget's words and reports around the card step.
//
// 2026-09-11: 12 of 43 guests who reached the card step never paid. The £ amount
// was first shown ON the card screen, after the guest had typed their details; and
// when a guest left that screen, nothing recorded whether the form had even loaded.

import { describe, it, expect } from 'vitest';
import { submitLabel, abandonReport } from './cardStep';

describe('submitLabel — the details step says what comes next', () => {
	it('names the deposit on the button, so the amount is never a surprise on the next screen', () => {
		expect(submitLabel({ depositKind: 'deposit', depositPence: 8000 })).toBe(
			'Continue to £80.00 deposit'
		);
	});

	it('says a card is needed for a guarantee — nothing is charged now', () => {
		expect(submitLabel({ depositKind: 'noshow_hold', depositPence: 2000 })).toBe(
			'Continue to card details'
		);
	});

	it('is the plain "Complete booking" when nothing is taken', () => {
		expect(submitLabel({ depositKind: 'none', depositPence: 0 })).toBe('Complete booking');
		expect(submitLabel(null)).toBe('Complete booking');
	});
});

describe('abandonReport — a guest leaving the card step without paying', () => {
	it('says the form never loaded when they left while it was still loading', () => {
		const r = abandonReport({ cardReady: false, readyMs: null, payPresses: 0, paying: false });
		expect(r.stage).toBe('abandon');
		expect(r.code).toBe('left_before_card_form_loaded');
	});

	it('records how long the form took, when they left after seeing it', () => {
		const r = abandonReport({ cardReady: true, readyMs: 11_040, payPresses: 0, paying: false });
		expect(r.code).toBe('left_card_step');
		expect(r.message).toContain('11.0s');
		expect(r.message).toContain('Pay pressed 0');
	});

	it('flags a guest who left mid-payment — e.g. off to their banking app and never back', () => {
		const r = abandonReport({ cardReady: true, readyMs: 900, payPresses: 1, paying: true });
		expect(r.code).toBe('left_during_payment');
	});
});
