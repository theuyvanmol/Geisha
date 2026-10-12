// Contact page brand facts, with editable overrides (phone/email/address/hours/
// about/tagline) merged over the static brand. Non-editable facts (name, URLs,
// colors) come from getBrand untouched. `pages` carries the editable page copy
// (admin → Content → Pages).
import { getContent } from '$lib/server/content/content';
import { getPagesDefaults } from '$lib/data/pages';
import { getBrand, getBrandInfoDefaults } from '$lib/data/brand';
import type { BrandInfoContent, PagesContent } from '$lib/content/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [override, pages] = await Promise.all([
		getContent<BrandInfoContent>('fusion', 'brand_info', getBrandInfoDefaults('fusion')),
		getContent<PagesContent>('fusion', 'pages', getPagesDefaults('fusion'))
	]);
	return { brand: { ...getBrand('fusion'), ...override }, pages };
};
