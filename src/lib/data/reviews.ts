// Guest reviews per brand, plus the aggregate rating shown on the homepage strip
// and the /reviews page. Sourced from each restaurant's TripAdvisor page — the
// curated 4–5★ highlights a venue would showcase. Aggregate figures mirror the
// live TripAdvisor totals; bump `count`/`average` here when they move. Edit this
// file to change what's shown — no markup edits. `tripAdvisorUrl` links out to
// the full listing ("read all reviews").

import type { BrandId } from './brand';

export type Review = {
	id: string;
	/** Reviewer's display name as shown on the source */
	author: string;
	/** Star rating, 1–5 (we only feature 4–5) */
	rating: number;
	/** Short headline / review title */
	title: string;
	/** The review body (lightly trimmed for length) */
	body: string;
	/** Where it was left, e.g. "TripAdvisor" */
	source: string;
};

export type BrandReviews = {
	/** Aggregate star rating out of 5 */
	average: number;
	/** Total number of reviews behind the aggregate */
	count: number;
	/** Link to the full public listing */
	tripAdvisorUrl: string;
	/** Featured individual reviews */
	items: Review[];
};

export const REVIEWS: Record<BrandId, BrandReviews> = {
	asia: {
		average: 4.7,
		count: 1015,
		tripAdvisorUrl:
			'https://www.tripadvisor.com/Restaurant_Review-g186394-d23617703-Reviews-Geisha_Asia_Restaurant-Newcastle_upon_Tyne_Tyne_and_Wear_England.html',
		items: [
			{
				id: 'asia-mrscroza',
				author: 'MrsCroza',
				rating: 5,
				title: 'Epic… just epic',
				body: 'Absolutely outstanding meal! You HAVE to try this restaurant. The food is delicious, the decor is so cool and the music is a vibe.',
				source: 'TripAdvisor'
			},
			{
				id: 'asia-george',
				author: 'George',
				rating: 5,
				title: 'I ♥ Geisha',
				body: "Third visit to Geisha in the last few weeks — keep coming back because it's so good, and there's so much variety on the menu you can have something different every time.",
				source: 'TripAdvisor'
			},
			{
				id: 'asia-kah4141',
				author: 'Kah4141',
				rating: 5,
				title: 'Everything is spot on',
				body: 'We had the best experience. The staff are one of the highlights here — they are so friendly and attentive.',
				source: 'TripAdvisor'
			},
			{
				id: 'asia-ajg',
				author: 'AJG',
				rating: 5,
				title: 'Nice place for Asian food',
				body: 'Such a great experience dining here in Geisha. All our food was served very quickly, and it was absolutely gorgeous.',
				source: 'TripAdvisor'
			}
		]
	},
	fusion: {
		average: 4.7,
		count: 352,
		tripAdvisorUrl:
			'https://www.tripadvisor.com/Restaurant_Review-g186394-d25439093-Reviews-Geisha_Fusion_Restaurant-Newcastle_upon_Tyne_Tyne_and_Wear_England.html',
		items: [
			{
				id: 'fusion-chrism',
				author: 'Chris M',
				rating: 5,
				title: 'Sublime',
				body: 'The food was exceptional — the rump steak and fries were on par with Miller and Carter if not better, and the pepperoni pizza was akin to one you would be served in Naples.',
				source: 'TripAdvisor'
			},
			{
				id: 'fusion-claireg',
				author: 'Claire G',
				rating: 5,
				title: 'Amazing food and service',
				body: 'Amazing meal as always! We had a dips starter, then for mains I had the lobster ravioli and my partner had the seabass… soooo good!',
				source: 'TripAdvisor'
			},
			{
				id: 'fusion-nigali',
				author: 'nigali',
				rating: 5,
				title: 'Fantastic family celebration meal',
				body: 'All picked from the special menu and the choice was great. The food itself was fantastic — cooked to perfection, with plenty of taste and presented perfectly.',
				source: 'TripAdvisor'
			},
			{
				id: 'fusion-nevec',
				author: 'Neve C',
				rating: 4,
				title: 'Tasty food!',
				body: 'Food was so well cooked and tasted lovely! Presentation was absolutely beautiful and all the staff were really welcoming.',
				source: 'TripAdvisor'
			}
		]
	}
};

/** Reviews for a brand — the editable-content default / fallback. */
export function getReviewsDefaults(brand: BrandId): BrandReviews {
	return REVIEWS[brand];
}
