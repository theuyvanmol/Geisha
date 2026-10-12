import { describe, expect, it } from 'vitest';
import { stillToCome, toComeFigure } from './toCome';

const bar = (arrival: string, status = 'confirmed') => ({ arrival, status });

describe('stillToCome', () => {
	it('counts a booking nobody has sat yet', () => {
		expect(stillToCome(bar('unarrived'))).toBe(true);
	});

	it('keeps counting one that is running late — it is still expected', () => {
		expect(stillToCome(bar('late'))).toBe(true);
	});

	it('keeps counting an unpaid online hold, as the Pax beside it does', () => {
		expect(stillToCome(bar('unarrived', 'pending_payment'))).toBe(true);
	});

	it('stops counting a party the moment it is sat', () => {
		expect(stillToCome(bar('arrived', 'seated'))).toBe(false);
	});

	it('goes by the seat, so a party parked in the bar or with its table ready still counts', () => {
		// The owner asked for a number that "decreases once we sit people".
		expect(stillToCome(bar('waiting_bar'))).toBe(true);
		expect(stillToCome(bar('table_ready'))).toBe(true);
	});

	it('treats a part-seated party as sat', () => {
		expect(stillToCome(bar('partially_seated', 'seated'))).toBe(false);
	});

	it('does not count a party that has been and gone', () => {
		expect(stillToCome(bar('left', 'completed'))).toBe(false);
	});

	it('does not count a no-show or a cancellation', () => {
		expect(stillToCome(bar('no_show', 'no_show'))).toBe(false);
		expect(stillToCome(bar('unarrived', 'cancelled'))).toBe(false);
	});

	it('moves on the tap, before the booking status has caught up with it', () => {
		// Seat and Unseat patch the bar's arrival straight away; its status follows when the
		// server answers. The number has to move with the bar, not a beat behind it.
		expect(stillToCome(bar('arrived', 'confirmed'))).toBe(false); // Seat just tapped
		expect(stillToCome(bar('unarrived', 'seated'))).toBe(true); // Unseat just tapped
	});
});

describe('toComeFigure', () => {
	it('reads as covers still to come, and spells out what that means on hover', () => {
		expect(toComeFigure(64, 91)).toEqual({
			text: '64 to come',
			title: '64 still to be seated'
		});
	});

	it('still shows the figure at 0, and says everyone is in', () => {
		expect(toComeFigure(0, 91)).toEqual({ text: '0 to come', title: 'everyone seated' });
	});

	it('does not claim everyone is in when nobody was booked', () => {
		expect(toComeFigure(0, 0)).toEqual({ text: '0 to come', title: 'nobody booked yet' });
	});
});
