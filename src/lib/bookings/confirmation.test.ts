import { describe, it, expect } from 'vitest';
import { formatBookingDate, formatBookingTime } from './confirmation';

describe('formatBookingDate', () => {
	it('formats the real payload ResDiary sent for booking B26AMTW9', () => {
		expect(formatBookingDate('2026-08-04T00:00:00')).toBe('Tuesday 4 August 2026');
	});

	it('names the right weekday either side of a month boundary', () => {
		expect(formatBookingDate('2026-08-01T00:00:00')).toBe('Saturday 1 August 2026');
		expect(formatBookingDate('2026-08-31T00:00:00')).toBe('Monday 31 August 2026');
	});

	// The bug this file exists to prevent: a midnight timestamp must not slide
	// back a day when the runtime's zone is behind UTC.
	it('keeps the day at a midnight timestamp', () => {
		expect(formatBookingDate('2026-01-01T00:00:00')).toBe('Thursday 1 January 2026');
		expect(formatBookingDate('2026-12-31T00:00:00')).toBe('Thursday 31 December 2026');
	});

	it('accepts a bare date with no time part', () => {
		expect(formatBookingDate('2026-08-04')).toBe('Tuesday 4 August 2026');
	});

	it('handles a leap day', () => {
		expect(formatBookingDate('2028-02-29T00:00:00')).toBe('Tuesday 29 February 2028');
	});

	it('rejects a day that does not exist in that month', () => {
		expect(formatBookingDate('2026-02-29T00:00:00')).toBe('');
		expect(formatBookingDate('2026-04-31T00:00:00')).toBe('');
		expect(formatBookingDate('2026-13-01T00:00:00')).toBe('');
		expect(formatBookingDate('2026-00-10T00:00:00')).toBe('');
	});

	it('returns empty for junk, missing or hand-edited values', () => {
		expect(formatBookingDate(null)).toBe('');
		expect(formatBookingDate(undefined)).toBe('');
		expect(formatBookingDate('')).toBe('');
		expect(formatBookingDate('tomorrow')).toBe('');
		expect(formatBookingDate('04/08/2026')).toBe('');
		expect(formatBookingDate('<script>alert(1)</script>')).toBe('');
	});
});

describe('formatBookingTime', () => {
	it('formats the real payload', () => {
		expect(formatBookingTime('12:00:00')).toBe('12:00pm');
	});

	it('reads noon and midnight as 12, not 0', () => {
		expect(formatBookingTime('00:00:00')).toBe('12:00am');
		expect(formatBookingTime('12:30:00')).toBe('12:30pm');
	});

	it('formats morning and evening service times', () => {
		expect(formatBookingTime('09:15:00')).toBe('9:15am');
		expect(formatBookingTime('17:45:00')).toBe('5:45pm');
		expect(formatBookingTime('21:30:00')).toBe('9:30pm');
		expect(formatBookingTime('23:00:00')).toBe('11:00pm');
	});

	it('accepts a single-digit hour', () => {
		expect(formatBookingTime('9:15')).toBe('9:15am');
	});

	it('returns empty for out-of-range or junk values', () => {
		expect(formatBookingTime('24:00:00')).toBe('');
		expect(formatBookingTime('12:60:00')).toBe('');
		expect(formatBookingTime(null)).toBe('');
		expect(formatBookingTime('')).toBe('');
		expect(formatBookingTime('lunchtime')).toBe('');
	});
});
