/**
 * The painted cut-outs for the two home pages' Our Story pictures.
 *
 * Each picture used to sit as a hard-edged rectangle (Fusion's butted into the
 * section's top-right corner, Asia's inside a hairline frame). A soft edge-fade
 * had been tried on Fusion and read as a blurred border, so this goes the other
 * way: a deliberate SHAPE, in each house's own vocabulary.
 *
 *   Fusion  a swatch of spray paint — dry-brushed along its left edge, rough along
 *           the top, running in drips off the bottom (the murals, the drips in its
 *           hero art). It still bleeds off the right edge of the page.
 *   Asia    one broad pass of an ink brush — bristle streaks trailing off BOTH
 *           ends, a hand-cut top and bottom, a few thrown flecks, and no drips
 *           (ink on paper does not run). The picture sits inside its column, so
 *           the shape is closed on every side.
 *
 * Output: static/fusion-story-mask.png and static/asia-story-mask.png —
 * white-on-transparent, used as a CSS `mask-image` stretched over the picture's
 * box, so the CMS can still swap the picture itself. Deterministic (fixed
 * turbulence seeds): re-running gives the same files.
 *
 *   node scripts/make-story-mask.mjs                                    # writes both masks
 *   node scripts/make-story-mask.mjs --preview <fusion|asia> <picture> <out.jpg>   # one mask applied, on its section's ground
 */
import sharp from 'sharp';

const W = 1400;
const H = 1000;

// ---------------------------------------------------------------- Fusion

// [x, width, length] of each drip, left → right. Uneven on purpose.
const DRIPS = [
	[262, 16, 70],
	[388, 26, 118],
	[452, 12, 44],
	[640, 20, 84],
	[798, 30, 126],
	[872, 14, 62],
	[1040, 22, 96],
	[1206, 18, 84],
	[1304, 28, 110]
];
// flecks thrown off the brushed edge: [cx, cy, r]
const FLECKS = [
	[96, 210, 9],
	[58, 268, 4],
	[132, 388, 6],
	[74, 470, 11],
	[40, 512, 3],
	[118, 604, 5],
	[168, 706, 7],
	[212, 842, 4]
];
const BODY_BOTTOM = 852;

const fusion = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
	<defs>
		<!-- bristle streaks: noise that changes fast down the page and slowly across it,
		     pushing each thin row of the edge in or out by a different amount -->
		<filter id="brush" x="-30%" y="-10%" width="160%" height="120%">
			<feTurbulence type="fractalNoise" baseFrequency="0.0025 0.085" numOctaves="2" seed="11" result="n" />
			<feDisplacementMap in="SourceGraphic" in2="n" scale="230" xChannelSelector="R" yChannelSelector="B" />
		</filter>
		<!-- a hand-cut wobble for the top and bottom edges and the drips -->
		<filter id="rough" x="-10%" y="-10%" width="120%" height="130%">
			<feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="5" result="n" />
			<feDisplacementMap in="SourceGraphic" in2="n" scale="54" xChannelSelector="R" yChannelSelector="G" />
		</filter>
	</defs>
	<g fill="#fff">
		<!-- the brushed slab: starts well in from the left, runs off the right -->
		<rect x="250" y="70" width="${W}" height="${BODY_BOTTOM - 110}" filter="url(#brush)" />
		<g filter="url(#rough)">
			<!-- the solid body behind it, so the streaks only show along the left edge -->
			<rect x="330" y="48" width="${W}" height="${BODY_BOTTOM - 48}" />
			${DRIPS.map(
				([x, w, len]) =>
					`<rect x="${x}" y="${BODY_BOTTOM - 30}" width="${w}" height="${len + 30}" rx="${w / 2}" />` +
					`<circle cx="${x + w / 2}" cy="${BODY_BOTTOM + len}" r="${w * 0.72}" />`
			).join('')}
			${FLECKS.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" />`).join('')}
		</g>
	</g>
</svg>`;

// ---------------------------------------------------------------- Asia

// ink thrown off each end of the stroke: [cx, cy, r]
const INK = [
	[70, 300, 7],
	[38, 372, 3],
	[104, 520, 9],
	[56, 610, 4],
	[92, 742, 5],
	[1318, 236, 5],
	[1356, 330, 9],
	[1330, 486, 4],
	[1368, 598, 6],
	[1312, 760, 8]
];

const asia = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
	<defs>
		<!-- the same bristle streaks as Fusion's, on a different seed -->
		<filter id="brush" x="-30%" y="-10%" width="160%" height="120%">
			<feTurbulence type="fractalNoise" baseFrequency="0.0025 0.085" numOctaves="2" seed="23" result="n" />
			<feDisplacementMap in="SourceGraphic" in2="n" scale="210" xChannelSelector="R" yChannelSelector="B" />
		</filter>
		<!-- a slower, shallower wobble than Fusion's: a brush edge, not a torn one -->
		<filter id="rough" x="-10%" y="-10%" width="120%" height="120%">
			<feTurbulence type="fractalNoise" baseFrequency="0.007" numOctaves="3" seed="9" result="n" />
			<feDisplacementMap in="SourceGraphic" in2="n" scale="46" xChannelSelector="R" yChannelSelector="G" />
		</filter>
	</defs>
	<g fill="#fff">
		<!-- the stroke itself: its two ends trail off in streaks -->
		<rect x="170" y="78" width="${W - 340}" height="${H - 156}" filter="url(#brush)" />
		<g filter="url(#rough)">
			<!-- the solid body, so the streaks only show at the ends -->
			<rect x="262" y="52" width="${W - 524}" height="${H - 104}" />
			${INK.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" />`).join('')}
		</g>
	</g>
</svg>`;

// ---------------------------------------------------------------- output

const MASKS = {
	fusion: { svg: fusion, file: 'static/fusion-story-mask.png', ground: '#0c1410', box: [1190, 860], canvas: [1900, 1000], at: (cw, pw) => [cw - pw, 70] },
	asia: { svg: asia, file: 'static/asia-story-mask.png', ground: '#131316', box: [560, 520], canvas: [1240, 780], at: () => [40, 130] }
};
const render = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

const i = process.argv.indexOf('--preview');
if (i > -1) {
	// The picture at the section's proportions, cut by the mask, on the section's ground.
	const m = MASKS[process.argv[i + 1]];
	if (!m) throw new Error('--preview <fusion|asia> <picture> <out.jpg>');
	const [pw, ph] = m.box;
	const [cw, ch] = m.canvas;
	const picture = await sharp(process.argv[i + 2]).resize(pw, ph, { fit: 'cover', position: 'top' }).ensureAlpha().png().toBuffer();
	const shaped = await sharp(await render(m.svg)).resize(pw, ph, { fit: 'fill' }).png().toBuffer();
	// keep the picture only where the mask is opaque
	const cut = await sharp(picture).composite([{ input: shaped, blend: 'dest-in' }]).png().toBuffer();
	const [left, top] = m.at(cw, pw);
	await sharp({ create: { width: cw, height: ch, channels: 3, background: m.ground } })
		.composite([{ input: cut, left, top }])
		.jpeg({ quality: 82 })
		.toFile(process.argv[i + 3]);
	console.log('preview →', process.argv[i + 3]);
} else {
	for (const m of Object.values(MASKS)) {
		const png = await render(m.svg);
		await sharp(png).toFile(m.file);
		console.log(`${m.file}  ${(png.length / 1024).toFixed(1)} KB`);
	}
}
