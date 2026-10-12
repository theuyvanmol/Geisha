// Responsive image helpers.
//
// scripts/optimize-media.mjs encodes every source photo into an AVIF + WebP
// ladder and records them in media-manifest.json, keyed by the *public URL the
// pages already use* (both raw and %20-encoded, since media.ts stores the
// encoded form). These helpers turn one of those URLs into srcset attributes.
//
// Anything not in the manifest — a PocketBase/R2 URL an admin uploaded, an
// external link — degrades to a plain src with no srcset. Never throws.
//
// Deliberately NOT a shared <Img> component: these photos are full-bleed and
// styled by *scoped* CSS in the page that renders them (.band-image, .hero-bg
// …). An <img> living inside a child component doesn't carry the parent's scope
// hash, so those rules would silently stop applying. Spreading attrs onto the
// existing <img>, or inlining <picture> in the component that owns the CSS,
// keeps scoping working.

import { env } from '$env/dynamic/public';
import manifest from '$lib/data/media-manifest.json';
import videoManifest from '$lib/data/video-manifest.json';

/**
 * Where the optimized variants are served from.
 *
 * Unset (dev, and any deploy before R2 is wired) -> '' -> the files are read
 * straight out of static/media/. Set to an R2 custom domain -> the exact same
 * paths resolve to the CDN. That's the whole switch: no URL rewriting, no code
 * change, and the repo can drop the binaries once it's pointing at R2.
 */
// Fallback: the restaurant's public media bucket, so a deploy with no
// PUBLIC_MEDIA_BASE set (this repo has no static/media/ binaries) still shows
// the hero, Doorway and specials artwork instead of broken images.
const MEDIA_FALLBACK = 'https://pub-2a0f2fc510cf4088a1e1dc60daa6e94f.r2.dev';
const BASE = (env.PUBLIC_MEDIA_BASE || MEDIA_FALLBACK).replace(/\/$/, '');

const at = (url: string) => `${BASE}${url}`;

/** A file under static/media/ (e.g. '/media/showcase/x.mp4') → its local or CDN URL. */
export const mediaAt = at;

export interface MediaVariant {
	w: number;
	fmt: 'avif' | 'webp';
	url: string;
	size: number;
}
export interface MediaEntry {
	slug: string;
	width: number;
	height: number;
	variants: MediaVariant[];
}

const MANIFEST = manifest as unknown as Record<string, MediaEntry>;
const VIDEOS = videoManifest as unknown as Record<
	string,
	{ slug: string; src: string; poster: string }
>;

/** The manifest entry for a public URL, or undefined if it isn't a local optimized photo. */
export function lookup(src: string | undefined): MediaEntry | undefined {
	if (!src) return undefined;
	// media.ts stores '/Content%20folder/x.jpg'; a .svelte file might use either form.
	return MANIFEST[src] ?? MANIFEST[encodeURI(src)] ?? MANIFEST[decodeURI(src)];
}

/** `"/media/x-640.webp 640w, /media/x-1600.webp 1600w"` for one format. */
export function srcset(src: string | undefined, fmt: 'avif' | 'webp'): string | undefined {
	const entry = lookup(src);
	if (!entry) return undefined;
	const list = entry.variants.filter((v) => v.fmt === fmt).sort((a, b) => a.w - b.w);
	return list.length ? list.map((v) => `${at(v.url)} ${v.w}w`).join(', ') : undefined;
}

/** The widest WebP — the `src` fallback for browsers that ignore srcset. */
export function fallback(src: string | undefined): string | undefined {
	const entry = lookup(src);
	if (!entry) return undefined;
	const webp = entry.variants.filter((v) => v.fmt === 'webp');
	return webp.length ? at(webp.reduce((a, b) => (a.w > b.w ? a : b)).url) : undefined;
}

/**
 * Reverse index: every VARIANT url -> its manifest entry.
 *
 * lookup() is keyed by the original source path ('/Content folder/x.jpg'), but
 * what's stored in a content blob — and what the picker hands around — is the
 * canonical CDN url of the widest WebP. Without this, a saved url can't be
 * traced back to its ladder, so an admin thumbnail had no choice but to load the
 * 1600px master. A picker showing 140 of those is ~30 MB of images.
 *
 * Built once, lazily, and indexed both with and without the CDN prefix.
 */
let byVariant: Map<string, MediaEntry> | null = null;
function variantIndex(): Map<string, MediaEntry> {
	if (byVariant) return byVariant;
	const map = new Map<string, MediaEntry>();
	for (const entry of Object.values(MANIFEST)) {
		for (const v of entry.variants) {
			map.set(v.url, entry);
			if (BASE) map.set(at(v.url), entry);
		}
	}
	byVariant = map;
	return map;
}

/**
 * The narrowest WebP at least `minWidth` across — for admin thumbnails, where a
 * 130px tile has no use for a 1600px master. Accepts either a source path or any
 * variant url. Returns undefined for anything outside the pipeline (an R2 upload,
 * an external link), so callers fall back to the url they already had.
 */
export function thumbnail(src: string | undefined, minWidth = 640): string | undefined {
	if (!src) return undefined;
	const entry = lookup(src) ?? variantIndex().get(src);
	if (!entry) return undefined;
	const webp = entry.variants.filter((v) => v.fmt === 'webp').sort((a, b) => a.w - b.w);
	if (!webp.length) return undefined;
	return at((webp.find((v) => v.w >= minWidth) ?? webp[webp.length - 1]).url);
}

/**
 * An optimized clip + its poster frame.
 *
 * The poster is the point: it paints immediately while the video streams in, so
 * a hero no longer holds up first paint waiting on megabytes of H.264. Anything
 * the video pipeline hasn't touched (a CMS upload, an external URL) passes
 * through untouched and simply has no poster.
 */
export function video(src: string | undefined): { src: string; poster?: string } {
	if (!src) return { src: '' };
	const entry = VIDEOS[src] ?? VIDEOS[encodeURI(src)] ?? VIDEOS[decodeURI(src)];
	if (!entry) return { src };
	return { src: at(entry.src), poster: at(entry.poster) };
}

/**
 * Attributes to spread onto an existing `<img>` — WebP-only (97%+ support), for
 * the CSS-styled full-bleed photos where wrapping in <picture>/a component would
 * put the element outside its scoped styles.
 *
 *   <img {...imgAttrs(grillImage, '100vw')} alt="" class="band-image" />
 *
 * `sizes` tells the browser how wide the image renders so it can pick a variant
 * *before* layout — get it wrong and it over-downloads. width/height are the
 * intrinsic dimensions, which reserve space and kill layout shift.
 */
export function imgAttrs(
	src: string,
	sizes = '100vw'
): {
	src: string;
	srcset?: string;
	sizes?: string;
	width?: number;
	height?: number;
} {
	const entry = lookup(src);
	if (!entry) return { src }; // remote/CMS image — pass through untouched
	return {
		src: fallback(src) ?? src,
		srcset: srcset(src, 'webp'),
		sizes,
		width: entry.width,
		height: entry.height
	};
}
