<script lang="ts">
	// ── Fusion-only "What's On" ────────────────────────────────────────────────
	// A genuinely different take on the offers page: instead of an equal-weight
	// card grid, this is a weekly BROADSHEET / theatre programme.
	//   • a masthead with rule-lines + an "issue" line,
	//   • the first offer promoted to a full-width HEADLINE ACT (huge display
	//     numeral, oversized price, generous lede),
	//   • the rest typeset as numbered LEDGER ENTRIES in two columns — no boxes,
	//     just hairline rules and a dotted leader running to the price (the same
	//     .dots leader the menu uses, so FusionMotion's row choreography applies).
	//
	// This is Fusion-only by design. OffersPanel.svelte stays the shared/Asia
	// version; only the Fusion route swaps in this component, so Asia is untouched.
	import type { Brand } from '$lib/data/brand';
	import { OFFERS, type Offer } from '$lib/data/offers';
	import UberEatsButton from './UberEatsButton.svelte';
	import TouchTakeawayButton from './TouchTakeawayButton.svelte';

	// `offers` override from the editable-content loader; falls back to static OFFERS.
	let { brand, offers: offersProp }: { brand: Brand; offers?: Offer[] } = $props();
	const base = $derived(`/${brand.id}`);
	const offers = $derived(offersProp ?? OFFERS[brand.id]);

	// First offer headlines the bill; the remainder run as the ledger.
	const lead = $derived(offers[0]);
	const rest = $derived(offers.slice(1));

	const num = (i: number) => String(i + 1).padStart(2, '0');
</script>

<section class="bill" data-brand={brand.id}>
	<!-- Masthead — reads like the top of a programme, not a page title. -->
	<header class="masthead head">
		<p class="kicker">The Bill · {brand.name}</p>
		<h1>What&rsquo;s On</h1>
		<p class="lead">Specials, deals and the good stuff — a standing programme, served on rotation.</p>
	</header>

	<!-- HEADLINE ACT — the first offer, given the whole stage. -->
	{#if lead}
		<article class="headline visit-block">
			<span class="seat" aria-hidden="true">{num(0)}</span>
			<div class="hl-body">
				<p class="when">{lead.when}</p>
				<h2>{lead.title}</h2>
				<p class="blurb">{lead.blurb}</p>
				<div class="actions">
					{#if lead.href}
						<a class="link" href={lead.href}>View menu ›</a>
					{/if}
					<a class="link strong" href="{base}/bookings">Reserve ›</a>
					{#if lead.delivery}
						<UberEatsButton href={brand.uberEatsUrl} size="sm" />
						<TouchTakeawayButton href={brand.touchTakeawayUrl} size="sm" />
					{/if}
				</div>
			</div>
			{#if lead.price}
				<div class="hl-price">
					<span class="px">{lead.price}</span>
				</div>
			{/if}
		</article>
	{/if}

	<!-- LEDGER — the remaining offers as typeset programme entries. -->
	<div class="ledger menu">
		{#each rest as o, i}
			<article class="entry item">
				<span class="no" aria-hidden="true">{num(i + 1)}</span>
				<div class="lines">
					<div class="row">
						<h3>{o.title}</h3>
						<span class="dots" aria-hidden="true"></span>
						{#if o.price}
							<span class="price">{o.price}</span>
						{:else}
							<span class="price open">Walk in</span>
						{/if}
					</div>
					<p class="when">{o.when}</p>
					<p class="blurb">{o.blurb}</p>
					<div class="actions">
						{#if o.href}
							<a class="link" href={o.href}>View menu ›</a>
						{/if}
						<a class="link" href="{base}/bookings">Reserve ›</a>
						{#if o.delivery}
							<UberEatsButton href={brand.uberEatsUrl} size="sm" />
							<TouchTakeawayButton href={brand.touchTakeawayUrl} size="sm" />
						{/if}
					</div>
				</div>
			</article>
		{/each}
	</div>

	<footer class="colophon">
		<span class="rule" aria-hidden="true"></span>
		<p>Programme subject to change. Bookings advised for the headline act.</p>
	</footer>
</section>

<style>
	.bill {
		max-width: 1140px;
		margin: 0 auto;
		padding: clamp(1.6rem, 3.5vw, 2.6rem) var(--frame-inset, 1.6rem) 5rem;
		color: var(--ink);
		font-family: var(--font-serif);
	}

	/* ── Masthead ─────────────────────────────────────────────────────────── */
	.masthead {
		text-align: center;
		border-top: 1px solid var(--frame-line, var(--line));
		border-bottom: 1px solid var(--frame-line, var(--line));
		padding: 1.4rem 0 1.8rem;
		margin-bottom: clamp(1.4rem, 3vw, 2.2rem);
	}
	.kicker {
		font-family: var(--font-sans);
		font-size: 0.62rem;
		letter-spacing: 0.42em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0 0 0.7rem;
	}
	h1 {
		font-family: var(--font-display);
		font-size: clamp(2.8rem, 8vw, 5.6rem);
		line-height: 0.95;
		margin: 0;
		font-weight: 400;
		letter-spacing: -0.01em;
	}
	.lead {
		font-style: italic;
		color: var(--ink-soft);
		margin: 0.9rem auto 0;
		max-width: 34ch;
		font-size: 1.05rem;
	}

	/* ── Headline act ─────────────────────────────────────────────────────── */
	.headline {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: clamp(1.2rem, 4vw, 3rem);
		align-items: center;
		padding: clamp(1.8rem, 4vw, 3rem) 0;
		border-bottom: 2px solid var(--frame-line, var(--line));
		margin-bottom: clamp(1.6rem, 4vw, 2.6rem);
	}
	.seat {
		font-family: var(--font-display);
		font-size: clamp(3rem, 9vw, 7rem);
		line-height: 0.8;
		color: var(--accent);
		opacity: 0.92;
		font-weight: 400;
	}
	.hl-body {
		min-width: 0;
	}
	.headline h2 {
		font-family: var(--font-display);
		font-size: clamp(1.9rem, 4.6vw, 3.3rem);
		line-height: 1.04;
		margin: 0.2rem 0 0.5rem;
		font-weight: 400;
	}
	.headline .blurb {
		color: var(--ink-soft);
		font-size: 1.12rem;
		line-height: 1.5;
		margin: 0 0 1rem;
		max-width: 46ch;
	}
	.hl-price {
		text-align: right;
		align-self: start;
	}
	.hl-price .px {
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3.4rem);
		color: var(--accent);
		font-weight: 400;
		white-space: nowrap;
	}

	/* ── Ledger ───────────────────────────────────────────────────────────── */
	.ledger {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		column-gap: clamp(2rem, 6vw, 4.5rem);
	}
	.entry {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 1.1rem;
		padding: 1.6rem 0;
		border-top: 1px solid var(--line);
	}
	/* First row in each column has no top rule (the masthead/headline already
	   capped the stack); the third entry starts column two. */
	.ledger > .entry:nth-child(1),
	.ledger > .entry:nth-child(2) {
		border-top: none;
	}
	.no {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.15em;
		color: var(--accent);
		padding-top: 0.55rem;
		font-variant-numeric: tabular-nums;
	}
	.lines {
		min-width: 0;
	}
	.row {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}
	.entry h3 {
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 400;
		margin: 0;
		line-height: 1.1;
		flex-shrink: 0;
	}
	/* Dotted leader — same motif FusionMotion draws across menu rows. */
	.dots {
		flex: 1;
		align-self: flex-end;
		margin-bottom: 0.32rem;
		border-bottom: 1.5px dotted var(--ink-faint);
		min-width: 1rem;
	}
	.price {
		font-family: var(--font-display);
		font-size: 1.4rem;
		color: var(--accent);
		white-space: nowrap;
		flex-shrink: 0;
	}
	.price.open {
		font-size: 0.66rem;
		font-family: var(--font-sans);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--ink-faint);
		align-self: center;
	}

	.when {
		font-family: var(--font-sans);
		font-size: 0.66rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--accent-2, var(--accent));
		margin: 0.55rem 0 0;
	}
	.entry .blurb {
		color: var(--ink-soft);
		font-size: 1.02rem;
		line-height: 1.5;
		margin: 0.35rem 0 0.7rem;
	}

	/* ── Actions ──────────────────────────────────────────────────────────── */
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem 1.3rem;
		align-items: center;
	}
	.link {
		font-family: var(--font-sans);
		font-size: 0.68rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent);
		text-decoration: none;
		position: relative;
		padding-bottom: 2px;
	}
	.link::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 1px;
		background: currentColor;
		transform: scaleX(0);
		transform-origin: left;
		transition: transform 0.4s var(--ease-editorial, ease);
	}
	.link:hover::after {
		transform: scaleX(1);
	}
	.link.strong {
		color: var(--ink);
	}

	/* ── Colophon ─────────────────────────────────────────────────────────── */
	.colophon {
		margin-top: clamp(2.4rem, 6vw, 4rem);
		text-align: center;
	}
	.colophon .rule {
		display: block;
		width: 48px;
		height: 1px;
		background: var(--frame-line, var(--line));
		margin: 0 auto 1rem;
	}
	.colophon p {
		font-family: var(--font-sans);
		font-size: 0.66rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-faint);
		margin: 0;
	}

	/* ── Responsive — collapse the broadsheet to a single readable column ──── */
	@media (max-width: 760px) {
		.bill {
			padding-bottom: 3.5rem;
		}
		.kicker {
			font-size: 0.75rem;
			letter-spacing: 0.3em;
		}
		.lead {
			text-wrap: balance;
		}

		/* Headline act. `.hl-body` dissolves (display: contents) so its lines and the
		   price become one column beside the numeral, which lets the price sit where
		   it reads — under the blurb, above the links — instead of trailing after
		   the call to action. Row gap is zero: the lines keep their own margins. */
		.headline {
			grid-template-columns: auto 1fr;
			align-items: start;
			gap: 0 1rem;
			padding: 1.7rem 0 1.5rem;
		}
		.seat {
			grid-row: 1 / span 5;
			font-size: clamp(2.75rem, 9vw, 7rem);
			padding-top: 0.3rem;
		}
		.hl-body {
			display: contents;
		}
		.headline .when,
		.headline h2,
		.headline .blurb,
		.headline .actions,
		.hl-price {
			grid-column: 2 / 3;
			min-width: 0;
		}
		.headline .when {
			margin-top: 0;
		}
		.headline h2 {
			margin: 0.35rem 0 0.5rem;
			text-wrap: balance;
		}
		.headline .blurb {
			margin-bottom: 0.6rem;
		}
		.hl-price {
			order: 1;
			text-align: left;
		}
		.hl-price .px {
			line-height: 1.1;
		}
		.headline .actions {
			order: 2;
			margin-top: 0.9rem;
		}

		.ledger {
			grid-template-columns: 1fr;
		}
		.ledger > .entry:nth-child(2) {
			border-top: 1px solid var(--line);
		}
		/* The title must be allowed to wrap. Held rigid (flex-shrink: 0), "Traditional
		   Sunday Roast" pushed "From £14.95" off the right edge and the whole page
		   scrolled sideways, dragging the top bar's logo off-centre with it. The price
		   stays on the first line; the leader gives way entirely once a title wraps. */
		.entry h3 {
			flex-shrink: 1;
			min-width: 0;
			text-wrap: balance;
		}
		.dots {
			align-self: baseline;
			margin-bottom: 0;
			min-width: 0;
		}
		.price.open {
			font-size: 0.75rem;
		}

		.when {
			font-size: 0.75rem;
			letter-spacing: 0.14em;
			line-height: 1.45;
			text-wrap: balance;
		}
		.blurb {
			text-wrap: pretty;
		}
		.actions {
			padding: 0.35rem 0;
		}
		.link {
			font-size: 0.75rem;
		}
		/* A 16px-tall text link is no tap target; grow the hit area, not the type. */
		.link::before {
			content: '';
			position: absolute;
			inset: -14px -8px;
		}
		.colophon p {
			font-size: 0.75rem;
			letter-spacing: 0.12em;
			line-height: 1.6;
			text-wrap: balance;
		}
	}

	/* Phone proper — trim the ledger type so a title and its price share a line. */
	@media (max-width: 480px) {
		.entry {
			gap: 0.8rem;
			padding: 1.4rem 0 1.2rem;
		}
		.row {
			gap: 0.5rem;
		}
		.entry h3 {
			font-size: 1.35rem;
		}
		.price {
			font-size: 1.15rem;
		}
	}
</style>
