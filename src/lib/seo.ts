// Site-wide SEO constants.
//
// Ported from the live WordPress site (geisharestaurants.co.uk) during the
// rebuild, plus the pieces that site never had:
//
//   FROM THE LIVE SITE   canonical URLs, `max-image-preview:large`, the
//                        Facebook domain-verification token, the per-page
//                        title pattern ("Menus – Geisha Asia …").
//   NEW HERE             Open Graph + Twitter cards. The WordPress head carried
//                        none, so every link shared to WhatsApp/Facebook/iMessage
//                        rendered as a bare URL with no image.
//
// The `<meta name="facebook-domain-verification">` token lives in app.html
// (it has to be on every page, including ones that never mount <Seo />).

import type { BrandId } from '$lib/data/brand';

/**
 * Canonical origin. Every canonical/og:url is built from this rather than from
 * the request host, so a preview deploy (…vercel.app) or a bare-IP hit still
 * points search engines at the real domain instead of self-canonicalising a
 * duplicate of the whole site.
 */
export const SITE_URL = 'https://geisharestaurants.co.uk';

export const SITE_NAME = 'Geisha Restaurants';

/**
 * Share images, 1200×630 (the 1.91:1 Facebook/Twitter expect).
 *
 * Cropped from the client's own photography (sushi for Asia, fish and chips for
 * Fusion, the mural room for the landing splitter) with:
 *
 *   sharp(src).resize(1200, 630, { fit: 'cover', position: 'attention' })
 *
 * Deliberately committed JPEGs under static/, not the R2 WebP ladder every other
 * image uses: several scrapers (WhatsApp in particular) still skip WebP and fall
 * back to no preview at all, and a share image that 404s is worse than none.
 */
export const OG_IMAGE: Record<BrandId | 'geisha', string> = {
	geisha: '/og/og-geisha.jpg',
	asia: '/og/og-asia.jpg',
	fusion: '/og/og-fusion.jpg'
};

/** Turn a site-relative path into the absolute URL crawlers require. */
export function absolute(path: string): string {
	return /^https?:\/\//.test(path) ? path : `${SITE_URL}${path}`;
}

/**
 * The canonical form of a pathname.
 *
 * The old WordPress site served trailing slashes (`/asia/`); SvelteKit serves
 * `/asia`. Both will exist in the wild — in Google's index, in old QR codes, in
 * the client's printed material — so we normalise to one form and declare it,
 * rather than letting the two compete as duplicates.
 */
export function canonicalPath(pathname: string): string {
	if (pathname === '/') return '/';
	return pathname.replace(/\/+$/, '');
}

/** Which brand's share image a path belongs to. */
export function brandFromPath(pathname: string): BrandId | 'geisha' {
	if (pathname.startsWith('/fusion')) return 'fusion';
	if (pathname.startsWith('/asia')) return 'asia';
	return 'geisha';
}
