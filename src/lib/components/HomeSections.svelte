<script lang="ts">
	// Bundle of "more going on" homepage sections, themed per brand. Appended
	// below each house's bespoke hero/story content so the homepages are richer
	// and route to every new page. Asia and Fusion get different marquee words.
	import type { Brand } from '$lib/data/brand';
	import { GALLERY_PAGE_LIVE } from '$lib/data/features';
	import { OFFERS, type Offer } from '$lib/data/offers';
	import type { GalleryImage } from '$lib/data/gallery';
	import type { BrandReviews } from '$lib/data/reviews';
	import Marquee from './Marquee.svelte';
	import Reveal from './Reveal.svelte';
	import Gallery from './Gallery.svelte';
	import InstagramWall from './InstagramWall.svelte';
	import ReviewsStrip from './ReviewsStrip.svelte';
	import UberEatsButton from './UberEatsButton.svelte';
	import type { Snippet } from 'svelte';

	// `offers`/`reviews`/`gallery` overrides from the editable-content loader; all
	// fall back to the static data so an un-wired caller still renders.
	let {
		brand,
		marqueeWords,
		offers: offersProp,
		reviews,
		gallery,
		galleryOverride
	}: {
		brand: Brand;
		marqueeWords: string[];
		offers?: Offer[];
		reviews?: BrandReviews;
		gallery?: GalleryImage[];
		/** Optional replacement for the Gallery teaser: both home pages pass the flip cards. */
		galleryOverride?: Snippet;
	} = $props();
	const base = $derived(`/${brand.id}`);
	const offers = $derived((offersProp ?? OFFERS[brand.id]).slice(0, 3));
</script>

<div class="home-sections" data-brand={brand.id}>
	<Marquee items={marqueeWords} />

	<!-- WHAT'S ON + AT HOME.
	     Wrapped so the two can share one backdrop (Asia paints the printed menu's
	     watercolour across the pair; Fusion leaves the wrapper doing nothing). -->
	<div class="whats-on-band">
		<!-- OFFERS STRIP -->
		<section class="offers">
			<Reveal>
				<div class="sec-head">
					<h2>What’s On</h2>
					<a class="more" href="{base}/offers">All offers ›</a>
				</div>
			</Reveal>
			<div class="offer-row">
				{#each offers as o, i}
					<Reveal delay={i * 0.06}>
						<a class="offer" href="{base}/offers">
							{#if o.price}<span class="price">{o.price}</span>{/if}
							<h3>{o.title}</h3>
							<span class="when">{o.when}</span>
							<p>{o.blurb}</p>
						</a>
					</Reveal>
				{/each}
			</div>
		</section>

		<!-- ORDER BANNER -->
		<section class="order-banner">
			<Reveal>
				<div class="ob-inner">
					<div>
						<h2>Geisha, at home</h2>
						<p>Delivery on Uber Eats, or order ahead for takeaway and collection.</p>
					</div>
					<div class="ob-cta">
						<UberEatsButton href={brand.uberEatsUrl} size="lg" />
						<a class="collect" href="{base}/order">Takeaway ›</a>
					</div>
				</div>
			</Reveal>
		</section>
	</div>

	<!-- GALLERY TEASER (a page can swap it out with galleryOverride) -->
	{#if galleryOverride}
		{@render galleryOverride()}
	{:else}
	<section class="gal">
		<Reveal>
			<div class="sec-head">
				<h2>Gallery</h2>
				{#if GALLERY_PAGE_LIVE}<a class="more" href="{base}/gallery">See more ›</a>{/if}
			</div>
		</Reveal>
		<Gallery brandId={brand.id} images={gallery} max={8} />
	</section>
	{/if}

	<!-- REVIEWS -->
	<ReviewsStrip {brand} {reviews} />

	<!-- INSTAGRAM -->
	<InstagramWall {brand} images={gallery} />

	<!-- QUICK LINKS -->
	<section class="links">
		<a href="{base}/menus">Menus</a>
		<a href="{base}/bookings">Book a Table</a>
		<!-- Fusion only — parties are held in Fusion's back room, never in Asia. -->
		{#if brand.id === 'fusion'}
			<a href="{base}/parties">Parties &amp; Functions</a>
		{/if}
		<a href="{base}/gift-cards">Gift Vouchers</a>
		<a href="{base}/reviews">Reviews</a>
		<a href="{base}/contact">Contact</a>
	</section>
</div>

<style>
	.home-sections {
		background: var(--page-bg);
		color: var(--ink);
		font-family: var(--font-serif);
		padding-bottom: 2rem;
	}

	/* ===== FUSION AMBIENT (gallery / reviews / social) =====
	   Fusion's home page carries a warm gold wash and concentric ring motif through
	   every band it owns; this block continues it across the SHARED sections, which
	   otherwise stopped dead at flat green and made the bottom half of the page look
	   like a different design.
	   Done with gradients on a pseudo-element rather than markup, so nothing about
	   this component's DOM changes and Asia — which must not get it — is untouched.
	   Each ring is a radial-gradient with two hard stops one pixel apart. */
	.home-sections[data-brand='fusion'] {
		position: relative;
		isolation: isolate;
	}
	.home-sections[data-brand='fusion']::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		background:
			/* Alphas kept LOW on purpose. At 0.22/0.16 these lifted the whole lower
			   half of the page to a sage green — the wash is meant to be a tint you
			   notice on the second look, not a lighter ground. */
			radial-gradient(circle at 88% 12%, rgba(221, 130, 54, 0.1), transparent 42%),
			radial-gradient(circle at 6% 54%, rgba(90, 145, 132, 0.07), transparent 38%),
			radial-gradient(circle at 78% 88%, rgba(221, 130, 54, 0.07), transparent 40%),
			radial-gradient(
				circle at 88% 12%,
				transparent 0 300px,
				rgba(221, 130, 54, 0.1) 300px 301px,
				transparent 301px
			),
			radial-gradient(
				circle at 88% 12%,
				transparent 0 212px,
				rgba(232, 171, 107, 0.09) 212px 213px,
				transparent 213px
			),
			radial-gradient(
				circle at 6% 54%,
				transparent 0 268px,
				rgba(90, 145, 132, 0.1) 268px 269px,
				transparent 269px
			);
	}
	/* Lift the real content clear of the wash. */
	.home-sections[data-brand='fusion'] > * {
		position: relative;
		z-index: 1;
	}
	section {
		max-width: 1200px;
		margin: 0 auto;
		padding: 3.5rem 1.6rem;
	}
	.sec-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 1.6rem;
	}
	.sec-head h2 {
		font-size: clamp(1.8rem, 4vw, 2.8rem);
		margin: 0;
		font-weight: 500;
	}
	.more {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--accent);
		text-decoration: none;
	}
	.offer-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.2rem;
	}
	.offer {
		position: relative;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 1.8rem 1.6rem;
		text-decoration: none;
		color: var(--ink);
		display: block;
		transition:
			transform 0.25s ease,
			border-color 0.25s ease;
	}
	.offer:hover {
		transform: translateY(-3px);
		border-color: var(--accent);
	}
	.offer .price {
		position: absolute;
		top: 1.2rem;
		right: 1.2rem;
		color: var(--accent);
		font-size: 1.4rem;
		font-weight: 600;
	}
	.offer h3 {
		margin: 0 0 0.2rem;
		font-size: 1.5rem;
		font-weight: 500;
	}
	.offer .when {
		font-family: var(--font-sans);
		font-size: 0.64rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent-2, var(--accent));
	}
	.offer p {
		margin: 0.5rem 0 0;
		color: var(--ink-soft);
		font-size: 1rem;
		line-height: 1.5;
	}
	.order-banner .ob-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.4rem;
		flex-wrap: wrap;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 2.2rem 2.2rem;
	}
	.order-banner h2 {
		font-size: clamp(1.8rem, 4vw, 2.6rem);
		margin: 0 0 0.3rem;
		font-weight: 500;
	}
	.order-banner p {
		margin: 0;
		color: var(--ink-soft);
		font-size: 1.1rem;
	}
	.ob-cta {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.collect {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.1rem;
		color: var(--accent);
		text-decoration: none;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 1.4rem 2.4rem;
		justify-content: center;
		border-top: 1px solid var(--line);
	}
	.links a {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--ink-soft);
		text-decoration: none;
		transition: color 0.25s ease;
	}
	.links a:hover {
		color: var(--accent);
	}
	/* ===== ASIA — "What's On" as a printed insert =====
	   The band carries the watercolour from the menu artwork: geisha at the left
	   edge, lanterns and blossom at the right, pale washed paper through the
	   middle. That inverts everything about this block — dark ink and ivory text
	   everywhere else on the page — so it is re-tuned to dark-on-paper rather
	   than merely recoloured.
	   The artwork frames rather than fills: content sits in the pale centre, and
	   the cards are translucent paper so the wash still reads through them where
	   they do overlap the figure or the lanterns. */
	.home-sections[data-brand='asia'] .whats-on-band {
		--paper-ink: #2b1d1f;
		--paper-ink-soft: #6a5153;
		--paper-red: #c22f4a;
		--paper-red-deep: #9d2038;
		position: relative;
		background-image: url('/art/asia-whats-on-bg-1280.webp');
		background-image: image-set(
			url('/art/asia-whats-on-bg-1280.avif') type('image/avif'),
			url('/art/asia-whats-on-bg-1280.webp') type('image/webp')
		);
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		padding: 1rem 0 2.4rem;
		color: var(--paper-ink);
	}
	/* Only a breath of veil — enough to soften the two hard horizontal cuts where
	   the paper meets the ink above and below. The artwork is otherwise left
	   alone; the content is kept off it by the inset below instead. */
	.home-sections[data-brand='asia'] .whats-on-band::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			180deg,
			rgba(255, 252, 250, 0.5) 0%,
			rgba(255, 252, 250, 0) 12%,
			rgba(255, 252, 250, 0) 88%,
			rgba(255, 252, 250, 0.5) 100%
		);
		pointer-events: none;
	}
	/* The artwork is a FRAME: figure down the left edge, lanterns and blossom down
	   the right, washed paper through the middle. Holding the content to the
	   middle ~72% keeps both of those clear instead of parking a card on the
	   geisha's face. Percentages track the art because `cover` scales the image to
	   the band's width at any viewport this rule applies to. */
	.home-sections[data-brand='asia'] .whats-on-band > section {
		position: relative;
		z-index: 1;
		max-width: min(1160px, 72vw);
	}

	/* The band takes the redesign's display face — the one the printed menu and
	   the hero are set in — so it reads as part of that family rather than the
	   old shared-section serif. */
	.home-sections[data-brand='asia'] .whats-on-band .sec-head h2,
	.home-sections[data-brand='asia'] .whats-on-band .order-banner h2,
	.home-sections[data-brand='asia'] .offer h3 {
		font-family: 'Shippori Mincho', Georgia, serif;
		font-weight: 600;
		color: var(--paper-ink);
		letter-spacing: 0.01em;
	}
	/* The head runs narrower than the cards: its two ends are the only content
	   that would otherwise land on the figure and on the lanterns. The halo
	   carries it over the wash without needing a plate behind it. */
	.home-sections[data-brand='asia'] .whats-on-band .sec-head {
		width: 86%;
		margin-inline: auto;
	}
	.home-sections[data-brand='asia'] .whats-on-band .sec-head h2,
	.home-sections[data-brand='asia'] .whats-on-band .more {
		text-shadow: 0 1px 14px rgba(255, 252, 250, 0.95);
	}
	/* Gold is invisible on paper — the "more" links take the menu's red. */
	.home-sections[data-brand='asia'] .whats-on-band .more {
		color: var(--paper-red-deep);
		border-bottom: 1px solid transparent;
		padding-bottom: 2px;
		transition: border-color 0.3s ease;
	}
	.home-sections[data-brand='asia'] .whats-on-band .more:hover,
	.home-sections[data-brand='asia'] .whats-on-band .more:focus-visible {
		border-bottom-color: var(--paper-red-deep);
	}

	/* Paper cards, squared off like the redesign's buttons. Opaque enough to hold
	   body copy over the busiest part of the wash, with the blur keeping them
	   feeling laid ON the artwork rather than cut out of it. Equal heights: the
	   grid row stretches, so the anchor has to claim the whole cell. */
	.home-sections[data-brand='asia'] .offer {
		height: 100%;
		box-sizing: border-box;
		background: rgba(255, 252, 249, 0.94);
		backdrop-filter: blur(6px) saturate(115%);
		-webkit-backdrop-filter: blur(6px) saturate(115%);
		border: 1px solid rgba(194, 47, 74, 0.32);
		border-radius: 0;
		color: var(--paper-ink);
		box-shadow: 0 14px 34px -20px rgba(88, 30, 40, 0.5);
		transition:
			transform 0.35s cubic-bezier(0.22, 0.9, 0.3, 1),
			border-color 0.35s ease,
			background 0.35s ease,
			box-shadow 0.35s ease;
	}
	.home-sections[data-brand='asia'] .offer:hover {
		transform: translateY(-4px);
		background: #fffefc;
		border-color: var(--paper-red);
		box-shadow: 0 22px 44px -22px rgba(88, 30, 40, 0.55);
	}
	/* Reveal wraps each card, so the stretch has to be passed through it. */
	.home-sections[data-brand='asia'] .offer-row > :global(*) {
		height: 100%;
	}
	.home-sections[data-brand='asia'] .offer h3 {
		color: var(--paper-ink);
	}
	.home-sections[data-brand='asia'] .offer .price {
		color: var(--paper-red-deep);
	}
	.home-sections[data-brand='asia'] .offer .when {
		color: var(--paper-red);
	}
	.home-sections[data-brand='asia'] .offer p {
		color: var(--paper-ink-soft);
	}

	/* The at-home banner becomes the same sheet of paper. */
	.home-sections[data-brand='asia'] .order-banner .ob-inner {
		background: rgba(255, 252, 249, 0.94);
		backdrop-filter: blur(6px) saturate(115%);
		-webkit-backdrop-filter: blur(6px) saturate(115%);
		border: 1px solid rgba(194, 47, 74, 0.28);
		border-radius: 0;
		box-shadow: 0 14px 34px -22px rgba(88, 30, 40, 0.55);
	}
	.home-sections[data-brand='asia'] .order-banner p {
		color: var(--paper-ink-soft);
	}
	.home-sections[data-brand='asia'] .collect {
		color: var(--paper-red-deep);
	}

	/* Below this the band is taller than it is wide-enough-for, so `cover` starts
	   cropping the frame off the sides anyway — let the content have the width. */
	@media (max-width: 1080px) {
		.home-sections[data-brand='asia'] .whats-on-band > section {
			max-width: 1200px;
		}
	}
	@media (max-width: 700px) {
		/* Cover on a tall, narrow box crops to the pale middle of the artwork and
		   loses the figure entirely, so drop to the small rung and let the paper
		   simply be paper. */
		.home-sections[data-brand='asia'] .whats-on-band {
			background-image: url('/art/asia-whats-on-bg-800.webp');
			background-image: image-set(
				url('/art/asia-whats-on-bg-800.avif') type('image/avif'),
				url('/art/asia-whats-on-bg-800.webp') type('image/webp')
			);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.home-sections[data-brand='asia'] .offer:hover {
			transform: none;
		}
	}

	/* ===== FUSION editorial variant (gucciosteria.com-inspired) =====
	   Scoped to [data-brand='fusion']; Asia keeps the rounded-card defaults above.
	   Flatter, hairline-ruled, serif headings, slower editorial hovers. */
	.home-sections[data-brand='fusion'] section {
		padding-left: var(--frame-inset, 1.6rem);
		padding-right: var(--frame-inset, 1.6rem);
	}
	.home-sections[data-brand='fusion'] .sec-head h2,
	.home-sections[data-brand='fusion'] .order-banner h2 {
		font-family: var(--font-display);
		font-weight: 400;
		letter-spacing: 0;
	}
	.home-sections[data-brand='fusion'] .more {
		text-transform: none;
		letter-spacing: 0.04em;
		font-size: 0.78rem;
	}
	.home-sections[data-brand='fusion'] .offer {
		background: transparent;
		border: 0;
		border-top: 1px solid var(--frame-line, var(--line));
		border-radius: 0;
		padding: 1.6rem 0.2rem 1.4rem;
		transition:
			background 0.45s var(--ease-editorial),
			padding-left 0.45s var(--ease-editorial);
	}
	.home-sections[data-brand='fusion'] .offer:hover {
		transform: none;
		border-color: var(--frame-line, var(--line));
		background: color-mix(in srgb, var(--accent) 5%, transparent);
		padding-left: 1rem;
	}
	/* The base card pins .price absolutely to its top-right corner, which works
	   there because that card has 1.6rem of horizontal padding to keep the title
	   clear of it. Fusion's card strips the padding to 0.2rem, so a long title
	   ("Traditional Sunday Roast") ran straight under the price and the two
	   overlapped. Laying the row out as a real grid — title left, price right on the
	   same baseline — removes the collision instead of papering over it. */
	.home-sections[data-brand='fusion'] .offer {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		column-gap: 1rem;
		align-items: baseline;
	}
	.home-sections[data-brand='fusion'] .offer h3 {
		grid-column: 1;
		grid-row: 1;
		font-family: var(--font-display);
		font-weight: 400;
		font-size: 1.3rem;
	}
	.home-sections[data-brand='fusion'] .offer .price {
		position: static;
		grid-column: 2;
		grid-row: 1;
		font-family: var(--font-serif);
		font-style: italic;
		/* A shade smaller than the base 1.4rem: "From £14.95" is a long price and
		   this keeps it on one line beside the longest title. */
		font-size: 1.2rem;
		text-align: right;
		white-space: nowrap;
	}
	/* Both run the full width under the title/price row. */
	.home-sections[data-brand='fusion'] .offer .when,
	.home-sections[data-brand='fusion'] .offer p {
		grid-column: 1 / -1;
	}
	/* The shared sections set their prose in --font-serif, which is Cormorant for
	   both brands. Fusion sets its running copy in the grotesk everywhere else, so
	   without this the gallery/reviews/offers bands were the only Fusion surfaces
	   in a serif body face. (Asia deliberately untouched — same fix there would
	   need checking against its own pages.) */
	.home-sections[data-brand='fusion'] {
		font-family: var(--font-body);
	}
	.home-sections[data-brand='fusion'] .order-banner .ob-inner {
		background: transparent;
		border: 0;
		border-top: 1px solid var(--frame-line, var(--line));
		border-bottom: 1px solid var(--frame-line, var(--line));
		border-radius: 0;
		padding: 2.4rem 0.2rem;
	}
	.home-sections[data-brand='fusion'] .links {
		border-top: 1px solid var(--frame-line, var(--line));
	}
	.home-sections[data-brand='fusion'] .links a {
		text-transform: none;
		letter-spacing: 0.04em;
		font-size: 0.82rem;
	}

	/* Asia's section heads outside the What's On band (Gallery) were still in the
	   old shared serif, so the page ran Shippori → Cormorant → Jost → Shippori down
	   its headings. Fusion already sets all of its heads in its display face.
	   "Keep it Social" is already in the display face but at 500, the one lighter
	   head on the page. :global — that h2 belongs to InstagramWall.svelte, and the
	   rule is here rather than there because on the gallery page, where the same
	   block follows a 500-weight page title, 500 is the right weight. */
	.home-sections[data-brand='asia'] .sec-head h2,
	.home-sections[data-brand='asia'] :global(.ig h2) {
		font-family: var(--font-display);
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	@media (max-width: 760px) {
		.offer-row {
			grid-template-columns: 1fr;
		}
		/* Two stacked sections each bring 3.5rem, which on a phone opened a 112px
		   hole between the last offer and the at-home card. */
		.order-banner {
			padding-top: 0;
		}
		/* The small-caps labels were 10–11px. */
		.more {
			position: relative;
			font-size: 0.75rem;
		}
		/* ...and a 14px-tall line of text is not a tap target. Grown invisibly, so
		   the head's baseline alignment doesn't move. */
		.more::after {
			content: '';
			position: absolute;
			inset: -14px -8px;
		}
		.offer .when {
			font-size: 0.75rem;
		}
		/* "Takeaway ›" is a 20px-tall line of italic beside a 46px button. Same
		   invisible hit area as .more. */
		.collect {
			position: relative;
		}
		.collect::after {
			content: '';
			position: absolute;
			inset: -12px -8px;
		}
		/* Quick links: tappable rows, and less dead ground around a two-line strip.
		   The tracking and gap come in a touch so Asia's five links break 2 + 3 at
		   360px too; at 0.22em the last row was 2px too wide there and "Contact"
		   dropped to a third row on its own. (Fusion sets its own tracking.) */
		.links {
			gap: 0.2rem 1.2rem;
			padding-top: 2rem;
			padding-bottom: 1.4rem;
		}
		.links a {
			padding: 0.85rem 0.3rem;
			font-size: 0.75rem;
			letter-spacing: 0.18em;
		}

		/* FUSION — the same 20px gutter as every section of the Fusion page above
		   this block and the footer below it. --frame-inset is 6vw here (23.4px at
		   390), and the rows then indented their text another 3px. The hover indent
		   goes too: there is no hover on a phone, only a row left shifted after a
		   tap. */
		.home-sections[data-brand='fusion'] section {
			padding-left: 20px;
			padding-right: 20px;
		}
		.home-sections[data-brand='fusion'] .offer,
		.home-sections[data-brand='fusion'] .offer:hover,
		.home-sections[data-brand='fusion'] .order-banner .ob-inner {
			padding-left: 0;
			padding-right: 0;
		}
		/* FUSION — the ambient washes are sized by `farthest-corner`, which on a
		   desktop block is a pool of colour in one corner. A phone column is ~390px
		   wide and ~4,600px tall, so the same gradients reach 1,700px and lay a flat
		   brown film over the whole block, with a hard brown-to-green seam where it
		   meets the Reserve band above and the flip cards inside it. Give each wash
		   a fixed radius so it is a pool again. The three rings are unchanged. */
		.home-sections[data-brand='fusion']::before {
			background:
				radial-gradient(circle 460px at 88% 12%, rgba(221, 130, 54, 0.1), transparent 100%),
				radial-gradient(circle 420px at 6% 54%, rgba(90, 145, 132, 0.07), transparent 100%),
				radial-gradient(circle 460px at 78% 88%, rgba(221, 130, 54, 0.07), transparent 100%),
				radial-gradient(
					circle at 88% 12%,
					transparent 0 300px,
					rgba(221, 130, 54, 0.1) 300px 301px,
					transparent 301px
				),
				radial-gradient(
					circle at 88% 12%,
					transparent 0 212px,
					rgba(232, 171, 107, 0.09) 212px 213px,
					transparent 213px
				),
				radial-gradient(
					circle at 6% 54%,
					transparent 0 268px,
					rgba(90, 145, 132, 0.1) 268px 269px,
					transparent 269px
				);
		}

		/* ASIA — one 20px gutter down the whole page. The sections above this
		   component (hero, story, menu) sit at 20px; these sat at 25.6px, and the
		   What's On head was narrowed again to dodge artwork a phone crops away. */
		.home-sections[data-brand='asia'] section {
			padding-left: 20px;
			padding-right: 20px;
		}
		.home-sections[data-brand='asia'] .whats-on-band .sec-head {
			width: 100%;
		}
		/* Title and price on one baseline, as Fusion's rows are. Pinned to the
		   corner, the price floated above the title and a longer title ran under it. */
		.home-sections[data-brand='asia'] .offer {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: 1rem;
			align-items: baseline;
			align-content: start;
		}
		.home-sections[data-brand='asia'] .offer h3 {
			grid-column: 1;
			grid-row: 1;
		}
		.home-sections[data-brand='asia'] .offer .price {
			position: static;
			grid-column: 2;
			grid-row: 1;
			white-space: nowrap;
		}
		.home-sections[data-brand='asia'] .offer .when,
		.home-sections[data-brand='asia'] .offer p {
			grid-column: 1 / -1;
		}
		/* Same inner edge as the offer cards directly above it. */
		.home-sections[data-brand='asia'] .order-banner .ob-inner {
			padding: 1.8rem 1.6rem;
		}
		/* ASIA — no backdrop blur on a phone. The paper is 94% opaque and at this
		   width it lies on the pale middle of the wash, so the blur changes nothing
		   you can see (checked side by side) — but four blurred panels still have to
		   be re-sampled on every frame they scroll, which is the classic cause of a
		   stuttering scroll on an iPhone. */
		.home-sections[data-brand='asia'] .offer,
		.home-sections[data-brand='asia'] .order-banner .ob-inner {
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
		/* "Keep it Social" brings 3rem of its own on top of the reviews block's
		   bottom padding: a 104px hole on Asia and 105px on Fusion, where the other
		   sections on both pages stand ~70px apart. :global — the section belongs
		   to InstagramWall.svelte, which is also used on the gallery pages, where
		   it follows a different block and keeps its own spacing. */
		.home-sections :global(.ig) {
			padding-top: 1rem;
		}
	}
	/* The Gallery child pads itself 1.2rem inside this section's own gutter, so on
	   a phone the photo grid sat ~19px inside the "Gallery" head and its "See
	   more" link. :global — the class belongs to Gallery.svelte. */
	@media (max-width: 520px) {
		.gal :global(.gallery) {
			padding-inline: 0;
		}
	}
</style>
