import { describe, it, expect } from 'vitest';
import {
	bucketCovers,
	bucketNoShows,
	isWalkinBooking,
	localDate,
	rangeDays,
	toCsv,
	type CoversReport
} from './reporting.js';
import type { Booking } from '../db/types.js';

const TZ = 'Europe/London';

// --- fixtures ---------------------------------------------------------------

function booking(over: Partial<Booking> & { id: string; starts_at: string }): Booking {
	return {
		created: '',
		updated: '',
		restaurant: 'r1',
		customer: 'c1',
		party_size: 2,
		ends_at: over.starts_at,
		tables: [],
		service_period: 'dinner',
		status: 'confirmed',
		source: 'online',
		special_requests: '',
		occasion: '',
		...over
	};
}

const PERIODS = new Map([
	['lunch', 'Lunch'],
	['dinner', 'Dinner']
]);

function report(bookings: Booking[], capacity = 100): CoversReport {
	return bucketCovers({
		brand: 'asia',
		from: '2026-06-01',
		to: '2026-06-30',
		timezone: TZ,
		capacity,
		bookings,
		periodNames: PERIODS
	});
}

// --- date helpers -----------------------------------------------------------

describe('localDate (timezone bucketing)', () => {
	it('buckets a UTC instant into the local London date', () => {
		// 22:30 UTC in summer (BST = UTC+1) is 23:30 local — same calendar day.
		expect(localDate(new Date('2026-06-15T22:30:00.000Z'), TZ)).toBe('2026-06-15');
		// 23:30 UTC is 00:30 next-day local in summer — rolls to the 16th.
		expect(localDate(new Date('2026-06-15T23:30:00.000Z'), TZ)).toBe('2026-06-16');
	});

	it('buckets correctly across the DST boundary', () => {
		// Clocks go BACK on 2026-10-25 02:00 BST -> 01:00 GMT. An 00:30 UTC instant
		// is 01:30 BST (still the 25th) — must land on 2026-10-25, not the server's
		// zone. 23:30 UTC the night before is 00:30 BST of the 25th.
		expect(localDate(new Date('2026-10-24T23:30:00.000Z'), TZ)).toBe('2026-10-25');
		// Clocks go FORWARD on 2026-03-29 01:00 GMT -> 02:00 BST. 00:30 UTC is still
		// 00:30 GMT (the 29th); 23:30 UTC is 00:30 BST of the 30th.
		expect(localDate(new Date('2026-03-29T23:30:00.000Z'), TZ)).toBe('2026-03-30');
	});
});

describe('isWalkinBooking', () => {
	it('reads the source the diary writes', () => {
		expect(isWalkinBooking({ source: 'walkin' })).toBe(true);
		expect(isWalkinBooking({ source: 'phone' })).toBe(false);
		expect(isWalkinBooking({ source: 'online' })).toBe(false);
	});
	it('also reads a channel label, so an import counts once too', () => {
		expect(isWalkinBooking({ source: 'phone', channel: 'Walk-in' })).toBe(true);
		expect(isWalkinBooking({ source: 'phone', channel: '  walkin ' })).toBe(true);
		expect(isWalkinBooking({ source: 'phone', channel: 'Phone' })).toBe(false);
	});
	it('is false for a booking carrying neither signal', () => {
		expect(isWalkinBooking({})).toBe(false);
		expect(isWalkinBooking({ source: null, channel: null })).toBe(false);
	});

	// A host who opens the ordinary Book form and types "Walk In" as the guest gets
	// source:'phone' — no walk-in signal but the name. The run-sheet listed two such
	// parties and the header said "1 walk-in (2)".
	it.each(['Walk In', 'Walk-in', 'walkin', '  WALK IN  '])(
		'counts a party filed under the placeholder guest %j',
		(name) => {
			expect(isWalkinBooking({ source: 'phone', expand: { customer: { name } } })).toBe(true);
		}
	);

	// Real guests on this book. A substring test would seat all of them off the street.
	it.each(['Alice Walk', 'Jodi Walker', 'bruce walker', 'Walk In Party of 6'])(
		'does NOT match the real guest %j',
		(name) => {
			expect(isWalkinBooking({ source: 'phone', expand: { customer: { name } } })).toBe(false);
		}
	);

	it('tolerates a missing or unexpanded guest', () => {
		expect(isWalkinBooking({ source: 'phone', expand: null })).toBe(false);
		expect(isWalkinBooking({ source: 'phone', expand: { customer: null } })).toBe(false);
		expect(isWalkinBooking({ source: 'phone', expand: { customer: {} } })).toBe(false);
		// …and the one-tap seat still counts even with no guest expanded at all.
		expect(isWalkinBooking({ source: 'walkin' })).toBe(true);
	});
});

describe('rangeDays', () => {
	it('is inclusive of both ends', () => {
		expect(rangeDays('2026-06-01', '2026-06-01')).toBe(1);
		expect(rangeDays('2026-06-01', '2026-06-30')).toBe(30);
	});
	it('counts whole days across a DST change without drift', () => {
		// 2026 Oct has a 25-hour day; the inclusive count must still be 31.
		expect(rangeDays('2026-10-01', '2026-10-31')).toBe(31);
	});
});

// --- aggregation ------------------------------------------------------------

describe('bucketCovers', () => {
	it('sums covers as party_size over counted statuses only', () => {
		const r = report([
			booking({ id: 'b1', starts_at: '2026-06-10T18:00:00.000Z', party_size: 2 }),
			booking({ id: 'b2', starts_at: '2026-06-10T19:00:00.000Z', party_size: 4, status: 'completed' }),
			booking({ id: 'b3', starts_at: '2026-06-10T20:00:00.000Z', party_size: 3, status: 'seated' }),
			// excluded from covers, tracked separately:
			booking({ id: 'b4', starts_at: '2026-06-10T20:00:00.000Z', party_size: 6, status: 'cancelled' }),
			booking({ id: 'b5', starts_at: '2026-06-10T20:00:00.000Z', party_size: 5, status: 'no_show' })
		]);
		expect(r.totals.covers).toBe(2 + 4 + 3);
		expect(r.totals.bookings).toBe(3);
		expect(r.totals.cancelled).toBe(1);
		expect(r.totals.noShows).toBe(1);
		expect(r.totals.avgPartySize).toBeCloseTo(9 / 3, 5);
	});

	it('per-period covers sum to the day total', () => {
		const r = report([
			booking({ id: 'b1', starts_at: '2026-06-11T12:30:00.000Z', party_size: 2, service_period: 'lunch' }),
			booking({ id: 'b2', starts_at: '2026-06-11T18:30:00.000Z', party_size: 4, service_period: 'dinner' }),
			booking({ id: 'b3', starts_at: '2026-06-11T19:30:00.000Z', party_size: 3, service_period: 'dinner' })
		]);
		const dayTotal = r.byDay.find((d) => d.date === '2026-06-11')?.covers ?? 0;
		const periodSum = r.byPeriod.reduce((s, p) => s + p.covers, 0);
		expect(dayTotal).toBe(9);
		expect(periodSum).toBe(9);
		expect(r.byPeriod.find((p) => p.periodId === 'dinner')?.periodName).toBe('Dinner');
	});

	it('utilisation is clamped to 0..1 and uses the seat capacity', () => {
		const r = report(
			[
				// 12 covers seated in one period vs a capacity of 10 -> clamped to 1.0
				booking({ id: 'b1', starts_at: '2026-06-12T18:00:00.000Z', party_size: 8 }),
				booking({ id: 'b2', starts_at: '2026-06-12T18:00:00.000Z', party_size: 4 })
			],
			10
		);
		const o = r.occupancy.find((x) => x.date === '2026-06-12' && x.periodId === 'dinner');
		expect(o?.coversSeated).toBe(12);
		expect(o?.capacity).toBe(10);
		expect(o?.utilisation).toBe(1);
		expect(o?.utilisation).toBeGreaterThanOrEqual(0);
		expect(o?.utilisation).toBeLessThanOrEqual(1);
	});

	it('zero capacity yields 0 utilisation, never a divide-by-zero', () => {
		const r = report([booking({ id: 'b1', starts_at: '2026-06-13T18:00:00.000Z', party_size: 4 })], 0);
		expect(r.occupancy[0].utilisation).toBe(0);
	});

	it('aggregates a large (>200 row) fixture fully', () => {
		const many: Booking[] = [];
		for (let i = 0; i < 250; i++) {
			const day = String((i % 28) + 1).padStart(2, '0');
			many.push(
				booking({ id: `b${i}`, starts_at: `2026-06-${day}T18:00:00.000Z`, party_size: 2 })
			);
		}
		const r = report(many);
		expect(r.totals.bookings).toBe(250);
		expect(r.totals.covers).toBe(500);
	});

	it('buckets a DST-crossing booking into the correct local date', () => {
		// 23:30 UTC on 24 Oct is 00:30 BST of the 25th (clocks fall back 02:00).
		const r = bucketCovers({
			brand: 'asia',
			from: '2026-10-24',
			to: '2026-10-26',
			timezone: TZ,
			capacity: 50,
			bookings: [booking({ id: 'b1', starts_at: '2026-10-24T23:30:00.000Z', party_size: 4 })],
			periodNames: PERIODS
		});
		expect(r.byDay.map((d) => d.date)).toEqual(['2026-10-25']);
		expect(r.byDay[0].covers).toBe(4);
	});
});

// --- no-show report (WP-CRM-6) ---------------------------------------------

function noshow(bookings: Booking[]) {
	return bucketNoShows({
		brand: 'asia',
		from: '2026-06-01',
		to: '2026-06-30',
		timezone: TZ,
		bookings
	});
}

describe('bucketNoShows', () => {
	it('rates over resolved bookings only (live/future excluded)', () => {
		const r = noshow([
			booking({ id: 'b1', starts_at: '2026-06-10T18:00:00.000Z', status: 'completed' }),
			booking({ id: 'b2', starts_at: '2026-06-10T18:00:00.000Z', status: 'seated' }),
			booking({ id: 'b3', starts_at: '2026-06-10T18:00:00.000Z', status: 'no_show' }),
			booking({ id: 'b4', starts_at: '2026-06-10T18:00:00.000Z', status: 'cancelled' }),
			// excluded from the denominator:
			booking({ id: 'b5', starts_at: '2026-06-10T18:00:00.000Z', status: 'confirmed' }),
			booking({ id: 'b6', starts_at: '2026-06-10T18:00:00.000Z', status: 'pending_payment' })
		]);
		expect(r.totals.resolved).toBe(4);
		expect(r.totals.honoured).toBe(2);
		expect(r.totals.noShows).toBe(1);
		expect(r.totals.cancelled).toBe(1);
		expect(r.totals.noShowRate).toBeCloseTo(0.25, 5);
		expect(r.totals.cancelRate).toBeCloseTo(0.25, 5);
	});

	it('breaks no-shows down by channel and folds unknown sources', () => {
		const r = noshow([
			booking({ id: 'b1', starts_at: '2026-06-11T18:00:00.000Z', status: 'no_show', source: 'online' }),
			booking({ id: 'b2', starts_at: '2026-06-11T18:00:00.000Z', status: 'completed', source: 'online' }),
			booking({ id: 'b3', starts_at: '2026-06-11T18:00:00.000Z', status: 'no_show', source: 'phone' }),
			// empty source folds into the 'unknown' channel
			booking({ id: 'b4', starts_at: '2026-06-11T18:00:00.000Z', status: 'completed', source: '' })
		]);
		const online = r.byChannel.find((c) => c.source === 'online');
		const phone = r.byChannel.find((c) => c.source === 'phone');
		const unknown = r.byChannel.find((c) => c.source === 'unknown');
		expect(online?.resolved).toBe(2);
		expect(online?.noShows).toBe(1);
		expect(online?.noShowRate).toBeCloseTo(0.5, 5);
		expect(phone?.noShows).toBe(1);
		expect(unknown?.label).toBe('Unknown');
		expect(unknown?.noShows).toBe(0);
		// channel resolved counts sum to the total
		expect(r.byChannel.reduce((s, c) => s + c.resolved, 0)).toBe(r.totals.resolved);
	});

	it('buckets per day and is empty with no resolved bookings', () => {
		const r = noshow([
			booking({ id: 'b1', starts_at: '2026-06-12T18:00:00.000Z', status: 'no_show' }),
			booking({ id: 'b2', starts_at: '2026-06-13T18:00:00.000Z', status: 'completed' })
		]);
		expect(r.byDay.map((d) => d.date)).toEqual(['2026-06-12', '2026-06-13']);
		expect(r.byDay[0].noShowRate).toBe(1);
		expect(r.byDay[1].noShowRate).toBe(0);

		const none = noshow([
			booking({ id: 'b9', starts_at: '2026-06-14T18:00:00.000Z', status: 'confirmed' })
		]);
		expect(none.totals.resolved).toBe(0);
		expect(none.totals.noShowRate).toBe(0);
		expect(none.byChannel).toEqual([]);
		expect(none.byDay).toEqual([]);
	});
});

// --- CSV --------------------------------------------------------------------

describe('toCsv', () => {
	it('quotes fields, escapes embedded quotes, and prepends a BOM', () => {
		const csv = toCsv(['name', 'covers'], [['Ann "A"', 4]]);
		expect(csv.startsWith('﻿')).toBe(true);
		expect(csv).toContain('"Ann ""A""","4"');
		expect(csv.endsWith('\r\n')).toBe(true);
	});
	it('keeps commas and newlines inside a single field', () => {
		const csv = toCsv(['a'], [['x,y\nz']]);
		// The field is quoted so the comma/newline are payload, not structure.
		expect(csv).toContain('"x,y\nz"');
	});
});
