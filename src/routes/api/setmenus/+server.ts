// GET /api/setmenus?brand=asia — the bookable set menus offered as an optional
// pre-order on the booking widget's details step (ResDiary-style pre-order). Reads
// the catalogue from the geisha_settings row `set_menus` (managed at
// /admin/settings/menus-preorder). Returns [] when none are configured / the
// settings collection is unavailable, so the widget simply omits the pre-order
// select — never a 500 for the public booking page (mirrors /api/hours).

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getSetMenusForBrand } from '$lib/server/booking/setMenus.js';
import type { RequestHandler } from './$types';

const Query = z.object({ brand: z.enum(['asia', 'fusion']) });

export const GET: RequestHandler = async ({ url }) => {
	const parsed = Query.safeParse({ brand: url.searchParams.get('brand') });
	if (!parsed.success) throw error(400, 'brand must be asia or fusion');

	try {
		const menus = await getSetMenusForBrand(parsed.data.brand);
		return json({ brand: parsed.data.brand, setMenus: menus });
	} catch (err) {
		// Pre-migration / lookup failure → empty so the widget hides the pre-order.
		console.error('[api/setmenus] falling back to empty list:', err);
		return json({ brand: parsed.data.brand, setMenus: [] });
	}
};
