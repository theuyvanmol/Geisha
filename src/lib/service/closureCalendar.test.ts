import { describe, it, expect } from 'vitest';
import {
	dayOfWeekOf,
	closureSpansDate,
	shiftDay,
	eachDate,
	toRanges,
	calendarMonths,
	dayState,
	dayStates,
	columnCount,
	WEEKS_PER_MONTH,
	MAX_RANGE_DAYS,
	type CalendarClosure
} from './closureCalendar.js';

const closure = (over: Partial<CalendarClosure>): CalendarClosure => ({
	id: 'c1',
	dateFrom: '2026-07-24',
	dateTo: '2026-07-24',
	scope: 'full',
	...over
});

describe('dayOfWeekOf', () => {
	it('reads the weekday off a calendar date without a Date instant', () => {
		expect(dayOfWeekOf('2026-07-29')).toBe(3); // Wednesday
		expect(dayOfWeekOf('2026-08-02')).toBe(0); // Sunday
		expect(dayOfWeekOf('2028-02-29')).toBe(2); // leap Tuesday
		expect(dayOfWeekOf('2027-01-01')).toBe(5); // Friday
	});
});

describe('closureSpansDate', () => {
	it('covers every day of a plain range, inclusive', () => {
		const c = closure({ dateFrom: '2026-12-24', dateTo: '2026-12-26' });
		expect(closureSpansDate(c, '2026-12-23')).toBe(false);
		expect(closureSpansDate(c, '2026-12-24')).toBe(true);
		expect(closureSpansDate(c, '2026-12-26')).toBe(true);
		expect(closureSpansDate(c, '2026-12-27')).toBe(false);
	});

	it('treats a blank dateTo as a single day', () => {
		const c = closure({ dateFrom: '2026-12-24', dateTo: '' });
		expect(closureSpansDate(c, '2026-12-24')).toBe(true);
		expect(closureSpansDate(c, '2026-12-25')).toBe(false);
	});

	it('bites only on the listed weekdays when periodic', () => {
		const c = closure({ dateFrom: '2026-07-01', dateTo: '2026-12-31', daysOfWeek: [0] });
		expect(closureSpansDate(c, '2026-08-02')).toBe(true); // Sunday
		expect(closureSpansDate(c, '2026-08-03')).toBe(false); // Monday
	});
});

describe('date arithmetic', () => {
	it('shifts across month, year and leap boundaries', () => {
		expect(shiftDay('2026-07-31', 1)).toBe('2026-08-01');
		expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31');
		expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
		expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01');
	});

	it('enumerates inclusive ranges and refuses inverted ones', () => {
		expect(eachDate('2026-07-30', '2026-08-01')).toEqual([
			'2026-07-30',
			'2026-07-31',
			'2026-08-01'
		]);
		expect(eachDate('2026-08-01', '2026-07-30')).toEqual([]);
		expect(eachDate('2026-07-30', '2026-07-30')).toEqual(['2026-07-30']);
	});

	it('caps a runaway range instead of looping forever', () => {
		expect(eachDate('2026-01-01', '2099-01-01')).toHaveLength(MAX_RANGE_DAYS);
	});

	it('collapses dates into contiguous runs', () => {
		expect(toRanges(['2026-07-30', '2026-07-31', '2026-08-02'])).toEqual([
			{ from: '2026-07-30', to: '2026-07-31' },
			{ from: '2026-08-02', to: '2026-08-02' }
		]);
	});

	it('sorts and dedupes before collapsing', () => {
		expect(toRanges(['2026-08-02', '2026-07-31', '2026-08-01', '2026-08-02'])).toEqual([
			{ from: '2026-07-31', to: '2026-08-02' }
		]);
	});
});

describe('calendarMonths', () => {
	it('gives one row per month touched by the range, all the same width', () => {
		const months = calendarMonths('2026-07-15', '2026-09-02');
		expect(months.map((m) => m.label)).toEqual(['Jul 2026', 'Aug 2026', 'Sep 2026']);
		const width = columnCount(months);
		for (const m of months) expect(m.cells).toHaveLength(width);
		expect(width % 7).toBe(0); // whole weeks, so the repeating header lines up
		expect(width).toBeLessThanOrEqual(WEEKS_PER_MONTH * 7);
	});

	it('trims dead columns to the widest month shown', () => {
		// Feb 2027 starts Monday and has 28 days — exactly four weeks, nothing more.
		expect(columnCount(calendarMonths('2027-02-01', '2027-02-28'))).toBe(28);
		// Aug 2026 starts Saturday with 31 days, so it genuinely needs all six weeks.
		expect(columnCount(calendarMonths('2026-08-01', '2026-08-31'))).toBe(42);
	});

	it('aligns the 1st under its own weekday, Monday-first', () => {
		// 1 Jul 2026 is a Wednesday → column index 2.
		const [jul] = calendarMonths('2026-07-01', '2026-07-31');
		expect(jul.cells.slice(0, 3).map((c) => c.day)).toEqual([null, null, 1]);
		expect(jul.cells[2].weekday).toBe(3); // Wednesday
	});

	it('holds a 31-day month starting on a Saturday without dropping the 31st', () => {
		// The bug a 5-week grid has: Aug 2026 starts Sat and needs SIX week columns.
		const [aug] = calendarMonths('2026-08-01', '2026-08-31');
		const days = aug.cells.filter((c) => c.day !== null).map((c) => c.day);
		expect(days).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
		expect(aug.cells.findIndex((c) => c.day === 1)).toBe(5); // Saturday column
	});

	it('draws the whole month but flags days outside the viewed range inert', () => {
		const [jul] = calendarMonths('2026-07-15', '2026-07-20');
		const c14 = jul.cells.find((c) => c.date === '2026-07-14');
		const c15 = jul.cells.find((c) => c.date === '2026-07-15');
		const c21 = jul.cells.find((c) => c.date === '2026-07-21');
		expect(c14?.inRange).toBe(false);
		expect(c15?.inRange).toBe(true);
		expect(c21?.inRange).toBe(false);
	});

	it('spans a year boundary in order', () => {
		const months = calendarMonths('2026-11-01', '2027-02-28');
		expect(months.map((m) => m.label)).toEqual(['Nov 2026', 'Dec 2026', 'Jan 2027', 'Feb 2027']);
	});

	it('caps at 24 months and rejects an inverted range', () => {
		expect(calendarMonths('2026-01-01', '2030-01-01')).toHaveLength(24);
		expect(calendarMonths('2026-08-01', '2026-07-01')).toEqual([]);
	});

	it('handles a leap February', () => {
		const [feb] = calendarMonths('2028-02-01', '2028-02-29');
		expect(feb.cells.filter((c) => c.day !== null)).toHaveLength(29);
	});
});

describe('dayState', () => {
	const rules = [
		closure({ id: 'full', dateFrom: '2026-12-25', dateTo: '2026-12-25' }),
		closure({
			id: 'lunch',
			scope: 'period',
			servicePeriodId: 'lunch',
			dateFrom: '2026-12-24',
			dateTo: '2026-12-24'
		}),
		closure({
			id: 'bar',
			scope: 'section',
			servicePeriodId: 'dinner',
			section: 'Bar',
			dateFrom: '2026-12-24',
			dateTo: '2026-12-24'
		})
	];

	it('buckets a whole-day closure', () => {
		const s = dayState('2026-12-25', rules);
		expect(s.full?.id).toBe('full');
		expect(s.periods).toEqual([]);
	});

	it('buckets service and part-of-room closures separately', () => {
		const s = dayState('2026-12-24', rules);
		expect(s.full).toBeNull();
		expect(s.periods.map((c) => c.id)).toEqual(['lunch']);
		expect(s.partial.map((c) => c.id)).toEqual(['bar']);
	});

	it('reports an untouched day as fully open', () => {
		const s = dayState('2026-12-23', rules);
		expect(s).toEqual({ full: null, periods: [], partial: [] });
	});

	it('builds a lookup holding only the days that have something closed', () => {
		const map = dayStates('2026-12-23', '2026-12-26', rules);
		expect([...map.keys()]).toEqual(['2026-12-24', '2026-12-25']);
	});
});
