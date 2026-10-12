// The post-visit feedback email's pure rules: who is asked, what counts as an
// answer, who is offered a Google review, and the 0–5 report summary.

import { describe, it, expect } from 'vitest';
import {
	feedbackEligibility,
	parseScore,
	cleanComment,
	offersGoogleReview,
	normaliseGuestFeedbackConfig,
	parseRecipients,
	recipientsError,
	googleReviewUrlError,
	COMMENT_MAX
} from './rules.js';
import { summariseScoresByDay } from './summary.js';

// 10:00 UTC on Wed 16 Sep 2026 = 11:00 BST — when the cron runs.
const NOW = new Date('2026-09-16T10:00:00.000Z');

const booking = (over: Partial<{ source: string; status: string; starts_at: string }> = {}) => ({
	source: 'online',
	status: 'completed',
	// 19:00 BST the evening before.
	starts_at: '2026-09-15 18:00:00.000Z',
	...over
});
const guest = (over: Partial<{ email: string; deleted_at: string; feedback_opt_out: boolean }> = {}) => ({
	email: 'guest@example.com',
	deleted_at: '',
	feedback_opt_out: false,
	...over
});

describe('feedbackEligibility', () => {
	it("asks an online guest who finished last night's meal", () => {
		expect(feedbackEligibility(booking(), guest(), NOW)).toEqual({ ok: true });
	});

	it('asks a guest whose table was never marked finished (still seated)', () => {
		expect(feedbackEligibility(booking({ status: 'seated' }), guest(), NOW)).toEqual({ ok: true });
	});

	it.each(['phone', 'walkin', 'ai', ''])('skips a %s booking', (source) => {
		expect(feedbackEligibility(booking({ source }), guest(), NOW)).toEqual({
			ok: false,
			reason: 'not_online'
		});
	});

	it.each(['cancelled', 'no_show', 'confirmed', 'pending_payment'])(
		'skips a booking that is %s',
		(status) => {
			expect(feedbackEligibility(booking({ status }), guest(), NOW)).toEqual({
				ok: false,
				reason: 'not_attended'
			});
		}
	);

	it("waits until the next London day — today's lunch is not asked yet", () => {
		// 12:30 BST today.
		const b = booking({ starts_at: '2026-09-16 11:30:00.000Z' });
		expect(feedbackEligibility(b, guest(), NOW)).toEqual({ ok: false, reason: 'too_recent' });
	});

	it('uses the London day, not the UTC day, at the midnight edge', () => {
		// 00:30 BST on the 16th is 23:30 UTC on the 15th — still TODAY in London.
		const b = booking({ starts_at: '2026-09-15 23:30:00.000Z' });
		expect(feedbackEligibility(b, guest(), NOW)).toEqual({ ok: false, reason: 'too_recent' });
	});

	it('catches up one missed run, but not older visits', () => {
		const twoDaysAgo = booking({ starts_at: '2026-09-14 18:00:00.000Z' }); // 40h before
		expect(feedbackEligibility(twoDaysAgo, guest(), NOW)).toEqual({ ok: true });
		const threeDaysAgo = booking({ starts_at: '2026-09-13 18:00:00.000Z' }); // 64h before
		expect(feedbackEligibility(threeDaysAgo, guest(), NOW)).toEqual({
			ok: false,
			reason: 'too_old'
		});
	});

	it('skips a guest with no email, an erased guest, and one who opted out', () => {
		expect(feedbackEligibility(booking(), guest({ email: '' }), NOW)).toEqual({
			ok: false,
			reason: 'no_email'
		});
		expect(feedbackEligibility(booking(), null, NOW)).toEqual({ ok: false, reason: 'no_email' });
		expect(
			feedbackEligibility(booking(), guest({ deleted_at: '2026-09-01 00:00:00.000Z' }), NOW)
		).toEqual({ ok: false, reason: 'erased' });
		expect(feedbackEligibility(booking(), guest({ feedback_opt_out: true }), NOW)).toEqual({
			ok: false,
			reason: 'opted_out'
		});
	});

	it('skips a blocked guest', () => {
		expect(feedbackEligibility(booking(), guest(), NOW, { blocked: true })).toEqual({
			ok: false,
			reason: 'blocked'
		});
	});

	it('skips a booking with an unreadable start time', () => {
		expect(feedbackEligibility(booking({ starts_at: 'nonsense' }), guest(), NOW)).toEqual({
			ok: false,
			reason: 'too_old'
		});
	});
});

describe('parseScore', () => {
	it('accepts every whole number from 0 to 5 — including 0', () => {
		expect([0, 1, 2, 3, 4, 5].map((n) => parseScore(String(n)))).toEqual([0, 1, 2, 3, 4, 5]);
		expect(parseScore(0)).toBe(0);
	});

	it.each(['', ' ', '6', '-1', '2.5', 'abc', null, undefined, '1e0'])('rejects %j', (raw) => {
		expect(parseScore(raw)).toBeNull();
	});
});

describe('cleanComment', () => {
	it('trims and caps a comment', () => {
		expect(cleanComment('  lovely  ')).toBe('lovely');
		expect(cleanComment('x'.repeat(COMMENT_MAX + 50))).toHaveLength(COMMENT_MAX);
		expect(cleanComment(null)).toBe('');
	});
});

describe('offersGoogleReview', () => {
	it('offers the button to a 4 or 5, only when a link is set', () => {
		const url = 'https://g.page/r/abc/review';
		expect([3, 4, 5].map((s) => offersGoogleReview(s, url))).toEqual([false, true, true]);
		expect(offersGoogleReview(5, '')).toBe(false);
	});
});

describe('normaliseGuestFeedbackConfig', () => {
	it('defaults to on with no Google link', () => {
		expect(normaliseGuestFeedbackConfig(undefined)).toEqual({
			enabled: true,
			googleReviewUrl: '',
			weeklySummary: true,
			weeklyRecipients: []
		});
	});

	it('keeps valid values and drops invalid ones', () => {
		expect(
			normaliseGuestFeedbackConfig({
				enabled: false,
				googleReviewUrl: ' https://g.page/r/abc/review '
			})
		).toEqual({ enabled: false, googleReviewUrl: 'https://g.page/r/abc/review', weeklySummary: true, weeklyRecipients: [] });
		expect(
			normaliseGuestFeedbackConfig({ enabled: 'nope', googleReviewUrl: 'javascript:alert(1)' })
		).toEqual({ enabled: true, googleReviewUrl: '', weeklySummary: true, weeklyRecipients: [] });
	});

	// Staff alerts were removed on the owner's call. A row saved while they
	// existed still carries `alertEmail`; it must not leak back out as config.
	it('ignores a leftover alertEmail from before alerts were removed', () => {
		expect(
			normaliseGuestFeedbackConfig({
				enabled: true,
				alertEmail: 'manager@geisharestaurants.co.uk',
				googleReviewUrl: ''
			})
		).toEqual({ enabled: true, googleReviewUrl: '', weeklySummary: true, weeklyRecipients: [] });
	});
});

describe('weekly summary settings', () => {
	it('keeps the switch and cleans the recipient list', () => {
		expect(
			normaliseGuestFeedbackConfig({
				weeklySummary: false,
				weeklyRecipients: [' Owner@Geisha.co.uk ', 'owner@geisha.co.uk', 'not-an-email']
			})
		).toMatchObject({ weeklySummary: false, weeklyRecipients: ['owner@geisha.co.uk'] });
	});

	it('splits a typed list on commas, semicolons, spaces and new lines', () => {
		expect(parseRecipients('a@x.com, b@x.com;c@x.com\nd@x.com e@x.com')).toEqual([
			'a@x.com',
			'b@x.com',
			'c@x.com',
			'd@x.com',
			'e@x.com'
		]);
		expect(parseRecipients('')).toEqual([]);
	});

	it('names the entries that are not email addresses', () => {
		expect(recipientsError('')).toBeNull();
		expect(recipientsError('a@x.com, b@x.com')).toBeNull();
		expect(recipientsError('a@x.com, bob')).toMatch(/bob/);
	});
});

describe('settings validation', () => {
	it('allows a blank Google link or an https one', () => {
		expect(googleReviewUrlError('')).toBeNull();
		expect(googleReviewUrlError('https://g.page/r/abc/review')).toBeNull();
		expect(googleReviewUrlError('http://g.page/r/abc/review')).toMatch(/https/i);
		expect(googleReviewUrlError('g.page/abc')).toMatch(/https/i);
	});
});

describe('summariseScoresByDay', () => {
	const row = (score: number, visit_at: string) => ({ score, visit_at });

	it('counts a 0 as a real score, in its own column and the average', () => {
		const r = summariseScoresByDay([row(0, '2026-09-15 18:00:00.000Z'), row(4, '2026-09-15 19:00:00.000Z')]);
		expect(r.byDay).toHaveLength(1);
		expect(r.byDay[0].counts).toEqual([1, 0, 0, 0, 1, 0]);
		expect(r.byDay[0].pct).toEqual([50, 0, 0, 0, 50, 0]);
		expect(r.byDay[0].average).toBe(2);
		expect(r.byDay[0].total).toBe(2);
	});

	it('groups by London visit day, newest first, with reconciling totals', () => {
		const r = summariseScoresByDay([
			row(5, '2026-09-14 18:00:00.000Z'),
			// 00:30 BST on the 16th — the 16th in London, the 15th in UTC.
			row(3, '2026-09-15 23:30:00.000Z'),
			row(5, '2026-09-14 12:00:00.000Z')
		]);
		expect(r.byDay.map((d) => d.date)).toEqual(['2026-09-16', '2026-09-14']);
		expect(r.totals.counts).toEqual([0, 0, 0, 1, 0, 2]);
		expect(r.totals.total).toBe(3);
		expect(r.totals.average).toBe(4.33);
		expect(r.totals.pct[5]).toBe(66.7);
	});

	it('is empty and averages to 0 with no replies', () => {
		const r = summariseScoresByDay([]);
		expect(r.byDay).toEqual([]);
		expect(r.totals.total).toBe(0);
		expect(r.totals.average).toBe(0);
	});
});
