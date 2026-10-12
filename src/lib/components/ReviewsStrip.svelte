<script lang="ts">
	// Homepage "What guests say" teaser — the aggregate rating + a few featured
	// quotes, linking to the full /reviews page. Lives inside HomeSections so both
	// homepages get it; themed via data-brand tokens (Asia dark/gold, Fusion flat
	// hairline editorial) so it sits naturally in each house's density block.
	import type { Brand } from '$lib/data/brand';
	import { REVIEWS, type BrandReviews } from '$lib/data/reviews';
	import Reveal from './Reveal.svelte';
	import Stars from './Stars.svelte';

	// `reviews` override from the editable-content loader; falls back to static REVIEWS.
	let { brand, reviews }: { brand: Brand; reviews?: BrandReviews } = $props();
	const data = $derived(reviews ?? REVIEWS[brand.id]);
	const base = $derived(`/${brand.id}`);
	// Three on the homepage; the rest live on /reviews.
	const featured = $derived(data.items.slice(0, 3));
</script>

<section class="reviews-strip" data-brand={brand.id}>
	<Reveal>
		<div class="sec-head">
			<div class="title-wrap">
				<h2>What guests say</h2>
				<div class="agg">
					<Stars value={data.average} />
					<span class="agg-line"
						>{data.average} / 5 · {data.count.toLocaleString()} reviews</span
					>
				</div>
			</div>
			<a class="more" href="{base}/reviews">All reviews ›</a>
		</div>
	</Reveal>

	<div class="quote-row">
		{#each featured as r, i}
			<Reveal delay={i * 0.06}>
				<figure class="quote">
					<Stars value={r.rating} />
					<blockquote>“{r.body}”</blockquote>
					<figcaption>
						<span class="name">{r.author}</span>
						<span class="src">{r.source}</span>
					</figcaption>
				</figure>
			</Reveal>
		{/each}
	</div>
</section>

<style>
	.reviews-strip {
		max-width: 1200px;
		margin: 0 auto;
		padding: 3.5rem 1.6rem;
		font-family: var(--font-body);
		color: var(--ink);
	}
	.sec-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.2rem;
		margin-bottom: 1.6rem;
		flex-wrap: wrap;
	}
	.title-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.sec-head h2 {
		font-size: clamp(1.8rem, 4vw, 2.8rem);
		margin: 0;
		font-weight: 500;
	}
	.agg {
		display: inline-flex;
		align-items: center;
		gap: 0.7rem;
	}
	.agg-line {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.1em;
		color: var(--ink-soft);
	}
	.more {
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--accent);
		text-decoration: none;
	}
	.quote-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.2rem;
	}
	.quote {
		margin: 0;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 1.8rem 1.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		transition:
			transform 0.25s ease,
			border-color 0.25s ease;
	}
	.quote:hover {
		transform: translateY(-3px);
		border-color: var(--accent);
	}
	blockquote {
		margin: 0;
		font-size: 1.02rem;
		line-height: 1.55;
		font-style: italic;
		color: var(--ink-soft);
		flex: 1;
	}
	figcaption {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.name {
		font-size: 1rem;
		color: var(--ink);
	}
	.src {
		font-family: var(--font-sans);
		font-size: 0.58rem;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}

	/* ===== FUSION editorial variant — gucciosteria.com "divided slab" look =====
	   Hold the content WELL clear of the two fixed frame margin rules (which live at
	   --frame-inset from each edge) by padding an extra gutter inside them — so the
	   cards never butt against, or have their top hairline collide with, the verticals.
	   That extra breathing room is what stops it reading as a squished grid. */
	.reviews-strip[data-brand='fusion'] {
		padding-left: calc(var(--frame-inset, 1.6rem) + clamp(1.4rem, 4vw, 3.5rem));
		padding-right: calc(var(--frame-inset, 1.6rem) + clamp(1.4rem, 4vw, 3.5rem));
		padding-top: clamp(4rem, 8vw, 6rem);
		padding-bottom: clamp(4rem, 8vw, 6rem);
	}
	.reviews-strip[data-brand='fusion'] .sec-head {
		margin-bottom: clamp(2rem, 4vw, 3.2rem);
	}
	.reviews-strip[data-brand='fusion'] .sec-head h2 {
		font-family: var(--font-display);
		font-weight: 400;
		letter-spacing: 0;
	}
	.reviews-strip[data-brand='fusion'] .more {
		text-transform: none;
		letter-spacing: 0.04em;
		font-size: 0.78rem;
	}
	/* Give the cards their own column gap so the three top-hairlines read as three
	   separate ledger entries, not one continuous strip jammed into the frame. */
	.reviews-strip[data-brand='fusion'] .quote-row {
		gap: clamp(2rem, 4vw, 3.4rem);
	}
	.reviews-strip[data-brand='fusion'] .quote {
		background: transparent;
		border: 0;
		border-top: 1px solid var(--frame-line, var(--line));
		border-radius: 0;
		padding: 1.7rem 0 1.4rem;
		gap: 1rem;
		transition:
			background 0.45s var(--ease-editorial),
			padding-left 0.45s var(--ease-editorial);
	}
	.reviews-strip[data-brand='fusion'] .quote:hover {
		transform: none;
		border-color: var(--frame-line, var(--line));
		background: transparent;
		padding-left: 0;
	}
	.reviews-strip[data-brand='fusion'] blockquote {
		/* Pull-quote serif, but Fusion's own (Libre Baskerville) — this used to be
		   Cormorant, i.e. Asia's face, on a Fusion page. */
		font-family: var(--font-display);
		font-size: 1.08rem;
		line-height: 1.65;
	}
	.reviews-strip[data-brand='fusion'] figcaption {
		margin-top: 0.3rem;
	}

	/* Asia's head was inheriting the body grotesk — the only section heading on
	   the Asia home page not in its display face (Fusion sets its own above). */
	.reviews-strip[data-brand='asia'] .sec-head h2 {
		font-family: var(--font-display);
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	@media (max-width: 760px) {
		.quote-row {
			grid-template-columns: 1fr;
			gap: 1rem;
		}
		/* The small-caps labels were 9–11px. */
		.agg-line {
			font-size: 0.78rem;
		}
		.src {
			font-size: 0.75rem;
		}
		.more {
			position: relative;
			font-size: 0.75rem;
		}
		/* An invisible finger-sized hit area; nothing in the head moves. */
		.more::after {
			content: '';
			position: absolute;
			inset: -14px -8px;
		}
		/* Asia: the page's 20px phone gutter (see HomeSections), and cards that
		   don't spend a fifth of their width on padding. */
		.reviews-strip[data-brand='asia'] {
			padding-left: 20px;
			padding-right: 20px;
		}
		.reviews-strip[data-brand='asia'] .quote {
			padding: 1.5rem 1.3rem;
		}
		/* Fusion: the extra gutter is there to clear the frame's vertical rules,
		   which a phone doesn't draw — with it the quotes sat 22px inside the
		   What's On rows directly above them. Back to the page's 20px phone gutter
		   (see HomeSections). The bottom padding comes in as well: the last quote
		   brings its own, and with the full 4rem under it there was a 150px hole
		   before "Keep it Social". */
		.reviews-strip[data-brand='fusion'] {
			padding-left: 20px;
			padding-right: 20px;
			padding-bottom: 2.2rem;
		}
		/* The 1rem stack gap above never reached Fusion — its own column gap
		   out-specifies it — so each quote sat 54px off the rule below it and 27px
		   off the rule above. */
		.reviews-strip[data-brand='fusion'] .quote-row {
			gap: 1rem;
		}
	}
	/* A quote is not a link. On a touch screen :hover sticks after a tap, so a thumb
	   resting on a card mid-scroll left it lifted 3px with an accent border, like a
	   selection, until something else was tapped. (Fusion's rows never lift.) */
	@media (hover: none) {
		.quote:hover {
			transform: none;
			border-color: var(--line);
		}
	}
</style>
