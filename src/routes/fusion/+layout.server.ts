// Fusion-wide layout data: the editable announcement banner + the live opening
// hours. Loaded here (not just on the home page) so both the sitewide strip and
// the footer's "Opening Times" column show on every Fusion page.
//
// `hours` comes from the same geisha_service_periods rows the admin diary reads,
// so the site can never advertise a window the diary won't sell. Layout data
// merges into every child page's `data`, so pages and shared components (footer,
// booking widget, JSON-LD) all read the one value.
import { loadBanner } from '$lib/server/content/public';
import { getPublicHours } from '$lib/server/booking/hours';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	const [banner, hours] = await Promise.all([loadBanner('fusion'), getPublicHours('fusion')]);
	return { banner, hours };
};
