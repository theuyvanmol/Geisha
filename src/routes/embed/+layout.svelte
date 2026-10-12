<script lang="ts">
	// Chromeless layout for everything under /embed — the booking widget that runs
	// inside an iframe on someone else's page.
	//
	// WHAT THIS DELIBERATELY DOESN'T RENDER
	// -------------------------------------
	// No nav, no footer, no page curtain, no brand hero. The frame is a ~320–440px
	// column on the host page and every pixel of site furniture inside it is both
	// wrong (the host page already has a header) and expensive (it pushes the
	// actual form below the fold of a box the guest cannot scroll past easily).
	//
	// No cookie banner either: consent belongs to the host page, and a second
	// banner inside a small frame is unusable — see the root layout, which skips
	// CookieBanner and Lenis for this subtree.
	//
	// TRANSPARENT BACKGROUND
	// ----------------------
	// The frame inherits nothing from the host page, so the widget paints its own
	// surface. It's a plain light card rather than either brand's art-directed
	// ground, because it has to sit legibly on a WordPress page we don't control
	// and whose background can change without us knowing.
	import '$lib/theme/tokens.css';

	let { children } = $props();
</script>

<div class="embed-root">
	{@render children()}
</div>

<style>
	/* NO DEFAULT BODY MARGIN IN THE FRAME.
	   The host sizes the iframe exactly (820px), and the UA's default 8px body
	   margin made the document 836px tall inside it — so the widget always drew a
	   vertical scrollbar it never needed. That scrollbar then took 15px off the
	   width, squeezing the calendar's Sunday column against the frame edge. The
	   margin is meaningless here anyway: this document IS the box, and the widget
	   brings its own padding. Content that genuinely overflows (the card step) still
	   scrolls, because this only removes the phantom 16px. */
	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
	}

	.embed-root {
		/* FILL THE FRAME, NOT JUST THE CONTENT.
		   `min-height: 100%` resolved to `auto` here — percentage heights need an
		   ancestor with a resolved height, and neither html nor body has one. So the
		   card was only as tall as the form (~394px) and the rest of a fixed-height
		   iframe showed the app's near-black ground (#0e0c0a) through it: a big black
		   slab under the widget on the host page. The host sets a FIXED iframe height
		   (there's no resize protocol), so the first step will always be shorter than
		   the frame — the surface has to fill it. */
		min-height: 100vh;
		min-height: 100dvh;
		background: #fff;
		color: #1a1f2b;
		font-family:
			'Space Grotesk',
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	/* `?theme=dark` darkens the widget card, but the card is only as tall as its
	   step — so the rest of the frame showed THIS surface: a white slab under a
	   dark form (and white strips beside it in a frame wider than 26rem). The
	   widget's own --surface, repeated here because it's scoped to the widget. */
	.embed-root:has(:global(.w[data-theme='dark'])) {
		background: #14161c;
	}

	/* THE SCROLLBAR GUTTER IS PART OF THE FRAME TOO.
	   The root layout reserves `scrollbar-gutter: stable` on <html> and paints
	   <html> the app's near-black. Phones draw overlay scrollbars and never see
	   it, but on a desktop host page (Windows, classic scrollbars) that reserved
	   15px showed as a black stripe down the right-hand side of a white widget.
	   Colour only — the gutter stays, so the form doesn't change width between a
	   step that scrolls and one that doesn't. `:has` scopes it to documents that
	   actually contain the embed, and out-specifies the root layout's rule. */
	:global(html:has(.embed-root)) {
		background-color: #fff;
	}

	:global(html:has(.embed-root .w[data-theme='dark'])) {
		background-color: #14161c;
	}

	/* The host page owns the frame's width; we just never exceed it. A horizontal
	   scrollbar inside an iframe is invisible until the guest has already lost
	   the Next button off the right edge. */
	.embed-root :global(*) {
		max-width: 100%;
		box-sizing: border-box;
	}
</style>
