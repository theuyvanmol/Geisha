<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import FusionFunctionRoom from '$lib/components/FusionFunctionRoom.svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	let { data }: { data: PageData } = $props();
	const brand = getBrand('fusion');
</script>

<Seo
	title="Parties &amp; Functions — Geisha Fusion"
	description="Host your celebration at Geisha Fusion — VIP function room for birthdays, engagements, parties and more."
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
	<FusionFunctionRoom {brand} copy={data.pages.parties} brandInfo={data.brandInfo} />
	<SiteFooter {brand} />
</div>
