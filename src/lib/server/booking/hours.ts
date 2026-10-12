// Server-side loader for the public opening hours.
//
// Reads the SAME rows the admin diary and the availability engine read
// (geisha_service_periods via getActivePeriods), so what a guest sees on the
// site is by construction what the diary will sell. The only editable extra is
// the editorial `hoursNote` (kitchen / last-orders copy), which still comes
// from the brand_info content blob.
//
// Cached briefly because every public page pulls this through the brand layout;
// admin period + content writes call invalidatePublicHours() so edits show up
// immediately rather than after the TTL.

import { getRestaurant, getActivePeriods } from './queries.js';
import { getContent } from '../content/content.js';
import { getBrandInfoDefaults, BRANDS } from '$lib/data/brand';
import { buildPublicHours, staticPublicHours, type PublicHours } from '$lib/hours';
import { hoursCache, HOURS_TTL_MS } from './hoursCache.js';
import type { BrandId } from '../db/types.js';

export { invalidatePublicHours } from './hoursCache.js';

/**
 * Opening hours for a brand, derived from its active service periods.
 *
 * Never throws: if the periods can't be read it falls back to the static copy
 * in brand.ts (flagged `live: false`) so a PocketBase blip degrades the site
 * instead of taking it down.
 */
export async function getPublicHours(brand: BrandId): Promise<PublicHours> {
	const hit = hoursCache.get(brand);
	if (hit && Date.now() - hit.at < HOURS_TTL_MS) return hit.value;

	const value = await load(brand);
	hoursCache.set(brand, { at: Date.now(), value });
	return value;
}

async function load(brand: BrandId): Promise<PublicHours> {
	// The note is editorial and independently fallible — resolve it separately so
	// a missing content row never costs us the (more important) live hours.
	const notePromise = getContent(brand, 'brand_info', getBrandInfoDefaults(brand))
		.then((info) => info.hoursNote ?? '')
		.catch(() => BRANDS[brand].hoursNote ?? '');

	try {
		const restaurant = await getRestaurant(brand);
		const periods = await getActivePeriods(restaurant.id);
		if (!periods.length) throw new Error('no active service periods');
		return buildPublicHours(brand, periods, await notePromise);
	} catch (err) {
		console.error('[hours] falling back to static opening hours for', brand, err);
		return staticPublicHours(brand, BRANDS[brand].hours, await notePromise);
	}
}
