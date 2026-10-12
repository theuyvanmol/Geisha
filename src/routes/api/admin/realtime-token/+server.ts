// GET /api/admin/realtime-token?brand=asia|fusion  (WP-LIVE-7)
//
// Hands the browser the small amount of context it needs to open a SCOPED
// PocketBase realtime subscription for the live floor: the public read URL and
// the restaurant id to filter on. It deliberately does NOT return the PocketBase
// superuser token — the browser subscribes against a restaurant-scoped, read-only
// record rule on the pmm instance (added out of this repo). If/when a dedicated
// short-lived scoped PB auth token is minted, add it to the response as `token`
// and have the client authStore.save() it; the store already supports that path.
//
// Staff-gated: requireRole(server) — the lowest live-floor role. hooks.server.ts
// already 401s unauthenticated /api/admin/* calls, but we re-assert the role here
// so the endpoint is safe on its own.

import { json } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { requireRole } from '$lib/server/auth/rbac.js';
import { getRestaurant } from '$lib/server/booking/queries.js';
import type { BrandId } from '$lib/server/db/types.js';
import type { RequestHandler } from './$types';

const brandOf = (url: URL): BrandId =>
	(url.searchParams.get('brand') as BrandId) === 'fusion' ? 'fusion' : 'asia';

export const GET: RequestHandler = async ({ url, locals }) => {
	requireRole(locals.staff, 'server');
	const brand = brandOf(url);
	const restaurant = await getRestaurant(brand);
	return json({
		// The PUBLIC read URL the browser PB client points at. May be empty when
		// realtime isn't provisioned — the client then degrades to polling.
		url: publicEnv.PUBLIC_POCKETBASE_URL ?? '',
		restaurantId: restaurant.id
	});
};
