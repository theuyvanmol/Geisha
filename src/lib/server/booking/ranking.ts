// Table fill-ranking / fill order (ResDiary "table rankings"). A yield control
// that lets staff decide the ORDER tables are filled — e.g. fill window tables
// LAST so the room looks busy from the street, keep prime tables for walk-ins,
// or seat the section nearest the pass first. Lower rank = filled first.
//
// DELIBERATELY no schema change: ranks are stored as a single geisha_settings
// json row keyed 'table_ranks' = { [tableId]: number }. A missing row, a missing
// table, or a non-numeric value all degrade to the DEFAULT rank, so when nothing
// is configured the allocator behaves EXACTLY as before. Server-only (PB read).

import { pb } from '../db/pb.js';
import { getRestaurant } from './queries.js';
import type { BrandId } from '../db/types.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** The geisha_settings key the rank map is stored under. */
export const TABLE_RANKS_KEY = 'table_ranks';

/** Default rank for any table without an explicit one (lower = filled first). */
export const DEFAULT_RANK = 100;

/** A map of table id → fill rank (lower = filled first). */
export type TableRanks = Record<string, number>;

/** Coerce an arbitrary stored value into a clean { [id]: number } rank map.
 *  Non-object inputs → {}; non-finite numbers are dropped (fall back to default). */
export function normaliseRanks(value: unknown): TableRanks {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const out: TableRanks = {};
	for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
		const n = typeof raw === 'number' ? raw : Number(raw);
		if (Number.isFinite(n)) out[id] = n;
	}
	return out;
}

/** The fill rank for a single table id (DEFAULT_RANK when absent). */
export function rankOf(ranks: TableRanks | undefined, tableId: string): number {
	const v = ranks?.[tableId];
	return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_RANK;
}

/**
 * Load the configured fill-rank map for a restaurant id from geisha_settings.
 * Same as {@link getTableRanks} but skips the getRestaurant() round-trip when the
 * caller already holds the restaurant — the booking write paths (create / amend)
 * do, so this shaves one cross-region round-trip off every mutation.
 */
export async function getTableRanksById(restaurantId: string): Promise<TableRanks> {
	try {
		const c = await pb();
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<{ value: unknown }>(`restaurant=${q(restaurantId)} && key=${q(TABLE_RANKS_KEY)}`)
			.catch(() => null);
		return normaliseRanks(row?.value);
	} catch {
		return {};
	}
}

/**
 * Load the configured fill-rank map for a brand from geisha_settings. Returns {}
 * when the setting is absent / empty / malformed (so allocation is unchanged) and
 * never throws — PB being unreachable also yields {} (graceful degrade).
 */
export async function getTableRanks(brand: BrandId): Promise<TableRanks> {
	try {
		const restaurant = await getRestaurant(brand);
		return await getTableRanksById(restaurant.id);
	} catch {
		return {};
	}
}

/**
 * Save the fill-rank map for a brand into the single 'table_ranks' geisha_settings
 * row (upsert), audited as a settings change. Entries equal to DEFAULT_RANK are
 * dropped so the stored map stays sparse (a default rank needs no row); an empty
 * resulting map is still stored (clears all custom ranks). Returns the saved map.
 */
export async function setTableRanks(brand: BrandId, ranks: TableRanks): Promise<TableRanks> {
	const clean = normaliseRanks(ranks);
	// Keep only non-default entries — anything at DEFAULT_RANK is implied.
	const sparse: TableRanks = {};
	for (const [id, n] of Object.entries(clean)) {
		if (n !== DEFAULT_RANK) sparse[id] = n;
	}

	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const existing = await c
		.collection('geisha_settings')
		.getFirstListItem<{ id: string; value: unknown }>(
			`restaurant=${q(restaurant.id)} && key=${q(TABLE_RANKS_KEY)}`
		)
		.catch(() => null);

	const { writeAudit } = await import('./audit.js');
	if (existing) {
		const before = { ...existing };
		const row = await c.collection('geisha_settings').update(existing.id, { value: sparse });
		await writeAudit('staff', 'update_setting', 'geisha_settings', existing.id, before, row);
	} else {
		const row = await c
			.collection('geisha_settings')
			.create({ restaurant: restaurant.id, key: TABLE_RANKS_KEY, value: sparse });
		await writeAudit('staff', 'update_setting', 'geisha_settings', row.id, null, row);
	}
	return sparse;
}
