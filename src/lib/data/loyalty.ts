// The Geisha Circle — the members / loyalty programme that spans BOTH restaurants
// (one business, one Uber/social account → one rewards scheme). This file holds
// the TYPES and the DEFAULT programme content per brand.
//
// The page reads its content from the `loyalty_program` setting in
// geisha_settings (one per brand), which the admin can edit at /admin/circle.
// When that setting is absent, malformed, or PocketBase is unreachable, the page
// falls back to the defaults below — so /asia/circle and /fusion/circle are
// always beautiful and complete out of the box (mirrors the project's
// "graceful no-key" ethos). Admin edits are merged OVER these defaults, so a
// partial edit never blanks a section.
//
// NOTE: like the rest of the current site, the specific figures here are
// presentable filler — real point values/perks get set in admin once the scheme
// goes live. No backend wiring (real balances) is required to ship this page.

import type { BrandId } from './brand';

/** One rung on the membership ladder (e.g. Petal → Blossom → Geisha). */
export type LoyaltyTier = {
	id: string;
	/** Display name, e.g. "Blossom" */
	name: string;
	/** Short evocative subtitle, e.g. "the regular's table" */
	subtitle: string;
	/** Threshold to reach this tier, in points */
	threshold: number;
	/** A few headline perks unlocked at this tier */
	perks: string[];
	/** Single kanji / glyph mark for the tier (Asia leans on these) */
	mark?: string;
};

/** A way to earn points. */
export type EarnRule = {
	id: string;
	/** Big number/figure shown on the step, e.g. "10 pts" or "2×" */
	figure: string;
	title: string;
	blurb: string;
};

/** A reward a member can spend points on. */
export type Reward = {
	id: string;
	title: string;
	/** Cost in points */
	cost: number;
	blurb: string;
	/** Optional flag for a marquee / "members' favourite" reward */
	featured?: boolean;
};

export type CircleFaq = { q: string; a: string };

export type LoyaltyProgram = {
	/** Programme name, e.g. "The Geisha Circle" */
	name: string;
	/** One-line eyebrow above the hero title */
	eyebrow: string;
	/** Big hero headline (may contain a single <em>…</em> for emphasis) */
	headline: string;
	/** Supporting hero paragraph */
	intro: string;
	/** Points awarded per £1 spent (drives the "how it works" copy) */
	pointsPerPound: number;
	/** Welcome bonus on joining, in points */
	joinBonus: number;
	/** Card "tagline" line printed on the membership card mock */
	cardTagline: string;
	earn: EarnRule[];
	tiers: LoyaltyTier[];
	rewards: Reward[];
	/** Always-on member perks (shown as a simple list of lines) */
	perks: string[];
	faq: CircleFaq[];
	/** CTA button label, e.g. "Join the Circle" */
	ctaLabel: string;
	/** Small print under the CTA */
	finePrint: string;
};

// ── Shared content (both brands share the SAME programme; only the voice +
//    a couple of brand-specific rewards differ). One source, lightly themed. ──

const SHARED_TIERS = (marks: [string, string, string]): LoyaltyTier[] => [
	{
		id: 'petal',
		name: 'Petal',
		subtitle: 'where every member begins',
		threshold: 0,
		mark: marks[0],
		perks: [
			'250-point welcome gift',
			'A treat in your birthday month',
			'Members-only seasonal news'
		]
	},
	{
		id: 'blossom',
		name: 'Blossom',
		subtitle: 'the regular’s table',
		threshold: 2000,
		mark: marks[1],
		perks: [
			'Earn points 1.5× faster',
			'Priority booking on busy nights',
			'A complimentary dish on us each season'
		]
	},
	{
		id: 'geisha',
		name: 'Geisha',
		subtitle: 'our inner circle',
		threshold: 6000,
		mark: marks[2],
		perks: [
			'Earn points 2× faster',
			"The chef's table & tasting previews",
			'A standing table held for you',
			'A dinner for two, on the house, each year'
		]
	}
];

const SHARED_FAQ: CircleFaq[] = [
	{
		q: 'How do I join?',
		a: 'Tap “Join the Circle”, add your name and email, and you’re in — no card to carry. We’ll find you by the phone number or email on your booking.'
	},
	{
		q: 'Does it work at both restaurants?',
		a: 'Yes. One Circle covers Geisha Asia and Geisha Fusion — earn at one, spend at either. It’s all the same family.'
	},
	{
		q: 'When do points land?',
		a: 'Points appear on your account within 24 hours of your visit, whether you booked a table, collected, or ordered in.'
	},
	{
		q: 'Do points expire?',
		a: 'Only if you’re away a long while — points rest after 18 months of no visits. One meal wakes them all back up.'
	}
];

export const LOYALTY_DEFAULTS: Record<BrandId, LoyaltyProgram> = {
	asia: {
		name: 'The Geisha Circle',
		eyebrow: 'Members · Geisha Asia',
		headline: 'Every visit earns its <em>reward</em>.',
		intro:
			'The Geisha Circle is our way of thanking the people who make the room. Dine, collect, or order in — gather points with every plate, climb three quiet tiers, and unwind them on the things you actually want: a round of sushi, a standing table, a night that’s on us.',
		pointsPerPound: 10,
		joinBonus: 250,
		cardTagline: 'Front Street, Benton · est. for regulars',
		earn: [
			{
				id: 'dine',
				figure: '10 pts',
				title: 'For every £1 you spend',
				blurb:
					'Dining in, collecting, or ordering on Uber Eats — it all counts towards the same balance.'
			},
			{
				id: 'join',
				figure: '250',
				title: 'Just for joining',
				blurb: 'A welcome gift lands the moment you become a member. Consider it the first round.'
			},
			{
				id: 'birthday',
				figure: '🎂',
				title: 'On your birthday',
				blurb:
					'A little something waits for you every birthday month — our favourite excuse to see you.'
			},
			{
				id: 'bring',
				figure: '2×',
				title: 'Bring the table',
				blurb:
					'Book for six or more and the whole table earns double on the night. Generosity, rewarded.'
			}
		],
		tiers: SHARED_TIERS(['花', '華', '芸']),
		rewards: [
			{
				id: 'edamame',
				title: 'Edamame & a glass of house sake',
				cost: 600,
				blurb: 'The opening you didn’t order, on the house.'
			},
			{
				id: 'roll',
				title: 'Any signature sushi roll',
				cost: 1200,
				blurb: 'Eight pieces of whatever the chef is proudest of today.',
				featured: true
			},
			{
				id: 'cocktail',
				title: 'Two signature cocktails',
				cost: 1400,
				blurb: 'Mixed to order — the 2-for-£14 pair, on points instead.'
			},
			{
				id: 'dimsum',
				title: 'A dim sum feast for two',
				cost: 2600,
				blurb: 'A spread of the steamer favourites to share.'
			},
			{
				id: 'tasting',
				title: 'Chef’s tasting for two',
				cost: 5000,
				blurb: 'A guided run through the kitchen’s best — Blossom tier and up.'
			},
			{
				id: 'dinner',
				title: 'Dinner for two, on us',
				cost: 8000,
				blurb: 'The whole evening, our treat. The Circle’s headline reward.',
				featured: true
			}
		],
		perks: [
			'One Circle across Geisha Asia & Geisha Fusion',
			'No card to carry — we find you by your booking',
			'Members-only seasonal menus & previews',
			'Points on dine-in, collection and Uber Eats alike'
		],
		faq: SHARED_FAQ,
		ctaLabel: 'Join the Circle',
		finePrint:
			'Free to join. Points have no cash value. Full terms apply. One membership per guest, valid across both Geisha restaurants in Benton, Newcastle.'
	},
	fusion: {
		name: 'The Geisha Circle',
		eyebrow: 'Members · Geisha Fusion',
		headline: 'Good times, <em>earned back</em>.',
		intro:
			'The Geisha Circle rewards the people who keep coming back. Burgers and curries, the Sunday roast, a bottomless brunch with friends — every visit gathers points you can spend on the food you already love, across both Geisha restaurants.',
		pointsPerPound: 10,
		joinBonus: 250,
		cardTagline: 'Front Street, Benton · for the regulars',
		earn: [
			{
				id: 'dine',
				figure: '10 pts',
				title: 'For every £1 you spend',
				blurb: 'Eat in, collect, or order on Uber Eats — it all lands on the same balance.'
			},
			{
				id: 'join',
				figure: '250',
				title: 'Just for joining',
				blurb: 'A welcome gift the moment you sign up. First one’s on us.'
			},
			{
				id: 'birthday',
				figure: '🎂',
				title: 'On your birthday',
				blurb: 'A treat every birthday month — bring the family, it’s our shout.'
			},
			{
				id: 'sunday',
				figure: '2×',
				title: 'Double on Sundays',
				blurb: 'The Sunday roast earns double points, every single week.'
			}
		],
		tiers: SHARED_TIERS(['◔', '◑', '●']),
		rewards: [
			{
				id: 'side',
				title: 'A side & a soft drink',
				cost: 500,
				blurb: 'Loaded fries, a cold one — sorted.'
			},
			{
				id: 'burger',
				title: 'Any signature burger',
				cost: 1100,
				blurb: 'Build it your way. The members’ favourite.',
				featured: true
			},
			{
				id: 'curry',
				title: 'Curry & rice for one',
				cost: 1300,
				blurb: 'From mild to “are you sure?”, your call.'
			},
			{
				id: 'roast',
				title: 'Sunday roast for two',
				cost: 2600,
				blurb: 'All the trimmings, twice over.'
			},
			{
				id: 'brunch',
				title: 'Bottomless brunch for two',
				cost: 5000,
				blurb: '90 minutes of free-flowing drinks — Blossom tier and up.'
			},
			{
				id: 'dinner',
				title: 'Dinner for the family, on us',
				cost: 8000,
				blurb: 'The whole table, our treat. The Circle’s headline reward.',
				featured: true
			}
		],
		perks: [
			'One Circle across Geisha Fusion & Geisha Asia',
			'No card to carry — we find you by your booking',
			'Family-friendly rewards & school-holiday treats',
			'Points on dine-in, collection and Uber Eats alike'
		],
		faq: SHARED_FAQ,
		ctaLabel: 'Join the Circle',
		finePrint:
			'Free to join. Points have no cash value. Full terms apply. One membership per guest, valid across both Geisha restaurants in Benton, Newcastle.'
	}
};

/**
 * Merge an admin-supplied (possibly partial / possibly JSON-string) override
 * over the brand defaults. Top-level scalars override; the list/array sections
 * replace wholesale ONLY when the override provides a non-empty array, so a
 * partial admin edit can never blank out a section. Unknown shapes are ignored
 * and the defaults stand. Pure + safe to run on client or server.
 */
export function resolveLoyaltyProgram(brand: BrandId, override: unknown): LoyaltyProgram {
	const base = LOYALTY_DEFAULTS[brand];
	let o: Record<string, unknown> | null = null;
	if (typeof override === 'string') {
		try {
			o = JSON.parse(override);
		} catch {
			o = null;
		}
	} else if (override && typeof override === 'object') {
		o = override as Record<string, unknown>;
	}
	if (!o) return base;

	const str = (k: keyof LoyaltyProgram, fallback: string): string =>
		typeof o![k] === 'string' ? (o![k] as string) : fallback;
	const num = (k: keyof LoyaltyProgram, fallback: number): number =>
		typeof o![k] === 'number' && Number.isFinite(o![k]) ? (o![k] as number) : fallback;
	const arr = <T>(k: keyof LoyaltyProgram, fallback: T[]): T[] =>
		Array.isArray(o![k]) && (o![k] as unknown[]).length ? (o![k] as T[]) : fallback;

	return {
		name: str('name', base.name),
		eyebrow: str('eyebrow', base.eyebrow),
		headline: str('headline', base.headline),
		intro: str('intro', base.intro),
		pointsPerPound: num('pointsPerPound', base.pointsPerPound),
		joinBonus: num('joinBonus', base.joinBonus),
		cardTagline: str('cardTagline', base.cardTagline),
		earn: arr<EarnRule>('earn', base.earn),
		tiers: arr<LoyaltyTier>('tiers', base.tiers),
		rewards: arr<Reward>('rewards', base.rewards),
		perks: arr<string>('perks', base.perks),
		faq: arr<CircleFaq>('faq', base.faq),
		ctaLabel: str('ctaLabel', base.ctaLabel),
		finePrint: str('finePrint', base.finePrint)
	};
}
