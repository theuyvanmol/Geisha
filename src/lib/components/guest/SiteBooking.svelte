<script lang="ts">
	// THE BOOKING PAGE'S FORM — our own booking system, not ResDiary's.
	//
	// This mounts EmbedBookingWidget, the same component that has been taking the
	// restaurants' real online bookings since September 2026 from inside an iframe
	// on the old WordPress site (/embed/{brand}/book). It is used here unchanged —
	// same steps, same /api calls, same Stripe card form, same light card — so the
	// booking page inherits a flow that is already proven with real guests and real
	// payments, rather than introducing a second one.
	//
	// What differs from the iframe is only the wrapping:
	//   • It is mounted straight into the page, so there is no fixed-height frame
	//     and no inner scrollbar; the card grows with each step.
	//   • After booking it sends the guest to /{brand}/booking-confirmation (the
	//     site's own page, with the nav) instead of the chromeless embed one.
	//   • No cookie gate. The ResDiary frame was a third party we could not see
	//     inside, so it waited for consent; this form is first-party and sets
	//     nothing. Stripe's script loads only if a booking needs a card, and only
	//     once the guest has pressed "Complete booking".
	//
	// To put the ResDiary widget back, set DEFAULT_ENGINE to 'resdiary' in
	// $lib/bookings/engine.ts — ResDiaryWidget.svelte is kept for exactly that.
	import type { Brand } from '$lib/data/brand';
	import BookingBrandBar from './BookingBrandBar.svelte';
	import EmbedBookingWidget from './EmbedBookingWidget.svelte';

	let { brand }: { brand: Brand } = $props();

	const tel = $derived(brand.phone.replace(/\s/g, ''));
	const info = $derived({ id: brand.id, name: brand.name, phone: brand.phone, email: brand.email });
</script>

<svelte:head>
	<!-- The card form's script, warmed up only at the DNS/TLS level: nothing is
	     fetched from Stripe until a booking actually needs a card. -->
	<link rel="preconnect" href="https://js.stripe.com" />
</svelte:head>

<section class="sb">
	<header class="sb-head">
		<BookingBrandBar {brand} />
		<p class="sb-sub">
			Reserve online below, or call us on <a href="tel:{tel}">{brand.phone}</a>.
		</p>
	</header>

	<div class="sb-body">
		<!-- The two troubleshooting lines that sat above the ResDiary frame ("No times
		     showing?", "Booking for more than 8?") are not repeated here: this form
		     says both itself, in place, at the step where the guest would ask. -->
		<div class="sb-card">
			<EmbedBookingWidget brand={info} redirectTo="/{brand.id}/booking-confirmation" />
		</div>

		<aside class="sb-notes">
			<h2>Terms</h2>
			<p>
				Reservations are held for 20 minutes past the booking time unless you let us
				know you're running late.
			</p>
			<p>
				Tables of 3–5 on Fridays and Saturdays need card details to confirm. A £5 per
				person fee applies to a no-show or late cancellation.
			</p>
			<p>
				Tables of 6 or more need a £10 per person deposit at any time, taken off your
				final bill. Deposits aren't refundable on a no-show or late cancellation.
			</p>
		</aside>
	</div>
</section>

<style>
	.sb {
		max-width: 1080px;
		margin: 0 auto;
		padding: clamp(3rem, 8vw, 6rem) 1.5rem 4rem;
		font-family: var(--font-body, 'Jost', system-ui, sans-serif);
	}

	.sb-head {
		margin-bottom: clamp(2rem, 5vw, 3rem);
	}

	/* Held to the bar's own column so it lines up with the restaurant name above. */
	.sb-sub {
		max-width: 720px;
		margin: 0.9rem auto 0;
		opacity: 0.75;
	}

	.sb-sub a {
		color: inherit;
		text-decoration: none;
		border-bottom: 1px solid currentColor;
		white-space: nowrap;
	}

	.sb-body {
		display: grid;
		gap: clamp(2rem, 5vw, 3.5rem);
		align-items: start;
		/* Form first on wide screens, above the terms on narrow ones. */
		grid-template-columns: minmax(0, 1fr);
	}

	@media (min-width: 900px) {
		.sb-body {
			grid-template-columns: minmax(320px, 440px) minmax(0, 1fr);
		}
	}

	/* The form's own surface: a plain light card, exactly as it is drawn inside the
	   iframe on the old site — the widget brings its colours with it, and its type
	   and box model come from the embed layout there, so both are restated here.
	   Lifted over Asia's falling petals (a fixed canvas at z 60), which otherwise
	   drift across the dates and the buttons; still under the assistant button (95)
	   and the top bar (180). */
	.sb-card {
		position: relative;
		z-index: 61;
		width: 100%;
		max-width: 440px;
		margin: 0 auto;
		border-radius: 2px;
		overflow: hidden;
		background: #fff;
		color: #1a1f2b;
		font-family: 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	.sb-card :global(*) {
		max-width: 100%;
		box-sizing: border-box;
	}

	.sb-notes {
		font-size: 0.95rem;
		line-height: 1.65;
	}

	.sb-notes p {
		margin: 0 0 1rem;
		opacity: 0.85;
	}

	.sb-notes h2 {
		font-family: var(--font-display, 'Cormorant Garamond', serif);
		font-size: 1.4rem;
		font-weight: 400;
		margin: 0 0 0.75rem;
	}

	/* Phones: get to the form. Same breakpoint as BookingBrandBar's stack. */
	@media (max-width: 620px) {
		.sb {
			padding: 1.75rem 1.5rem 3.5rem;
		}

		.sb-head {
			margin-bottom: 1.25rem;
		}

		.sb-sub {
			margin-top: 0.75rem;
		}

		.sb-body {
			gap: 2.25rem;
		}
	}
</style>
