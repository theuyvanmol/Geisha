// The Geisha Circle — server data layer. Reads the admin-editable programme
// content from the `loyalty_program` setting (geisha_settings, one per brand)
// and merges it over the brand defaults. If PocketBase is unreachable or the
// setting is missing/malformed, callers still get a complete programme from the
// defaults — so the public /circle pages never break. Mirrors the rest of the
// booking system's graceful-degradation pattern.

import type { BrandId } from '../db/types.js';
import type { LoyaltyProgram } from '../../data/loyalty.js';
import { resolveLoyaltyProgram, LOYALTY_DEFAULTS } from '../../data/loyalty.js';
import { getSettingValue, updateSetting, listSettings } from './admin.js';
import { getRestaurant } from './queries.js';
import { pb } from '../db/pb.js';

const SETTING_KEY = 'loyalty_program';

/**
 * The resolved, ready-to-render programme for a brand (admin overrides merged
 * over defaults). Never throws — any backend error falls back to defaults.
 */
export async function getLoyaltyProgram(brand: BrandId): Promise<LoyaltyProgram> {
	try {
		const override = await getSettingValue(brand, SETTING_KEY);
		return resolveLoyaltyProgram(brand, override);
	} catch {
		return LOYALTY_DEFAULTS[brand];
	}
}

/**
 * The raw stored override for the admin editor (so staff edit exactly what's
 * persisted, not the merged result). Returns the brand defaults as the starting
 * value when nothing is stored yet, so the editor is never empty.
 */
export async function getLoyaltyEditable(
	brand: BrandId
): Promise<{ program: LoyaltyProgram; isCustom: boolean }> {
	try {
		const override = await getSettingValue(brand, SETTING_KEY);
		if (override == null) return { program: LOYALTY_DEFAULTS[brand], isCustom: false };
		return { program: resolveLoyaltyProgram(brand, override), isCustom: true };
	} catch {
		return { program: LOYALTY_DEFAULTS[brand], isCustom: false };
	}
}

/**
 * Persist an admin edit. Creates the setting row if it doesn't exist yet
 * (the seed doesn't create it), otherwise updates in place via updateSetting
 * (which writes an audit entry). `value` is the full programme object.
 */
export async function saveLoyaltyProgram(brand: BrandId, value: LoyaltyProgram): Promise<void> {
	const settings = await listSettings(brand);
	const existing = settings.find((s) => s.key === SETTING_KEY);
	if (existing) {
		await updateSetting(existing.id, value);
		return;
	}
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	await c.collection('geisha_settings').create({
		restaurant: restaurant.id,
		key: SETTING_KEY,
		value
	});
}

/** Reset a brand's programme back to the baked-in defaults (deletes the override). */
export async function resetLoyaltyProgram(brand: BrandId): Promise<void> {
	const settings = await listSettings(brand);
	const existing = settings.find((s) => s.key === SETTING_KEY);
	if (!existing) return;
	const c = await pb();
	await c.collection('geisha_settings').delete(existing.id);
}
