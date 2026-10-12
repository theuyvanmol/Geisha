<script lang="ts">
	// Reviews ("What guests say") — a structured editorial "ledger". A two-part
	// masthead (title left, a solid boxed rating plaque right) sits over a clean,
	// equal-height grid of review cards. Each card is framed with a gold/terracotta
	// accent rule, an inline quotation glyph in the text flow (no floating
	// decorations), and a byline pinned to a shared baseline — so everything stays
	// on a real grid. Driven entirely by reviews.ts and themed via data-brand tokens
	// (Asia gold-on-lacquer, Fusion terracotta-on-paper editorial).
	import type { Brand } from '$lib/data/brand';
	import { REVIEWS, type BrandReviews } from '$lib/data/reviews';
	import Reveal from './Reveal.svelte';
	import Stars from './Stars.svelte';

	// `reviews` override from the editable-content loader; falls back to static REVIEWS.
	let { brand, reviews }: { brand: Brand; reviews?: BrandReviews } = $props();
	const data = $derived(reviews ?? REVIEWS[brand.id]);
	const base = $derived(`/${brand.id}`);

	// Masthead rating numeral, split so the integer and decimal can be scaled like a
	// printed score (e.g. 4 · .7).
	const ratingWhole = $derived(Math.trunc(data.average).toString());
	const ratingFrac = $derived(
		data.average % 1 ? `.${data.average.toString().split('.')[1]}` : ''
	);
</script>

<section class="reviews" data-brand={brand.id}>
	<!-- ===== Masthead: title left, rating plaque right ===== -->
	<header class="head">
		<div class="head-title">
			<span class="kicker">Reviews</span>
			<h1>What guests <em>say</em></h1>
		</div>

		<div class="plaque">
			<span class="plaque-score" aria-hidden="true"
				><span class="whole">{ratingWhole}</span><span class="frac">{ratingFrac}</span></span
			>
			<div class="plaque-meta">
				<Stars value={data.average} size="1.05rem" />
				<span class="plaque-line">
					out of 5 · {data.count.toLocaleString()} reviews on
					<a href={data.tripAdvisorUrl} target="_blank" rel="noopener noreferrer">TripAdvisor</a>
				</span>
			</div>
		</div>
	</header>

	<!-- ===== Review ledger ===== -->
	<div class="grid">
		{#each data.items as r, i}
			<Reveal delay={i * 0.06} y={28}>
				<figure class="card">
					<span class="num" aria-hidden="true">{(i + 1).toString().padStart(2, '0')}</span>
					<h2 class="card-title">{r.title}</h2>
					<Stars value={r.rating} size="0.92rem" />
					<blockquote>
						<span class="q" aria-hidden="true">“</span>{r.body}”
					</blockquote>
					<figcaption class="by">
						<span class="name">{r.author}</span>
						<span class="src">{r.source}</span>
					</figcaption>
				</figure>
			</Reveal>
		{/each}
	</div>

	<!-- ===== Footer CTAs ===== -->
	<div class="foot">
		<a class="more" href={data.tripAdvisorUrl} target="_blank" rel="noopener noreferrer"
			>Read all {data.count.toLocaleString()} reviews on TripAdvisor ›</a
		>
		<a class="book" href="{base}/bookings">Book a Table ›</a>
	</div>
</section>

<style>
	.reviews {
		max-width: 1120px;
		margin: 0 auto;
		padding: clamp(2.6rem, 5vw, 4rem) clamp(1.2rem, 5vw, 2rem) clamp(3.4rem, 6vw, 5.5rem);
		color: var(--ink);
		font-family: var(--font-serif);
	}

	/* ===== Masthead ===== */
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: clamp(1.4rem, 4vw, 3rem);
		flex-wrap: wrap;
		padding-bottom: clamp(1.6rem, 3vw, 2.4rem);
		margin-bottom: clamp(2rem, 4vw, 3rem);
		border-bottom: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
	}
	.head-title {
		min-width: 0;
	}
	.kicker {
		display: block;
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: var(--accent-2, var(--accent));
		margin-bottom: 0.9rem;
	}
	h1 {
		font-family: var(--font-display);
		font-size: clamp(2.6rem, 6vw, 4.4rem);
		font-weight: 400;
		line-height: 0.98;
		margin: 0;
	}
	h1 em {
		font-family: var(--font-serif);
		font-style: italic;
		color: var(--accent);
	}

	/* solid rating plaque */
	.plaque {
		display: flex;
		align-items: center;
		gap: clamp(0.9rem, 2vw, 1.3rem);
		flex: 0 0 auto;
	}
	.plaque-score {
		font-family: var(--font-display);
		font-weight: 400;
		line-height: 0.78;
		color: var(--accent);
		display: inline-flex;
		align-items: baseline;
	}
	.plaque-score .whole {
		font-size: clamp(3.2rem, 7vw, 4.6rem);
	}
	.plaque-score .frac {
		font-size: clamp(1.5rem, 3.4vw, 2.1rem);
		opacity: 0.85;
	}
	.plaque-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
	}
	.plaque-line {
		font-style: italic;
		color: var(--ink-soft);
		font-size: 0.9rem;
		line-height: 1.3;
		max-width: 21ch;
	}
	.plaque-line a {
		color: var(--accent);
		font-style: normal;
		text-decoration: none;
		border-bottom: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.plaque-line a:hover {
		border-color: var(--accent);
	}

	/* ===== Review ledger grid ===== */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: clamp(1.2rem, 2.4vw, 1.8rem);
	}
	/* the Reveal wrapper is the grid item — make its card fill the cell height */
	.grid > :global(.reveal) {
		display: flex;
	}

	.card {
		position: relative;
		margin: 0;
		width: 100%;
		display: grid;
		/* title | stars | quote(flex) | byline — byline pins to the bottom */
		grid-template-rows: auto auto 1fr auto;
		gap: 0.85rem;
		padding: clamp(1.6rem, 2.4vw, 2.1rem) clamp(1.5rem, 2.2vw, 2rem) clamp(1.4rem, 2vw, 1.8rem);
		background: var(--card);
		border: 1px solid var(--line);
		/* gold/terracotta accent rule down the leading edge — the brand "rim" */
		border-left: 3px solid color-mix(in srgb, var(--accent) 70%, transparent);
		transition:
			border-color 0.3s var(--ease-editorial),
			transform 0.3s var(--ease-editorial);
	}
	.card:hover {
		border-color: var(--line);
		border-left-color: var(--accent);
		transform: translateY(-3px);
	}

	.num {
		position: absolute;
		top: clamp(1.1rem, 2vw, 1.5rem);
		right: clamp(1.3rem, 2vw, 1.7rem);
		font-family: var(--font-sans);
		font-size: 0.68rem;
		letter-spacing: 0.2em;
		color: color-mix(in srgb, var(--accent) 60%, transparent);
		font-feature-settings: 'tnum' 1;
	}
	.card-title {
		margin: 0;
		padding-right: 2.4rem; /* clear the corner number */
		font-family: var(--font-display);
		font-size: clamp(1.35rem, 2.2vw, 1.7rem);
		font-weight: 400;
		line-height: 1.1;
		color: var(--ink);
	}
	blockquote {
		margin: 0;
		color: var(--ink-soft);
		font-size: 1.06rem;
		line-height: 1.6;
		font-style: italic;
	}
	/* inline opening quote — sits in the text flow, sized & coloured as a flourish */
	.q {
		font-family: var(--font-display);
		font-style: normal;
		font-size: 1.5em;
		line-height: 0;
		color: var(--accent);
		margin-right: 0.04em;
		vertical-align: -0.18em;
	}

	.by {
		display: flex;
		align-items: baseline;
		gap: 0.7rem;
		padding-top: 0.9rem;
		margin-top: 0.2rem;
		border-top: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
		flex-wrap: wrap;
	}
	.name {
		font-family: var(--font-serif);
		font-size: 1.02rem;
		color: var(--ink);
	}
	.src {
		font-family: var(--font-sans);
		font-size: 0.6rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin-left: auto;
	}

	/* ===== Footer ===== */
	.foot {
		margin-top: clamp(2.6rem, 5vw, 4rem);
		padding-top: clamp(1.6rem, 3vw, 2.2rem);
		border-top: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 2rem;
		justify-content: space-between;
		align-items: center;
	}
	.more,
	.book {
		font-family: var(--font-sans);
		font-size: 0.74rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		text-decoration: none;
	}
	.more {
		color: var(--ink-soft);
	}
	.more:hover {
		color: var(--accent);
	}
	.book {
		color: var(--accent);
	}
	.book:hover {
		text-decoration: underline;
	}

	/* ===== FUSION editorial variant — flat paper, terracotta rule, no lift ===== */
	.reviews[data-brand='fusion'] .card {
		background: transparent;
		border-color: var(--frame-line, var(--line));
		border-left-color: color-mix(in srgb, var(--accent) 75%, transparent);
	}
	.reviews[data-brand='fusion'] .card:hover {
		transform: none;
		border-color: var(--frame-line, var(--line));
		border-left-color: var(--accent);
	}
	.reviews[data-brand='fusion'] .by {
		border-top-color: var(--frame-line, var(--line));
	}

	/* ===== Responsive ===== */
	@media (max-width: 760px) {
		.head {
			align-items: flex-start;
			flex-direction: column;
		}
		.plaque {
			gap: 1rem;
		}
		/* A finger-sized target for the one link in the masthead, without moving
		   the line it sits on. The hit area is a pseudo-element, not padding: the
		   link's underline is its border-bottom, and padding dropped that rule
		   9px below the word it belongs to. */
		.plaque-line a {
			position: relative;
		}
		.plaque-line a::after {
			content: '';
			position: absolute;
			inset: -0.85rem -0.4rem;
		}
		/* Two-line titles break evenly instead of dropping one word ("Nice place
		   for Asian / food"). */
		.card-title {
			text-wrap: balance;
		}
		/* The small caps were 9.6px and 10.9px — too small to read on a phone. */
		.num {
			font-size: 0.72rem;
		}
		.src {
			font-size: 0.72rem;
			letter-spacing: 0.18em;
		}
		/* The two closing links stack, each a full 44px row: as wrapped text links
		   they sat 16px apart and were easy to mis-tap. Slightly tighter tracking
		   keeps the TripAdvisor line on one row down to a 360px screen. */
		.foot {
			flex-direction: column;
			align-items: flex-start;
			gap: 0;
			padding-top: 1rem;
		}
		.more,
		.book {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
			letter-spacing: 0.12em;
		}
	}
	@media (max-width: 480px) {
		.grid {
			grid-template-columns: 1fr;
		}
		/* "What guests say" filled a 360px screen to within 3px at the desktop
		   minimum; scale it with the width so it always holds one line. */
		h1 {
			font-size: clamp(2.2rem, 10.5vw, 2.6rem);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card {
			transition: none;
		}
		.card:hover {
			transform: none;
		}
	}
</style>
