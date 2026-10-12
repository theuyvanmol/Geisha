<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import OrderPanel from '$lib/components/OrderPanel.svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	let { data }: { data: PageData } = $props();
	const brand = getBrand('fusion');
</script>

<Seo
	title="Order Online — Geisha Fusion"
	description="Geisha Fusion at home — delivery on Uber Eats or order ahead for takeaway and collection."
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
	<OrderPanel {brand} images={data.gallery} copy={data.pages.order} brandInfo={data.brandInfo} />
	<SiteFooter {brand} />
</div>
