/**
 * Video pipeline: re-encode the site's MP4s and give each one a poster frame.
 *
 * The source clips are straight-off-the-phone: the Asia hero alone is 5.2 MB and
 * the landing page autoplays ~4.4 MB before the user touches anything. Every
 * <video> in the app is muted, so the audio track is stripped outright.
 *
 * Emits, per clip, into static/media/:
 *   <slug>.mp4          H.264, CRF-encoded, +faststart, no audio
 *   <slug>-poster.webp  a frame to paint while the video loads
 *
 * …and, for the clips listed in MOTIFS, a boomerang cut as well:
 *   <slug>-motif.mp4    the chosen seconds forward + the same run reversed
 *
 * `+faststart` moves the moov atom to the front so playback can begin before the
 * file has fully downloaded — without it a browser buffers the whole clip first.
 *
 *   node scripts/optimize-video.mjs           # referenced clips only
 *   node scripts/optimize-video.mjs --all     # every clip (for the R2 library)
 *   node scripts/optimize-video.mjs --force   # re-encode even if up to date
 */
import { mkdir, stat, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const OUT_DIR = 'static/media';
const SRC_DIRS = ['static', 'static/Content folder'];
const MANIFEST = 'src/lib/data/video-manifest.json';

const ALL = process.argv.includes('--all');
const FORCE = process.argv.includes('--force');

/** The clips the site actually renders (see src/lib/data/media.ts). */
const REFERENCED = new Set([
	'VIDEO-2026-04-04-21-05-32.mp4', // Asia hero background
	'a355a94d-e057-4202-a283-4bd15e0a6182.mp4', // Asia landing tile
	'VIDEO-2026-04-04-21-05-20.mp4', // Fusion landing tile
	'Blinking.mp4' // Fusion plate motif
]);

/** Hero fills the viewport; tiles/motifs are at most half of it. */
const MAX_WIDTH = (name) => (name === 'VIDEO-2026-04-04-21-05-32.mp4' ? 1920 : 1280);

/**
 * Clips that also get a BOOMERANG cut for the circular plate motif.
 *
 * The motif used to be made in the browser: play a few seconds, then walk
 * currentTime backwards a frame at a time. That only ever looks smooth on a clip
 * with dense keyframes — these are encoded at libx264's default 250-frame GOP, so
 * a backwards seek near the turnaround made the decoder replay ~90 frames from
 * the keyframe at 0, EVERY frame. It juddered at the turnaround and smoothed out
 * as it approached 0, on repeat.
 *
 * So bake the bounce into the file instead: forward, then the same run reversed,
 * played with a plain `loop`. No seeking at all, smooth on any device.
 *
 * The turnaround frame and the loop-point frame are dropped, otherwise each shows
 * for two frames and the bounce visibly hitches.
 */
const MOTIFS = {
	'VIDEO-2026-04-04-21-05-20.mp4': { start: 0, seconds: 3, fps: 30, width: 720 }
};

const slugify = (file) =>
	path
		.basename(file, path.extname(file))
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

const mb = (b) => (b / 1e6).toFixed(1);

async function collect() {
	const out = [];
	for (const dir of SRC_DIRS) {
		if (!existsSync(dir)) continue;
		for (const e of await readdir(dir, { withFileTypes: true })) {
			if (!e.isFile() || !e.name.endsWith('.mp4')) continue;
			if (e.name.includes('orig-backup')) continue;
			if (!ALL && !REFERENCED.has(e.name)) continue;
			out.push(path.join(dir, e.name));
		}
	}
	return out.sort();
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });
	const files = await collect();
	if (!files.length) return console.log('No videos to process.');

	console.log(`${files.length} clip(s) -> ${OUT_DIR}\n`);
	const manifest = {};
	let srcBytes = 0;
	let outBytes = 0;

	for (const file of files) {
		const name = path.basename(file);
		const slug = slugify(file);
		const srcStat = await stat(file);
		srcBytes += srcStat.size;

		// The public URL exactly as media.ts writes it, so responsive.ts can look a
		// clip up by the src it already holds. Both raw and %20-encoded forms.
		const publicPath = '/' + path.relative('static', file).split(path.sep).join('/');

		const outMp4 = path.join(OUT_DIR, `${slug}.mp4`);
		const outPoster = path.join(OUT_DIR, `${slug}-poster.webp`);
		const w = MAX_WIDTH(name);

		const fresh =
			!FORCE && existsSync(outMp4) && (await stat(outMp4)).mtimeMs > srcStat.mtimeMs;

		if (!fresh) {
			// scale: cap width, keep aspect, force even dims (H.264 needs them).
			await run('ffmpeg', [
				'-hide_banner', '-loglevel', 'error', '-y',
				'-i', file,
				'-vf', `scale='min(${w},iw)':-2`,
				'-c:v', 'libx264',
				'-r', '30',           // ambient background loops; 60fps is wasted bytes
				'-crf', '30',
				'-preset', 'slow',
				'-profile:v', 'high',
				'-pix_fmt', 'yuv420p',
				'-movflags', '+faststart',
				'-an', // every <video> in the app is muted
				outMp4
			]);

			// Poster from ~0.5s in — frame 0 is often a black fade-in.
			await run('ffmpeg', [
				'-hide_banner', '-loglevel', 'error', '-y',
				'-ss', '0.5',
				'-i', file,
				'-frames:v', '1',
				'-vf', `scale='min(${w},iw)':-2`,
				'-q:v', '80',
				outPoster
			]);
		}

		const size = (await stat(outMp4)).size;
		const poster = (await stat(outPoster)).size;
		outBytes += size + poster;

		const entry = { slug, src: `/media/${slug}.mp4`, poster: `/media/${slug}-poster.webp` };
		manifest[publicPath] = entry;
		manifest[encodeURI(publicPath)] = entry;

		const motif = MOTIFS[name];
		if (motif) {
			const outMotif = path.join(OUT_DIR, `${slug}-motif.mp4`);
			const motifFresh =
				!FORCE && existsSync(outMotif) && (await stat(outMotif)).mtimeMs > srcStat.mtimeMs;

			if (!motifFresh) {
				// n = frames in the forward run. Dropping the reversed run's first and
				// last frames removes the duplicate at the turnaround and at the loop
				// point respectively (trim's end_frame is exclusive).
				const n = Math.round(motif.seconds * motif.fps);
				await run('ffmpeg', [
					'-hide_banner', '-loglevel', 'error', '-y',
					'-ss', String(motif.start),
					'-t', String(motif.seconds),
					'-i', file,
					'-filter_complex',
					`[0:v]fps=${motif.fps},scale='min(${motif.width},iw)':-2,setsar=1,split[f][t];` +
						`[t]reverse,trim=start_frame=1:end_frame=${n - 1},setpts=PTS-STARTPTS[r];` +
						`[f][r]concat=n=2:v=1:a=0[v]`,
					'-map', '[v]',
					'-c:v', 'libx264',
					'-crf', '26',        // it loops forever in a small disc; keep it clean
					'-preset', 'slow',
					'-profile:v', 'high',
					'-pix_fmt', 'yuv420p',
					'-g', String(motif.fps), // a keyframe a second, so any seek stays cheap
					'-movflags', '+faststart',
					'-an',
					outMotif
				]);
			}

			const motifSize = (await stat(outMotif)).size;
			outBytes += motifSize;
			// Keyed by its OWN public path: the plate motif slot points straight at
			// this file, while the full-length clip keeps serving the landing tile.
			const motifSrc = `/media/${slug}-motif.mp4`;
			manifest[motifSrc] = { slug: `${slug}-motif`, src: motifSrc, poster: entry.poster };
			console.log(
				`  ${(slug + '-motif').padEnd(42)} ${' '.repeat(5)}   -> ${mb(motifSize).padStart(5)}MB` +
					`  boomerang ${motif.seconds}s${motifFresh ? '  cached' : ''}`
			);
		}

		const saved = ((1 - size / srcStat.size) * 100).toFixed(0);
		console.log(
			`  ${slug.padEnd(42)} ${mb(srcStat.size).padStart(5)}MB -> ${mb(size).padStart(5)}MB` +
				` (-${saved}%)  +poster ${(poster / 1024).toFixed(0)}KB${fresh ? '  cached' : ''}`
		);
	}

	await writeFile(MANIFEST, JSON.stringify(manifest, null, '\t') + '\n');

	console.log(`\n  sources  ${mb(srcBytes)} MB`);
	console.log(`  output   ${mb(outBytes)} MB  (incl. posters)`);
	console.log(`  manifest ${MANIFEST}`);
}

await main();
