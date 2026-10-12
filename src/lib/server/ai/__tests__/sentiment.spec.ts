// Unit tests for the DETERMINISTIC core of mf-review-sentiment — the pure
// keyword/rating analysis, the import parsers, and the insights aggregation. No
// PocketBase or network (the LLM/PB layers in sentiment.ts are not exercised here).

import { describe, it, expect } from 'vitest';
import {
	analyseReview,
	parseRating,
	parseDate,
	parsePastedReviews,
	parseReviewCsv,
	summariseReviews,
	summariseFeedbackByDay,
	themeLabel,
	type ReviewInsights
} from '../sentiment.js';
import type { Review } from '../../db/types.js';

describe('analyseReview — sentiment', () => {
	it('reads a glowing review as positive', () => {
		const a = analyseReview({ text: 'Absolutely amazing food, the best sushi, wonderful service.', rating: 5 });
		expect(a.sentiment).toBe('positive');
		expect(a.score).toBeGreaterThan(0);
		expect(a.source).toBe('keyword');
	});

	it('reads a scathing review as negative', () => {
		const a = analyseReview({ text: 'Terrible. Rude staff, cold food, waited forever. Avoid.', rating: 1 });
		expect(a.sentiment).toBe('negative');
		expect(a.score).toBeLessThan(0);
	});

	it('reads a flat/factual review as neutral', () => {
		const a = analyseReview({ text: 'We had a table for four at seven.', rating: 3 });
		expect(a.sentiment).toBe('neutral');
	});

	it('lets a strong star rating colour a terse review', () => {
		const a = analyseReview({ text: 'Fine.', rating: 5 });
		expect(a.sentiment).toBe('positive');
		const b = analyseReview({ text: 'Fine.', rating: 1 });
		expect(b.sentiment).toBe('negative');
	});

	it('keeps the score clamped to -100..100', () => {
		const a = analyseReview({
			text: 'amazing excellent perfect outstanding fantastic wonderful superb best',
			rating: 5
		});
		expect(a.score).toBeLessThanOrEqual(100);
		const b = analyseReview({ text: 'terrible awful horrible worst disgusting rude avoid', rating: 1 });
		expect(b.score).toBeGreaterThanOrEqual(-100);
	});
});

describe('analyseReview — themes', () => {
	it('detects the themes a review discusses', () => {
		const a = analyseReview({ text: 'The food was delicious but the service was slow and it felt overpriced.', rating: 3 });
		const keys = a.themes.map((t) => t.key).sort();
		expect(keys).toContain('food');
		expect(keys).toContain('service');
		expect(keys).toContain('value');
	});

	it('tags a theme negative when the local words are negative', () => {
		const a = analyseReview({ text: 'Lovely food, but the service was rude and slow.', rating: 3 });
		const service = a.themes.find((t) => t.key === 'service');
		expect(service?.polarity).toBe('negative');
	});

	it('returns no themes for text with no recognised topic', () => {
		const a = analyseReview({ text: 'Hello there.', rating: 0 });
		expect(a.themes).toHaveLength(0);
	});
});

describe('parseRating / parseDate', () => {
	it('parses numbers, fractions, stars and clamps to 5', () => {
		expect(parseRating('4')).toBe(4);
		expect(parseRating('4.5')).toBe(4.5);
		expect(parseRating('★★★★★')).toBe(5);
		expect(parseRating('9')).toBe(5);
		expect(parseRating('')).toBe(0);
		expect(parseRating(undefined)).toBe(0);
	});

	it('parses a date to ISO or empty', () => {
		expect(parseDate('2026-06-01')).toBe(new Date('2026-06-01').toISOString());
		expect(parseDate('not a date')).toBe('');
		expect(parseDate('')).toBe('');
	});
});

describe('parsePastedReviews', () => {
	it('splits blank-line-separated blocks and reads a "Name — rating" header', () => {
		const raw = 'Sarah M — 5\nIncredible omakase, best in town.\n\nDave - 2 stars\nWaited 40 minutes and the food was cold.';
		const rows = parsePastedReviews(raw, { source: 'google' });
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ author: 'Sarah M', rating: 5, source: 'google' });
		expect(rows[0].text).toContain('omakase');
		expect(rows[1]).toMatchObject({ author: 'Dave', rating: 2 });
	});

	it('treats a headerless block as plain text', () => {
		const rows = parsePastedReviews('Just a single line review with no header.');
		expect(rows).toHaveLength(1);
		expect(rows[0].author).toBe('');
		expect(rows[0].rating).toBe(0);
		expect(rows[0].text).toContain('single line');
	});

	it('drops empty blocks', () => {
		expect(parsePastedReviews('\n\n   \n\n')).toHaveLength(0);
	});
});

describe('parseReviewCsv', () => {
	it('maps header columns and handles quoted fields with commas', () => {
		const csv =
			'author,rating,text,date,source\n' +
			'Sarah M,5,"Loved it, especially the ramen",2026-06-01,google\n' +
			'Dave,2,"Cold, slow, overpriced",2026-06-03,tripadvisor';
		const rows = parseReviewCsv(csv);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ author: 'Sarah M', rating: 5, source: 'google' });
		expect(rows[0].text).toBe('Loved it, especially the ramen');
		expect(rows[1].source).toBe('tripadvisor');
	});

	it('falls back to the default source when none is given', () => {
		const rows = parseReviewCsv('name,review\nJo,Great food', { source: 'manual' });
		expect(rows).toHaveLength(1);
		expect(rows[0].source).toBe('manual');
		expect(rows[0].text).toBe('Great food');
	});

	it('returns [] for an empty or header-only CSV', () => {
		expect(parseReviewCsv('')).toHaveLength(0);
		expect(parseReviewCsv('author,rating,text')).toHaveLength(0);
	});
});

describe('summariseReviews', () => {
	const mk = (over: Partial<Review>): Review =>
		({
			id: 'r' + Math.random().toString(36).slice(2),
			created: '2026-06-01T12:00:00Z',
			updated: '2026-06-01T12:00:00Z',
			restaurant: 'rest1',
			source: 'google',
			rating: 0,
			text: '',
			author: '',
			posted_at: '2026-06-01T12:00:00Z',
			sentiment: 'neutral',
			themes: [],
			...over
		}) as Review;

	it('aggregates totals, average rating, sentiment split and themes', () => {
		const reviews: Review[] = [
			mk({ rating: 5, sentiment: 'positive', themes: [{ key: 'food', label: 'Food', polarity: 'positive' }] }),
			mk({ rating: 1, sentiment: 'negative', themes: [{ key: 'service', label: 'Service', polarity: 'negative' }] }),
			mk({ rating: 3, sentiment: 'neutral', themes: [{ key: 'food', label: 'Food', polarity: 'neutral' }] })
		];
		const ins: ReviewInsights = summariseReviews(reviews, '2026-06-01', '2026-06-30');
		expect(ins.total).toBe(3);
		expect(ins.averageRating).toBe(3); // (5+1+3)/3
		expect(ins.sentiment).toEqual({ positive: 1, neutral: 1, negative: 1 });
		const food = ins.themes.find((t) => t.key === 'food');
		expect(food?.count).toBe(2);
		expect(food?.positive).toBe(1);
	});

	it('counts unanswered negatives as needing attention; a published reply clears it', () => {
		const reviews: Review[] = [
			mk({ sentiment: 'negative' }),
			mk({ sentiment: 'negative', reply: 'So sorry — please come back.', reply_status: 'published' })
		];
		const ins = summariseReviews(reviews, '2026-06-01', '2026-06-30');
		expect(ins.needsAttention).toBe(1);
	});

	it('ignores unrated reviews in the average', () => {
		const ins = summariseReviews([mk({ rating: 0 }), mk({ rating: 4 })], '2026-06-01', '2026-06-30');
		expect(ins.averageRating).toBe(4);
	});
});

describe('themeLabel', () => {
	it('maps known keys to labels and passes through unknowns', () => {
		expect(themeLabel('food')).toBe('Food');
		expect(themeLabel('ambience')).toBe('Ambience');
		expect(themeLabel('mystery')).toBe('mystery');
	});
});

describe('summariseFeedbackByDay — per-day star breakdown', () => {
	const mk = (over: Partial<Review>): Review =>
		({
			id: 'r' + Math.random().toString(36).slice(2),
			created: '2026-06-27T12:00:00Z',
			updated: '2026-06-27T12:00:00Z',
			restaurant: 'rest1',
			source: 'dishcult',
			rating: 0,
			text: 'x',
			author: '',
			posted_at: '',
			sentiment: 'neutral',
			themes: [],
			...over
		}) as Review;

	it('groups by local day, counts stars, and reconciles the Totals row', () => {
		// Two reviews on the 27th (1★ + 5★), one on the 28th (5★) — mirrors the
		// ResDiary screenshot's shape.
		const reviews: Review[] = [
			mk({ rating: 1, posted_at: '2026-06-27T18:00:00Z' }),
			mk({ rating: 5, posted_at: '2026-06-27T20:00:00Z' }),
			mk({ rating: 5, posted_at: '2026-06-28T19:00:00Z' })
		];
		const rep = summariseFeedbackByDay(reviews, '2026-06-22', '2026-06-28', 'Europe/London');

		// Newest day first.
		expect(rep.byDay.map((d) => d.date)).toEqual(['2026-06-28', '2026-06-27']);

		const d27 = rep.byDay.find((d) => d.date === '2026-06-27')!;
		expect(d27.total).toBe(2);
		expect(d27.counts[1]).toBe(1);
		expect(d27.counts[5]).toBe(1);
		expect(d27.pct[5]).toBe(50); // 1 of 2 rated
		expect(d27.averageRating).toBe(3); // (1+5)/2

		// Totals reconcile across days.
		expect(rep.totals.total).toBe(3);
		expect(rep.totals.counts[5]).toBe(2);
		expect(rep.totals.counts[1]).toBe(1);
		expect(rep.totals.averageRating).toBeCloseTo(11 / 3, 2);
	});

	it('excludes unrated reviews from the star %/average but counts them in total', () => {
		const reviews: Review[] = [
			mk({ rating: 0, posted_at: '2026-06-27T18:00:00Z' }),
			mk({ rating: 4, posted_at: '2026-06-27T19:00:00Z' })
		];
		const rep = summariseFeedbackByDay(reviews, '2026-06-27', '2026-06-27', 'Europe/London');
		const d = rep.byDay[0];
		expect(d.total).toBe(2);
		expect(d.rated).toBe(1);
		expect(d.averageRating).toBe(4);
		expect(d.pct[4]).toBe(100); // % is over RATED reviews only
	});

	it('falls back to created when posted_at is empty', () => {
		const rep = summariseFeedbackByDay(
			[mk({ rating: 5, posted_at: '', created: '2026-06-26T12:00:00Z' })],
			'2026-06-22',
			'2026-06-28',
			'Europe/London'
		);
		expect(rep.byDay[0].date).toBe('2026-06-26');
	});

	it('returns empty days + a zeroed Totals row for no reviews', () => {
		const rep = summariseFeedbackByDay([], '2026-06-22', '2026-06-28', 'Europe/London');
		expect(rep.byDay).toEqual([]);
		expect(rep.totals.total).toBe(0);
		expect(rep.totals.averageRating).toBe(0);
	});
});
