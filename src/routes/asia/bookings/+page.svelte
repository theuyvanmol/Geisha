<script lang="ts">
	import { page } from '$app/state';
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	// Guests get our own booking form (SiteBooking — the same widget that already
	// takes the restaurant's online bookings from the old site). The old ResDiary
	// widget and the unproven bespoke flow are reachable in dev only, via the
	// floating switch (or ?engine=…). resolveEngine() hard-locks to the default in
	// any non-dev build — see $lib/bookings/engine.ts.
	import SiteBooking from '$lib/components/guest/SiteBooking.svelte';
	import BookingPanel from '$lib/components/BookingPanel.svelte';
	import ResDiaryWidget from '$lib/components/guest/ResDiaryWidget.svelte';
	import BookingEngineSwitch from '$lib/components/guest/BookingEngineSwitch.svelte';
	import { resolveEngine, type BookingEngine } from '$lib/bookings/engine';
	import Seo from '$lib/components/Seo.svelte';
	const brand = getBrand('asia');

	let engine = $state<BookingEngine>(resolveEngine(page.url));
</script>

<Seo
	title="Book a Table — Geisha Asia"
	description="Reserve a table at Geisha Asia, Benton, Newcastle. Walk-ins welcome."
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
	{#if engine === 'custom'}
		<BookingPanel {brand} />
	{:else if engine === 'resdiary'}
		<ResDiaryWidget {brand} />
	{:else}
		<SiteBooking {brand} />
	{/if}

	<SiteFooter {brand} />
</div>

<BookingEngineSwitch bind:engine />
