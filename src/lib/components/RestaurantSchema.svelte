<script lang="ts">
	// Restaurant JSON-LD structured data for SEO / Google rich results.
	import type { Brand } from '$lib/data/brand';
	import { REVIEWS, type BrandReviews } from '$lib/data/reviews';
	import type { PublicHours } from '$lib/hours';
	import { openingHoursSpecification, staticPublicHours } from '$lib/hours';
	// `reviews` override from the editable-content loader; falls back to static REVIEWS
	// so the aggregate rating in JSON-LD matches what's shown on the page.
	// `hours` comes from the live service periods (brand layout load) so what we
	// publish to Google is what the diary will actually accept a booking for —
	// this used to be parsed out of the hardcoded marketing strings and was wrong
	// for Fusion (advertised a 22:00 close against a 23:00 service).
	let {
		brand,
		reviews,
		hours
	}: { brand: Brand; reviews?: BrandReviews; hours?: PublicHours } = $props();

	const h = $derived<PublicHours>(
		hours ?? staticPublicHours(brand.id, brand.hours, brand.hoursNote ?? '')
	);

	const schema = $derived({
		'@context': 'https://schema.org',
		'@type': 'Restaurant',
		name: brand.name,
		servesCuisine: brand.id === 'asia' ? 'Pan-Asian' : 'Fusion',
		telephone: brand.phone,
		email: brand.email,
		url: `https://geisharestaurants.co.uk/${brand.id}`,
		address: {
			'@type': 'PostalAddress',
			streetAddress: brand.address.line1,
			addressLocality: brand.address.city,
			postalCode: brand.address.postcode,
			addressCountry: 'GB'
		},
		openingHoursSpecification: openingHoursSpecification(h),
		aggregateRating: {
			'@type': 'AggregateRating',
			ratingValue: (reviews ?? REVIEWS[brand.id]).average,
			reviewCount: (reviews ?? REVIEWS[brand.id]).count,
			bestRating: 5,
			worstRating: 1
		},
		sameAs: [brand.instagram, brand.facebook]
	});

	/**
	 * Serialise for embedding inside a script block.
	 *
	 * JSON.stringify does NOT escape `<` or `/`, so a string reaching this object
	 * that contains a closing script tag would end the block early and everything
	 * after it would parse as markup. `reviews` comes from the editable-content
	 * loader, so that string is CMS-authored rather than hardcoded — the one input
	 * here a person can type. Escaping the angle bracket costs nothing and removes
	 * the only way this @html can bite. `<` is still valid JSON.
	 *
	 * (Writing the closing tag out in full above would have ended this very block —
	 * which is the point.)
	 */
	function jsonLd(value: unknown): string {
		return JSON.stringify(value).replace(/</g, '\\u003c');
	}
</script>

<svelte:head>
	{@html `<script type="application/ld+json">${jsonLd(schema)}</script>`}
</svelte:head>
