// Which service a slot belongs to — needed so the booking widget can show the
// deposit a period-scoped rule would take, BEFORE the guest types their details.
// Mirrors the window test createBooking applies.

import { describe, it, expect } from 'vitest';
import { periodForSlot } from './slotDeposit.js';
import type { ServicePeriod } from '../db/types.js';

function period(p: Partial<ServicePeriod>): ServicePeriod {
	return {
		id: 'x',
		collectionId: '',
		collectionName: '',
		created: '',
		updated: '',
		restaurant: 'r1',
		name: '',
		days_of_week: [0, 1, 2, 3, 4, 5, 6],
		start_time: '12:00',
		end_time: '22:00',
		last_booking_time: '21:15',
		default_turn_minutes: 90,
		active: true,
		...p
	} as ServicePeriod;
}

describe('periodForSlot', () => {
	const lunch = period({ id: 'lunch', start_time: '12:00', last_booking_time: '16:30' });
	const dinner = period({ id: 'dinner', start_time: '17:00', last_booking_time: '21:15' });
	const sundayOnly = period({
		id: 'sunday',
		days_of_week: [0],
		start_time: '12:00',
		last_booking_time: '21:00'
	});

	it('finds the service whose window holds the time (Wed 23 Sep 2026, 19:30 → dinner)', () => {
		expect(periodForSlot([lunch, dinner], '2026-09-23', '19:30', 'Europe/London')?.id).toBe(
			'dinner'
		);
	});

	it('counts the last booking time as inside the window', () => {
		expect(periodForSlot([lunch, dinner], '2026-09-23', '16:30', 'Europe/London')?.id).toBe(
			'lunch'
		);
	});

	it('is undefined in the gap between services', () => {
		expect(periodForSlot([lunch, dinner], '2026-09-23', '16:45', 'Europe/London')).toBeUndefined();
	});

	it('skips a service that does not run that weekday', () => {
		expect(periodForSlot([sundayOnly], '2026-09-23', '13:00', 'Europe/London')).toBeUndefined();
		expect(periodForSlot([sundayOnly], '2026-09-27', '13:00', 'Europe/London')?.id).toBe('sunday');
	});
});
