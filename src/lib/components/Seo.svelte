<script lang="ts">
	// Per-page <head>: title, description, canonical, robots, Open Graph, Twitter.
	//
	// One component owns all of it so a page can't ship a title without a
	// canonical, or an og:title that has drifted from its <title>. Pages pass the
	// copy; everything derivable (URL, brand share image, card type) comes from
	// the route.
	//
	// Font <link>s stay in the pages — they differ per brand and belong next to
	// the styles that use them.
	import { page } from '$app/stores';
	import type { BrandId } from '$lib/data/brand';
	import { OG_IMAGE, SITE_NAME, SITE_URL, absolute, brandFromPath, canonicalPath } from '$lib/seo';

	let {
		title,
		description,
		/** Overrides the brand inferred from the URL. Rarely needed. */
		brand,
		/** Site-relative or absolute share image. Defaults to the brand's. */
		image,
		/** og:type — 'article' for anything dated, 'website' otherwise. */
		type = 'website',
		/** Keep it out of the index (booking-management, policy pages). */
		noindex = false
	}: {
		title: string;
		description?: string;
		brand?: BrandId;
		image?: string;
		type?: 'website' | 'article';
		noindex?: boolean;
	} = $props();

	const url = $derived(`${SITE_URL}${canonicalPath($page.url.pathname)}`);
	const shareImage = $derived(
		absolute(image ?? OG_IMAGE[brand ?? brandFromPath($page.url.pathname)])
	);

	// `max-image-preview:large` is carried over from the live site — it's what
	// lets Google show a full-width photo next to the result instead of a thumb.
	// The -1s do the same for text snippets and video previews.
	const robots = $derived(
		noindex
			? 'noindex,nofollow'
			: 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
	);
</script>

<svelte:head>
	<title>{title}</title>
	{#if description}
		<meta name="description" content={description} />
	{/if}
	<meta name="robots" content={robots} />
	<link rel="canonical" href={url} />

	<meta property="og:type" content={type} />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:locale" content="en_GB" />
	<meta property="og:title" content={title} />
	{#if description}
		<meta property="og:description" content={description} />
	{/if}
	<meta property="og:url" content={url} />
	<meta property="og:image" content={shareImage} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={title} />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={title} />
	{#if description}
		<meta name="twitter:description" content={description} />
	{/if}
	<meta name="twitter:image" content={shareImage} />
</svelte:head>
