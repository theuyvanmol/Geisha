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
		speed = 0.5,
		brand = 'fusion'
	}: {
		items: string[];
		variant?: 'serif' | 'outline';
		reverse?: boolean;
		speed?: number;
		brand?: 'fusion' | 'asia';
	} = $props();

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

<div class="fx-marquee {variant}" data-brand={brand} bind:this={root} aria-hidden="true">
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
						<circle cx="12" cy="12" r="2.2" fill="var(--mq-ink)" />
					</svg>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.fx-marquee {
		--mq-ink: #0a0d0b;
		--mq-gold: #dd8236;
		--mq-gold-2: #f79a4a;
		--mq-gold-rgb: 221, 130, 54;
		--mq-sep: #d92e22;
		--mq-ivory: #f2ece0;
		--mq-ivory-rgb: 242, 236, 224;
		--mq-fill: var(--mq-gold);
		position: relative;
		overflow: hidden;
		padding: 26px 0;
		background: var(--mq-ink);
		border-top: 1px solid rgba(var(--mq-gold-rgb), 0.16);
		border-bottom: 1px solid rgba(var(--mq-gold-rgb), 0.16);
		user-select: none;
	}
	.fx-marquee[data-brand='asia'] {
		--mq-ink: #08080b;
		--mq-gold: #d4af37;
		--mq-gold-2: #ff7a94;
		--mq-gold-rgb: 212, 175, 55;
		--mq-sep: #ef3c5c;
		--mq-ivory: #f5f1e8;
		--mq-ivory-rgb: 245, 241, 232;
		/* the filled words are sakura pink on Asia (owner, Oct 2026) */
		--mq-fill: #ff7a94;
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
		color: var(--mq-ivory);
	}
	.outline .item {
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		font-size: clamp(2.6rem, 7vw, 6.4rem);
		color: transparent;
		-webkit-text-stroke: 1px rgba(var(--mq-ivory-rgb), 0.55);
		transition: color 0.4s ease;
	}
	.outline .item:nth-child(4n + 1) {
		color: var(--mq-fill);
		-webkit-text-stroke: 0;
	}
	.sep {
		flex-shrink: 0;
		width: clamp(18px, 2vw, 28px);
		height: clamp(18px, 2vw, 28px);
		margin: 0 0.4em;
		color: var(--mq-sep);
	}
	.outline .sep {
		color: var(--mq-gold-2);
	}
	@media (max-width: 760px) {
		.fx-marquee {
			padding: 18px 0;
		}
	}
</style>
