import { describe, expect, it } from 'vitest';
import {
	MAX_COMMENTS,
	averageLine,
	commentsWorstFirst,
	previousWeek,
	renderWeeklySummary,
	staffRecipients,
	weekLabel,
	weekOf,
	type WeekScores
} from './weekly';

const scores = (over: Partial<WeekScores> = {}): WeekScores => ({
	replies: 0,
	sent: 0,
	average: 0,
	counts: [0, 0, 0, 0, 0, 0],
	rows: [],
	...over
});

describe('which week', () => {
	it('a Monday-morning run summarises the Monday–Sunday just gone', () => {
		// Mon 6 Oct 2026, 09:00 BST
		expect(previousWeek(new Date('2026-10-06T08:00:00Z'))).toEqual({
			from: '2026-09-28',
			to: '2026-10-04'
		});
	});

	it('uses London time, not UTC, around midnight', () => {
		// 23:30 UTC Sunday 4 Oct = 00:30 BST Monday 5 Oct, so "last week" is 28 Sep – 4 Oct.
		expect(previousWeek(new Date('2026-10-04T23:30:00Z'))).toEqual({
			from: '2026-09-28',
			to: '2026-10-04'
		});
	});

	it('any day maps to its own Monday–Sunday', () => {
		expect(weekOf('2026-09-24')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
		expect(weekOf('2026-09-21')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
		expect(weekOf('2026-09-27')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
	});

	it('labels a week within a month and across two', () => {
		expect(weekLabel({ from: '2026-09-21', to: '2026-09-27' })).toBe('21–27 Sep');
		expect(weekLabel({ from: '2026-09-28', to: '2026-10-04' })).toBe('28 Sep – 4 Oct');
	});
});

describe('who gets it', () => {
	const staff = [
		{ email: 'Owner@Geisha.co.uk', role: 'owner', active: true, restaurants: [] },
		{ email: 'owner@geisha.co.uk', role: 'owner', active: true, restaurants: [] },
		{ email: 'asia-mgr@geisha.co.uk', role: 'manager', active: true, restaurants: ['asia'] },
		{ email: 'fusion-mgr@geisha.co.uk', role: 'manager', active: true, restaurants: ['fusion'] },
		{ email: 'gone@geisha.co.uk', role: 'manager', active: false, restaurants: [] },
		{ email: 'host@geisha.co.uk', role: 'host', active: true, restaurants: [] },
		{ email: 'broken', role: 'owner', active: true, restaurants: [] }
	] as const;

	it('active owners and managers who can see the restaurant, once each', () => {
		expect(staffRecipients([...staff] as never, 'asia')).toEqual([
			'owner@geisha.co.uk',
			'asia-mgr@geisha.co.uk'
		]);
	});
});

describe('the average line', () => {
	it('compares with the week before', () => {
		expect(averageLine(scores({ replies: 5, average: 4.33 }), scores({ replies: 3, average: 4.1 }))).toBe(
			'4.3 out of 5, up from 4.1 the week before'
		);
		expect(averageLine(scores({ replies: 5, average: 3.6 }), scores({ replies: 3, average: 4.1 }))).toBe(
			'3.6 out of 5, down from 4.1 the week before'
		);
		expect(averageLine(scores({ replies: 5, average: 4.04 }), scores({ replies: 3, average: 4 }))).toBe(
			'4.0 out of 5, the same as the week before'
		);
	});

	it('says so when there is nothing to compare with', () => {
		expect(averageLine(scores({ replies: 2, average: 5 }), scores())).toBe(
			'5.0 out of 5 (no replies the week before)'
		);
		expect(averageLine(scores({ replies: 2, average: 5 }), null)).toMatch(/no replies the week before/);
	});
});

describe('comments', () => {
	it('lowest score first, earliest visit first, and skips blank comments', () => {
		const rows = [
			{ guest: 'A', visitDate: '2026-09-23', partySize: 2, score: 5, comment: 'Lovely' },
			{ guest: 'B', visitDate: '2026-09-25', partySize: 2, score: 1, comment: 'Cold food' },
			{ guest: 'C', visitDate: '2026-09-22', partySize: 2, score: 1, comment: 'Slow' },
			{ guest: 'D', visitDate: '2026-09-22', partySize: 2, score: 0, comment: '   ' }
		];
		expect(commentsWorstFirst(rows).map((r) => r.guest)).toEqual(['C', 'B', 'A']);
	});
});

describe('the email', () => {
	const base = {
		brandId: 'asia' as const,
		restaurantName: 'Geisha Asia',
		week: { from: '2026-09-21', to: '2026-09-27' },
		reportUrl: 'https://example.com/admin/reports?brand=asia&tab=feedback',
		settingsUrl: 'https://example.com/admin/settings?brand=asia'
	};

	it('summarises a week with replies, comments worst first', () => {
		const { subject, html, text } = renderWeeklySummary({
			...base,
			scores: scores({
				replies: 3,
				sent: 10,
				average: 3.33,
				counts: [0, 1, 0, 0, 0, 2],
				rows: [
					{ guest: 'Ann Lee', visitDate: '2026-09-26', partySize: 4, score: 5, comment: 'Great sushi' },
					{ guest: 'Bob Roe', visitDate: '2026-09-24', partySize: 2, score: 1, comment: 'Waited <an hour>' },
					{ guest: 'Cy Doe', visitDate: '2026-09-25', partySize: 2, score: 5, comment: '' }
				]
			}),
			prior: scores({ replies: 4, average: 4.5 })
		});
		expect(subject).toBe('Geisha Asia: 3.3 out of 5 from 3 guests, 21–27 Sep');
		expect(text).toMatch(/3\.3 out of 5, down from 4\.5 the week before/);
		expect(text).toMatch(/3 of 10 guests asked \(30%\)/);
		// Worst first, and the guest's words are escaped in the HTML.
		expect(text.indexOf('Waited')).toBeLessThan(text.indexOf('Great sushi'));
		expect(html).toContain('Waited &lt;an hour&gt;');
		expect(html).not.toContain('<an hour>');
		expect(text).toMatch(/1\/5 from Bob Roe, Thu 24 Sep, party of 2/);
		expect(text).toMatch(/1 more guest scored the visit without leaving a comment/);
		expect(html).toContain('tab=feedback');
	});

	it('still sends a short note for a week with no replies', () => {
		const { subject, text } = renderWeeklySummary({
			...base,
			scores: scores({ sent: 6 }),
			prior: null
		});
		expect(subject).toBe('Geisha Asia: no guest feedback for 21–27 Sep');
		expect(text).toMatch(/6 feedback emails went out/);
	});

	it('points at the report once there are too many comments to list', () => {
		const rows = Array.from({ length: MAX_COMMENTS + 3 }, (_, i) => ({
			guest: `G${i}`,
			visitDate: '2026-09-22',
			partySize: 2,
			score: 4,
			comment: `Comment ${i}`
		}));
		const { text } = renderWeeklySummary({
			...base,
			scores: scores({ replies: rows.length, sent: rows.length, average: 4, rows }),
			prior: null
		});
		expect(text).toMatch(/3 more comments in the report/);
	});
});
