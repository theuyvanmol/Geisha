<script lang="ts">
	// Menu index page body — lists all menus for a brand as cards, plus the
	// Uber Eats CTA. Shared by both brand routes.
	import type { Brand } from '$lib/data/brand';
	import { getMenuIndex } from '$lib/data/menus';
	import Reveal from './Reveal.svelte';
	import UberEatsButton from './UberEatsButton.svelte';
	import TouchTakeawayButton from './TouchTakeawayButton.svelte';

	let { brand }: { brand: Brand } = $props();
	const base = $derived(`/${brand.id}`);
	const menus = $derived(getMenuIndex(brand.id));
</script>

<section class="wrap">
	<header class="head">
		<h1>Menus</h1>
		<p class="lead">{brand.tagline}</p>
		<div class="cta">
			<a class="book" href="{base}/bookings">Book a Table</a>
			<UberEatsButton href={brand.uberEatsUrl} size="md" />
			<TouchTakeawayButton href={brand.touchTakeawayUrl} size="md" />
		</div>
	</header>

	<div class="grid">
		{#each menus as m, i}
			<Reveal delay={i * 0.05}>
				<a class="card" href="{base}/menus/{m.slug}">
					<h2>{m.title}</h2>
					{#if m.subtitle}<p>{m.subtitle}</p>{/if}
					<span class="arrow">View ›</span>
				</a>
			</Reveal>
		{/each}
	</div>
</section>

<style>
	.wrap {
		max-width: 1080px;
		margin: 0 auto;
		padding: 3rem 1.6rem 5rem;
		color: var(--ink);
		font-family: var(--font-serif);
	}
	.head {
		text-align: center;
		margin-bottom: 3rem;
	}
	h1 {
		font-size: clamp(2.6rem, 6vw, 4.2rem);
		margin: 0.4rem 0 0.4rem;
		font-weight: 500;
	}
	.lead {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0 0 1.6rem;
	}
	.cta {
		display: inline-flex;
		gap: 0.8rem;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
	}
	.book {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1rem;
		color: var(--accent);
		border: 1px solid var(--accent);
		padding: 0.7rem 1.4rem;
		border-radius: 2px;
		text-decoration: none;
		transition: background 0.25s ease;
	}
	.book:hover {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 1.2rem;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1.8rem 1.6rem;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 6px;
		text-decoration: none;
		color: var(--ink);
		transition: transform 0.25s ease, border-color 0.25s ease;
	}
	.card:hover {
		transform: translateY(-3px);
		border-color: var(--accent);
	}
	.card h2 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 500;
		color: var(--ink);
	}
	.card p {
		margin: 0;
		font-style: italic;
		font-size: 0.95rem;
		color: var(--ink-soft);
		flex: 1;
	}
	.arrow {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--accent);
		margin-top: 0.4rem;
	}
</style>
