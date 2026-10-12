<script lang="ts">
	// THE ROOM — Geisha Fusion's interiors, on the home page.
	//
	// Three columns: the copy on the left, the Interiors film standing tall in the
	// middle, and on the right a living wall of the room — two columns of photos
	// and short clips drifting endlessly in opposite directions. As the section
	// arrives the film opens out of a slit, the caption rises word by word and the
	// wall slides up into place; while you scroll, the three layers move at
	// different speeds. A huge outlined INTERIORS drifts behind it all.
	// Phone: copy, then the film, then the wall as a sideways strip.
	// Reduced motion: everything shown, nothing drifts.
	import { inviewVideo, scrollProgress } from '$lib/data/showcase';

	let {
		eyebrow = 'The Room',
		line = 'Colour on every wall. A room with the volume up.',
		bookingUrl = '/fusion/bookings'
	}: { eyebrow?: string; line?: string; bookingUrl?: string } = $props();

	const words = $derived(line.replace(/[*_]/g, '').trim().split(/\s+/));

	type Tile = { kind: 'img' | 'clip'; src: string; poster?: string; alt: string };
	const IMG = '/images/interiors';
	const CLIP = '/videos/interiors';
	const COL_A: Tile[] = [
		{ kind: 'img', src: `${IMG}/mural-canopy.webp`, alt: 'Blossom canopy over the booths, beside the face mural' },
		{ kind: 'clip', src: `${CLIP}/clip-1.mp4`, poster: `${CLIP}/clip-1.webp`, alt: '' },
		{ kind: 'img', src: `${IMG}/lantern-hall.webp`, alt: 'Painted paper lanterns over the dining room' },
		{ kind: 'img', src: `${IMG}/dining-room.webp`, alt: 'Lantern-lit dining room with blossom trees' }
	];
	const COL_B: Tile[] = [
		{ kind: 'img', src: `${IMG}/lantern-canopy.webp`, alt: 'Hanging flowers and lanterns above the tables' },
		{ kind: 'clip', src: `${CLIP}/clip-2.mp4`, poster: `${CLIP}/clip-2.webp`, alt: '' },
		{ kind: 'img', src: `${IMG}/mural-face.webp`, alt: 'Street-art face mural under the lanterns' },
		{ kind: 'clip', src: `${CLIP}/clip-3.mp4`, poster: `${CLIP}/clip-3.webp`, alt: '' },
		{ kind: 'img', src: `${IMG}/blossom-interior.webp`, alt: 'Blossom trees and lanterns in the restaurant' }
	];

	const FEATURES = ['Lantern-lit ceilings', 'Blossom canopy', 'Street-art murals'];

	let sp = $state(0.5); // scroll progress through the section
	let seen = $state(false);

	function arrive(node: HTMLElement) {
		const io = new IntersectionObserver(
			([e]) => {
				if (e.isIntersecting) {
					seen = true;
					io.disconnect();
				}
			},
			{ threshold: 0.2 }
		);
		io.observe(node);
		return { destroy: () => io.disconnect() };
	}
</script>

{#snippet tile(t: Tile)}
	<figure class="tile">
		{#if t.kind === 'img'}
			<img src={t.src} alt={t.alt} decoding="async" fetchpriority="low" />
		{:else}
			<video
				use:inviewVideo={{ fetchAt: '30% 0px' }}
				data-src={t.src}
				data-poster={t.poster}
				muted
				loop
				playsinline
				preload="none"
			></video>
		{/if}
	</figure>
{/snippet}

<section
	class="rooms"
	class:seen
	aria-label={eyebrow}
	use:arrive
	use:scrollProgress={{ mode: 'through', onprogress: (v) => (sp = v) }}
	style="--sp:{sp}"
>
	<div class="ghost" aria-hidden="true"><span>Interiors · Interiors · Interiors · </span></div>

	<div class="grid">
		<div class="copy">
			<span class="eyebrow"><span class="rule"></span>{eyebrow}</span>
			<p class="line">
				{#each words as w, i}<span class="w"><span class="wi" style="--i:{i}">{w}</span></span>{' '}{/each}
			</p>
			<ul class="features">
				{#each FEATURES as f, i}
					<li style="--i:{i}"><span class="num">0{i + 1}</span>{f}</li>
				{/each}
			</ul>
			<div class="actions">
				<a class="btn btn-solid" href={bookingUrl}>Book a Table</a>
				<a class="link" href="/fusion/parties">Private parties <span aria-hidden="true">→</span></a>
			</div>
		</div>

		<figure class="feature">
			<video
				use:inviewVideo={{ fetchAt: '50% 0px' }}
				data-src="/videos/interiors.mp4"
				data-poster="/videos/interiors-poster.webp"
				muted
				loop
				playsinline
				preload="none"
				aria-label="A walk through the Geisha Fusion dining room: lanterns, blossom trees and street-art murals"
			></video>
			<figcaption class="tag"><span class="live"></span>Inside Geisha Fusion</figcaption>
		</figure>

		<div class="wall">
			<div class="col a">
				<div class="track">
					{#each [...COL_A, ...COL_A] as t}{@render tile(t)}{/each}
				</div>
			</div>
			<div class="col b">
				<div class="track">
					{#each [...COL_B, ...COL_B] as t}{@render tile(t)}{/each}
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	.rooms {
		--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
		--h: min(80vh, 760px);
		position: relative;
		overflow: hidden;
		background:
			radial-gradient(ellipse 60% 50% at 50% 50%, rgba(221, 130, 54, 0.1), transparent 70%),
			radial-gradient(ellipse 40% 40% at 85% 20%, rgba(217, 46, 34, 0.08), transparent 70%),
			#0a0d0b;
		color: #f2ece0;
		padding: clamp(80px, 11vh, 130px) 0;
	}

	/* ---- giant outlined word drifting behind ---- */
	.ghost {
		position: absolute;
		top: 50%;
		left: 0;
		white-space: nowrap;
		pointer-events: none;
		transform: translate3d(calc(var(--sp) * -40%), -50%, 0);
	}
	.ghost span {
		display: inline-block;
		font-family: 'Shippori Mincho', Georgia, serif;
		font-weight: 700;
		font-size: clamp(8rem, 24vw, 24rem);
		line-height: 1;
		text-transform: uppercase;
		color: transparent;
		-webkit-text-stroke: 1px rgba(221, 130, 54, 0.14);
	}

	.grid {
		position: relative;
		z-index: 1;
		max-width: 1400px;
		margin: 0 auto;
		padding: 0 32px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		gap: clamp(28px, 3.6vw, 56px);
		align-items: center;
	}

	/* ---- copy ---- */
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 14px;
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 0.72rem;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: #dd8236;
	}
	.rule {
		height: 1px;
		width: 0;
		background: currentColor;
		transition: width 1s var(--ease-out) 0.2s;
	}
	.seen .rule {
		width: 48px;
	}
	.line {
		margin: 22px 0 0;
		font-family: 'Shippori Mincho', Georgia, serif;
		font-style: italic;
		font-weight: 500;
		font-size: clamp(2rem, 3.4vw, 3.5rem);
		line-height: 1.08;
	}
	.w {
		display: inline-block;
		overflow: hidden;
		vertical-align: top;
		padding-bottom: 0.1em;
		margin-bottom: -0.1em;
	}
	.wi {
		display: inline-block;
		transform: translate3d(0, 110%, 0) rotate(6deg);
		transform-origin: left bottom;
		transition: transform 1.1s var(--ease-out) calc(0.15s + var(--i) * 0.07s);
	}
	.seen .wi {
		transform: none;
	}
	.features {
		list-style: none;
		margin: 34px 0 0;
		padding: 0;
		border-top: 1px solid rgba(221, 130, 54, 0.2);
	}
	.features li {
		display: flex;
		align-items: baseline;
		gap: 16px;
		padding: 14px 0;
		border-bottom: 1px solid rgba(221, 130, 54, 0.2);
		font-family: 'Jost', system-ui, sans-serif;
		font-weight: 300;
		font-size: 1rem;
		color: #cfd7d2;
		opacity: 0;
		transform: translateX(-24px);
		transition:
			opacity 0.8s ease calc(0.6s + var(--i) * 0.12s),
			transform 0.9s var(--ease-out) calc(0.6s + var(--i) * 0.12s);
	}
	.seen .features li {
		opacity: 1;
		transform: none;
	}
	.num {
		font-size: 0.7rem;
		letter-spacing: 0.2em;
		color: #dd8236;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 22px;
		margin-top: 34px;
		opacity: 0;
		transform: translateY(16px);
		transition:
			opacity 0.8s ease 1s,
			transform 0.9s var(--ease-out) 1s;
	}
	.seen .actions {
		opacity: 1;
		transform: none;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		padding: 15px 28px;
		border-radius: 999px;
		background: #d92e22;
		color: #fff;
		text-decoration: none;
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 0.74rem;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		transition:
			background 0.3s ease,
			translate 0.25s ease;
	}
	.btn:hover,
	.btn:focus-visible {
		background: #dd8236;
	}
	.link {
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 0.74rem;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		color: #f2ece0;
		text-decoration: none;
		border-bottom: 1px solid rgba(242, 236, 224, 0.35);
		padding-bottom: 4px;
	}
	.link span {
		display: inline-block;
		transition: transform 0.3s ease;
	}
	.link:hover span {
		transform: translateX(5px);
	}

	/* ---- the film, centre stage ---- */
	.feature {
		position: relative;
		margin: 0;
		height: var(--h);
		aspect-ratio: 9 / 16;
		border-radius: 22px;
		overflow: hidden;
		background: #050706;
		box-shadow:
			0 60px 120px -40px rgba(0, 0, 0, 0.9),
			0 0 0 1px rgba(221, 130, 54, 0.3);
		clip-path: inset(48% 0 48% 0 round 22px);
		transform: translate3d(0, calc((0.5 - var(--sp)) * 50px), 0);
		transition: clip-path 1.5s cubic-bezier(0.65, 0, 0.35, 1) 0.1s;
	}
	.seen .feature {
		clip-path: inset(0 0 0 0 round 22px);
	}
	.feature video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transform: scale(1.25);
		transition: transform 2.4s var(--ease-out) 0.1s;
	}
	.seen .feature video {
		transform: scale(1.02);
	}
	.tag {
		position: absolute;
		left: 16px;
		top: 16px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 13px;
		border-radius: 999px;
		background: rgba(10, 13, 11, 0.45);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(242, 236, 224, 0.22);
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 10px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
	}
	.live {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #d92e22;
		animation: pulse 2s ease-out infinite;
	}
	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(217, 46, 34, 0.6);
		}
		80%,
		100% {
			box-shadow: 0 0 0 9px rgba(217, 46, 34, 0);
		}
	}

	/* ---- the living wall ---- */
	.wall {
		height: var(--h);
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
		-webkit-mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent);
		mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent);
	}
	.col {
		overflow: hidden;
		opacity: 0;
		transition:
			opacity 1s ease,
			translate 1.4s var(--ease-out);
	}
	.col.a {
		translate: 0 80px;
		transition-delay: 0.35s;
	}
	.col.b {
		translate: 0 -80px;
		transition-delay: 0.5s;
	}
	.seen .col {
		opacity: 1;
		translate: 0 0;
	}
	.track {
		display: flex;
		flex-direction: column;
		gap: 14px;
		animation: drift 46s linear infinite;
	}
	.col.a .track {
		transform: translateY(calc(var(--sp) * -60px));
	}
	.col.b .track {
		animation-direction: reverse;
		animation-duration: 54s;
	}
	.wall:hover .track {
		animation-play-state: paused;
	}
	@keyframes drift {
		from {
			translate: 0 0;
		}
		to {
			translate: 0 calc(-50% - 7px);
		}
	}
	.tile {
		margin: 0;
		border-radius: 14px;
		overflow: hidden;
		aspect-ratio: 9 / 15;
		background: #121a16;
		flex-shrink: 0;
	}
	.tile img,
	.tile video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition:
			transform 0.9s var(--ease-out),
			filter 0.6s ease;
		filter: saturate(0.9) brightness(0.88);
	}
	.tile:hover img,
	.tile:hover video {
		transform: scale(1.06);
		filter: saturate(1.1) brightness(1);
	}

	/* ---- tablet: copy on top, film + wall side by side ---- */
	@media (max-width: 1100px) {
		.grid {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.copy {
			grid-column: 1 / -1;
			max-width: 640px;
		}
		.rooms {
			--h: min(72vh, 640px);
		}
	}

	/* ---- phone: copy, film, then the wall as a sideways strip ---- */
	@media (max-width: 700px) {
		.rooms {
			padding: 72px 0;
		}
		.grid {
			grid-template-columns: 1fr;
			padding: 0 20px;
			gap: 36px;
		}
		.feature {
			height: auto;
			width: 100%;
			aspect-ratio: 4 / 5;
		}
		.wall {
			height: auto;
			display: block;
			margin: 0 -20px;
			-webkit-mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
			mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
		}
		.col.b {
			display: none;
		}
		.col.a .track {
			flex-direction: row;
			width: max-content;
			transform: none;
			animation-name: drift-x;
			animation-duration: 40s;
		}
		.tile {
			width: 42vw;
		}
		@keyframes drift-x {
			from {
				translate: 0 0;
			}
			to {
				translate: calc(-50% - 7px) 0;
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.track {
			animation: none;
		}
		.feature,
		.feature video,
		.wi,
		.features li,
		.actions,
		.col {
			transition: none;
		}
	}
</style>
