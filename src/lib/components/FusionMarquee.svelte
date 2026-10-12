<script lang="ts">
	// A ribbon of words sliding across the page, Alchemist-style. It drifts on its
	// own and SPEEDS UP with the scroll (and flips direction with it), so the page
	// visibly reacts to every flick of the wheel. Runs only while on screen; under
	// reduced motion it simply sits still.
	import { onMount } from 'svelte';

	let {
		items,
		variant = 'serif',
		reverse = false,
		speed = 0.5
	}: { items: string[]; variant?: 'serif' | 'outline'; reverse?: boolean; speed?: number } = $props();

	let root: HTMLElement;
	let track: HTMLElement;

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		let x = 0;
		let raf = 0;
		let live = false;
		let lastY = window.scrollY;
		let boost = 0;
		let dir = reverse ? 1 : -1;
		const tick = () => {
			const y = window.scrollY;
			const dy = y - lastY;
			lastY = y;
			if (dy !== 0) dir = (dy > 0 ? -1 : 1) * (reverse ? -1 : 1);
			boost += (Math.min(40, Math.abs(dy)) * 0.35 - boost) * 0.12;
			const half = track.scrollWidth / 2 || 1;
			x += dir * (speed + boost);
			if (x <= -half) x += half;
			if (x > 0) x -= half;
			track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
			if (live) raf = requestAnimationFrame(tick);
		};
		const io = new IntersectionObserver(([e]) => {
			live = e.isIntersecting;
			cancelAnimationFrame(raf);
			if (live) {
				lastY = window.scrollY;
				raf = requestAnimationFrame(tick);
			}
		});
		io.observe(root);
		return () => {
			io.disconnect();
			cancelAnimationFrame(raf);
		};
	});
</script>

<div class="fx-marquee {variant}" bind:this={root} aria-hidden="true">
	<div class="track" bind:this={track}>
		{#each [0, 1] as copy (copy)}
			<div class="run">
				{#each items as item}
					<span class="item">{item}</span>
					<svg class="sep" viewBox="0 0 24 24" aria-hidden="true">
						<!-- a five-petal blossom -->
						<g fill="currentColor">
							{#each [0, 72, 144, 216, 288] as r}
								<ellipse cx="12" cy="6.2" rx="3.4" ry="5" transform="rotate({r} 12 12)" />
							{/each}
						</g>
						<circle cx="12" cy="12" r="2.2" fill="#0a0d0b" />
					</svg>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.fx-marquee {
		position: relative;
		overflow: hidden;
		padding: 26px 0;
		background: #0a0d0b;
		border-top: 1px solid rgba(221, 130, 54, 0.16);
		border-bottom: 1px solid rgba(221, 130, 54, 0.16);
		user-select: none;
	}
	.track {
		display: flex;
		width: max-content;
		will-change: transform;
	}
	.run {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}
	.item {
		white-space: nowrap;
		padding: 0 0.55em;
		font-family: 'Shippori Mincho', Georgia, serif;
		line-height: 1;
	}
	.serif .item {
		font-style: italic;
		font-weight: 500;
		font-size: clamp(1.6rem, 3.6vw, 3.2rem);
		color: #f2ece0;
	}
	.outline .item {
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		font-size: clamp(2.6rem, 7vw, 6.4rem);
		color: transparent;
		-webkit-text-stroke: 1px rgba(242, 236, 224, 0.55);
		transition: color 0.4s ease;
	}
	.outline .item:nth-child(4n + 1) {
		color: #dd8236;
		-webkit-text-stroke: 0;
	}
	.sep {
		flex-shrink: 0;
		width: clamp(18px, 2vw, 28px);
		height: clamp(18px, 2vw, 28px);
		margin: 0 0.4em;
		color: #d92e22;
	}
	.outline .sep {
		color: #f79a4a;
	}
	@media (max-width: 760px) {
		.fx-marquee {
			padding: 18px 0;
		}
	}
</style>
