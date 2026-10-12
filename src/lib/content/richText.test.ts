// Guards for the editable-copy parser. The link support matters most: page copy
// is staff-editable, it renders as real <a> elements, and the destination comes
// out of the text — so the scheme allow-list is the thing standing between an
// editor (or a paste) and a javascript: link on the public site.

import { describe, it, expect } from 'vitest';
import { parseRich, parseRichLinked } from './richText';

const text = (segs: { text: string }[]) => segs.map((s) => s.text).join('');

describe('parseRich', () => {
	it('marks *em* and _underline_ runs', () => {
		expect(parseRich('a *b* c _d_')).toEqual([
			{ text: 'a ' },
			{ text: 'b', em: true },
			{ text: ' c ' },
			{ text: 'd', u: true }
		]);
	});

	it('turns ~ into a non-breaking space', () => {
		expect(parseRich('Uber~Eats')[0].text).toBe('Uber Eats');
	});

	it('leaves plain text alone and never emits markup', () => {
		const segs = parseRich('<script>alert(1)</script>');
		expect(segs).toHaveLength(1);
		// The angle brackets survive as TEXT — the renderer prints them, so they
		// can never be parsed as an element.
		expect(segs[0].text).toBe('<script>alert(1)</script>');
		expect(segs[0].href).toBeUndefined();
	});

	it('does not link anything without parseRichLinked', () => {
		expect(parseRich('mail us at hi@geisha.com')[0].href).toBeUndefined();
		expect(parseRich('[label](/asia/bookings)')[0].href).toBeUndefined();
	});
});

describe('parseRichLinked — [label](href)', () => {
	it('links internal paths and hash targets', () => {
		expect(parseRichLinked('use the [bookings page](/asia/bookings).')).toEqual([
			{ text: 'use the ' },
			{ text: 'bookings page', href: '/asia/bookings' },
			{ text: '.' }
		]);
		expect(parseRichLinked('[jump](#enquire)')[0].href).toBe('#enquire');
	});

	it('links http(s), mailto and tel', () => {
		for (const href of ['https://example.com/x', 'http://example.com', 'mailto:a@b.co', 'tel:01912']) {
			expect(parseRichLinked(`[go](${href})`)[0].href).toBe(href);
		}
	});

	// THE security invariant: a destination we don't recognise never becomes an
	// href, whatever it looks like.
	it('REJECTS dangerous schemes — no href is ever emitted', () => {
		const bad = [
			'javascript:alert(1)',
			'JaVaScRiPt:alert(1)',
			'java\tscript:alert(1)',
			'data:text/html;base64,PHN2Zz4=',
			'vbscript:x',
			'file:///etc/passwd',
			'//evil.example.com',
			'\\\\evil.example.com'
		];
		for (const href of bad) {
			const segs = parseRichLinked(`[click me](${href})`);
			expect(segs.map((s) => s.href).filter(Boolean), href).toEqual([]);
		}
	});

	it('degrades a rejected link to its label text', () => {
		// Paren-free destinations only: the pattern stops at the first ')', so a
		// rejected URL that itself contains parens (javascript:alert(1)) leaves the
		// unmatched ')' behind as text. Safe — just cosmetically ragged — and it
		// only happens for input that was already malformed or hostile.
		for (const href of ['data:text/html,x', 'vbscript:x', '//evil.example.com']) {
			expect(text(parseRichLinked(`[click me](${href})`)), href).toBe('click me');
		}
	});

	it('keeps surrounding text intact around several links', () => {
		const segs = parseRichLinked('see [a](/x) and [b](/y) now');
		expect(text(segs)).toBe('see a and b now');
		expect(segs.filter((s) => s.href).map((s) => s.href)).toEqual(['/x', '/y']);
	});
});

describe('parseRichLinked — bare email autolinking', () => {
	it('links a bare address', () => {
		const segs = parseRichLinked('contact info@geishaasia.co.uk for a copy.');
		expect(segs.find((s) => s.href)).toEqual({
			text: 'info@geishaasia.co.uk',
			href: 'mailto:info@geishaasia.co.uk'
		});
		expect(text(segs)).toBe('contact info@geishaasia.co.uk for a copy.');
	});

	it('does not double-link inside an explicit link or a styled run', () => {
		expect(parseRichLinked('[write to us](mailto:a@b.co)')[0].href).toBe('mailto:a@b.co');
		// An address inside *emphasis* stays emphasis, not a link.
		const segs = parseRichLinked('*a@b.co*');
		expect(segs).toEqual([{ text: 'a@b.co', em: true }]);
	});

	it('handles a body with no email without mangling it', () => {
		expect(text(parseRichLinked('no addresses here at all'))).toBe('no addresses here at all');
	});
});
