/**
 * Photo pipeline: HEIC/JPG/PNG -> AVIF + WebP at a ladder of widths.
 *
 * Source photos (iPhone HEIC, full-size JPG) are far too big to ship: a 24MP
 * HEIC is ~3 MB and no browser can even decode one. This emits a responsive set
 * per photo plus a manifest that <Img> reads to build srcset.
 *
 * Idempotent: a photo whose variants all exist and post-date the source is left
 * alone, so re-running after dropping in a new batch only does the new work.
 *
 *   node scripts/optimize-media.mjs            # convert anything new
 *   node scripts/optimize-media.mjs --force    # re-encode everything
 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import convertHeic from 'heic-convert';
import sharp from 'sharp';

const SRC_DIRS = ['static/Content folder'];
const OUT_DIR = 'static/media';
const MANIFEST = 'src/lib/data/media-manifest.json';

/**
 * Widths to emit. Widths at or above the source width collapse to a single one.
 *
 * No 2400 rung: it cost ~27 MB across the library and only pays off on a 4K
 * monitor viewing a full-bleed band. 1600 covers every real layout here — the
 * gallery grid cells are a few hundred px wide and the heroes are veiled video.
 */
const WIDTHS = [640, 1024, 1600];
const FORMATS = {
	avif: { quality: 50, effort: 4 },
	webp: { quality: 80 }
};

// .webp is a SOURCE format here as well as an output one: some artwork arrives
// already web-encoded (the Fusion hero), and without this it skipped the ladder
// entirely and shipped as a single full-size file with no srcset.
const PHOTO_RE = /\.(heic|jpe?g|png|webp)$/i;
const FORCE = process.argv.includes('--force');

/** `IMG_6259.HEIC` -> `img_6259`; leaves uuid-style names intact. */
const slugify = (file) =>
	path
		.basename(file, path.extname(file))
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

/** Decode any supported source into a buffer sharp can read. */
async function decode(file) {
	const raw = await readFile(file);
	// sharp's prebuilt binaries ship without HEIF support (licensing), so a HEIC
	// has to go through libheif first. quality:1 keeps the handoff lossless.
	if (/\.heic$/i.test(file)) return await convertHeic({ buffer: raw, format: 'JPEG', quality: 1 });
	return raw;
}

/** Never upscale, and never emit the same width twice. */
const widthsFor = (srcWidth) => [...new Set(WIDTHS.map((w) => Math.min(w, srcWidth)))].sort((a, b) => a - b);

async function collect() {
	const out = [];
	for (const dir of SRC_DIRS) {
		if (!existsSync(dir)) continue;
		for (const e of await readdir(dir, { withFileTypes: true })) {
			if (e.isFile() && PHOTO_RE.test(e.name)) out.push(path.join(dir, e.name));
		}
	}
	return out.sort();
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	const files = await collect();
	if (!files.length) return console.log('No source photos found.');

	const prev = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : {};
	const manifest = {};
	let srcBytes = 0;
	let outBytes = 0;
	let cached = 0;

	console.log(`${files.length} source photos -> ${OUT_DIR}\n`);

	for (const [i, file] of files.entries()) {
		const slug = slugify(file);
		const srcStat = await stat(file);
		srcBytes += srcStat.size;

		// The public URL exactly as media.ts / the .svelte files write it, so <Img>
		// can look a photo up by the src it already holds.
		const publicPath = '/' + path.relative('static', file).split(path.sep).join('/');

		// Reuse the previous run's entry when every variant is on disk and newer
		// than the source. Avoids re-decoding a 24MP HEIC just to learn its size.
		const hit = prev[publicPath];
		const isFresh =
			!FORCE &&
			hit?.variants?.length &&
			(await Promise.all(
				hit.variants.map(
					async (v) =>
						existsSync(path.join('static', v.url)) &&
						(await stat(path.join('static', v.url))).mtimeMs > srcStat.mtimeMs
				)
			)).every(Boolean);

		let entry;
		if (isFresh) {
			entry = hit;
			cached++;
		} else {
			const decoded = await decode(file);
			const base = sharp(decoded).rotate(); // honour EXIF orientation
			const { width, height } = await base.metadata();
			const variants = [];

			for (const w of widthsFor(width)) {
				for (const [fmt, opts] of Object.entries(FORMATS)) {
					const url = `/media/${slug}-${w}.${fmt}`;
					await sharp(decoded)
						.rotate()
						.resize({ width: w, withoutEnlargement: true })
						.toFormat(fmt, opts)
						.toFile(path.join('static', url));
					variants.push({ w, fmt, url, size: (await stat(path.join('static', url))).size });
				}
			}
			entry = { slug, width, height, variants };
		}

		const total = entry.variants.reduce((a, v) => a + v.size, 0);
		outBytes += total;
		manifest[publicPath] = entry;
		manifest[encodeURI(publicPath)] = entry; // media.ts stores %20-encoded paths

		const saved = ((1 - total / srcStat.size) * 100).toFixed(0);
		console.log(
			`[${String(i + 1).padStart(3)}/${files.length}] ${slug.padEnd(40)}` +
				`${(srcStat.size / 1e6).toFixed(1).padStart(5)}MB -> ${entry.variants.length} variants` +
				`${saved > 0 ? ` (-${saved}%)` : ''}${isFresh ? '  cached' : ''}`
		);
	}

	await writeFile(MANIFEST, JSON.stringify(manifest, null, '\t') + '\n');

	console.log(`\n  sources    ${(srcBytes / 1e6).toFixed(1)} MB`);
	console.log(`  variants   ${(outBytes / 1e6).toFixed(1)} MB  (all widths + both formats)`);
	console.log(`  manifest   ${MANIFEST}`);
	if (cached) console.log(`  ${cached} already up to date`);
	console.log(`\n  A browser downloads ONE variant per photo, not all of them.`);
}

await main();
