// Admin media — upload + list images/video for the content image picker.
//
//   POST  multipart/form-data { file, alt?, label?, brand? } -> { ok, id, url, alt }
//   GET   ?brand=asia|fusion (optional) -> { media: { id, url, alt, label }[] }
//
// Uploads go to Cloudflare R2 and are served from its CDN. They used to be
// PocketBase `file` attachments on the droplet's local disk, which meant a 1 GB
// shared box was the origin for every image on the site, and a staff member
// uploading a 3 MB straight-from-the-phone photo put a 3 MB photo on the site.
//
// Now, for an image:
//   • sharp re-encodes it to an AVIF + WebP ladder (640/1024/1600) — a typical
//     phone photo lands ~150 KB instead of ~3 MB
//   • every variant goes to R2; the widest WebP is the canonical URL that drops
//     into a content blob's `src`
//   • the ladder is recorded on the PocketBase row's `variants` field
//
// Video can't be transcoded in a serverless function (ffmpeg is far too heavy),
// so clips are stored as-is. Staff should run `npm run media` on a source file
// for anything big — see scripts/optimize-video.mjs.
//
// PocketBase keeps only the METADATA (alt, label, brand, audit trail), which is
// what it was actually good for. Rows created before this change still carry a
// `file` attachment and keep rendering — see mediaUrl().

import { json, error } from '@sveltejs/kit';
import sharp from 'sharp';
import { pb } from '$lib/server/db/pb';
import { put, isConfigured } from '$lib/server/r2';
import { getContent, upsertContent } from '$lib/server/content/content';
import { listUploads, smallestWebp } from '$lib/server/media/uploads';
import { getRestaurant } from '$lib/server/booking/queries';
import { writeAudit } from '$lib/server/booking/audit';
import { requireRole } from '$lib/server/auth/rbac';
import { GALLERY_CATEGORIES, type GalleryCategory } from '$lib/data/gallery-categories';
import type { GalleryContent } from '$lib/content/schema';
import type { MediaRecord, BrandId } from '$lib/server/db/types';
import type { RequestHandler } from './$types';

const isBrand = (v: unknown): v is BrandId => v === 'asia' || v === 'fusion';
const isCategory = (v: unknown): v is GalleryCategory =>
	typeof v === 'string' && (GALLERY_CATEGORIES as readonly string[]).includes(v);

/** Matches scripts/optimize-media.mjs so uploads and the seeded library look alike. */
const WIDTHS = [640, 1024, 1600];
const FORMATS = [
	{ fmt: 'avif' as const, type: 'image/avif', opts: { quality: 50, effort: 4 } },
	{ fmt: 'webp' as const, type: 'image/webp', opts: { quality: 80 } }
];

interface Variant {
	w: number;
	fmt: 'avif' | 'webp';
	url: string;
}

// Reading a row's public url and picking its thumbnail variant now live in
// $lib/server/media/uploads.ts, shared with the Library page.

/** Collision-proof, URL-safe stem for one upload. */
function keyStem(filename: string): string {
	const slug =
		filename
			.replace(/\.[^.]+$/, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 48) || 'upload';
	return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	// Uploads land on the public website — manager+ (see $lib/admin/access.ts).
	requireRole(locals.staff, 'manager');
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!form || !(file instanceof File) || file.size === 0) {
		throw error(400, 'Provide a `file` in multipart/form-data.');
	}
	if (!isConfigured()) {
		throw error(500, 'Media storage is not configured — see R2_* in .env.example.');
	}

	const isVideo = file.type.startsWith('video/');
	const stem = keyStem(file.name);
	const input = new Uint8Array(await file.arrayBuffer());

	let canonical: string;
	let variants: Variant[] = [];

	if (isVideo) {
		// No transcode here: ffmpeg in a serverless function would blow the time and
		// memory budget. Stored as uploaded.
		const ext = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? 'mp4';
		canonical = await put(`media/uploads/${stem}.${ext}`, input, file.type || 'video/mp4');
	} else {
		// Re-encode the ladder. `rotate()` bakes in EXIF orientation, which is why
		// phone photos otherwise show up sideways.
		const base = sharp(input).rotate();
		const meta = await base.metadata().catch(() => null);
		if (!meta?.width) throw error(400, 'That file could not be read as an image.');

		// Never upscale, and never emit the same width twice.
		const widths = [...new Set(WIDTHS.map((w) => Math.min(w, meta.width!)))].sort((a, b) => a - b);

		for (const w of widths) {
			for (const { fmt, type, opts } of FORMATS) {
				const buf = await sharp(input)
					.rotate()
					.resize({ width: w, withoutEnlargement: true })
					.toFormat(fmt, opts)
					.toBuffer();
				const url = await put(`media/uploads/${stem}-${w}.${fmt}`, buf, type);
				variants.push({ w, fmt, url });
			}
		}

		// The widest WebP is the fallback everything understands, and it's what gets
		// pasted into the content blob.
		const webp = variants.filter((v) => v.fmt === 'webp');
		canonical = webp.reduce((a, b) => (a.w > b.w ? a : b)).url;
	}

	const c = await pb();
	const payload: Record<string, unknown> = {
		alt: String(form.get('alt') ?? ''),
		label: String(form.get('label') ?? file.name),
		url: canonical,
		variants
	};

	const brand = form.get('brand');
	if (isBrand(brand)) {
		const restaurant = await getRestaurant(brand);
		payload.restaurant = restaurant.id;
	}

	const rec = await c.collection('geisha_media').create<MediaRecord>(payload);
	await writeAudit('staff', 'upload_media', 'geisha_media', rec.id, null, {
		url: canonical,
		alt: rec.alt,
		variants: variants.length
	});

	// "Which gallery should this go in?" — chosen at upload time, because a photo
	// with no home is one nobody can find again. Filing it here (rather than
	// leaving it to the caller) is what lets the picker offer the library BY
	// GALLERY instead of as an undifferentiated wall of uploads.
	//
	// The Gallery editor itself passes addToGallery=0: it holds an unsaved working
	// copy of the whole blob, and a server-side append would be overwritten by its
	// next Save — it adds the new picture to that copy instead.
	const category = form.get('category');
	const wantsGallery = form.get('addToGallery') !== '0';
	let filedUnder: GalleryCategory | null = null;
	if (wantsGallery && isBrand(brand) && isCategory(category) && !isVideo) {
		try {
			const current = await getContent<GalleryContent>(brand, 'gallery', []);
			if (!current.some((g) => g.src === canonical)) {
				await upsertContent(brand, 'gallery', [
					...current,
					{ src: canonical, alt: String(payload.alt || ''), category }
				]);
			}
			filedUnder = category;
		} catch (err) {
			// The file itself is safely uploaded; failing to file it must not fail
			// the upload. The picker reports it as uncategorised.
			console.error('[media] could not add upload to the gallery:', err);
		}
	}

	// `thumb` too, not just the canonical url: the grids render the SMALLEST webp,
	// so a caller holding the file in memory needs that key to draw it from the
	// local copy rather than asking the CDN for an object it hasn't got yet.
	return json({
		ok: true,
		id: rec.id,
		url: canonical,
		thumb: smallestWebp(rec) ?? canonical,
		alt: rec.alt,
		category: filedUnder
	});
};

export const GET: RequestHandler = async ({ url }) => {
	const brand = url.searchParams.get('brand');
	const [media, gallery] = await Promise.all([
		// Same list the Library page shows — one implementation, in $lib/server/media.
		listUploads(isBrand(brand) ? brand : undefined),
		// The gallery is what gives a picture a category, so the picker needs it to
		// offer the library by gallery rather than as one undifferentiated list.
		isBrand(brand) ? getContent<GalleryContent>(brand, 'gallery', []) : Promise.resolve([])
	]);

	return json({
		media: media.map((m) => ({
			id: m.id,
			url: m.url,
			// The narrowest WebP of the upload's own ladder, so the picker's grid of
			// 130px tiles doesn't pull a wall of 1600px masters.
			thumb: m.thumb,
			alt: m.alt,
			label: m.label
		})),
		gallery: gallery.map((g) => ({ src: g.src, alt: g.alt, category: g.category }))
	});
};
