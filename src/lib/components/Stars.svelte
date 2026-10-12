<script lang="ts">
	// Five-star rating display. Renders full / half / empty stars from a 0–5 value,
	// coloured with the brand --accent. Decorative — an aria-label carries the value.
	let { value, size = '1rem' }: { value: number; size?: string } = $props();

	// Star fill fractions: 1 = full, 0.5 = half, 0 = empty, clamped to [0,1] each.
	const fills = $derived(
		Array.from({ length: 5 }, (_, i) => Math.max(0, Math.min(1, value - i)))
	);
</script>

<span
	class="stars"
	style="--star-size: {size}"
	role="img"
	aria-label="{value} out of 5 stars"
>
	{#each fills as f}
		<span class="star" class:half={f > 0 && f < 1} class:full={f >= 1}>★</span>
	{/each}
</span>

<style>
	.stars {
		display: inline-flex;
		gap: 0.12em;
		font-size: var(--star-size);
		line-height: 1;
		letter-spacing: 0;
	}
	.star {
		color: color-mix(in srgb, var(--accent) 26%, transparent);
		position: relative;
	}
	.star.full {
		color: var(--accent);
	}
	/* half star: clip a full-colour copy to the left 50% over the dim base */
	.star.half::before {
		content: '★';
		position: absolute;
		left: 0;
		top: 0;
		width: 50%;
		overflow: hidden;
		color: var(--accent);
	}
</style>
