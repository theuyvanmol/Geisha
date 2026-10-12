<script lang="ts">
	// Scroll-reveal wrapper. Fades/translates children in once on first
	// intersection. Respects prefers-reduced-motion (shows instantly). Works
	// alongside Lenis since it uses IntersectionObserver, not scroll math.
	import { onMount, type Snippet } from 'svelte';

	type Props = {
		children: Snippet;
		/** seconds of delay before the reveal animation */
		delay?: number;
		/** initial translateY in px */
		y?: number;
		as?: string;
	};
	let { children, delay = 0, y = 24, as = 'div' }: Props = $props();

	let el: HTMLElement;
	let shown = $state(false);

	onMount(() => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduce) {
			shown = true;
			return;
		}
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						shown = true;
						io.disconnect();
					}
				}
			},
			{ threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
		);
		io.observe(el);
		return () => io.disconnect();
	});
</script>

<svelte:element
	this={as}
	bind:this={el}
	class="reveal"
	class:shown
	style="--reveal-delay: {delay}s; --reveal-y: {y}px;"
>
	{@render children()}
</svelte:element>

<style>
	.reveal {
		opacity: 0;
		transform: translateY(var(--reveal-y));
		transition:
			opacity 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) var(--reveal-delay),
			transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) var(--reveal-delay);
		will-change: opacity, transform;
	}
	.reveal.shown {
		opacity: 1;
		transform: translateY(0);
	}
	/* Phones: a flick lands on a section cold, so the content has to be there almost
	   at once — 0.45s, a 14px rise at most, and staggers cut to 0.4 of their length.
	   The same timing the two home pages use for their own sections. */
	@media (max-width: 760px) {
		.reveal {
			transform: translateY(min(var(--reveal-y), 14px));
			transition-duration: 0.45s;
			transition-delay: calc(var(--reveal-delay) * 0.4);
		}
	}
</style>
