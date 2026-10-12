// Cache store for the public opening hours, kept in its own leaf module so the
// writers that need to bust it (content.ts for brand_info, admin.ts for service
// periods) can import the invalidator without pulling in hours.ts — which reads
// from both of them and would otherwise close an import cycle.

import type { PublicHours } from '$lib/hours';
import type { BrandId } from '../db/types.js';

export const HOURS_TTL_MS = 60_000;

export const hoursCache = new Map<BrandId, { at: number; value: PublicHours }>();

/**
 * Drop the cached public hours. Call after any admin write that can change what
 * the site says it's open — service-period create/update/delete, and brand_info
 * content saves (which carry the editorial hoursNote).
 */
export function invalidatePublicHours(brand?: BrandId): void {
	if (brand) hoursCache.delete(brand);
	else hoursCache.clear();
}
