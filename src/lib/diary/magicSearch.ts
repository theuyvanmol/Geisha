// Magic search (ResDiary parity) — PURE ranking + query classification so it's
// unit-testable without a DB. The server (admin search endpoint) does the actual
// PocketBase reads and feeds the rows in; this module decides what a query targets
// and how to order the merged results.
//
// ResDiary's "magic search" is a universal box: it finds customers (name / email /
// phone), a booking by its reference, and today's expected arrivals — all from one
// field. We mirror that: classify the raw query, then rank a merged result list so
// the most likely hit is first.

export type SearchResultKind = 'booking' | 'customer';

export interface SearchResult {
	kind: SearchResultKind;
	id: string; // booking id (booking) or customer id (customer)
	bookingId?: string; // present for booking results (for scroll-to-bar / link)
	title: string; // guest name
	subtitle: string; // ref · time · party, or email/phone
	ref?: string; // booking ref (for exact-match boosting)
	score: number; // higher = better
}

/** A booking ref is 6 chars of [A-Z0-9] (refOf = last 6 of the id, uppercased). */
export function looksLikeRef(query: string): boolean {
	return /^[a-z0-9]{6}$/i.test(query.trim());
}

/** A query that's mostly digits (+ spaces / + ( ) -) reads as a phone search. */
export function looksLikePhone(query: string): boolean {
	const digits = query.replace(/[^0-9]/g, '');
	return digits.length >= 4 && /^[0-9 ()+-]+$/.test(query.trim());
}

export function looksLikeEmail(query: string): boolean {
	return query.includes('@');
}

/**
 * Rank merged raw results for a query. Pure: caller supplies already-fetched
 * candidates; we only score + sort + cap. Scoring, highest first:
 *   • exact booking-ref match → top
 *   • title/subtitle starts-with the query → strong
 *   • title/subtitle contains the query → moderate
 *   • bookings slightly above customers on ties (you usually want the reservation)
 */
export function rankResults(query: string, candidates: SearchResult[], limit = 12): SearchResult[] {
	const ql = query.trim().toLowerCase();
	if (!ql) return [];
	const refQuery = looksLikeRef(ql) ? ql.toUpperCase() : null;

	const scored = candidates.map((r) => {
		let score = 0;
		const title = r.title.toLowerCase();
		const subtitle = r.subtitle.toLowerCase();
		if (refQuery && r.ref && r.ref.toUpperCase() === refQuery) score += 1000;
		if (title === ql || subtitle === ql) score += 200;
		if (title.startsWith(ql)) score += 120;
		else if (title.includes(ql)) score += 60;
		if (subtitle.startsWith(ql)) score += 40;
		else if (subtitle.includes(ql)) score += 20;
		if (r.kind === 'booking') score += 5; // tiny nudge: prefer the live reservation
		return { ...r, score: r.score + score };
	});

	return scored
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
		.slice(0, limit);
}
