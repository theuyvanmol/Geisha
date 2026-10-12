// Landing screen: load each brand's editable media so the tile/zoom stills reflect
// admin changes, falling back to the shipped photographs when no override exists.
//
// Also loads each brand's opening hours from the LIVE service periods
// (geisha_service_periods — the same rows the admin diary runs on) so the tile
// straps can't advertise a window the diary won't sell. This page sits outside
// the /asia and /fusion layouts, so it has to ask for the hours itself.
import { getContent } from '$lib/server/content/content';
import { getPublicHours } from '$lib/server/booking/hours';
import { getMediaDefaults, mediaUrl } from '$lib/data/media';
import type { MediaContent } from '$lib/content/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [asia, fusion, asiaHours, fusionHours] = await Promise.all([
		getContent<MediaContent>('asia', 'media', getMediaDefaults('asia')),
		getContent<MediaContent>('fusion', 'media', getMediaDefaults('fusion')),
		getPublicHours('asia'),
		getPublicHours('fusion')
	]);
	return {
		asiaTileImage: mediaUrl(asia, 'asia', 'landingImage'),
		fusionTileImage: mediaUrl(fusion, 'fusion', 'landingImage'),
		// Only the one-line straps are needed here, e.g. "Open daily 12pm – 11pm".
		asiaHoursStrap: asiaHours.strap,
		fusionHoursStrap: fusionHours.strap
	};
};
