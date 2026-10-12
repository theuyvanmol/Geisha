<script lang="ts">
	// Asia-only layout. Mounts the sitewide Uber Eats corner ribbon (white/black,
	// Uber's own theme) once across every Asia page so it persists across navigations.
	// It sits in the LEFT corner here: the bar centres its wordmark, so that corner
	// is the free one. Fusion does the same (its mark is centred too since the
	// continuity pass).
	import { getBrand } from '$lib/data/brand';
	import UberEatsRibbon from '$lib/components/UberEatsRibbon.svelte';
	import SiteBanner from '$lib/components/SiteBanner.svelte';
	import BrandPageCurtain from '$lib/components/BrandPageCurtain.svelte';
	import AIAssistantChat from '$lib/components/AIAssistantChat.svelte';
	import BrandTopNav from '$lib/components/BrandTopNav.svelte';
	import SakuraPetals from '$lib/components/SakuraPetals.svelte';
	import { page } from '$app/state';
	import { isEntering, clearEntering } from '$lib/nav/entering';
	import { onMount } from 'svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();
	const brand = getBrand('asia');

	// Only the home page has a full-bleed hero for the transparent bar to sit over.
	// Every other Asia page starts with content at y=0 and would slide underneath
	// it, so those get a top offset the height of the bar.
	const onHome = $derived(page.url.pathname === '/asia');

	// ===== ARRIVAL: THE SHOJI =====
	//
	// Landing here from the front door, the screen is already flat ink — the iris
	// ended on exactly this colour, still carrying "Entering Geisha Asia". Two
	// panels hold that frame from FIRST PAINT, then part like a shoji screen down a
	// gold seam, revealing the hero behind them while the mark dissolves and the
	// hero's own copy rises (see the hero's `from-landing` choreography, which runs
	// concurrently rather than after).
	//
	// This replaced a plain 600ms opacity fade that was stacked ON TOP of the hero's
	// own 1s curtain — two opaque layers doing the same job in series, which is what
	// made the arrival read as "wipe, freeze, then the stuff appears".
	//
	// Read at component INIT, not onMount, so the panels are already closed on the
	// very first frame — no flash of the page beneath. The flag comes from a client
	// module rather than the URL; $lib/nav/entering explains why that mattered.
	let arriving = $state(isEntering());
	// Kept mounted only while it's doing something; torn down once open so it isn't
	// a permanent full-screen layer on every Asia page.
	let showShoji = $state(isEntering());

	onMount(() => {
		// Consume the flag here, not at read time: Svelte mounts children before
		// parents, so the home page's own init has already read it by now.
		clearEntering();
		if (!arriving) return;
		// Next frame: open the panels (double rAF so the closed state paints once —
		// a single frame can be coalesced with the initial paint and skip the
		// transition entirely, which would show a hard cut instead of the reveal).
		const id1 = requestAnimationFrame(() => requestAnimationFrame(() => (arriving = false)));
		const done = setTimeout(() => (showShoji = false), 1400);
		return () => {
			cancelAnimationFrame(id1);
			clearTimeout(done);
		};
	});
</script>

<!-- Redesign type pair, sitewide. It used to be requested only in the home page's
     head, so every OTHER Asia page fell back to system-ui for the nav (and now the
     assistant button), both of which are mounted here on all of them. -->
<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600;700&family=Jost:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<!-- Uber Eats corner ribbon — commented out at the owner's request (2026-08-03),
     not deleted. Uncomment this one line to bring it back; the component and its
     import are left in place. Uber Eats is still reachable from the nav, the
     footer and the Takeaway page. -->
<!-- <UberEatsRibbon {brand} theme="white" side="left" hideOnScroll /> -->

<SiteBanner banner={data.banner} brand="asia" />

<!-- The single Asia nav (replaced the scooped bottom pill), mounted once here so
     it persists across navigations instead of remounting per page. -->
<BrandTopNav {brand} />

<!-- Drifting sakura petals, sitewide on Asia like the design template. -->
<SakuraPetals quiet={!onHome} />

<div class="asia-body" class:offset={!onHome}>
	{@render children()}
</div>

<!-- Guest assistant, mounted ONCE for all Asia pages (was per-page). -->
<AIAssistantChat brand="asia" />

<BrandPageCurtain brand="asia" />

{#if showShoji}
	<div class="shoji" class:closed={arriving} aria-hidden="true">
		<div class="shoji-panel shoji-l"></div>
		<div class="shoji-panel shoji-r"></div>
		<div class="shoji-seam"></div>
		<!-- The line the departure was already holding. It carries across the route
		     swap unchanged, then dissolves as the panels part — so the two pages read
		     as one shot rather than two covers handing off. -->
		<p class="shoji-mark">
			<span class="shoji-rule"></span>
			Entering Geisha Asia
			<span class="shoji-rule"></span>
		</p>
	</div>
{/if}

<style>
	/* Pages other than the home hero start their content at y=0; pad them clear of
	   the fixed bar. The home page needs no offset — its hero sits under it. */
	.asia-body.offset {
		padding-top: 92px;
	}
	/* 1300 = where the bar folds to the burger and gets shorter (BrandTopNav). */
	@media (max-width: 1300px) {
		.asia-body.offset {
			padding-top: 70px;
		}
	}
	/* 600 = where the bar's padding drops to 16px, making it 64px tall (16 + the
	   32px cluster + 16). Holding 70 here left 6px of bare ground between the bar
	   and every interior page — a looser gap above the first heading than anywhere
	   below it, and 6px the one-screen gallery stage could not use. */
	@media (max-width: 600px) {
		.asia-body.offset {
			padding-top: 64px;
		}
	}

	/* ===== THE SHOJI (arrival) =====
	   Two ink panels that hold the departure's final frame, then slide apart down a
	   gold seam. Transform-only, so the reveal is compositor work and can't stutter
	   while the page hydrates behind it. */
	.shoji {
		position: fixed;
		inset: 0;
		z-index: 9999;
		pointer-events: none;
		overflow: hidden;
	}
	.shoji-panel {
		position: absolute;
		top: 0;
		bottom: 0;
		/* 50.1 so the two overlap by a hair — at fractional viewport widths a flat
		   50/50 split leaves a 1px hairline of the page showing down the middle. */
		width: 50.1%;
		/* #08080b is the hero's --ink, and exactly where the departure's iris
		   settles. Any difference here is a visible pop across the route swap. */
		background: #08080b;
		will-change: transform;
		transition: transform 0.78s cubic-bezier(0.76, 0, 0.24, 1);
	}
	.shoji-l {
		left: 0;
		transform: translate3d(-100.5%, 0, 0);
	}
	.shoji-r {
		right: 0;
		transform: translate3d(100.5%, 0, 0);
	}
	/* Closed on first paint, with NO transition, so nothing animates into place
	   before the reveal — the panels are simply already there. */
	.shoji.closed .shoji-panel {
		transform: translate3d(0, 0, 0);
		transition: none;
	}

	/* The seam: a gold hairline where the panels meet, bloomed with sakura. It is
	   the hero's eyebrow rule, used as the join. Fades as the panels part. */
	.shoji-seam {
		position: absolute;
		left: 50%;
		top: 0;
		bottom: 0;
		width: 1px;
		margin-left: -0.5px;
		background: linear-gradient(
			to bottom,
			transparent 0%,
			rgba(212, 175, 55, 0.85) 26%,
			rgba(244, 207, 107, 0.95) 50%,
			rgba(212, 175, 55, 0.85) 74%,
			transparent 100%
		);
		box-shadow: 0 0 14px rgba(212, 175, 55, 0.32);
		opacity: 0;
		transition: opacity 0.34s ease;
	}
	.shoji.closed .shoji-seam {
		opacity: 1;
		transition: none;
	}

	/* The held title card, dissolving upward as the room opens behind it. */
	.shoji-mark {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%) translateY(-10px);
		margin: 0;
		display: flex;
		align-items: center;
		gap: 16px;
		white-space: nowrap;
		font-family: 'Shippori Mincho', Georgia, serif;
		font-weight: 500;
		font-size: 0.74rem;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: #f5f1e8;
		opacity: 0;
		transition:
			opacity 0.3s ease,
			transform 0.6s cubic-bezier(0.22, 0.9, 0.3, 1);
	}
	.shoji.closed .shoji-mark {
		opacity: 1;
		transform: translate(-50%, -50%) translateY(0);
		transition: none;
	}
	.shoji-rule {
		display: block;
		width: 34px;
		height: 1px;
		background: #d4af37;
	}
	/* Closed up on phones so the card clears the screen edges (Fusion's is 363px at
	   the tracking above, on a 360px phone). These three numbers must match the
	   landing's `.iris-mark` / `.iris-rule` at the same breakpoint, or the line
	   re-tracks as it is handed over. */
	@media (max-width: 760px) {
		.shoji-mark {
			gap: 12px;
			letter-spacing: 0.26em;
		}
		.shoji-rule {
			width: 22px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		/* No slide — the panels simply fade off the held frame. */
		.shoji-panel {
			width: 100%;
			left: 0;
			right: auto;
			transform: none;
			opacity: 0;
			transition: opacity 0.2s ease;
		}
		.shoji.closed .shoji-panel {
			transform: none;
			opacity: 1;
			transition: none;
		}
		.shoji-r,
		.shoji-seam {
			display: none;
		}
		.shoji-mark {
			transform: translate(-50%, -50%);
			transition: opacity 0.18s ease;
		}
		.shoji.closed .shoji-mark {
			transform: translate(-50%, -50%);
		}
	}
</style>
