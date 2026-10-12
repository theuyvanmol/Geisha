// AUTOMATIC JOINING policy — which tables the engine is allowed to combine on its
// own when a guest books a party no single table can hold.
//
// Chains (booking/chains.ts) say WHICH RUNS combine and what they seat. This module
// answers the other half of the question: may the allocator combine a given table
// AT ALL? Some tables physically can't be pushed together (a fixed booth, the sushi
// counter, a bar top) or shouldn't be (the window two-top the owner keeps for
// walk-ins), and until now the ad-hoc large-party step would happily sell any two
// free tables in a section.
//
// DELIBERATELY no schema change (mirrors ranking.ts / chains.ts): the policy lives
// as a single geisha_settings json row keyed 'table_autojoin'. A missing / malformed
// row degrades to DEFAULT_AUTOJOIN — every table combinable, ad-hoc allowed — so a
// restaurant that never opens the editor behaves exactly as it does today.

import { pb } from '../db/pb.js';
import { getRestaurant } from './queries.js';
import type { BrandId } from '../db/types.js';
import type { AutoJoinPolicy } from './availability.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** The geisha_settings key the auto-join policy is stored under. */
export const TABLE_AUTOJOIN_KEY = 'table_autojoin';

/**
 * Which tables may be auto-combined, and whether unregistered combinations are
 * allowed at all.
 *
 * `excluded` is stored (rather than an allow-list) so the absent-config case means
 * "everything combines" — the behaviour every existing brand already has.
 */
export interface AutoJoinConfig {
	/**
	 * Allow the allocator to combine tables that AREN'T a registered chain/join —
	 * the greedy "any free tables in one section" fallback used for a 19- or
	 * 40-cover party. False = sell only combinations staff registered (ResDiary's
	 * own model), so a big party with no matching chain is refused online.
	 */
	allowAdHoc: boolean;
	/** Table ids that must NEVER be auto-joined to another table. */
	excluded: string[];
	/**
	 * Table ids reserved for STAFF. A guest booking online is never given one — not
	 * joined, and not on its own either; a host books and seats them exactly as
	 * normal, joining them through the registered chains.
	 *
	 * Asia's counter (50–54) is the case: the owner keeps it for walk-ins and
	 * internal seating. It was originally held back from JOINING only, which left
	 * the five 2-tops sellable online individually — "when booking through online on
	 * Asia it won't assign people to 50s tables but admins can still make bookings
	 * on them as normal" (owner, Sep 2026).
	 */
	staffOnly: string[];
}

/** No config = today's behaviour: every table combinable, ad-hoc allowed. */
export const DEFAULT_AUTOJOIN: AutoJoinConfig = { allowAdHoc: true, excluded: [], staffOnly: [] };

const idList = (value: unknown): string[] =>
	Array.isArray(value)
		? [...new Set(value.filter((x): x is string => typeof x === 'string' && !!x))]
		: [];

/**
 * Coerce an arbitrary stored value into a clean config (never throws).
 *
 * A staff-only table is STORED in `excluded` as well (see {@link toStoredAutoJoin}),
 * so it is taken back out here: in memory `excluded` means "never" only.
 */
export function normaliseAutoJoin(value: unknown): AutoJoinConfig {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return { ...DEFAULT_AUTOJOIN, excluded: [], staffOnly: [] };
	}
	const v = value as Record<string, unknown>;
	const staffOnly = idList(v.staffOnly);
	const excluded = idList(v.excluded).filter((id) => !staffOnly.includes(id));
	// Only an explicit `false` turns ad-hoc off — an absent flag keeps it on.
	return { allowAdHoc: v.allowAdHoc !== false, excluded, staffOnly };
}

/**
 * The shape written to geisha_settings. Staff-only tables go into `excluded` TOO:
 * a build that predates staff-only only reads `excluded`, and "never join" is the
 * safe way for it to read them — an older deployment (or a rollback) must not start
 * selling the counter's joins to the public. {@link normaliseAutoJoin} undoes this.
 */
export function toStoredAutoJoin(config: AutoJoinConfig): AutoJoinConfig {
	return {
		allowAdHoc: config.allowAdHoc,
		excluded: [...new Set([...config.excluded, ...config.staffOnly])],
		staffOnly: [...config.staffOnly]
	};
}

/**
 * The allocator policy for one booking CHANNEL. A guest booking online is never
 * given a staff-only table at all; a staff booking gets the whole floor, joining
 * the staff-only ones through the registered chains.
 */
export function policyFor(config: AutoJoinConfig, channel: 'online' | 'staff'): AutoJoinPolicy {
	return channel === 'staff'
		? {
				allowAdHoc: config.allowAdHoc,
				excluded: [...config.excluded],
				chainOnly: [...config.staffOnly],
				// A host is never refused a table. Seating the counter IS the job.
				notOffered: []
			}
		: {
				allowAdHoc: config.allowAdHoc,
				excluded: [...config.excluded, ...config.staffOnly],
				chainOnly: [],
				notOffered: [...config.staffOnly]
			};
}

/**
 * Load the policy by RESTAURANT id — used by the booking write paths, which already
 * hold the restaurant and shouldn't pay for another round-trip. Never throws.
 */
export async function getAutoJoinByRestaurant(restaurantId: string): Promise<AutoJoinConfig> {
	try {
		const c = await pb();
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<{ value: unknown }>(
				`restaurant=${q(restaurantId)} && key=${q(TABLE_AUTOJOIN_KEY)}`
			)
			.catch(() => null);
		return normaliseAutoJoin(row?.value);
	} catch {
		return { ...DEFAULT_AUTOJOIN };
	}
}

/** Load the policy for a brand. Degrades to DEFAULT_AUTOJOIN on any miss/error. */
export async function getAutoJoin(brand: BrandId): Promise<AutoJoinConfig> {
	try {
		const restaurant = await getRestaurant(brand);
		return await getAutoJoinByRestaurant(restaurant.id);
	} catch {
		return { ...DEFAULT_AUTOJOIN };
	}
}

/**
 * Save the policy for a brand into the single 'table_autojoin' geisha_settings row
 * (upsert), audited as a settings change. Returns the saved (normalised) config.
 */
export async function setAutoJoin(brand: BrandId, config: AutoJoinConfig): Promise<AutoJoinConfig> {
	// Normalising drops junk ids and settles a table listed twice as staff-only.
	const clean = normaliseAutoJoin(config);
	const stored = toStoredAutoJoin(clean);
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const existing = await c
		.collection('geisha_settings')
		.getFirstListItem<{ id: string; value: unknown }>(
			`restaurant=${q(restaurant.id)} && key=${q(TABLE_AUTOJOIN_KEY)}`
		)
		.catch(() => null);

	const { writeAudit } = await import('./audit.js');
	if (existing) {
		const before = { ...existing };
		const row = await c.collection('geisha_settings').update(existing.id, { value: stored });
		await writeAudit('staff', 'update_setting', 'geisha_settings', existing.id, before, row);
	} else {
		const row = await c
			.collection('geisha_settings')
			.create({ restaurant: restaurant.id, key: TABLE_AUTOJOIN_KEY, value: stored });
		await writeAudit('staff', 'update_setting', 'geisha_settings', row.id, null, row);
	}
	return clean;
}
