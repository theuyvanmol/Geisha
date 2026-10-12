// Editable content for the Asia home page: hero/statement copy (`home`) plus the
// contact/hours/about subset (`brand_info`) shown in the Visit section. Both fall
// back to the hardcoded defaults when no override exists.
import { getContent } from '$lib/server/content/content';
import { loadOffers, loadReviews, loadHomeExtra } from '$lib/server/content/public';
import { getHomeDefaults } from '$lib/data/home';
import { getBrandInfoDefaults } from '$lib/data/brand';
import { getMediaDefaults, mediaUrl } from '$lib/data/media';
import { GALLERY } from '$lib/data/gallery';
import type { GalleryImage } from '$lib/data/gallery';
import { getMenus } from '$lib/data/menus';
import type { Menu } from '$lib/data/menu-types';
import type { HomeContent, BrandInfoContent, MediaContent } from '$lib/content/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [home, brandInfo, media, offers, reviews, homeExtra, gallery, menus] = await Promise.all([
		getContent<HomeContent>('asia', 'home', getHomeDefaults('asia')),
		getContent<BrandInfoContent>('asia', 'brand_info', getBrandInfoDefaults('asia')),
		getContent<MediaContent>('asia', 'media', getMediaDefaults('asia')),
		loadOffers('asia'),
		loadReviews('asia'),
		loadHomeExtra('asia'),
		// Feeds the home teaser grid + the Instagram strip, which both used to read
		// the static GALLERY and so ignored every edit made in the admin.
		getContent<GalleryImage[]>('asia', 'gallery', GALLERY.asia),
		// Feeds the home page's menu tiles. Read from the same editable `menus`
		// content the /menus page uses, or the two drift the moment staff add or
		// rename one.
		getContent<Menu[]>('asia', 'menus', getMenus('asia'))
	]);
	return {
		home,
		brandInfo,
		offers,
		reviews,
		homeExtra,
		gallery,
		// Only the fields the tiles + PDF row need — no point shipping every dish.
		menuIndex: menus.map((m) => ({
			slug: m.slug,
			title: m.title,
			subtitle: m.subtitle,
			pdf: m.pdf,
			img: m.img
		})),
		media: {
			heroImage: mediaUrl(media, 'asia', 'heroImage'),
			aboutImage: mediaUrl(media, 'asia', 'aboutImage'),
			roomImage: mediaUrl(media, 'asia', 'roomImage'),
			blossomImage: mediaUrl(media, 'asia', 'blossomImage')
		}
	};
};
