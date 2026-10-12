// One Asia menu by slug, from the editable `menus` content (or the static
// ASIA_MENUS default). Server loader (was a universal +page.ts) so it can read
// PocketBase. The +page.svelte already consumes `data.menu` unchanged.
import { error } from '@sveltejs/kit';
import { getMenus } from '$lib/data/menus';
import type { Menu } from '$lib/data/menu-types';
import { getContent } from '$lib/server/content/content';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const menus = await getContent<Menu[]>('asia', 'menus', getMenus('asia'));
	const menu = menus.find((m) => m.slug === params.slug);
	if (!menu) throw error(404, 'Menu not found');
	return { menu };
};
