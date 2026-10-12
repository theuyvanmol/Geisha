// Full menus for Asia, from the editable `menus` content (or the static
// ASIA_MENUS default). The page used to take only a slug/title/pdf INDEX,
// because the old selector was a wall of PDF links; MenusBrowser renders every
// dish inline, so it needs the sections too.
import { getContent } from '$lib/server/content/content';
import { getMenus } from '$lib/data/menus';
import type { Menu } from '$lib/data/menu-types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const menus = await getContent<Menu[]>('asia', 'menus', getMenus('asia'));
	return { menus };
};
