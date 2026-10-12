import { describe, it, expect } from 'vitest';
import { laneClickOpens, WALKIN_WINDOW_MIN } from './laneClick';

// Wed 16 Sep 2026, 15:00 BST (14:00 UTC).
const NOW = Date.parse('2026-09-16T14:00:00Z');
const at = (iso: string) => Date.parse(iso);

describe('laneClickOpens', () => {
	it("follows the owner's example: at 3pm, 3:00 and 3:15 are walk-ins, 3:30 is a booking", () => {
		expect(laneClickOpens(at('2026-09-16T14:00:00Z'), NOW)).toBe('walkin'); // 15:00 BST
		expect(laneClickOpens(at('2026-09-16T14:15:00Z'), NOW)).toBe('walkin'); // 15:15
		expect(laneClickOpens(at('2026-09-16T14:30:00Z'), NOW)).toBe('book'); // 15:30
		expect(WALKIN_WINDOW_MIN).toBe(15);
	});

	it('counts from the actual minute, not the slot', () => {
		const now = at('2026-09-16T14:07:00Z'); // 15:07
		expect(laneClickOpens(at('2026-09-16T14:15:00Z'), now)).toBe('walkin'); // 8 min away
		expect(laneClickOpens(at('2026-09-16T14:30:00Z'), now)).toBe('book'); // 23 min away
		const later = at('2026-09-16T14:14:00Z'); // 15:14
		expect(laneClickOpens(at('2026-09-16T14:30:00Z'), later)).toBe('book'); // 16 min away
	});

	it('the slot you are in right now is a walk-in', () => {
		const now = at('2026-09-16T14:10:00Z'); // 15:10, inside the 15:00 slot
		expect(laneClickOpens(at('2026-09-16T14:00:00Z'), now)).toBe('walkin');
	});

	it('earlier today is a walk-in — catching up on a party already seated', () => {
		expect(laneClickOpens(at('2026-09-16T11:00:00Z'), NOW)).toBe('walkin'); // 12:00 BST
	});

	it('any other day opens the booking form', () => {
		expect(laneClickOpens(at('2026-09-17T14:00:00Z'), NOW)).toBe('book'); // tomorrow, same time
		expect(laneClickOpens(at('2026-09-15T18:00:00Z'), NOW)).toBe('book'); // yesterday evening
	});

	it('uses the London day, not the UTC day', () => {
		// 00:30 BST on the 16th is 23:30 UTC on the 15th — still TODAY in London.
		const lateNight = at('2026-09-16T00:00:00Z'); // 01:00 BST on the 16th
		expect(laneClickOpens(at('2026-09-15T23:30:00Z'), lateNight)).toBe('walkin');
		// 23:30 BST on the 15th is the day before in London, even though it's within 90 min.
		expect(laneClickOpens(at('2026-09-15T22:30:00Z'), lateNight)).toBe('book');
	});

	it('just before midnight, the first slot after midnight is still a walk-in', () => {
		const now = at('2026-09-16T22:55:00Z'); // 23:55 BST
		expect(laneClickOpens(at('2026-09-16T23:00:00Z'), now)).toBe('walkin'); // 00:00 BST on the 17th
	});
});
