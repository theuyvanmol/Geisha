<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	// Retired: AsiaGallery, the parallax photo wall. It stacked every photo in a
	// 3-column grid about seven screens tall, and the scrolling is exactly what
	// the client objected to. GalleryStage holds the whole gallery in ONE screen.
	// Kept in the tree in case the wall is ever wanted back.
	// import AsiaGallery from '$lib/components/AsiaGallery.svelte';
	import GalleryStage from '$lib/components/GalleryStage.svelte';
	import InstagramWall from '$lib/components/InstagramWall.svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	let { data }: { data: PageData } = $props();
	const brand = getBrand('asia');
</script>

<Seo
	title="Gallery — Geisha Asia"
	description="A look inside Geisha Asia — food, interior, cocktails and events."
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
	<!-- One screen, no scrolling: the page heading now lives inside the component's
	     top bar so the stage gets the height the old <header> was taking. -->
	<GalleryStage
		brandId="asia"
		images={data.gallery}
		tagline="Sushi, robata and the room — a look inside Geisha Asia."
	/>
	<InstagramWall {brand} images={data.gallery} />
	<SiteFooter {brand} />
</div>
