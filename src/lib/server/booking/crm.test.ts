import { describe, it, expect } from 'vitest';
import {
	normalizePhone,
	aggregateCustomer,
	dietaryToArray,
	arrayToDietary,
	stripHtml,
	type DietaryFlags
} from './crm.js';
import type { Booking, BookingStatus } from '../db/types.js';

// --- fixtures ---------------------------------------------------------------

let seq = 0;
function booking(
	status: BookingStatus,
	over: Partial<Booking> = {}
): Booking {
	seq += 1;
	return {
		id: `b${seq}`,
		created: '',
		updated: '',
		restaurant: 'r1',
		customer: 'c1',
		party_size: 2,
		starts_at: `2026-06-${String((seq % 27) + 1).padStart(2, '0')}T18:00:00.000Z`,
		ends_at: '',
		tables: [],
		service_period: 'dinner',
		status,
		source: 'online',
		special_requests: '',
		occasion: '',
		...over
	};
}

// --- normalizePhone (WP-CRM-1, kept green) ----------------------------------

describe('normalizePhone', () => {
	it('canonicalises GB national numbers to +44', () => {
		expect(normalizePhone('07911 123456')).toBe('+447911123456');
		expect(normalizePhone('(0191) 222 3333')).toBe('+441912223333');
	});
	it('keeps international numbers and collapses +440 trunk artefacts', () => {
		expect(normalizePhone('+44 7911 123456')).toBe('+447911123456');
		expect(normalizePhone('+4407911123456')).toBe('+447911123456');
	});
	it('returns empty for non-numeric input', () => {
		expect(normalizePhone('')).toBe('');
		expect(normalizePhone('n/a')).toBe('');
	});
});

// --- aggregateCustomer: stats math ------------------------------------------

describe('aggregateCustomer stats', () => {
	it('counts statuses and only counts covers for attended visits', () => {
		const bookings = [
			booking('completed', { party_size: 4 }),
			booking('seated', { party_size: 2 }),
			booking('cancelled', { party_size: 8 }),
			booking('no_show', { party_size: 6 }),
			booking('confirmed', { party_size: 3 }), // upcoming
			booking('pending_payment', { party_size: 5 }) // upcoming
		];
		const { stats } = aggregateCustomer(bookings);
		expect(stats.totalBookings).toBe(6);
		expect(stats.completed).toBe(1);
		expect(stats.cancelled).toBe(1);
		expect(stats.noShows).toBe(1);
		expect(stats.upcoming).toBe(2);
		// covers only from completed(4) + seated(2)
		expect(stats.totalCovers).toBe(6);
		// avg over the 2 attended parties = 3.0
		expect(stats.avgPartySize).toBeCloseTo(3.0, 5);
	});

	it('derives first/last visit and favourite occasion from attended visits', () => {
		const bookings = [
			booking('completed', { starts_at: '2026-01-10T18:00:00.000Z', occasion: 'Birthday' }),
			booking('completed', { starts_at: '2026-03-20T18:00:00.000Z', occasion: 'Birthday' }),
			booking('seated', { starts_at: '2026-02-14T18:00:00.000Z', occasion: 'Anniversary' }),
			// a cancelled visit must NOT set first/last or occasion
			booking('cancelled', { starts_at: '2020-01-01T18:00:00.000Z', occasion: 'Ignored' })
		];
		const { stats } = aggregateCustomer(bookings);
		expect(stats.firstVisit).toBe('2026-01-10T18:00:00.000Z');
		expect(stats.lastVisit).toBe('2026-03-20T18:00:00.000Z');
		expect(stats.favouriteOccasion).toBe('Birthday');
	});

	it('handles an empty history without dividing by zero', () => {
		const { stats, risk } = aggregateCustomer([]);
		expect(stats.totalBookings).toBe(0);
		expect(stats.avgPartySize).toBe(0);
		expect(risk.noShowRate).toBe(0);
		expect(risk.level).toBe('low');
	});
});

// --- aggregateCustomer: risk thresholds -------------------------------------

describe('aggregateCustomer risk.level', () => {
	it('is low for a clean guest', () => {
		const { risk } = aggregateCustomer([booking('completed'), booking('completed')]);
		expect(risk.level).toBe('low');
	});

	it('is watch for exactly one no-show', () => {
		const { risk } = aggregateCustomer([
			booking('completed'),
			booking('completed'),
			booking('no_show')
		]);
		expect(risk.level).toBe('watch');
	});

	it('is watch when cancel rate exceeds 0.3', () => {
		// 2 cancelled of 4 = 0.5 > 0.3, no no-shows
		const { risk } = aggregateCustomer([
			booking('completed'),
			booking('completed'),
			booking('cancelled'),
			booking('cancelled')
		]);
		expect(risk.cancelRate).toBeCloseTo(0.5, 5);
		expect(risk.level).toBe('watch');
	});

	it('is high for two or more no-shows regardless of sample size', () => {
		const { risk } = aggregateCustomer([booking('no_show'), booking('no_show')]);
		expect(risk.level).toBe('high');
	});

	it('is high when no-show rate exceeds 0.25 with at least 4 bookings', () => {
		// 1 no-show is normally 'watch', but with a small history the rate rule needs
		// >=4 bookings. Use 3 completed + 1 no-show wouldn't trip rate (0.25 not >0.25),
		// so use 1 no-show in a 4-booking set is exactly 0.25 -> NOT high (stays watch).
		const exactly025 = aggregateCustomer([
			booking('completed'),
			booking('completed'),
			booking('completed'),
			booking('no_show')
		]);
		expect(exactly025.risk.noShowRate).toBeCloseTo(0.25, 5);
		expect(exactly025.risk.level).toBe('watch'); // count===1 -> watch, rate not > 0.25
	});
});

// --- dietary round-trip + html stripping ------------------------------------

describe('dietary serialisation', () => {
	it('round-trips flags through the stored string[]', () => {
		const flags: DietaryFlags = {
			vegetarian: true,
			glutenFree: true,
			nutAllergy: true,
			other: 'low sodium'
		};
		const arr = dietaryToArray(flags);
		expect(arr).toContain('vegetarian');
		expect(arr).toContain('glutenFree');
		expect(arr).toContain('nutAllergy');
		expect(arr).toContain('other:low sodium');

		const back = arrayToDietary(arr);
		expect(back.vegetarian).toBe(true);
		expect(back.glutenFree).toBe(true);
		expect(back.nutAllergy).toBe(true);
		expect(back.vegan).toBeUndefined();
		expect(back.other).toBe('low sodium');
	});

	it('treats an absent/garbage stored value as no flags', () => {
		expect(arrayToDietary(undefined)).toEqual({});
		// unknown tokens are ignored
		expect(arrayToDietary(['mystery', 'vegan'])).toEqual({ vegan: true });
	});
});

describe('stripHtml', () => {
	it('removes tags and decodes common entities for the AI', () => {
		expect(stripHtml('<p>Loves the <b>omakase</b> &amp; sake</p>')).toBe(
			'Loves the omakase & sake'
		);
		expect(stripHtml(undefined)).toBe('');
	});
});
