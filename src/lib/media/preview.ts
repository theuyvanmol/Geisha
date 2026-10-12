// Admin-side preview URL resolver.
//
// The content blobs store the ORIGINAL public paths ('/Content%20folder/x.jpg',
// '/Blinking.mp4'). On the public site those are only *manifest keys*: every
// renderer runs them through imgAttrs()/video() in $lib/media/responsive, which
// swaps in the optimized AVIF/WebP/MP4 variant served from R2. The raw files are
// gitignored (see .gitignore → "static/Content folder/") and are never deployed.
//
// The admin editors were dropping those raw paths straight into <img src>/<video
// src>. That works locally — the masters are still on disk — but every preview
// thumbnail 404s on the deployed admin, so staff pick images blind. These two
// helpers do the same manifest lookup the public pages do, and pass anything the
// pipeline doesn't know about (an R2 upload, an external URL) through untouched.

import { fallback, thumbnail, video } from './responsive';
import { localPreview } from './localPreviews';

/** Displayable URL for an image path held in a content blob. */
export function adminPreview(src: string | undefined): string {
	if (!src) return '';
	// A file uploaded moments ago is drawn from the copy still in memory — its R2
	// object isn't dependably servable yet. See localPreviews.ts.
	return localPreview(src) ?? fallback(src) ?? src;
}

/**
 * Displayable URL for a SMALL admin thumbnail (picker tiles, gallery grid).
 *
 * adminPreview() hands back the widest WebP, which is right for a card-sized
 * preview and catastrophic for a wall of them: the picker was pulling ~140
 * 1600px masters to fill 130px tiles, which is what made it crawl. Falls back to
 * the full-size url for anything the pipeline doesn't know (R2 uploads carry
 * their own ladder — see the `thumb` field on /api/admin/media).
 */
export function adminThumb(src: string | undefined, minWidth = 640): string {
	if (!src) return '';
	return localPreview(src) ?? thumbnail(src, minWidth) ?? adminPreview(src);
}

/** Displayable URL for a video path held in a content blob. */
export function adminVideoPreview(src: string | undefined): string {
	if (!src) return '';
	return localPreview(src) ?? video(src).src ?? src;
}

/** Poster frame for a video preview, when the pipeline generated one. */
export function adminVideoPoster(src: string | undefined): string | undefined {
	if (!src) return undefined;
	return video(src).poster;
}
