<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import MenuRenderer from '$lib/components/MenuRenderer.svelte';
	import UberEatsButton from '$lib/components/UberEatsButton.svelte';
	import TouchTakeawayButton from '$lib/components/TouchTakeawayButton.svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';

	let { data }: { data: PageData } = $props();
	const brand = getBrand('fusion');
</script>

<Seo
	title="{data.menu.title} — Geisha Fusion"
	description={data.menu.subtitle ?? `The ${data.menu.title} at Geisha Fusion.`}
/>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Space+Grotesk:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="brand-page" data-brand="fusion">
	<a class="back" href="/fusion/menus">‹ All menus</a>
	<MenuRenderer menu={data.menu} />
	<div class="order-strip" data-brand="fusion">
		<p>Hungry now?</p>
		<div class="order-strip-cta">
			<UberEatsButton href={brand.uberEatsUrl} size="lg" />
			<TouchTakeawayButton href={brand.touchTakeawayUrl} size="lg" />
		</div>
	</div>
	<SiteFooter {brand} />
</div>

<style>
	.back {
		display: block;
		max-width: 880px;
		/* The 1.4rem above the link is PADDING, not margin. As a top margin on the
		   first child it collapsed straight through .brand-page and pushed the
		   whole page panel down instead, leaving a 22px strip of bare document
		   ground between the nav and the page. */
		margin: 0 auto -1rem;
		padding: 1.4rem 1.6rem 0;
		font-family: var(--font-serif);
		font-style: italic;
		color: var(--ink-soft);
		text-decoration: none;
	}
	.back:hover {
		color: var(--accent);
	}
	.order-strip {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.8rem;
		padding: 2rem 1.6rem 4rem;
		text-align: center;
	}
	.order-strip p {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.3rem;
		color: var(--ink-soft);
		margin: 0;
	}
	.order-strip-cta {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.8rem;
	}

	@media (max-width: 600px) {
		/* Same phone pass as the Asia single-menu page — keep the two in step. */
		.back {
			margin-bottom: 0;
			padding: 1.2rem 1.25rem 0.8rem;
		}
		.order-strip {
			padding: 1.5rem 1.25rem 3rem;
		}
		.order-strip-cta {
			flex-direction: column;
			align-items: stretch;
			width: 100%;
			max-width: 300px;
		}
		.order-strip-cta :global(a) {
			justify-content: center;
		}
	}
</style>
