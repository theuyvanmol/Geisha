// Per-STAFF UI preferences — tied to the person, not the browser.
//
// These are the small "how I like my screens set up" toggles (currently just one:
// whether the diary's header chrome is collapsed to claw back vertical space on a
// short screen). They deliberately do NOT live in localStorage the way the diary's
// colour scheme and row density do: the owner asked for a choice that FOLLOWS THE
// USER — set it once and it holds through a refresh, a sign-out, and a sign-in on
// a completely different device or browser. localStorage can't do that.
//
// Storage: ONE geisha_settings row per staff member, key `staff_ui:<staffId>`.
//   - Row-per-staff, not one shared blob, so two people toggling at the same
//     moment can never clobber each other's preference (no read-modify-write race
//     on a hot shared row).
//   - A settings row needs NO migration — the same trick diary_ui, table_chains
//     and the pacing curve already use, which matters because the PocketBase
//     droplet's migrations are applied by hand.
//
// geisha_settings rows are restaurant-scoped, but a person's UI preference is not:
// every row is anchored on the ASIA restaurant so the same preference applies
// whichever brand's diary they happen to be looking at. Don't read the anchor as
// "an Asia setting" — it's just the row's required parent.

import { pb } from '../db/pb.js';
import { getRestaurant } from '../booking/queries.js';
import type { Setting } from '../db/types.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** The settings key holding one staff member's UI preferences. */
export const staffUiKey = (staffId: string) => `staff_ui:${staffId}`;

export interface StaffUiPrefs {
	/** Diary: hide the title / pacing / legend chrome above the grid, so the
	 *  timeline itself gets that vertical space back on a short screen. Defaults
	 *  to collapsed — service wants the grid, not the chrome. */
	diaryChromeCollapsed: boolean;
	/** The restaurant this person was last working. An admin page opened WITHOUT an
	 *  explicit ?brand= resolves to this, so someone who runs Fusion doesn't land on
	 *  Asia every time they follow a bare /admin/... link. */
	brand: 'asia' | 'fusion';
}

export const STAFF_UI_DEFAULTS: StaffUiPrefs = {
	diaryChromeCollapsed: true,
	brand: 'asia'
};

/** Coerce a stored blob into the full prefs shape (unknown/legacy keys dropped). */
function normalise(raw: unknown): StaffUiPrefs {
	const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return {
		diaryChromeCollapsed:
			typeof v.diaryChromeCollapsed === 'boolean'
				? v.diaryChromeCollapsed
				: STAFF_UI_DEFAULTS.diaryChromeCollapsed,
		brand: v.brand === 'asia' || v.brand === 'fusion' ? v.brand : STAFF_UI_DEFAULTS.brand
	};
}

/** One staff member's UI preferences, merged over defaults. Never throws — a
 *  preference read must not be able to fail a page load, so any error (missing
 *  row, PB blip) degrades to the defaults. */
export async function getStaffUiPrefs(staffId: string | undefined): Promise<StaffUiPrefs> {
	if (!staffId) return { ...STAFF_UI_DEFAULTS };
	try {
		const restaurant = await getRestaurant('asia');
		const c = await pb();
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${q(restaurant.id)} && key=${q(staffUiKey(staffId))}`);
		return normalise(row.value);
	} catch {
		return { ...STAFF_UI_DEFAULTS };
	}
}

/** Create-or-update one staff member's UI preferences (patch merged over current).
 *  Not audited: a personal view toggle is not a business record, and auditing every
 *  header collapse would be noise in the trail managers actually read. */
export async function setStaffUiPrefs(
	staffId: string,
	patch: Partial<StaffUiPrefs>
): Promise<StaffUiPrefs> {
	const merged = { ...(await getStaffUiPrefs(staffId)), ...patch };
	const restaurant = await getRestaurant('asia');
	const c = await pb();
	const key = staffUiKey(staffId);
	const existing = await c
		.collection('geisha_settings')
		.getFirstListItem<Setting>(`restaurant=${q(restaurant.id)} && key=${q(key)}`)
		.catch(() => null);
	if (existing) {
		await c.collection('geisha_settings').update<Setting>(existing.id, { value: merged });
	} else {
		await c
			.collection('geisha_settings')
			.create<Setting>({ restaurant: restaurant.id, key, value: merged });
	}
	return merged;
}
