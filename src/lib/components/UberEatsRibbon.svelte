<script lang="ts">
	// Uber Eats corner ribbon — a fixed 45°-rotated band pinned to a top corner,
	// above everything. Originally inline on the Fusion home page; lifted into a
	// component so each brand's layout can show it sitewide.
	//   theme="green" → Uber-green band, white text (Fusion)
	//   theme="white" → white band, black text + green "Eats" (Asia)
	//   side="left"   → mirrored into the top-LEFT corner (Asia, whose bar centres
	//                   its wordmark and so leaves that corner free). Fusion keeps
	//                   the right corner: its logo sits hard left.
	//   hideOnScroll   → retracts into its corner once the page moves off the hero,
	//                    at the same 40px threshold the Asia bar uses to gain its
	//                    ink backdrop, so the two read as one gesture.
	import { onMount } from 'svelte';
	import type { Brand } from '$lib/data/brand';

	let {
		brand,
		theme = 'green',
		side = 'right',
		hideOnScroll = false
	}: {
		brand: Brand;
		theme?: 'green' | 'white';
		side?: 'left' | 'right';
		hideOnScroll?: boolean;
	} = $props();

	let gone = $state(false);

	onMount(() => {
		if (!hideOnScroll) return;
		// Seeded, not just bound: a restored scroll position or a #hash landing
		// arrives already scrolled, with no scroll event to follow.
		const onScroll = () => (gone = window.scrollY > 40);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});
</script>

<a
	class="uber-ribbon {theme} {side}"
	class:gone
	aria-hidden={gone}
	tabindex={gone ? -1 : undefined}
	href={brand.uberEatsUrl}
	target="_blank"
	rel="noopener noreferrer"
	aria-label="Order from {brand.name} on Uber Eats"
>
	<span class="uber-ribbon-band">
		<span class="uber-ribbon-top">Uber Eats Partner</span>
		<span class="uber-ribbon-cta">Order Now →</span>
	</span>
</a>

<style>
	/* Fixed 45°-rotated banner pinned to a top corner (right by default).
	   Sized down from 240px: at 240 the corner was a permanent dead zone that ate
	   real content (headings at tablet widths, the Asia gallery's "SEE MORE" link)
	   and, on Fusion, sliced the corner off the "Book a Table" button.
	   z-index 190 keeps it over ordinary page content but UNDER modal surfaces
	   (drawers, the gallery lightbox) — see --z-overlay in tokens.css. */
	.uber-ribbon {
		position: fixed;
		top: 0;
		right: 0;
		width: 200px;
		height: 200px;
		overflow: hidden;
		z-index: 190;
		pointer-events: none; /* only the green band itself is clickable */
		text-decoration: none;
	}
	/* Mirrored into the left corner. The band's horizontal offset lives in
	   --band-x so the three size breakpoints below only set it once and both
	   corners follow; the rotation flips sign so the text still runs out of the
	   corner rather than into it. */
	.uber-ribbon.left {
		right: auto;
		left: 0;
	}
	/* Scrolled away: the band retracts diagonally back out of its own corner and
	   fades, rather than blinking off. --gone-x flips with the corner. */
	.uber-ribbon {
		--gone-x: 40%;
		transition:
			opacity 0.35s ease,
			translate 0.45s cubic-bezier(0.4, 0, 0.2, 1),
			visibility 0.45s;
	}
	.uber-ribbon.left {
		--gone-x: -40%;
	}
	.uber-ribbon.gone {
		opacity: 0;
		translate: var(--gone-x) -40%;
		visibility: hidden;
	}
	@media (prefers-reduced-motion: reduce) {
		.uber-ribbon {
			transition: opacity 0.2s linear;
		}
		.uber-ribbon.gone {
			translate: none;
		}
	}
	/* One rotated band holding both lines, anchored across the corner.

	   Geometry, with W = the box size, cy = the band centre's distance from the top,
	   cx = its distance from the left, h = the band's thickness and L its length:

	   1. SYMMETRY — cx + cy = W. The visible run is then 2·√2·cy long and the band's
	      centre sits on its midpoint, so the centred text stays centred in the
	      corner. Since the band is pinned by `right`, cx = W + right − L/2, which
	      makes the rule  right = L/2 − cy.
	   2. NO VISIBLE ENDS — L ≥ h + 2·√2·cy. The band is a rectangle, and unless it
	      is at least this long its END EDGES fall inside the box and you see the
	      rectangle's corners, so it reads as a floating diagonal bar pulled in from
	      the corner rather than a ribbon running off it. Every breakpoint below
	      used to fail this by 5–12px (desktop needed 212px and had 200).
	   3. The visible run must exceed the label, or it loses its last letters — which
	      is why it once read "UBER EATS PART". 2·√2·cy ≈ 171px here, ample.

	   L is deliberately ~10px past the minimum in rule 2 at each breakpoint: h moves
	   when the webfont swaps in, and a band that is exactly long enough is a band
	   that briefly isn't. Lengthening it costs nothing — the box clips the excess. */
	.uber-ribbon-band {
		--band-x: -60px;
		position: absolute;
		top: 40px;
		right: var(--band-x);
		width: 240px;
		transform: rotate(45deg);
		transform-origin: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.05rem;
		padding: 0.5rem 0;
		pointer-events: auto;
		background: #06c167; /* Uber Eats green */
		color: #fff;
		font-family: 'Space Grotesk', sans-serif;
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
		transition: background 0.3s ease;
	}
	.uber-ribbon.left .uber-ribbon-band {
		right: auto;
		left: var(--band-x);
		transform: rotate(-45deg);
	}
	.uber-ribbon:hover .uber-ribbon-band {
		background: #05a857;
	}

	/* White theme (Asia): white band, black text, green "Eats" accent. */
	.uber-ribbon.white .uber-ribbon-band {
		background: #ffffff;
		color: #000000;
	}
	.uber-ribbon.white:hover .uber-ribbon-band {
		background: #f2f2f2;
	}
	.uber-ribbon.white .uber-ribbon-cta {
		color: #06c167; /* Uber Eats green */
		opacity: 1;
	}
	.uber-ribbon-top {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		line-height: 1.1;
	}
	.uber-ribbon-cta {
		font-size: 0.64rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		opacity: 0.95;
		line-height: 1.1;
	}

	/* Narrow desktop / tablet: the corner is scarce here — the Fusion bar's
	   "Book a Table" button reaches to ~72px from the edge at 1181px, so the band
	   must stay inside that. */
	@media (max-width: 1340px) {
		.uber-ribbon {
			width: 160px;
			height: 160px;
		}
		.uber-ribbon-band {
			--band-x: -53px;
			top: 31px;
			width: 200px;
			padding: 0.4rem 0;
			gap: 0;
		}
		.uber-ribbon-top {
			font-size: 0.56rem;
			letter-spacing: 0.08em;
		}
		.uber-ribbon-cta {
			font-size: 0.5rem;
		}
	}

	@media (max-width: 600px) {
		/* Compact corner accent on phones: a smaller band that sits fully within the
		   corner (no text running off the right edge) and clears the nav burger,
		   which the nav reserves space for on its side. */
		.uber-ribbon {
			width: 132px;
			height: 132px;
		}
		.uber-ribbon-band {
			--band-x: -49px;
			top: 28px;
			width: 180px;
			padding: 0.3rem 0;
			gap: 0;
		}
		.uber-ribbon-top {
			font-size: 0.52rem;
			letter-spacing: 0.08em;
		}
		.uber-ribbon-cta {
			font-size: 0.46rem;
		}
	}
</style>
