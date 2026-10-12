// Small server-side helpers that resolve the editable-content blobs the public
// pages need (offers / reviews / home_extra), each falling back to the hardcoded
// data-file default. Keeps the route loaders one line and consistent.
//
// Server-only (getContent imports the superuser PB client).

import { getContent } from './content.js';
import { getOffersDefaults } from '$lib/data/offers';
import { getReviewsDefaults } from '$lib/data/reviews';
import { getHomeExtraDefaults } from '$lib/data/home-extra';
import { getBannerDefault } from '$lib/data/banner';
import { getPagesDefaults } from '$lib/data/pages';
import { getBrandInfoDefaults } from '$lib/data/brand';
import type { Offer } from '$lib/data/offers';
import type { BrandReviews } from '$lib/data/reviews';
import type { Banner } from '$lib/data/banner';
import type { HomeExtraContent, PagesContent, BrandInfoContent } from '$lib/content/schema';
import type { BrandId } from '../db/types.js';

export function loadOffers(brand: BrandId): Promise<Offer[]> {
	return getContent<Offer[]>(brand, 'offers', getOffersDefaults(brand));
}

export function loadReviews(brand: BrandId): Promise<BrandReviews> {
	return getContent<BrandReviews>(brand, 'reviews', getReviewsDefaults(brand));
}

export function loadHomeExtra(brand: BrandId): Promise<HomeExtraContent> {
	return getContent<HomeExtraContent>(brand, 'home_extra', getHomeExtraDefaults(brand));
}

/** The site announcement banner for a brand (falls back to the disabled default). */
export function loadBanner(brand: BrandId): Promise<Banner> {
	return getContent<Banner>(brand, 'banner', getBannerDefault(brand));
}

/**
 * Copy for the Parties / Order / Privacy / Contact pages.
 *
 * Returned together with `brandInfo` because the copy carries `{token}`
 * placeholders for the brand's phone, email and address — the renderer needs
 * both halves, and fetching them as a pair keeps every caller to one line and
 * one round trip.
 */
export async function loadPageCopy(
	brand: BrandId
): Promise<{ pages: PagesContent; brandInfo: BrandInfoContent }> {
	const [pages, brandInfo] = await Promise.all([
		getContent<PagesContent>(brand, 'pages', getPagesDefaults(brand)),
		getContent<BrandInfoContent>(brand, 'brand_info', getBrandInfoDefaults(brand))
	]);
	return { pages, brandInfo };
}
