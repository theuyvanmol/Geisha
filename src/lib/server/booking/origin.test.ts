// Unit coverage for the booking-origin classifier.
//
// The point of these is the FALSE-POSITIVE direction: a booking wrongly labelled
// "from the embed" is worse than one labelled "unknown", because the label is
// used to answer "are real customers using the widget?" and a wrong yes is
// indistinguishable from a right one.

import { describe, it, expect } from 'vitest';
import { describeOrigin, originLabel } from './origin.js';

const SELF = 'geisha-black.vercel.app';

const req = (headers: Record<string, string>) =>
	new Request('https://geisha-black.vercel.app/api/bookings', { method: 'POST', headers });

describe('describeOrigin', () => {
	it('reads a modern browser framing the widget on the client site', () => {
		const o = describeOrigin(
			req({
				referer: 'https://geisharestaurants.co.uk/fusion/bookings/',
				'sec-fetch-dest': 'iframe',
				'sec-fetch-site': 'cross-site',
				'user-agent': 'Mozilla/5.0 (iPhone)'
			}),
			SELF
		);
		expect(o.kind).toBe('iframe');
		expect(o.site).toBe('geisharestaurants.co.uk');
		expect(originLabel(o)).toBe('iframe on geisharestaurants.co.uk');
	});

	it('still classifies the embed when Sec-Fetch-* is absent (older Safari)', () => {
		// The create call is issued BY the widget script, so its own dest is 'empty'
		// even inside a frame — the Referer host is what carries the answer.
		const o = describeOrigin(
			req({ referer: 'https://geisharestaurants.co.uk/fusion/bookings/' }),
			SELF
		);
		expect(o.kind).toBe('iframe');
		expect(o.site).toBe('geisharestaurants.co.uk');
	});

	it('calls our own host direct, not an embed', () => {
		const o = describeOrigin(
			req({ referer: `https://${SELF}/embed/fusion/book`, 'sec-fetch-site': 'same-origin' }),
			SELF
		);
		expect(o.kind).toBe('direct');
		expect(originLabel(o)).toBe(`direct (${SELF})`);
	});

	it('says unknown rather than guessing when there is no referer at all', () => {
		// A bare POST (curl, a script, a privacy browser stripping Referer) must not
		// come out as either — "unknown" is the honest answer and the report shows it.
		const o = describeOrigin(req({}), SELF);
		expect(o.kind).toBe('unknown');
		expect(o.site).toBe('');
		expect(originLabel(o)).toBe('unknown');
	});

	it('falls back to the Origin header when Referer is stripped', () => {
		const o = describeOrigin(req({ origin: 'https://geisharestaurants.co.uk' }), SELF);
		expect(o.site).toBe('geisharestaurants.co.uk');
		expect(o.kind).toBe('iframe');
	});

	it('never lets a hostile header grow unbounded in the log', () => {
		const o = describeOrigin(
			req({ referer: 'https://x.test/' + 'a'.repeat(5000), 'user-agent': 'b'.repeat(5000) }),
			SELF
		);
		expect(o.referer.length).toBeLessThanOrEqual(300);
		expect(o.ua.length).toBeLessThanOrEqual(160);
	});

	it('is inert without a self host rather than calling everything an embed', () => {
		// selfHost is '' in any caller that can't resolve it; the referer-based rule
		// must not then fire for our own pages.
		const o = describeOrigin(req({ referer: `https://${SELF}/embed/fusion/book` }));
		expect(o.kind).toBe('unknown');
	});
});
