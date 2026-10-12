<script lang="ts">
	// TEMPORARY BRIDGE — the live ResDiary booking widget.
	//
	// The bespoke booking flow (BookingPanel / FusionBookingDial) is parked while
	// the client keeps taking bookings through ResDiary, their current system.
	// When they're happy with the new system, delete this component and uncomment
	// the bespoke widgets in {asia,fusion}/bookings/+page.svelte.
	//
	// The widget IDs are lifted from the live WordPress site (geisharestaurants.co.uk),
	// so these are the SAME ResDiary diaries staff already work from — bookings taken
	// here land in the client's existing ResDiary, not in this project's database.
	//
	// The old site loaded this through ResDiary's WidgetV2Loader.js, which needs
	// jQuery and a global #rd-widget-frame div. A plain iframe to the same URL is
	// equivalent and drops both dependencies — the old site had exactly this iframe
	// sitting commented out beside the loader.
	import type { Brand } from '$lib/data/brand';
	import { consent, allowEmbedsOnce } from '$lib/consent.svelte';
	import BookingBrandBar from './BookingBrandBar.svelte';

	let { brand }: { brand: Brand } = $props();

	// booking.resdiary.com/widget/{widgetStyle}/{micrositeName}/{restaurantId}
	const WIDGETS: Record<Brand['id'], string> = {
		asia: 'https://booking.resdiary.com/widget/MiniTall/GeishaAsia/41012',
		fusion: 'https://booking.resdiary.com/widget/MiniTall/GeishaFusionRestaurant/40206'
	};

	const src = $derived(WIDGETS[brand.id]);
	const tel = $derived(brand.phone.replace(/\s/g, ''));
</script>

<section class="rd">
	<!-- The <h1> lives in BookingBrandBar and names the restaurant. It used to be a
	     bare "Book a Table" here — identical on both brands' booking pages, so it
	     never answered the one question a guest at the wrong restaurant needed
	     answering. See the component for the full note. -->
	<header class="rd-head">
		<BookingBrandBar {brand} />
		<p class="rd-sub">
			Reserve online below, or call us on <a href="tel:{tel}">{brand.phone}</a>.
		</p>
	</header>

	<!-- ABOVE the widget, deliberately (owner, Aug 2026).
	     These two lines used to live in the .rd-notes aside, which is the right-hand
	     column on wide screens and sits BELOW a 640px iframe on narrow ones — so on a
	     phone the guest hit "no times" and had already scrolled past the sentence
	     explaining it, and the "call us for 9+" line was two screens further down. The
	     answer has to precede the question. Terms stay in the aside; they're reference,
	     not troubleshooting. -->
	<div class="rd-tips">
		<p>
			<strong>No times showing?</strong> That means there's no availability for the day and time
			you picked — try another.
		</p>
		<p>
			<strong>Booking for more than 8?</strong> Please call us on
			<a href="tel:{tel}">{brand.phone}</a> and we'll arrange it.
		</p>
	</div>

	<div class="rd-body">
		<div class="rd-frame">
			{#if consent.embedsAllowed}
				<iframe {src} title="Book a table at {brand.name}" loading="lazy"></iframe>
			{:else}
				<!-- Declining cookies mustn't cost the restaurant a booking: the guest can
				     still load the form for this visit, or just phone. -->
				<div class="rd-hold">
					<p>
						Our booking form is provided by ResDiary and loads from their servers,
						which may set their own cookies.
					</p>
					<button type="button" onclick={allowEmbedsOnce}>Load the booking form</button>
					<p class="rd-hold-alt">
						Or call us on <a href="tel:{tel}">{brand.phone}</a>.
					</p>
				</div>
			{/if}
		</div>

		<aside class="rd-notes">
			<h2 class="first">Terms</h2>
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
	.rd {
		max-width: 1080px;
		margin: 0 auto;
		padding: clamp(3rem, 8vw, 6rem) 1.5rem 4rem;
		/* The brand's prose face. Nothing above this sets one on an interior page, so
		   every line here — tips, terms, the cookie gate — fell through to the UA
		   default and rendered in Times New Roman beside the bar's sans. */
		font-family: var(--font-body, 'Jost', system-ui, sans-serif);
	}

	/* Was centred, with its own h1 rule. Both went with the heading: the h1 now
	   lives in BookingBrandBar (Svelte styles don't cross component boundaries, so
	   the rule here would have been dead), and the bar sets its identity and switch
	   on a shared left edge — centring the line below it would break that edge. */
	.rd-head {
		margin-bottom: clamp(2rem, 5vw, 3rem);
	}

	/* Held to the bar's own column so it lines up with the restaurant name above. */
	.rd-sub {
		max-width: 720px;
		margin: 0.9rem auto 0;
		opacity: 0.75;
	}

	/* The troubleshooting pair, sat between the heading and the widget. Bordered
	   rather than plain text so it reads as guidance and not as more page furniture
	   — being above the fold is only half of being seen. */
	/* 720px border-box — the bar's own column, edge to edge. It was 640px of
	   content (681px with padding), 20px inside that column on each side; in the
	   brand's prose face, which sets wider than the Times it used to fall back to,
	   the first tip then broke on a desktop with "another." alone on a second line. */
	.rd-tips {
		box-sizing: border-box;
		max-width: 720px;
		margin: 0 auto clamp(1.6rem, 4vw, 2.4rem);
		padding: 1rem 1.25rem;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 2px;
		font-size: 0.95rem;
		line-height: 1.65;
	}

	.rd-tips p {
		margin: 0;
		opacity: 0.9;
	}

	.rd-tips p + p {
		margin-top: 0.65rem;
	}

	.rd-body {
		display: grid;
		gap: clamp(2rem, 5vw, 3.5rem);
		align-items: start;
		/* Widget column first on wide screens, above the notes on narrow ones. */
		grid-template-columns: minmax(0, 1fr);
	}

	@media (min-width: 900px) {
		.rd-body {
			grid-template-columns: minmax(320px, 440px) minmax(0, 1fr);
		}
	}

	/* Lifted over Asia's falling petals (SakuraPetals is a fixed canvas at z 60):
	   they drifted across the white form, over the dates and the Reserve button.
	   Still under the assistant button (95) and the top bar (180). */
	.rd-frame {
		position: relative;
		z-index: 61;
		width: 100%;
	}

	/* ResDiary publishes no postMessage resize protocol, so the height is fixed.
	   640px is the value from the old site's own iframe fallback: tall enough for
	   the times list once a date is picked, and it scrolls internally rather than
	   clipping if a busy day overflows. */
	.rd-frame iframe {
		display: block;
		width: 100%;
		max-width: 440px;
		height: 640px;
		margin: 0 auto;
		border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
		border-radius: 2px;
		background: #fff;
	}

	/* Placeholder stands in the frame's footprint so the layout doesn't jump when
	   the widget loads in. */
	.rd-hold {
		max-width: 440px;
		min-height: 340px;
		margin: 0 auto;
		display: grid;
		place-content: center;
		gap: 1.1rem;
		text-align: center;
		padding: 2rem 1.5rem;
		border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
		border-radius: 2px;
	}

	.rd-hold p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.6;
		opacity: 0.8;
	}

	.rd-hold-alt {
		font-size: 0.85rem;
	}

	.rd-hold button {
		font: inherit;
		font-size: 0.8rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		padding: 0.75rem 1.5rem;
		cursor: pointer;
		color: inherit;
		background: transparent;
		border: 1px solid currentColor;
		border-radius: 2px;
		justify-self: center;
	}

	.rd-hold button:hover {
		background: color-mix(in srgb, currentColor 12%, transparent);
	}

	.rd-notes {
		font-size: 0.95rem;
		line-height: 1.65;
	}

	.rd-notes p {
		margin: 0 0 1rem;
		opacity: 0.85;
	}

	.rd-notes h2 {
		font-family: var(--font-display, 'Cormorant Garamond', serif);
		font-size: 1.4rem;
		font-weight: 400;
		margin: 2rem 0 0.75rem;
	}

	/* Terms is now the first thing in the aside, so it doesn't need the 2rem of
	   separation it had when two paragraphs sat above it. */
	.rd-notes h2.first {
		margin-top: 0;
	}

	/* .rd-hold-alt was missing from this list, so the "or just phone us" number in
	   the cookie-declined gate fell through to the UA default and rendered #0000EE
	   underlined — stock browser blue, on a black editorial panel, right next to two
	   correctly-ivory copies of the same phone number. */
	/* .rd-notes dropped from this list when the two troubleshooting lines moved out
	   to .rd-tips — the Terms that remain in the aside carry no links, so Svelte
	   tree-shook the selector and warned. Re-add it if a link ever goes back there. */
	.rd-tips a,
	.rd-hold-alt a,
	.rd-sub a {
		color: inherit;
		text-decoration: none;
		border-bottom: 1px solid currentColor;
		white-space: nowrap;
	}

	/* PHONE: GET TO THE FORM.
	   Same breakpoint as BookingBrandBar's stack. On a 390px screen the form
	   started ~670px down — a full screen of heading, switch, note and tips first —
	   and with cookies declined the gate's button was further still, in the middle
	   of a 400px box that was mostly empty. Nothing is removed or reordered (the
	   tips stay above the widget, see the note in the markup); the air between the
	   blocks is what goes. */
	@media (max-width: 620px) {
		.rd {
			padding: 1.75rem 1.5rem 3.5rem;
		}

		.rd-head {
			margin-bottom: 1.25rem;
		}

		.rd-sub {
			margin-top: 0.75rem;
		}

		.rd-tips {
			margin-bottom: 1.25rem;
			padding: 0.85rem 1rem;
			font-size: 0.9rem;
			line-height: 1.55;
		}

		.rd-tips p + p {
			margin-top: 0.5rem;
		}

		.rd-body {
			gap: 2.25rem;
		}

		/* width: 100% plus a border overhung the column by 2px. */
		.rd-frame iframe {
			box-sizing: border-box;
		}

		/* The 340px floor reserved the iframe's footprint, but the iframe is 640px
		   and loads on a tap, so the layout moves either way — all it bought on a
		   phone was 120px of empty box above the button. */
		.rd-hold {
			min-height: 0;
			padding: 1.5rem 1.25rem;
			gap: 1rem;
		}

		/* Narrower than the gap between the screen edge and the "Ask Geisha" button
		   on both sides (52px + 14px each): centred at 231px wide on a 360px screen
		   its right end ran 2px under that button — and at 360×780 the two are level
		   on the first screen. At 210px it clears it at any scroll position. */
		.rd-hold button {
			min-height: 2.75rem;
			padding-left: 0.85rem;
			padding-right: 0.85rem;
		}
	}
</style>
