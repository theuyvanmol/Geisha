import { describe, it, expect } from 'vitest';
import { parseBookingDate, bookingMs } from './datetime';

// The exact shape PocketBase puts on the wire for a `date` field.
const PB = '2026-09-02 12:00:00.000Z';
const ISO = '2026-09-02T12:00:00.000Z';

describe('parseBookingDate', () => {
	it('parses a real ISO 8601 instant', () => {
		expect(parseBookingDate(ISO)?.getTime()).toBe(Date.parse(ISO));
	});

	// The whole point: PocketBase separates date and time with a SPACE, which is
	// outside the ES spec. V8 accepts it, JavaScriptCore (Safari/iOS) does not — so
	// `new Date(pbValue)` is Invalid Date on the floor iPads and only there.
	it('parses PocketBase’s space-separated form as the same instant', () => {
		expect(parseBookingDate(PB)?.getTime()).toBe(Date.parse(ISO));
	});

	it('accepts a space-separated value with no fractional seconds', () => {
		expect(parseBookingDate('2026-09-02 12:00:00Z')?.getTime()).toBe(Date.parse(ISO));
	});

	// PocketBase omits the zone on some fields; those instants are stored as UTC.
	it('reads a zone-less value as UTC, not as local time', () => {
		expect(parseBookingDate('2026-09-02 12:00:00.000')?.getTime()).toBe(Date.parse(ISO));
	});

	it('returns null — never an Invalid Date — for junk', () => {
		expect(parseBookingDate('not a date')).toBeNull();
		expect(parseBookingDate('')).toBeNull();
	});
});

describe('bookingMs', () => {
	it('returns the epoch ms for both forms', () => {
		expect(bookingMs(PB)).toBe(Date.parse(ISO));
		expect(bookingMs(ISO)).toBe(Date.parse(ISO));
	});

	// NaN is the failure mode that put a booking at 12:00 with an auto width: it
	// survives every `?? fallback` and lands in the DOM as `left: NaNpx`.
	it('returns null rather than NaN when the value will not parse', () => {
		expect(bookingMs('nonsense')).toBeNull();
		expect(bookingMs('')).toBeNull();
	});
});

// The bug was engine-specific, so prove the fix against the engine that broke.
// JavaScriptCore (Safari, and every browser on iOS — what the floor runs) refuses a
// datetime whose date and time are separated by a space. Stand in for it by making
// Date.parse reject exactly that, and check we still read the instant.
describe('on an engine that rejects the space form (Safari/iOS)', () => {
	const realParse = Date.parse;
	const jscLike = (s: string) => (/^\d{4}-\d{2}-\d{2} /.test(s) ? NaN : realParse(s));

	it('still reads the instant, because we normalise before parsing', () => {
		Date.parse = jscLike as typeof Date.parse;
		try {
			// The precondition: a plain `new Date(value)` really is broken here.
			expect(Number.isNaN(Date.parse(PB))).toBe(true);
			// …and parseBookingDate is not.
			expect(parseBookingDate(PB)?.toISOString()).toBe(ISO);
			expect(bookingMs(PB)).toBe(realParse(ISO));
		} finally {
			Date.parse = realParse;
		}
	});
});
