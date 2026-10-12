<script lang="ts">
	// Post-booking confirmation, shown to guests by ResDiary.
	//
	// WHY THIS EXISTS
	// ---------------
	// ResDiary doesn't render its own "you're booked" page — it redirects to a URL
	// configured in the ResDiary account, passing the booking in the query string:
	//
	//   /fusion/booking-confirmation/?bookingReference=B26AMTW9
	//     &date=2026-08-04T00:00:00&time=12:00:00&partySize=1
	//     &micrositeName=GeishaFusionRestaurant
	//
	// That target is currently a page on the OLD WordPress site. When the domain
	// points here instead, that page stops existing and every guest who completes a
	// booking lands on a 404 — the reservation is taken correctly, but the last
	// thing they see is an error. This route replaces it.
	//
	// SHOWN INSIDE THE IFRAME
	// -----------------------
	// The redirect happens within the booking widget's frame, so this renders in a
	// ~440px box, not a full page. Hence no nav and no footer — it's deliberately
	// self-contained and narrow, and reads fine standalone if anyone opens the URL
	// directly. Links out use target="_top" so they escape the frame.
	//
	// NOTHING HERE IS TRUSTED
	// -----------------------
	// Every value is a query param the guest could edit, so this page only ever
	// echoes them back — it never confirms, cancels or changes anything. If they're
	// missing or malformed we drop the details and still say the booking is made,
	// because ResDiary only redirects here after it has actually taken it.
	import { page } from '$app/state';
	import type { Brand } from '$lib/data/brand';
	import { formatBookingDate, formatBookingTime } from '$lib/bookings/confirmation';

	let {
		brand,
		/**
		 * Rendering inside the booking iframe on the restaurant's own site.
		 *
		 * Drops BOTH site links. On our own /{brand}/booking-confirmation page they
		 * move the guest around the site they are already on — but every one of them
		 * carries target="_top", so in the frame they navigate the guest's WHOLE page
		 * off the restaurant's site and onto the Vercel host. "Back to Geisha Fusion"
		 * taking you away from Geisha Fusion is worse than no button, and "View our
		 * menus" is worse still: it's the link a happy guest is most likely to tap
		 * straight after paying a deposit.
		 */
		embedded = false
	}: { brand: Brand; embedded?: boolean } = $props();

	const tel = $derived(brand.phone.replace(/\s/g, ''));

	const reference = $derived(page.url.searchParams.get('bookingReference')?.trim() ?? '');
	const dateLabel = $derived(formatBookingDate(page.url.searchParams.get('date')));
	const timeLabel = $derived(formatBookingTime(page.url.searchParams.get('time')));

	/** Digits only — the raw value is guest-editable and gets printed verbatim. */
	const partySize = $derived(
		(page.url.searchParams.get('partySize')?.trim() ?? '').match(/^\d{1,3}$/)?.[0] ?? ''
	);

	const hasDetails = $derived(Boolean(reference || dateLabel || timeLabel || partySize));
</script>

<svelte:head>
	<title>Your table is booked — {brand.name}</title>
	<!-- A booking reference in the URL has no business in a search index. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<section class="bc" class:bc-embedded={embedded}>
	<p class="bc-eyebrow">{brand.name}</p>
	<h1>Your table is booked</h1>
	<p class="bc-lede">
		Thank you for booking with us — we're looking forward to having you.
	</p>

	{#if hasDetails}
		<dl class="bc-detail">
			{#if dateLabel}
				<div><dt>Date</dt><dd>{dateLabel}</dd></div>
			{/if}
			{#if timeLabel}
				<div><dt>Time</dt><dd>{timeLabel}</dd></div>
			{/if}
			{#if partySize}
				<div><dt>Guests</dt><dd>{partySize}</dd></div>
			{/if}
			{#if reference}
				<div><dt>Reference</dt><dd class="bc-ref">{reference}</dd></div>
			{/if}
		</dl>
	{/if}

	<p class="bc-note">
		A confirmation email is on its way. Please check your junk folder if it hasn't
		arrived shortly.
	</p>

	<h2>Need to make a change?</h2>
	<p class="bc-note">
		You can amend or cancel from your confirmation email, or just call us on
		<a href="tel:{tel}">{brand.phone}</a> — quote your reference and we'll sort it.
		You can also email
		<a href="mailto:{brand.email}">{brand.email}</a>.
	</p>

	{#if !embedded}
		<div class="bc-actions">
			<a class="bc-btn" target="_top" href="/{brand.id}/menus">View our menus</a>
			<a class="bc-btn" target="_top" href="/{brand.id}">Back to {brand.name}</a>
		</div>
	{/if}
</section>

<style>
	.bc {
		max-width: 34rem;
		margin: 0 auto;
		padding: clamp(1.75rem, 5vw, 3rem) 1.25rem clamp(2.5rem, 6vw, 4rem);
		text-align: center;
		/* The brand's prose face. Without it every line here but the two headings
		   fell through to the UA default — Times New Roman, tracked caps and all —
		   because .brand-page sets no family of its own. */
		font-family: var(--font-body, inherit);
	}

	/* In the frame the brand faces aren't the frame's: keep the widget's own type
	   (set on .embed-root) so the confirmation reads as the same form's last step. */
	.bc.bc-embedded {
		font-family: inherit;
	}

	.bc-eyebrow {
		margin: 0 0 0.5rem;
		font-size: 0.68rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		opacity: 0.6;
	}

	h1 {
		font-family: var(--font-display, 'Cormorant Garamond', serif);
		font-size: clamp(1.85rem, 6vw, 2.8rem);
		font-weight: 300;
		line-height: 1.1;
		margin: 0 0 0.85rem;
	}

	h2 {
		font-family: var(--font-display, 'Cormorant Garamond', serif);
		font-size: 1.25rem;
		font-weight: 400;
		margin: 2.25rem 0 0.6rem;
	}

	.bc-lede {
		margin: 0 0 1.75rem;
		opacity: 0.8;
		line-height: 1.6;
	}

	.bc-detail {
		margin: 0 0 1.75rem;
		padding: 1.1rem 1.25rem;
		border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
		border-radius: 2px;
		text-align: left;
	}

	.bc-detail > div {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		padding: 0.4rem 0;
	}

	.bc-detail > div + div {
		border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
	}

	dt {
		font-size: 0.7rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.6;
	}

	dd {
		margin: 0;
		font-size: 0.98rem;
		text-align: right;
	}

	.bc-ref {
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		letter-spacing: 0.06em;
	}

	.bc-note {
		margin: 0 0 0.9rem;
		font-size: 0.88rem;
		line-height: 1.65;
		opacity: 0.8;
	}

	a {
		color: inherit;
		text-decoration: none;
		border-bottom: 1px solid currentColor;
		white-space: nowrap;
	}

	.bc-actions {
		margin-top: 2rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		justify-content: center;
	}

	.bc-btn {
		border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
		border-bottom-color: color-mix(in srgb, currentColor 45%, transparent);
		border-radius: 2px;
		padding: 0.7rem 1.25rem;
		font-size: 0.74rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		white-space: nowrap;
		transition: background-color 0.2s ease, border-color 0.2s ease;
	}

	.bc-btn:hover {
		background: color-mix(in srgb, currentColor 10%, transparent);
		border-color: currentColor;
	}

	@media (max-width: 480px) {
		/* The tracked-caps labels sat at ~11px. */
		.bc-eyebrow,
		dt {
			font-size: 0.75rem;
		}

		/* Side by side the two links don't fit a phone, so they wrapped into two
		   centred boxes of different widths. Stacked, they share both edges. */
		.bc-actions {
			flex-direction: column;
		}

		.bc-btn {
			padding: 0.95rem 1.25rem;
			text-align: center;
		}

		/* On the site's own page the "Ask Geisha" button owns the bottom-right
		   corner; at the end of the scroll it sat on the last link's corner. */
		.bc:not(.bc-embedded) {
			padding-bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bc-btn {
			transition: none;
		}
	}
</style>
