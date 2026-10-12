<script lang="ts">
	import { getBrand } from '$lib/data/brand';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import CirclePanel from '$lib/components/CirclePanel.svelte';
	import CircleComingSoon from '$lib/components/CircleComingSoon.svelte';
	import { CIRCLE_LIVE } from '$lib/data/features';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';

	let { data }: { data: PageData } = $props();
	const brand = getBrand('fusion');
</script>

<Seo
	title="{CIRCLE_LIVE ? data.program.name : `${data.program.name} — coming soon`} — Geisha Fusion"
	description={CIRCLE_LIVE
		? `Join ${data.program.name} at Geisha Fusion — earn points on every visit across both Geisha restaurants and spend them on the food you love.`
		: `${data.program.name}, our rewards programme, is coming soon to Geisha Fusion.`}
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
	{#if CIRCLE_LIVE}
		<CirclePanel {brand} program={data.program} />
	{:else}
		<CircleComingSoon {brand} name={data.program.name} />
	{/if}
	<SiteFooter {brand} />
</div>
