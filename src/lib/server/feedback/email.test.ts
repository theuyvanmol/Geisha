// The feedback request email, rendered without sending anything.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('../db/pb.js', () => ({ pb: vi.fn() }));

import { feedbackLinks, renderFeedbackRequest } from './email.js';
import { verifyScopedToken, verifyBookingToken } from '../booking/selfservice.js';
import type { Booking, Customer, Restaurant } from '../db/types.js';

const NOW = new Date('2026-09-16T10:00:00.000Z');

const booking = {
	id: 'bk1234567890abc',
	restaurant: 'r1',
	customer: 'c1',
	guest_name: 'Sam Smith',
	guest_phone: '07700 900123',
	party_size: 4,
	starts_at: '2026-09-15 18:00:00.000Z',
	status: 'completed',
	source: 'online'
} as unknown as Booking;
const customer = { id: 'c1', name: 'Sam', email: 'sam@example.com', phone: '' } as unknown as Customer;
const restaurant = { id: 'r1', brand: 'fusion', display_name: 'Geisha Fusion' } as Restaurant;

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	mockEnv.BOOKING_LINK_SECRET = 'unit-test-secret-key';
});

describe('feedbackLinks', () => {
	it('signs six score links, a plain page link and a stop link — all feedback-scoped', () => {
		const links = feedbackLinks(booking.id, NOW, 'https://example.test/')!;
		expect(links.scores).toHaveLength(6);
		expect(links.scores[0]).toBe(`${links.page}?score=0`);
		expect(links.scores[5]).toBe(`${links.page}?score=5`);
		expect(links.stop).toBe(`${links.page}?stop=1`);

		const token = links.page.split('/feedback/')[1];
		expect(links.page.startsWith('https://example.test/feedback/')).toBe(true);
		expect(verifyScopedToken('feedback', token)).toEqual({ id: booking.id });
		// …and it must NOT open the manage/cancel page.
		expect(verifyBookingToken(token)).toBeNull();
	});

	it('expires 30 days after sending', () => {
		const token = feedbackLinks(booking.id, NOW, 'https://example.test')!.page.split('/feedback/')[1];
		const payload = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
		const exp = Number(payload.slice(payload.lastIndexOf('.') + 1));
		expect(exp - Math.floor(NOW.getTime() / 1000)).toBe(30 * 86_400);
	});

	it('is null without a signing secret, so nothing is sent', () => {
		delete mockEnv.BOOKING_LINK_SECRET;
		expect(feedbackLinks(booking.id, NOW, 'https://example.test')).toBeNull();
	});
});

describe('renderFeedbackRequest', () => {
	it('greets the guest, names the visit, and carries every score link and the stop link', () => {
		const links = feedbackLinks(booking.id, NOW, 'https://example.test')!;
		const email = renderFeedbackRequest(booking, customer, restaurant, links);

		expect(email.subject).toBe('How was your visit to Geisha Fusion?');
		expect(email.html).toContain('Hello Sam Smith,');
		expect(email.html).toContain('Tuesday 15 September');
		for (const url of links.scores) expect(email.html).toContain(url);
		expect(email.html).toContain(links.stop);
		expect(email.html).toContain('Stop feedback emails');
		// The default footer promises there's nothing to unsubscribe from — untrue here.
		expect(email.html).not.toContain('nothing to unsubscribe');

		expect(email.text).toContain(links.page);
		expect(email.text).toContain(`Stop feedback emails: ${links.stop}`);
	});
});

describe('staff emails', () => {
	// The owner decided staff are NOT emailed about bad scores — they read them in
	// Reports → Feedback. Guard against the alert quietly coming back.
	it('has no low-score alert to send', async () => {
		const mod = await import('./email.js');
		expect(Object.keys(mod).filter((k) => /alert/i.test(k))).toEqual([]);
	});
});
