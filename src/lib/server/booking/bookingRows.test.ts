import { describe, it, expect } from 'vitest';
import { shapeBookingRows, bookingRowToCells, BOOKING_DETAIL_HEADERS } from './bookingRows.js';
import type { Booking, Customer } from '../db/types.js';

const TZ = 'Europe/London';

function booking(over: Partial<Booking> & { id: string; starts_at: string }): Booking {
	return {
		created: '2026-07-01T09:00:00Z',
		updated: '',
		restaurant: 'r1',
		customer: 'c1',
		party_size: 2,
		ends_at: over.starts_at,
		tables: [],
		service_period: 'p-dinner',
		status: 'confirmed',
		source: 'online',
		special_requests: '',
		occasion: '',
		...over
	} as Booking;
}

function customer(over: Partial<Customer> = {}): Customer {
	return {
		id: 'c1',
		created: '',
		updated: '',
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		phone: '07000 000000',
		notes: '',
		marketing_consent: false,
		...over
	} as Customer;
}

const periodNames = new Map([['p-dinner', 'Dinner']]);
const tableLabels = new Map([
	['t1', 'T4'],
	['t2', 'T5']
]);

const shape = (bookings: Parameters<typeof shapeBookingRows>[0]['bookings']) =>
	shapeBookingRows({ timezone: TZ, bookings, periodNames, tableLabels });

describe('shapeBookingRows', () => {
	it('resolves guest, service, tables and duration', () => {
		const [row] = shape([
			{
				...booking({
					id: 'b1',
					starts_at: '2026-07-15T18:00:00Z',
					ends_at: '2026-07-15T20:00:00Z',
					tables: ['t1', 't2'],
					party_size: 4
				}),
				expand: { customer: customer() }
			}
		]);

		expect(row.guest).toBe('Ada Lovelace');
		expect(row.email).toBe('ada@example.com');
		expect(row.service).toBe('Dinner');
		expect(row.tables).toBe('T4 + T5');
		expect(row.covers).toBe(4);
		expect(row.durationMinutes).toBe(120);
		// 18:00 UTC is 19:00 in London in July — the report is wall-clock.
		expect(row.time).toBe('19:00');
		expect(row.date).toBe('2026-07-15');
	});

	it("prefers the booking's own guest snapshot over the shared customer record", () => {
		const [row] = shape([
			{
				...booking({
					id: 'b1',
					starts_at: '2026-07-15T18:00:00Z',
					guest_name: 'Grace Hopper',
					guest_phone: '07111 111111'
				}),
				expand: { customer: customer() }
			}
		]);

		expect(row.guest).toBe('Grace Hopper');
		expect(row.phone).toBe('07111 111111');
		// The email still comes from the customer record — bookings carry no snapshot of it.
		expect(row.email).toBe('ada@example.com');
	});

	// REGRESSION: dietary_flags is an AllergyFlags payload
	// ({allergies, dietary, hasAllergy, summary, source}), NOT a boolean map. A
	// generic "keep the truthy keys" walk emitted the literal string
	// "allergies; dietary; source" on every row, which reads as real guest data.
	it('labels the allergen/dietary arrays and never leaks the payload keys', () => {
		const [row] = shape([
			{
				...booking({
					id: 'b1',
					starts_at: '2026-07-15T18:00:00Z',
					dietary_flags: {
						allergies: ['nuts', 'shellfish'],
						dietary: ['vegan'],
						hasAllergy: true,
						summary: 'Nuts, Shellfish',
						source: 'keyword'
					}
				}),
				expand: { customer: customer() }
			}
		]);

		expect(row.allergies).toBe('Nuts; Shellfish');
		expect(row.dietary).toBe('Vegan');
		expect(row.dietary).not.toContain('source');
		expect(row.allergies).not.toContain('hasAllergy');
	});

	it("merges the guest's own allergies and dietary record, de-duplicated", () => {
		const [row] = shape([
			{
				...booking({
					id: 'b1',
					starts_at: '2026-07-15T18:00:00Z',
					dietary_flags: { allergies: ['nuts'], dietary: [], hasAllergy: true }
				}),
				expand: {
					customer: customer({
						allergies: 'Severe nut allergy',
						dietary: ['vegetarian', 'other:no coriander']
					})
				}
			}
		]);

		expect(row.allergies).toBe('Nuts; Severe nut allergy');
		expect(row.dietary).toBe('Vegetarian; no coriander');
	});

	it('gives a walk-in no lead time, and keeps a real one for a booked cover', () => {
		const rows = shape([
			{
				...booking({
					id: 'walkin',
					starts_at: '2026-07-15T18:00:00Z',
					created: '2026-07-15T18:05:00Z',
					source: 'walkin'
				})
			},
			{
				...booking({
					id: 'booked',
					starts_at: '2026-07-15T18:00:00Z',
					created: '2026-07-01T09:00:00Z',
					source: 'online'
				})
			}
		]);

		const walkin = rows.find((r) => r.reference === 'walkin')!;
		const booked = rows.find((r) => r.reference === 'booked')!;
		expect(walkin.leadTimeDays).toBe('');
		expect(booked.leadTimeDays).toBe(14);
	});

	it('sorts chronologically and flattens free text to a single line', () => {
		const rows = shape([
			booking({
				id: 'later',
				starts_at: '2026-07-16T18:00:00Z',
				special_requests: '<p>Window seat</p>\n<p>Quiet please</p>'
			}),
			booking({ id: 'earlier', starts_at: '2026-07-15T18:00:00Z' })
		]);

		expect(rows.map((r) => r.reference)).toEqual(['earlier', 'later']);
		expect(rows[1].specialRequests).toBe('Window seat Quiet please');
	});

	it('keeps the cell order aligned with the headers', () => {
		const [row] = shape([booking({ id: 'b1', starts_at: '2026-07-15T18:00:00Z' })]);
		expect(bookingRowToCells(row)).toHaveLength(BOOKING_DETAIL_HEADERS.length);
	});
});
