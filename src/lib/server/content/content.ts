// Editable-content layer (the CMS). Reads/writes the geisha_content collection,
// where staff overrides for public content (gallery / menus / home text / brand
// info) live as one JSON blob per (restaurant, key).
//
// The defining contract is the FALLBACK: getContent always returns a usable
// value. If there's no override row — or PocketBase is unreachable — it returns
// the hardcoded default the caller passes in (from src/lib/data/*). So the
// public site renders identically to before until staff edit a key, and a PB
// outage degrades to the data files instead of a 500.
//
// Server-only (imports the superuser client). Writes audit as actor='staff'.

import { pb } from '../db/pb.js';
import type { BrandId, ContentRecord, AuditActor } from '../db/types.js';
import { getRestaurant } from '../booking/queries.js';
import { writeAudit } from '../booking/audit.js';
import { invalidatePublicHours } from '../booking/hoursCache.js';
import type { ContentKey } from '$lib/content/schema';

export type { ContentKey };

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/**
 * Read the staff override for `(brand, key)`, or `fallback` when absent / on any
 * error. Never throws — the public site must always render.
 */
export async function getContent<T>(brand: BrandId, key: ContentKey, fallback: T): Promise<T> {
	try {
		const restaurant = await getRestaurant(brand);
		const c = await pb();
		const row = await c
			.collection('geisha_content')
			.getFirstListItem<ContentRecord>(`restaurant=${q(restaurant.id)} && key=${q(key)}`);
		// An explicitly-null/undefined stored value still means "no override".
		return (row.value ?? fallback) as T;
	} catch {
		return fallback;
	}
}

/**
 * The stored value AND a fingerprint of the version it was read at.
 *
 * The editors hold the WHOLE blob in a hidden field and POST it wholesale, so
 * two page instances editing the same key are a last-writer-wins race: the one
 * that saves second writes its own (older) idea of every field it didn't touch
 * back over the first one's work, silently. That is not theoretical — it cost a
 * pair of menu cover photos, and the tab that lost them went on showing them
 * next to "Saved ✓".
 *
 * So an editor is seeded with the row's `updated` stamp and sends it back on
 * Save; saveContentAction refuses the write if the stored row has moved on. An
 * absent row fingerprints as '' — the first save for a key has nothing to race.
 */
export async function getContentMeta<T>(
	brand: BrandId,
	key: ContentKey,
	fallback: T
): Promise<{ value: T; version: string }> {
	try {
		const restaurant = await getRestaurant(brand);
		const c = await pb();
		const row = await c
			.collection('geisha_content')
			.getFirstListItem<ContentRecord>(`restaurant=${q(restaurant.id)} && key=${q(key)}`);
		return { value: (row.value ?? fallback) as T, version: row.updated ?? '' };
	} catch {
		// No row, or PocketBase is unreachable. '' means "I saw no stored row" —
		// which the guard treats as a mismatch against any row that does exist, so
		// a read that failed can never be used to overwrite content it never saw.
		return { value: fallback, version: '' };
	}
}

/** All content override rows for a brand (admin use). */
export async function listContent(brand: BrandId): Promise<ContentRecord[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	return c
		.collection('geisha_content')
		.getFullList<ContentRecord>({ filter: `restaurant=${q(restaurant.id)}`, sort: 'key' });
}

/**
 * Create-or-update the override for `(brand, key)` (whole-blob replace) and audit
 * it. Returns the saved row.
 *
 * `actor` is who to credit the write to (default 'staff' — a person editing in
 * the admin). The assistant's content-save endpoint passes 'staff' too because a
 * human clicks Save on the widget; the arg exists so an automated save could
 * audit as 'ai'/'system' if one is ever added. `onBehalfOf` records the staff id
 * behind an automated write.
 */
export async function upsertContent(
	brand: BrandId,
	key: ContentKey,
	value: unknown,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<ContentRecord> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const filter = `restaurant=${q(restaurant.id)} && key=${q(key)}`;

	let before: ContentRecord | null = null;
	try {
		before = await c.collection('geisha_content').getFirstListItem<ContentRecord>(filter);
	} catch {
		before = null; // first edit for this key
	}

	const row = before
		? await c.collection('geisha_content').update<ContentRecord>(before.id, { value })
		: await c
				.collection('geisha_content')
				.create<ContentRecord>({ restaurant: restaurant.id, key, value });

	await writeAudit(actor, 'update_content', 'geisha_content', row.id, before, row, onBehalfOf);
	// brand_info carries the editorial hoursNote shown beneath the opening hours,
	// which getPublicHours caches alongside the live service periods.
	if (key === 'brand_info') invalidatePublicHours(brand);
	return row;
}
