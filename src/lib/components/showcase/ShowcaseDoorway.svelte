<script lang="ts">
	// THE DOORWAY — the "Inside" section straight under the hero on both home pages.
	// An arched window onto the film, flanked by two plates. Scrolling opens the
	// arch until it IS the screen. One video throughout: the arch is a clip-path
	// over a full-bleed film, so opening it only ever reveals more of the same
	// picture. The stage is sticky inside a tall section, so the opening follows
	// the scroll position, not a timer — stop scrolling and it holds.
	import './type.css';
	import type { Brand } from '$lib/data/brand';
	import { GALLERY_PAGE_LIVE } from '$lib/data/features';
	import { FOOD_CHAPTER, SHOWCASE, TYPE_HREF, inviewVideo, scrollProgress, span } from '$lib/data/showcase';
	import { imgAttrs } from '$lib/media/responsive';
	import { onMount } from 'svelte';

	let { brand }: { brand: Brand } = $props();
	const s = $derived(SHOWCASE[brand.id]);

	let p = $state(0);
	let still = $state(false); // reduced motion: no pin, shown already open
	let phone = $state(false); // the phone layout (same breakpoint as the CSS)
	let paused = $state(false);
	let film: HTMLVideoElement | undefined = $state();
	let intro: HTMLElement | undefined = $state();
	let introEnd = $state(0); // px from the stage's top to the intro's last line
	onMount(() => {
		still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const mq = window.matchMedia('(max-width: 760px)');
		const onmq = () => (phone = mq.matches);
		onmq();
		mq.addEventListener('change', onmq);
		// On a phone the arch starts under the heading and lede, however many lines
		// they run to (and under the gallery button, when that is back): the CSS
		// reads this as --it. Measured on resize only — never per scroll frame.
		const fit = () => {
			if (intro) introEnd = intro.offsetTop + intro.offsetHeight;
		};
		const ro = new ResizeObserver(fit);
		if (intro) ro.observe(intro);
		return () => {
			mq.removeEventListener('change', onmq);
			ro.disconnect();
		};
	});

	// Choreography, all from the one progress value. A phone's pin is shorter
	// (180vh, not 200vh), so its opening takes a larger share of it and the hold at
	// the end a smaller one — the thumb travels about as far while the arch opens,
	// and then isn't kept waiting.
	const open = $derived(still ? 1 : phone ? span(p, 0.05, 0.68) : span(p, 0.06, 0.6)); // the arch widening
	const outro = $derived(still ? 1 : phone ? span(p, 0.7, 0.9) : span(p, 0.62, 0.8)); // buttons

	// While closed, the arch shows a chosen room clip (s.door). As it opens the
	// room dissolves into the film — full frame to full frame, same geometry.
	const room = $derived(still ? 0 : 1 - span(open, 0.12, 0.42));
	// One clip decoding at a time where it can be: the film sits wholly behind the
	// room clip until the arch starts to open, and the room clip is gone once it
	// has dissolved. (Booleans, so the videos are only told when one flips — not on
	// every scroll frame of the dissolve.)
	const filmOn = $derived(still || open > 0.03);
	const roomOn = $derived(room > 0);

	// The two progress values reach the CSS as --door-o (opening) and --door-x
	// (outro), written straight onto the dozen elements that use them. They are
	// registered as non-inherited (@property, in the styles): set once on the
	// section and inherited, every scroll frame restyled every element in it —
	// measured, that was about half as much style work again. Each piece also
	// stops being told once it has faded out (the room clip by 0.42; the heading,
	// sign, sill and plates by 0.56), so for the rest of the opening only the arch
	// and the film are restyled, and the room clip's box — the one thing here that
	// costs layout — stops being resized.
	const roomO = $derived(Math.min(open, 0.45));
	const sideO = $derived(Math.min(open, 0.6));

	// The film is cut to its food chapter as the arch starts to open, and from then
	// on loops ONLY that chapter — so the reveal and the full-screen end state are
	// always a plate, never the daylight exterior or a dip to black. The chapter's
	// edges are dips (≈0.25s either side of its start/end), so stay inside them.
	// Done from the film's own frame loop, which runs only while it is playing:
	// nothing ticks while the section is off screen, and a visitor who lands
	// part-way through the pin (reload, back button) gets the cut without having
	// to scroll first.
	let hold: { from: number; to: number } | null = null; // set once, read per frame
	onMount(() => {
		const f = film;
		if (!f) return;
		let raf = 0;
		const tick = () => {
			raf = 0;
			if (!hold && open >= 0.04 && f.currentSrc) {
				const cut = f.currentSrc.includes('-reel-m') ? s.reelPhone : s.reel;
				const i = cut.chapters.findIndex((c) => c.label === FOOD_CHAPTER);
				if (i >= 0) {
					hold = {
						from: cut.chapters[i].at + 0.5,
						to: (cut.chapters[i + 1]?.at ?? cut.duration) - 0.4
					};
					f.currentTime = hold.from;
				}
			}
			if (hold && (f.currentTime > hold.to || f.currentTime < hold.from - 0.6)) {
				f.currentTime = hold.from;
			}
			if (!f.paused) raf = requestAnimationFrame(tick);
		};
		const start = () => {
			if (!raf) raf = requestAnimationFrame(tick);
		};
		f.addEventListener('play', start);
		start();
		return () => {
			f.removeEventListener('play', start);
			cancelAnimationFrame(raf);
		};
	});
</script>

<svelte:head>
	{#if TYPE_HREF[brand.id]}
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
		<link rel="stylesheet" href={TYPE_HREF[brand.id]} />
	{/if}
</svelte:head>

<section
	class="door"
	class:still
	data-brand={brand.id}
	id="inside"
	aria-labelledby="door-title"
	use:scrollProgress={{ mode: 'pin', onprogress: (v) => (p = v) }}
	style:--it={introEnd ? `${introEnd}px` : null}
>
	<div class="stage">
		<div class="window" style:--door-o={open}>
			<video
				bind:this={film}
				style:--door-o={open}
				data-src={s.reel.src}
				data-src-phone={s.reelPhone.src}
				data-poster={s.reel.poster}
				data-poster-phone={s.reelPhone.poster}
				loop
				muted
				playsinline
				preload="none"
				aria-hidden="true"
				use:inviewVideo={{ paused: paused || !filmOn, fetchAt: '-30% 0px' }}
			></video>
			<video
				class="room"
				style:opacity={room}
				style:--door-o={roomO}
				data-src={s.door.src}
				poster={s.door.poster}
				loop
				muted
				playsinline
				preload="none"
				aria-hidden="true"
				use:inviewVideo={{ paused: paused || !roomOn }}
			></video>
			<div class="scrim" style:--door-x={outro}></div>
		</div>
		<span class="sill" style:--door-o={sideO} aria-hidden="true"></span>

		<!-- gone sooner on a phone, where the arch rises straight through it -->
		<div class="intro" style:--door-o={sideO} bind:this={intro} inert={open > (phone ? 0.14 : 0.4)}>
			<h2 id="door-title">{s.title}</h2>
			<p>{s.lede}</p>
			{#if GALLERY_PAGE_LIVE}
				<a class="btn small" href="/{brand.id}/gallery">See the gallery</a>
			{/if}
		</div>

		<!-- The sign standing beside the door, in the house's own lettering. Asia:
		     "Welcome" — what the neon 欢迎 over its bar says — stacked like a hanging
		     sign and drawn in outline, the way the GEISHA logo draws the same face.
		     Fusion: a line from its Our Story, set up the wall. -->
		{#if brand.id === 'asia'}
			<p class="mark sign" style:--door-o={sideO} aria-hidden="true">Welcome</p>
		{:else}
			<p class="mark wall" style:--door-o={sideO} aria-hidden="true">Every craving</p>
		{/if}

		<figure class="plate plate-a" style:--door-o={sideO}>
			<img {...imgAttrs(s.plates[0].src, '(max-width: 760px) 64vw, 28vw')} alt={s.plates[0].label} loading="lazy" />
			<figcaption>{s.plates[0].label}</figcaption>
		</figure>
		<figure class="plate plate-b" style:--door-o={sideO}>
			<img {...imgAttrs(s.plates[1].src, '(max-width: 760px) 64vw, 28vw')} alt={s.plates[1].label} loading="lazy" />
			<figcaption>{s.plates[1].label}</figcaption>
		</figure>

		<div class="outro" style:--door-x={outro} inert={outro < 0.5}>
			<!-- the heading again, over the open film: the house lettering stays on
			     screen at the point the design is at full stretch -->
			<p class="over" aria-hidden="true">{s.title}</p>
			<a class="btn solid" href={brand.bookingUrl}>Book a table</a>
			<a class="btn" href="/{brand.id}/menus">View the menu</a>
			{#if GALLERY_PAGE_LIVE}
				<a class="btn" href="/{brand.id}/gallery">See the gallery</a>
			{/if}
		</div>

		<button
			class="pause"
			style:--door-x={outro}
			type="button"
			aria-pressed={paused}
			aria-label={paused ? 'Play the film' : 'Pause the film'}
			onclick={() => (paused = !paused)}
		>
			{#if paused}
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" /></svg>
			{:else}
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" /></svg>
			{/if}
		</button>
	</div>
</section>

<style>
	/* The scroll progress, as the script hands it to each element that moves with
	   it: --door-o is the arch opening, --door-x the outro, both 0→1. Registered
	   as NOT inherited, so changing one on an element restyles that element only,
	   not everything inside it. Where @property isn't understood they are ordinary
	   inherited properties and nothing breaks — every element that reads one is
	   given its own. */
	@property --door-o {
		syntax: '<number>';
		inherits: false;
		initial-value: 0;
	}
	@property --door-x {
		syntax: '<number>';
		inherits: false;
		initial-value: 0;
	}

	.door {
		--bg: #131316; /* = Asia's Our Story, the section that follows */
		--from: #08080b; /* = the hero's ink, the section above */
		--ink: #f5f1e8;
		--muted: #b4b0aa;
		--accent: #d4af37;
		--action: #ef3c5c;
		--action-2: #ff7a94;
		--body: 'Jost', system-ui, sans-serif;
		/* the house's own display face — see type.css */
		--brand: 'Gang of Three', 'Shippori Mincho', Georgia, serif;
		--nav: 70px;
		/* the closed window */
		--ww: min(31vw, 52vh, 470px);
		--wh: min(72vh, 680px);
		--wy: 3vh; /* sits a little low, under the heading line */
		/* closed-film scale: ≥ the arch's share of the screen in its tighter axis
		   (here its height, ≤64vh), or the film wouldn't cover the arch */
		--k: 0.74;
		position: relative;
		height: 210vh;
		background: linear-gradient(var(--from), var(--bg) 70vh);
		color: var(--ink);
		box-sizing: border-box;
	}
	.door[data-brand='fusion'] {
		--bg: #0c1410;
		--from: #0a0d0b;
		--ink: #f2ece0;
		--muted: #a9b8b0;
		--accent: #dd8236;
		--action: #d92e22;
		--action-2: #f0503f;
		--brand: 'Caprasimo', 'Shippori Mincho', Georgia, serif;
	}
	/* Melt the hero's bottom edge into this section instead of a hard line. */
	.door::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: -140px;
		height: 140px;
		background: linear-gradient(rgb(0 0 0 / 0), var(--from));
		pointer-events: none;
		z-index: 3;
	}
	.door *,
	.door *::before {
		box-sizing: border-box;
	}

	.stage {
		position: sticky;
		top: 0;
		height: 100vh;
		height: 100svh;
		overflow: hidden;
	}

	/* ---- the arch ----
	   Full-bleed box, clipped down to an arch. Opening = the inset and the top
	   radius both run to zero, so it is one clip-path change per frame (no layout). */
	.window {
		position: absolute;
		inset: 0;
		--t: calc((50% - var(--wh) / 2 + var(--wy)) * (1 - var(--door-o)));
		--b: calc((50% - var(--wh) / 2 - var(--wy)) * (1 - var(--door-o)));
		--s: calc((50% - var(--ww) / 2) * (1 - var(--door-o)));
		--r: calc(var(--ww) / 2 * (1 - var(--door-o)));
		clip-path: inset(var(--t) var(--s) var(--b) var(--s) round var(--r) var(--r) 0 0);
		background: #000;
	}
	.window video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		/* While closed the film is shrunk to about the arch's size (--k), so the arch
		   shows most of the picture rather than a tight crop of its middle; it grows
		   to full screen as the arch opens. Scaled about the arch's own centre. */
		transform-origin: 50% calc(50% + var(--wy));
		scale: calc(var(--k) + (1 - var(--k)) * var(--door-o));
	}
	/* The room clip is sized to the arch's own box at every step (the clip-path's
	   inner rectangle), so it always exactly fills the opening and is shown near
	   its native size — not a crop of a full-screen frame. It is gone by o≈0.42,
	   so animating its box costs layout only for that short stretch. */
	.window .room {
		inset: auto;
		left: 50%;
		top: calc(50% + var(--wy) * (1 - var(--door-o)));
		width: calc(var(--ww) + (100% - var(--ww)) * var(--door-o));
		height: calc(var(--wh) + (100% - var(--wh)) * var(--door-o));
		translate: -50% -50%;
		scale: 1;
		object-position: 50% 30%;
	}
	.scrim {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgb(0 0 0 / 0.8), rgb(0 0 0 / 0.4) 26%, rgb(0 0 0 / 0) 54%);
		opacity: var(--door-x);
		pointer-events: none;
	}
	/* A gold threshold under the closed arch, the template's gold rule. */
	.sill {
		position: absolute;
		left: 50%;
		top: calc(50% + var(--wh) / 2 + var(--wy));
		width: calc(var(--ww) + 48px);
		height: 2px;
		translate: -50% 0;
		background: linear-gradient(90deg, transparent, var(--accent) 12%, var(--accent) 88%, transparent);
		opacity: calc(0.9 - var(--door-o) * 3);
	}

	/* ---- heading ---- */
	.intro {
		position: absolute;
		left: clamp(24px, 6vw, 96px);
		top: calc(50% - var(--wh) / 2 + var(--wy));
		width: min(24vw, 360px);
		opacity: calc(1 - var(--door-o) * 2.4);
		translate: calc(var(--door-o) * -6vw) 0;
	}
	/* The heading is the type moment here, in the face of each house's own menu
	   headings: Gang of Three for Asia, the 1970s display serif for Fusion. */
	.intro h2 {
		font-family: var(--brand);
		font-weight: 400;
		font-size: clamp(2.2rem, 4.6vw, 4rem);
		line-height: 1.04;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		margin: 0 0 22px;
		color: var(--ink);
	}
	.door[data-brand='fusion'] .intro h2 {
		font-size: clamp(2.2rem, 4.4vw, 3.8rem);
		line-height: 1.02;
		letter-spacing: 0;
	}

	/* ---- the sign beside the door ---- */
	.mark {
		position: absolute;
		left: calc(50% + var(--ww) / 2 + clamp(26px, 3.4vw, 56px));
		top: calc(50% - var(--wh) / 2 + var(--wy) - 6px);
		margin: 0;
		opacity: calc(1 - var(--door-o) * 2.6);
		translate: calc(var(--door-o) * 8vw) 0;
		pointer-events: none;
		font-family: var(--brand);
		text-transform: uppercase;
		white-space: nowrap;
	}
	/* Asia: letters stacked upright like a hanging sign, in outline and lit pink —
	   the logo's neon-tube drawing of this face, in the colour of the room's sign */
	.sign {
		writing-mode: vertical-rl;
		text-orientation: upright;
		/* seven letters, each stepping 1.125em down (the face's own vertical advance) */
		font-size: min(5.6vw, calc(var(--wh) / 8.2), 84px);
		line-height: 1;
		letter-spacing: 0.02em;
		color: transparent;
		-webkit-text-stroke: 2px #ff9db2;
		paint-order: stroke;
		filter: drop-shadow(0 0 8px rgb(255 122 148 / 0.75)) drop-shadow(0 0 28px rgb(239 60 92 / 0.5));
	}
	/* Fusion: a line reading up the wall */
	.wall {
		writing-mode: vertical-rl;
		rotate: 180deg;
		font-size: min(4.3vw, calc(var(--wh) / 9.4), 64px);
		line-height: 1;
		color: var(--accent);
	}
	.intro p {
		font-family: var(--body);
		font-weight: 300;
		font-size: 1.02rem;
		line-height: 1.75;
		color: var(--muted);
		margin: 0;
		max-width: 30ch;
		text-wrap: pretty;
	}
	/* the gallery is one tap away before the arch has opened, too */
	.intro .btn {
		margin-top: 26px;
	}
	.btn.small {
		padding: 11px 20px;
		font-size: 0.68rem;
	}

	/* ---- the plates ---- */
	.plate {
		position: absolute;
		margin: 0;
		opacity: calc(1 - var(--door-o) * 1.8);
		z-index: 1;
	}
	.plate img {
		display: block;
		width: 100%;
		/* imgAttrs sets the intrinsic width/height attributes; without this the
		   height attribute wins over aspect-ratio */
		height: auto;
		aspect-ratio: 4 / 5;
		object-fit: cover;
		box-shadow: 0 18px 40px rgb(0 0 0 / 0.45);
	}
	.plate figcaption {
		font-family: var(--body);
		font-size: 0.82rem;
		letter-spacing: 0.04em;
		color: var(--muted);
		margin-top: 10px;
	}
	/* The plates sit close in to the arch (owner: the wide gaps looked empty):
	   the left one stands on the arch's foot just off its left side, the right one
	   beside the "Every craving" line. */
	.plate-a {
		right: calc(50% + var(--ww) / 2 + clamp(28px, 3vw, 56px));
		top: calc(50% + var(--wh) / 2 + var(--wy));
		width: min(15vw, 30vh, 270px);
		translate: calc(var(--door-o) * -10vw) -100%;
	}
	.plate-b {
		left: calc(50% + var(--ww) / 2 + clamp(110px, 9vw, 160px));
		top: calc(50% - var(--wh) / 2 + var(--wy) + 6vh);
		width: min(19vw, 40vh, 340px);
		translate: calc(var(--door-o) * 10vw) 0;
	}

	/* ---- once open ---- */
	.outro {
		position: absolute;
		left: clamp(24px, 6vw, 96px);
		bottom: clamp(48px, 11vh, 110px);
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		opacity: var(--door-x);
		translate: 0 calc((1 - var(--door-x)) * 18px);
	}
	.over {
		flex: 0 0 100%;
		margin: 0 0 clamp(10px, 2vh, 20px);
		font-family: var(--brand);
		font-size: clamp(2.2rem, 6vw, 5.6rem);
		line-height: 1;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: #fff;
		text-shadow: 0 2px 36px rgb(0 0 0 / 0.6);
	}
	.door[data-brand='fusion'] .over {
		letter-spacing: 0;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		padding: 14px 26px;
		border: 1px solid var(--action);
		color: var(--ink);
		background: rgb(8 8 11 / 0.62);
		font-family: var(--body);
		font-size: 0.72rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		text-decoration: none;
		transition:
			background-color 0.35s ease,
			border-color 0.35s ease;
	}
	.btn.solid {
		background: var(--action);
	}
	.btn:hover,
	.btn:focus-visible {
		background: var(--action-2);
		border-color: var(--action-2);
	}
	.btn:focus-visible,
	.pause:focus-visible {
		outline: 2px solid var(--ink);
		outline-offset: 3px;
	}

	.pause {
		position: absolute;
		right: clamp(16px, 2vw, 28px);
		top: calc(var(--nav) + clamp(14px, 2vw, 24px));
		width: 38px;
		height: 38px;
		border-radius: 50%;
		border: 1px solid rgb(255 255 255 / 0.35);
		background: rgb(0 0 0 / 0.35);
		color: #fff;
		display: grid;
		place-items: center;
		cursor: pointer;
		opacity: var(--door-x);
	}
	.pause svg {
		width: 13px;
		height: 13px;
		fill: currentColor;
	}

	/* Short laptop screens: less travel, a slightly smaller arch. */
	@media (max-height: 760px) and (min-width: 761px) {
		.door {
			--wh: min(60vh, 560px);
			height: 200vh;
		}
	}
	/* …where the big heading, its lede and the gallery button would otherwise run
	   down into the plate below them: a size smaller, and a smaller plate. */
	@media (max-height: 820px) and (min-width: 761px) {
		.intro h2,
		.door[data-brand='fusion'] .intro h2 {
			font-size: clamp(2rem, 4vw, 3.2rem);
			margin-bottom: 14px;
		}
		.intro p {
			font-size: 0.95rem;
			line-height: 1.6;
		}
		.intro .btn {
			margin-top: 16px;
		}
		.plate-a {
			width: min(13vw, 26vh, 200px);
		}
	}

	/* ---- phones ----
	   Heading on top, the arch under it, two plates overlapping its lower corners.

	   A phone browser's toolbars slide away as you scroll down and come back as you
	   scroll up, so "one screen" has two heights. The STAGE is the tall one (lvh):
	   the film then reaches the bottom of the glass with the toolbars away, instead
	   of stopping a toolbar's height short over a band of flat colour. Everything
	   you read or tap is laid out inside the SHORT one (--sh = 100svh), which is on
	   screen in both states — so nothing is ever under a toolbar, and nothing moves
	   when they come and go. Where the two are equal this is the same layout.

	   The arch is hung from fixed edges rather than centred: its top sits just under
	   the intro (--it, measured in script), its foot stays --ab above the bottom,
	   where the two plates overlap it. --wh and --wy are derived from those, so the
	   base rules that speak of "half the arch's height" still agree. */
	@media (max-width: 760px) {
		.door {
			--nav: 62px;
			--ww: 58vw;
			--sh: 100vh;
			--it: 180px; /* until the script has measured the intro */
			--at: calc(var(--it) + 28px); /* the arch's top */
			--ab: calc(var(--sh) * 0.24); /* clear beneath its foot */
			--wh: max(160px, calc(var(--sh) - var(--at) - var(--ab)));
			--wy: calc((var(--at) - var(--ab)) / 2);
			/* a plate's width — narrower on a short screen, so the pair don't swallow
			   the arch */
			--pw: min(36vw, calc(var(--sh) * 0.18));
			/* how far the right-hand plate hangs below the stage's short-screen foot,
			   and so the height the sign has between the arch's top and that plate
			   (the plate is 4:5 with a caption of up to two lines) */
			--pb: max(78px, calc(var(--ab) - 73px));
			--mh: calc(var(--sh) - var(--pb) - var(--pw) * 1.25 - 56px - var(--at));
			--k: 0.62; /* the arch is 58vw wide, and never 62% of the stage's height */
			/* one screen to enter, 0.8 of one pinned, one to leave */
			height: 180vh;
		}
		@supports (height: 100svh) {
			.door {
				--sh: 100svh;
			}
		}
		/* The hero's own buttons sit in its last 140px on a phone — a melt that tall
		   lays its dark end over them. Half the height stays clear of them. */
		.door::before {
			top: -64px;
			height: 64px;
		}
		.stage {
			height: 100vh;
			height: 100lvh;
		}
		.window {
			--t: calc(var(--at) * (1 - var(--door-o)));
			--b: calc((100% - var(--at) - var(--wh)) * (1 - var(--door-o)));
		}
		.window video {
			transform-origin: 50% calc(var(--at) + var(--wh) / 2);
		}
		/* the opening's own centre at every step: the arch's when closed, the
		   stage's when open */
		.window .room {
			top: calc((var(--at) + var(--wh) / 2) * (1 - var(--door-o)) + 50% * var(--door-o));
		}
		/* The heading sits lower over the film here than on a wide screen, across the
		   dish itself: more shade behind it, and the foot of the film runs out into
		   the next section's ground instead of ending on a line. */
		.scrim {
			background: linear-gradient(
				to top,
				var(--bg),
				rgb(0 0 0 / 0.66) 14%,
				rgb(0 0 0 / 0.5) 36%,
				rgb(0 0 0 / 0) 62%
			);
		}
		.intro {
			left: 20px;
			right: 20px;
			width: auto;
			top: 84px;
			/* the arch rises through this block as it opens: be gone before it arrives */
			opacity: calc(1 - var(--door-o) * 7);
		}
		.intro h2,
		.door[data-brand='fusion'] .intro h2 {
			font-size: clamp(1.7rem, 8.4vw, 2.3rem);
			margin: 0 0 8px;
		}
		/* the sign stands in the gap between the arch and the right-hand edge */
		.mark {
			left: auto;
			right: 14px;
			top: calc(var(--at) + 6px);
		}
		/* …and must end above the plate that overlaps the arch's lower corner: no
		   more than ~60% of the arch's height, and never longer than the room it
		   has (--mh; the sign runs 8em, the wall line 9.1em) — on a tall phone the
		   arch grows faster than that room does */
		.sign {
			font-size: min(9vw, calc(var(--wh) / 13.2), calc(var(--mh) / 8));
			-webkit-text-stroke-width: 1.25px;
		}
		.wall {
			font-size: min(6.4vw, calc(var(--wh) / 15.6), calc(var(--mh) / 9.1));
		}
		.intro p {
			font-size: 0.92rem;
			line-height: 1.6;
		}
		.intro .btn {
			margin-top: 12px;
			padding: 9px 16px;
		}
		.sill {
			top: calc(var(--at) + var(--wh));
			width: calc(var(--ww) + 32px);
		}
		/* The plates hang off the arch's foot — the left one 103px past it, the right
		   73px — at every screen height, not at a fixed distance from the top.
		   Bottoms are measured from the short screen's foot (100% − --sh is the strip
		   a toolbar may cover). They are over the arch from the start, so they clear
		   early as it opens. */
		.plate {
			opacity: calc(1 - var(--door-o) * 3.2);
		}
		.plate-a,
		.plate-b {
			top: auto;
			width: var(--pw);
		}
		.plate-a {
			left: 14px;
			right: auto;
			translate: calc(var(--door-o) * -10vw) 0;
			bottom: calc(100% - var(--sh) + max(16px, var(--ab) - 103px));
		}
		/* the right-hand one ends above the Ask Geisha button (the bottom 66px of
		   that corner), caption and all */
		.plate-b {
			left: auto;
			right: 14px;
			bottom: calc(100% - var(--sh) + var(--pb));
		}
		/* "Lanterns and blossom" on one line under the narrowest plate */
		.plate figcaption {
			font-size: 0.74rem;
			letter-spacing: 0.02em;
			margin-top: 6px;
			text-wrap: balance;
		}
		/* Full width: the block ends above the Ask Geisha button, so it needn't also
		   step in from it. On a first visit it stands on the cookie notice instead. */
		.outro {
			left: 20px;
			right: 20px;
			bottom: calc(100% - var(--sh) + max(88px, var(--cb-h, 0px) + 16px));
			flex-direction: column;
			align-items: stretch;
		}
		.over {
			flex: none;
			font-size: clamp(1.9rem, 9.4vw, 2.6rem);
			margin-bottom: 6px;
		}
		.btn {
			justify-content: center;
			padding: 14px 18px;
			letter-spacing: 0.16em;
		}
		.pause {
			width: 44px;
			height: 44px;
		}
	}

	/* Reduced motion: no pin, no opening — just the film in a screen-high frame. */
	.door.still {
		height: auto;
	}
	.door.still .stage {
		position: relative;
	}
</style>
