// Per-person area grants — "open Reports for this host" without raising their
// whole access level. The rules for what a grant opens live in $lib/admin/access.ts
// (ROUTE_GRANT); this module only stores who holds which.
//
// Storage: ONE geisha_settings row, key `staff_grants`, value
// `{ [staffId]: AdminGrant[] }`. A settings row needs NO migration (the droplet's
// migrations are applied by hand), the same trick as staff_ui prefs. It is anchored
// on the ASIA restaurant only because a settings row needs a parent — a grant is
// per person, not per brand. One shared row is fine here: only owners write it, from
// the Team page, a handful of times a year.
//
// Read on EVERY signed-in request (the guard needs it), so it is cached per server
// instance for a short while. PocketBase is in Singapore; an extra round trip on
// every host's page load would be felt. A new grant therefore reaches other
// instances within GRANTS_TTL_MS — the writer's own instance sees it at once.

import { pb } from '../db/pb.js';
import { getRestaurant } from '../booking/queries.js';
import { cleanGrants, type AdminGrant } from '$lib/admin/access';
import type { Setting } from '../db/types.js';

export const STAFF_GRANTS_KEY = 'staff_grants';
const GRANTS_TTL_MS = 30_000;

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

type GrantMap = Record<string, AdminGrant[]>;

function normalise(raw: unknown): GrantMap {
	const out: GrantMap = {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
	for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
		const grants = cleanGrants(list);
		if (grants.length) out[id] = grants;
	}
	return out;
}

async function readRow(): Promise<Setting | null> {
	const restaurant = await getRestaurant('asia');
	const c = await pb();
	return c
		.collection('geisha_settings')
		.getFirstListItem<Setting>(`restaurant=${q(restaurant.id)} && key=${q(STAFF_GRANTS_KEY)}`)
		.catch((e: { status?: number }) => {
			if (e?.status === 404) return null;
			throw e;
		});
}

let cache: { at: number; map: GrantMap } | null = null;

/** Everyone's grants. Throws if PocketBase can't be asked (callers decide). */
export async function getAllGrants(): Promise<GrantMap> {
	if (cache && Date.now() - cache.at < GRANTS_TTL_MS) return cache.map;
	const map = normalise((await readRow())?.value);
	cache = { at: Date.now(), map };
	return map;
}

/** One person's grants. Never throws — a failed read means no extra access, and
 *  must not turn into a failed page load for the whole floor. */
export async function getStaffGrants(staffId: string): Promise<AdminGrant[]> {
	try {
		return (await getAllGrants())[staffId] ?? [];
	} catch (e) {
		console.error('[grants] read failed — treating as none:', e);
		return [];
	}
}

/** Replace one person's grants (owner action). Returns the stored list. */
export async function setStaffGrants(staffId: string, grants: AdminGrant[]): Promise<AdminGrant[]> {
	const clean = cleanGrants(grants);
	const row = await readRow();
	const map = normalise(row?.value);
	if (clean.length) map[staffId] = clean;
	else delete map[staffId];

	const c = await pb();
	if (row) {
		await c.collection('geisha_settings').update<Setting>(row.id, { value: map });
	} else {
		const restaurant = await getRestaurant('asia');
		await c
			.collection('geisha_settings')
			.create<Setting>({ restaurant: restaurant.id, key: STAFF_GRANTS_KEY, value: map });
	}
	cache = { at: Date.now(), map };
	return clean;
}
