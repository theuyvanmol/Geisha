// Current promotions per brand. Drives the homepage promo strip and the
// /offers (What's On) page. Real details from current menus (2026). Edit here
// to change what's promoted — no markup edits. `href` links to the HTML menu
// where one exists, otherwise to the offers page.

import type { BrandId } from './brand';

export type Offer = {
	id: string;
	title: string;
	blurb: string;
	/** e.g. "Mon–Fri 12–5pm", "Every Sunday" */
	when: string;
	/** optional headline price, e.g. "£15" */
	price?: string;
	/** optional menu link */
	href?: string;
	/**
	 * Wording for the button on the home page's specials banner ("Book Now",
	 * "View Brunch Menu"…). Falls back to the price ("View — £15") when unset.
	 */
	cta?: string;
	/** optional image for the offer card */
	img?: string;
	/**
	 * How `img` behaves in the home page's specials banner.
	 *  'cover'  (default) — a photograph, cropped to fill, with the title/blurb set over it.
	 *  'poster' — finished promo artwork that already carries its own wording. It is
	 *             shown whole (never cropped) and the banner suppresses the title,
	 *             when-line and blurb so the words aren't printed twice.
	 */
	imgFit?: 'cover' | 'poster';
	/** flag delivery-eligible offers with the Uber Eats badge */
	delivery?: boolean;
};

export const OFFERS: Record<BrandId, Offer[]> = {
	asia: [
		{
			id: 'daytime',
			title: 'Daytime Special',
			blurb: 'Mix & match any two dishes from the daytime menu.',
			when: 'Mon–Fri, 12pm – 5pm',
			price: '£15',
			href: '/asia/menus/daytime-special',
			img: '/geisha-asia-special-daytime.webp',
			cta: 'View Daytime Special'
		},
		{
			id: 'restaurant-week',
			title: 'Restaurant Week',
			blurb: 'A starter and a main, from the Restaurant Week selection.',
			// Transcribed from the poster artwork itself, so the two can't disagree.
			when: 'Mon–Thu all day · Fri & Sat until 4pm · Sunday all day',
			price: '£20',
			href: '/asia/bookings',
			img: '/geisha-asia-special-restaurant-week.webp',
			imgFit: 'poster',
			cta: 'Book Now'
		},
		{
			id: 'evening',
			title: 'Evening Special',
			blurb: 'A starter and a main from our evening selection.',
			when: 'Mon–Thu from 5pm & all day Sunday',
			price: '£23.50',
			href: '/asia/menus/evening-special'
		},
		{
			id: '2for14',
			title: '2 for £14 Cocktails',
			blurb: 'Two of the same signature cocktail, mixed to order.',
			when: 'All day Sun–Thu / Fri until 5pm',
			price: '£14',
			href: '/asia/menus/cocktails',
			// Finished artwork from the design pack — it carries its own wording, so
			// the home banner shows it whole and drops the title/blurb over the top.
			img: '/geisha-asia-special-cocktails.webp',
			imgFit: 'poster',
			cta: 'View Cocktail Menu'
		},
		{
			id: 'brunch',
			title: 'Bottomless Brunch',
			blurb: '90 minutes of free-flowing drinks with three pan-Asian dishes each.',
			when: 'Sun–Thu all day / Fri & Sat 12–4:30pm',
			price: '£40pp',
			href: '/asia/menus/bottomless-brunch'
		}
	],
	fusion: [
		{
			id: 'restaurant-week',
			title: 'Restaurant Week',
			blurb: 'Two or three courses from the Restaurant Week selection.',
			// Transcribed from the poster artwork itself, so the two can't disagree.
			when: 'Available all day, Monday – Sunday',
			price: '£15 / £20',
			href: '/fusion/bookings',
			// Finished artwork from the design pack — it carries its own wording, so
			// the home banner shows it whole and drops the title/blurb over the top.
			img: '/Content%20folder/fusion-special-restaurant-week.png',
			imgFit: 'poster',
			cta: 'Book Now'
		},
		{
			id: 'sunday-roast',
			title: 'Traditional Sunday Roast',
			blurb: "Served all day 'til it's gone.",
			when: 'Every Sunday',
			price: 'From £14.95',
			href: '/fusion/menus/sunday-roast',
			img: '/Content%20folder/fusion-special-sunday-roast.png',
			imgFit: 'poster',
			cta: 'View Sunday Menu'
		},
		{
			id: 'special',
			title: 'Special Menu',
			blurb: 'Two courses from our seasonal special selection.',
			when: 'Limited time',
			price: '£17.95',
			href: '/fusion/menus/special',
			img: '/images/specials/fusion-special-menu.webp',
			imgFit: 'poster',
			cta: 'View Special Menu'
		},
		// NB: Fusion has NO lunch special — a "Lunch Special, Mon–Fri 12–5:30pm"
		// offer used to sit here and was advertising something the kitchen doesn't
		// run. (Asia's Daytime Special is real; Fusion's isn't.) Its Special Menu
		// above is the 1/2/3-course deal and is not time-restricted to lunch.
		{
			id: 'brunch',
			title: 'Bottomless Brunch',
			blurb: '90 minutes of free-flowing drinks with three dishes each.',
			when: 'Mon–Thu all day / Fri & Sat 12–5:30pm',
			price: '£35pp',
			href: '/fusion/menus/bottomless-brunch',
			img: '/images/specials/fusion-bottomless-brunch.webp',
			imgFit: 'poster',
			cta: 'View Brunch Menu'
		}
	]
};

/** Offers for a brand — the editable-content default / fallback. */
export function getOffersDefaults(brand: BrandId): Offer[] {
	return OFFERS[brand];
}
