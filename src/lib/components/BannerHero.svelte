<script lang="ts">
	import { imgAttrs, fallback, srcset } from '$lib/media/responsive';
	// Larger home-page hero version of the announcement banner. Shown on the brand
	// home page only when the banner is live AND `showHero` is enabled (the slim
	// sitewide strip still shows independently). Same editable content as the
	// strip — bigger image, heading, body and a prominent CTA — for when the venue
	// wants to properly celebrate something (an award nomination, a new opening).
	import type { Banner } from '$lib/data/banner';
	import { bannerIsLive } from '$lib/data/banner';

	let { banner }: { banner: Banner } = $props();

	const show = $derived(bannerIsLive(banner) && banner.showHero);
	const external = $derived(/^https?:\/\//i.test(banner.ctaHref));
</script>

{#if show}
	<section class="banner-hero style-{banner.style}" aria-label="Announcement">
		<div class="bh-inner">
			{#if banner.image}
				<img class="bh-img" {...imgAttrs(banner.image, '100vw')} alt="" />
			{/if}
			<h2 class="bh-heading">{banner.heading}</h2>
			{#if banner.body}<p class="bh-body">{banner.body}</p>{/if}
			{#if banner.ctaLabel && banner.ctaHref}
				<a
					class="bh-cta"
					href={banner.ctaHref}
					target={banner.ctaNewTab ? '_blank' : undefined}
					rel={banner.ctaNewTab || external ? 'noopener noreferrer' : undefined}
				>
					{banner.ctaLabel}
				</a>
			{/if}
		</div>
	</section>
{/if}

<style>
	.banner-hero {
		width: 100%;
		box-sizing: border-box;
		padding: clamp(2.5rem, 6vw, 4.5rem) 1.5rem;
		font-family: var(--font-sans, system-ui, sans-serif);
	}
	.bh-inner {
		max-width: 760px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 1rem;
	}
	.bh-img {
		max-height: 90px;
		max-width: 220px;
		width: auto;
		object-fit: contain;
		margin-bottom: 0.5rem;
	}
	.bh-heading {
		margin: 0;
		font-size: clamp(1.5rem, 3.5vw, 2.4rem);
		font-weight: 700;
		line-height: 1.15;
		letter-spacing: -0.01em;
	}
	.bh-body {
		margin: 0;
		font-size: clamp(0.95rem, 1.6vw, 1.1rem);
		line-height: 1.6;
		max-width: 55ch;
		opacity: 0.92;
	}
	.bh-cta {
		margin-top: 0.6rem;
		display: inline-block;
		padding: 0.7rem 1.6rem;
		border-radius: 999px;
		font-size: 0.95rem;
		font-weight: 600;
		text-decoration: none;
		border: 2px solid currentColor;
		transition: opacity 0.15s ease;
	}
	.bh-cta:hover {
		opacity: 0.82;
	}

	/* ---- Style presets (mirror SiteBanner) ---- */
	.style-accent {
		background: var(--accent, #c45a3a);
		color: #fff;
	}
	.style-gold {
		background: radial-gradient(circle at 50% 0%, #d4a04c 0%, #b8860b 60%, #8a6d1e 100%);
		color: #1a1206;
	}
	.style-gold .bh-cta {
		border-color: #1a1206;
	}
	.style-dark {
		background: #14110d;
		color: #f4ede0;
	}
	.style-light {
		background: #f4ede0;
		color: #1a1206;
	}
</style>
