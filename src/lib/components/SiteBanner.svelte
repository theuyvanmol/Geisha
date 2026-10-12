<script lang="ts">
	import { imgAttrs, fallback, srcset } from '$lib/media/responsive';
	// Sitewide announcement strip — a slim, dismissible bar pinned to the top of
	// every page for a brand. Content comes from the editable `banner` content key
	// (admin → Content → Banner), so the venue can flip it on to shout about
	// something timely (e.g. an award nomination) with their own text, image and
	// link. Renders nothing unless the banner is live (enabled + has a heading).
	//
	// Dismissal: remembered per-visit in sessionStorage, keyed by the banner's
	// heading — so a guest who closes it won't see it again this visit, but if the
	// venue changes the wording the new banner reappears.
	import type { Banner } from '$lib/data/banner';
	import { bannerIsLive } from '$lib/data/banner';
	import type { BrandId } from '$lib/data/brand';

	let { banner, brand }: { banner: Banner; brand: BrandId } = $props();

	const live = $derived(bannerIsLive(banner));
	const key = $derived(`geisha-banner-dismissed:${brand}`);

	// Start not-dismissed; on mount, hide it if this exact banner was closed before.
	let dismissed = $state(false);
	$effect(() => {
		if (!live) return;
		try {
			dismissed = sessionStorage.getItem(key) === banner.heading;
		} catch {
			dismissed = false;
		}
	});

	function close() {
		dismissed = true;
		try {
			sessionStorage.setItem(key, banner.heading);
		} catch {
			/* private mode / storage disabled — just hide for now */
		}
	}

	const external = $derived(/^https?:\/\//i.test(banner.ctaHref));
</script>

{#if live && !dismissed}
	<aside class="site-banner style-{banner.style}" data-banner-brand={brand} aria-label="Announcement">
		<div class="sb-inner">
			{#if banner.image}
				<img class="sb-img" {...imgAttrs(banner.image, '100vw')} alt="" />
			{/if}
			<div class="sb-text">
				<span class="sb-heading">{banner.heading}</span>
				{#if banner.body}<span class="sb-body">{banner.body}</span>{/if}
			</div>
			{#if banner.ctaLabel && banner.ctaHref}
				<a
					class="sb-cta"
					href={banner.ctaHref}
					target={banner.ctaNewTab ? '_blank' : undefined}
					rel={banner.ctaNewTab || external ? 'noopener noreferrer' : undefined}
				>
					{banner.ctaLabel}
				</a>
			{/if}
		</div>
		<button class="sb-close" type="button" onclick={close} aria-label="Dismiss announcement">
			✕
		</button>
	</aside>
{/if}

<style>
	.site-banner {
		position: relative;
		z-index: 150;
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 3rem 0.55rem 1.25rem; /* right pad clears the close button */
		font-family: var(--font-sans, system-ui, sans-serif);
		box-sizing: border-box;
	}
	.sb-inner {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		flex-wrap: wrap;
		text-align: center;
	}
	.sb-img {
		height: 30px;
		width: auto;
		max-width: 90px;
		object-fit: contain;
		border-radius: 4px;
		flex: none;
	}
	.sb-text {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		flex-wrap: wrap;
		justify-content: center;
		line-height: 1.35;
	}
	.sb-heading {
		font-weight: 700;
		letter-spacing: 0.01em;
		font-size: 0.92rem;
	}
	.sb-body {
		font-size: 0.85rem;
		opacity: 0.9;
	}
	.sb-cta {
		flex: none;
		display: inline-block;
		padding: 0.3rem 0.85rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 600;
		text-decoration: none;
		border: 1.5px solid currentColor;
		white-space: nowrap;
		transition: opacity 0.15s ease;
	}
	.sb-cta:hover {
		opacity: 0.8;
	}
	.sb-close {
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: 0;
		color: inherit;
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0.65;
		padding: 0.35rem;
	}
	.sb-close:hover {
		opacity: 1;
	}

	/* ---- Style presets ---- */
	/* Brand accent: uses the in-scope --accent token (set per brand in tokens.css). */
	.style-accent {
		background: var(--accent, #c45a3a);
		color: #fff;
	}
	.style-gold {
		background: linear-gradient(90deg, #b8860b, #d4a04c 55%, #8a6d1e);
		color: #1a1206;
	}
	.style-gold .sb-cta {
		border-color: #1a1206;
	}
	.style-dark {
		background: #14110d;
		color: #f4ede0;
	}
	.style-light {
		background: #f4ede0;
		color: #1a1206;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
	}

	@media (max-width: 560px) {
		.site-banner {
			padding: 0.5rem 2.4rem 0.5rem 0.9rem;
		}
		.sb-heading {
			font-size: 0.85rem;
		}
		.sb-body {
			font-size: 0.78rem;
		}
		.sb-img {
			height: 24px;
		}
	}
</style>
