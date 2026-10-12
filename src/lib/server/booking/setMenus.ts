// Set-menu catalogue — the short list of pre-orderable set menus offered at
// booking time (ResDiary-style pre-order). Stored as a single geisha_settings row
// (key 'set_menus', json array) per brand, so it needs NO migration and managers
// can CRUD it from /admin/settings/menus-preorder.
//
// This is deliberately separate from the public content/menus CMS (lib/content):
// that drives the marketing menu pages; THIS is the bookable set-menu list the
// widget offers as an optional pre-order on the booking details step.
//
// Server-only. Reads degrade to [] when the settings row is absent so nothing in
// the booking flow ever hard-fails (mirrors getDepositRules / getClosures).

import { pb } from '../db/pb.js';
import type { BrandId, BookingPreorder, Restaurant, SetMenu, Setting } from '../db/types.js';
import { getRestaurant } from './queries.js';
import { writeAudit } from './audit.js';

export const SET_MENUS_KEY = 'set_menus';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** Coerce an unknown settings value into a clean, validated SetMenu[]. */
export function normaliseSetMenus(value: unknown): SetMenu[] {
	if (!Array.isArray(value)) return [];
	const out: SetMenu[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const id = typeof r.id === 'string' ? r.id.trim() : '';
		const name = typeof r.name === 'string' ? r.name.trim() : '';
		if (!id || !name) continue;
		const pricePence =
			typeof r.pricePence === 'number' && Number.isFinite(r.pricePence) && r.pricePence >= 0
				? Math.round(r.pricePence)
				: 0;
		const courses = typeof r.courses === 'string' && r.courses.trim() ? r.courses.trim() : undefined;
		out.push(courses ? { id, name, pricePence, courses } : { id, name, pricePence });
	}
	return out;
}

/**
 * The bookable set menus for a brand, or [] when none are configured / the
 * settings collection is unavailable (pre-migration dev, lookup failure). Never
 * throws — the public widget and the booking write both tolerate an empty list.
 */
export async function getSetMenus(restaurantId: string): Promise<SetMenu[]> {
	const c = await pb();
	try {
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${q(restaurantId)} && key=${q(SET_MENUS_KEY)}`);
		return normaliseSetMenus(row.value);
	} catch {
		return []; // no row yet / collection missing — no set menus offered
	}
}

/** Convenience: resolve the brand → restaurant then load its set menus. */
export async function getSetMenusForBrand(brand: BrandId): Promise<SetMenu[]> {
	let restaurant: Restaurant;
	try {
		restaurant = await getRestaurant(brand);
	} catch {
		return [];
	}
	return getSetMenus(restaurant.id);
}

/**
 * Resolve a chosen set-menu id against the brand's catalogue, returning a
 * persistable {@link BookingPreorder} snapshot, or null when the id is empty /
 * unknown (so an unknown id silently means "no pre-order" rather than failing the
 * booking). The snapshot freezes name/price so later catalogue edits don't rewrite
 * history on the run-sheet.
 */
export async function resolvePreorder(
	restaurantId: string,
	setMenuId: string | undefined | null
): Promise<BookingPreorder | null> {
	const id = (setMenuId || '').trim();
	if (!id) return null;
	const menus = await getSetMenus(restaurantId);
	const m = menus.find((x) => x.id === id);
	if (!m) return null;
	return m.courses
		? { id: m.id, name: m.name, pricePence: m.pricePence, courses: m.courses }
		: { id: m.id, name: m.name, pricePence: m.pricePence };
}

/**
 * Upsert the whole set-menu catalogue for a brand (manager+ admin CRUD). Creates
 * the geisha_settings row on first save, updates it thereafter, and audits the
 * change. Returns the normalised list that was stored.
 */
export async function saveSetMenus(brand: BrandId, menus: SetMenu[]): Promise<SetMenu[]> {
	const clean = normaliseSetMenus(menus);
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const coll = c.collection('geisha_settings');
	try {
		const existing = await coll.getFirstListItem<Setting>(
			`restaurant=${q(restaurant.id)} && key=${q(SET_MENUS_KEY)}`
		);
		const before = existing.value;
		const row = await coll.update<Setting>(existing.id, { value: clean });
		await writeAudit('staff', 'update_setting', 'geisha_settings', row.id, before, row);
		return clean;
	} catch {
		// No row yet — create it.
		const row = await coll.create<Setting>({
			restaurant: restaurant.id,
			key: SET_MENUS_KEY,
			value: clean
		});
		await writeAudit('staff', 'create_setting', 'geisha_settings', row.id, null, row);
		return clean;
	}
}
