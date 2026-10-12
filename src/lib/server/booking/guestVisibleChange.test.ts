// An amendment only emails the guest when something the GUEST can see changed.
//
// Dragging a booking to another table is the commonest thing a host does during
// service, and it was sending "Your booking has been updated" carrying details
// identical to the ones already in the guest's inbox.

import { describe, it, expect } from 'vitest';
import { guestVisibleChange } from './amend.js';
import type { Booking } from '../db/types.js';

const base = {
	starts_at: '2026-08-26T19:00:00.000Z',
	party_size: 4,
	special_requests: 'Window table please'
} as Pick<Booking, 'starts_at' | 'party_size' | 'special_requests'>;

const withChange = (over: Partial<typeof base>) => ({ ...base, ...over });

describe('guestVisibleChange', () => {
	it('is false when nothing the guest can see moved (a pure table reallocation)', () => {
		expect(guestVisibleChange(base, { ...base })).toBe(false);
	});

	it('is false when only the timestamp FORMAT differs', () => {
		// The write path round-trips through Date#toISOString, so the same instant can
		// come back spelled differently. Comparing strings would email on every amend.
		expect(guestVisibleChange({ ...base, starts_at: '2026-08-26 19:00:00.000Z' }, base)).toBe(
			false
		);
	});

	it('is true when the time changes', () => {
		expect(guestVisibleChange(base, withChange({ starts_at: '2026-08-26T20:00:00.000Z' }))).toBe(
			true
		);
	});

	it('is true when the date changes', () => {
		expect(guestVisibleChange(base, withChange({ starts_at: '2026-08-27T19:00:00.000Z' }))).toBe(
			true
		);
	});

	it('is true when the party size changes', () => {
		expect(guestVisibleChange(base, withChange({ party_size: 6 }))).toBe(true);
		expect(guestVisibleChange(base, withChange({ party_size: 2 }))).toBe(true);
	});

	it('is true when the special requests change', () => {
		expect(guestVisibleChange(base, withChange({ special_requests: 'Birthday cake' }))).toBe(true);
	});

	it('treats undefined and empty special requests as the same', () => {
		expect(
			guestVisibleChange(
				{ ...base, special_requests: undefined as unknown as string },
				{ ...base, special_requests: '' }
			)
		).toBe(false);
	});
});
