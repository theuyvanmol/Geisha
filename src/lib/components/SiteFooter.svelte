<script lang="ts">
	// Shared 4-column footer (Visit · Contact · Hours · Essentials), driven
	// entirely by brand config. Themed per brand via data-brand tokens.
	import type { Brand } from '$lib/data/brand';
	import type { PublicHours } from '$lib/hours';
	import { staticPublicHours } from '$lib/hours';
	import { page } from '$app/state';
	import UberEatsButton from './UberEatsButton.svelte';
	import TouchTakeawayButton from './TouchTakeawayButton.svelte';
	import { openConsentPrompt } from '$lib/consent.svelte';
	import { CIRCLE_LIVE, COMING_SOON, GALLERY_PAGE_LIVE } from '$lib/data/features';

	let { brand, hours }: { brand: Brand; hours?: PublicHours } = $props();
	const base = $derived(`/${brand.id}`);

	// Opening Times come from the LIVE service periods (geisha_service_periods) —
	// the same rows the admin diary runs on — supplied by the brand layout load as
	// `data.hours`. This footer is on 26 pages, so reading it from layout data
	// rather than a per-page prop is what stops it drifting from the diary again.
	// The static brand.hours table is only a last-resort shape for the rare case
	// this component is mounted outside a brand layout.
	const h = $derived<PublicHours>(
		hours ??
			(page.data.hours as PublicHours | undefined) ??
			staticPublicHours(brand.id, brand.hours, brand.hoursNote ?? '')
	);
	// Live last-booking times first (they're a fact the diary owns), then the
	// editable kitchen/last-orders note underneath.
	const note = $derived([h.lastBookingNote, h.note].filter(Boolean).join(' '));
</script>

<footer class="site-foot" data-brand={brand.id}>
	<div class="cols">
		<div class="col">
			<h3>Visit</h3>
			<p class="brandname">{brand.name}</p>
			<p>{brand.address.line1}</p>
			<p>{brand.address.city}</p>
			<p>{brand.address.postcode}</p>
			<p class="metro">Nearest Metro — {brand.address.metro}</p>
		</div>

		<div class="col">
			<h3>Contact</h3>
			<p><a href="tel:{brand.phone.replace(/\s/g, '')}">{brand.phone}</a></p>
			<p><a href="mailto:{brand.email}">{brand.email}</a></p>
			<div class="social">
				<a href={brand.instagram} target="_blank" rel="noopener noreferrer">Instagram</a>
				<span class="sep">·</span>
				<a href={brand.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
			</div>
		</div>

		<div class="col">
			<h3>Opening Times</h3>
			<ul class="hours">
				{#each h.summary as row (row.day)}
					<li><span>{row.day}</span><span>{row.hours}</span></li>
				{/each}
			</ul>
			{#if note}
				<p class="note">{note}</p>
			{/if}
		</div>

		<div class="col">
			<h3>Essentials</h3>
			<nav class="links">
				<a href="{base}/bookings">Book a Table</a>
				<a href="{base}/menus">Menus</a>
				<a href="{base}/offers">What’s On</a>
				{#if GALLERY_PAGE_LIVE}
					<a href="{base}/gallery">Gallery</a>
				{/if}
				<a href="{base}/reviews">Reviews</a>
				{#if CIRCLE_LIVE}
					<a href="{base}/circle">The Circle — Rewards</a>
				{:else}
					<span class="soon">The Circle — Rewards <em>{COMING_SOON}</em></span>
				{/if}
				<!-- Fusion only — parties are held in Fusion's back room, never in Asia. -->
				{#if brand.id === 'fusion'}
					<a href="{base}/parties">Parties &amp; Functions</a>
				{/if}
				<a href="{base}/gift-cards">Gift Vouchers</a>
				<a href="{base}/order">Order / Takeaway</a>
				<a href="{base}/contact">Contact</a>
				<a href="{base}/privacy">Privacy &amp; Cookie Policy</a>
				<!-- Consent is only meaningful if it's withdrawable, so the banner needs a
				     way back. Styled as a link to sit in the nav list. -->
				<button type="button" class="as-link" onclick={openConsentPrompt}> Cookie Settings </button>
			</nav>
			<div class="uber-wrap">
				<UberEatsButton href={brand.uberEatsUrl} size="sm" />
				<TouchTakeawayButton href={brand.touchTakeawayUrl} size="sm" />
			</div>
		</div>
	</div>

	<div class="foot-base">
		<span>{brand.name} · {brand.address.postcode}</span>
		<a class="credit" href="https://www.gtdigital.dev" target="_blank" rel="noopener">
			<span class="credit-mark" role="img" aria-label="GTDS"></span>
			Developed by Giles Turnbull Digital Solutions
		</a>
		<a class="switch" href={brand.id === 'asia' ? '/fusion' : '/asia'}>
			Visit Geisha {brand.id === 'asia' ? 'Fusion' : 'Asia'} ›
		</a>
	</div>
</footer>

<style>
	.site-foot {
		background: var(--bg-2);
		color: var(--ink);
		border-top: 1px solid var(--line);
		padding: 4rem 2.2rem 2rem;
		/* --font-body / --font-display, not --font-sans / --font-serif (the rule of
		   thumb in tokens.css). Those resolve to Space Grotesk and Cormorant, which
		   are only linked by SOME pages — so this footer, the one block on every
		   page, changed typeface from page to page (system sans on the Fusion home,
		   Space Grotesk on Fusion's menus) and never matched the Jost body above it. */
		font-family: var(--font-body);
	}
	.cols {
		max-width: 1180px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 2.4rem;
	}
	.col h3 {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 1.2rem;
		color: var(--accent);
		margin: 0 0 1rem;
		letter-spacing: 0.02em;
	}
	.col p {
		margin: 0 0 0.35rem;
		font-size: 0.84rem;
		line-height: 1.5;
		color: var(--ink-soft);
	}
	.brandname {
		font-weight: 600;
		color: var(--ink);
	}
	.metro {
		margin-top: 0.7rem;
		font-size: 0.76rem;
		color: var(--ink-faint);
	}
	a {
		color: var(--ink-soft);
		text-decoration: none;
		transition: color 0.25s ease;
	}
	a:hover {
		color: var(--accent);
	}
	/* Cookie Settings has to be a <button> (it opens the banner, it isn't a
	   destination) but must read as one more item in the links column. */
	.as-link {
		font: inherit;
		font-size: 0.84rem;
		color: var(--ink-soft);
		background: none;
		border: 0;
		padding: 0;
		text-align: left;
		cursor: pointer;
		transition: color 0.25s ease;
	}
	.as-link:hover {
		color: var(--accent);
	}
	/* Not open to guests yet — listed, but plainly not a link. */
	.links .soon {
		font-size: 0.84rem;
		color: var(--ink-soft);
		opacity: 0.5;
		cursor: default;
	}
	.links .soon em {
		font-style: normal;
		font-size: 0.6rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		opacity: 0.9;
	}
	.social {
		margin-top: 0.7rem;
		font-size: 0.84rem;
	}
	.social .sep {
		color: var(--ink-faint);
		margin: 0 0.4rem;
	}
	.hours {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.hours li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.8rem;
		color: var(--ink-soft);
		padding: 0.12rem 0;
	}
	.note {
		margin-top: 0.7rem;
		font-size: 0.72rem;
		color: var(--ink-faint);
		line-height: 1.5;
	}
	.links {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		font-size: 0.84rem;
	}
	.uber-wrap {
		margin-top: 1.2rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.foot-base {
		max-width: 1180px;
		margin: 3rem auto 0;
		padding-top: 1.4rem;
		border-top: 1px solid var(--line);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.74rem;
		color: var(--ink-faint);
		letter-spacing: 0.04em;
	}
	.switch {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 0.95rem;
		color: var(--accent);
	}
	.credit {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--ink-faint);
	}
	/* The mark is drawn as a mask so it takes the text colour — the two brands
	   theme this footer differently and one fixed-colour image would not suit both. */
	.credit-mark {
		flex: none;
		width: 3rem;
		height: 0.875rem;
		background: currentColor;
		-webkit-mask: url('/gtds-mark-white.png') center / contain no-repeat;
		mask: url('/gtds-mark-white.png') center / contain no-repeat;
	}

	/* ===== FUSION editorial variant (gucciosteria.com-inspired) =====
	   Scoped to [data-brand='fusion']; Asia keeps the defaults above. Hairline
	   column separators, serif headings, Title-Case grotesk labels. */
	.site-foot[data-brand='fusion'] {
		background: var(--bg);
		border-top: 1px solid var(--frame-line, var(--line));
		padding-left: var(--frame-inset, 2.2rem);
		padding-right: var(--frame-inset, 2.2rem);
	}
	.site-foot[data-brand='fusion'] .cols {
		gap: 0;
	}
	/* thin vertical rules between the four columns, à la the reference footer */
	.site-foot[data-brand='fusion'] .col {
		padding: 0 2rem;
		border-left: 1px solid var(--frame-line, var(--line));
	}
	.site-foot[data-brand='fusion'] .col:first-child {
		border-left: 0;
		padding-left: 0;
	}
	.site-foot[data-brand='fusion'] .col h3 {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: 1.05rem;
		letter-spacing: 0.04em;
	}
	.site-foot[data-brand='fusion'] .col p,
	.site-foot[data-brand='fusion'] .hours li,
	.site-foot[data-brand='fusion'] .links {
		font-family: var(--font-body);
	}
	.site-foot[data-brand='fusion'] .foot-base {
		border-top: 1px solid var(--frame-line, var(--line));
	}
	.site-foot[data-brand='fusion'] .switch {
		font-family: var(--font-display);
		font-style: normal;
		font-size: 0.82rem;
		letter-spacing: 0.06em;
	}

	@media (max-width: 860px) {
		.cols {
			grid-template-columns: repeat(2, 1fr);
			gap: 2rem;
		}
		/* drop the column rules once the grid wraps so they don't dangle */
		.site-foot[data-brand='fusion'] .col {
			border-left: 0;
			padding: 0;
		}
		.site-foot[data-brand='fusion'] .cols {
			gap: 2rem;
		}
		/* `.col p` out-specifies the bare `.metro` / `.note`, so their top margin has
		   never applied: the last-bookings note sat hard under the Sunday row and the
		   Metro line hard under the postcode, as if each were one more row of the list.
		   Scoped to tablet and below only because this pass must leave desktop as it
		   is — the four-column footer has the same flaw and wants the same rule. */
		.col .metro,
		.col .note {
			margin-top: 0.8rem;
		}
		/* Three items no longer fit on one line; the credit takes its own below. */
		.foot-base {
			flex-wrap: wrap;
		}
		.credit {
			order: 3;
			flex-basis: 100%;
			justify-content: center;
		}
	}
	@media (max-width: 520px) {
		/* One gutter for both brands, and the same 1.25rem the pages above use. It was
		   2.2rem on Asia and --frame-inset (≈22px) on Fusion, so the left edge jumped
		   where the page met the footer — by 15px on Asia. Less air on top as well:
		   stacked to one column this block is over a screen and a half tall. */
		.site-foot,
		.site-foot[data-brand='fusion'] {
			padding-top: 2.75rem;
			padding-left: 1.25rem;
			padding-right: 1.25rem;
		}
		.cols,
		.site-foot[data-brand='fusion'] .cols {
			grid-template-columns: 1fr;
			gap: 1.9rem;
		}
		/* Same heading in both houses now that they share a face. */
		.col h3,
		.site-foot[data-brand='fusion'] .col h3 {
			font-size: 1.1rem;
			margin-bottom: 0.7rem;
		}
		.col p,
		.social,
		.links,
		.links .soon,
		.as-link {
			font-size: 0.9rem;
		}
		/* Phone, email and the two socials are the lines people actually tap here,
		   and each was a 19px-tall target. The air around them moves from the
		   paragraph's margin into the link's own padding. */
		.col p:has(a) {
			margin: 0;
		}
		.col p a,
		.social a {
			display: inline-block;
			padding: 0.45rem 0;
		}
		.social {
			margin-top: 0;
		}
		/* Essentials: eleven links in a single file were 17px tall on a 24px pitch —
		   too tight to hit one without its neighbour — and ran to a third of a
		   screen. Two columns of 40px rows are both easier to tap and shorter. */
		.links {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0 1rem;
		}
		.links > * {
			display: flex;
			align-items: center;
			min-height: 40px;
		}
		/* "Coming soon" drops under its label rather than squeezing the half column. */
		.links .soon {
			flex-wrap: wrap;
			align-content: center;
			column-gap: 0.4rem;
		}
		/* The two order buttons are child components; they were 28px tall. */
		.uber-wrap :global(a) {
			min-height: 40px;
			box-sizing: border-box;
		}
		.foot-base {
			margin-top: 2rem;
		}
		.foot-base {
			flex-direction: column;
			text-align: center;
			gap: 0.8rem;
		}
		.credit {
			flex-basis: auto;
			flex-wrap: wrap;
		}
		/* The two footnotes. Written as bare `.metro, .note` this never applied —
		   `.col p` out-specifies it — so both were set at the full 0.9rem of the lines
		   they annotate, and the Metro line filled its measure to the pixel (349px of
		   350 at 390 wide): one rounding difference on a real phone from dropping
		   "yards)" onto a line of its own. A step down reads as a note and leaves it
		   room; `balance` so that when either wraps it wraps evenly (without it the
		   hours note breaks inside "Mon–Fri" at this size). */
		.col .metro,
		.col .note {
			font-size: 0.82rem;
			text-wrap: balance;
		}
		.foot-base {
			font-size: 0.78rem;
		}
		.hours li {
			font-size: 0.9rem;
		}
	}

	/* The footer is the last element on every page, so it carries the bottom
	   clearance for whatever is pinned over it. That used to be Asia's floating pill
	   and Fusion's sticky action bar (hence 7rem); both are gone, and what's left is
	   the "Ask Geisha" button in the bottom-right corner — 52px tall, 0.9rem up. The
	   credit line spans nearly the full width, so it still has to END above the
	   button: 5rem leaves it 14px clear, and gives back 32px of dead ground. */
	@media (max-width: 760px) {
		.site-foot {
			padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
