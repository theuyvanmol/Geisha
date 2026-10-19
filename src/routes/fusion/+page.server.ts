// Editable content for the Fusion home page: hero/statement copy (`home`) plus
// the contact/hours/about subset (`brand_info`). Both fall back to defaults.
import { getContent } from '$lib/server/content/content';
import { loadOffers, loadReviews, loadHomeExtra } from '$lib/server/content/public';
import { getHomeDefaults } from '$lib/data/home';
import { getBrandInfoDefaults } from '$lib/data/brand';
import { getMediaDefaults, mediaUrl } from '$lib/data/media';
import { GALLERY } from '$lib/data/gallery';
import type { GalleryImage } from '$lib/data/gallery';
import { getMenus } from '$lib/data/menus';
import { FUNCTION_ROOM_MENU, FUNCTION_ROOM_OFFER } from '$lib/data/functionRoom';
import type { Menu } from '$lib/data/menu-types';
import type { HomeContent, BrandInfoContent, MediaContent } from '$lib/content/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [home, brandInfo, media, offers, reviews, homeExtra, gallery, menus] = await Promise.all([
		getContent<HomeContent>('fusion', 'home', getHomeDefaults('fusion')),
		getContent<BrandInfoContent>('fusion', 'brand_info', getBrandInfoDefaults('fusion')),
		getContent<MediaContent>('fusion', 'media', getMediaDefaults('fusion')),
		loadOffers('fusion'),
		loadReviews('fusion'),
		loadHomeExtra('fusion'),
		// Feeds the home teaser grid + the Instagram strip, which both used to read
		// the static GALLERY and so ignored every edit made in the admin.
		getContent<GalleryImage[]>('fusion', 'gallery', GALLERY.fusion),
		// Feeds the home page's menu cards. Read from
		// the same editable `menus` content the /menus page uses, or the two drift
		// the moment staff add or rename one. (Fusion's live menus come from this
		// override — the static menus.fusion.ts is only the fallback.)
		getContent<Menu[]>('fusion', 'menus', getMenus('fusion'))
	]);
	return {
		home,
		brandInfo,
		// The VIP Function Room banner rides along as one more What's On slide.
		offers: offers.some((o) => o.id === FUNCTION_ROOM_OFFER.id) ? offers : [...offers, FUNCTION_ROOM_OFFER],
		reviews,
		homeExtra,
		gallery,
		// Only the fields the cards + PDF row need — no point shipping every dish.
		menuIndex: [
			...menus.map((m) => ({
				slug: m.slug,
				title: m.title,
				subtitle: m.subtitle,
				pdf: m.pdf,
				img: m.img
			})),
			// The VIP Function Room leaflet joins the carousel even though it isn't one
			// of the staff-edited menus — unless staff have added it themselves.
			...(menus.some((m) => m.slug === FUNCTION_ROOM_MENU.slug) ? [] : [FUNCTION_ROOM_MENU])
		],
		media: {
			heroImage: mediaUrl(media, 'fusion', 'heroImage'),
			aboutImage: mediaUrl(media, 'fusion', 'aboutImage'),
			// (the three below had no override on the live DB, so they render the new
			// defaults from media.ts; heroImage DID, and was repointed to match)
			roomImage: mediaUrl(media, 'fusion', 'roomImage'),
			blossomImage: mediaUrl(media, 'fusion', 'blossomImage')
		}
	};
};
