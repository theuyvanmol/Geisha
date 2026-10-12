// Site announcement banner — a single, brand-scoped promo the venue can flip on
// to shout about something timely (e.g. "Nominated for Uber Eats Restaurant of
// the Year"). It renders in two places on the public site: a dismissible strip
// pinned across the top of every page, and — when `showHero` is on — a larger
// hero block on the brand home page.
//
// Like the rest of the CMS (see media.ts / offers.ts), this file is the single
// source of truth for the shape + the hardcoded DEFAULT (fallback) blob. The
// admin Banner editor writes the editable `banner` content key; when no override
// exists (or PB is down) the public site falls back to getBannerDefault(), which
// ships DISABLED so nothing shows until the venue turns it on.

import type { BrandId } from './brand';

/** The visual presets the editor offers (keeps the public CSS to a known set). */
export type BannerStyle = 'accent' | 'dark' | 'light' | 'gold';

export const BANNER_STYLES: { value: BannerStyle; label: string }[] = [
	{ value: 'accent', label: 'Brand accent' },
	{ value: 'gold', label: 'Gold / award' },
	{ value: 'dark', label: 'Dark' },
	{ value: 'light', label: 'Light' }
];

export interface Banner {
	/** Master on/off. When false the banner shows nowhere, whatever else is set. */
	enabled: boolean;
	/** Short bold line, e.g. "Nominated — Uber Eats Restaurant of the Year". */
	heading: string;
	/** Optional supporting sentence under the heading. */
	body: string;
	/** Optional image / logo / award badge URL (from the media library or a URL). */
	image: string;
	/** Optional call-to-action link. Empty href → no button (whole strip still shows). */
	ctaLabel: string;
	/** Where the CTA goes — an internal path (/offers) or a full external URL. */
	ctaHref: string;
	/** Open the CTA in a new tab (sensible for external voting/press links). */
	ctaNewTab: boolean;
	/** Visual preset. */
	style: BannerStyle;
	/** Also show the larger hero block on the brand home page (strip shows regardless). */
	showHero: boolean;
}

/** The shipped default: OFF, so nothing appears until the venue enables it. */
export function getBannerDefault(_brand: BrandId): Banner {
	return {
		enabled: false,
		heading: '',
		body: '',
		image: '',
		ctaLabel: '',
		ctaHref: '',
		ctaNewTab: false,
		style: 'accent',
		showHero: false
	};
}

/** True when the banner should actually render publicly (on + has a heading). */
export function bannerIsLive(b: Banner | undefined | null): b is Banner {
	return !!b && b.enabled && b.heading.trim().length > 0;
}
