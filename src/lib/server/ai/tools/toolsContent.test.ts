// Guards for the content-domain assistant tools. The heavy paths (get_content /
// open_content run()) hit PocketBase, so here we assert the STATIC contract:
//  - CONTENT_META covers exactly the editable content keys (every key except the
//    banner, which has its own dedicated tools), so the model's vocabulary and the
//    ContentWidget renderer never drift from schema.ts.
//  - every content key's hardcoded DEFAULT seed passes its own SCHEMA_BY_KEY
//    validator — i.e. open_content can always fall back to a saveable blob, and the
//    /api/admin/content endpoint would accept the un-edited default.

import { describe, it, expect } from 'vitest';
import { CONTENT_META } from './toolsContent.js';
import { SCHEMA_BY_KEY, type ContentKey } from '$lib/content/schema';
import { getHomeDefaults } from '$lib/data/home';
import { getHomeExtraDefaults } from '$lib/data/home-extra';
import { getBrandInfoDefaults } from '$lib/data/brand';
import { getOffersDefaults } from '$lib/data/offers';
import { getReviewsDefaults } from '$lib/data/reviews';
import { getMediaDefaults } from '$lib/data/media';
import { getMenus } from '$lib/data/menus';
import { getPagesDefaults } from '$lib/data/pages';
import { GALLERY } from '$lib/data/gallery';

type EditorKey = keyof typeof CONTENT_META;

const DEFAULTS: Record<EditorKey, (brand: 'asia' | 'fusion') => unknown> = {
	home: getHomeDefaults,
	home_extra: getHomeExtraDefaults,
	brand_info: getBrandInfoDefaults,
	offers: getOffersDefaults,
	reviews: getReviewsDefaults,
	media: getMediaDefaults,
	menus: getMenus,
	gallery: (b) => GALLERY[b],
	pages: getPagesDefaults
};

describe('content tool metadata', () => {
	it('covers every content key except the banner', () => {
		const metaKeys = Object.keys(CONTENT_META).sort();
		const schemaKeys = (Object.keys(SCHEMA_BY_KEY) as ContentKey[])
			.filter((k) => k !== 'banner')
			.sort();
		expect(metaKeys).toEqual(schemaKeys);
	});

	it('does NOT include the banner (owned by the banner tools)', () => {
		expect(Object.keys(CONTENT_META)).not.toContain('banner');
	});
});

describe('every content default seed is schema-valid', () => {
	const brands = ['asia', 'fusion'] as const;
	for (const key of Object.keys(CONTENT_META) as EditorKey[]) {
		for (const brand of brands) {
			it(`${key} / ${brand} passes SCHEMA_BY_KEY`, () => {
				const seed = DEFAULTS[key](brand);
				const result = SCHEMA_BY_KEY[key].safeParse(seed);
				expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(
					true
				);
			});
		}
	}
});
