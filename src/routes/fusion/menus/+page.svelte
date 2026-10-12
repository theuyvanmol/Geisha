<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	// MenusBrowser puts every dish in the page, searchable, and keeps the PDFs as
	// View/Download buttons per menu — see the fuller note on the Asia menus page,
	// including the Aug 2026 spell back on FusionMenuGallery. The gallery import
	// stays parked here rather than deleted for the same reason.
	// import FusionMenuGallery from '$lib/components/FusionMenuGallery.svelte';
	import MenusBrowser from '$lib/components/MenusBrowser.svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	let { data }: { data: PageData } = $props();
	const brand = getBrand('fusion');
</script>

<Seo
	title="Menus — Geisha Fusion"
	description="Every dish at Geisha Fusion — starters, pizza, pasta, grill, burgers and the Sunday roast. Search the menus or download the PDFs, including the full allergen guide."
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
	<MenusBrowser {brand} menus={data.menus} bgImage={data.bgImage} />
	<SiteFooter {brand} />
</div>
