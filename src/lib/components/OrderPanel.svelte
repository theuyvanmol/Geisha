<script lang="ts">
	import { imgAttrs, fallback, srcset } from '$lib/media/responsive';
	// Order Online — an editorial diptych. Two routes, each a tall image-topped
	// panel carrying its provider's branding: Uber Eats (delivery, green) given
	// top billing per spec §5a, and Touch Takeaway (takeaway / collection, brand
	// accent) second. Imagery is pulled from the per-brand gallery so each
	// restaurant shows its own food. The two panels are top-aligned and equal
	// height so the spread reads as a balanced pair.
	import type { Brand } from '$lib/data/brand';
	import { GALLERY, type GalleryImage } from '$lib/data/gallery';
	import type { PagesContent, BrandInfoContent } from '$lib/content/schema';
	import { getPagesDefaults, fillTokens, tokenSource } from '$lib/data/pages';
	import UberEatsButton from './UberEatsButton.svelte';
	import RichText from './RichText.svelte';

	// `images` is the editable-content override from the loader; without it this
	// panel read the static GALLERY only, so gallery edits never reached it.
	// `copy` is the editable page copy from Content → Pages.
	let {
		brand,
		images,
		copy,
		brandInfo
	}: {
		brand: Brand;
		images?: GalleryImage[];
		copy?: PagesContent['order'];
		brandInfo?: BrandInfoContent;
	} = $props();

	const c = $derived(copy ?? getPagesDefaults(brand.id).order);
	const tok = $derived(tokenSource(brand, brandInfo));
	const fill = (s: string) => fillTokens(s, tok);

	// Two distinct food shots for the two panels — featured food images for this
	// brand first, falling back to whatever food we have.
	const food = $derived(
		(images ?? GALLERY[brand.id])
			.filter((g) => g.category === 'food')
			.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)))
	);
	const deliveryImg = $derived(food[0]);
	const collectImg = $derived(food[1] ?? food[0]);
</script>

<section class="order" data-brand={brand.id}>
	<header class="head">
		<span class="eyebrow">{fill(c.eyebrow)}</span>
		<h1>{fill(c.title)}</h1>
		<p class="lead">{fill(c.lead)}</p>
	</header>

	<div class="diptych">
		<!-- DELIVERY (primary — Uber Eats branded) -->
		<article class="panel delivery">
			<div class="frame">
				<img {...imgAttrs(deliveryImg.src, '(max-width: 800px) 92vw, 46vw')} alt={deliveryImg.alt} loading="lazy" />
				<span class="num">01</span>
				<span class="tag uber">Delivery</span>
			</div>
			<div class="body">
				<span class="provider uber-provider"><RichText text={fill(c.deliveryProvider)} /></span>
				<h2>{fill(c.deliveryHeading)}</h2>
				<p><RichText text={fill(c.deliveryBody)} autolink /></p>
				<div class="cta">
					<UberEatsButton href={brand.uberEatsUrl} size="lg" />
				</div>
				<p class="fine"><RichText text={fill(c.deliveryFine)} /></p>
			</div>
		</article>

		<!-- TAKEAWAY / COLLECTION (brand-accent branded) -->
		<article class="panel takeaway">
			<div class="frame">
				<img {...imgAttrs(collectImg.src, '(max-width: 800px) 92vw, 46vw')} alt={collectImg.alt} loading="lazy" />
				<span class="num">02</span>
				<span class="tag alt">Takeaway</span>
			</div>
			<div class="body">
				<span class="provider brand-provider"><RichText text={fill(c.takeawayProvider)} /></span>
				<h2>{fill(c.takeawayHeading)}</h2>
				<p><RichText text={fill(c.takeawayBody)} autolink /></p>
				<div class="cta">
					<a
						class="collect"
						href={brand.touchTakeawayUrl}
						target="_blank"
						rel="noopener noreferrer"
					>
						{fill(c.takeawayCtaLabel)}
						<span class="arrow" aria-hidden="true">→</span>
					</a>
				</div>
				<p class="fine"><RichText text={fill(c.takeawayFine)} /></p>
			</div>
		</article>
	</div>
</section>

<style>
	.order {
		max-width: 1100px;
		margin: 0 auto;
		padding: 3.5rem 1.6rem 6rem;
		color: var(--ink);
		font-family: var(--font-body);
	}

	/* ---- header ---- */
	.head {
		text-align: center;
		margin-bottom: 3.2rem;
	}
	.eyebrow {
		display: inline-block;
		font-family: var(--font-sans);
		font-size: 0.66rem;
		letter-spacing: 0.42em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: 0.9rem;
	}
	h1 {
		font-family: var(--font-display);
		font-size: clamp(2.8rem, 7vw, 4.6rem);
		margin: 0 0 0.5rem;
		font-weight: 500;
		line-height: 1.02;
	}
	.lead {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0;
		font-size: 1.1rem;
	}

	/* ---- diptych: top-aligned, equal-height pair ---- */
	.diptych {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2rem;
		align-items: stretch;
	}

	.panel {
		display: flex;
		flex-direction: column;
		border-radius: 8px;
		overflow: hidden;
		/* a tinted card per route, so each panel carries its own colour */
		background: var(--panel-tint);
		border: 1px solid var(--panel-line);
		/* coloured top accent rule announces the route's brand */
		border-top: 3px solid var(--panel-accent);
	}
	.panel.delivery {
		--panel-accent: var(--uber-green);
		--panel-tint: color-mix(in srgb, var(--uber-green) 6%, var(--card));
		--panel-line: color-mix(in srgb, var(--uber-green) 30%, var(--line));
	}
	.panel.takeaway {
		--panel-accent: var(--accent);
		--panel-tint: color-mix(in srgb, var(--accent) 7%, var(--card));
		--panel-line: color-mix(in srgb, var(--accent) 30%, var(--line));
	}

	/* ---- image frame ---- */
	.frame {
		position: relative;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background: var(--card);
	}
	.frame img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition: transform 0.9s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.panel:hover .frame img {
		transform: scale(1.05);
	}
	/* gradient so the tag/number stay legible over any photo */
	.frame::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, #000 30%, transparent) 0%,
			transparent 32%,
			transparent 62%,
			color-mix(in srgb, #000 34%, transparent) 100%
		);
		pointer-events: none;
	}
	.num {
		position: absolute;
		top: 0.6rem;
		left: 1rem;
		z-index: 1;
		font-size: 2.6rem;
		font-weight: 500;
		color: #fff;
		opacity: 0.92;
		line-height: 1;
		letter-spacing: -0.02em;
		text-shadow: 0 1px 10px rgba(0, 0, 0, 0.4);
	}
	.tag {
		position: absolute;
		bottom: 1rem;
		left: 1rem;
		z-index: 1;
		font-family: var(--font-sans);
		font-size: 0.62rem;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		padding: 0.36rem 0.8rem;
		border-radius: 999px;
		font-weight: 700;
	}
	.tag.uber {
		background: var(--uber-green);
		color: #000;
	}
	.tag.alt {
		background: color-mix(in srgb, var(--accent) 92%, #000);
		color: #fff;
	}

	/* ---- body ---- */
	.body {
		padding: 1.4rem 1.6rem 1.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		flex: 1;
	}
	/* per-route provider line, coloured to its brand */
	.provider {
		font-family: var(--font-sans);
		font-size: 0.64rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		font-weight: 700;
	}
	.uber-provider {
		color: color-mix(in srgb, var(--uber-green) 80%, var(--ink));
	}
	.brand-provider {
		color: var(--accent);
	}
	.body h2 {
		margin: 0;
		font-size: clamp(1.7rem, 3vw, 2.05rem);
		font-weight: 500;
		line-height: 1.1;
	}
	.body > p {
		margin: 0;
		color: var(--ink-soft);
		font-size: 1.05rem;
		line-height: 1.55;
	}
	.cta {
		margin-top: 0.7rem;
	}
	/* `.body > .fine`, not bare `.fine`: `.body > p` above out-specifies a lone
	   class, so the small print was rendering at the body copy's 1.05rem in
	   --ink-soft and wrapping to two lines on a phone. */
	.body > .fine {
		font-size: 0.85rem;
		color: var(--ink-faint);
		font-style: italic;
		margin-top: auto;
		padding-top: 0.9rem;
	}

	/* takeaway pill — serif, brand-accent, with a travelling arrow */
	.collect {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.1rem;
		color: var(--accent);
		border: 1px solid var(--accent);
		padding: 0.85rem 1.5rem;
		border-radius: 999px;
		text-decoration: none;
		transition: background 0.25s ease, color 0.25s ease;
	}
	.collect .arrow {
		transition: transform 0.25s ease;
	}
	.collect:hover {
		background: var(--accent);
		color: var(--bg);
	}
	.collect:hover .arrow {
		transform: translateX(4px);
	}

	/* ---- responsive ---- */
	@media (max-width: 760px) {
		/* Tightened so the first route — photo, copy and its button — lands inside
		   one phone screen with the second peeking; at the desktop paddings the
		   Uber Eats button sat at the very bottom of an 844px screen and Takeaway
		   was a full scroll away. */
		.order {
			padding: 2rem 1.25rem 3.5rem;
		}
		.head {
			margin-bottom: 2rem;
		}
		.lead {
			font-size: 1.02rem;
			/* no one-word last line ("collection.") */
			text-wrap: balance;
		}
		.diptych {
			grid-template-columns: 1fr;
			gap: 1.25rem;
		}
		.frame {
			aspect-ratio: 16 / 10;
		}
		.body {
			padding: 1.2rem 1.25rem 1.4rem;
		}
		.body > p {
			text-wrap: pretty;
		}
		.body > .fine {
			padding-top: 0.7rem;
		}
		/* The tracked caps were 10–10.5px; 12px is the floor on a phone. */
		.eyebrow {
			font-size: 0.75rem;
			letter-spacing: 0.36em;
			margin-bottom: 0.7rem;
		}
		.tag,
		.provider {
			font-size: 0.75rem;
			letter-spacing: 0.18em;
		}
		/* The two routes' buttons as a matched full-width pair. Left intrinsic, the
		   Uber Eats pill drops its label under 520px and shrank to 110×46 beside a
		   201×50 takeaway pill — the page's primary action was its smallest thing.
		   The Uber button is a child component, hence :global. */
		.cta {
			margin-top: 0.6rem;
		}
		.cta :global(.uber),
		.collect {
			display: flex;
			justify-content: center;
			box-sizing: border-box;
			width: 100%;
			min-height: 52px;
			padding-top: 0;
			padding-bottom: 0;
		}
	}
</style>
