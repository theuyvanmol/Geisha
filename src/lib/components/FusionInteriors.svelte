<script lang="ts">
	// THE ROOM — Geisha Fusion's interiors, on the home page.
	//
	// Three columns: the copy on the left, the Interiors film standing tall in the
	// middle, and on the right a still gallery of the room — a four-picture mosaic
	// (one of them a short looping clip). As the section arrives the film opens out
	// of a slit, the caption rises word by word and the gallery tiles fade up one
	// after another. The gallery itself never scrolls or drifts (owner feedback).
	// Phone: copy, then the film, then the mosaic.
	// Reduced motion: everything shown, nothing moves.
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
		{ kind: 'clip', src: `${CLIP}/clip-2.mp4`, poster: `${CLIP}/clip-2.webp`, alt: '' }
	];
	const COL_B: Tile[] = [
		{ kind: 'img', src: `${IMG}/lantern-hall.webp`, alt: 'Painted paper lanterns over the dining room' },
		{ kind: 'img', src: `${IMG}/dining-room.webp`, alt: 'Lantern-lit dining room with blossom trees' }
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
				{#each COL_A as t, i}<div class="cell" style="--d:{0.35 + i * 0.15}s">{@render tile(t)}</div>{/each}
			</div>
			<div class="col b">
				{#each COL_B as t, i}<div class="cell" style="--d:{0.5 + i * 0.15}s">{@render tile(t)}</div>{/each}
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

	/* ---- the gallery: a still mosaic, tiles fade up on arrival ---- */
	.wall {
		height: var(--h);
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.col {
		display: grid;
		gap: 14px;
		min-height: 0;
	}
	.col.a {
		grid-template-rows: 1.35fr 1fr;
	}
	.col.b {
		grid-template-rows: 1fr 1.35fr;
	}
	.cell {
		min-height: 0;
		opacity: 0;
		transform: translateY(40px);
		transition:
			opacity 1s ease var(--d),
			transform 1.2s var(--ease-out) var(--d);
	}
	.seen .cell {
		opacity: 1;
		transform: none;
	}
	.tile {
		margin: 0;
		height: 100%;
		border-radius: 16px;
		overflow: hidden;
		background: #121a16;
	}
	.tile img,
	.tile video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition: transform 0.9s var(--ease-out);
	}
	.tile:hover img,
	.tile:hover video {
		transform: scale(1.05);
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
			height: 128vw;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.feature,
		.feature video,
		.wi,
		.features li,
		.actions,
		.cell {
			transition: none;
		}
	}
</style>
