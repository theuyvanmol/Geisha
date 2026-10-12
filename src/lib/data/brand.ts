// Single source of truth for both restaurants. Real-world facts (Benton,
// Newcastle) live here so every page/component reads the same data. Layout and
// per-brand "vibe" stay in the route files + theme tokens; this is just data.

export type BrandId = 'asia' | 'fusion';

export type DayHours = { day: string; hours: string };

export type Brand = {
	id: BrandId;
	/** Display name, e.g. "Geisha Asia" */
	name: string;
	/** Short label used in nav/marks, e.g. "Asia" */
	short: string;
	/** One-line positioning strap */
	tagline: string;
	/**
	 * The concrete food signals that tell the two restaurants apart, for places
	 * where a guest has to answer "am I booking the right one?".
	 *
	 * Deliberately NOT `tagline` — "Family-friendly global fusion" is positioning,
	 * and it wouldn't stop someone who came for a curry from booking Asia. The two
	 * share a name, a street and a postcode, so dish names are the only thing that
	 * actually distinguishes them at a glance. Staff report guests regularly
	 * booking the wrong restaurant (owner, Aug 2026).
	 */
	dishes: string;
	/** Longer about/intro paragraph (real, elegant copy) */
	about: string;

	// Contact / location (shared building, separate phone+email)
	phone: string;
	email: string;
	address: {
		line1: string;
		city: string;
		postcode: string;
		metro: string;
	};

	/**
	 * FALLBACK opening hours only, ordered Mon→Sun.
	 *
	 * The site renders its hours from the live service periods
	 * (geisha_service_periods — the same rows the admin diary books against) via
	 * $lib/server/booking/hours.ts. This table is used ONLY when those can't be
	 * read, so the site degrades instead of 500ing. Keep it roughly right, but
	 * change real opening times in Admin → Settings → Service times.
	 */
	hours: DayHours[];
	/** Extra kitchen / last-order note shown under hours. Editable in
	 *  Admin → Content → Text (brand_info.hoursNote). Don't restate the opening
	 *  or last-booking times here — those are rendered from the periods above it. */
	hoursNote?: string;

	// Integrations
	bookingUrl: string; // bespoke in-house booking widget route (replaces ResDiary)
	uberEatsUrl: string; // delivery — real per-brand store
	touchTakeawayUrl: string; // collection / at-home (ICRTouch — unchanged, external)
	dishCultUrl?: string;

	// Social (shared account across both brands)
	instagram: string;
	facebook: string;
	instagramHandle: string;

	// Theme accents (mirrors theme/tokens.css; handy for inline use)
	colors: {
		bg: string;
		ink: string;
		accent: string;
		accent2?: string;
	};
};

const SOCIAL = {
	instagram: 'https://www.instagram.com/geisharestaurants/',
	facebook: 'https://www.facebook.com/geisharestaurants/',
	instagramHandle: '@geisharestaurants'
};

const ADDRESS = {
	line1: 'Front Street, Benton',
	city: 'Newcastle Upon Tyne',
	postcode: 'NE12 8AE',
	metro: 'Four Lane Ends (0.4 miles / 700 yards)'
};

export const BRANDS: Record<BrandId, Brand> = {
	asia: {
		id: 'asia',
		name: 'Geisha Asia',
		short: 'Asia',
		tagline: 'Modern Japanese-inspired · pan-Asian',
		dishes: 'Sushi, sashimi, dim sum, robata & ramen',
		about:
			'Geisha Asia is a modern, Japanese-inspired restaurant offering an exquisite dining experience. Our pan-Asian menu features delicious sushi, dim sum and a variety of other mouth-watering dishes. With its Japanese garden inspired design, it is the perfect place to enjoy a meal with family and friends — whether a romantic dinner for two or a fun night out.',
		phone: '0191 607 1100',
		email: 'asia@geisharestaurants.co.uk',
		address: ADDRESS,
		hours: [
			{ day: 'Monday', hours: '12pm – 11pm' },
			{ day: 'Tuesday', hours: '12pm – 11pm' },
			{ day: 'Wednesday', hours: '12pm – 11pm' },
			{ day: 'Thursday', hours: '12pm – 11pm' },
			{ day: 'Friday', hours: '12pm – 11pm' },
			{ day: 'Saturday', hours: '12pm – 11pm' },
			{ day: 'Sunday', hours: '12pm – 11pm' }
		],
		hoursNote:
			'Daytime menu available all day Mon–Fri until 5pm. Kitchen closes 9:30pm (starters and mains served at the same time).',
		bookingUrl: '/asia/bookings',
		uberEatsUrl: 'https://www.ubereats.com/gb/store/geisha-asia-at-home/kNXKTsjHUDGUTtcG8Oif1g',
		touchTakeawayUrl: 'https://geisha.touchtakeaway.net/store',
		dishCultUrl: 'https://www.dishcult.com/restaurant/geishaasia',
		...SOCIAL,
		colors: { bg: '#0e0c0a', ink: '#e8dcc4', accent: '#d4a04c', accent2: '#b8722a' }
	},
	fusion: {
		id: 'fusion',
		name: 'Geisha Fusion',
		short: 'Fusion',
		tagline: 'Family-friendly global fusion',
		dishes: 'Pizza, pasta, grill, burgers & Sunday roast',
		about:
			'Embark on a delightful culinary journey at Geisha Fusion! Our family-friendly restaurant presents a vibrant array of dishes from across the globe. Our diverse menu blends classic favourites with modern twists — whether you are in the mood for an American-style burger or a mouth-watering curry, our chefs are ready to serve up the best flavours to delight your palate.',
		phone: '0191 300 4641',
		email: 'fusion@geisharestaurants.co.uk',
		address: ADDRESS,
		// Fallback only — mirrors the live periods (Lunch + Dinner Mon–Sat to 23:00,
		// Sunday service to 19:30). Mon–Thu used to say 10pm here, which is what the
		// footer and Google both advertised while the diary sold to 11pm.
		hours: [
			{ day: 'Monday', hours: '12pm – 11pm' },
			{ day: 'Tuesday', hours: '12pm – 11pm' },
			{ day: 'Wednesday', hours: '12pm – 11pm' },
			{ day: 'Thursday', hours: '12pm – 11pm' },
			{ day: 'Friday', hours: '12pm – 11pm' },
			{ day: 'Saturday', hours: '12pm – 11pm' },
			{ day: 'Sunday', hours: '12pm – 7:30pm' }
		],
		// No lunch-special line here: Fusion doesn't run one (that's Asia's Daytime
		// Special). This used to advertise "Lunch Special served Mon–Fri 12pm–5:30pm".
		hoursNote: 'Sunday last bookings exclude bank holiday weekends.',
		bookingUrl: '/fusion/bookings',
		uberEatsUrl: 'https://www.ubereats.com/gb/store/geisha-fusion/LHI0h0B4UiiW21CY-uLEaQ',
		touchTakeawayUrl: 'https://geisha.touchtakeaway.net/store',
		...SOCIAL,
		colors: { bg: '#0a0d0b', ink: '#f2ece0', accent: '#dd8236', accent2: '#ef3c5c' }
	}
};

export function getBrand(id: BrandId): Brand {
	return BRANDS[id];
}

/**
 * The editable subset of a brand's facts (tagline, about, contact, hours) — the
 * fallback for the `brand_info` content key. Non-editable facts (URLs, colors,
 * social) stay solely in BRANDS so a stale override can't shadow a code change.
 * The loader merges: { ...getBrand(brand), ...override }.
 */
export function getBrandInfoDefaults(id: BrandId): {
	tagline: string;
	about: string;
	phone: string;
	email: string;
	address: Brand['address'];
	hours: DayHours[];
	hoursNote?: string;
} {
	const b = BRANDS[id];
	return {
		tagline: b.tagline,
		about: b.about,
		phone: b.phone,
		email: b.email,
		address: { ...b.address },
		hours: b.hours.map((h) => ({ ...h })),
		hoursNote: b.hoursNote
	};
}
