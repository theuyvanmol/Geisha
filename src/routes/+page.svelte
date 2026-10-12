<script lang="ts">
	import { imgAttrs } from '$lib/media/responsive';
	import { goto, preloadData } from '$app/navigation';
	import { markEntering } from '$lib/nav/entering';
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';

	let { data }: { data: PageData } = $props();

	// The two front-door photographs, from the client's design template.
	// Asia: the gold-disc portrait — the SAME still the Asia home hero uses, so the
	// tile and the destination hero are one continuous image.
	// Fusion: the lantern-lit room behind the painted portrait.
	// Editable from admin → Content → Media (falls back to the shipped stills).
	const asiaTile = $derived(imgAttrs(data.asiaTileImage, '(max-width: 760px) 100vw, 70vw'));
	const fusionTile = $derived(imgAttrs(data.fusionTileImage, '(max-width: 760px) 100vw, 70vw'));

	type House = 'asia' | 'fusion';

	// Which house occupies the LARGE tile.
	let featured = $state<House>('asia');
	let transitioning = $state<null | House>(null);

	// Touch/narrow layout: there is no hover, so the "feature on hover, click to
	// enter" model doesn't apply. On mobile both tiles are shown equal-sized and
	// fully readable, and a single tap enters that brand directly (see enter()).
	let isMobile = $state(false);

	// ===== DEPARTURE: THE SAKURA IRIS =====
	//
	// The design template's own transition for this exact moment: an ink disc
	// blooms out of the point you clicked, sakura-cored, and floods the screen —
	// then settles to flat brand ink while a spaced-caps "Entering Geisha Asia"
	// holds in the middle. The destination's shoji panels open on that same flat
	// ink carrying that same line, so the two pages are one continuous shot.
	//
	// The old cover did the opposite of this: it faded for 460ms, then STARTED the
	// navigation, and only then waited on the page load — a dead stare at a still
	// frame for as long as PocketBase took. Here the data fetch is kicked off in
	// the same tick as the animation (and again on hover, below), so by the time
	// the iris has bloomed the destination is already in the router's cache and
	// goto() resolves on the spot.
	const IRIS_MS = 640; // bloom + settle to flat ink
	const IRIS_SEED = 40; // px — the disc's unscaled diameter
	const NAV_CAP_MS = 2000; // never hold the departure hostage to a stalled load

	let irisX = $state(0);
	let irisY = $state(0);
	let irisScale = $state(60);
	let irisGo = $state(false);

	// preloadData() warms SvelteKit's client cache for a route — its code AND its
	// load(). Fired on hover/focus, so a deliberate guest has already paid the
	// network cost before they commit.
	//
	// That cache holds exactly ONE entry, so warming both houses would just have
	// them evict each other. We track which one we last warmed and hold on to its
	// promise: if the guest then picks that house, the departure has nothing left
	// to wait for. The href is the tile's own href — see $lib/nav/entering for why
	// that matters (a query string here silently defeated the whole mechanism).
	let warmedHref = '';
	let warmedLoad: Promise<unknown> = Promise.resolve();
	function warm(h: House) {
		const href = `/${h}`;
		if (warmedHref === href) return;
		warmedHref = href;
		warmedLoad = preloadData(href).catch(() => {});
	}

	// Lanterns hanging from the side tree. Positions are a percentage of the
	// .grove-tree box (2000×2000 viewBox), chosen to land on branch tips that
	// actually reach into the viewport. Kept deterministic so SSR and client
	// markup match (no Math.random during render). The tree is pushed up and left,
	// so its on-screen branches sit in the box's upper-right.
	const asiaLanterns = [
		{ x: 82, y: 34, src: '/lantern-gold.svg', dur: 4.2, delay: 0.4 },
		{ x: 90, y: 44, src: '/lantern-peach.svg', dur: 3.6, delay: 1.1 },
		{ x: 74, y: 47, src: '/lantern-pastel.svg', dur: 4.8, delay: 0.8 }
	];

	onMount(() => {
		// Lock body scroll only while landing is mounted; restore on unmount.
		// Do NOT use :global(html, body) overflow rules — they leak across SPA nav.
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		// Track the no-hover layout so tap handlers can short-circuit to entering.
		// Kept in sync with the 760px CSS breakpoint below.
		const mq = window.matchMedia('(max-width: 760px)');
		const sync = () => (isMobile = mq.matches);
		sync();
		mq.addEventListener('change', sync);

		// Warm the house that's already featured, once the screen is idle. Hovering
		// warms whichever tile you point at; this covers the guest who walks straight
		// up to the default one and clicks — and touch, which has no hover at all.
		// Only one, because the preload cache is single-slot (see warm()).
		const warmId = window.setTimeout(() => warm(featured), 250);

		return () => {
			document.body.style.overflow = prevOverflow;
			mq.removeEventListener('change', sync);
			clearTimeout(warmId);
		};
	});

	function feature(h: House) {
		if (transitioning) return;
		featured = h;
		warm(h);
	}

	function enter(target: House, e: MouseEvent) {
		e.preventDefault();
		if (transitioning) return;

		// Where the iris blooms from. A keyboard-activated link reports 0,0 (or the
		// element's own centre, depending on the browser), so fall back to the middle
		// of the tile that was activated.
		let x = e.clientX;
		let y = e.clientY;
		if (!x && !y) {
			const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
			x = r.left + r.width / 2;
			y = r.top + r.height / 2;
		}

		// On mobile both tiles are equal-sized and fully readable, so a single tap
		// enters directly — no hover-to-feature step.
		if (isMobile) {
			featured = target;
			depart(target, x, y);
			return;
		}

		// If clicking the small tile, swap to feature it first, then transition
		// on the next frame so the layout/grid has a chance to settle.
		if (featured !== target) {
			featured = target;
			requestAnimationFrame(() => requestAnimationFrame(() => depart(target, x, y)));
			return;
		}
		depart(target, x, y);
	}

	function depart(target: House, x: number, y: number) {
		transitioning = target;
		irisX = x;
		irisY = y;

		// Scale the seed disc until it reaches the furthest corner from the click —
		// so the bloom always covers the viewport regardless of where it started,
		// with no oversized-and-hope constant.
		const dx = Math.max(x, window.innerWidth - x);
		const dy = Math.max(y, window.innerHeight - y);
		irisScale = (Math.hypot(dx, dy) / (IRIS_SEED / 2)) * 1.04;

		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		// The two halves of the departure run CONCURRENTLY: the load is already in
		// flight (warmed on hover, or started right here), and the animation is only
		// a floor on how soon we're willing to leave. Whichever finishes last decides
		// — which, warmed, is the animation.
		const href = `/${target}`;
		if (warmedHref !== href) warm(target);
		const loaded = Promise.race([warmedLoad, new Promise((r) => setTimeout(r, NAV_CAP_MS))]);
		const held = new Promise((r) => setTimeout(r, reduce ? 180 : IRIS_MS));

		// Double rAF so the disc's scale(0) start state paints once before the
		// transition to full scale — a single frame can be coalesced and skipped.
		requestAnimationFrame(() => requestAnimationFrame(() => (irisGo = true)));

		void Promise.all([loaded, held]).then(() => {
			// Raise the hand-off flag in the same tick as the navigation, so the
			// destination sees it at component init and opens with its arrival.
			markEntering();
			return goto(href, { keepFocus: true, noScroll: true });
		});
	}
</script>

<Seo
	title="Geisha — Asia &amp; Fusion · Benton, Newcastle"
	description="Geisha. Two restaurants, one name, on Front Street, Benton, Newcastle: Geisha Asia (pan-Asian) and Geisha Fusion (global fusion)."
/>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<!-- The redesign type pair, shared with the Asia home hero: Shippori Mincho for
	     display, Jost for the spaced caps and body. -->
	<link
		href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600;700&family=Jost:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div
	class="stage"
	class:transitioning={transitioning !== null}
	class:to-asia={transitioning === 'asia'}
	class:to-fusion={transitioning === 'fusion'}
>
	<!-- Subtle paper-grain noise -->
	<svg class="noise" aria-hidden="true">
		<filter id="v3-noise">
			<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
			<feColorMatrix
				values="0 0 0 0 0.9
				        0 0 0 0 0.86
				        0 0 0 0 0.78
				        0 0 0 0.18 0"
			/>
		</filter>
		<rect width="100%" height="100%" filter="url(#v3-noise)" />
	</svg>

	<!--
		SIDE TREE — a cherry tree pushed off the LEFT edge so only its branches reach
		into the frame, with a few lanterns swaying on them. Sits above the tile
		photo/veil but below the headings and CTAs. There was a mirrored tree on the
		right edge too; it's been dropped, so the blossom now reads as a single
		asymmetric accent framing the Asia side rather than a border round the page.
	-->
	<div class="grove" aria-hidden="true">
		<div class="grove-tree grove-left">
			<img class="grove-img" src="/tree.svg" alt="" />
			{#each asiaLanterns as l, i}
				<div class="grove-lantern-pivot" style="left: {l.x}%; top: {l.y}%;">
					<img
						class="grove-lantern"
						src={l.src}
						alt=""
						style="--sway-duration: {l.dur}s; --sway-delay: {l.delay}s; animation-delay: {0.6 +
							i * 0.2}s, {l.delay}s;"
					/>
				</div>
			{/each}
		</div>
	</div>

	<!-- Two tiles, asymmetric -->
	<div
		class="tiles"
		class:asia-large={featured === 'asia'}
		class:fusion-large={featured === 'fusion'}
	>
		<!-- ASIA tile -->
		<a
			class="tile tile-asia"
			class:large={featured === 'asia'}
			class:small={featured !== 'asia'}
			href="/asia"
			aria-label="Enter Geisha Asia"
			onmouseenter={() => feature('asia')}
			onfocus={() => feature('asia')}
			onclick={(e) => enter('asia', e)}
		>
			<img class="tile-photo" {...asiaTile} alt="" fetchpriority="high" />
			<div class="tile-veil tile-veil-asia"></div>

			<div class="tile-inner">
				<h2 class="tile-name">
					<img class="tile-logo" src="/geisha-asia-wordmark.png" alt="Geisha Asia" />
				</h2>
				<span class="tile-eyebrow">Sushi · Dim Sum · Robata</span>

				<p class="tile-meta">
					<!-- Hours strap from the live service periods (see +page.server.ts).
					     Where / separator / hours are separate spans so a phone can set the
					     hours on a line of their own (Fusion's strap is too long to share one
					     and used to break after "Sun"). The separator is an expression so its
					     spaces survive Svelte's whitespace trimming — desktop reads as before. -->
					<span class="meta-where"><b>Benton</b> · Pan-Asian</span
					>{#if data.asiaHoursStrap}<span class="meta-sep">{' · '}</span><span class="meta-hours"
							>{data.asiaHoursStrap}</span
						>{/if}
				</p>

				<span class="tile-cta btn btn-solid">
					Enter Geisha Asia
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg
					>
				</span>
			</div>

			<div class="tile-mini">
				<span class="mini-name">Asia</span>
				<span class="mini-tag">Sushi · Dim Sum · Robata</span>
			</div>
		</a>

		<!-- FUSION tile -->
		<a
			class="tile tile-fusion"
			class:large={featured === 'fusion'}
			class:small={featured !== 'fusion'}
			href="/fusion"
			aria-label="Enter Geisha Fusion"
			onmouseenter={() => feature('fusion')}
			onfocus={() => feature('fusion')}
			onclick={(e) => enter('fusion', e)}
		>
			<img class="tile-photo" {...fusionTile} alt="" />
			<div class="tile-veil tile-veil-fusion"></div>

			<div class="tile-inner">
				<h2 class="tile-name">
					<img class="tile-logo" src="/geisha-fusion.png" alt="Geisha Fusion" />
				</h2>
				<span class="tile-eyebrow">Burgers · Curry · Sunday Roast</span>

				<p class="tile-meta">
					<span class="meta-where"><b>Benton</b> · Global Fusion</span
					>{#if data.fusionHoursStrap}<span class="meta-sep">{' · '}</span><span class="meta-hours"
							>{data.fusionHoursStrap}</span
						>{/if}
				</p>

				<span class="tile-cta btn btn-solid">
					Enter Geisha Fusion
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg
					>
				</span>
			</div>

			<div class="tile-mini">
				<span class="mini-name">Fusion</span>
				<span class="mini-tag">Burgers · Curry · Sunday Roast</span>
			</div>
		</a>
	</div>

	<!-- Footer line. Asia and Fusion are two businesses in ONE building (same street,
	     same NE12 8AE — only their phones and hours differ), so there is no
	     per-house address to swap to on hover: the address is theirs jointly. -->
	<footer class="bottombar">
		<!-- Split at the first separator so a phone, where the line cannot fit, breaks
		     it there into two tidy rows rather than orphaning "· NE12 8AE". -->
		<span class="bb-line"
			><span class="bb-part">Front Street, Benton</span><span class="bb-sep">{' · '}</span><span
				class="bb-part">Newcastle upon Tyne · NE12 8AE</span
			></span
		>
	</footer>

	<!--
		THE SAKURA IRIS — see the departure notes in the script block.

		Three stacked layers, deliberately in this order:
		  .iris-disc   the bloom — a sakura-cored ink disc scaling out of the click
		  .iris-settle flat brand ink fading in behind the bloom's tail, so the LAST
		               frame is the exact flat colour the destination opens on (a
		               gradient handing over to a flat panel would pop)
		  .iris-mark   the spaced-caps line, which the destination repeats and then
		               dissolves as its panels part — the thread tying the two pages
	-->
	{#if transitioning}
		<div
			class="iris"
			class:go={irisGo}
			class:iris-fusion={transitioning === 'fusion'}
			style="--tx: {irisX}px; --ty: {irisY}px; --iris-scale: {irisScale};"
			aria-hidden="true"
		>
			<div class="iris-disc"></div>
			<div class="iris-settle"></div>
			<p class="iris-mark">
				<span class="iris-rule"></span>
				Entering Geisha {transitioning === 'asia' ? 'Asia' : 'Fusion'}
				<span class="iris-rule"></span>
			</p>
		</div>
	{/if}
</div>

<style>
	/* No `background` — see the note in fusion/+page.svelte. The landing needs none
	   anyway: .stage is fixed inset:0 and paints var(--ink) over the whole viewport. */
	:global(body) {
		margin: 0;
		padding: 0;
		color: #f5f1e8;
		font-family:
			'Jost',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		font-weight: 300;
	}

	/* ===== TOKENS =====
	   Lifted from the Asia home hero (src/routes/asia/+page.svelte), which is itself
	   ported from the redesign template — so the front door and the room you walk
	   into speak the same language: ink ground, gold spaced caps, ivory display
	   serif, sakura call to action.

	   Declared on .stage so the Asia side inherits them, then overridden inside
	   .tile-fusion with the template's Fusion set (copper + teal on the same ink)
	   — the Fusion photograph is as dark as Asia's, so its old cream veil would
	   have washed it out and taken its dark type with it. */
	.stage {
		--ink: #08080b;
		--hair: rgba(255, 255, 255, 0.12);
		--gold: #d4af37;
		--gold-bright: #f4cf6b;
		--ivory: #f5f1e8;
		--muted: #a3a0a0;
		--sakura: #ef3c5c;
		--sakura-2: #ff7a94;
		--sakura-glow: rgba(239, 60, 92, 0.4);
		--display: 'Shippori Mincho', Georgia, serif;
		--body-f: 'Jost', system-ui, sans-serif;
		--ease: cubic-bezier(0.22, 0.9, 0.3, 1);

		position: fixed;
		inset: 0;
		overflow: hidden;
		background: var(--ink);
		isolation: isolate;
	}

	.noise {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0.32;
		mix-blend-mode: overlay;
		pointer-events: none;
		z-index: 6;
	}

	/* SIDE TREES (grove) — above tile video/veil, below nav + headings */
	.grove {
		position: absolute;
		inset: 0;
		z-index: 5;
		pointer-events: none;
		overflow: hidden;
	}
	.grove-tree {
		position: absolute;
		/* Square box matching the 2000×2000 tree viewBox. Sized in vh so the
		   tree scales with viewport height; pushed mostly off its own edge so
		   only the branches reach into the frame (the trunk stays off-screen). */
		aspect-ratio: 1 / 1;
		opacity: 0;
		animation: groveFade 1.2s ease 0.5s forwards;
		will-change: transform;
	}
	.grove-img {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: contain;
		/* Tone the tree to the dark brand palette so it reads as silhouette-ish
		   foliage rather than a bright pink illustration over the video. */
		filter: saturate(0.55) brightness(0.62) contrast(1.05)
			drop-shadow(0 8px 28px rgba(0, 0, 0, 0.55));
		/* Fade out the lower foliage/trunk so it dissolves into the page rather
		   than showing as a hard mass at the bottom of the frame. */
		-webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 40%, transparent 62%);
		mask-image: linear-gradient(to bottom, #000 0%, #000 40%, transparent 62%);
	}

	/* The LIGHT version — inverted to a pale cream silhouette so it reads as a light
	   tree against the dark Asia tile. Pushed off the left edge and dropped a bit so
	   only the right-hand branches drape into the corner. */
	.grove-left {
		left: 0;
		top: -34%;
		height: 150vh;
		transform: translateX(-78%) rotate(3deg);
		transform-origin: top left;
	}
	.grove-left .grove-img {
		filter: invert(1) saturate(0.25) brightness(1.12) sepia(0.18)
			drop-shadow(0 8px 24px rgba(0, 0, 0, 0.5));
	}

	.grove-lantern-pivot {
		position: absolute;
		width: 4%;
		transform-origin: top center;
		transform: translateX(-50%);
	}
	.grove-lantern {
		width: 100%;
		height: auto;
		display: block;
		transform-origin: top center;
		opacity: 0;
		animation:
			groveLanternAppear 1s ease forwards,
			groveLanternSway var(--sway-duration, 4s) ease-in-out var(--sway-delay, 1s) infinite;
		filter: drop-shadow(0 4px 14px rgba(255, 120, 60, 0.45));
	}
	/* Trees and lanterns settle short of full opacity so they read as ambient
	   scenery behind the tiles rather than foreground illustration. */
	@keyframes groveFade {
		to {
			opacity: 0.7;
		}
	}
	@keyframes groveLanternAppear {
		from {
			opacity: 0;
		}
		to {
			opacity: 0.87;
		}
	}
	@keyframes groveLanternSway {
		0%,
		100% {
			transform: rotate(0deg);
		}
		25% {
			transform: rotate(3deg);
		}
		75% {
			transform: rotate(-3deg);
		}
	}

	/* TILES */
	.tiles {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: 70% 30%;
		transition: grid-template-columns 0.7s cubic-bezier(0.66, 0, 0.2, 1);
	}
	.tiles.fusion-large {
		grid-template-columns: 30% 70%;
	}

	.tile {
		position: relative;
		overflow: hidden;
		text-decoration: none;
		color: inherit;
		cursor: pointer;
		isolation: isolate;
		transition: filter 0.7s ease;
	}
	.tile.small {
		filter: brightness(0.9) saturate(0.93);
	}
	.tile.large {
		filter: brightness(1) saturate(1);
	}
	.tile-asia {
		background: var(--ink);
	}
	/* Fusion keeps the same ink ground but swaps the accents to the template's
	   Fusion palette (copper/teal) so the two sides read as siblings, not clones. */
	.tile-fusion {
		--gold: #dd8236;
		--gold-bright: #f79a4a;
		--ivory: #f2ece0;
		--muted: #9fb0a8;
		--sakura: #3f6f66;
		--sakura-2: #5a9184;
		--sakura-glow: rgba(63, 111, 102, 0.45);
		--hair: rgba(221, 130, 54, 0.18);
		background: #0a0d0b;
	}

	.tile-photo {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		z-index: 0;
		transition: transform 1s ease;
		/* Both stills are graded near-black at source — around 90% of their pixels
		   fall in the bottom fifth of the luminance range. Thinning the veils alone
		   can't recover that, so lift the exposure here: brightness opens the whole
		   frame, the slight contrast pull-down rescues the crushed shadows (the gold
		   disc, the kimono embroidery, the painted face's blues), and a touch of
		   saturation puts back what the lift washes out. */
		filter: brightness(1.32) contrast(0.93) saturate(1.06);
	}
	/* Both stills are wide crops with their subject off to one side: the Asia
	   portrait's face and gold disc sit right of centre, Fusion's painted face at
	   the far left. Hold each in frame as the tile narrows. */
	.tile-asia .tile-photo {
		object-position: 70% 28%;
	}
	.tile-fusion .tile-photo {
		object-position: 12% 45%;
	}
	.tile.large .tile-photo {
		transform: scale(1);
	}
	.tile.small .tile-photo {
		transform: scale(1.06);
	}
	.tile-veil {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		transition:
			opacity 0.6s ease,
			background 0.6s ease;
	}
	/* ASIA — the home hero's scrim, verbatim: a left→right ink wash so the copy sits
	   on near-solid black without dimming the portrait itself, plus a top/bottom
	   fade. Because this tile carries the same photograph as the hero, the two now
	   look like one image with the same light on it. */
	.tile-veil-asia {
		background:
			linear-gradient(
				90deg,
				var(--ink) 0%,
				rgba(10, 9, 8, 0.78) 24%,
				rgba(10, 9, 8, 0.28) 48%,
				rgba(10, 9, 8, 0.02) 68%,
				transparent 82%
			),
			linear-gradient(
				0deg,
				rgba(10, 9, 8, 0.4) 0%,
				transparent 22%,
				transparent 78%,
				rgba(10, 9, 8, 0.44) 100%
			);
	}
	/* FUSION — the same idea rotated. Its painted face sits on the LEFT, exactly
	   where a horizontal wash would bury it, so the ink rises from the bottom
	   instead and only a light left-hand wash carries the copy. */
	.tile-veil-fusion {
		background:
			linear-gradient(
				0deg,
				rgba(6, 10, 8, 0.84) 0%,
				rgba(6, 10, 8, 0.46) 26%,
				rgba(6, 10, 8, 0.04) 55%,
				rgba(6, 10, 8, 0.22) 100%
			),
			linear-gradient(90deg, rgba(6, 10, 8, 0.44) 0%, transparent 45%);
	}
	.tile.small .tile-veil-asia {
		background: linear-gradient(180deg, rgba(10, 9, 8, 0.32) 0%, rgba(10, 9, 8, 0.78) 100%);
	}
	.tile.small .tile-veil-fusion {
		background: linear-gradient(180deg, rgba(6, 10, 8, 0.32) 0%, rgba(6, 10, 8, 0.78) 100%);
	}

	/* Large-tile content */
	.tile-inner {
		position: relative;
		z-index: 2;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 0.9rem;
		padding: 5.5rem 4rem 5rem;
		box-sizing: border-box;
		opacity: 1;
		transform: translateY(0);
		transition:
			opacity 0.55s ease 0.15s,
			transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) 0.15s;
	}
	.tile.small .tile-inner {
		opacity: 0;
		transform: translateY(20px);
		transition-delay: 0s;
		pointer-events: none;
	}
	.tile-name {
		font-family: var(--display);
		margin: 0;
		display: block;
	}
	/* Brand wordmark PNG standing in for a typeset tile title. Both marks are white
	   art on transparent, and both tiles are now ink, so neither needs inverting —
	   just the hero's drop shadow so the mark lifts off the photograph.
	   Sized to the hero's optical width (43% of a 600px copy column) rather than
	   the old poster-scale mark, so the front door and the hero agree. */
	.tile-logo {
		display: block;
		width: clamp(13rem, 26vw, 20rem);
		max-width: 100%;
		height: auto;
		object-fit: contain;
		filter: drop-shadow(0 12px 34px rgba(0, 0, 0, 0.55));
	}
	.tile-inner {
		text-shadow:
			0 2px 10px rgba(8, 6, 4, 0.85),
			0 1px 3px rgba(8, 6, 4, 0.9);
	}
	/* Readability scrim: a soft dark wash behind the lower-left text block so the
	   headings stay legible over the video and the tree. Sits at the text layer
	   (z-2, above the grove) but behind the actual words. */
	.tile-asia .tile-inner::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 78%;
		z-index: -1;
		pointer-events: none;
		background: linear-gradient(
			to top,
			rgba(8, 6, 4, 0.82) 0%,
			rgba(8, 6, 4, 0.6) 34%,
			rgba(8, 6, 4, 0.28) 64%,
			transparent 100%
		);
	}
	/* Fusion carries the same scrim — its photograph is as dark as Asia's now, and
	   only the accent tokens differ between the two sides. */
	.tile-fusion .tile-inner::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 78%;
		z-index: -1;
		pointer-events: none;
		background: linear-gradient(
			to top,
			rgba(6, 10, 8, 0.82) 0%,
			rgba(6, 10, 8, 0.6) 34%,
			rgba(6, 10, 8, 0.28) 64%,
			transparent 100%
		);
	}

	/* Gold spaced caps behind a short rule — the hero's eyebrow, exactly. */
	.tile-eyebrow {
		display: flex;
		align-items: center;
		gap: 14px;
		margin: 0.2rem 0 0;
		font-family: var(--body-f);
		font-size: 0.72rem;
		font-weight: 400;
		line-height: 1.6;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--gold);
	}
	.tile-eyebrow::before {
		content: '';
		flex: none;
		width: 34px;
		height: 1px;
		background: var(--gold);
	}

	/* The hero's lede register: Jost 300, muted, one quiet line. */
	.tile-meta {
		margin: 0.7rem 0 0;
		font-family: var(--body-f);
		font-weight: 300;
		font-size: 0.95rem;
		line-height: 1.6;
		letter-spacing: 0.02em;
		color: var(--muted);
		max-width: 460px;
	}
	.tile-meta b {
		font-weight: 500;
		color: var(--gold-bright);
	}

	/* The hero's filled call to action — sakura on Asia, teal on Fusion (the
	   template's Fusion set remaps --sakura, so one rule serves both). */
	.tile-cta {
		align-self: flex-start;
		margin-top: 1.9rem;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--sakura);
		color: var(--ivory);
		background: transparent;
		padding: 15px 30px;
		font-family: var(--body-f);
		font-size: 0.72rem;
		font-weight: 400;
		line-height: 1.6;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		text-shadow: none;
		position: relative;
		overflow: hidden;
		z-index: 0;
		transition:
			color 0.5s var(--ease),
			box-shadow 0.4s var(--ease),
			transform 0.5s var(--ease);
	}
	.btn svg {
		width: 14px;
		height: 14px;
		flex: none;
		transition: transform 0.4s var(--ease);
	}
	.btn-solid {
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2));
		color: #fff;
		border-color: transparent;
		box-shadow: 0 10px 30px var(--sakura-glow);
	}
	/* The sheen: the gradient re-laid in reverse, revealed on hover. */
	.btn-solid::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: linear-gradient(120deg, var(--sakura-2), var(--sakura));
		opacity: 0;
		transition: opacity 0.5s var(--ease);
	}
	.tile.large:hover .btn-solid,
	.tile.large:focus-visible .btn-solid {
		transform: translateY(-2px);
		box-shadow: 0 16px 40px var(--sakura-glow);
	}
	.tile.large:hover .btn-solid::before {
		opacity: 1;
	}
	.tile.large:hover .btn svg {
		transform: translateX(4px);
	}

	/* Small-tile content */
	.tile-mini {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: flex-start;
		padding: 2.4rem 1.6rem 2.4rem 1.8rem;
		gap: 0.6rem;
		opacity: 0;
		transform: translateY(14px);
		transition:
			opacity 0.55s ease 0.15s,
			transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) 0.15s;
		pointer-events: none;
	}
	.tile.small .tile-mini {
		opacity: 1;
		transform: translateY(0);
	}
	.mini-name {
		font-family: var(--display);
		font-weight: 600;
		font-size: clamp(1.6rem, 3.6vw, 2.8rem);
		letter-spacing: 0.01em;
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		margin: 0.4rem 0 1rem;
		color: var(--ivory);
	}
	.mini-tag {
		font-family: var(--body-f);
		font-size: 0.66rem;
		letter-spacing: 0.36em;
		text-transform: uppercase;
		color: var(--gold);
	}

	/* Hover hint on small tile */
	.tile.small::after {
		content: '';
		position: absolute;
		top: 1.4rem;
		right: 1.4rem;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		z-index: 3;
		opacity: 0.7;
		animation: pulse 2.4s ease-in-out infinite;
	}
	.tile-asia.small::after {
		background: var(--sakura);
		box-shadow: 0 0 12px var(--sakura-glow);
	}
	.tile-fusion.small::after {
		background: var(--gold-bright);
		box-shadow: 0 0 12px rgba(232, 171, 107, 0.7);
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.4;
			transform: scale(1);
		}
		50% {
			opacity: 0.95;
			transform: scale(1.4);
		}
	}

	/* BOTTOM BAR */
	.bottombar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 7;
		display: flex;
		justify-content: center;
		padding: 1.2rem 2.2rem;
		font-size: 0.64rem;
		letter-spacing: 0.36em;
		text-transform: uppercase;
		font-family: var(--body-f);
		color: rgba(245, 241, 232, 0.6);
		pointer-events: none;
		text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
	}

	/* ===== THE SAKURA IRIS (departure) =====
	   Three layers over a fixed, click-anchored origin. Everything is transform and
	   opacity only, so the whole departure is compositor work — it can't stutter
	   while the SvelteKit load is running on the main thread beside it. */
	.iris {
		position: fixed;
		inset: 0;
		z-index: 20;
		pointer-events: none;
		overflow: hidden;
	}

	/* THE BLOOM. A seed disc anchored at the click, scaled to reach the furthest
	   corner (--iris-scale, measured in depart()).

	   The disc is brand INK, near enough flat. The only colour is a hairline of
	   sakura light riding its leading edge — so what you see is a thin lit rim
	   racing outward and ink closing behind it, not a wash of pink. The stops are
	   deliberately tight (96%→100% of the radius) because a radial-gradient scales
	   with the element: a generous band here becomes a several-hundred-pixel flood
	   by the time the disc has covered the viewport. */
	.iris-disc {
		position: absolute;
		left: var(--tx, 50%);
		top: var(--ty, 50%);
		width: 40px;
		height: 40px;
		margin: -20px 0 0 -20px;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			var(--iris-ground) 0%,
			var(--iris-ground) 96%,
			var(--iris-edge-soft) 99%,
			var(--iris-edge) 100%
		);
		transform: scale(0);
		will-change: transform;
		transition: transform 0.72s cubic-bezier(0.62, 0.04, 0.32, 1);
	}
	.iris.go .iris-disc {
		transform: scale(var(--iris-scale, 60));
	}

	/* THE SETTLE. Flat brand ink, fading in under the bloom's tail. It guarantees the
	   departure ENDS on the exact colour the destination's shoji panels start on,
	   whatever the disc's edge is doing at that instant — any difference is a
	   visible pop across the route swap. */
	.iris-settle {
		position: absolute;
		inset: 0;
		background: var(--iris-ground);
		opacity: 0;
		transition: opacity 0.34s ease 0.3s;
	}
	.iris.go .iris-settle {
		opacity: 1;
	}

	/* THE MARK. The hero's eyebrow register — Shippori Mincho, wide caps, a gold
	   hairline each side. The destination repeats this line and dissolves it as its
	   panels part, so it reads as one held title card across two pages. */
	.iris-mark {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%) translateY(8px);
		margin: 0;
		display: flex;
		align-items: center;
		gap: 16px;
		white-space: nowrap;
		font-family: var(--display);
		font-weight: 500;
		font-size: 0.74rem;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: var(--ivory);
		opacity: 0;
		transition:
			opacity 0.44s ease 0.26s,
			transform 0.6s var(--ease) 0.26s;
	}
	.iris.go .iris-mark {
		opacity: 1;
		transform: translate(-50%, -50%) translateY(0);
	}
	/* The rules breathe. If a slow load holds the departure past the animation, the
	   screen is still alive rather than frozen on a still frame. */
	.iris-rule {
		display: block;
		width: 34px;
		height: 1px;
		background: var(--iris-rule);
		animation: irisBreathe 2.4s ease-in-out 0.7s infinite;
	}
	@keyframes irisBreathe {
		0%,
		100% {
			opacity: 0.35;
			transform: scaleX(0.75);
		}
		50% {
			opacity: 1;
			transform: scaleX(1);
		}
	}

	/* Per-house ink. The ground is exactly what the destination layout's panels are
	   painted with; the edge is that house's accent, at low alpha so it reads as a
	   lit rim rather than a colour. */
	.iris {
		--iris-ground: #08080b;
		--iris-edge-soft: rgba(239, 60, 92, 0.28);
		--iris-edge: rgba(255, 122, 148, 0.5);
		--iris-rule: #d4af37;
	}
	.iris-fusion {
		--iris-ground: #0a0d0b;
		--iris-edge-soft: rgba(63, 111, 102, 0.3);
		--iris-edge: rgba(90, 145, 132, 0.5);
		--iris-rule: #dd8236;
	}

	/* Stage during the departure: the tiles are NOT faded out — they're swallowed by
	   the bloom, which is the whole point of an iris. They just recede a touch so
	   the ink reads as coming toward you. Only the scenery dissolves. */
	.stage.transitioning {
		pointer-events: none;
	}
	.stage.transitioning .tiles {
		transform: scale(0.985);
		transition: transform 0.8s var(--ease);
	}
	.stage.transitioning .bottombar,
	.stage.transitioning .noise,
	.stage.transitioning .grove {
		opacity: 0;
		transition: opacity 0.4s ease;
	}
	/* Match background of destination so any transient gap reads the same
	   colour as the destination page. */
	.stage.transitioning.to-asia {
		background: #08080b;
	}
	.stage.transitioning.to-fusion {
		background: #0a0d0b;
	}

	/* MOBILE — stack vertically.
	   No hover on touch, so we drop the large/small "feature" model entirely:
	   both tiles are equal halves, always fully readable, and a single tap enters
	   that brand directly (see enter() + isMobile). */
	@media (max-width: 760px) {
		/* Equal halves whichever house is "featured". (A second .fusion-large rule
		   further down used to re-split the rows 30/70. Android focuses a link on
		   tap, focus features the tile, so tapping Fusion squashed Asia to a strip —
		   wordmark clipped off the top — in the instant before the iris covered it.) */
		.tiles,
		.tiles.fusion-large {
			grid-template-columns: 1fr;
			grid-template-rows: 1fr 1fr;
		}
		/* Stacked, the two tiles split the stage 50/50 — so a bottom-fixed cookie
		   banner sits entirely on Fusion's half and hides its CTA. Give the banner
		   its height back (CookieBanner publishes `--cb-h`; it is 0px once dismissed)
		   so both tiles stay whole and tappable while the notice is up. */
		.stage {
			bottom: var(--cb-h, 0px);
		}
		/* Both tiles read as active — kill the small-tile dimming and zoom. */
		.tile.small {
			filter: none;
		}
		.tile.small .tile-photo {
			transform: scale(1);
		}
		/* Show the full content block on BOTH tiles (the featured-only reveal is a
		   desktop-hover affordance); hide the vertical mini-label and pulse dot. */
		.tile.small .tile-inner {
			opacity: 1;
			transform: none;
			pointer-events: auto;
		}
		.tile-mini,
		.tile.small::after {
			display: none;
		}

		/* ===== THE PHONE TILE: masthead above, cover lines below =====
		   A stacked tile is far shorter than it looks in an emulator. Nothing here
		   scrolls, so Safari's toolbars never retract: a 390×844 iPhone shows ~664px,
		   which is a 332px tile — and ~235px on a first visit, while the cookie notice
		   holds the bottom 195px. The copy stack is ~230px (Fusion ~290px), so bottom-
		   anchored as one block it ran the wordmark straight across both faces, and
		   in the cookie state pushed Fusion's wordmark out of the top of its tile.

		   So the stack is split like a magazine cover: the wordmark is pinned to the
		   top of the tile (.tile-name's auto margin), the eyebrow / details / button
		   stay at the bottom, and the portrait looks out of the gap between them. Each
		   tile is a size container so the copy can answer to the tile it is actually
		   in — see the @container rules at the end of this block. */
		.tile {
			container-type: size;
		}
		.tile-name {
			margin-bottom: auto;
		}
		/* Place each subject for that layout. Asia: her profile moves right, clear of
		   the wordmark, which then sits on the dark half of the frame. */
		.tile-asia .tile-photo {
			object-position: 66% 28%;
		}
		/* Fusion: the painted face is at the far left, under the copy, and cannot be
		   moved sideways. Over-height the photo from the bottom edge instead, which
		   lifts the eyes into the gap below the wordmark. */
		.tile-fusion .tile-photo {
			top: auto;
			height: 112%;
		}
		/* An ink wash rising from the bottom on both — the cover lines sit on it. */
		.tile.small .tile-veil-asia,
		.tile-veil-asia {
			background: linear-gradient(
				0deg,
				rgba(10, 9, 8, 0.85) 0%,
				rgba(10, 9, 8, 0.48) 34%,
				rgba(10, 9, 8, 0.06) 68%,
				rgba(10, 9, 8, 0.28) 100%
			);
		}
		/* Fusion's copy is over paint, not shadow, so its wash is measured in px from
		   each edge (the copy is a fixed height whatever the tile's is): dense to the
		   top of the eyebrow, clear across the eyes, then dark again behind the
		   wordmark, which otherwise fights the hanging blossom. */
		.tile.small .tile-veil-fusion,
		.tile-veil-fusion {
			background: linear-gradient(
				0deg,
				rgba(6, 10, 8, 0.9) 0,
				rgba(6, 10, 8, 0.64) 110px,
				rgba(6, 10, 8, 0.4) 180px,
				rgba(6, 10, 8, 0.05) 222px,
				rgba(6, 10, 8, 0.05) calc(100% - 120px),
				rgba(6, 10, 8, 0.62) 100%
			);
		}
		/* On a narrow portrait screen, size the tree to viewport WIDTH (not height)
		   and push it well off its edge, so it stays a small top-corner accent —
		   just a few branch tips — instead of flooding the screen.
		   `top` is in vw too (it was -16% of the stage, so the branch slid up and
		   down with the phone's height and, on a tall one, lay across the wordmark):
		   now the branch always tucks under the "G" and the lantern hangs in the
		   open ink beside the portrait. */
		.grove-left {
			height: 110vw;
			top: -27vw;
			transform: translateX(-82%) rotate(3deg);
		}
		.grove-lantern-pivot {
			width: 5%;
		}
		/* That open ink only exists while the tile is tall. While the cookie notice
		   is up the tiles are too short for it and the lantern lands on the copy, so
		   the scenery waits: any `--cb-h` at all drives this height negative, which
		   clamps to 0, and .grove clips its own overflow. */
		.grove {
			bottom: auto;
			height: max(0px, 100% - var(--cb-h, 0px) * 100);
		}
		.tile-inner {
			padding: 1.5rem 1.6rem 1.6rem;
			gap: 0.5rem;
		}
		/* The footer is pinned to the viewport bottom over the lower (Fusion) tile,
		   so pad that tile's content up clear of it. Asia is the FIRST DOM tile and
		   Fusion the SECOND; on mobile they're stacked top/bottom in that order.
		   While the cookie notice is up the footer steps aside (see .bottombar), and
		   this hands its room straight back to the tile. */
		.tile-fusion .tile-inner {
			padding-bottom: max(1.6rem, 3.8rem - var(--cb-h, 0px));
		}
		/* Each tile is only ~half the viewport now, so scale the wordmark and copy
		   down to fit comfortably without scrolling. */
		.tile-logo {
			--logo-w: clamp(11rem, 52vw, 18rem);
			width: var(--logo-w);
		}
		/* The Fusion PNG is 1890×664 with its ink inset (160px left, 102px top, 56px
		   bottom, 1553px of ink across); the Asia PNG is trimmed to its ink. Stacked
		   one above the other that showed: Fusion's wordmark was a fifth smaller than
		   Asia's and started 17px to the right of its own eyebrow. Scale the canvas
		   so the INK is --logo-w wide, and pull the padding back off each side. */
		.tile-fusion .tile-logo {
			width: calc(var(--logo-w) * 1.217);
			margin: calc(var(--logo-w) * -0.066) 0 calc(var(--logo-w) * -0.035)
				calc(var(--logo-w) * -0.103);
		}
		/* Was 0.62rem — 9.9px on a phone. These are wide-tracked caps, which read
		   smaller still than the number suggests, and this line is the only thing
		   telling you what each restaurant serves. */
		.tile-eyebrow {
			margin-top: 0.2rem;
			gap: 10px;
			font-size: 0.7rem;
			letter-spacing: 0.24em;
		}
		.tile-eyebrow::before {
			width: 22px;
		}
		/* Where on one line, hours on the next — on both tiles, so they match. As one
		   run, Fusion's wrapped mid-phrase ("… 11pm · Sun / 12pm — 7:30pm"). */
		.tile-meta {
			margin-top: 0.3rem;
			font-size: 0.82rem;
			line-height: 1.5;
		}
		.meta-where,
		.meta-hours {
			display: block;
		}
		.meta-sep {
			display: none;
		}
		/* No hover on touch, so the filled button carries the affordance on its own.
		   One above the other, the two buttons were 219px and 240px wide for no
		   reason but the length of the name; the floor is the longer one's width. */
		.tile-cta {
			margin-top: 0.9rem;
			box-sizing: border-box;
			min-width: 14.75rem;
			justify-content: space-between;
		}
		/* 0.66rem put the label on the two entry buttons at 10.6px — small for the
		   primary action on the page, and the only control on the splitter. */
		.btn {
			padding: 13px 22px;
			font-size: 0.75rem;
			letter-spacing: 0.18em;
		}
		/* Was 0.58rem (9.3px) at 0.36em tracking, which still didn't fit and wrapped
		   to a centred "· NE12 8AE" on its own. Two deliberate rows instead, at a
		   size that can be read. The padding moves to the inner line so the bar can
		   close to nothing: under the cookie notice it would be a third row of small
		   print stacked on the notice, in a tile that has no height to spare. */
		.bottombar {
			display: block;
			padding: 0;
			overflow: hidden;
			max-height: max(0px, 4rem - var(--cb-h, 0px));
			text-align: center;
			font-size: 0.66rem;
			line-height: 1.45;
			letter-spacing: 0.2em;
		}
		.bb-line {
			display: block;
			padding: 0.5rem 1rem 0.75rem;
		}
		.bb-part {
			display: block;
		}
		.bb-sep {
			display: none;
		}

		/* SHORT TILES. Under ~305px (the cookie state on most phones; an iPhone SE
		   at any time) the copy closes up: smaller wordmark, tighter rhythm. */
		@container (max-height: 305px) {
			.tile-inner {
				padding-top: 1rem;
				padding-bottom: 1.1rem;
				gap: 0.4rem;
			}
			.tile-fusion .tile-inner {
				padding-bottom: max(1.1rem, 3.6rem - var(--cb-h, 0px));
			}
			.tile-logo {
				--logo-w: 9.5rem;
			}
			.tile-meta {
				margin-top: 0.1rem;
			}
			.tile-cta {
				margin-top: 0.5rem;
			}
			.btn {
				padding: 10px 20px;
			}
		}
		/* Under ~215px (an SE with the cookie notice up; a small phone on its side)
		   there is room for the name, what it serves and the way in — the details
		   line comes back the moment the tile has the height for it. */
		@container (max-height: 215px) {
			.tile-meta {
				display: none;
			}
		}
		/* Under ~260px — the cookie state on a 360–400px-wide phone — the tile is so
		   wide for its height that the whole frame shows, which puts her face
		   dead centre: exactly where the eyebrow runs. "DIM SUM · ROBATA" sat across
		   her chin, gold on the gold disc. So the photo is over-sized from the top-left
		   corner and slid until her profile is ~79% across, clear of the 255px copy
		   column, whatever shape the tile is. (130.7cqh = how far in her face is, at
		   this size, in a frame 1.878 wide; `min(0px, …)` because a tile wider than
		   the frame has no sideways slack to spend.) Taller tiles keep the full
		   composition above — there the eyebrow already falls below her chin. */
		@container (max-height: 260px) {
			.tile-asia .tile-photo {
				width: 118%;
				height: 118%;
				object-position: min(0px, 79cqw - 130.7cqh) 0;
			}
		}

		/* The departure's title card is 363px wide for Fusion and never wraps: on a
		   360px phone its rules ran off both edges of the screen, and at 390 it had
		   13px to spare. Closed up it is 310px. The SAME three numbers are in both
		   brand layouts (`.shoji-mark` in asia/+layout, `.iris-mark` in fusion/+layout)
		   — the line is handed from this page to that one mid-hold, and any
		   difference shows as the text re-tracking on the route swap. */
		.iris-mark {
			gap: 12px;
			letter-spacing: 0.26em;
		}
		.iris-rule {
			width: 22px;
		}
	}
	/* The 320px phones: Fusion's eyebrow ("Burgers · Curry · Sunday Roast") is 20px
	   too long at the tracking above and dropped "Roast" to a second line. */
	@media (max-width: 350px) {
		.tile-eyebrow {
			gap: 8px;
			letter-spacing: 0.16em;
		}
		.tile-eyebrow::before {
			width: 16px;
		}
	}
	/* Short screens, whatever the cookie notice is doing. Under ~630px the lantern
	   has no gap left to hang in (see .grove above); under ~520px the address line
	   costs the Fusion tile more than the tile can give. */
	@media (max-width: 760px) and (max-height: 630px) {
		.grove {
			display: none;
		}
	}
	@media (max-width: 760px) and (max-height: 520px) {
		.bottombar {
			display: none;
		}
		.tile-fusion .tile-inner {
			padding-bottom: 1.1rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tiles,
		.tile-inner,
		.tile-mini,
		.tile-veil,
		.tile-photo {
			transition-duration: 0.001s !important;
		}
		/* Reduced motion: no bloom, no travel — the ink is simply there, and the mark
		   states plainly where you're going. Same colours, same hand-off. */
		.iris-disc {
			display: none;
		}
		.iris-settle {
			opacity: 1;
			transition: none;
		}
		.iris-mark {
			transform: translate(-50%, -50%);
			transition: opacity 0.18s ease;
		}
		.iris.go .iris-mark {
			transform: translate(-50%, -50%);
		}
		.iris-rule {
			animation: none;
			opacity: 0.8;
		}
		.tile.small::after {
			animation: none;
		}
		/* Trees fade in but lanterns hang still — no perpetual sway. */
		.grove-tree {
			animation-duration: 0.3s;
		}
		.grove-lantern {
			animation: groveLanternAppear 0.3s ease forwards;
		}
	}
</style>
