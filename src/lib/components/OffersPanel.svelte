<script lang="ts">
	// What's On — current promotions per brand, from offers.ts.
	import type { Brand } from '$lib/data/brand';
	import { OFFERS, type Offer } from '$lib/data/offers';
	import Reveal from './Reveal.svelte';
	import UberEatsButton from './UberEatsButton.svelte';
	import TouchTakeawayButton from './TouchTakeawayButton.svelte';

	// `offers` override comes from the editable-content loader; falls back to the
	// static OFFERS so any caller that doesn't pass it still renders.
	let { brand, offers: offersProp }: { brand: Brand; offers?: Offer[] } = $props();
	const base = $derived(`/${brand.id}`);
	const offers = $derived(offersProp ?? OFFERS[brand.id]);
</script>

<section class="offers" data-brand={brand.id}>
	<header class="head">
		<h1>What’s On</h1>
		<p class="lead">Specials, deals and the good stuff at {brand.name}.</p>
	</header>

	<div class="grid">
		{#each offers as o, i}
			<Reveal delay={i * 0.06}>
				<article class="card">
					{#if o.price}<span class="price">{o.price}</span>{/if}
					<h2>{o.title}</h2>
					<p class="when">{o.when}</p>
					<p class="blurb">{o.blurb}</p>
					<div class="actions">
						{#if o.href}
							<a class="link" href={o.href} target="_blank" rel="noopener noreferrer">View menu ›</a>
						{/if}
						<a class="link" href="{base}/bookings">Book ›</a>
						{#if o.delivery}
							<UberEatsButton href={brand.uberEatsUrl} size="sm" />
							<TouchTakeawayButton href={brand.touchTakeawayUrl} size="sm" />
						{/if}
					</div>
				</article>
			</Reveal>
		{/each}
	</div>
</section>

<style>
	.offers {
		max-width: 1080px;
		margin: 0 auto;
		padding: 3rem 1.6rem 5rem;
		color: var(--ink);
		font-family: var(--font-body);
	}
	.head {
		text-align: center;
		margin-bottom: 3rem;
	}
	h1 {
		font-family: var(--font-display);
		font-size: clamp(2.6rem, 6vw, 4.2rem);
		margin: 0.3rem 0 0.4rem;
		font-weight: 500;
	}
	.lead {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1.4rem;
	}
	.card {
		position: relative;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 2rem 1.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: transform 0.25s ease, border-color 0.25s ease;
	}
	/* Hover-capable pointers only: on a touch screen :hover sticks to the last card
	   tapped, leaving one card lifted and gold-edged for no reason. */
	@media (hover: hover) {
		.card:hover {
			transform: translateY(-3px);
			border-color: var(--accent);
		}
	}
	.price {
		position: absolute;
		top: 1.2rem;
		right: 1.2rem;
		font-size: 1.6rem;
		color: var(--accent);
		font-weight: 600;
	}
	.card h2 {
		margin: 0;
		font-size: 1.7rem;
		font-weight: 500;
		max-width: 80%;
	}
	.when {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent-2, var(--accent));
		margin: 0;
	}
	.blurb {
		color: var(--ink-soft);
		font-size: 1.05rem;
		line-height: 1.5;
		margin: 0.3rem 0 0.6rem;
		flex: 1;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem;
		align-items: center;
	}
	.link {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		font-family: var(--font-sans);
		font-size: 0.74rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent);
		text-decoration: none;
	}
	.link:hover {
		text-decoration: underline;
	}

	/* ── Phone — the grid is already one column here (minmax(280px) can't fit two) ──
	   The desktop card pins the price in the corner and caps the title at 80% to
	   keep them apart. In a ~300px card that fails both ways: "£23.50" ran into
	   "Evening Special", while "2 for £14 Cocktails" wrapped beside a short "£14".
	   So the card becomes a two-column grid — title | price on a shared baseline,
	   the title taking whatever the price leaves — and everything else spans. */
	@media (max-width: 640px) {
		.offers {
			padding: 2rem 1.25rem 3.5rem;
		}
		.head {
			margin-bottom: 2rem;
		}
		.lead {
			text-wrap: balance;
		}
		.card {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: baseline;
			gap: 0.5rem 0.9rem;
			/* Bottom is shallower: the 44px link row carries its own air. */
			padding: 1.5rem 1.4rem 0.9rem;
		}
		.price {
			position: static;
			grid-column: 2;
			grid-row: 1;
			font-size: 1.5rem;
			line-height: 1.15;
		}
		.card h2 {
			grid-column: 1;
			max-width: none;
			font-size: 1.5rem;
			line-height: 1.15;
			text-wrap: balance;
		}
		.when,
		.blurb,
		.actions {
			grid-column: 1 / -1;
		}
		.when {
			font-size: 0.75rem;
			line-height: 1.5;
			text-wrap: balance;
		}
		.blurb {
			margin: 0.3rem 0 0.2rem;
			text-wrap: pretty;
		}
		.actions {
			gap: 0.4rem 1.5rem;
		}
		.link {
			min-height: 44px;
			font-size: 0.75rem;
		}
	}
</style>
