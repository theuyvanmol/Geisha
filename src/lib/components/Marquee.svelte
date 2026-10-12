<script lang="ts">
	// Infinite ingredient/word ticker. A core "more going on" device, themed per
	// brand via tokens. Duplicates the track so the scroll loops seamlessly.
	import { onMount } from 'svelte';

	type Props = {
		items: string[];
		/** seconds for one full loop; lower = faster */
		speed?: number;
		reverse?: boolean;
	};
	let { items, speed = 28, reverse = false }: Props = $props();

	// The ticker only runs while it is on (or about to be on) screen. Left alone
	// it kept a full-width layer animating for the whole visit, six screens from
	// where anyone could see it. Paused, not removed: it picks up from the same
	// place, and the margin has it moving again before it comes into view.
	let el: HTMLElement;
	let asleep = $state(false);
	onMount(() => {
		const io = new IntersectionObserver(([e]) => (asleep = !e.isIntersecting), {
			rootMargin: '200px 0px'
		});
		io.observe(el);
		return () => io.disconnect();
	});
</script>

<div class="marquee" aria-hidden="true" bind:this={el}>
	<div class="track" class:reverse class:asleep style="--dur: {speed}s;">
		{#each [...items, ...items] as word, i}
			<span class="word">{word}</span>
			<span class="dot">·</span>
		{/each}
	</div>
</div>

<style>
	.marquee {
		overflow: hidden;
		width: 100%;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		padding: 0.9rem 0;
		mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
		-webkit-mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent);
	}
	.track {
		display: inline-flex;
		align-items: center;
		gap: 1.4rem;
		white-space: nowrap;
		animation: scroll var(--dur) linear infinite;
	}
	.track.reverse {
		animation-direction: reverse;
	}
	.track.asleep {
		animation-play-state: paused;
	}
	.word {
		font-family: var(--font-sans);
		font-size: 0.82rem;
		letter-spacing: 0.42em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	.dot {
		color: var(--accent);
		font-size: 1rem;
	}
	@keyframes scroll {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(-50%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.track {
			animation: none;
		}
	}
</style>
