<script lang="ts">
	// "Which restaurant am I booking?" — the identity band that opens the booking
	// page, and the one-tap way out of the wrong one.
	//
	// WHY THIS EXISTS: staff report guests regularly booking the wrong restaurant
	// (owner, Aug 2026). The cause was on the page rather than in the widget — the
	// booking page's heading was a bare "Book a Table" and named no restaurant
	// anywhere. The only clue you were on Asia rather than Fusion was the small
	// wordmark in the nav and the phone number in a subheading. Two restaurants
	// sharing a name, a street AND a postcode is exactly the case that needs
	// telling apart explicitly.
	//
	// The switch could not go INSIDE the booking form: each ResDiary widget is an
	// iframe pinned to one restaurant ID (two separate microsites, see
	// ResDiaryWidget), and nothing outside the frame can add a selector to it. So
	// the choice sits around the widget instead — which is also why it's a link to
	// the other booking page rather than a <select>: it has to survive a full
	// navigation either way.
	//
	// Engine-agnostic on purpose. It takes only `brand`, so when the bespoke flow
	// goes live (BookingPanel / FusionBookingDial) it's one import each, and the
	// eventual both-restaurants availability search can replace it wholesale
	// without touching either widget.
	import { getBrand, type Brand } from '$lib/data/brand';

	let { brand }: { brand: Brand } = $props();

	/** The one you might have meant instead. */
	const other = $derived(getBrand(brand.id === 'asia' ? 'fusion' : 'asia'));
</script>

<div class="bb" data-brand={brand.id}>
	<div class="bb-id">
		<span class="bb-eyebrow">You're booking</span>
		<h1>{brand.name}</h1>
		<p class="bb-dishes">{brand.dishes}</p>
	</div>

	<!-- Not styled as a primary button: it must be unmissable to the person in the
	     wrong place and ignorable by everyone else, since the great majority ARE
	     in the right place and a second loud CTA next to "Book a Table" would just
	     compete with it. -->
	<a class="bb-switch" href={other.bookingUrl}>
		<span class="bb-switch-lead">Looking for {other.name}?</span>
		<span class="bb-switch-cta">
			Book there instead
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"
				><path d="M5 12h14M13 6l6 6-6 6" /></svg
			>
		</span>
	</a>
</div>

<!-- The reason the mistake happens at all, said plainly. Both restaurants are at
     Front Street, Benton — so "check the address" is useless advice and the menu
     is the only thing that tells them apart. -->
<p class="bb-note">
	Both our restaurants are on Front Street in Benton. They serve different menus — do check
	you're booking the one you want.
</p>

<style>
	.bb {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: clamp(1rem, 3vw, 2rem);
		max-width: 720px;
		margin: 0 auto;
		padding: 0 0 1.25rem;
		border-bottom: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		text-align: left;
	}
	.bb-id {
		min-width: 0;
	}
	/* Every sans line in the bar reads --font-body (Jost on both brands), per the
	   rule in tokens.css. It read --font-sans — Space Grotesk, the pre-redesign
	   face — which put three typefaces on one phone screen: Shippori Mincho for the
	   name, Space Grotesk here, and the brand's prose face directly underneath. */
	.bb-eyebrow {
		display: block;
		font-family: var(--font-body, var(--font-sans));
		font-size: 0.68rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: 0.5rem;
	}
	/* The page's real <h1>. It replaced a bare "Book a Table", which is the same
	   sentence on both restaurants' booking pages and so told the guest nothing. */
	.bb h1 {
		font-family: var(--font-display, 'Cormorant Garamond', serif);
		font-size: clamp(2rem, 5vw, 3rem);
		font-weight: 300;
		line-height: 1.05;
		letter-spacing: 0.01em;
		margin: 0;
	}
	.bb-dishes {
		margin: 0.5rem 0 0;
		font-family: var(--font-body, var(--font-sans));
		font-size: 0.95rem;
		line-height: 1.5;
		opacity: 0.75;
	}

	.bb-switch {
		flex: 0 0 auto;
		display: block;
		padding: 0.85rem 1.1rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 2px;
		text-decoration: none;
		color: inherit;
		transition:
			border-color 0.3s ease,
			background 0.3s ease;
	}
	.bb-switch:hover,
	.bb-switch:focus-visible {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	.bb-switch-lead {
		display: block;
		font-family: var(--font-body, var(--font-sans));
		font-size: 0.8rem;
		line-height: 1.4;
		opacity: 0.75;
	}
	.bb-switch-cta {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		margin-top: 0.2rem;
		font-family: var(--font-body, var(--font-sans));
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.bb-switch-cta svg {
		width: 13px;
		height: 13px;
		transition: transform 0.3s ease;
	}
	.bb-switch:hover .bb-switch-cta svg {
		transform: translateX(3px);
	}

	.bb-note {
		max-width: 720px;
		margin: 1rem auto 0;
		font-family: var(--font-body, var(--font-sans));
		font-size: 0.85rem;
		line-height: 1.6;
		text-align: left;
		opacity: 0.6;
	}

	/* Stacked, the switch stops being a corner element and becomes the next thing
	   you read after the restaurant's name — which is the right order on a phone. */
	@media (max-width: 620px) {
		.bb {
			flex-direction: column;
			align-items: stretch;
			gap: 0.9rem;
			padding-bottom: 1rem;
		}
		.bb-eyebrow {
			font-size: 0.75rem;
			margin-bottom: 0.4rem;
		}
		.bb-switch {
			padding: 0.7rem 1rem;
			text-align: center;
		}
		.bb-note {
			margin-top: 0.85rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bb-switch,
		.bb-switch-cta svg {
			transition: none;
		}
	}
</style>
