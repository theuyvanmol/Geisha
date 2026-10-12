<script lang="ts">
	// The Christmas edition of the gift voucher preview card, shown on both houses'
	// gift voucher pages when a "For Christmas" option is picked. Same footprint as
	// the everyday card it swaps with (a real card's 1.586 ratio), drawn entirely in
	// markup and SVG: lacquer red for Asia, pine green for Fusion, a gold ribbon
	// across one corner with a tied bow, and a light fall of snowflakes.
	//
	// It is a PREVIEW. The voucher itself is issued and emailed by Gift Up with
	// whatever artwork the Gift Up account holds (see $lib/data/giftup.ts) — to send
	// a Christmas design, upload one there.
	import type { Brand } from '$lib/data/brand';

	let { brand, amount }: { brand: Brand; amount: number } = $props();

	// Each house's own white wordmark, with its true intrinsic size (a mismatched
	// pair reserves the wrong box and the card jumps as the image lands).
	const mark = $derived(
		brand.id === 'asia'
			? { src: '/geisha-asia-wordmark.png', w: 1554, h: 461 }
			: { src: '/geisha-fusion-wordmark.png', w: 900, h: 301 }
	);

	// [left %, top %, size px, twinkle delay s] — kept clear of the wordmark, the
	// amount and the foot line.
	const FLAKES: [number, number, number, number][] = [
		[50, 8, 11, 1.4],
		[54, 42, 19, 0],
		[66, 64, 13, 2.2],
		[86, 62, 22, 0.8],
		[76, 80, 10, 1.8],
		[44, 79, 11, 2.9],
		[58, 22, 8, 0.4]
	];
</script>

<div class="xv" data-brand={brand.id}>
	<div class="pattern" aria-hidden="true"></div>
	<div class="glow" aria-hidden="true"></div>

	{#each FLAKES as [l, t, s, d]}
		<svg class="flake" style="left:{l}%;top:{t}%;width:{s}px;height:{s}px;animation-delay:{d}s" viewBox="0 0 24 24" aria-hidden="true">
			<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
				<path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10" />
				<path d="M12 5.6l-2.1-2M12 5.6l2.1-2M12 18.4l-2.1 2M12 18.4l2.1 2M6.5 8.8l-2.8.7M6.5 8.8l-.7-2.8M17.5 15.2l2.8-.7M17.5 15.2l.7 2.8M6.5 15.2l-2.8-.7M6.5 15.2l-.7 2.8M17.5 8.8l2.8.7M17.5 8.8l.7-2.8" />
			</g>
		</svg>
	{/each}

	<!-- The ribbon runs across the top-right corner; the bow is tied where it crosses. -->
	<div class="ribbon" aria-hidden="true"></div>
	<svg class="bow" viewBox="0 0 140 104" aria-hidden="true">
		<defs>
			<linearGradient id="xv-gold" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color="#fbe9a6" />
				<stop offset="0.45" stop-color="#d9b445" />
				<stop offset="1" stop-color="#8f6b1c" />
			</linearGradient>
			<linearGradient id="xv-gold-deep" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="#b98f2b" />
				<stop offset="1" stop-color="#6f5113" />
			</linearGradient>
		</defs>
		<!-- tails -->
		<path d="M64 52 40 98l13-5 6 9 13-46z" fill="url(#xv-gold-deep)" />
		<path d="M76 52l24 46-13-5-6 9-13-46z" fill="url(#xv-gold)" />
		<!-- loops -->
		<path d="M70 50C52 18 14 10 8 38c-4 24 34 26 62 12z" fill="url(#xv-gold)" />
		<path d="M70 50c18-32 56-40 62-12 4 24-34 26-62 12z" fill="url(#xv-gold)" />
		<!-- the shadowed inside of each loop -->
		<path d="M66 49C52 32 30 26 24 39c-3 10 20 13 42 10z" fill="url(#xv-gold-deep)" />
		<path d="M74 49c14-17 36-23 42-10 3 10-20 13-42 10z" fill="url(#xv-gold-deep)" />
		<!-- knot -->
		<rect x="59" y="38" width="22" height="24" rx="7" fill="url(#xv-gold)" stroke="#7a5a16" stroke-width="0.8" />
	</svg>

	<img class="mark" src={mark.src} alt="" width={mark.w} height={mark.h} />

	<div class="mid">
		<span class="greet">Merry Christmas</span>
		<!-- Keyed so the settle animation replays on each pick. -->
		{#key amount}
			<div class="amount"><span class="cur">£</span>{amount}</div>
		{/key}
	</div>

	<div class="foot">
		<span>Christmas Gift Voucher</span>
		<span>{brand.name}</span>
	</div>
</div>

<style>
	.xv {
		--a: #6d1020;
		--b: #2c070f;
		--c: #150307;
		--gold: #d4af37;
		--gold-bright: #f4cf6b;
		--ivory: #f5f1e8;
		--tilt: -2.5deg;
		position: relative;
		width: 100%;
		max-width: 420px;
		aspect-ratio: 1.586; /* a real card */
		box-sizing: border-box;
		padding: 1.6rem 1.8rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		border-radius: 14px;
		overflow: hidden;
		color: var(--ivory);
		background: linear-gradient(145deg, var(--a) 0%, var(--b) 56%, var(--c) 100%);
		box-shadow:
			0 30px 60px rgba(0, 0, 0, 0.55),
			0 0 0 1px rgba(212, 175, 55, 0.4),
			inset 0 0 0 5px rgba(0, 0, 0, 0.18),
			inset 0 0 0 6px rgba(212, 175, 55, 0.28);
		transform: rotate(var(--tilt));
		animation: xv-in 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	/* Fusion: pine green, square-cornered like its everyday card, tilted the other way. */
	.xv[data-brand='fusion'] {
		--a: #1b4a35;
		--b: #0c2419;
		--c: #06140d;
		--tilt: 2.2deg;
		border-radius: 0;
	}
	@keyframes xv-in {
		from {
			opacity: 0;
			transform: rotate(var(--tilt)) translateY(10px) scale(0.98);
		}
	}

	/* Seigaiha, the wave pattern printed on the real cards, in gold leaf. */
	.pattern {
		position: absolute;
		inset: 0;
		opacity: 0.14;
		background-image: repeating-radial-gradient(
			circle at 50% 100%,
			transparent 0 9px,
			rgba(244, 207, 107, 0.7) 9px 10px,
			transparent 10px 20px
		);
		background-size: 42px 21px;
		-webkit-mask-image: linear-gradient(115deg, #000, transparent 78%);
		mask-image: linear-gradient(115deg, #000, transparent 78%);
	}
	/* Candlelight from the corner the bow sits in. */
	.glow {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 84% 22%, rgba(244, 207, 107, 0.28), transparent 52%);
		pointer-events: none;
	}

	.flake {
		position: absolute;
		color: rgba(245, 241, 232, 0.75);
		animation: xv-twinkle 3.6s ease-in-out infinite;
	}
	@keyframes xv-twinkle {
		0%,
		100% {
			opacity: 0.28;
			transform: rotate(0deg) scale(0.92);
		}
		50% {
			opacity: 0.9;
			transform: rotate(18deg) scale(1.06);
		}
	}

	/* A gold satin band: light along its centre, darker at the selvedges. */
	/* It crosses the top-right corner at 45°, from the top edge to the right edge,
	   and is centred on the same point as the bow's knot (82% across, 27% down) so
	   the bow reads as tied onto it. Sized from the card's width, so the pair keep
	   their fit at any size. */
	.ribbon {
		position: absolute;
		left: 82%;
		top: 27%;
		width: 80%;
		aspect-ratio: 11 / 1;
		transform: translate(-50%, -50%) rotate(45deg);
		background: linear-gradient(180deg, #8f6b1c 0%, #d9b445 22%, #fbe9a6 50%, #d9b445 78%, #8f6b1c 100%);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
	}
	.bow {
		position: absolute;
		left: 82%;
		top: 27%;
		width: 30%;
		height: auto;
		/* the knot sits at 50% / 48% of the drawing */
		transform: translate(-50%, -48%);
		filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.5));
	}

	.mark {
		position: relative;
		width: 44%;
		height: auto;
		align-self: flex-start;
		opacity: 0.97;
	}
	.mid {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.greet {
		font-family: 'Shippori Mincho', Georgia, serif;
		font-style: italic;
		font-size: clamp(0.95rem, 2.4vw, 1.15rem);
		letter-spacing: 0.04em;
		color: var(--ivory);
		opacity: 0.92;
	}
	.amount {
		font-family: 'Shippori Mincho', Georgia, serif;
		font-size: clamp(2.6rem, 7vw, 3.6rem);
		line-height: 1;
		color: var(--gold-bright);
		text-shadow: 0 2px 18px rgba(0, 0, 0, 0.45);
		animation: xv-settle 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.cur {
		font-size: 0.55em;
		vertical-align: 0.35em;
		margin-right: 0.06em;
		opacity: 0.85;
	}
	@keyframes xv-settle {
		from {
			opacity: 0.2;
			transform: translateY(6px);
		}
	}
	.foot {
		position: relative;
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 0.64rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: rgba(245, 241, 232, 0.74);
	}

	@media (max-width: 760px) {
		.xv {
			--tilt: 0deg;
		}
		.xv[data-brand='fusion'] {
			--tilt: 0deg;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.xv,
		.amount {
			animation: none;
		}
		.flake {
			animation: none;
			opacity: 0.6;
		}
	}
</style>
