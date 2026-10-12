// Table CHAINS (ResDiary "Table Joins"). A first-class, staff-managed combination
// of 2+ tables that seat one large party — e.g. "20, 21, 22" seats 10. Unlike a bare
// pairwise join, a chain carries its OWN capacity (the covers it seats when combined,
// which staff may set below the raw seats sum for comfort) and identity (so it can be
// edited / deleted as a unit in the Tables → Table Joins UI).
//
// DELIBERATELY no schema change (mirrors ranking.ts): chains live as a single
// geisha_settings json row keyed 'table_chains' = Chain[]. A missing row / malformed
// value degrades to [] so allocation behaves exactly as before. Chains are ALSO folded
// into the pairwise-join graph the allocator already understands (chainsToJoinPairs),
// so a registered chain auto-combines for big parties with no engine change.

import { pb } from '../db/pb.js';
import { getRestaurant } from './queries.js';
import type { BrandId, TableJoin } from '../db/types.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** The geisha_settings key the chain list is stored under. */
export const TABLE_CHAINS_KEY = 'table_chains';

/** A combinable run of tables seated as one unit, with an authored capacity. */
export interface TableChain {
	/** Stable id (so the UI can edit/delete a specific chain). */
	id: string;
	/** Member table ids, in join order. 2+ entries. */
	tableIds: string[];
	/** Covers the chain seats when combined (staff-set; 0 = derive from seats). */
	capacity: number;
}

/** Coerce an arbitrary stored value into a clean TableChain[]. Drops malformed rows. */
export function normaliseChains(value: unknown): TableChain[] {
	if (!Array.isArray(value)) return [];
	const out: TableChain[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const ids = Array.isArray(r.tableIds) ? r.tableIds.filter((x): x is string => typeof x === 'string') : [];
		if (ids.length < 2) continue; // a chain needs at least two tables
		const cap = typeof r.capacity === 'number' ? r.capacity : Number(r.capacity);
		out.push({
			id: typeof r.id === 'string' && r.id ? r.id : chainKey(ids),
			tableIds: [...new Set(ids)],
			capacity: Number.isFinite(cap) && cap > 0 ? Math.round(cap) : 0
		});
	}
	return out;
}

/** A deterministic id for a chain from its member set (order-independent). */
export function chainKey(tableIds: string[]): string {
	return 'ch_' + [...tableIds].sort().join('-');
}

/**
 * Load the configured chains for a brand from geisha_settings. Returns [] when the
 * setting is absent / empty / malformed, and never throws (PB unreachable → []).
 */
export async function getChains(brand: BrandId): Promise<TableChain[]> {
	try {
		const restaurant = await getRestaurant(brand);
		const c = await pb();
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<{ value: unknown }>(`restaurant=${q(restaurant.id)} && key=${q(TABLE_CHAINS_KEY)}`)
			.catch(() => null);
		return normaliseChains(row?.value);
	} catch {
		return [];
	}
}

/**
 * Load chains by RESTAURANT id (not brand) — used by the allocation-facing getJoins,
 * which already has the restaurant id in hand. Returns [] on any miss/error.
 */
export async function getChainsByRestaurant(restaurantId: string): Promise<TableChain[]> {
	try {
		const c = await pb();
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<{ value: unknown }>(`restaurant=${q(restaurantId)} && key=${q(TABLE_CHAINS_KEY)}`)
			.catch(() => null);
		return normaliseChains(row?.value);
	} catch {
		return [];
	}
}

/**
 * Save the chain list for a brand into the single 'table_chains' geisha_settings row
 * (upsert), audited as a settings change. Returns the saved (normalised) list.
 */
export async function setChains(brand: BrandId, chains: TableChain[]): Promise<TableChain[]> {
	const clean = normaliseChains(chains);
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const existing = await c
		.collection('geisha_settings')
		.getFirstListItem<{ id: string; value: unknown }>(
			`restaurant=${q(restaurant.id)} && key=${q(TABLE_CHAINS_KEY)}`
		)
		.catch(() => null);

	const { writeAudit } = await import('./audit.js');
	if (existing) {
		const before = { ...existing };
		const row = await c.collection('geisha_settings').update(existing.id, { value: clean });
		await writeAudit('staff', 'update_setting', 'geisha_settings', existing.id, before, row);
	} else {
		const row = await c
			.collection('geisha_settings')
			.create({ restaurant: restaurant.id, key: TABLE_CHAINS_KEY, value: clean });
		await writeAudit('staff', 'update_setting', 'geisha_settings', row.id, null, row);
	}
	return clean;
}

/**
 * Decompose chains into the pairwise adjacency the allocator understands: a chain
 * [20,21,22] contributes the consecutive pairs 20-21 and 21-22, so the existing
 * expandToJoinedSet / allocateTables graph walk can combine the whole run. `restaurant`
 * is stamped so the shape matches a real {@link TableJoin}. Deduped by unordered pair.
 */
export function chainsToJoinPairs(restaurantId: string, chains: TableChain[]): TableJoin[] {
	const seen = new Set<string>();
	const out: TableJoin[] = [];
	for (const ch of chains) {
		for (let i = 0; i < ch.tableIds.length - 1; i++) {
			const a = ch.tableIds[i];
			const b = ch.tableIds[i + 1];
			if (!a || !b || a === b) continue;
			const key = [a, b].sort().join('|');
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({
				id: `chainpair_${key}`,
				restaurant: restaurantId,
				table_a: a,
				table_b: b
			} as TableJoin);
		}
	}
	return out;
}
