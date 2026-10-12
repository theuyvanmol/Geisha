// Full menus for Fusion, from the editable `menus` content (or the static
// FUSION_MENUS default). The page used to take only a slug/title/pdf INDEX,
// because the old selector was a wall of PDF links; MenusBrowser renders every
// dish inline, so it needs the sections too.
import { getContent } from '$lib/server/content/content';
import { getMenus } from '$lib/data/menus';
import { getMediaDefaults, mediaUrl } from '$lib/data/media';
import type { MediaContent } from '$lib/content/schema';
import type { Menu } from '$lib/data/menu-types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [menus, media] = await Promise.all([
		getContent<Menu[]>('fusion', 'menus', getMenus('fusion')),
		// See the Asia loader — the dish list sits over the brand's own hero
		// artwork, pulled from the media CMS so it follows a hero swap.
		getContent<MediaContent>('fusion', 'media', getMediaDefaults('fusion'))
	]);
	return { menus, bgImage: mediaUrl(media, 'fusion', 'heroImage') };
};
