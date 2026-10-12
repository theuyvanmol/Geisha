<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import ReviewsPanel from '$lib/components/ReviewsPanel.svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	let { data }: { data: PageData } = $props();
	const brand = getBrand('asia');
</script>

<Seo
	title="Reviews — Geisha Asia"
	description="What guests say about Geisha Asia, Benton — rated 4.7/5 on TripAdvisor across more than a thousand reviews."
/>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Space+Grotesk:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="brand-page" data-brand="asia">
	<ReviewsPanel {brand} reviews={data.reviews} />
	<SiteFooter {brand} />
</div>

