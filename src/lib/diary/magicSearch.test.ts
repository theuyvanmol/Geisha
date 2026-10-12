import { describe, it, expect } from 'vitest';
import { looksLikeRef, looksLikePhone, looksLikeEmail, rankResults } from './magicSearch';
import type { SearchResult } from './magicSearch';

const r = (over: Partial<SearchResult> & { id: string; kind: SearchResult['kind'] }): SearchResult => ({
	title: '',
	subtitle: '',
	score: 0,
	...over
});

describe('query classification', () => {
	it('looksLikeRef matches a 6-char alphanumeric', () => {
		expect(looksLikeRef('BAFUAA')).toBe(true);
		expect(looksLikeRef('ro8kba')).toBe(true);
		expect(looksLikeRef('Smith')).toBe(false);
		expect(looksLikeRef('12345')).toBe(false); // 5 chars
	});
	it('looksLikePhone matches digit-ish queries', () => {
		expect(looksLikePhone('0191 300 4641')).toBe(true);
		expect(looksLikePhone('+44 7700 900123')).toBe(true);
		expect(looksLikePhone('Smith')).toBe(false);
	});
	it('looksLikeEmail needs an @', () => {
		expect(looksLikeEmail('a@b.com')).toBe(true);
		expect(looksLikeEmail('no-at')).toBe(false);
	});
});

describe('rankResults', () => {
	it('returns nothing for an empty query', () => {
		expect(rankResults('', [r({ id: '1', kind: 'customer', title: 'Smith' })])).toEqual([]);
	});

	it('puts an exact booking-ref match at the top', () => {
		const out = rankResults('RO8KBA', [
			r({ id: 'c1', kind: 'customer', title: 'Rod Ferguson', subtitle: 'rod@x.com' }),
			r({ id: 'b1', kind: 'booking', bookingId: 'b1', title: 'Donna', subtitle: 'RO8KBA · 19:00', ref: 'RO8KBA' })
		]);
		expect(out[0].kind).toBe('booking');
		expect(out[0].ref).toBe('RO8KBA');
	});

	it('ranks a prefix (starts-with) name above a mere substring', () => {
		const out = rankResults('hed', [
			r({ id: 'c1', kind: 'customer', title: 'John Shedley', subtitle: '' }), // contains
			r({ id: 'c2', kind: 'customer', title: 'Hedley, Steph', subtitle: '' }) // starts-with
		]);
		expect(out[0].id).toBe('c2');
	});

	it('drops zero-score (non-matching) candidates', () => {
		const out = rankResults('zzz', [r({ id: 'c1', kind: 'customer', title: 'Smith', subtitle: 'a@b.com' })]);
		expect(out).toHaveLength(0);
	});

	it('caps to the limit', () => {
		const many = Array.from({ length: 30 }, (_, i) =>
			r({ id: `c${i}`, kind: 'customer', title: `Smithy ${i}`, subtitle: '' })
		);
		expect(rankResults('smith', many, 12)).toHaveLength(12);
	});

	it('nudges a booking above a customer on an otherwise-equal match', () => {
		const out = rankResults('jones', [
			r({ id: 'c1', kind: 'customer', title: 'Jones', subtitle: '' }),
			r({ id: 'b1', kind: 'booking', bookingId: 'b1', title: 'Jones', subtitle: '' })
		]);
		expect(out[0].kind).toBe('booking');
	});
});
