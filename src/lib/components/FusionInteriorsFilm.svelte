<script lang="ts">
	// INTERIORS FILM — replaces the "Colour on every wall" still band on /fusion.
	//
	// A pinned stage: the portrait room film opens out of a thin slit in the middle
	// of the screen, grows to full height and glides to the right while the caption
	// writes itself in word by word on the left, over a blurred, darkened copy of
	// the same film. A giant outlined "INTERIORS" drifts behind it all. Everything
	// follows the scroll position (stop scrolling and it holds), in the spirit of
	// thealchemistbars.com's scroll-scrubbed panels.
	//
	// Phone: the film is already the screen's shape, so it simply opens out to full
	// bleed and the caption rises over a scrim at the bottom.
	// Reduced motion: no pin, shown open, nothing moves (the film stays on its still).
	import { onMount } from 'svelte';
	import { inviewVideo, scrollProgress, span } from '$lib/data/showcase';

	let {
		eyebrow = 'The Room',
		line = 'Colour on every wall. A room with the volume up.'
	}: { eyebrow?: string; line?: string } = $props();

	// The caption arrives as RichText markdown ("*…*" = italic) — the whole line is
	// set in italic here, so just drop the markers and split into words.
	const words = $derived(line.replace(/[*_]/g, '').trim().split(/\s+/));

	let p = $state(0);
	let still = $state(false);
	let film: HTMLVideoElement | undefined = $state();
	let progress = $state(0); // playback position of the film, for the hairline

	onMount(() => {
		still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (still) p = 1;
	});

	// Phases of the pin (0→1):
	//   0.00–0.30  slit opens into a window, window grows
	//   0.18–0.55  backdrop fades up, window glides right (desktop)
	//   0.32–0.70  caption words rise in, one after another
	const open = $derived(span(p, 0, 0.3));
	const grow = $derived(span(p, 0.05, 0.45));
	const glide = $derived(span(p, 0.2, 0.55));
	const back = $derived(span(p, 0.15, 0.5));
	const write = $derived(Math.min(1, Math.max(0, (p - 0.3) / 0.38)));

	function onTime() {
		if (film && film.duration) progress = film.currentTime / film.duration;
	}
</script>

<section
	class="film"
	class:still
	aria-label={eyebrow}
	use:scrollProgress={{ mode: 'pin', onprogress: (v) => (still ? null : (p = v)) }}
	style="--open:{open};--grow:{grow};--glide:{glide};--back:{back};--p:{p}"
>
	<div class="stage">
		<!-- blurred copy of the film as the room's ambient light -->
		<div class="ambient" aria-hidden="true">
			<video
				use:inviewVideo={{ fetchAt: '60%' }}
				data-src="/videos/interiors-blur.mp4"
				data-poster="/videos/interiors-poster.webp"
				muted
				loop
				playsinline
				preload="none"
			></video>
		</div>

		<div class="ghost" aria-hidden="true">Interiors</div>

		<div class="caption">
			<span class="eyebrow">
				<span class="rule"></span>{eyebrow}
			</span>
			<p class="line">
				{#each words as w, i}
					<span class="w"
						><span
							class="wi"
							style="--k:{Math.min(1, Math.max(0, write * (words.length + 3) - i))}">{w}</span
						></span
					>{' '}
				{/each}
			</p>
			<span class="meta">Geisha Fusion &middot; Benton</span>
		</div>

		<figure class="window">
			<video
				bind:this={film}
				use:inviewVideo={{ fetchAt: '60%' }}
				data-src="/videos/interiors.mp4"
				data-poster="/videos/interiors-poster.webp"
				muted
				loop
				playsinline
				preload="none"
				ontimeupdate={onTime}
				aria-label="A walk through the Geisha Fusion dining room: lanterns, blossom trees and street-art murals"
			></video>
			<span class="scan" style="--t:{progress}" aria-hidden="true"></span>
			<figcaption class="tag">Inside Geisha Fusion</figcaption>
		</figure>
	</div>
</section>

<style>
	.film {
		--gutter: max(32px, calc((100vw - 1240px) / 2 + 32px));
		position: relative;
		height: 260vh;
		background: var(--ink, #0a0d0b);
		color: var(--ivory, #f2ece0);
	}
	.stage {
		position: sticky;
		top: 0;
		height: 100vh;
		height: 100svh;
		overflow: hidden;
		isolation: isolate;
	}

	/* ---- ambient backdrop ---- */
	.ambient {
		position: absolute;
		inset: -6%;
		opacity: calc(var(--back) * 0.9);
		z-index: 0;
	}
	.ambient video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: blur(34px) saturate(1.25) brightness(0.42);
		transform: scale(calc(1.25 - var(--back) * 0.1));
	}
	.ambient::after {
		content: '';
		position: absolute;
		inset: 0;
		background:
			radial-gradient(ellipse at 72% 50%, transparent 0%, rgba(10, 13, 11, 0.55) 70%),
			linear-gradient(90deg, rgba(10, 13, 11, 0.85) 0%, rgba(10, 13, 11, 0.25) 55%, transparent 100%);
	}

	/* ---- giant outlined word drifting behind ---- */
	.ghost {
		position: absolute;
		top: 50%;
		left: 0;
		z-index: 1;
		white-space: nowrap;
		font-family: var(--display, 'Shippori Mincho', Georgia, serif);
		font-weight: 600;
		font-size: clamp(7rem, 22vw, 22rem);
		line-height: 1;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: transparent;
		-webkit-text-stroke: 1px rgba(221, 130, 54, 0.28);
		transform: translate3d(calc(30vw - var(--p) * 70vw), -50%, 0);
		opacity: calc(0.25 + var(--open) * 0.75);
		pointer-events: none;
		user-select: none;
	}

	/* ---- the film window ---- */
	.window {
		position: absolute;
		z-index: 3;
		margin: 0;
		/* centred in the space under the 70px nav bar, not the whole screen */
		top: calc(50% + 34px);
		left: 50%;
		height: 80vh;
		height: calc(100svh - 150px);
		aspect-ratio: 9 / 16;
		border-radius: 18px;
		overflow: hidden;
		background: #050706;
		box-shadow:
			0 40px 120px -30px rgba(0, 0, 0, 0.85),
			0 0 0 1px rgba(221, 130, 54, calc(var(--grow) * 0.35));
		transform: translate3d(calc(-50% + var(--glide) * 19vw), -50%, 0)
			scale(calc(0.56 + var(--grow) * 0.44));
		clip-path: inset(calc((1 - var(--open)) * 49%) 0 calc((1 - var(--open)) * 49%) 0 round 18px);
		will-change: transform, clip-path;
	}
	.window video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transform: scale(calc(1.22 - var(--grow) * 0.22));
	}
	/* hairline that tracks the film's playback, along the bottom edge */
	.scan {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		width: 100%;
		background: linear-gradient(90deg, var(--gold, #dd8236), var(--gold-bright, #f79a4a));
		transform-origin: left;
		transform: scaleX(var(--t));
		opacity: 0.85;
	}
	.tag {
		position: absolute;
		left: 18px;
		top: 18px;
		font-family: var(--body-f, 'Jost', system-ui, sans-serif);
		font-size: 10px;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: rgba(242, 236, 224, 0.85);
		padding: 7px 12px;
		border: 1px solid rgba(242, 236, 224, 0.25);
		border-radius: 999px;
		backdrop-filter: blur(6px);
		background: rgba(10, 13, 11, 0.25);
		opacity: var(--grow);
	}

	/* ---- caption ---- */
	.caption {
		position: absolute;
		z-index: 4;
		left: var(--gutter);
		top: calc(50% + 34px);
		transform: translateY(-50%);
		width: min(40vw, 560px);
	}
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 14px;
		font-family: var(--body-f, 'Jost', system-ui, sans-serif);
		font-size: 0.72rem;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--gold, #dd8236);
		opacity: var(--back);
		transform: translateY(calc((1 - var(--back)) * 20px));
	}
	.rule {
		display: inline-block;
		height: 1px;
		width: calc(var(--back) * 56px);
		background: currentColor;
	}
	.line {
		margin: 22px 0 0;
		font-family: var(--display, 'Shippori Mincho', Georgia, serif);
		font-style: italic;
		font-weight: 500;
		font-size: clamp(2rem, 4.2vw, 4.1rem);
		line-height: 1.08;
		letter-spacing: -0.005em;
		color: var(--ivory, #f2ece0);
	}
	.w {
		display: inline-block;
		overflow: hidden;
		vertical-align: top;
		padding-bottom: 0.08em;
	}
	.wi {
		display: inline-block;
		transform: translate3d(0, calc((1 - var(--k)) * 105%), 0) rotate(calc((1 - var(--k)) * 6deg));
		opacity: calc(0.15 + var(--k) * 0.85);
		transform-origin: left bottom;
	}
	.meta {
		display: block;
		margin-top: 30px;
		font-family: var(--body-f, 'Jost', system-ui, sans-serif);
		font-size: 0.72rem;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		color: var(--muted, #9fb0a8);
		opacity: calc(max(0, var(--p) - 0.6) * 2.5);
	}

	/* ---- tablet / phone: the film is the screen ---- */
	@media (max-width: 900px) {
		.film {
			height: 220vh;
		}
		.ambient,
		.ghost {
			display: none;
		}
		.window {
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			aspect-ratio: auto;
			border-radius: 0;
			transform: scale(calc(0.62 + var(--grow) * 0.38));
			clip-path: inset(
				calc((1 - var(--open)) * 45%) calc((1 - var(--grow)) * 6%) calc((1 - var(--open)) * 45%)
					calc((1 - var(--grow)) * 6%) round calc((1 - var(--grow)) * 22px)
			);
		}
		.window::after {
			content: '';
			position: absolute;
			inset: 0;
			background: linear-gradient(
				0deg,
				rgba(10, 13, 11, 0.94) 0%,
				rgba(10, 13, 11, 0.6) 30%,
				rgba(10, 13, 11, 0) 55%,
				rgba(10, 13, 11, 0.35) 100%
			);
			opacity: var(--back);
		}
		.tag {
			top: 84px;
			left: 20px;
		}
		.caption {
			left: 20px;
			right: 20px;
			top: auto;
			bottom: 40px;
			transform: none;
			width: auto;
		}
		.line {
			font-size: clamp(1.9rem, 8.4vw, 2.6rem);
		}
		.meta {
			margin-top: 20px;
		}
	}

	/* ---- reduced motion: no pin, shown open ---- */
	.still {
		height: auto;
	}
	.still .stage {
		position: relative;
	}
	@media (prefers-reduced-motion: reduce) {
		.ghost {
			transform: translate3d(-10vw, -50%, 0);
		}
	}
</style>
