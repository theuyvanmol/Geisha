// Editable site media (videos + the home-page feature images), extracted out of
// the route .svelte files so each slot can be (a) the rendered default and (b) the
// fallback for the editable `media` content key (see schema.ts → MediaContent).
//
// One source of truth: MEDIA_SLOTS defines every editable slot — its label, kind
// (video/image), which brand owns it, and the hardcoded default URL the public
// site used before the CMS existed. The admin Media editor renders straight off
// this list, and getMediaDefaults() builds the fallback blob from the same data,
// so adding a slot here is all it takes to make it editable.

import type { BrandId } from './brand';
import type { MediaContent } from '$lib/content/schema';

export type MediaKind = 'video' | 'image';

/** Which public screen a slot lives on — the editor groups by this. */
export type MediaSurfaceId = 'front' | 'home';

/**
 * Where on that screen the media sits. The admin draws a little wireframe of the
 * page with this region lit up, so staff can see what they're about to replace
 * without having to recognise it from a filename.
 */
export type MediaShape = 'tile-left' | 'tile-right' | 'hero' | 'band' | 'inset' | 'circle';

export interface MediaSlot {
	/** Stable key stored in the content blob. */
	key: string;
	/** Which brand's editor this slot appears under. */
	brand: BrandId;
	/** Human label shown in the admin editor. */
	label: string;
	/** What the public surface is / where it shows. */
	hint: string;
	kind: MediaKind;
	/** Which screen it appears on (groups the editor). */
	surface: MediaSurfaceId;
	/** Which region of that screen (drives the wireframe diagram). */
	shape: MediaShape;
	/** The hardcoded URL used before the CMS — the fallback when no override. */
	default: string;
}

export interface MediaSurface {
	id: MediaSurfaceId;
	/** Heading in the editor — named the way staff talk about the screen. */
	label: string;
	/** One line telling them which screen this actually is. */
	blurb: string;
	/** Public URL to open it, per brand ('front' is shared, so brand is ignored). */
	href: (brand: BrandId) => string;
}

export const MEDIA_SURFACES: MediaSurface[] = [
	{
		id: 'front',
		label: 'Front door',
		blurb:
			'The very first screen at geisharestaurant.co.uk — the two tiles a guest chooses between. One photograph each; the same still also fills the zoom-in when a tile is clicked.',
		href: () => '/'
	},
	{
		id: 'home',
		label: 'Home page',
		blurb: 'What a guest sees after they pick a restaurant.',
		href: (brand) => `/${brand}`
	}
];

// NOTE: keys must stay stable once shipped — the public pages read by key.
export const MEDIA_SLOTS: MediaSlot[] = [
	// ----- Asia -----
	{
		key: 'landingImage',
		brand: 'asia',
		label: 'Asia tile image',
		hint: 'The photograph filling the Geisha Asia tile (on the left) — and again full-screen during the zoom-in when a guest clicks it. Shares the Asia home hero portrait by default.',
		kind: 'image',
		surface: 'front',
		shape: 'tile-left',
		default: '/geisha-asia-hero.webp'
	},
	{
		key: 'heroImage',
		brand: 'asia',
		label: 'Hero background image',
		hint: 'The full-bleed portrait behind the headline at the top of the Asia home page.',
		kind: 'image',
		surface: 'home',
		shape: 'hero',
		default: '/geisha-asia-hero.webp'
	},
	{
		key: 'roomImage',
		brand: 'asia',
		label: 'Room feature image',
		hint: 'The still beside the “a room to linger in” copy, part-way down the Asia home page.',
		kind: 'image',
		surface: 'home',
		shape: 'inset',
		default: '/Content%20folder/1e039acf-7c43-43b3-bce4-4714aee9db22.jpg'
	},
	{
		key: 'blossomImage',
		brand: 'asia',
		label: 'Reserve band image',
		hint: 'The full-width photograph behind the “Book your table” call to action at the foot of the Asia home page. It sits under a heavy dark wash, so a low-key image with an empty middle reads best — the headline sits dead centre.',
		kind: 'image',
		surface: 'home',
		shape: 'band',
		default: '/Content%20folder/geisha-portrait-gold.png'
	},
	{
		key: 'aboutImage',
		brand: 'asia',
		label: '“Our Story” image',
		hint: 'The framed portrait beside the “Rooted in tradition” story block on the Asia home page.',
		kind: 'image',
		surface: 'home',
		shape: 'inset',
		default: '/geisha-asia-hero.webp'
	},
	// ----- Fusion -----
	{
		key: 'landingImage',
		brand: 'fusion',
		label: 'Fusion tile image',
		hint: 'The photograph filling the Geisha Fusion tile (on the right) — and again full-screen during the zoom-in when a guest clicks it.',
		kind: 'image',
		surface: 'front',
		shape: 'tile-right',
		default: '/geisha-fusion-landing.webp'
	},
	{
		key: 'heroImage',
		brand: 'fusion',
		label: 'Hero background image',
		hint: 'The full-bleed artwork behind the headline at the top of the Fusion home page. The copy sits on the LEFT over a dark wash, and the gold/teal rings are drawn over the right-hand side — so an image with its subject on the left and open space to the right reads best.',
		kind: 'image',
		surface: 'home',
		shape: 'hero',
		default: '/Content%20folder/fusion-hero.webp'
	},
	{
		key: 'aboutImage',
		brand: 'fusion',
		label: '“Our Story” image',
		hint: 'The framed artwork beside the “One kitchen, every craving” story block on the Fusion home page.',
		kind: 'image',
		surface: 'home',
		shape: 'inset',
		default: '/Content%20folder/fusion-story.png'
	},
	{
		key: 'roomImage',
		brand: 'fusion',
		label: 'Room band image',
		hint: 'The full-width photograph in the band part-way down the Fusion home page, under the caption about the room.',
		kind: 'image',
		surface: 'home',
		shape: 'band',
		default: '/Content%20folder/fusion-mural.png'
	},
	{
		key: 'blossomImage',
		brand: 'fusion',
		label: 'Reserve band image',
		hint: 'The full-width photograph behind the “Book your table” call to action at the foot of the Fusion home page. It sits under a heavy dark wash, so a low-key image with an empty middle reads best — the headline sits dead centre.',
		kind: 'image',
		surface: 'home',
		shape: 'band',
		default: '/Content%20folder/fusion-reserve.png'
	}
];

/** The default (fallback) media blob for a brand: every owned slot → its default URL. */
export function getMediaDefaults(brand: BrandId): MediaContent {
	const out: MediaContent = {};
	for (const slot of MEDIA_SLOTS) {
		if (slot.brand === brand) out[slot.key] = slot.default;
	}
	return out;
}

/** Slots for one brand, in editor order. */
export function mediaSlotsFor(brand: BrandId): MediaSlot[] {
	return MEDIA_SLOTS.filter((s) => s.brand === brand);
}

/** Slots on one screen, optionally narrowed to a brand. Used by the editor's groups. */
export function mediaSlotsOn(surface: MediaSurfaceId, brand?: BrandId): MediaSlot[] {
	return MEDIA_SLOTS.filter((s) => s.surface === surface && (!brand || s.brand === brand));
}

/** Stable id for one slot across brands — used for deep links (?slot=asia.heroImage). */
export function slotId(slot: Pick<MediaSlot, 'brand' | 'key'>): string {
	return `${slot.brand}.${slot.key}`;
}

/**
 * Resolve one slot's URL from a (possibly partial) saved blob, falling back to the
 * hardcoded default when the slot is missing or blank. Public pages call this so a
 * never-edited or half-edited blob still renders the original media.
 */
export function mediaUrl(media: MediaContent | undefined, brand: BrandId, key: string): string {
	const v = media?.[key]?.trim();
	if (v) return v;
	const slot = MEDIA_SLOTS.find((s) => s.brand === brand && s.key === key);
	return slot?.default ?? '';
}
