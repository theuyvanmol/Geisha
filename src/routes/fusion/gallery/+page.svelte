<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	// Retired, in order: the immersive canvas image-sphere (FusionSphereGallery),
	// then the shared parallax photo wall (AsiaGallery). The wall was ~7 screens
	// tall and the scrolling is what the client objected to; GalleryStage holds
	// the whole gallery in ONE screen. Both are kept in the tree, not deleted.
	// import FusionSphereGallery from '$lib/components/FusionSphereGallery.svelte';
	// import AsiaGallery from '$lib/components/AsiaGallery.svelte';
	import GalleryStage from '$lib/components/GalleryStage.svelte';
	import InstagramWall from '$lib/components/InstagramWall.svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	let { data }: { data: PageData } = $props();
	const brand = getBrand('fusion');
</script>

<Seo
	title="Gallery — Geisha Fusion"
	description="A look inside Geisha Fusion — food, interior, cocktails and events."
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
	<!-- Same one-screen stage as Asia, themed by the [data-brand="fusion"] wrapper.
	     Both brands now share a type pair and differ only in palette, so unlike the
	     old wall this needs no per-brand overrides. -->
	<GalleryStage
		brandId="fusion"
		images={data.gallery}
		tagline="Big plates, full tables and good times in Benton."
	/>
	<InstagramWall {brand} images={data.gallery} />
	<SiteFooter {brand} />
</div>
