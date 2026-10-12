// Zod schemas + TS types for the editable-content blobs (the CMS keys).
//
// These mirror the hand-maintained shapes in src/lib/data/* (GalleryImage, Menu,
// the home copy, the editable brand subset). Every admin save validates against
// these server-side, so a malformed blob can never reach the public renderer.
// Pure validation — no server-only imports — so editors can import it too.

import { z } from 'zod';

// ----- gallery (mirrors GalleryImage in src/lib/data/gallery.ts) -----
export const GalleryImageSchema = z.object({
	src: z.string().min(1),
	alt: z.string().default(''),
	category: z.enum(['food', 'interior', 'cocktails', 'events']),
	featured: z.boolean().optional(),
	title: z.string().optional(),
	caption: z.string().optional()
});
export const GallerySchema = z.array(GalleryImageSchema);
export type GalleryContent = z.infer<typeof GallerySchema>;

// ----- menus (mirrors Menu/MenuSection/MenuItem in src/lib/data/menu-types.ts) -----
const DietTagSchema = z.enum(['v', 'vg', 'gf', 'spicy', 'new']);
export const MenuItemSchema = z.object({
	name: z.string().min(1),
	jp: z.string().optional(),
	desc: z.string().optional(),
	price: z.string().optional(),
	/** optional dish photo (chosen from the media library / uploaded) */
	img: z.string().optional(),
	tags: z.array(DietTagSchema).optional(),
	allergens: z.array(z.string()).optional()
});
export const MenuSectionSchema = z.object({
	title: z.string().min(1),
	note: z.string().optional(),
	items: z.array(MenuItemSchema)
});
export const MenuSchema = z.object({
	slug: z
		.string()
		.min(1)
		.regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers and dashes'),
	title: z.string().min(1),
	subtitle: z.string().optional(),
	pdf: z.string().optional(),
	/** Cover photo for this menu's card on the /menus selector. Falls back to the
	 *  per-slug default in FusionMenuGallery when unset. */
	img: z.string().optional(),
	sections: z.array(MenuSectionSchema)
});
export const MenusSchema = z.array(MenuSchema);
export type MenusContent = z.infer<typeof MenusSchema>;

// ----- home (editable editorial copy; defaults extracted to src/lib/data/home.ts) -----
export const HomeSchema = z.object({
	heroEyebrow: z.string().default(''),
	/** Hero display title, one entry per animated line (DOM structure preserved). */
	heroTitleLines: z.array(z.string()).default([]),
	heroLine: z.string().default(''),
	/** "Our Story" block (Asia): eyebrow + heading above the statement paragraphs. */
	aboutEyebrow: z.string().default(''),
	aboutTitle: z.string().default(''),
	/** The gold caption plaque overlapping the story image. */
	aboutTag: z.string().default(''),
	statementLead: z.string().default(''),
	statementColLeft: z.string().default(''),
	statementColRight: z.string().default(''),
	bandEyebrow: z.string().default(''),
	bandLine: z.string().default(''),
	roomLine: z.string().default('')
});
export type HomeContent = z.infer<typeof HomeSchema>;

// ----- brand_info (editable subset of Brand in src/lib/data/brand.ts) -----
export const DayHoursSchema = z.object({ day: z.string(), hours: z.string() });
export const BrandInfoSchema = z.object({
	tagline: z.string().default(''),
	about: z.string().default(''),
	phone: z.string().default(''),
	email: z.string().default(''),
	address: z.object({
		line1: z.string().default(''),
		city: z.string().default(''),
		postcode: z.string().default(''),
		metro: z.string().default('')
	}),
	hours: z.array(DayHoursSchema).default([]),
	hoursNote: z.string().optional()
});
export type BrandInfoContent = z.infer<typeof BrandInfoSchema>;

// ----- offers (mirrors Offer in src/lib/data/offers.ts) -----
export const OfferSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	blurb: z.string().default(''),
	when: z.string().default(''),
	price: z.string().optional(),
	href: z.string().optional(),
	/** Button wording on the home specials banner; falls back to the price. */
	cta: z.string().optional(),
	img: z.string().optional(),
	/** 'poster' = finished artwork, shown whole with its own wording (see Offer). */
	imgFit: z.enum(['cover', 'poster']).optional(),
	delivery: z.boolean().optional()
});
export const OffersSchema = z.array(OfferSchema);
export type OffersContent = z.infer<typeof OffersSchema>;

// ----- reviews (mirrors BrandReviews/Review in src/lib/data/reviews.ts) -----
export const ReviewSchema = z.object({
	id: z.string().min(1),
	author: z.string().min(1),
	rating: z.number().min(1).max(5),
	title: z.string().default(''),
	body: z.string().default(''),
	source: z.string().default('TripAdvisor')
});
export const ReviewsSchema = z.object({
	average: z.number().min(0).max(5),
	count: z.number().int().min(0),
	tripAdvisorUrl: z.string().default(''),
	items: z.array(ReviewSchema)
});
export type ReviewsContent = z.infer<typeof ReviewsSchema>;

// ----- home_extra (the rest of the editable home editorial not covered by `home`) -----
// Fusion's intro/marks/story/menu blocks + featured dishes, plus each brand's
// marquee words and a couple of one-off notes. All optional with defaults in
// src/lib/data/home-extra.ts, so a partial save never blanks a section.
const HomeMarkSchema = z.object({
	n: z.string().default(''),
	l: z.string().default(''),
	p: z.string().default('')
});
const HomeDishSchema = z.object({
	img: z.string().default(''),
	name: z.string().default(''),
	desc: z.string().default(''),
	tag: z.string().default('')
});
export const HomeExtraSchema = z.object({
	/** Animated marquee words (both brands). */
	marqueeWords: z.array(z.string()).default([]),
	// --- Asia-only one-offs ---
	walkinsNote: z.string().default(''),
	// --- Fusion intro band ---
	introKicker: z.string().default(''),
	introHeading: z.string().default(''),
	introBody: z.string().default(''),
	marks: z.array(HomeMarkSchema).default([]),
	// --- Fusion menu band ---
	menuKicker: z.string().default(''),
	menuHeading: z.string().default(''),
	menuSub: z.string().default(''),
	dishes: z.array(HomeDishSchema).default([]),
	// --- Fusion story band ---
	storyHeading: z.string().default(''),
	storyBody1: z.string().default(''),
	storyBody2: z.string().default('')
});
export type HomeExtraContent = z.infer<typeof HomeExtraSchema>;

// ----- media (editable videos + feature images per brand; defaults in src/lib/data/media.ts) -----
//
// A flat map of named "slots" — each slot is one media URL the public site reads
// (hero videos, the landing tile clips, the home feature stills). Stored as a
// partial map: an absent/blank slot means "use the hardcoded default", so saving
// only the slots you changed is fine and forward-compatible if we add slots later.
//
// Slot keys (see MEDIA_SLOTS for labels):
//   landingImage     — this brand's tile photograph on the landing (+ zoom transition)
//   heroImage        — hero background still (Asia portrait / Fusion arched room)
//   aboutImage       — Asia "Our Story" framed still
//   roomImage        — Asia "a room to linger in" feature still
//   blossomImage     — Asia full-bleed band behind the closing "Book your table" CTA
//   plateVideo       — Fusion circular PlateMotif disc clip
export const MediaSchema = z.record(z.string(), z.string());
export type MediaContent = z.infer<typeof MediaSchema>;

// ----- banner (site announcement strip + optional home hero; defaults in src/lib/data/banner.ts) -----
//
// One banner per brand. Stored whole; when absent the public site falls back to
// getBannerDefault() (which is disabled), so nothing shows until it's turned on.
export const BannerSchema = z.object({
	enabled: z.boolean().default(false),
	heading: z.string().default(''),
	body: z.string().default(''),
	image: z.string().default(''),
	ctaLabel: z.string().default(''),
	ctaHref: z.string().default(''),
	ctaNewTab: z.boolean().default(false),
	style: z.enum(['accent', 'dark', 'light', 'gold']).default('accent'),
	showHero: z.boolean().default(false)
});
export type BannerContent = z.infer<typeof BannerSchema>;

// ----- pages (copy for the interior pages: parties / order / privacy / contact) -----
//
// These four pages had their copy hardcoded in the panel components, so staff
// could not touch a word of them. Every field is optional with a default, so a
// partial save can never blank a section, and the copy supports `{token}`
// placeholders for brand details — see src/lib/data/pages.ts.
export const PartiesPageSchema = z.object({
	title: z.string().default(''),
	lead: z.string().default(''),
	intro: z.string().default(''),
	occasions: z.array(z.string()).default([]),
	enquiryHeading: z.string().default(''),
	thanks: z.string().default(''),
	altLine: z.string().default(''),
	/** Private-hire leaflet, e.g. '/geisha_fusion_private_hire.pdf'. The download
	 *  button only renders when this is set, so the page is never left offering a
	 *  link to a PDF nobody has uploaded. */
	leafletUrl: z.string().default(''),
	leafletLabel: z.string().default('')
});
export const OrderPageSchema = z.object({
	eyebrow: z.string().default(''),
	title: z.string().default(''),
	lead: z.string().default(''),
	deliveryProvider: z.string().default(''),
	deliveryHeading: z.string().default(''),
	deliveryBody: z.string().default(''),
	deliveryFine: z.string().default(''),
	takeawayProvider: z.string().default(''),
	takeawayHeading: z.string().default(''),
	takeawayBody: z.string().default(''),
	takeawayCtaLabel: z.string().default(''),
	takeawayFine: z.string().default('')
});
export const PrivacyPageSchema = z.object({
	title: z.string().default(''),
	subtitle: z.string().default(''),
	sections: z
		.array(z.object({ heading: z.string().default(''), body: z.string().default('') }))
		.default([])
});
export const ContactPageSchema = z.object({
	title: z.string().default(''),
	lead: z.string().default(''),
	thanks: z.string().default(''),
	formNote: z.string().default(''),
	mapEmbedUrl: z.string().default(''),
	mapLinkUrl: z.string().default('')
});
// Each page defaults to "all its own field defaults" so a blob saved before a
// page was added still validates. Zod 4 types .default() against the OUTPUT type,
// so the default is produced by parsing {} through the sub-schema rather than
// written out as a literal — one source of truth, and it can't drift.
export const PagesSchema = z.object({
	parties: PartiesPageSchema.default(() => PartiesPageSchema.parse({})),
	order: OrderPageSchema.default(() => OrderPageSchema.parse({})),
	privacy: PrivacyPageSchema.default(() => PrivacyPageSchema.parse({})),
	contact: ContactPageSchema.default(() => ContactPageSchema.parse({}))
});
export type PagesContent = z.infer<typeof PagesSchema>;

/** The content keys we manage. Each maps to one admin editor + one public surface. */
export type ContentKey =
	| 'gallery'
	| 'menus'
	| 'home'
	| 'brand_info'
	| 'media'
	| 'offers'
	| 'reviews'
	| 'home_extra'
	| 'banner'
	| 'pages';

/** The validator for each content key — used by the admin save actions. */
export const SCHEMA_BY_KEY = {
	gallery: GallerySchema,
	menus: MenusSchema,
	home: HomeSchema,
	brand_info: BrandInfoSchema,
	media: MediaSchema,
	offers: OffersSchema,
	reviews: ReviewsSchema,
	home_extra: HomeExtraSchema,
	banner: BannerSchema,
	pages: PagesSchema
} satisfies Record<ContentKey, z.ZodType>;
