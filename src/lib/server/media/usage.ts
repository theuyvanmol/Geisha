// "Is this picture still on the site?"
//
// Deleting from the library deletes the bytes, so it has to be answerable before
// the fact — otherwise removing a tidy-looking duplicate silently breaks a hero,
// a menu cover or a gallery card, and nobody finds out until a guest does.
//
// Every editable surface is a JSON blob in geisha_content, and a picture is
// always referenced by its url, so the check is a substring scan over those
// blobs. Crude on purpose: it can't miss a reference by not knowing the shape of
// some future content key, which a field-by-field walk would.

import { listContent } from '../content/content.js';
import type { BrandId } from '../db/types.js';

/** Where one file is used: which brand, and which editor owns that content. */
export interface Usage {
	brand: BrandId;
	key: string;
	label: string;
}

const BRANDS: BrandId[] = ['asia', 'fusion'];

/** Human name for a content key — what staff would call the tab it's edited on. */
const KEY_LABELS: Record<string, string> = {
	gallery: 'Gallery',
	menus: 'Menus',
	media: 'Photos & video',
	offers: 'Offers',
	reviews: 'Reviews',
	home: 'Home page',
	home_extra: 'Home editorial',
	banner: 'Banner',
	pages: 'Pages',
	brand_info: 'Details & hours'
};

/**
 * Which content blobs mention any of `urls`.
 *
 * Pass every url a library row owns (the canonical plus its ladder): a blob
 * usually holds the canonical, but an older one can hold a specific variant.
 */
export async function findUsage(urls: string[]): Promise<Usage[]> {
	const wanted = urls.filter(Boolean);
	if (wanted.length === 0) return [];

	const out: Usage[] = [];
	const perBrand = await Promise.all(BRANDS.map((b) => listContent(b).catch(() => [])));

	perBrand.forEach((rows, i) => {
		const brand = BRANDS[i];
		for (const row of rows) {
			const blob = JSON.stringify(row.value ?? '');
			if (wanted.some((u) => blob.includes(u))) {
				out.push({ brand, key: row.key, label: KEY_LABELS[row.key] ?? row.key });
			}
		}
	});
	return out;
}

/** findUsage for several files at once, keyed by library row id. */
export async function findUsageFor(
	items: { id: string; urls: string[] }[]
): Promise<Record<string, Usage[]>> {
	const out: Record<string, Usage[]> = {};
	if (items.length === 0) return out;

	// One read of all the content, scanned per item — the alternative is a
	// full content fetch per picture, and a library runs to hundreds.
	const perBrand = await Promise.all(BRANDS.map((b) => listContent(b).catch(() => [])));
	const blobs: { brand: BrandId; key: string; json: string }[] = [];
	perBrand.forEach((rows, i) => {
		for (const row of rows) {
			blobs.push({ brand: BRANDS[i], key: row.key, json: JSON.stringify(row.value ?? '') });
		}
	});

	for (const item of items) {
		const urls = item.urls.filter(Boolean);
		out[item.id] = blobs
			.filter((b) => urls.some((u) => b.json.includes(u)))
			.map((b) => ({ brand: b.brand, key: b.key, label: KEY_LABELS[b.key] ?? b.key }));
	}
	return out;
}
