<script lang="ts">
	import Lenis from 'lenis';
	import { setLenis } from '$lib/lenis';
	import CookieBanner from '$lib/components/CookieBanner.svelte';
	import Analytics from '$lib/components/Analytics.svelte';
	import '$lib/theme/tokens.css';

	import { dev } from '$app/environment';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import { page } from '$app/stores';

	let { children } = $props();

	// Vercel Web Analytics. Cookieless and first-party, so unlike GTM/Meta below
	// it doesn't wait on the cookie banner.
	injectAnalytics({ mode: dev ? 'development' : 'production' });

	// Tag <html> with the active brand so brand-scoped global styles (e.g. the
	// Fusion custom scrollbar in tokens.css) can reach the viewport scrollbar,
	// which is owned by <html> and so out of reach of the in-page
	// [data-brand='fusion'] wrapper. Asia gets no attribute → untouched.
	$effect(() => {
		const path = $page.url.pathname;
		const brand = path.startsWith('/fusion') ? 'fusion' : path.startsWith('/asia') ? 'asia' : '';
		const el = document.documentElement;
		if (brand) el.setAttribute('data-route-brand', brand);
		else el.removeAttribute('data-route-brand');
	});

	// Lenis smooth-scroll is for the art-directed public site only. The admin
	// shell runs its own fixed-viewport layout where the content COLUMN scrolls
	// (not the document), so Lenis — which hijacks the wheel to drive document
	// scroll — would swallow wheel events and leave admin pages feeling unable to
	// scroll. So we only run Lenis off the /admin subtree, tearing it down when we
	// navigate in and re-creating it when we navigate back out.
	const isAdmin = $derived($page.url.pathname.startsWith('/admin'));

	// The embedded booking widget (/embed/*) is chromeless by design: it renders
	// inside a short iframe on someone else's page. Lenis hijacking the wheel
	// inside a 640px frame makes it feel stuck, and a cookie banner in there is
	// both unusable and the host page's job, not ours.
	const isEmbed = $derived($page.url.pathname.startsWith('/embed'));

	// /book/<token> — the "Change or cancel" link in a confirmation email.
	//
	// The guest arrives from an email to do ONE thing, and during the changeover
	// they are a customer of the CURRENT site: the new public site isn't launched,
	// so dropping them onto its cookie banner, analytics and assistant reads as
	// "the restaurant has a new website" long before anyone meant to say that. Kept
	// bare so the page is only their booking and the buttons to change it.
	// /feedback/<token> — the "How was your visit?" email's score page — is bare for
	// the same reason.
	const isSelfService = $derived(
		$page.url.pathname.startsWith('/book/') || $page.url.pathname.startsWith('/feedback/')
	);
	const isBareChrome = $derived(isAdmin || isEmbed || isSelfService);

	$effect(() => {
		if (isBareChrome) return; // no smooth-scroll in the back office or an iframe

		// ...nor on a phone or tablet. Lenis only ever smooths the WHEEL here
		// (`syncTouch` is off, so a finger already scrolls natively), which leaves it
		// with nothing to do on a touch-first device — yet it still costs three things
		// there. Its touchstart/touchmove/touchend listeners go on `window` as
		// `passive: false`, so every swipe has to wait for the main thread to answer
		// before the browser may start scrolling (and this is the page with the films,
		// the petals and the arch on it). Its rAF loop wakes the main thread on every
		// frame for the life of the page. And it re-syncs itself on every scroll event.
		// `pointer: coarse` is the PRIMARY pointer, so a laptop with a touchscreen
		// still reports `fine` and keeps the smoothing; desktop is untouched.
		// BrandPageCurtain's `getLenis()?.scrollTo(0)` is already null-safe, and
		// SvelteKit's own scroll reset is what puts a new page at the top.
		if (window.matchMedia('(pointer: coarse)').matches) return;

		const lenis = new Lenis({
			duration: 1.1,
			easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
			smoothWheel: true,
			wheelMultiplier: 1,
			touchMultiplier: 1.5
		});
		setLenis(lenis);

		let rafId = 0;
		const raf = (time: number) => {
			lenis.raf(time);
			rafId = requestAnimationFrame(raf);
		};
		rafId = requestAnimationFrame(raf);

		return () => {
			cancelAnimationFrame(rafId);
			lenis.destroy();
			setLenis(null);
		};
	});
</script>

{@render children()}

<!-- Guests on the real site only. Staff in /admin are signing in to a tool, and
     the embedded widget is a fragment of the host page, which owns consent. -->
{#if !isBareChrome}
	<CookieBanner />
	<!-- GTM + Meta Pixel. Guests only: staff in /admin are using a tool, and
	     measuring their shifts as website traffic would skew the client's
	     numbers. Loads nothing until the banner above is accepted. -->
	<Analytics />
{/if}

<style>
	/* Reserve the scrollbar's gutter even when scroll is locked.
	   Keeps viewport width identical between scroll-locked landings and
	   scrollable destinations so content doesn't shift horizontally during
	   the SPA navigation handoff. */
	:global(html) {
		scrollbar-gutter: stable;
	}

	/* Paint the document root (html/body) the brand's ground colour, so on a
	   hard refresh — before the in-page .brand-page div paints — and in the
	   reserved scrollbar gutter, the browser's default white never shows. That
	   white edge/flash was the bare root behind the dark Asia page. Keyed off
	   data-route-brand (set on <html> by the $effect above) so each brand gets
	   its own ground; the unbranded default covers the dark landing + admin.

	   This is the ONLY place the document ground is set. Routes must not set a
	   background from their own `:global(body)`: that rule is emitted into the
	   route's CSS chunk, which SvelteKit never unloads, so it outlives the route
	   and beats this one on source order at equal specificity.

	   Each brand's value is its --page-bg's TOP stop (tokens.css), because that is
	   what meets the ground wherever body shows through — chiefly the strip behind
	   Asia's transparent top nav (.asia-body.offset's padding-top). Any difference
	   here reads as a band across the top of every interior page. */
	:global(html),
	:global(body) {
		background-color: #0e0c0a;
	}
	/* The browser's default 8px body margin, zeroed HERE and not per route. Only the
	   landing, the two brand home pages and the gift-card pages reset it from their
	   own `:global(body)`, so it depended on how you arrived: come in through a home
	   page and that chunk's reset lingered, but load any interior page directly
	   (/asia/contact, /fusion/offers, a shared menu link) and the whole page sat in
	   an 8px frame — content 16px narrower than the screen, the footer stopping
	   short of both edges, and the page gradient showing as an inset box on the
	   body colour. Admin and /embed already zero it themselves. */
	:global(body) {
		margin: 0;
	}
	:global(html[data-route-brand='asia']),
	:global(html[data-route-brand='asia'] body) {
		background-color: #08080b;
	}
	/* #0a0d0b, the top stop of Fusion's --page-bg, per the rule above. This was
	   #0c1410 — close, but not it — so the strip the body shows behind the bar on
	   every Fusion interior page read as a slightly lighter band over the page. */
	:global(html[data-route-brand='fusion']),
	:global(html[data-route-brand='fusion'] body) {
		background-color: #0a0d0b;
	}
</style>
