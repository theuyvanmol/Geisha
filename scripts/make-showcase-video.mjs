/**
 * Home-page showcase footage: cut the Sep 2026 phone shoot (+ the older room
 * clips and food stills) into the loops and reels the home-page "look" options use.
 *
 * The shoot is 4K/60 HEVC but PORTRAIT and only 2–8 s a clip, so nothing here is
 * a straight transcode:
 *
 *   - 60 fps is played at 30 → every clip becomes a smooth half-speed slow-mo,
 *     which also doubles how long each one lasts.
 *   - A 16:9 window cut out of a 2160×3840 frame is still 2160×1215 — more than
 *     1080p — so the landscape reel is made by REFRAMING, and the crop is moved
 *     down the frame over time: a virtual tilt from the lanterns/wisteria down to
 *     the tables, a camera move nobody actually made.
 *   - The older room clips are ~480p. They are never blown up full-frame; they go
 *     into a three-up "triptych" panel where each sits near its native size.
 *   - The shoot has no food in it, so the reels close on the brand's own food
 *     photography with a slow push-in.
 *
 * Inputs (none of them are in the repo — pass the folders):
 *   --masters  stabilised 30 fps masters of the IMG_*.MOV shoot (vidstab + setpts=2*PTS)
 *   --content  the old "static/Content folder" (older room/kitchen clips + food stills)
 *   --food     extra food stills downloaded from R2 (a_*.webp / f_*.webp)
 *
 *   node scripts/make-showcase-video.mjs --masters <dir> --content <dir> --food <dir> --new <dir>
 *
 * Emits into static/media/ as showcase-* (gitignored → `npm run media:upload` → R2):
 *   showcase-<brand>-reel.mp4      16:9 1920×1080 loop for desktop
 *   showcase-<brand>-reel-m.mp4    9:16 1080×1920 loop for phones
 *   showcase-<brand>-<clip>.mp4    9:16  720×1280 single-room loops for the portrait frames
 *   …each with a -poster.webp
 */
import { mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const arg = (k) => {
	const i = process.argv.indexOf(`--${k}`);
	return i > -1 ? process.argv[i + 1] : undefined;
};
const MASTERS = arg('masters');
const CONTENT = arg('content');
const FOOD = arg('food');
if (!MASTERS || !CONTENT || !FOOD) {
	console.error('usage: --masters <dir> --content <dir> --food <dir>');
	process.exit(1);
}
const ONLY = arg('only'); // e.g. --only asia-reel
const OUT = 'static/media';
const TMP = path.join(OUT, '.tmp-showcase');

const FPS = 30;
const INK = { asia: '0x08080b', fusion: '0x0c1410' };
// Light, shared grade: a touch of contrast + saturation. The old night clips also
// get a gentle denoise first — their noise is what makes 480p look worse than it is.
const GRADE = 'eq=contrast=1.05:saturation=1.08';
// The old Asia room clips are dark phone footage; lift the mids hard (gamma) so the
// rooms chapter doesn't sit at half the brightness of everything around it.
const NIGHT = 'hqdn3d=1.5:1.5:5:5,eq=contrast=1.05:saturation=1.1:gamma=1.32:brightness=0.02';

const m = (f) => path.join(MASTERS, f);
const c = (f) => path.join(CONTENT, f);
const fd = (f) => path.join(FOOD, f);
// --new: the Oct 2026 photo drop, as downloaded (Asia/ and Fusion/ subfolders)
const NEW = arg('new') ?? '';
const na = (f) => path.join(NEW, 'asia', f);
const nf = (f) => path.join(NEW, 'fusion', f);
// --drive: the owner's own picks for Fusion's Doorway (Drive "Geisha 3 image" → Fusion), as downloaded
const DRIVE = arg('drive') ?? '';
const dr = (f) => path.join(DRIVE, f);

async function ff(args, label) {
	const t = Date.now();
	await run('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 26 });
	console.log(`  ${label} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
}

/** Intermediate: visually lossless, every frame a keyframe-friendly x264. */
const MID = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', `${FPS}`];

// ---------------------------------------------------------------- segments

/**
 * A moving crop out of a 4K portrait master — the virtual tilt.
 * y0→y1 are in source pixels; the crop is the source width at the target aspect.
 */
async function tilt(out, src, { W, H, start = 0, dur, y0, y1, x0, cropW }) {
	const cw = cropW ?? 2160;
	const ch = Math.round((cw * H) / W);
	const x = x0 ?? `(in_w-${cw})/2`;
	// Ease in/out over the shot so the move starts and lands rather than lurching.
	// (Commas inside an expression must be escaped or the filtergraph splits on them.)
	const p = `(0.5-0.5*cos(PI*min(t/${dur}\\,1)))`;
	const vf = `crop=${cw}:${ch}:${x}:${y0}+(${y1 - y0})*${p},scale=${W}:${H}:flags=lanczos,${GRADE}`;
	await ff(['-ss', `${start}`, '-t', `${dur}`, '-i', src, '-vf', vf, ...MID, out], `tilt ${path.basename(out)}`);
}

/** A slow push-in on a still. Upscaled 3× first so zoompan's integer steps don't judder. */
async function still(out, src, { W, H, dur, zoom = 0.07, fx = 0.5, fy = 0.5 }) {
	const n = Math.round(dur * FPS);
	const vf = [
		`scale=${W * 3}:${H * 3}:force_original_aspect_ratio=increase:flags=lanczos`,
		`crop=${W * 3}:${H * 3}`,
		`zoompan=z='1+${zoom}*on/${n}':x='(iw-iw/zoom)*${fx}':y='(ih-ih/zoom)*${fy}':d=1:s=${W}x${H}:fps=${FPS}`,
		GRADE
	].join(',');
	await ff(['-loop', '1', '-framerate', `${FPS}`, '-t', `${dur}`, '-i', src, '-vf', vf, '-frames:v', `${n}`, ...MID, out], `still ${path.basename(out)}`);
}

/**
 * Three clips side by side, each rising into its panel a beat after the last.
 * clips: [{ src, start, speed, night, raw }]  (raw: already graded, e.g. a rendered still)
 */
async function triptych(out, clips, { W, H, dur, gap = 8, bg }) {
	const pw = Math.floor((W - gap * (clips.length - 1)) / clips.length);
	const inputs = [];
	let fc = `color=c=${bg}:s=${W}x${H}:r=${FPS}:d=${dur}[base];`;
	clips.forEach((k, i) => {
		inputs.push('-ss', `${k.start ?? 0}`, '-i', k.src);
		const d = 0.18 * i + 0.1; // stagger
		fc +=
			`[${i}:v]setpts=${k.speed ?? 1}*(PTS-STARTPTS),fps=${FPS},trim=0:${dur},setpts=PTS-STARTPTS,` +
			`scale=${pw}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${pw}:${H},` +
			`${k.night ? NIGHT : k.raw ? 'null' : GRADE},fade=in:st=${d}:d=0.7[p${i}];`;
	});
	let last = 'base';
	clips.forEach((_, i) => {
		const x = i * (pw + gap);
		const d = 0.18 * i + 0.1;
		// 28px rise, eased out, finished by d+0.9s
		const y = `'28*pow(max(0,1-max(0,t-${d})/0.9),3)'`;
		fc += `[${last}][p${i}]overlay=x=${x}:y=${y}:eval=frame:shortest=0[o${i}];`;
		last = `o${i}`;
	});
	fc = fc.replace(/;$/, '');
	await ff([...inputs, '-filter_complex', fc, '-map', `[${last}]`, '-t', `${dur}`, ...MID, out], `triptych ${path.basename(out)}`);
}

/** One older clip (or 4K master), reframed to fill the target. */
async function single(out, src, { W, H, start = 0, dur, speed = 1, night = false, crop }) {
	const pre = crop ? `crop=${crop},` : '';
	const vf =
		`setpts=${speed}*(PTS-STARTPTS),fps=${FPS},${pre}` +
		`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},${night ? NIGHT : GRADE}`;
	await ff(['-ss', `${start}`, '-i', src, '-vf', vf, '-t', `${dur}`, ...MID, out], `single ${path.basename(out)}`);
}

// ---------------------------------------------------------------- assembly

/**
 * Join [file, duration] segments into one loop with a short dip through black
 * between each (not a cross-dissolve: dissolving a three-up panel into a full
 * frame leaves a double exposure with hard vertical seams). The loop point
 * fades up from / down to the brand ink so it reads as a breath, not a cut.
 * Prints where each segment's picture begins — those are the chapter times
 * in $lib/data/showcase.ts.
 */
async function join(out, segs, { xf = 0.5, bg, crf = 26, preset = 'slow' }) {
	const inputs = segs.flatMap(([f]) => ['-i', f]);
	let fc = '';
	let acc = segs[0][1];
	let last = '0:v';
	const starts = [0];
	for (let i = 1; i < segs.length; i++) {
		const off = acc - xf;
		starts.push(+(off + xf / 2).toFixed(2));
		fc += `[${last}][${i}:v]xfade=transition=fadeblack:duration=${xf}:offset=${off.toFixed(3)}[x${i}];`;
		last = `x${i}`;
		acc = acc - xf + segs[i][1];
	}
	const total = acc;
	fc += `[${last}]fade=in:st=0:d=0.4:c=${bg},fade=out:st=${(total - 0.4).toFixed(3)}:d=0.4:c=${bg}[v]`;
	await ff(
		[...inputs, '-filter_complex', fc, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', preset, '-crf', `${crf}`,
			'-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', `${FPS}`, out],
		`JOIN ${path.basename(out)} ${total.toFixed(2)}s  segment starts: ${starts.join(', ')}`
	);
	return total;
}

/** Encode a single loop for the web (and bake a boomerang when asked). */
async function finish(out, src, { crf = 26, boomerang = false }) {
	const vf = boomerang
		? "[0:v]split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1[v]"
		: '[0:v]null[v]';
	await ff(
		['-i', src, '-filter_complex', vf, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', `${crf}`,
			'-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
		`LOOP ${path.basename(out)}`
	);
}

async function poster(mp4, at = 1.2) {
	const out = mp4.replace(/\.mp4$/, '-poster.webp');
	await ff(['-ss', `${at}`, '-i', mp4, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '78', out], `poster ${path.basename(out)}`);
}

const t = (name) => path.join(TMP, `${name}.mp4`);

// ---------------------------------------------------------------- recipes

const JOBS = {
	/* ============================ ASIA ============================ */
	// Running order for both houses: the room, then the FOOD in the middle third
	// (the manager's point is to see the food without waiting), then the rest.
	// The Oct 2026 photo drop (--new, Asia/ and Fusion/ subfolders) is the sharpest
	// material Asia has: its room photos replace most of the ~480p room clips, and
	// its dishes are what the food chapter shows. Dishes were checked against
	// menus.asia.ts / menus.fusion.ts — the drop's "Asia" folder held three Fusion
	// plates (carbonara, ravioli, meat platter); those are used for Fusion only.
	async 'asia-reel'() {
		const L = { W: 1920, H: 1080 };
		const bg = INK.asia;
		// Outside: tilt from the roofline + sign down to the shopfront, stopping above the cars.
		await tilt(t('a-ext'), m('IMG_0786.mp4'), { ...L, start: 0.5, dur: 4.5, y0: 480, y1: 760 });
		// The food: dim sum, poke, salt & pepper (landscape originals, full frame).
		await still(t('a-f1'), na('IMG-20261002-WA0036.jpg'), { ...L, dur: 2.6, fx: 0.55 });
		await still(t('a-f2'), na('IMG-20261002-WA0041.jpg'), { ...L, dur: 2.6, fy: 0.45 });
		await still(t('a-f3'), na('IMG-20261002-WA0037.jpg'), { ...L, dur: 2.6, fx: 0.6 });
		// The rooms: two portrait room photos either side of the neon 欢迎 clip, so the
		// panel still moves; each photo panel is a downscale, not an upscale.
		const PANEL = { W: 634, H: 1080 };
		await still(t('a-r1'), na('IMG-20261002-WA0026.jpg'), { ...PANEL, dur: 5, fy: 0.3, zoom: 0.06 });
		await still(t('a-r3'), na('IMG-20261002-WA0028.jpg'), { ...PANEL, dur: 5, fy: 0.4, zoom: 0.06 });
		await triptych(t('a-rooms'), [
			{ src: t('a-r1'), raw: true },
			{ src: c('62d8dde2-c29d-4347-b0b3-09cee899819f.mp4'), speed: 2, night: true },
			{ src: t('a-r3'), raw: true }
		], { ...L, dur: 5, bg });
		const out = path.join(OUT, 'showcase-asia-reel-v4.mp4');
		await join(out, [[t('a-ext'), 4.5], [t('a-f1'), 2.6], [t('a-f2'), 2.6], [t('a-f3'), 2.6], [t('a-rooms'), 5]], { bg, crf: 27 });
		await poster(out, 5);
	},
	async 'asia-reel-m'() {
		const P = { W: 1080, H: 1920 };
		const bg = INK.asia;
		await tilt(t('am-ext'), m('IMG_0786.mp4'), { ...P, start: 0.5, dur: 4.5, y0: 300, y1: 450, cropW: 1200, x0: 450 });
		// portrait originals for the phone cut: shumai, gyoza, salt & pepper chicken
		await still(t('am-f1'), na('IMG-20261002-WA0034.jpg'), { ...P, dur: 2.6 });
		await still(t('am-f2'), na('IMG-20261002-WA0038.jpg'), { ...P, dur: 2.6 });
		await still(t('am-f3'), na('IMG-20261002-WA0033.jpg'), { ...P, dur: 2.6 });
		await still(t('am-r1'), na('IMG-20261002-WA0026.jpg'), { ...P, dur: 3.2, fy: 0.3 });
		await single(t('am-r2'), c('62d8dde2-c29d-4347-b0b3-09cee899819f.mp4'), { ...P, dur: 3, speed: 2, night: true });
		await still(t('am-r3'), na('IMG-20261002-WA0029.jpg'), { ...P, dur: 3.2, fy: 0.4 });
		const out = path.join(OUT, 'showcase-asia-reel-m-v4.mp4');
		await join(out, [[t('am-ext'), 4.5], [t('am-f1'), 2.6], [t('am-f2'), 2.6], [t('am-f3'), 2.6], [t('am-r1'), 3.2], [t('am-r2'), 3], [t('am-r3'), 3.2]], { bg, crf: 28 });
		await poster(out, 5);
	},
	// The doorway's closed-arch shot for Asia: the lantern room photo with a slow
	// push in and back out (boomerang), sharper than any Asia room clip there is.
	async 'asia-door'() {
		await still(t('ad'), na('IMG-20261002-WA0026.jpg'), { W: 1080, H: 1920, dur: 5, fy: 0.3, zoom: 0.08 });
		const out = path.join(OUT, 'showcase-asia-door-v1.mp4');
		await finish(out, t('ad'), { crf: 26, boomerang: true });
		await poster(out, 0.1);
	},
	// Photos for the Filmstrip and Menu-board looks, at two widths for srcset.
	// Portrait sources are 3:4, landscape 4:3 — showcase.ts relies on that.
	async images() {
		const jobs = [
			['asia-room-lanterns', na('IMG-20261002-WA0026.jpg')],
			['asia-room-floor', na('IMG-20261002-WA0027.jpg')],
			['asia-room-entrance', na('IMG-20261002-WA0028.jpg')],
			['asia-room-tables', na('IMG-20261002-WA0029.jpg')],
			['asia-dimsum', na('IMG-20261002-WA0036.jpg')],
			['asia-duck', na('IMG-20261002-WA0035.jpg')],
			['asia-poke', na('IMG-20261002-WA0041.jpg')],
			['asia-gyoza', na('IMG-20261002-WA0038.jpg')],
			['asia-shumai', na('IMG-20261002-WA0034.jpg')],
			['asia-saltpepper', na('IMG-20261002-WA0037.jpg')],
			['asia-ribs', na('IMG-20261002-WA0039.jpg')],
			['asia-curry', na('IMG-20261002-WA0040.jpg')],
			['asia-mochi', nf('IMG-20260731-WA0028.jpg')],
			['fusion-burger', nf('IMG-20260929-WA0029.jpg')],
			['fusion-paella', nf('IMG-20260929-WA0030.jpg')],
			['fusion-spread', nf('IMG-20260929-WA0031.jpg')],
			['fusion-pizza', nf('IMG-20260929-WA0034.jpg')],
			['fusion-brownie', nf('IMG-20260731-WA0001.jpg')],
			['fusion-cheesecake', nf('IMG-20260731-WA0018.jpg')],
			['fusion-carbonara', na('IMG-20261002-WA0030.jpg')],
			['fusion-fishchips', c('IMG_6394.JPG')]
		];
		for (const [name, src] of jobs) {
			for (const w of [640, 1200]) {
				const out = path.join(OUT, `showcase-img-${name}-${w}.webp`);
				await ff(['-i', src, '-vf', `scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '80', out], `img ${name} ${w}`);
			}
		}
	},
	// Second pass on the photos, after the design critique:
	//  - Fusion's burger and pizza were phone shots with a blue-grey cast and a lot
	//    of table / bar mat around the food: crop to the dish, warm and lift them.
	//  - Asia had no sushi anywhere although its copy leads with it.
	//  - a 1600w cut of the landscape carbonara for the board's large frame.
	// New names (-v2) rather than overwriting: uploads are cached as immutable.
	async recrops() {
		const WARM = 'colorbalance=rs=0.05:gs=0.01:bs=-0.06:rm=0.05:gm=0.01:bm=-0.05,eq=brightness=0.03:contrast=1.08:saturation=1.25:gamma=1.1';
		const jobs = [
			// [name, source, filter before scaling, widths]
			['fusion-burger-v2', nf('IMG-20260929-WA0029.jpg'), `crop=720:960:300:512,${WARM}`, [640, 1200]],
			['fusion-pizza-v2', nf('IMG-20260929-WA0034.jpg'), `crop=936:1248:132:352,${WARM}`, [640, 1200]],
			['asia-sushi', c('IMG_6305.JPG'), null, [640, 1200]],
			['fusion-carbonara', na('IMG-20261002-WA0030.jpg'), null, [1600]]
		];
		for (const [name, src, pre, widths] of jobs) {
			for (const w of widths) {
				const out = path.join(OUT, `showcase-img-${name}-${w}.webp`);
				const vf = `${pre ? pre + ',' : ''}scale=${w}:-2:flags=lanczos`;
				await ff(['-i', src, '-vf', vf, '-c:v', 'libwebp', '-quality', '82', out], `img ${name} ${w}`);
			}
		}
	},
	// Third pass, after the second critique:
	//  - Fusion's burger and fish and chips still read colder than the pizza beside
	//    them: a stronger warm. The pizza loses the bar mat along its top edge; the
	//    brownie loses the drinks menu standing behind it; the paella is cropped to
	//    the pan (it was 60% grey table).
	//  - Asia's board used two near-identical wooden-table shots, half bare wood:
	//    portrait crops of the studio dim sum and the poke bowl replace them (the sushi
	//    platter is a long diagonal and does not survive a portrait crop).
	async recrops3() {
		const WARM = 'colorbalance=rs=0.09:gs=0.02:bs=-0.09:rm=0.08:gm=0.02:bm=-0.08,eq=brightness=0.04:contrast=1.08:saturation=1.3:gamma=1.12';
		const MILD = 'colorbalance=rs=0.04:bs=-0.05:rm=0.04:bm=-0.04,eq=saturation=1.15:gamma=1.05';
		const jobs = [
			['fusion-burger-v3', nf('IMG-20260929-WA0029.jpg'), `crop=720:960:300:512,${WARM}`],
			['fusion-pizza-v3', nf('IMG-20260929-WA0034.jpg'), `crop=870:1160:165:440,${MILD}`],
			['fusion-paella-v2', nf('IMG-20260929-WA0030.jpg'), `crop=780:1040:216:240,${WARM}`],
			['fusion-fishchips-v2', c('IMG_6394.JPG'), MILD],
			['fusion-brownie-v2', nf('IMG-20260731-WA0001.jpg'), 'crop=900:1200:215:400'],
			['asia-dimsum-p', na('IMG-20261002-WA0036.jpg'), 'crop=900:1200:600:0'],
			['asia-poke-p', na('IMG-20261002-WA0041.jpg'), 'crop=900:1200:350:0']
		];
		for (const [name, src, pre] of jobs) {
			for (const w of [640, 1200]) {
				const out = path.join(OUT, `showcase-img-${name}-${w}.webp`);
				await ff(['-i', src, '-vf', `${pre},scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', out], `img ${name} ${w}`);
			}
		}
	},
	// The filmstrip's second row (the owner wanted more in it). Every item was
	// looked at and checked: dishes against the two menus by name, rooms by their
	// lanterns / murals / chairs.
	//   --rooms <dir>: Fusion's three room photos, downloaded from its live gallery
	//   (bright-dining-room, family-friendly-dining-room, img-6261-5) as f1/f2/f3.webp
	async more() {
		const ROOMS = arg('rooms') ?? '';
		const WARM = 'colorbalance=rs=0.09:gs=0.02:bs=-0.09:rm=0.08:gm=0.02:bm=-0.08,eq=brightness=0.04:contrast=1.08:saturation=1.3:gamma=1.12';
		const MILD = 'colorbalance=rs=0.04:bs=-0.05:rm=0.04:bm=-0.04,eq=saturation=1.15:gamma=1.05';
		const photos = [
			['asia-chicken', na('IMG-20261002-WA0033.jpg'), null], // Salt & Chilli Chicken
			['asia-maki', c('1c2895f0-71af-4020-a526-dd8ea7a8631d.jpg'), 'crop=1440:1080:240:0'], // 16:9 → 4:3
			['fusion-duck', nf('IMG-20260929-WA0031.jpg'), `crop=840:1120:100:480,${WARM}`], // Cherry & Port Duck
			['fusion-fries', c('IMG_6463.JPG'), MILD],
			['fusion-cocktails', fd('f_cock.webp'), 'crop=978:1304:54:0'], // → 3:4
			['fusion-platter', na('IMG-20261002-WA0032.jpg'), 'crop=548:411:1:14'], // Fusion Meat Platter, filed under Asia
			['fusion-ravioli', na('IMG-20261002-WA0031.jpg'), 'crop=548:411:1:14'], // Lobster Ravioli, filed under Asia
			['fusion-room-mural', path.join(ROOMS, 'f3.webp'), null],
			['fusion-room-blossom', path.join(ROOMS, 'f1.webp'), null],
			['fusion-room-table', path.join(ROOMS, 'f2.webp'), null]
		];
		for (const [name, src, pre] of photos) {
			for (const w of [640, 1200]) {
				const out = path.join(OUT, `showcase-img-${name}-${w}.webp`);
				await ff(['-i', src, '-vf', `${pre ? pre + ',' : ''}scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', out], `img ${name} ${w}`);
			}
		}
		// Two more Asia room clips (both: red tomoe lanterns, the long tables with
		// the orange menus), cut straight to the strip's 360px size.
		const T = { W: 360, H: 640 };
		const clips = [
			['asia-counter-s', c('e2cc35a0-0e79-47f2-a47d-f8c4bbd4ce63.mp4'), { ...T, dur: 7.5, night: true }],
			['asia-walk-s', c('VIDEO-2026-04-01-15-53-54.mp4'), { ...T, start: 2, dur: 9, night: true }]
		];
		for (const [name, src, opts] of clips) {
			await single(t(name), src, opts);
			const out = path.join(OUT, `showcase-${name}.mp4`);
			await finish(out, t(name), { crf: 29, boomerang: true });
			await poster(out, 0.8);
		}
		// …and 360px cuts of loops that already exist at full size.
		for (const name of ['asia-tables-v2', 'asia-front-v2', 'fusion-lanterns', 'fusion-oven', 'fusion-dough']) {
			const src = path.join(OUT, `showcase-${name}.mp4`);
			const out = path.join(OUT, `showcase-${name}-s.mp4`);
			await ff(['-i', src, '-vf', 'scale=360:640:flags=lanczos', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '29',
				'-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], `tile ${name}`);
			await ff(['-ss', '0.8', '-i', out, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '74', out.replace(/\.mp4$/, '-poster.webp')], `tile poster ${name}`);
		}
	},
	// The filmstrip became an endless strip, and the owner asked for a longer run
	// before anything repeats: 13 more photos and (Fusion) two more loops a house.
	// Each was looked at full size. Asia's rooms: red tomoe lanterns, orange menus,
	// the geisha mural over the long tables. Fusion's: painted paper lanterns, the
	// yellow booth, graffiti murals, the blossom tree, tropical chairs. Dishes were
	// matched to a line on that house's menu (menus.asia.ts / menus.fusion.ts);
	// anything that could not be named with confidence was left out.
	async more2() {
		const WARM = 'colorbalance=rs=0.09:gs=0.02:bs=-0.09:rm=0.08:gm=0.02:bm=-0.08,eq=brightness=0.04:contrast=1.08:saturation=1.3:gamma=1.12';
		const MILD = 'colorbalance=rs=0.04:bs=-0.05:rm=0.04:bm=-0.04,eq=saturation=1.15:gamma=1.05';
		const LIFT = 'eq=gamma=1.28:saturation=1.12:contrast=1.04';
		// centre-crop to the shape showcase.ts assumes (4:3 landscape, 3:4 portrait)
		const L43 = "crop='min(iw,ih*4/3)':'min(ih,iw*3/4)'";
		const P34 = "crop='min(iw,ih*3/4)':'min(ih,iw*4/3)'";
		const photos = [
			// ---- Asia: studio dishes
			['asia-sushi2', c('IMG_6303.JPG'), L43], // Signature Sushi
			['asia-teppan', c('IMG_6299.JPG'), L43], // The Sizzling Teppan (king prawn)
			['asia-duck-l', c('IMG_6324.JPG'), L43], // Crispy Aromatic Duck
			['asia-szechuan', c('IMG_6326.JPG'), L43], // Spicy Szechuan (crisp beef)
			['asia-veganpoke', c('IMG_6330.JPG'), L43], // Vegan Poke Bowl
			['asia-noodles', c('IMG_6306.JPG'), L43], // wok noodles with prawns
			['asia-ramen', c('36E09942-366B-46A8-8B83-F7C49342470A.png'), L43], // Chilli Beef Ramen
			// ---- Asia: rooms
			['asia-room-mural', c('931d21b6-eb62-4627-a460-a7d8da06f50d.jpg'), P34],
			['asia-room-counter', c('a5ed3694-f1b0-4140-b88b-40389d727dfa.jpg'), P34],
			['asia-room-menus', c('ece9250c-2b3d-45b3-813a-3f6fd8277ba8.jpg'), P34],
			['asia-room-wide', c('7de717e2-64bd-4b68-9744-cb989b2439cf.jpg'), P34],
			['asia-room-tomoe', c('f65b49a5-701a-49ea-b578-fe846d8bae2f.jpg'), P34],
			// ---- Fusion: dishes (phone shots: cropped to the plate, warmed)
			['fusion-seafood', c('IMG_6477.JPG'), `crop=1290:1720:0:20,${WARM}`], // Seafood Pasta
			['fusion-bolognese', c('IMG_6475.JPG'), `crop=1200:1600:60:150,${WARM}`], // Bolognese
			['fusion-calzone', c('IMG_6482.JPG'), `crop=1140:1520:240:380,${WARM}`], // Classic Calzone
			['fusion-skins', c('IMG_6500.JPG'), `crop=1320:1760:0:200,${WARM}`], // House Potato Skins
			// ---- Fusion: rooms
			['fusion-room-lanterns', c('IMG_6149.JPG'), `${P34},${MILD}`],
			['fusion-room-booth', c('IMG_6151.JPG'), `${P34},${MILD}`],
			['fusion-room-corner', c('IMG_6060.JPG'), `${P34},${LIFT}`],
			['fusion-room-chandelier', c('IMG_6065.JPG'), `${P34},${LIFT}`],
			['fusion-room-tree', c('4ee12706-626b-4eb9-bb67-7f116c0b3be4.jpg'), P34],
			['fusion-room-tree2', c('4359ee0e-7aeb-4dc7-8168-16cd0e7a197c.jpg'), L43]
		];
		for (const [name, src, pre] of photos) {
			for (const w of [640, 1200]) {
				const out = path.join(OUT, `showcase-img-${name}-${w}.webp`);
				await ff(['-i', src, '-vf', `${pre},scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', out], `img ${name} ${w}`);
			}
		}
		// Two more Fusion loops, cut straight to the strip's 360px size: the
		// chandelier under the wisteria, and a pizza going into the oven.
		const T = { W: 360, H: 640 };
		const clips = [
			['fusion-chandelier-s', c('VIDEO-2026-01-21-18-52-11(2).mp4'), { ...T, dur: 4.6, night: true }],
			['fusion-peel-s', c('VIDEO-2026-04-04-21-05-40.mp4'), { ...T, start: 0.3, dur: 6 }]
		];
		for (const [name, src, opts] of clips) {
			await single(t(name), src, opts);
			const out = path.join(OUT, `showcase-${name}.mp4`);
			await finish(out, t(name), { crf: 29, boomerang: true });
			await poster(out, 0.8);
		}
	},
	// After the critique of the rebuilt strip: the four Fusion plates added in
	// more2 were shot under warm light, and the strong WARM grade on top turned
	// them orange. Same crops, the mild grade. (-v2: uploads are cached immutable.)
	async more3() {
		const MILD = 'colorbalance=rs=0.02:bs=-0.02,eq=saturation=1.08:gamma=1.04';
		const photos = [
			['fusion-seafood-v2', c('IMG_6477.JPG'), `crop=1290:1720:0:20,${MILD}`],
			['fusion-bolognese-v2', c('IMG_6475.JPG'), `crop=1200:1600:60:150,${MILD}`],
			['fusion-calzone-v2', c('IMG_6482.JPG'), `crop=1140:1520:240:380,${MILD}`],
			['fusion-skins-v2', c('IMG_6500.JPG'), `crop=1320:1760:0:200,${MILD}`]
		];
		for (const [name, src, pre] of photos) {
			for (const w of [640, 1200]) {
				const out = path.join(OUT, `showcase-img-${name}-${w}.webp`);
				await ff(['-i', src, '-vf', `${pre},scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', out], `img ${name} ${w}`);
			}
		}
	},
	// Sharper (900×1600) Fusion room loops for the board's large frame — the 720px
	// loops are upscaled there on a retina screen. One plays at a time.
	async 'fusion-hd'() {
		const S = { W: 900, H: 1600 };
		const jobs = [
			['fusion-mural-hd', 'IMG_2663.mp4', 8.8],
			['fusion-blossom-hd', 'IMG_2662.mp4', 9],
			['fusion-bar-hd', 'IMG_2652.mp4', 5.6]
		];
		for (const [name, src, dur] of jobs) {
			await single(t(name), m(src), { ...S, dur });
			const out = path.join(OUT, `showcase-${name}.mp4`);
			await finish(out, t(name), { crf: 29, boomerang: true });
			await poster(out, 0.6);
		}
	},
	// Small (360×640) cuts of the room loops for the Filmstrip's tiles: three play
	// at once in the first screen, so they must cost a fraction of the full loops.
	async tiles() {
		const clips = ['asia-lanterns-v2', 'asia-bar-v2', 'asia-blossom-v2', 'fusion-mural', 'fusion-blossom', 'fusion-bar'];
		for (const name of clips) {
			const src = path.join(OUT, `showcase-${name}.mp4`);
			const out = path.join(OUT, `showcase-${name}-s.mp4`);
			await ff(['-i', src, '-vf', 'scale=360:640:flags=lanczos', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '29',
				'-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], `tile ${name}`);
			await ff(['-ss', '0.8', '-i', out, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '74', out.replace(/\.mp4$/, '-poster.webp')], `tile poster ${name}`);
		}
	},
	// The doorway's plates: dishes the films don't show, as plain web images.
	async plates() {
		const jobs = [
			['asia-duck', na('IMG-20261002-WA0035.jpg')], // Crispy Aromatic Duck (menus.asia)
			['asia-mochi', nf('IMG-20260731-WA0028.jpg')], // mochi — Asia's menu; shot in Asia's room
			['fusion-carbonara', na('IMG-20261002-WA0030.jpg')], // carbonara — Fusion's menu, filed under Asia
			['fusion-brownie', nf('IMG-20260731-WA0001.jpg')] // brownie — Fusion's menu, Fusion's balcony
		];
		for (const [name, src] of jobs) {
			const out = path.join(OUT, `showcase-plate-${name}.webp`);
			await ff(['-i', src, '-vf', 'scale=900:-2:flags=lanczos', '-c:v', 'libwebp', '-quality', '80', out], `plate ${name}`);
		}
	},
	async 'asia-singles'() {
		const S = { W: 720, H: 1280 };
		const jobs = [
			['asia-front', () => tilt(t('as-front'), m('IMG_0787.mp4'), { ...S, start: 0.3, dur: 9, y0: 260, y1: 360, cropW: 1240, x0: 300 })],
			['asia-lanterns', () => single(t('as-lanterns'), c('62d8dde2-c29d-4347-b0b3-09cee899819f.mp4'), { ...S, dur: 9, speed: 2, night: true })],
			['asia-blossom', () => single(t('as-blossom'), c('28d0f5ff-5f51-4fcb-bb15-32631df25ca3.mp4'), { ...S, dur: 9, speed: 1.3, night: true })],
			['asia-bar', () => single(t('as-bar'), c('23e5bacd-6264-4806-a75a-1f72cbef2cb5.mp4'), { ...S, dur: 9, night: true })],
			['asia-tables', () => single(t('as-tables'), c('a355a94d-e057-4202-a283-4bd15e0a6182.mp4'), { ...S, dur: 9, speed: 2, night: true })]
		];
		for (const [name, make] of jobs) {
			await make();
			const out = path.join(OUT, `showcase-${name}-v2.mp4`);
			await finish(out, t(name.replace('asia-', 'as-')), { crf: 27, boomerang: true });
			await poster(out, 0.8);
		}
	},

	/* ============================ FUSION ============================ */
	async 'fusion-reel'() {
		const L = { W: 1920, H: 1080 };
		const bg = INK.fusion;
		// The rooms. Wisteria → the painted face → the tropical chairs; then blossom → the brick-wall girl.
		await tilt(t('f-mural'), m('IMG_2663.mp4'), { ...L, start: 0.2, dur: 5, y0: 250, y1: 1350 });
		await tilt(t('f-blossom'), m('IMG_2662.mp4'), { ...L, start: 1, dur: 5, y0: 350, y1: 1400 });
		// The food: fish and chips full frame, then burger / pizza / paella three-up
		// (the new photos are portrait, so a panel each rather than a 1.6× upscale).
		await still(t('f-f1'), c('IMG_6394.JPG'), { ...L, dur: 2.8, fx: 0.45, fy: 0.4 });
		const PANEL = { W: 634, H: 1080 };
		await still(t('f-p1'), nf('IMG-20260929-WA0029.jpg'), { ...PANEL, dur: 4.5, fy: 0.55, zoom: 0.06 });
		await still(t('f-p2'), nf('IMG-20260929-WA0034.jpg'), { ...PANEL, dur: 4.5, zoom: 0.06 });
		await still(t('f-p3'), nf('IMG-20260929-WA0030.jpg'), { ...PANEL, dur: 4.5, fy: 0.45, zoom: 0.06 });
		await triptych(t('f-f2'), [{ src: t('f-p1'), raw: true }, { src: t('f-p2'), raw: true }, { src: t('f-p3'), raw: true }], { ...L, dur: 4.5, bg });
		// The kitchen: dough, peel, fire — ~460p clips, so three-up.
		await triptych(t('f-kitchen'), [
			{ src: c('VIDEO-2026-04-04-21-05-32.mp4'), start: 3, speed: 1.5 },
			{ src: c('VIDEO-2026-04-04-21-05-20.mp4'), start: 1, speed: 2 },
			{ src: c('VIDEO-2026-04-04-21-05-36.mp4'), start: 0, speed: 1.5 }
		], { ...L, dur: 5, bg });
		const out = path.join(OUT, 'showcase-fusion-reel-v3.mp4');
		await join(out, [[t('f-mural'), 5], [t('f-blossom'), 5], [t('f-f1'), 2.8], [t('f-f2'), 4.5], [t('f-kitchen'), 5]], { bg, crf: 29 });
		await poster(out, 2.5);
	},
	async 'fusion-reel-m'() {
		const P = { W: 1080, H: 1920 };
		const bg = INK.fusion;
		await tilt(t('fm-mural'), m('IMG_2663.mp4'), { ...P, start: 0.2, dur: 4.5, y0: 200, y1: 900, cropW: 1600 });
		await tilt(t('fm-blossom'), m('IMG_2662.mp4'), { ...P, start: 1, dur: 4.5, y0: 200, y1: 800, cropW: 1600 });
		// portrait sources for the phone cut, so the push-in isn't an upscale
		await still(t('fm-f1'), nf('IMG-20260929-WA0029.jpg'), { ...P, dur: 2.4, fy: 0.55 }); // burger
		await still(t('fm-f2'), nf('IMG-20260929-WA0034.jpg'), { ...P, dur: 2.4 }); // pizza
		await still(t('fm-f3'), nf('IMG-20260929-WA0030.jpg'), { ...P, dur: 2.4 }); // paella
		await still(t('fm-f4'), nf('IMG-20260731-WA0018.jpg'), { ...P, dur: 2.4 }); // cheesecake
		await single(t('fm-oven'), c('VIDEO-2026-04-04-21-05-20.mp4'), { ...P, start: 1, dur: 4, speed: 2 });
		const out = path.join(OUT, 'showcase-fusion-reel-m-v3.mp4');
		await join(out, [[t('fm-mural'), 4.5], [t('fm-blossom'), 4.5], [t('fm-f1'), 2.4], [t('fm-f2'), 2.4], [t('fm-f3'), 2.4], [t('fm-f4'), 2.4], [t('fm-oven'), 4]], { bg, crf: 28 });
		await poster(out, 1.5);
	},
	async 'fusion-singles'() {
		const S = { W: 720, H: 1280 };
		const jobs = [
			['fusion-mural', () => single(t('fs-mural'), m('IMG_2663.mp4'), { ...S, dur: 8.8 })],
			['fusion-blossom', () => single(t('fs-blossom'), m('IMG_2662.mp4'), { ...S, dur: 9 })],
			['fusion-bar', () => single(t('fs-bar'), m('IMG_2652.mp4'), { ...S, dur: 5.6 })],
			['fusion-lanterns', () => single(t('fs-lanterns'), m('IMG_2645.mp4'), { ...S, dur: 2.2 })],
			['fusion-oven', () => single(t('fs-oven'), c('VIDEO-2026-04-04-21-05-20.mp4'), { ...S, start: 1, dur: 7, speed: 2 })],
			['fusion-dough', () => single(t('fs-dough'), c('VIDEO-2026-04-04-21-05-32.mp4'), { ...S, start: 3, dur: 7, speed: 1.5 })]
		];
		for (const [name, make] of jobs) {
			await make();
			const out = path.join(OUT, `showcase-${name}.mp4`);
			await finish(out, t(name.replace('fusion-', 'fs-')), { crf: 27, boomerang: true });
			await poster(out, 0.6);
		}
	},
	// What the Doorway serves, Oct 2026: 720x1280 re-encodes of the delivered
	// 1080x1920 clips (put those in static/media first — they are on the CDN),
	// each with its poster. Half the bytes or less; the arch is never more than
	// 300 CSS px wide and the portrait film plays behind a scrim. New names,
	// because the CDN caches for good. The 600px frames were cut the same day
	// with sharp (`resize({ width: 600 })`, webp q74) as showcase-plate-*-v2.webp.
	async 'phone-720'() {
		const jobs = [
			['fusion-reel-m-v3', 'fusion-reel-m-v4', 28, 1.5],
			['asia-reel-m-v4', 'asia-reel-m-v5', 28, 1.5],
			['fusion-door-v1', 'fusion-door-v2', 29, 0.1],
			['asia-door-v1', 'asia-door-v2', 29, 0.1]
		];
		for (const [from, to, crf, at] of jobs) {
			const out = path.join(OUT, `showcase-${to}.mp4`);
			await ff(['-i', path.join(OUT, `showcase-${from}.mp4`), '-vf', 'scale=720:1280:flags=lanczos', '-an', '-c:v', 'libx264',
				'-preset', 'slow', '-crf', `${crf}`, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], `720p ${to}`);
			await ff(['-ss', `${at}`, '-i', out, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '72', out.replace(/\.mp4$/, '-poster.webp')], `poster ${to}`);
		}
	},
	// Asia's Doorway, Oct 2026 — the owner's own photographs (Drive "Geisha 3 image"
	// → Asia, passed as --drive). Six stills of the one room, no food; three are
	// used. The arch is the lanterns over the blossom tree, as a slow push-in run
	// out and back (a still, so there is nothing to stabilise), cut straight to the
	// 720x1280 the page serves. The two frames — the geisha mural, and the long
	// table under the tree — were cropped 4:5 and cut to 600px with sharp:
	//   c-931d21b6.jpg   extract 1100x1375 at (220, 0)        → showcase-plate-asia-mural-v1.webp
	//   f-IMG_6284.HEIC  extract 4284x5355 at (0, 120)        → showcase-plate-asia-long-table-v1.webp
	async 'asia-doorway'() {
		const S = { W: 720, H: 1280 };
		await still(t('ad3'), dr('b-80ad9732.jpg'), { ...S, dur: 4.8, zoom: 0.08, fx: 0.42, fy: 0.3 });
		const out = path.join(OUT, 'showcase-asia-door-v3.mp4');
		await finish(out, t('ad3'), { crf: 27, boomerang: true });
		await poster(out, 0.1);
	},
	// Fusion's Doorway, Oct 2026 — the three pictures the owner chose himself (--drive).
	// That folder is all rooms, no food, so the two frames beside the arch show the
	// house rather than dishes: nothing here needs checking against the menu.
	async 'fusion-doorway'() {
		// The arch: the lantern room under the blossom tree. A 4K/60 portrait phone
		// clip — stabilised, played at half speed, and run out and back so the loop
		// has no cut. Only the later part of the take, once the balcony rail has left
		// the corner of the frame.
		const W = 1080, H = 1920;
		const src = dr('IMG_2647.MOV');
		const cut = ['-ss', '3.6', '-t', '2.4', '-i', src];
		// forward slashes: a backslash is an escape inside a filter argument
		const trf = `${TMP.replaceAll('\\', '/')}/fd.trf`;
		await ff([...cut, '-vf', `vidstabdetect=shakiness=5:accuracy=15:result=${trf}`, '-f', 'null', '-'], 'stabilise (detect)');
		const vf =
			`vidstabtransform=input=${trf}:smoothing=30:zoom=3:interpol=bicubic,` +
			`setpts=2*(PTS-STARTPTS),fps=${FPS},` +
			`scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},${GRADE}`;
		await ff([...cut, '-vf', vf, ...MID, t('fd')], 'door fusion-door');
		const out = path.join(OUT, 'showcase-fusion-door-v1.mp4');
		await finish(out, t('fd'), { crf: 30, boomerang: true });
		// The poster is what the arch shows until the clip decodes — its first frame.
		await poster(out, 0.1);

		// The two frames: shown 4:5 and centred, so they are cropped to 4:5 here, where
		// the framing can be chosen (mural face with the blossom over it; the lanterns
		// down to the FUSION bar).
		const frames = [
			['fusion-mural-wall', dr('blossom-face-mural.png'), 'crop=943:1179:0:330'],
			['fusion-lantern-bar', dr('lantern-dining-room.png'), 'crop=950:1188:0:235']
		];
		for (const [name, file, crop] of frames) {
			const plate = path.join(OUT, `showcase-plate-${name}.webp`);
			await ff(['-i', file, '-vf', `${crop},scale=900:1125:flags=lanczos`, '-c:v', 'libwebp', '-quality', '72', plate], `plate ${name}`);
		}
	}
};

await mkdir(TMP, { recursive: true });
for (const [name, job] of Object.entries(JOBS)) {
	if (ONLY && !ONLY.split(',').includes(name)) continue;
	console.log(name);
	await job();
}
if (!ONLY) await rm(TMP, { recursive: true, force: true });
