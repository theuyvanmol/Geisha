// One Fusion menu by slug, from the editable `menus` content (or the static
// FUSION_MENUS default). Server loader (was a universal +page.ts).
import { error } from '@sveltejs/kit';
import { getMenus } from '$lib/data/menus';
import type { Menu } from '$lib/data/menu-types';
import { getContent } from '$lib/server/content/content';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const menus = await getContent<Menu[]>('fusion', 'menus', getMenus('fusion'));
	const menu = menus.find((m) => m.slug === params.slug);
	if (!menu) throw error(404, 'Menu not found');
	return { menu };
};
