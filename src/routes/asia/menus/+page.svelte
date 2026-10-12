<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	// MenusBrowser puts every dish in the page, searchable, and keeps the PDFs as
	// View/Download buttons per menu. It replaced FusionMenuGallery, the expanding
	// 8-panel accordion where every panel was a link straight to a PDF — "the 8
	// things" the client objected to.
	//
	// The gallery was back in for a spell (Aug 2026) while the transcribed dish
	// data was checked against the printed menus; the browser is now live again.
	// Its import stays parked below rather than deleted — that swap has been made
	// in both directions once already.
	// import FusionMenuGallery from '$lib/components/FusionMenuGallery.svelte';
	import MenusBrowser from '$lib/components/MenusBrowser.svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	let { data }: { data: PageData } = $props();
	const brand = getBrand('asia');
</script>

<Seo
	title="Menus — Geisha Asia"
	description="Every dish at Geisha Asia — pan-Asian small plates, dim sum, robata, ramen, curry and sushi. Search the menus or download the PDFs, including the full allergen guide."
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
	<!-- Antique gold carries the structure (eyebrow, headings, stats, category
	     rules); the home page's sakura pink carries every ACTIVE state and the
	     primary action, the way it does across the rest of the site.
	     Note this is --menu-hot, NOT --accent: MenusBrowser's root carries
	     data-brand, and `[data-brand='asia']` re-declares --accent on that very
	     element, so overriding --accent on a wrapper here silently does nothing. -->
	<div class="sakura-accent">
		<!-- The watercolour from the home page's "What's On" band — geisha at the
		     left edge, lanterns and blossom at the right. Hand-encoded in /art
		     rather than run through the media manifest, so the avif/webp ladder is
		     declared here the same way HomeSections declares its image-set(). -->
		<MenusBrowser
			{brand}
			menus={data.menus}
			bgImage="/art/asia-whats-on-bg-1280.webp"
			bgSrcset={{
				avif: '/art/asia-whats-on-bg-800.avif 800w, /art/asia-whats-on-bg-1280.avif 1280w',
				webp: '/art/asia-whats-on-bg-800.webp 800w, /art/asia-whats-on-bg-1280.webp 1280w'
			}}
		/>
	</div>
	<SiteFooter {brand} />
</div>

<style>
	.sakura-accent {
		/* Same value the home hero uses for its action colour (--sakura). */
		--menu-hot: #ef3c5c;
	}
</style>
