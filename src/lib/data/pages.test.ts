// Guards for the editable interior-page copy.
//
// The important properties: the shipped defaults still validate (so "Reset to
// default" and a first-ever save can't produce a blob the server rejects), every
// placeholder used in the defaults is one fillTokens actually knows about (a typo
// would otherwise ship a literal "{phoen}" to the public site), and a partial
// override can't blank a page.

import { describe, it, expect } from 'vitest';
import { getPagesDefaults, fillTokens, paragraphs, tokenSource } from './pages';
import { PagesSchema } from '$lib/content/schema';

const BRAND = {
	id: 'asia',
	name: 'Geisha Asia',
	short: 'Asia',
	phone: '0191 266 2222',
	email: 'info@geishaasia.co.uk',
	address: { line1: 'Front Street', city: 'Newcastle', postcode: 'NE12 8AE', metro: 'Four Lane Ends' }
};

describe('page copy defaults', () => {
	for (const brand of ['asia', 'fusion'] as const) {
		it(`${brand}: validates against PagesSchema`, () => {
			expect(PagesSchema.safeParse(getPagesDefaults(brand)).success).toBe(true);
		});
	}

	it('every default page has copy in it', () => {
		const d = getPagesDefaults('asia');
		expect(d.parties.title).toBeTruthy();
		expect(d.parties.occasions.length).toBeGreaterThan(5);
		expect(d.order.title).toBeTruthy();
		expect(d.privacy.sections.length).toBeGreaterThan(3);
		expect(d.contact.title).toBeTruthy();
	});

	it('uses only placeholders that fillTokens knows', () => {
		const tok = tokenSource(BRAND);
		const blob = JSON.stringify(getPagesDefaults('asia'));
		const used = [...blob.matchAll(/\{(\w+)\}/g)].map((m) => m[0]);
		expect(used.length).toBeGreaterThan(0);
		// Nothing should survive substitution — a leftover brace means a typo'd or
		// unimplemented token would render literally on the public page.
		const leftover = [...new Set(used)].filter((t) => fillTokens(t, tok) === t);
		expect(leftover).toEqual([]);
	});

	it('is a fresh object each call, so a mutating caller cannot poison it', () => {
		getPagesDefaults('asia').parties.title = 'clobbered';
		expect(getPagesDefaults('asia').parties.title).not.toBe('clobbered');
	});

	it('accepts a partial override without blanking the other pages', () => {
		const parsed = PagesSchema.parse({ contact: { title: 'Say hello' } });
		expect(parsed.contact.title).toBe('Say hello');
		// The untouched pages come back as valid (empty-default) objects rather
		// than undefined, so the renderer's `copy ?? defaults` still has a shape.
		expect(parsed.parties).toBeDefined();
		expect(parsed.privacy.sections).toEqual([]);
	});
});

describe('fillTokens', () => {
	const tok = tokenSource(BRAND);

	it('substitutes brand details', () => {
		expect(fillTokens('Call {phone} or {email}.', tok)).toBe(
			'Call 0191 266 2222 or info@geishaasia.co.uk.'
		);
		expect(fillTokens('{line1}, {city}, {postcode}', tok)).toBe(
			'Front Street, Newcastle, NE12 8AE'
		);
	});

	it('builds tel/mailto hrefs with the spaces stripped', () => {
		expect(fillTokens('{telHref}', tok)).toBe('tel:01912662222');
		expect(fillTokens('{mailtoHref}', tok)).toBe('mailto:info@geishaasia.co.uk');
	});

	it('builds brand-relative internal links', () => {
		expect(fillTokens('{bookingsHref}', tok)).toBe('/asia/bookings');
		expect(fillTokens('{menusHref}', tokenSource({ ...BRAND, id: 'fusion' }))).toBe(
			'/fusion/menus'
		);
	});

	it('leaves an unknown token verbatim rather than eating the text', () => {
		expect(fillTokens('a {nope} b', tok)).toBe('a {nope} b');
	});

	it('tolerates an empty string', () => {
		expect(fillTokens('', tok)).toBe('');
	});
});

describe('tokenSource', () => {
	it('prefers the editable brand_info override', () => {
		const tok = tokenSource(BRAND, { phone: '0191 000 0000' } as never);
		expect(tok.phone).toBe('0191 000 0000');
		// Untouched fields still come from the brand.
		expect(tok.email).toBe(BRAND.email);
	});

	it('falls back to the brand when an override field is blank', () => {
		// A half-filled save must not wipe the phone number off every page.
		const tok = tokenSource(BRAND, { phone: '   ', email: '' } as never);
		expect(tok.phone).toBe(BRAND.phone);
		expect(tok.email).toBe(BRAND.email);
	});

	it('never takes name/short from the override (they are not editable)', () => {
		const tok = tokenSource(BRAND, { name: 'Nope', short: 'Nope' } as never);
		expect(tok.name).toBe('Geisha Asia');
		expect(tok.short).toBe('Asia');
	});
});

describe('paragraphs', () => {
	it('splits on a blank line', () => {
		expect(paragraphs('one\n\ntwo')).toEqual(['one', 'two']);
	});
	it('tolerates ragged whitespace and trailing newlines', () => {
		expect(paragraphs('one\n \n\ntwo\n\n')).toEqual(['one', 'two']);
	});
	it('keeps a single-line body as one paragraph', () => {
		expect(paragraphs('just the one')).toEqual(['just the one']);
	});
	it('returns nothing for empty input, so no empty <p> renders', () => {
		expect(paragraphs('')).toEqual([]);
	});
});
