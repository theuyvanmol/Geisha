import { describe, it, expect } from 'vitest';
import {
	ALL_SECTIONS,
	isWholeRestaurant,
	isDateClosed,
	isPeriodClosed,
	isSectionClosed,
	closedSectionsFor,
	sectionCloseoutsFor,
	type ClosureRule
} from './closures.js';
import { sectionCloseoutFootprints } from './availability.js';
import type { DiningTable, ServicePeriod } from '../db/types.js';

const DATE = '2026-07-24';
const TZ = 'Europe/London';

const rule = (over: Partial<ClosureRule>): ClosureRule => ({
	dateFrom: DATE,
	dateTo: DATE,
	scope: 'section',
	servicePeriodId: 'dinner',
	kind: 'maintenance',
	reason: '',
	...over
});

const table = (id: string, section: string): DiningTable => ({
	id,
	created: '',
	updated: '',
	restaurant: 'r1',
	label: id,
	section,
	seats_min: 2,
	seats_max: 4,
	bookable: true,
	x: 0,
	y: 0,
	width: 90,
	height: 90,
	shape: 'rect'
});

const TABLES: DiningTable[] = [
	table('t1', 'Main'),
	table('t2', 'Main'),
	table('t3', 'Terrace'),
	table('t4', '') // a table with no section at all
];

const DINNER: ServicePeriod = {
	id: 'dinner',
	created: '',
	updated: '',
	restaurant: 'r1',
	name: 'Dinner',
	days_of_week: [0, 1, 2, 3, 4, 5, 6],
	start_time: '17:00',
	end_time: '23:00',
	last_booking_time: '21:00',
	default_turn_minutes: 120,
	active: true
};

describe('whole-restaurant close-outs (ALL_SECTIONS)', () => {
	it('recognises the sentinel and nothing else', () => {
		expect(isWholeRestaurant({ section: ALL_SECTIONS })).toBe(true);
		expect(isWholeRestaurant({ section: 'Main' })).toBe(false);
		expect(isWholeRestaurant({ section: '' })).toBe(false);
		// a TABLE close-out is never restaurant-wide, even if section is left as '*'
		expect(isWholeRestaurant({ section: ALL_SECTIONS, table: 't1' })).toBe(false);
	});

	it('closes every section when it shuts the whole service', () => {
		const closures = [rule({ section: ALL_SECTIONS })];
		expect(isSectionClosed(DATE, 'dinner', 'Main', closures)).toBe(true);
		expect(isSectionClosed(DATE, 'dinner', 'Terrace', closures)).toBe(true);
		// ...but only for the service it names
		expect(isSectionClosed(DATE, 'lunch', 'Main', closures)).toBe(false);
	});

	it('does NOT close whole sections when it only blocks a time window', () => {
		// "Close the restaurant 19:00-20:00" leaves the rest of the service bookable, so
		// the section itself is not closed — the window is enforced as occupancy instead.
		const closures = [rule({ section: ALL_SECTIONS, timeFrom: '19:00', timeTo: '20:00' })];
		expect(isSectionClosed(DATE, 'dinner', 'Main', closures)).toBe(false);
	});

	it('never appears as a ticked cell on the section grid', () => {
		const closures = [rule({ section: ALL_SECTIONS }), rule({ section: 'Terrace' })];
		expect([...closedSectionsFor(DATE, 'dinner', closures)]).toEqual(['Terrace']);
	});

	it('is still listed among the section-scope close-outs', () => {
		const closures = [rule({ section: ALL_SECTIONS, timeFrom: '19:00', timeTo: '20:00' })];
		expect(sectionCloseoutsFor(DATE, 'dinner', closures)).toHaveLength(1);
	});

	it('blocks EVERY table for the window, whatever its section', () => {
		const closures = [rule({ section: ALL_SECTIONS, timeFrom: '19:00', timeTo: '20:00' })];
		const prints = sectionCloseoutFootprints(DATE, TZ, [DINNER], TABLES, closures);
		expect(prints.map((p) => p.tableIds[0]).sort()).toEqual(['t1', 't2', 't3', 't4']);
		for (const p of prints) {
			expect(new Date(p.startsAt).toISOString()).toBe('2026-07-24T18:00:00.000Z'); // 19:00 BST
			expect(new Date(p.endsAt).toISOString()).toBe('2026-07-24T19:00:00.000Z'); // 20:00 BST
		}
	});

	it('blocks every table for the WHOLE service when no window is given', () => {
		const closures = [rule({ section: ALL_SECTIONS })];
		const prints = sectionCloseoutFootprints(DATE, TZ, [DINNER], TABLES, closures);
		expect(prints).toHaveLength(4);
		// whole-service window: opens at 17:00 local
		expect(new Date(prints[0].startsAt).toISOString()).toBe('2026-07-24T16:00:00.000Z');
	});

	it('applies a windowed block on a day its filed service does NOT run', () => {
		// Fusion files close-outs against Mon-Sat Lunch, but Sundays run a Sunday-only
		// period. A windowed block is scoped to the CLOCK, not to a service, so a
		// "closed 16:45-17:00 until <date>" range has to keep biting on the Sunday —
		// it used to be skipped silently because no period on that date matched its id.
		const SUNDAY: ServicePeriod = {
			...DINNER,
			id: 'sunday',
			name: 'Sunday',
			start_time: '12:00',
			end_time: '19:30',
			last_booking_time: '18:00'
		};
		const closures = [
			rule({
				servicePeriodId: 'lunch', // a service that does not run today
				section: ALL_SECTIONS,
				timeFrom: '16:45',
				timeTo: '17:00',
				dateTo: '2026-08-24'
			})
		];
		const prints = sectionCloseoutFootprints(DATE, TZ, [SUNDAY], TABLES, closures);
		expect(prints).toHaveLength(4);
		expect(new Date(prints[0].startsAt).toISOString()).toBe('2026-07-24T15:45:00.000Z');
	});

	it('still scopes a WINDOWLESS block to the service it names', () => {
		// The other half of the rule: with no window there is nothing but the service to
		// go on, so a whole-service block on a service that isn't running does nothing.
		const closures = [rule({ servicePeriodId: 'lunch', section: ALL_SECTIONS })];
		expect(sectionCloseoutFootprints(DATE, TZ, [DINNER], TABLES, closures)).toHaveLength(0);
	});

	it('blocks the dead quarter-hour BETWEEN two services', () => {
		// Fusion's Lunch shuts at 16:45 and Dinner opens at 17:00, so 16:45-17:00 belongs
		// to no service. A whole-restaurant block is enforced from its OWN window, so it
		// can shut that changeover even though it's filed under Lunch (owner: "there's a
		// gap in close-outs 16:45-17:00 that can't be closed when closing the whole
		// restaurant"). Filed under one service, honoured across the day.
		const LUNCH: ServicePeriod = {
			...DINNER,
			id: 'lunch',
			name: 'Lunch',
			start_time: '12:00',
			end_time: '16:45',
			last_booking_time: '16:45'
		};
		const closures = [
			rule({ servicePeriodId: 'lunch', section: ALL_SECTIONS, timeFrom: '16:45', timeTo: '17:00' })
		];
		const prints = sectionCloseoutFootprints(DATE, TZ, [LUNCH, DINNER], TABLES, closures);
		expect(prints.map((p) => p.tableIds[0]).sort()).toEqual(['t1', 't2', 't3', 't4']);
		for (const p of prints) {
			expect(new Date(p.startsAt).toISOString()).toBe('2026-07-24T15:45:00.000Z'); // 16:45 BST
			expect(new Date(p.endsAt).toISOString()).toBe('2026-07-24T16:00:00.000Z'); // 17:00 BST
		}
		// ...and a SINGLE TABLE can be shut across the same changeover, which is what the
		// diary's right-click-a-cell close-out builds when you click a cell in the gap.
		const oneTable = [
			rule({ servicePeriodId: 'lunch', section: '', table: 't1', timeFrom: '16:45', timeTo: '17:00' })
		];
		const solo = sectionCloseoutFootprints(DATE, TZ, [LUNCH, DINNER], TABLES, oneTable);
		expect(solo.map((p) => p.tableIds[0])).toEqual(['t1']);
	});

	it('leaves a plain section close-out targeting only that section', () => {
		const closures = [rule({ section: 'Main' })];
		const prints = sectionCloseoutFootprints(DATE, TZ, [DINNER], TABLES, closures);
		expect(prints.map((p) => p.tableIds[0]).sort()).toEqual(['t1', 't2']);
	});

	it('leaves an unsectioned close-out matching only unsectioned tables (unchanged)', () => {
		const closures = [rule({ section: '' })];
		const prints = sectionCloseoutFootprints(DATE, TZ, [DINNER], TABLES, closures);
		expect(prints.map((p) => p.tableIds[0])).toEqual(['t4']);
	});
});

describe('closure predicates (regression cover)', () => {
	it('full-day closures still shut the date', () => {
		const closures = [rule({ scope: 'full', servicePeriodId: undefined })];
		expect(isDateClosed(DATE, closures)).toBe(true);
		expect(isPeriodClosed(DATE, 'dinner', closures)).toBe(true);
		expect(isSectionClosed(DATE, 'dinner', 'Main', closures)).toBe(true);
	});

	it('a section close-out does not leak to other sections', () => {
		const closures = [rule({ section: 'Main' })];
		expect(isSectionClosed(DATE, 'dinner', 'Main', closures)).toBe(true);
		expect(isSectionClosed(DATE, 'dinner', 'Terrace', closures)).toBe(false);
	});
});

describe('multi-day (date range) section close-outs', () => {
	// A close-out stored once with dateFrom..dateTo shuts its target on EVERY day in the
	// range — the "close this table / these hours for a period" behaviour. The engine's
	// spans() already does this; these lock in that a range close-out isn't a single-day one.
	const RANGE = { dateFrom: '2026-07-24', dateTo: '2026-08-24' };

	it('closes a section on the first day, an interior day, and the last day', () => {
		const closures = [rule({ section: 'Main', ...RANGE })];
		expect(isSectionClosed('2026-07-24', 'dinner', 'Main', closures)).toBe(true); // first
		expect(isSectionClosed('2026-08-01', 'dinner', 'Main', closures)).toBe(true); // interior
		expect(isSectionClosed('2026-08-24', 'dinner', 'Main', closures)).toBe(true); // last
	});

	it('does NOT close the day before or the day after the range', () => {
		const closures = [rule({ section: 'Main', ...RANGE })];
		expect(isSectionClosed('2026-07-23', 'dinner', 'Main', closures)).toBe(false);
		expect(isSectionClosed('2026-08-25', 'dinner', 'Main', closures)).toBe(false);
	});

	it('builds table footprints on an interior day of the range', () => {
		const closures = [rule({ table: 't1', section: '', ...RANGE })];
		const prints = sectionCloseoutFootprints('2026-08-10', TZ, [DINNER], TABLES, closures);
		expect(prints.map((p) => p.tableIds[0])).toEqual(['t1']);
	});
});
