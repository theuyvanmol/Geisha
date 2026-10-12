// The existing photo library, for the admin image picker's "Library" tab.
//
// This used to glob static/Content folder/ at build time. That folder is now
// gitignored — the raw masters are inputs to scripts/optimize-media.mjs, not
// files we deploy — so the glob would come up empty on Vercel and the picker
// would show an empty library.
//
// It reads the generated manifest instead, which is committed. Better anyway:
// the picker now hands staff the *optimized* CDN URL (a ~200 KB WebP served from
// R2) rather than the path of a 3 MB original, so picking a library image can no
// longer put a huge file on the site.

import manifest from './media-manifest.json';
import videoManifest from './video-manifest.json';
import { fallback, video } from '$lib/media/responsive';

interface Entry {
	slug: string;
	variants: { w: number; fmt: string; url: string }[];
}

const MANIFEST = manifest as unknown as Record<string, Entry>;
const VIDEO_MANIFEST = videoManifest as unknown as Record<string, { slug: string }>;

/**
 * Public (CDN) URLs of every optimized library photo, de-duplicated and sorted
 * for a stable picker order.
 *
 * The manifest is keyed by BOTH the raw and %20-encoded source path, so each
 * photo appears twice — dedupe on slug.
 */
export const STATIC_MEDIA: string[] = (() => {
	const bySlug = new Map<string, string>();
	for (const [key, entry] of Object.entries(MANIFEST)) {
		if (bySlug.has(entry.slug)) continue;
		const url = fallback(key);
		if (url) bySlug.set(entry.slug, url);
	}
	return [...bySlug.values()].sort((a, b) => a.localeCompare(b));
})();

/**
 * The clips already on the site, for the picker's Library tab in VIDEO mode.
 *
 * Without this the video picker had no library at all — the only way to change
 * the landing tile clip or the Fusion plate video was to upload a brand-new
 * file, so staff could not swap in one of the clips the site already ships (and
 * an upload isn't transcoded, so it's the worse option of the two).
 *
 * Same dedupe as STATIC_MEDIA: the manifest is keyed by both the raw and the
 * %20-encoded path, so every clip appears twice.
 */
export const STATIC_VIDEO: { url: string; poster?: string; label: string }[] = (() => {
	const bySlug = new Map<string, { url: string; poster?: string; label: string }>();
	for (const [key, entry] of Object.entries(VIDEO_MANIFEST)) {
		if (bySlug.has(entry.slug)) continue;
		const v = video(key);
		if (!v.src) continue;
		bySlug.set(entry.slug, { url: v.src, poster: v.poster, label: entry.slug });
	}
	return [...bySlug.values()].sort((a, b) => a.label.localeCompare(b.label));
})();
