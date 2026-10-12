<script lang="ts">
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import ContactPanel from '$lib/components/ContactPanel.svelte';
	import type { PageData } from './$types';
	import Seo from '$lib/components/Seo.svelte';
	let { data }: { data: PageData } = $props();
	const brand = $derived(data.brand);
</script>

<Seo
	title="Contact — Geisha Fusion"
	description="Get in touch with Geisha Fusion, Front Street, Benton, Newcastle Upon Tyne."
/>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Space+Grotesk:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="brand-page" data-brand="fusion">
	<ContactPanel {brand} copy={data.pages.contact} />
	<SiteFooter {brand} />
</div>
