<script lang="ts">
	// The iframe target. Deliberately bare — the widget IS the page.
	//
	// noindex: this URL is a fragment meant to be embedded, and letting it into
	// search results would put guests on a chromeless form with no way back to
	// either restaurant's site.
	import EmbedBookingWidget from '$lib/components/guest/EmbedBookingWidget.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Book a table — {data.brand.name}</title>
	<meta name="robots" content="noindex, nofollow" />
	<link rel="preconnect" href="https://js.stripe.com" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<EmbedBookingWidget brand={data.brand} redirectTo={data.redirectTo} theme={data.theme} />
