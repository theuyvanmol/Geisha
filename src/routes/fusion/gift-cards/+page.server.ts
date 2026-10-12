// Resolve the Gift Up site-id (settings → env → public default) so the panel
// can hand off to Gift Up's hosted checkout. See $lib/data/giftup.ts.
import { getGiftUpSiteId } from '$lib/server/integrations/keys.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { giftUpSiteId: await getGiftUpSiteId('fusion') };
};
