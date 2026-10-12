import { describe, expect, it } from 'vitest';
import { shouldSnapToToday } from './staleDate';

const TODAY = '2026-09-11';
const YESTERDAY = '2026-09-10';

describe('shouldSnapToToday', () => {
	it('snaps a restored tab that opens on a past date', () => {
		expect(
			shouldSnapToToday({ type: 'enter', fromPath: null, date: YESTERDAY, today: TODAY, pick: null })
		).toBe(true);
	});

	it("snaps the hand-back from the sign-in page — the 12h session ran out overnight and redirectTo still carries last night's ?date=", () => {
		expect(
			shouldSnapToToday({
				type: 'goto',
				fromPath: '/admin/login',
				date: YESTERDAY,
				today: TODAY,
				pick: { date: YESTERDAY, today: YESTERDAY }
			})
		).toBe(true);
	});

	it('keeps a past day this tab deliberately picked TODAY, even across a re-sign-in', () => {
		const pick = { date: YESTERDAY, today: TODAY };
		expect(shouldSnapToToday({ type: 'enter', fromPath: null, date: YESTERDAY, today: TODAY, pick })).toBe(
			false
		);
		expect(
			shouldSnapToToday({ type: 'goto', fromPath: '/admin/login', date: YESTERDAY, today: TODAY, pick })
		).toBe(false);
	});

	it('never snaps a deliberate in-app arrival on a past date (deep links, back button)', () => {
		for (const [type, fromPath] of [
			['link', '/admin/bookings/abc'],
			['goto', '/admin/closures'],
			['popstate', '/admin/diary']
		] as const) {
			expect(shouldSnapToToday({ type, fromPath, date: YESTERDAY, today: TODAY, pick: null })).toBe(false);
		}
	});

	it('leaves today and future dates alone', () => {
		for (const date of [TODAY, '2026-09-12']) {
			expect(shouldSnapToToday({ type: 'enter', fromPath: null, date, today: TODAY, pick: null })).toBe(false);
			expect(
				shouldSnapToToday({ type: 'goto', fromPath: '/admin/login', date, today: TODAY, pick: null })
			).toBe(false);
		}
	});
});
