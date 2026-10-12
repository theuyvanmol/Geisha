import { describe, it, expect } from 'vitest';
import { safeRedirect } from './redirect.js';

const ORIGIN = 'https://booking.geisha.example';

describe('safeRedirect', () => {
	it('falls back when nothing is supplied', () => {
		expect(safeRedirect(null, ORIGIN)).toBe('');
		expect(safeRedirect('', ORIGIN)).toBe('');
		expect(safeRedirect('   ', ORIGIN)).toBe('');
	});

	it('accepts a relative path (it can only resolve to us)', () => {
		expect(safeRedirect('/fusion/booking-confirmation', ORIGIN)).toBe(
			'/fusion/booking-confirmation'
		);
	});

	it('accepts our own origin and the client’s WordPress site', () => {
		expect(safeRedirect(`${ORIGIN}/thanks`, ORIGIN)).toBe(`${ORIGIN}/thanks`);
		expect(safeRedirect('https://geisharestaurants.co.uk/fusion/thank-you/', ORIGIN)).toBe(
			'https://geisharestaurants.co.uk/fusion/thank-you/'
		);
		expect(safeRedirect('https://www.geisharestaurants.co.uk/thanks', ORIGIN)).toBe(
			'https://www.geisharestaurants.co.uk/thanks'
		);
	});

	it('refuses an arbitrary host', () => {
		// Otherwise a link that looks like the restaurant's booking flow lands the
		// guest on someone else's page.
		expect(safeRedirect('https://evil.example/steal', ORIGIN)).toBe('');
	});

	it('refuses a protocol-relative URL, which browsers resolve as absolute', () => {
		expect(safeRedirect('//evil.example/steal', ORIGIN)).toBe('');
	});

	it('refuses a backslash-prefixed path, which some browsers normalise to //', () => {
		expect(safeRedirect('/\\evil.example', ORIGIN)).toBe('');
	});

	it('refuses non-https schemes, including javascript:', () => {
		expect(safeRedirect('javascript:alert(1)', ORIGIN)).toBe('');
		expect(safeRedirect('http://geisharestaurants.co.uk/thanks', ORIGIN)).toBe('');
		expect(safeRedirect('data:text/html,<script>', ORIGIN)).toBe('');
	});

	it('refuses a lookalike host that merely ends with an allowed one', () => {
		expect(safeRedirect('https://notgeisharestaurants.co.uk/x', ORIGIN)).toBe('');
		expect(safeRedirect('https://geisharestaurants.co.uk.evil.example/x', ORIGIN)).toBe('');
	});

	// The bug this file's rewrite exists for. The URL parser DELETES tab, CR and LF
	// from anywhere in a URL before parsing, so `/<TAB>/evil.com` looks like a
	// relative path to a prefix check and resolves to https://evil.com in a browser.
	// `.trim()` never saw it, because the control character is in the middle.
	// Verified in Chrome: new URL('/\t/evil.com', origin) === 'http://evil.com/'.
	it('refuses a control character that the URL parser would strip mid-string', () => {
		expect(safeRedirect('/\t/evil.example', ORIGIN)).toBe('');
		expect(safeRedirect('/\r\n//evil.example', ORIGIN)).toBe('');
		expect(safeRedirect('/\t\t//evil.example', ORIGIN)).toBe('');
		expect(safeRedirect('https://geisha\trestaurants.co.uk/x', ORIGIN)).toBe('');
		expect(safeRedirect('/x\u0000/evil.example', ORIGIN)).toBe('');
	});

	// A space is NOT stripped (it percent-encodes), so this one stays a real path
	// on our own origin — proof the guard above isn't just blanket-refusing.
	it('still accepts a path containing an encodable space', () => {
		expect(safeRedirect('/a b', ORIGIN)).toBe('/a%20b');
	});

	it('preserves the query string and fragment of a relative target', () => {
		expect(safeRedirect('/thanks?utm=x#top', ORIGIN)).toBe('/thanks?utm=x#top');
	});

	it('refuses a bare word that is neither absolute nor rooted', () => {
		expect(safeRedirect('evil.example', ORIGIN)).toBe('');
	});
});
