import { describe, it, expect } from 'vitest';
import {
	sortRows,
	filterRows,
	sectionsFor,
	csvCell,
	csvFromRows,
	coversPerSlot,
	summariseRows
} from './runningOrder';
import type { RunningOrderRow } from './runningOrder';

const row = (over: Partial<RunningOrderRow>): RunningOrderRow => ({
	time: '19:00',
	ends: '21:00',
	startMs: 0,
	partySize: 2,
	guest: 'Guest',
	tableLabels: ['1'],
	section: 'Front',
	period: 'Dinner',
	channel: 'Online',
	walkin: false,
	phone: '',
	status: 'confirmed',
	occasion: '',
	preorder: '',
	allergies: [],
	dietary: [],
	...over
});

const rows: RunningOrderRow[] = [
	row({ guest: 'Charlie', startMs: 300, partySize: 6, section: 'Bar', period: 'Lunch', status: 'seated' }),
	row({ guest: 'Alice', startMs: 100, partySize: 2, section: 'Front', period: 'Dinner', status: 'confirmed' }),
	row({ guest: 'Bob', startMs: 200, partySize: 4, section: 'Front', period: 'Dinner', status: 'pending_payment' })
];

describe('sortRows', () => {
	it('sorts by time (startMs) ascending by default', () => {
		expect(sortRows(rows, 'time').map((r) => r.guest)).toEqual(['Alice', 'Bob', 'Charlie']);
	});
	it('sorts by guest name', () => {
		expect(sortRows(rows, 'guest').map((r) => r.guest)).toEqual(['Alice', 'Bob', 'Charlie']);
	});
	it('sorts by party size', () => {
		expect(sortRows(rows, 'partySize').map((r) => r.partySize)).toEqual([2, 4, 6]);
	});
	it('respects the direction flag', () => {
		expect(sortRows(rows, 'partySize', -1).map((r) => r.partySize)).toEqual([6, 4, 2]);
	});
	it('is stable on ties (falls back to time)', () => {
		const tie = [row({ guest: 'Z', startMs: 50, status: 'confirmed' }), row({ guest: 'Y', startMs: 10, status: 'confirmed' })];
		expect(sortRows(tie, 'status').map((r) => r.guest)).toEqual(['Y', 'Z']);
	});
});

describe('filterRows', () => {
	it('filters by service period', () => {
		expect(filterRows(rows, 'Dinner').map((r) => r.guest).sort()).toEqual(['Alice', 'Bob']);
	});
	it('filters by section', () => {
		expect(filterRows(rows, '', 'Bar').map((r) => r.guest)).toEqual(['Charlie']);
	});
	it('combines period + section', () => {
		expect(filterRows(rows, 'Dinner', 'Front')).toHaveLength(2);
		expect(filterRows(rows, 'Lunch', 'Front')).toHaveLength(0);
	});
	it('no filters returns everything', () => {
		expect(filterRows(rows)).toHaveLength(3);
	});
});

describe('sectionsFor', () => {
	it('lists every area when no service is chosen', () => {
		expect(sectionsFor(rows)).toEqual(['Bar', 'Front']);
	});

	it('narrows to the areas the chosen service actually uses', () => {
		expect(sectionsFor(rows, 'Dinner')).toEqual(['Front']);
		expect(sectionsFor(rows, 'Lunch')).toEqual(['Bar']);
	});

	// The pair the run-sheet used to let the operator build: pick Lunch + Bar, then
	// switch to Dinner and the area came along, emptying a fully-booked service.
	it('excludes the area that would make the pair match nothing', () => {
		expect(filterRows(rows, 'Dinner', 'Bar')).toHaveLength(0);
		expect(sectionsFor(rows, 'Dinner')).not.toContain('Bar');
	});

	it('skips rows with no area and dedupes', () => {
		const mixed = [row({ section: '' }), row({ section: 'Front' }), row({ section: 'Front' })];
		expect(sectionsFor(mixed)).toEqual(['Front']);
	});
});

describe('csvCell', () => {
	it('quotes values with commas, quotes or newlines', () => {
		expect(csvCell('plain')).toBe('plain');
		expect(csvCell('a,b')).toBe('"a,b"');
		expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
		expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
	});
});

describe('csvFromRows', () => {
	it('emits a header row + one line per booking with CRLF', () => {
		const csv = csvFromRows([
			row({ guest: 'Alice, VIP', tableLabels: ['3', '4'], allergies: ['NUTS'], partySize: 5 })
		]);
		const lines = csv.split('\r\n');
		expect(lines[0]).toContain('Time');
		expect(lines[0]).toContain('Allergies');
		expect(lines[1]).toContain('"Alice, VIP"'); // comma forces quoting
		expect(lines[1]).toContain('3 + 4'); // tables joined
		expect(lines[1]).toContain('NUTS');
		expect(lines).toHaveLength(2);
	});
});

describe('coversPerSlot', () => {
	it('aggregates bookings + covers per time slot, time-ordered', () => {
		const slots = coversPerSlot([
			row({ time: '19:00', partySize: 2 }),
			row({ time: '19:00', partySize: 4 }),
			row({ time: '18:30', partySize: 6 }),
			row({ time: '20:00', partySize: 3 })
		]);
		expect(slots.map((s) => s.time)).toEqual(['18:30', '19:00', '20:00']);
		const at19 = slots.find((s) => s.time === '19:00')!;
		expect(at19.bookings).toBe(2);
		expect(at19.covers).toBe(6);
		const at1830 = slots.find((s) => s.time === '18:30')!;
		expect(at1830.bookings).toBe(1);
		expect(at1830.covers).toBe(6);
	});
	it('is empty for no rows', () => {
		expect(coversPerSlot([])).toEqual([]);
	});
});

describe('summariseRows', () => {
	// The owner's 31 Jul case: a lunch service that walked in 14 covers and a dinner
	// that walked in 10. Picking a service on the run-sheet has to move these numbers.
	const day = [
		row({ period: 'Lunch', walkin: true, partySize: 1 }),
		row({ period: 'Lunch', walkin: true, partySize: 2 }),
		row({ period: 'Lunch', walkin: true, partySize: 4 }),
		row({ period: 'Lunch', walkin: true, partySize: 2 }),
		row({ period: 'Lunch', walkin: true, partySize: 2 }),
		row({ period: 'Lunch', walkin: true, partySize: 3 }),
		row({ period: 'Dinner', walkin: true, partySize: 2 }),
		row({ period: 'Dinner', walkin: true, partySize: 2 }),
		row({ period: 'Dinner', walkin: true, partySize: 2 }),
		row({ period: 'Dinner', walkin: true, partySize: 2 }),
		row({ period: 'Dinner', walkin: true, partySize: 2 }),
		row({ period: 'Dinner', walkin: false, partySize: 20 })
	];

	it('totals bookings and covers', () => {
		const s = summariseRows(day);
		expect(s.bookings).toBe(12);
		expect(s.covers).toBe(44);
	});

	it('splits reservations from walk-ins without double-counting', () => {
		const s = summariseRows(day);
		expect(s.walkins).toBe(11);
		expect(s.walkinCovers).toBe(24);
		expect(s.reservations).toBe(1);
		expect(s.reservationCovers).toBe(20);
		expect(s.reservations + s.walkins).toBe(s.bookings);
		expect(s.reservationCovers + s.walkinCovers).toBe(s.covers);
	});

	it('follows the service filter — the bug the owner hit', () => {
		expect(summariseRows(filterRows(day, 'Lunch')).walkinCovers).toBe(14);
		expect(summariseRows(filterRows(day, 'Dinner')).walkinCovers).toBe(10);
	});

	it('counts allergy alerts and VIPs', () => {
		const s = summariseRows([
			row({ allergies: ['NUTS'], hasAllergy: true, vip: true }),
			row({ allergies: [], vip: true }),
			row({ allergies: [] })
		]);
		expect(s.allergyAlerts).toBe(1);
		expect(s.vips).toBe(2);
	});

	it('falls back to the allergy list when hasAllergy is absent', () => {
		expect(summariseRows([row({ allergies: ['SHELLFISH'] })]).allergyAlerts).toBe(1);
	});

	it('is all zeroes for no rows', () => {
		const s = summariseRows([]);
		expect(s).toEqual({
			bookings: 0,
			covers: 0,
			reservations: 0,
			reservationCovers: 0,
			walkins: 0,
			walkinCovers: 0,
			allergyAlerts: 0,
			vips: 0
		});
	});
});
