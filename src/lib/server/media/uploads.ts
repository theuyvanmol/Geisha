// The uploaded-media library — the PocketBase side of it.
//
// geisha_media holds one row per file staff have uploaded: the R2 urls (the
// canonical original plus the AVIF/WebP ladder), alt text, label, and which
// restaurant it was uploaded under. The bytes live on R2; this is the index.
//
// Shared by the upload endpoint and the Library admin page so "what's in the
// library" is answered the same way in both.

import { pb } from '../db/pb.js';
import { getRestaurant } from '../booking/queries.js';
import { del as r2del, keyFromUrl } from '../r2.js';
import type { MediaRecord, BrandId } from '../db/types.js';

export interface LibraryItem {
	id: string;
	/** Canonical url — what goes into a content blob. */
	url: string;
	/** Narrowest WebP, for grids of thumbnails. */
	thumb: string;
	alt: string;
	label: string;
	/** ISO timestamp of the upload. */
	created: string;
	/** Every url this row owns (canonical + ladder) — what a delete removes. */
	urls: string[];
}

/**
 * A row's public URL. Prefers the R2 `url`; falls back to the PocketBase
 * attachment so rows predating the R2 switch keep working.
 */
export function recordUrl(
	c: Awaited<ReturnType<typeof pb>>,
	rec: MediaRecord
): string {
	const r2 = (rec as MediaRecord & { url?: string }).url;
	if (r2) return r2;
	return rec.file ? c.files.getURL(rec, rec.file) : '';
}

/** The narrowest WebP in a row's ladder — the thumbnail a grid should load. */
export function smallestWebp(rec: MediaRecord): string | undefined {
	const webp = (rec.variants ?? []).filter((v) => v.fmt === 'webp').sort((a, b) => a.w - b.w);
	return webp[0]?.url;
}

/** Everything in the library, newest first. Brand-scoped rows plus shared ones. */
export async function listUploads(brand?: BrandId): Promise<LibraryItem[]> {
	const c = await pb();
	let filter = '';
	if (brand) {
		const restaurant = await getRestaurant(brand);
		// brand-owned media + shared (no restaurant) media
		filter = `restaurant="${restaurant.id}" || restaurant=""`;
	}
	const rows = await c
		.collection('geisha_media')
		.getFullList<MediaRecord>({ sort: '-created', ...(filter ? { filter } : {}) });

	return rows
		.map((r) => {
			const url = recordUrl(c, r);
			return {
				id: r.id,
				url,
				thumb: smallestWebp(r) ?? url,
				alt: r.alt ?? '',
				label: r.label ?? '',
				created: r.created ?? '',
				urls: [url, ...(r.variants ?? []).map((v) => v.url)].filter(Boolean)
			};
		})
		.filter((m) => m.url); // a row with neither url nor attachment can't be used
}

/** One row by id, or null. */
export async function getUpload(id: string): Promise<LibraryItem | null> {
	const c = await pb();
	const rec = await c.collection('geisha_media').getOne<MediaRecord>(id).catch(() => null);
	if (!rec) return null;
	const url = recordUrl(c, rec);
	return {
		id: rec.id,
		url,
		thumb: smallestWebp(rec) ?? url,
		alt: rec.alt ?? '',
		label: rec.label ?? '',
		created: rec.created ?? '',
		urls: [url, ...(rec.variants ?? []).map((v) => v.url)].filter(Boolean)
	};
}

/**
 * Remove a file from the library: its R2 objects first, then the row.
 *
 * The bytes go too — a "library" that only forgets about a file, leaving it
 * costing storage forever with no way back to it, isn't a library. R2 deletes
 * are best-effort: a failure there must not leave an orphan row pointing at a
 * file the UI can no longer show, so the row is removed either way and the
 * failure is logged.
 *
 * Callers are responsible for checking the file isn't still used on the site
 * (see findUsage) — this does the deed without asking.
 */
export async function deleteUpload(item: LibraryItem): Promise<void> {
	for (const url of item.urls) {
		const key = keyFromUrl(url);
		if (!key) continue; // a legacy PocketBase attachment, not an R2 object
		try {
			await r2del(key);
		} catch (err) {
			console.error('[media] R2 delete failed for', key, err);
		}
	}
	const c = await pb();
	await c.collection('geisha_media').delete(item.id);
}
