// Per-slug DEFAULT cover photos for a menu, and the resolver that turns one into
// a URL a browser can actually fetch.
//
// Extracted out of FusionMenuGallery when the Asia home page grew its own menu
// tiles: two surfaces showing the same menus with different covers is exactly the
// kind of drift that gets noticed months later. A menu's own `img` (set in the
// admin Menus editor) always wins; this map is only the fallback, so a newly
// added slug is never stuck without a cover.

import { fallback } from '$lib/media/responsive';

export type MenuCoverSource = { slug: string; img?: string };

const COVERS: Record<string, string> = {
	main: '/Content%20folder/7230dfe3-03b5-485a-beed-edfa18020d16.jpg',
	special: '/Content%20folder/IMG_6486.JPG',
	'evening-special': '/Content%20folder/IMG_6486.JPG',
	'daytime-special': '/Content%20folder/IMG_6463.JPG',
	cocktails: '/Content%20folder/7de717e2-64bd-4b68-9744-cb989b2439cf.jpg',
	'sunday-roast': '/Content%20folder/IMG_6500.JPG',
	kids: '/Content%20folder/IMG_6394.JPG',
	desserts: '/Content%20folder/87b8683d-6ba2-4e6d-9e81-da9b9daa0b23.jpg',
	'bottomless-brunch': '/Content%20folder/80ad9732-2961-4786-bad5-6f78d4783331.jpg',
	drinks: '/Content%20folder/7de717e2-64bd-4b68-9744-cb989b2439cf.jpg',
	allergens: '/Content%20folder/75c3da96-bbba-426b-bd88-b238640990c8.jpg'
};
const FALLBACK = '/Content%20folder/IMG_6463.JPG';

/**
 * The cover URL for one menu, resolved to the optimized CDN variant.
 *
 * The raw `/Content folder/…` paths above are only manifest KEYS in production
 * (the binaries are gitignored and never deployed), so an unresolved one renders
 * blank on the deployed site. `fallback()` maps a key to its R2 URL and passes
 * anything else (an admin upload, an external link) straight through. Quotes are
 * stripped so a filename can never break out of a `url('…')`.
 */
export function menuCover(m: MenuCoverSource): string {
	const raw = m.img?.trim() || COVERS[m.slug] || FALLBACK;
	return (fallback(raw) ?? raw).replace(/['"\\]/g, '');
}
