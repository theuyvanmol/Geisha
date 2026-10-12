<script lang="ts">
	// Google Tag Manager + Meta (Facebook) Pixel, ported from the live
	// WordPress site's <head>.
	//
	// TWO DIFFERENCES FROM THE LIVE SITE, BOTH DELIBERATE
	// ---------------------------------------------------
	// 1. Nothing loads until the guest accepts on our own cookie banner. The
	//    live site delegates that to a Usercentrics CMP; we already ship a
	//    banner, so a second consent UI would be two dialogs asking the same
	//    question. Consent is what gates the tags either way.
	// 2. Nothing loads in dev, so local work doesn't pollute the client's real
	//    GTM container and Pixel with fake traffic.
	//
	// Both IDs are public — they're readable in the live page source — so they
	// live in the code rather than in env vars. PUBLIC_* overrides exist for
	// pointing a staging deploy at a throwaway container.
	//
	// The <noscript> GTM iframe from the live site is intentionally NOT ported:
	// it can't be consent-gated (no JS means no consent check), and it's a no-op
	// for a SvelteKit app a JS-less browser can't use anyway.
	import { dev } from '$app/environment';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { consent } from '$lib/consent.svelte';

	type Fbq = {
		(...args: unknown[]): void;
		callMethod?: (...args: unknown[]) => void;
		queue?: unknown[][];
		push?: unknown;
		loaded?: boolean;
		version?: string;
	};
	type TagWindow = Window & { dataLayer?: unknown[]; fbq?: Fbq; _fbq?: Fbq };

	const GTM_ID = env.PUBLIC_GTM_ID || 'GTM-NPPT85LS';
	const PIXEL_ID = env.PUBLIC_META_PIXEL_ID || '1267069490555453';

	/** Consent is per-visit and a guest can accept mid-session, so this is reactive. */
	const allowed = $derived(consent.ready && consent.accepted && !dev);

	// Plain let, not $state: only the effects below read it, and making it
	// reactive would just re-run the loader effect to hit its own guard.
	let loaded = false;
	let lastPath = '';

	function loadTags(w: TagWindow) {
		// --- Google Tag Manager (the live site's bootstrap, minus the eval-ish IIFE) ---
		w.dataLayer = w.dataLayer ?? [];
		w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
		const gtm = document.createElement('script');
		gtm.async = true;
		gtm.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
		document.head.appendChild(gtm);

		// --- Meta Pixel ---
		if (!w.fbq) {
			const fbq: Fbq = (...args: unknown[]) => {
				if (fbq.callMethod) fbq.callMethod(...args);
				else fbq.queue?.push(args);
			};
			fbq.push = fbq;
			fbq.loaded = true;
			fbq.version = '2.0';
			fbq.queue = [];
			w.fbq = fbq;
			w._fbq = fbq;

			const px = document.createElement('script');
			px.async = true;
			px.src = 'https://connect.facebook.net/en_US/fbevents.js';
			document.head.appendChild(px);
		}
		w.fbq('init', PIXEL_ID);
		w.fbq('track', 'PageView');
	}

	$effect(() => {
		if (!allowed || loaded) return;
		loaded = true;
		lastPath = window.location.pathname;
		loadTags(window as TagWindow);
	});

	// The live site is a set of separate WordPress page loads, so its inline
	// PageView fires once per page by construction. This is a SPA: after
	// hydration a nav swaps the DOM without a page load and neither tag would
	// ever fire again. So we re-announce each client-side navigation.
	$effect(() => {
		const path = $page.url.pathname;
		if (!loaded || !path || path === lastPath) return;
		lastPath = path;
		const w = window as TagWindow;
		w.dataLayer?.push({ event: 'pageview', page_path: path });
		w.fbq?.('track', 'PageView');
	});
</script>
