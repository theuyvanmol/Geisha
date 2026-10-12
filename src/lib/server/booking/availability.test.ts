import { describe, it, expect } from 'vitest';
import { fromZonedTime } from 'date-fns-tz';
import {
	checkAvailability,
	allocateTables,
	expandToJoinedSet,
	turnMinutesFor,
	withinBookingHorizon,
	sectionCloseoutFootprints,
	type BookingFootprint
} from './availability.js';
import type { ClosureRule } from './closures.js';
import type { PacingRule } from './pacing.js';
import type { DiningTable, ServicePeriod, TableJoin } from '../db/types.js';
import { policyFor } from './autojoin.js';

const TZ = 'Europe/London';

// --- fixtures ---------------------------------------------------------------

function table(
	over: Partial<DiningTable> & { id: string; seats_min: number; seats_max: number }
): DiningTable {
	return {
		created: '',
		updated: '',
		restaurant: 'r1',
		label: over.id,
		section: 'Main',
		bookable: true,
		x: 0,
		y: 0,
		width: 90,
		height: 90,
		shape: 'rect',
		...over
	};
}

const TABLES: DiningTable[] = [
	table({ id: 't2a', seats_min: 1, seats_max: 2 }),
	table({ id: 't2b', seats_min: 1, seats_max: 2 }),
	table({ id: 't4', seats_min: 2, seats_max: 4 }),
	table({ id: 't6', seats_min: 4, seats_max: 6 }),
	table({ id: 'walkin', seats_min: 1, seats_max: 2, bookable: false })
];

const JOINS: TableJoin[] = [
	{ id: 'j1', created: '', updated: '', restaurant: 'r1', table_a: 't2a', table_b: 't2b' },
	{ id: 'j2', created: '', updated: '', restaurant: 'r1', table_a: 't4', table_b: 't6' }
];

function period(over: Partial<ServicePeriod> & { name: string }): ServicePeriod {
	return {
		id: over.name,
		created: '',
		updated: '',
		restaurant: 'r1',
		days_of_week: [0, 1, 2, 3, 4, 5, 6],
		start_time: '17:00',
		end_time: '23:00',
		last_booking_time: '21:00',
		default_turn_minutes: 120,
		active: true,
		...over
	};
}

const DINNER = period({ name: 'Dinner' });

// 2025-06-02 is a Monday.
const MONDAY = '2025-06-02';

function inst(date: string, hhmm: string): Date {
	// Build the same instant the engine builds, via a fixed-offset trick:
	// rely on the engine's own parsing by going through checkAvailability is
	// overkill; for allocate tests we just need *an* instant — use UTC here and
	// keep turn math relative, which is timezone-agnostic for overlap.
	return new Date(`${date}T${hhmm}:00Z`);
}

// --- allocateTables ---------------------------------------------------------

describe('allocateTables', () => {
	it('puts a party of 2 on the smallest fitting table', () => {
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 2, TABLES, JOINS, []);
		expect(ids).toEqual(['t2a']); // smallest seats_max that fits
	});

	it('keeps small tables free and uses the 4-top for a party of 3', () => {
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 3, TABLES, JOINS, []);
		expect(ids).toEqual(['t4']);
	});

	it('never allocates a walk-in-only table', () => {
		// occupy every bookable 2-top; a party of 2 should fail rather than take walkin
		const existing: BookingFootprint[] = [
			{ tableIds: ['t2a'], startsAt: inst(MONDAY, '17:30'), endsAt: inst(MONDAY, '19:30') },
			{ tableIds: ['t2b'], startsAt: inst(MONDAY, '17:30'), endsAt: inst(MONDAY, '19:30') }
		];
		// t4 still fits a 2 (seats_min 2) so allocation should pick t4, not walkin
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 2, TABLES, JOINS, existing);
		expect(ids).toEqual(['t4']);
		expect(ids).not.toContain('walkin');
	});

	it('falls back to a join when no single table fits a large party', () => {
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 9, TABLES, JOINS, []);
		// t4(max4)+t6(max6)=10 fits 9; t2a+t2b=4 does not
		expect(ids).toEqual(['t4', 't6']);
	});

	it('returns null when nothing fits', () => {
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 20, TABLES, JOINS, []);
		expect(ids).toBeNull();
	});

	it('respects overlap: a busy table is not reused within its window', () => {
		const existing: BookingFootprint[] = [
			{ tableIds: ['t2a'], startsAt: inst(MONDAY, '18:00'), endsAt: inst(MONDAY, '20:00') }
		];
		const ids = allocateTables(inst(MONDAY, '19:00'), 120, 2, TABLES, JOINS, existing);
		expect(ids).toEqual(['t2b']); // t2a busy, next smallest free 2-top
	});

	it('allows back-to-back bookings exactly at the turn boundary', () => {
		const existing: BookingFootprint[] = [
			{ tableIds: ['t2a'], startsAt: inst(MONDAY, '18:00'), endsAt: inst(MONDAY, '20:00') }
		];
		// new booking starts exactly when the previous ends — [start,end) so no overlap
		const ids = allocateTables(inst(MONDAY, '20:00'), 120, 2, TABLES, JOINS, existing);
		expect(ids).toEqual(['t2a']);
	});
});

// --- fill ranking / fill order ----------------------------------------------

describe('allocateTables — fill ranking', () => {
	// Two equally-sized 2-tops both fit a party of 2. With no ranks the existing
	// smallest-fit + label order picks t2a; a lower rank on t2b flips the choice.
	it('absent ranks: behaviour is unchanged (smallest-fit order)', () => {
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 2, TABLES, JOINS, []);
		expect(ids).toEqual(['t2a']);
		// passing an empty map is identical to passing nothing
		const same = allocateTables(inst(MONDAY, '18:00'), 120, 2, TABLES, JOINS, [], {});
		expect(same).toEqual(['t2a']);
	});

	it('prefers the lower-ranked table when two equally fit', () => {
		// t2b ranked below t2a (1 < 100 default) → t2b is filled first.
		const ranks = { t2b: 1 };
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 2, TABLES, JOINS, [], ranks);
		expect(ids).toEqual(['t2b']);
	});

	it('rank beats capacity: a higher-cap but lower-ranked table wins over a tight fit', () => {
		// Party of 2 fits both t2a (max 2) and t4 (min 2, max 4). Normally t2a wins
		// (tighter). Rank t4 below the 2-tops and t4 should be chosen despite being
		// the bigger table — yield control overrides the smallest-fit heuristic.
		const ranks = { t4: 1 };
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 2, TABLES, JOINS, [], ranks);
		expect(ids).toEqual(['t4']);
	});

	it('skips a lower-ranked table that is busy and falls to the next by rank', () => {
		// t2b ranked first but occupied at 18:00 → allocator moves on to t2a.
		const ranks = { t2b: 1 };
		const existing: BookingFootprint[] = [
			{ tableIds: ['t2b'], startsAt: inst(MONDAY, '17:30'), endsAt: inst(MONDAY, '19:30') }
		];
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 2, TABLES, JOINS, existing, ranks);
		expect(ids).toEqual(['t2a']);
	});

	it('default rank for unranked tables keeps relative order among them', () => {
		// Only rank t4 high (filled last); the two 2-tops keep their default order.
		const ranks = { t4: 999 };
		const ids = allocateTables(inst(MONDAY, '18:00'), 120, 2, TABLES, JOINS, [], ranks);
		expect(ids).toEqual(['t2a']); // unchanged — t4 only matters once 2-tops are full
	});
});

// --- large parties: multi-table combinations (ResDiary "combine tables") ------
// The house's biggest table seats 8, so a party of 19 or 40 can only ever be
// seated across several tables. Before this the allocator stopped at a PAIR, so
// every slot came back "no tables available" for a party the room can obviously
// hold — the owner's 19-cover and 40-cover bookings.

describe('allocateTables — large parties', () => {
	// A room shaped like Geisha Asia's "Front right" section: three 8-tops, two
	// 7-tops and a 2-top in one section, plus a small table in another.
	const BIG: DiningTable[] = [
		table({ id: 'b1', seats_min: 1, seats_max: 8, section: 'Front' }),
		table({ id: 'b2', seats_min: 1, seats_max: 8, section: 'Front' }),
		table({ id: 'b3', seats_min: 1, seats_max: 8, section: 'Front' }),
		table({ id: 'b4', seats_min: 1, seats_max: 7, section: 'Front' }),
		table({ id: 'b5', seats_min: 1, seats_max: 7, section: 'Front' }),
		table({ id: 'b6', seats_min: 1, seats_max: 2, section: 'Front' }),
		table({ id: 'c1', seats_min: 1, seats_max: 4, section: 'Back' })
	];
	const at = (hhmm: string) => inst(MONDAY, hhmm);

	it('seats a party of 19 across a combination in ONE section', () => {
		const ids = allocateTables(at('18:00'), 150, 19, BIG, [], []);
		expect(ids).not.toBeNull();
		const seats = ids!.reduce((n, id) => n + BIG.find((t) => t.id === id)!.seats_max, 0);
		expect(seats).toBeGreaterThanOrEqual(19);
		// fewest tables: 8+8+8 = 24 covers 19
		expect(ids).toEqual(['b1', 'b2', 'b3']);
		// all from one section — a party of 19 sits together
		expect(new Set(ids!.map((id) => BIG.find((t) => t.id === id)!.section)).size).toBe(1);
	});

	it('seats a party of 40 by combining across sections when no one section fits', () => {
		const ids = allocateTables(at('18:00'), 150, 40, BIG, [], []);
		expect(ids).not.toBeNull();
		const seats = ids!.reduce((n, id) => n + BIG.find((t) => t.id === id)!.seats_max, 0);
		expect(seats).toBeGreaterThanOrEqual(40);
	});

	it('skips tables already taken when combining', () => {
		const existing: BookingFootprint[] = [
			{ tableIds: ['b1'], startsAt: at('17:30'), endsAt: at('20:00') },
			{ tableIds: ['b2'], startsAt: at('17:30'), endsAt: at('20:00') }
		];
		const ids = allocateTables(at('18:00'), 150, 19, BIG, [], existing);
		expect(ids).not.toBeNull();
		expect(ids).not.toContain('b1');
		expect(ids).not.toContain('b2');
		const seats = ids!.reduce((n, id) => n + BIG.find((t) => t.id === id)!.seats_max, 0);
		expect(seats).toBeGreaterThanOrEqual(19);
	});

	it('still returns null when the whole room cannot hold the party', () => {
		expect(allocateTables(at('18:00'), 150, 100, BIG, [], [])).toBeNull();
	});

	it('never splits a SMALL party across tables just because its table is busy', () => {
		// every 8-top busy; a party of 6 must take a single 7-top, not a combination
		const existing: BookingFootprint[] = [
			{ tableIds: ['b1', 'b2', 'b3'], startsAt: at('17:30'), endsAt: at('20:00') }
		];
		const ids = allocateTables(at('18:00'), 150, 6, BIG, [], existing);
		expect(ids).toEqual(['b4']);
	});

	it('trims a combination that overshoots (no needless extra table)', () => {
		// 16 exactly fits two 8-tops — the greedy pass must not keep a third table
		const ids = allocateTables(at('18:00'), 150, 16, BIG, [], []);
		expect(ids).toEqual(['b1', 'b2']);
	});

	it('prefers a registered CHAIN over an ad-hoc combination, at its authored capacity', () => {
		const chains = [{ tableIds: ['b4', 'b5'], capacity: 12 }];
		const ids = allocateTables(at('18:00'), 150, 12, BIG, [], [], undefined, { chains });
		expect(ids).toEqual(['b4', 'b5']);
	});

	it("ignores a chain whose AUTHORED capacity is under the party (staff's comfort call)", () => {
		// raw seats would be 14, but staff say this run seats 9 — so a 12 can't use it
		const chains = [{ tableIds: ['b4', 'b5'], capacity: 9 }];
		const ids = allocateTables(at('18:00'), 150, 12, BIG, [], [], undefined, { chains });
		expect(ids).not.toEqual(['b4', 'b5']);
	});

	it('sells the SMALLEST capacity band that holds the party (ResDiary)', () => {
		const chains = [
			{ tableIds: ['b1', 'b2', 'b3'], capacity: 24 },
			{ tableIds: ['b4', 'b5'], capacity: 14 }
		];
		const ids = allocateTables(at('18:00'), 150, 12, BIG, [], [], undefined, { chains });
		expect(ids).toEqual(['b4', 'b5']); // 14-band beats the 24-band
	});

	it('within a capacity band, the join at the TOP of the list is sold first', () => {
		// Same capacity: configured ORDER decides — "the join on top of your list will
		// be the first to be sold".
		const first = [
			{ tableIds: ['b4', 'b5'], capacity: 14 },
			{ tableIds: ['b1', 'b2'], capacity: 14 }
		];
		expect(allocateTables(at('18:00'), 150, 12, BIG, [], [], undefined, { chains: first })).toEqual(
			['b4', 'b5']
		);
		// flip the list, the other one is sold first
		const flipped = [
			{ tableIds: ['b1', 'b2'], capacity: 14 },
			{ tableIds: ['b4', 'b5'], capacity: 14 }
		];
		expect(
			allocateTables(at('18:00'), 150, 12, BIG, [], [], undefined, { chains: flipped })
		).toEqual(['b1', 'b2']);
	});

	it('falls to the next join in the list when the top one is busy', () => {
		const chains = [
			{ tableIds: ['b4', 'b5'], capacity: 14 },
			{ tableIds: ['b1', 'b2'], capacity: 14 }
		];
		const existing: BookingFootprint[] = [
			{ tableIds: ['b4'], startsAt: at('17:30'), endsAt: at('20:00') }
		];
		const ids = allocateTables(at('18:00'), 150, 12, BIG, [], existing, undefined, { chains });
		expect(ids).toEqual(['b1', 'b2']);
	});

	it('a chain with a busy member is not offered', () => {
		const chains = [{ tableIds: ['b4', 'b5'], capacity: 12 }];
		const existing: BookingFootprint[] = [
			{ tableIds: ['b5'], startsAt: at('17:30'), endsAt: at('20:00') }
		];
		const ids = allocateTables(at('18:00'), 150, 12, BIG, [], existing, undefined, { chains });
		expect(ids).not.toContain('b5');
	});

	it('allowAdHocCombination:false keeps the old refuse-a-big-party behaviour', () => {
		const ids = allocateTables(at('18:00'), 150, 19, BIG, [], [], undefined, {
			allowAdHocCombination: false
		});
		expect(ids).toBeNull();
	});

	it('checkAvailability now offers slots for a party of 19', () => {
		const res = checkAvailability({
			date: MONDAY,
			timezone: TZ,
			periods: [DINNER],
			tables: BIG,
			joins: [],
			existing: [],
			partySize: 19
		});
		const at19 = res.slots.find((s) => s.time === '19:00');
		expect(at19?.available).toBe(true);
		expect((at19?.tableIds ?? []).length).toBeGreaterThan(1);
	});
});

describe('checkAvailability — why there are no slots', () => {
	const WEEKDAY_ONLY = period({
		name: 'Lunch',
		days_of_week: [1, 2, 3, 4, 5],
		start_time: '12:00',
		end_time: '17:00',
		last_booking_time: '16:30'
	});
	// 2025-06-07 is a Saturday.
	const SATURDAY = '2025-06-07';

	it("says 'no_service' when no period runs on that weekday (the Saturday-lunch bug)", () => {
		const res = checkAvailability({
			date: SATURDAY,
			timezone: TZ,
			periods: [WEEKDAY_ONLY],
			tables: TABLES,
			joins: JOINS,
			existing: [],
			partySize: 2
		});
		expect(res.slots).toEqual([]);
		expect(res.noSlotsReason).toBe('no_service');
	});

	it('leaves noSlotsReason unset when there ARE slots', () => {
		const res = checkAvailability({
			date: MONDAY,
			timezone: TZ,
			periods: [WEEKDAY_ONLY],
			tables: TABLES,
			joins: JOINS,
			existing: [],
			partySize: 2
		});
		expect(res.slots.length).toBeGreaterThan(0);
		expect(res.noSlotsReason).toBeUndefined();
	});
});

describe('checkAvailability — fill ranking', () => {
	const base = {
		date: MONDAY,
		timezone: TZ,
		periods: [DINNER],
		tables: TABLES,
		joins: JOINS,
		existing: [] as BookingFootprint[],
		partySize: 2
	};

	it('threads tableRanks through to allocation for available slots', () => {
		const res = checkAvailability({ ...base, tableRanks: { t2b: 1 } });
		const at19 = res.slots.find((s) => s.time === '19:00');
		expect(at19?.available).toBe(true);
		expect(at19?.tableIds).toEqual(['t2b']); // lower-ranked table chosen
	});

	it('without tableRanks, allocation is identical to today', () => {
		const res = checkAvailability({ ...base });
		const at19 = res.slots.find((s) => s.time === '19:00');
		expect(at19?.tableIds).toEqual(['t2a']);
	});
});

describe('turnMinutesFor', () => {
	it('scales the turn time by party size (90/105/120/150 ladder)', () => {
		expect(turnMinutesFor(1, DINNER)).toBe(90);
		expect(turnMinutesFor(2, DINNER)).toBe(90);
		expect(turnMinutesFor(3, DINNER)).toBe(105);
		expect(turnMinutesFor(4, DINNER)).toBe(120);
		expect(turnMinutesFor(5, DINNER)).toBe(120);
		expect(turnMinutesFor(6, DINNER)).toBe(150);
		expect(turnMinutesFor(12, DINNER)).toBe(150);
	});
});

// --- checkAvailability ------------------------------------------------------

describe('checkAvailability', () => {
	const base = {
		date: MONDAY,
		timezone: TZ,
		periods: [DINNER],
		tables: TABLES,
		joins: JOINS,
		existing: [] as BookingFootprint[]
	};

	it('flags parties over the online cap (30) as phone-only', () => {
		const res = checkAvailability({ ...base, partySize: 31 });
		expect(res.requiresPhone).toBe(true);
		expect(res.slots).toHaveLength(0);
	});

	it('does not flag a party at the online cap (30)', () => {
		// 30 is within the cap → not phone-only (slots depend on table fit, not the cap).
		const res = checkAvailability({ ...base, partySize: 30 });
		expect(res.requiresPhone).toBe(false);
	});

	it('generates slots from start_time to last_booking_time at the interval', () => {
		const res = checkAvailability({ ...base, partySize: 2, slotIntervalMinutes: 15 });
		// 17:00..21:00 inclusive at 15min = 17 slots
		expect(res.slots[0].time).toBe('17:00');
		expect(res.slots[res.slots.length - 1].time).toBe('21:00');
		expect(res.slots).toHaveLength(17);
		expect(res.slots.every((s) => s.available)).toBe(true);
	});

	it('marks a slot unavailable when all fitting tables are occupied', () => {
		// fill every table that can seat 6 for the 19:00 window
		const existing: BookingFootprint[] = [
			{ tableIds: ['t6'], startsAt: inst(MONDAY, '18:00'), endsAt: inst(MONDAY, '20:00') }
		];
		const res = checkAvailability({ ...base, partySize: 6, existing });
		const at19 = res.slots.find((s) => s.time === '19:00');
		expect(at19?.available).toBe(false);
		// 21:00 is clear of the 18:00–20:00 block
		const at21 = res.slots.find((s) => s.time === '21:00');
		expect(at21?.available).toBe(true);
	});

	it('does not offer a day with no active period', () => {
		const weekdayOnly = period({ name: 'Lunch', days_of_week: [2, 3, 4] }); // Tue–Thu
		const res = checkAvailability({
			...base,
			periods: [weekdayOnly],
			partySize: 2
		});
		expect(res.slots).toHaveLength(0); // Monday not in Tue–Thu
	});

	it('regression: with no closures and no horizon, output is unchanged', () => {
		const res = checkAvailability({ ...base, partySize: 2, slotIntervalMinutes: 15 });
		expect(res.slots).toHaveLength(17);
		expect(res.slots.every((s) => s.available)).toBe(true);
		expect(res.closed).toBeUndefined();
		expect(res.requiresPhone).toBe(false);
	});
});

// --- closures (WP-AVAIL-2) --------------------------------------------------

describe('checkAvailability — closures', () => {
	const LUNCH = period({
		name: 'Lunch',
		id: 'Lunch',
		start_time: '12:00',
		last_booking_time: '14:00'
	});
	const base = {
		date: MONDAY,
		timezone: TZ,
		periods: [LUNCH, DINNER],
		tables: TABLES,
		joins: JOINS,
		existing: [] as BookingFootprint[],
		partySize: 2
	};

	it('a full-day closure returns no slots and closed:true with the reason', () => {
		const closures: ClosureRule[] = [
			{ dateFrom: MONDAY, dateTo: MONDAY, scope: 'full', kind: 'private_hire', reason: 'Wedding' }
		];
		const res = checkAvailability({ ...base, closures });
		expect(res.slots).toHaveLength(0);
		expect(res.closed).toBe(true);
		expect(res.closureReason).toBe('Wedding');
	});

	it('a period closure removes only that service, leaving the other open', () => {
		const closures: ClosureRule[] = [
			{
				dateFrom: MONDAY,
				dateTo: MONDAY,
				scope: 'period',
				servicePeriodId: 'Lunch',
				kind: 'maintenance',
				reason: ''
			}
		];
		const res = checkAvailability({ ...base, closures });
		expect(res.closed).toBeUndefined();
		// no lunch slots (12:00–14:00); dinner (17:00–21:00) still present
		expect(res.slots.some((s) => s.time === '12:00')).toBe(false);
		expect(res.slots.some((s) => s.time === '17:00')).toBe(true);
		expect(res.slots.some((s) => s.time === '21:00')).toBe(true);
	});

	it('a multi-day closure range is inclusive of all dates', () => {
		const closures: ClosureRule[] = [
			{
				dateFrom: '2025-06-01',
				dateTo: '2025-06-03',
				scope: 'full',
				kind: 'holiday',
				reason: 'Break'
			}
		];
		// MONDAY is 2025-06-02 — squarely inside the range
		const res = checkAvailability({ ...base, closures });
		expect(res.closed).toBe(true);
		// a date outside the range is unaffected
		const after = checkAvailability({ ...base, date: '2025-06-04', closures });
		expect(after.closed).toBeUndefined();
		expect(after.slots.length).toBeGreaterThan(0);
	});

	it('non-closed dates are unaffected by unrelated closures', () => {
		const closures: ClosureRule[] = [
			{
				dateFrom: '2025-12-25',
				dateTo: '2025-12-25',
				scope: 'full',
				kind: 'holiday',
				reason: 'Xmas'
			}
		];
		const res = checkAvailability({ ...base, closures });
		expect(res.closed).toBeUndefined();
		expect(res.slots.length).toBeGreaterThan(0);
	});
});

// --- section close-outs (diary "CloseOuts" grid) ----------------------------

describe('checkAvailability — section close-outs', () => {
	const LUNCH = period({
		name: 'Lunch',
		id: 'Lunch',
		start_time: '12:00',
		last_booking_time: '14:00',
		end_time: '15:30' // lunch service closes before dinner opens (17:00)
	});
	// One 2-top in "Counter", one 2-top in "Main" — so closing "Counter" for a
	// service leaves only the Main 2-top allocatable there.
	const SEC_TABLES: DiningTable[] = [
		table({ id: 'counter1', seats_min: 1, seats_max: 2, section: 'Counter' }),
		table({ id: 'main1', seats_min: 1, seats_max: 2, section: 'Main' })
	];
	const base = {
		date: MONDAY,
		timezone: TZ,
		periods: [LUNCH, DINNER],
		tables: SEC_TABLES,
		joins: [] as TableJoin[],
		existing: [] as BookingFootprint[],
		partySize: 2
	};
	const closeCounterLunch: ClosureRule[] = [
		{
			dateFrom: MONDAY,
			dateTo: MONDAY,
			scope: 'section',
			servicePeriodId: 'Lunch',
			section: 'Counter',
			kind: 'maintenance',
			reason: 'Deep clean'
		}
	];

	it('removes the closed section from allocation during the closed service only', () => {
		const res = checkAvailability({ ...base, closures: closeCounterLunch });
		// Lunch 12:00 still bookable (Main 2-top free); the counter table isn't offered.
		const lunch = res.slots.find((s) => s.time === '12:00');
		expect(lunch?.available).toBe(true);
		expect(lunch?.tableIds).toEqual(['main1']);
		expect(lunch?.tableIds).not.toContain('counter1');
	});

	it('makes lunch unbookable once the only open section is also full', () => {
		// Main 2-top taken across the lunch window → nothing left but the closed Counter.
		const existing: BookingFootprint[] = [
			{ tableIds: ['main1'], startsAt: inst(MONDAY, '11:30'), endsAt: inst(MONDAY, '14:30') }
		];
		const res = checkAvailability({ ...base, existing, closures: closeCounterLunch });
		const lunch = res.slots.find((s) => s.time === '12:00');
		expect(lunch?.available).toBe(false);
	});

	it('leaves the OTHER service untouched (Counter still bookable at dinner)', () => {
		// Occupy Main around the 19:00 dinner slot so the ONLY way it can be available is
		// if the Counter table (closed for LUNCH only) is back in play at dinner.
		const existing: BookingFootprint[] = [
			{ tableIds: ['main1'], startsAt: inst(MONDAY, '18:30'), endsAt: inst(MONDAY, '20:30') }
		];
		const res = checkAvailability({ ...base, existing, closures: closeCounterLunch });
		const dinner = res.slots.find((s) => s.time === '19:00');
		expect(dinner?.available).toBe(true);
		expect(dinner?.tableIds).toEqual(['counter1']);
	});

	it('a section close-out for a different section does not touch this one', () => {
		const closeOther: ClosureRule[] = [
			{
				dateFrom: MONDAY,
				dateTo: MONDAY,
				scope: 'section',
				servicePeriodId: 'Lunch',
				section: 'Nowhere',
				kind: 'maintenance',
				reason: ''
			}
		];
		// Occupy Main at lunch so a bookable lunch slot proves Counter is still open.
		const existing: BookingFootprint[] = [
			{ tableIds: ['main1'], startsAt: inst(MONDAY, '11:30'), endsAt: inst(MONDAY, '14:30') }
		];
		const res = checkAvailability({ ...base, existing, closures: closeOther });
		const lunch = res.slots.find((s) => s.time === '12:00');
		expect(lunch?.available).toBe(true);
		expect(lunch?.tableIds).toEqual(['counter1']);
	});

	// --- single-table close-out (targets one table, not a whole section) --------
	it('a table close-out blocks only that table for the service', () => {
		const closeCounter1Lunch: ClosureRule[] = [
			{
				dateFrom: MONDAY,
				dateTo: MONDAY,
				scope: 'section',
				servicePeriodId: 'Lunch',
				table: 'counter1',
				kind: 'maintenance',
				reason: 'wobbly leg'
			}
		];
		const res = checkAvailability({ ...base, closures: closeCounter1Lunch });
		const lunch = res.slots.find((s) => s.time === '12:00');
		// counter1 is out; the allocator falls to main1 (only other 2-top).
		expect(lunch?.available).toBe(true);
		expect(lunch?.tableIds).toEqual(['main1']);
	});

	// --- time-window close-out (sub-service window only) ------------------------
	it('a time-windowed close-out blocks the table only inside the window', () => {
		// Close Counter (whole section = counter1) for DINNER, but only 19:00–20:00.
		const closeCounterEarlyDinner: ClosureRule[] = [
			{
				dateFrom: MONDAY,
				dateTo: MONDAY,
				scope: 'section',
				servicePeriodId: 'Dinner',
				section: 'Counter',
				timeFrom: '19:00',
				timeTo: '20:00',
				kind: 'maintenance',
				reason: ''
			}
		];
		// Occupy Main across all of dinner so a bookable dinner slot MUST be Counter.
		const existing: BookingFootprint[] = [
			{ tableIds: ['main1'], startsAt: inst(MONDAY, '16:30'), endsAt: inst(MONDAY, '23:30') }
		];
		const res = checkAvailability({ ...base, existing, closures: closeCounterEarlyDinner });
		// 19:00 sits inside the closed window → Counter blocked → no table → unavailable.
		expect(res.slots.find((s) => s.time === '19:00')?.available).toBe(false);
		// 17:00 (turn 90m → 17:00–18:30) ends before the 19:00 block → Counter free.
		expect(res.slots.find((s) => s.time === '17:00')?.available).toBe(true);
		// 20:00 starts exactly when the block ends → no overlap → Counter free.
		expect(res.slots.find((s) => s.time === '20:00')?.available).toBe(true);
	});
});

// --- booking horizon (WP-AVAIL-3) -------------------------------------------

describe('withinBookingHorizon', () => {
	const NOW = Date.parse('2025-06-02T12:00:00Z');

	it('allows a slot exactly at now + lead', () => {
		expect(withinBookingHorizon(NOW + 120 * 60_000, NOW, 120, 0)).toBe(true);
	});
	it('blocks a slot one minute inside the lead window', () => {
		expect(withinBookingHorizon(NOW + 119 * 60_000, NOW, 120, 0)).toBe(false);
	});
	it('allows a slot at the window boundary', () => {
		expect(withinBookingHorizon(NOW + 60 * 86_400_000, NOW, 0, 60)).toBe(true);
	});
	it('blocks a slot one day beyond the window', () => {
		expect(withinBookingHorizon(NOW + 61 * 86_400_000, NOW, 0, 60)).toBe(false);
	});
	it('lead=0 and window=0 disable both POLICY checks', () => {
		expect(withinBookingHorizon(NOW + 1_000, NOW, 0, 0)).toBe(true);
		expect(withinBookingHorizon(NOW + 999 * 86_400_000, NOW, 0, 0)).toBe(true);
	});
	it('a slot that has already started is out of the horizon even with lead=0', () => {
		expect(withinBookingHorizon(NOW - 1_000, NOW, 0, 0)).toBe(false);
		expect(withinBookingHorizon(NOW - 6 * 3_600_000, NOW, 0, 120)).toBe(false);
	});
	it('a slot exactly at now is still bookable', () => {
		expect(withinBookingHorizon(NOW, NOW, 0, 0)).toBe(true);
	});
});

describe('checkAvailability — horizon', () => {
	// Dinner 17:00–21:00 on MONDAY (Europe/London = UTC+1 in June, so 17:00 local
	// is 16:00Z). Pick a `now` so some slots fall inside the lead window.
	const base = {
		date: MONDAY,
		timezone: TZ,
		periods: [DINNER],
		tables: TABLES,
		joins: JOINS,
		existing: [] as BookingFootprint[],
		partySize: 2
	};
	// 18:00 London on MONDAY in UTC ms:
	const NOW_18_LOCAL = Date.parse('2025-06-02T17:00:00Z');

	it("marks slots earlier than now+lead as 'too_soon'", () => {
		const res = checkAvailability({
			...base,
			nowMs: NOW_18_LOCAL,
			leadTimeMinutes: 120 // first allowed slot is 20:00 local
		});
		const at19 = res.slots.find((s) => s.time === '19:00');
		const at20 = res.slots.find((s) => s.time === '20:00');
		expect(at19?.available).toBe(false);
		expect(at19?.unavailableReason).toBe('too_soon');
		expect(at20?.available).toBe(true);
	});

	it("marks dates beyond the window as 'beyond_window'", () => {
		// now is well before MONDAY; a 1-day window pushes MONDAY out of range
		const longBefore = Date.parse('2025-01-01T12:00:00Z');
		const res = checkAvailability({
			...base,
			nowMs: longBefore,
			bookingWindowDays: 1
		});
		expect(res.slots.every((s) => !s.available)).toBe(true);
		expect(res.slots.every((s) => s.unavailableReason === 'beyond_window')).toBe(true);
	});

	it('echoes the effective bookingWindow back to the caller', () => {
		const res = checkAvailability({
			...base,
			nowMs: NOW_18_LOCAL,
			leadTimeMinutes: 30,
			bookingWindowDays: 45
		});
		expect(res.bookingWindow).toEqual({ leadMinutes: 30, windowDays: 45 });
	});

	it('with no nowMs, the horizon is not enforced', () => {
		const res = checkAvailability({ ...base, leadTimeMinutes: 9999, bookingWindowDays: 1 });
		expect(res.slots.every((s) => s.available)).toBe(true);
	});

	// The live defect: both venues run with `lead_time_minutes` unset (= 0), so the
	// lead branch never fired and every slot earlier in the day stayed on sale. At
	// 19:35 the public dial still offered — and /api/bookings still accepted —
	// "today at 12:00". A slot that has started is gone regardless of policy.
	it('never offers a slot that has already started, even with no lead time', () => {
		const res = checkAvailability({
			...base,
			nowMs: NOW_18_LOCAL, // 18:00 local on the booked date
			leadTimeMinutes: 0,
			bookingWindowDays: 0
		});
		const gone = res.slots.filter((s) => s.time < '18:00');
		expect(gone.length).toBeGreaterThan(0);
		expect(gone.every((s) => !s.available)).toBe(true);
		expect(gone.every((s) => s.unavailableReason === 'too_soon')).toBe(true);
		// …and everything from now on is still on sale.
		expect(res.slots.find((s) => s.time === '18:00')?.available).toBe(true);
		expect(res.slots.find((s) => s.time === '19:00')?.available).toBe(true);
	});

	it('staff (no nowMs) can still be offered an earlier time today', () => {
		const res = checkAvailability({ ...base, leadTimeMinutes: 0, bookingWindowDays: 0 });
		expect(res.slots.find((s) => s.time === '17:00')?.available).toBe(true);
	});
});

// ResDiary "Online Booking Restriction" has TWO anchors for the same number of
// minutes, and they behave completely differently through a service.
describe('checkAvailability — cut-off mode (ResDiary Online Booking Restriction)', () => {
	// DINNER runs 17:00–21:00 local on MONDAY (Europe/London = UTC+1 in June).
	const base = {
		date: MONDAY,
		timezone: TZ,
		periods: [DINNER],
		tables: TABLES,
		joins: JOINS,
		existing: [] as BookingFootprint[],
		partySize: 2,
		bookingWindowDays: 0
	};
	const at = (hhmmZ: string) => Date.parse(`2025-06-02T${hhmmZ}:00Z`);
	const NOON_LOCAL = at('11:00'); // 12:00 London, well before dinner opens

	it("'visit': the cut-off rolls forward with the clock", () => {
		// 18:00 local, 60-minute cut-off → 19:00 is the first bookable slot.
		const res = checkAvailability({
			...base,
			nowMs: at('17:00'),
			leadTimeMinutes: 60,
			leadTimeMode: 'visit'
		});
		expect(res.slots.find((s) => s.time === '18:45')?.available).toBe(false);
		expect(res.slots.find((s) => s.time === '18:45')?.unavailableReason).toBe('too_soon');
		expect(res.slots.find((s) => s.time === '19:00')?.available).toBe(true);
		expect(res.slots.find((s) => s.time === '20:30')?.available).toBe(true);
	});

	it("'service': the whole sitting stays open until the service cut-off, then shuts at once", () => {
		// Dinner opens 17:00 local, 60-minute cut-off → online closes at 16:00 local.
		// At 12:00 local we're well inside it, so EVERY slot is still on sale.
		const open = checkAvailability({
			...base,
			nowMs: NOON_LOCAL,
			leadTimeMinutes: 60,
			leadTimeMode: 'service'
		});
		expect(open.slots.every((s) => s.available)).toBe(true);

		// At 16:30 local the service has closed online — including the 21:00 sitting,
		// which 'visit' mode would happily still sell.
		const shut = checkAvailability({
			...base,
			nowMs: at('15:30'),
			leadTimeMinutes: 60,
			leadTimeMode: 'service'
		});
		expect(shut.slots.every((s) => !s.available)).toBe(true);
		expect(shut.slots.every((s) => s.unavailableReason === 'too_soon')).toBe(true);
	});

	it('the two modes disagree, which is the point of having both', () => {
		const opts = { ...base, nowMs: at('15:30'), leadTimeMinutes: 60 } as const;
		const visit = checkAvailability({ ...opts, leadTimeMode: 'visit' });
		const service = checkAvailability({ ...opts, leadTimeMode: 'service' });
		expect(visit.slots.find((s) => s.time === '21:00')?.available).toBe(true);
		expect(service.slots.find((s) => s.time === '21:00')?.available).toBe(false);
	});

	it('mode is irrelevant when the cut-off is 0 (the ResDiary default)', () => {
		const opts = { ...base, nowMs: NOON_LOCAL, leadTimeMinutes: 0 } as const;
		const visit = checkAvailability({ ...opts, leadTimeMode: 'visit' });
		const service = checkAvailability({ ...opts, leadTimeMode: 'service' });
		expect(visit.slots.every((s) => s.available)).toBe(true);
		expect(service.slots.every((s) => s.available)).toBe(true);
	});

	it('defaults to visit mode when no mode is given (unchanged behaviour)', () => {
		const explicit = checkAvailability({
			...base,
			nowMs: at('17:00'),
			leadTimeMinutes: 60,
			leadTimeMode: 'visit'
		});
		const implicit = checkAvailability({ ...base, nowMs: at('17:00'), leadTimeMinutes: 60 });
		expect(implicit.slots.map((s) => s.available)).toEqual(explicit.slots.map((s) => s.available));
	});
});

// --- pacing / covers caps (WP-AVAIL-1) --------------------------------------

describe('checkAvailability — pacing', () => {
	// Build London-local instants so existing footprints land on real slots.
	const local = (hhmm: string): Date => fromZonedTime(`${MONDAY}T${hhmm}:00`, TZ);

	// Plenty of physical capacity so the ONLY thing limiting a slot is the cap.
	const MANY: DiningTable[] = Array.from({ length: 40 }, (_, i) =>
		table({ id: `b${i}`, seats_min: 1, seats_max: 8 })
	);
	const base = {
		date: MONDAY,
		timezone: TZ,
		periods: [DINNER],
		tables: MANY,
		joins: [] as TableJoin[],
		existing: [] as BookingFootprint[],
		partySize: 4
	};

	it('blocks a slot once its covers cap would be exceeded, leaving the next free', () => {
		const pacing: PacingRule[] = [{ dow: [], maxCoversPerSlot: 10, maxCoversPerPeriod: 0 }];
		// one 8-cover booking already sits in the 19:00 slot
		const existing: BookingFootprint[] = [
			{ tableIds: ['b0'], startsAt: local('19:00'), endsAt: local('21:00'), partySize: 8 }
		];
		const res = checkAvailability({ ...base, pacing, existing, partySize: 4 });
		const at19 = res.slots.find((s) => s.time === '19:00');
		const at1915 = res.slots.find((s) => s.time === '19:15');
		expect(at19?.available).toBe(false); // 8 + 4 > 10
		expect(at19?.unavailableReason).toBe('slot_cap');
		expect(at1915?.available).toBe(true); // next 15-min window is empty
	});

	it('blocks every remaining slot once the per-period cap is reached', () => {
		const pacing: PacingRule[] = [{ dow: [], maxCoversPerSlot: 0, maxCoversPerPeriod: 40 }];
		// 40 covers already booked across the dinner period (5 × 8 in early slots)
		const existing: BookingFootprint[] = [
			{ tableIds: ['b0'], startsAt: local('17:00'), endsAt: local('19:00'), partySize: 8 },
			{ tableIds: ['b1'], startsAt: local('17:15'), endsAt: local('19:15'), partySize: 8 },
			{ tableIds: ['b2'], startsAt: local('17:30'), endsAt: local('19:30'), partySize: 8 },
			{ tableIds: ['b3'], startsAt: local('17:45'), endsAt: local('19:45'), partySize: 8 },
			{ tableIds: ['b4'], startsAt: local('18:00'), endsAt: local('20:00'), partySize: 8 }
		];
		const res = checkAvailability({ ...base, pacing, existing, partySize: 4 });
		// tables are physically free, but the service is at its covers cap
		expect(res.slots.every((s) => !s.available)).toBe(true);
		expect(res.slots.every((s) => s.unavailableReason === 'period_cap')).toBe(true);
	});

	it('caps of 0 reproduce the uncapped behaviour exactly (regression)', () => {
		const pacing: PacingRule[] = [{ dow: [], maxCoversPerSlot: 0, maxCoversPerPeriod: 0 }];
		const res = checkAvailability({ ...base, pacing, partySize: 2, slotIntervalMinutes: 15 });
		expect(res.slots).toHaveLength(17);
		expect(res.slots.every((s) => s.available)).toBe(true);
	});

	it('a physically-full slot reports full, not a cap reason', () => {
		// only ONE table that fits a party of 6, occupy it at 19:00
		const tables: DiningTable[] = [table({ id: 'only6', seats_min: 4, seats_max: 6 })];
		const pacing: PacingRule[] = [{ dow: [], maxCoversPerSlot: 100, maxCoversPerPeriod: 0 }];
		const existing: BookingFootprint[] = [
			{ tableIds: ['only6'], startsAt: local('18:00'), endsAt: local('20:00'), partySize: 6 }
		];
		const res = checkAvailability({
			...base,
			tables,
			pacing,
			existing,
			partySize: 6
		});
		const at19 = res.slots.find((s) => s.time === '19:00');
		expect(at19?.available).toBe(false);
		expect(at19?.unavailableReason).toBe('full'); // table loss takes precedence
	});
});

// --- expandToJoinedSet (mf-join-seat) ---------------------------------------

describe('expandToJoinedSet', () => {
	const allFree = () => true;

	it('returns just the chosen table when it already fits the party', () => {
		// t4 seats 4; a party of 3 fits, so no partner is dragged in.
		expect(expandToJoinedSet('t4', 3, TABLES, JOINS, allFree)).toEqual(['t4']);
	});

	it('expands to a joined partner when the single table is too small', () => {
		// t2a seats 2; a party of 4 needs its join partner t2b (2+2=4).
		const set = expandToJoinedSet('t2a', 4, TABLES, JOINS, allFree);
		expect(new Set(set)).toEqual(new Set(['t2a', 't2b']));
	});

	it('claims the whole combination for a big party (t4+t6 = 10)', () => {
		const set = expandToJoinedSet('t4', 10, TABLES, JOINS, allFree);
		expect(new Set(set)).toEqual(new Set(['t4', 't6']));
	});

	it('does not pull in a partner that is occupied', () => {
		// t2b is taken, so a party of 4 on t2a cannot expand — returns just t2a
		// (the caller validation then rejects "won't fit").
		const isFree = (id: string) => id !== 't2b';
		expect(expandToJoinedSet('t2a', 4, TABLES, JOINS, isFree)).toEqual(['t2a']);
	});

	it('always includes the start table even if it reads as not free', () => {
		// the host explicitly picked it (e.g. it already belongs to the booking).
		const isFree = (id: string) => id !== 't2a';
		const set = expandToJoinedSet('t2a', 4, TABLES, JOINS, isFree);
		expect(set[0]).toBe('t2a');
		expect(new Set(set)).toEqual(new Set(['t2a', 't2b']));
	});

	it('returns the single table unchanged when there are no joins to grow into', () => {
		expect(expandToJoinedSet('t4', 10, TABLES, [], allFree)).toEqual(['t4']);
	});
});

// --- automatic joining policy (which tables the engine may combine) ----------
// Chains say WHICH runs combine; the auto-join policy says whether a table may be
// combined at all. A booth or a counter that can't physically be pushed together
// must never be sold as half of a combination — but it must still take its own
// bookings, and staff must still be able to join it BY HAND.

describe('allocateTables — automatic joining policy', () => {
	const ROOM: DiningTable[] = [
		table({ id: 'a1', seats_min: 1, seats_max: 8, section: 'Front' }),
		table({ id: 'a2', seats_min: 1, seats_max: 8, section: 'Front' }),
		table({ id: 'booth', seats_min: 1, seats_max: 8, section: 'Front' })
	];
	const at = (hhmm: string) => inst(MONDAY, hhmm);

	it('never puts an excluded table into an ad-hoc combination', () => {
		const ids = allocateTables(at('18:00'), 150, 20, ROOM, [], [], undefined, {
			autoJoin: { excluded: ['booth'] }
		});
		// 8+8 can't seat 20 and the booth is off-limits → refuse rather than sell it
		expect(ids).toBeNull();
	});

	it('still books an excluded table on its own', () => {
		const ids = allocateTables(
			at('18:00'),
			150,
			8,
			ROOM,
			[],
			[],
			{ a1: 5, a2: 5, booth: 1 },
			{
				autoJoin: { excluded: ['booth'] }
			}
		);
		expect(ids).toEqual(['booth']); // ranked first, and a single table is never blocked
	});

	it('drops a registered CHAIN whose member is excluded', () => {
		const chains = [{ tableIds: ['a1', 'booth'], capacity: 16 }];
		const ids = allocateTables(at('18:00'), 150, 14, ROOM, [], [], undefined, {
			chains,
			autoJoin: { excluded: ['booth'] }
		});
		expect(ids).not.toContain('booth');
		expect(ids).toEqual(['a1', 'a2']); // falls through to the ad-hoc combination
	});

	it('drops a registered pairwise JOIN whose half is excluded', () => {
		const joins: TableJoin[] = [
			{ id: 'j', created: '', updated: '', restaurant: 'r1', table_a: 'a1', table_b: 'booth' }
		];
		const ids = allocateTables(at('18:00'), 150, 14, ROOM, joins, [], undefined, {
			autoJoin: { excluded: ['booth'], allowAdHoc: false }
		});
		expect(ids).toBeNull();
	});

	it('allowAdHoc:false sells ONLY registered combinations', () => {
		// no chain covers 14 → refuse, even though two free 8-tops physically would
		expect(
			allocateTables(at('18:00'), 150, 14, ROOM, [], [], undefined, {
				autoJoin: { allowAdHoc: false }
			})
		).toBeNull();
		// with a chain registered, the same party is seated
		expect(
			allocateTables(at('18:00'), 150, 14, ROOM, [], [], undefined, {
				chains: [{ tableIds: ['a1', 'a2'], capacity: 16 }],
				autoJoin: { allowAdHoc: false }
			})
		).toEqual(['a1', 'a2']);
	});

	it('an absent policy leaves allocation exactly as it was', () => {
		const withNone = allocateTables(at('18:00'), 150, 20, ROOM, [], []);
		const withEmpty = allocateTables(at('18:00'), 150, 20, ROOM, [], [], undefined, {
			autoJoin: {}
		});
		expect(withEmpty).toEqual(withNone);
		expect(withNone).not.toBeNull();
	});

	it('checkAvailability honours the policy end-to-end', () => {
		const input = {
			date: MONDAY,
			partySize: 20,
			timezone: TZ,
			periods: [period({ name: 'Dinner' })],
			tables: ROOM,
			joins: [],
			existing: []
		};
		expect(checkAvailability(input).slots.some((s) => s.available)).toBe(true);
		const gated = checkAvailability({ ...input, autoJoin: { excluded: ['booth'] } });
		expect(gated.slots.some((s) => s.available)).toBe(false);
	});
});

// --- CHAIN-ONLY tables (Asia's high-sharing counter, 50–54) -------------------
// The owner listed exactly which joins those tables make — 50+51 and 51+52 seat 5,
// 53+54 seats 8, 50+51+52 seats 10, all five seat 20 — and that only STAFF may use
// them. For a staff booking the engine may combine them through those registered
// chains and nothing else: not the neighbour pairs a chain decomposes into (52+53
// was never listed), not a graph-walk run, not an ad-hoc pile-up.

describe('allocateTables — chain-only tables', () => {
	const COUNTER = ['c50', 'c51', 'c52', 'c53', 'c54'];
	const ROOM: DiningTable[] = [
		...COUNTER.map((id) => table({ id, seats_min: 1, seats_max: 2, section: 'Counter' })),
		table({ id: 'b1', seats_min: 1, seats_max: 8, section: 'Front' })
	];
	const CHAINS = [
		{ tableIds: ['c50', 'c51'], capacity: 5 },
		{ tableIds: ['c51', 'c52'], capacity: 5 },
		{ tableIds: ['c53', 'c54'], capacity: 8 },
		{ tableIds: ['c50', 'c51', 'c52'], capacity: 10 },
		{ tableIds: COUNTER, capacity: 20 }
	];
	// What getJoins hands the engine: the chains folded into neighbour pairs.
	const PAIRS: TableJoin[] = [
		['c50', 'c51'],
		['c51', 'c52'],
		['c52', 'c53'],
		['c53', 'c54']
	].map(([a, b]) => ({
		id: `chainpair_${a}|${b}`,
		created: '',
		updated: '',
		restaurant: 'r1',
		table_a: a,
		table_b: b
	}));
	const at = (hhmm: string) => inst(MONDAY, hhmm);
	const busy = (...ids: string[]): BookingFootprint[] =>
		ids.map((id) => ({ tableIds: [id], startsAt: at('17:00'), endsAt: at('23:00') }));
	const STAFF = { chainOnly: COUNTER };

	it('still sells a chain-only table on its own', () => {
		const ids = allocateTables(at('18:00'), 90, 2, ROOM, PAIRS, [], undefined, {
			chains: CHAINS,
			autoJoin: STAFF
		});
		expect(ids).toEqual(['c50']);
	});

	it('combines chain-only tables through a registered chain', () => {
		const ids = allocateTables(at('18:00'), 120, 4, ROOM, PAIRS, busy('b1'), undefined, {
			chains: CHAINS,
			autoJoin: STAFF
		});
		expect(ids).toEqual(['c50', 'c51']);
	});

	it('picks the smallest listed join that holds the party (53+54 for 7)', () => {
		const ids = allocateTables(at('18:00'), 150, 7, ROOM, PAIRS, busy('b1'), undefined, {
			chains: CHAINS,
			autoJoin: STAFF
		});
		expect(ids).toEqual(['c53', 'c54']);
	});

	it('never improvises a pair the owner did not list (52+53)', () => {
		// Every listed join that could seat 3 has a busy member; 52 and 53 are free.
		const existing = busy('b1', 'c50', 'c51', 'c54');
		const opts = { chains: CHAINS };
		// Without the policy the chain-derived pair 52+53 is sold…
		expect(allocateTables(at('18:00'), 105, 3, ROOM, PAIRS, existing, undefined, opts)).toEqual([
			'c52',
			'c53'
		]);
		// …with it, the counter only ever combines as the owner wrote it down.
		expect(
			allocateTables(at('18:00'), 105, 3, ROOM, PAIRS, existing, undefined, {
				...opts,
				autoJoin: STAFF
			})
		).toBeNull();
	});

	it('never puts a chain-only table into an ad-hoc combination', () => {
		// 51 is busy, so no listed join seats 10; the ad-hoc step would reach for the
		// 8-top plus a counter stool.
		const existing = busy('c51');
		const opts = { chains: CHAINS };
		const loose = allocateTables(at('18:00'), 150, 10, ROOM, PAIRS, existing, undefined, opts);
		expect(loose?.some((id) => COUNTER.includes(id))).toBe(true);
		expect(
			allocateTables(at('18:00'), 150, 10, ROOM, PAIRS, existing, undefined, {
				...opts,
				autoJoin: STAFF
			})
		).toBeNull();
	});

	it('an excluded table beats chain-only (a Never table stays unjoined for staff too)', () => {
		const ids = allocateTables(at('18:00'), 120, 4, ROOM, PAIRS, busy('b1'), undefined, {
			chains: CHAINS,
			autoJoin: { chainOnly: COUNTER, excluded: ['c50'] }
		});
		expect(ids).toEqual(['c51', 'c52']);
	});
});

// --- "why is there nothing?" — a shut restaurant vs a full one ---------------
//
// Only a FULL-day closure ever set `closed`. A period-scope blackout and every
// shape of close-out came back looking exactly like a busy night, so the host who
// meant to take a booking on a closed date (createBooking's `allowClosed`) was
// given no way forward — the dead end the owner read as "the manager isn't
// allowed to book when we're closed".

describe('checkAvailability — reports WHICH closure emptied the day', () => {
	const LUNCH = period({
		name: 'Lunch',
		id: 'Lunch',
		start_time: '12:00',
		last_booking_time: '14:00',
		end_time: '15:30'
	});
	const base = {
		date: MONDAY,
		timezone: TZ,
		periods: [LUNCH, DINNER],
		tables: TABLES,
		joins: JOINS,
		existing: [] as BookingFootprint[],
		partySize: 2
	};
	/** Shut the whole restaurant for a service, the way the diary's console does. */
	const shutAll = (periodId: string, over: Partial<ClosureRule> = {}): ClosureRule => ({
		dateFrom: MONDAY,
		dateTo: MONDAY,
		scope: 'section',
		servicePeriodId: periodId,
		section: '*',
		kind: 'holiday',
		reason: 'Christmas Day',
		...over
	});

	it('a whole-restaurant close-out on every service reports closed, not "nothing free"', () => {
		const res = checkAvailability({
			...base,
			closures: [shutAll('Lunch'), shutAll('Dinner')]
		});
		expect(res.closed).toBe(true);
		expect(res.noSlotsReason).toBe('closed');
		expect(res.closureReason).toBe('Christmas Day');
		expect(res.slots).toHaveLength(0);
	});

	it('closing every SECTION individually reads as closed too', () => {
		// The owner's actual habit: shut the room section by section rather than
		// reaching for a full-day closure.
		const res = checkAvailability({
			...base,
			closures: [shutAll('Lunch', { section: 'Main' }), shutAll('Dinner', { section: 'Main' })]
		});
		expect(res.closed).toBe(true);
		expect(res.noSlotsReason).toBe('closed');
	});

	it('period closures on every service report closed, not "no service runs that day"', () => {
		const closed = (id: string): ClosureRule => ({
			dateFrom: MONDAY,
			dateTo: MONDAY,
			scope: 'period',
			servicePeriodId: id,
			kind: 'holiday',
			reason: 'Bank holiday'
		});
		const res = checkAvailability({ ...base, closures: [closed('Lunch'), closed('Dinner')] });
		expect(res.closed).toBe(true);
		expect(res.noSlotsReason).toBe('closed');
		expect(res.closureReason).toBe('Bank holiday');
	});

	it('a FULL restaurant is not reported as a closed one', () => {
		// Every table held all day by real bookings, plus one unrelated table
		// close-out. Nothing is free — but lifting the closure would not help, so
		// this is a full house and must keep saying so.
		const allDay = (id: string): BookingFootprint => ({
			tableIds: [id],
			startsAt: new Date(`${MONDAY}T10:00:00Z`),
			endsAt: new Date(`${MONDAY}T23:00:00Z`)
		});
		const res = checkAvailability({
			...base,
			existing: TABLES.map((t) => allDay(t.id)),
			closures: [shutAll('Lunch', { section: undefined, table: 't4' })]
		});
		expect(res.closed).toBeUndefined();
		expect(res.noSlotsReason).toBeUndefined();
		expect(res.slots.length).toBeGreaterThan(0); // present, just none available
		expect(res.slots.some((s) => s.available)).toBe(false);
	});

	it('a weekday no service runs on still reports no_service, not closed', () => {
		const sundayOnly = period({ name: 'SunOnly', id: 'SunOnly', days_of_week: [0] });
		const res = checkAvailability({
			...base,
			periods: [sundayOnly],
			closures: [shutAll('SunOnly')]
		});
		expect(res.closed).toBeUndefined();
		expect(res.noSlotsReason).toBe('no_service');
	});

	it('one closed section leaves the rest of the room bookable and unflagged', () => {
		const res = checkAvailability({ ...base, closures: [shutAll('Lunch', { section: 'Main' })] });
		expect(res.closed).toBeUndefined();
		expect(res.slots.some((s) => s.available)).toBe(true);
	});
});

// --- the changeover between two services ------------------------------------
//
// Fusion's Lunch shuts at 16:45 and Dinner opens at 17:00, so 16:45–17:00 belongs
// to no service at all. Close the restaurant service by service — which is how the
// console's form works, one block per sitting — and that quarter of an hour stayed
// open: a white stripe through an otherwise solid red board, and a slot the engine
// would still seat. The owner's "gap in close-outs 16:45–17:00".

describe('sectionCloseoutFootprints — bridges the gap between services', () => {
	const LUNCH = period({
		name: 'Lunch',
		id: 'Lunch',
		start_time: '12:00',
		last_booking_time: '16:30',
		end_time: '16:45'
	});
	const DINNER_LATE = period({
		name: 'Dinner',
		id: 'Dinner',
		start_time: '17:00',
		last_booking_time: '21:15',
		end_time: '23:00'
	});
	const PERIODS = [LUNCH, DINNER_LATE];

	/** A whole-restaurant close-out for an explicit clock window, as the diary files it. */
	const shut = (servicePeriodId: string, timeFrom: string, timeTo: string): ClosureRule => ({
		dateFrom: MONDAY,
		dateTo: MONDAY,
		scope: 'section',
		servicePeriodId,
		section: '*',
		timeFrom,
		timeTo,
		kind: 'holiday',
		reason: 'Christmas Day'
	});

	const at = (hhmm: string) => fromZonedTime(`${MONDAY}T${hhmm}:00`, TZ).getTime();
	const shutAt = (closures: ClosureRule[], hhmm: string, tableId = 't4') => {
		const fps = sectionCloseoutFootprints(MONDAY, TZ, PERIODS, TABLES, closures);
		const ms = at(hhmm);
		return fps.some(
			(f) =>
				f.tableIds.includes(tableId) &&
				new Date(f.startsAt).getTime() <= ms &&
				new Date(f.endsAt).getTime() > ms
		);
	};

	it('closes the changeover when both services either side are shut', () => {
		const both = [shut('Lunch', '12:00', '16:45'), shut('Dinner', '17:00', '23:00')];
		expect(shutAt(both, '16:30')).toBe(true); // lunch, as filed
		expect(shutAt(both, '16:50')).toBe(true); // the gap — used to be open
		expect(shutAt(both, '17:30')).toBe(true); // dinner, as filed
	});

	it('leaves the changeover open when only one service is shut', () => {
		const lunchOnly = [shut('Lunch', '12:00', '16:45')];
		expect(shutAt(lunchOnly, '16:30')).toBe(true);
		expect(shutAt(lunchOnly, '16:50')).toBe(false);
		expect(shutAt(lunchOnly, '17:30')).toBe(false);
	});

	it('never spreads outside trading hours, or onto a table that is still open', () => {
		const both = [shut('Lunch', '12:00', '16:45'), shut('Dinner', '17:00', '23:00')];
		expect(shutAt(both, '09:00')).toBe(false); // before the restaurant opens
		// A single-TABLE block either side bridges only that table, never the room.
		const oneTable = [
			{ ...shut('Lunch', '12:00', '16:45'), section: undefined, table: 't4' },
			{ ...shut('Dinner', '17:00', '23:00'), section: undefined, table: 't4' }
		];
		expect(shutAt(oneTable, '16:50', 't4')).toBe(true);
		expect(shutAt(oneTable, '16:50', 't6')).toBe(false);
	});
});

describe('allocateTables — staff-only tables (Asia\u2019s counter)', () => {
	// Asia's counter, 50-54, which the owner keeps for walk-ins and internal
	// seating: "when booking through online on Asia it won't assign people to 50s
	// tables but admins can still make bookings on them as normal".
	const COUNTER = ['c50', 'c51', 'c52', 'c53', 'c54'];
	const ROOM: DiningTable[] = [
		...COUNTER.map((id) => table({ id, seats_min: 1, seats_max: 2, section: 'Counter' })),
		table({ id: 'b1', seats_min: 1, seats_max: 8, section: 'Front' })
	];
	const CHAINS = [{ tableIds: COUNTER, capacity: 20 }];
	const at = (hhmm: string) => inst(MONDAY, hhmm);
	const busy = (...ids: string[]): BookingFootprint[] =>
		ids.map((id) => ({ tableIds: [id], startsAt: at('17:00'), endsAt: at('23:00') }));

	// The real config the owner has already saved on /admin/tables, resolved per channel.
	const CONFIG = { allowAdHoc: true, excluded: [], staffOnly: COUNTER };
	const online = policyFor(CONFIG, 'online');
	const staff = policyFor(CONFIG, 'staff');

	it('ONLINE: a guest is never put on the counter, even when nothing else is free', () => {
		const ids = allocateTables(at('18:00'), 90, 2, ROOM, [], busy('b1'), undefined, {
			autoJoin: online
		});
		expect(ids).toBeNull();
	});

	it('STAFF: the very same booking takes the counter', () => {
		const ids = allocateTables(at('18:00'), 90, 2, ROOM, [], busy('b1'), undefined, {
			autoJoin: staff
		});
		expect(ids).toEqual(['c50']);
	});

	it('ONLINE: a guest large party is never given the counter chain', () => {
		const ids = allocateTables(at('18:00'), 150, 10, ROOM, [], busy('b1'), undefined, {
			autoJoin: online,
			chains: CHAINS
		});
		expect(ids).toBeNull();
	});

	it('STAFF: a host\u2019s large party still gets the counter chain', () => {
		const ids = allocateTables(at('18:00'), 150, 10, ROOM, [], busy('b1'), undefined, {
			autoJoin: staff,
			chains: CHAINS
		});
		expect(ids).toEqual(COUNTER);
	});

	it('ONLINE: the rest of the floor is untouched', () => {
		const ids = allocateTables(at('18:00'), 90, 2, ROOM, [], [], undefined, { autoJoin: online });
		expect(ids).toEqual(['b1']);
	});

	it('a booking already sitting on the counter still holds it against staff', () => {
		const ids = allocateTables(at('18:00'), 90, 2, ROOM, [], busy('b1', 'c50'), undefined, {
			autoJoin: staff
		});
		expect(ids).toEqual(['c51']);
	});
});
