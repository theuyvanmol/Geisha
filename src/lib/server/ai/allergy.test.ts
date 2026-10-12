import { describe, it, expect } from 'vitest';
import {
	extractAllergyFlags,
	allergyLabel,
	flagsHaveAllergy,
	type AllergyFlags
} from './allergy.js';

// The KEYWORD LAYER is the load-bearing, deterministic pass (no LLM, no network).
// These tests cover it end-to-end; the optional LLM refinement is best-effort and
// not exercised here (it degrades to this result whenever it can't run).

describe('extractAllergyFlags — allergen detection', () => {
	it('catches a named nut allergy and flags it as an allergy', () => {
		const f = extractAllergyFlags({ specialRequests: 'Severe nut allergy please' });
		expect(f.allergies).toContain('nuts');
		expect(f.hasAllergy).toBe(true);
		expect(f.summary).toContain('NUTS');
		expect(f.source).toBe('keyword');
	});

	it('catches shellfish variants (prawns, crab, lobster)', () => {
		expect(extractAllergyFlags({ specialRequests: 'no prawns' }).allergies).toContain('shellfish');
		expect(extractAllergyFlags({ notes: 'allergic to crab' }).allergies).toContain('shellfish');
		expect(extractAllergyFlags({ specialRequests: 'lobster brings her out in hives' }).allergies)
			.toContain('shellfish');
	});

	it('catches coeliac / celiac / gluten / wheat as gluten', () => {
		for (const t of ['coeliac diner', 'celiac', 'gluten allergy', 'wheat allergy']) {
			expect(extractAllergyFlags({ specialRequests: t }).allergies).toContain('gluten');
		}
	});

	it('catches dairy / lactose intolerance', () => {
		const f = extractAllergyFlags({ specialRequests: 'lactose intolerant, no dairy please' });
		expect(f.allergies).toContain('dairy');
		expect(f.hasAllergy).toBe(true);
	});

	it('merges signals from special requests AND customer notes', () => {
		const f = extractAllergyFlags({
			specialRequests: 'sesame allergy',
			notes: 'regular — also allergic to mustard'
		});
		expect(f.allergies).toEqual(expect.arrayContaining(['sesame', 'mustard']));
	});

	it('reads the explicit customer allergies line too', () => {
		const f = extractAllergyFlags({ allergies: 'soya and celery' });
		expect(f.allergies).toEqual(expect.arrayContaining(['soy', 'celery']));
	});

	it('de-duplicates a repeated allergen', () => {
		const f = extractAllergyFlags({ specialRequests: 'peanut, peanut, peanuts everywhere' });
		expect(f.allergies.filter((a) => a === 'nuts')).toHaveLength(1);
	});
});

describe('extractAllergyFlags — generic allergy cues', () => {
	it('flags an unnamed allergy (anaphylaxis / EpiPen) with no specific allergen', () => {
		const f = extractAllergyFlags({ specialRequests: 'guest carries an EpiPen, anaphylaxis risk' });
		expect(f.allergies).toHaveLength(0);
		expect(f.hasAllergy).toBe(true);
		expect(f.summary).toContain('ALLERGY');
	});

	it('does not flag an allergy for an ordinary request', () => {
		const f = extractAllergyFlags({ specialRequests: 'window table for an anniversary please' });
		expect(f.hasAllergy).toBe(false);
		expect(f.allergies).toHaveLength(0);
	});
});

describe('extractAllergyFlags — negated cues (a guest ruling allergies OUT)', () => {
	// Live booking on the Fusion book, 9 Aug 2026: this raised a red ALLERGY badge
	// on the run-sheet and the floor tile because 'allerg' matched as a substring.
	it('does not flag "no allergies"', () => {
		const f = extractAllergyFlags({ specialRequests: '2 adults one child no allergies' });
		expect(f.hasAllergy).toBe(false);
		expect(f.allergies).toHaveLength(0);
	});

	it.each(['no allergies', 'not allergic to anything', 'none, no intolerances'])(
		'clears the cue when a negator leads it: %j',
		(text) => {
			expect(extractAllergyFlags({ specialRequests: text }).hasAllergy).toBe(false);
		}
	);

	it('a TRAILING negator still flags — over-flagging is the safe direction', () => {
		// 'allergies: nil' is a shape we do not parse. We would rather the pass asks
		// the guest than misses one.
		expect(extractAllergyFlags({ specialRequests: 'allergies: nil' }).hasAllergy).toBe(true);
	});

	it('NEVER suppresses a NAMED allergen, whatever precedes it', () => {
		const f = extractAllergyFlags({ specialRequests: 'no nuts please — severe allergy' });
		expect(f.allergies).toContain('nuts');
		expect(f.hasAllergy).toBe(true);
	});

	it('one negated cue does not clear a second, real one', () => {
		const f = extractAllergyFlags({
			specialRequests: 'no allergies for us but John is anaphylactic'
		});
		expect(f.hasAllergy).toBe(true);
	});

	it('a negator further back in the note does not reach the cue', () => {
		const f = extractAllergyFlags({
			specialRequests: 'no booth needed, we are happy anywhere in the room — one severe allergy'
		});
		expect(f.hasAllergy).toBe(true);
	});
});

describe('extractAllergyFlags — dietary styles (non-urgent)', () => {
	it('catches vegan / vegetarian / pescatarian', () => {
		expect(extractAllergyFlags({ specialRequests: 'one vegan main' }).dietary).toContain('vegan');
		expect(extractAllergyFlags({ specialRequests: 'veggie option' }).dietary).toContain('vegetarian');
		expect(extractAllergyFlags({ specialRequests: 'pescatarian' }).dietary).toContain('pescatarian');
	});

	it('a dietary style alone is NOT an allergy', () => {
		const f = extractAllergyFlags({ specialRequests: 'vegan, halal' });
		expect(f.dietary).toEqual(expect.arrayContaining(['vegan', 'halal']));
		expect(f.hasAllergy).toBe(false);
	});

	it('separates gluten-free preference from a gluten allergy/coeliac', () => {
		const pref = extractAllergyFlags({ specialRequests: 'gluten free menu please' });
		expect(pref.dietary).toContain('glutenFree');
	});
});

describe('extractAllergyFlags — word boundaries (no false positives)', () => {
	it('does not flag "nut" inside an unrelated word', () => {
		const f = extractAllergyFlags({ specialRequests: 'arriving in a minute, doughnut for dessert' });
		expect(f.allergies).not.toContain('nuts');
	});

	it('returns an empty, non-allergy payload for empty input', () => {
		const f = extractAllergyFlags({});
		expect(f).toMatchObject<Partial<AllergyFlags>>({
			allergies: [],
			dietary: [],
			hasAllergy: false,
			summary: '',
			source: 'keyword'
		});
	});
});

describe('summary ordering', () => {
	it('lists allergies (shouting) before dietary styles', () => {
		const f = extractAllergyFlags({ specialRequests: 'vegan, nut allergy' });
		expect(f.summary.indexOf('NUTS')).toBeLessThan(f.summary.indexOf('Vegan'));
	});
});

describe('helpers', () => {
	it('allergyLabel maps known keys to human labels', () => {
		expect(allergyLabel('nuts')).toBe('Nuts');
		expect(allergyLabel('glutenFree')).toBe('Gluten-free');
		expect(allergyLabel('mystery')).toBe('mystery');
	});

	it('flagsHaveAllergy reads the loose stored json shape', () => {
		expect(flagsHaveAllergy({ allergies: ['nuts'], hasAllergy: true })).toBe(true);
		expect(flagsHaveAllergy({ allergies: [], hasAllergy: true })).toBe(true);
		expect(flagsHaveAllergy({ allergies: [], hasAllergy: false })).toBe(false);
		expect(flagsHaveAllergy(null)).toBe(false);
		expect(flagsHaveAllergy('nope')).toBe(false);
	});
});
