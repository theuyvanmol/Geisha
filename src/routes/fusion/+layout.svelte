<script lang="ts">
	// Fusion-only layout — the mirror of asia/+layout.svelte.
	//
	// The 2026 redesign gave both restaurants the SAME shell: one fixed top bar, a
	// dip-to-dark page curtain and a full-screen arrival cover
	// from the front door. Only the palette differs. This replaced the old
	// Gucci-Osteria Fusion chrome entirely — the <SiteNav> bar, the <FrameGrid>
	// ledger rules and the terracotta <FusionPageCurtain> are all gone.
	//
	// Everything here is mounted ONCE for the whole brand so it survives intra-Fusion
	// navigation instead of remounting per page (which is what the interior pages
	// used to do with SiteNav/FrameGrid/FusionMotion).
	import { getBrand } from '$lib/data/brand';
	import UberEatsRibbon from '$lib/components/UberEatsRibbon.svelte';
	import SiteBanner from '$lib/components/SiteBanner.svelte';
	import BrandPageCurtain from '$lib/components/BrandPageCurtain.svelte';
	import AIAssistantChat from '$lib/components/AIAssistantChat.svelte';
	import BrandTopNav from '$lib/components/BrandTopNav.svelte';
	import FusionVines from '$lib/components/FusionVines.svelte';
	import { page } from '$app/state';
	import { isEntering, clearEntering } from '$lib/nav/entering';
	import { onMount } from 'svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();
	const brand = getBrand('fusion');

	// Only the home page has a full-bleed hero for the transparent bar to sit over.
	// Every other Fusion page starts with content at y=0 and would slide underneath
	// it, so those get a top offset the height of the bar.
	const onHome = $derived(page.url.pathname === '/fusion');

	// ===== ARRIVAL: THE LIFT =====
	//
	// This used to be a circular APERTURE that scaled open on the ink — the motif the
	// rest of the page is built on. It was cut, because measured end to end the front
	// door was doing the same big gesture TWICE:
	//
	//   0.00s  the landing's iris blooms SHUT (a circle)      — gesture one
	//   0.73s  flat ink, the mark held, nothing moving        — the page is loading
	//   1.46s  this aperture scaled OPEN (another circle)     — gesture two
	//   2.42s  the last hero element lands
	//
	// Two circles either side of a ~0.7s dead hold reads as the transition replaying,
	// not as one shot — and 2.4s to get into a restaurant's home page is far too long
	// to hold someone at the door. Trimming the durations didn't help, because the
	// repetition was the problem, not the speed.
	//
	// So the destination no longer performs. The landing's bloom is the whole gesture;
	// it ends on exactly this ink (#0a0d0b), still carrying "Entering Geisha Fusion",
	// and all this does is hold that frame through the load and then DISSOLVE off it.
	// One close, one lift. The hero's own copy rises underneath as it goes.
	//
	// (Asia is still the shoji, so the two front doors remain distinct — Fusion's is
	// simply the quiet one now.)
	//
	// Read at component INIT, not onMount, so the sheet is already up on the very
	// first frame — no flash of the page beneath.
	let arriving = $state(isEntering());
	// Kept mounted only while it's doing something; torn down once lifted so it isn't
	// a permanent full-screen layer on every Fusion page.
	let showIris = $state(isEntering());

	onMount(() => {
		// Consume the flag here, not at read time: Svelte mounts children before
		// parents, so the home page's own init has already read it by now.
		clearEntering();
		if (!arriving) return;
		// Next frame: lift the sheet (double rAF so the covered state paints once —
		// a single frame can be coalesced with the initial paint and skip the
		// transition entirely, which would show a hard cut instead of a dissolve).
		const id1 = requestAnimationFrame(() => requestAnimationFrame(() => (arriving = false)));
		const done = setTimeout(() => (showIris = false), 600);
		return () => {
			cancelAnimationFrame(id1);
			clearTimeout(done);
		};
	});
</script>

<!-- Fusion's type pair, sitewide. Requested here rather than per page so the nav,
     the burger panel and the assistant button have it on EVERY Fusion route — the
     interior pages used to link fonts individually and the shared chrome fell back
     to system-ui on any page that forgot. -->
<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600;700&family=Jost:wght@300;400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<!-- Left corner, matching Asia: the bar centres its wordmark and carries the
     "Book a Table" button on the right, so the left corner is the free one. The
     bar's `.nav-ghost` reserves the ribbon's diagonal on that side. -->
<!-- Uber Eats corner ribbon — commented out at the owner's request (2026-08-03),
     not deleted. Uncomment this one line to bring it back; the component and its
     import are left in place. Uber Eats is still reachable from the nav, the
     footer and the Takeaway page. -->
<!-- <UberEatsRibbon {brand} theme="white" side="left" hideOnScroll /> -->

<SiteBanner banner={data.banner} brand="fusion" />

<!-- The single Fusion nav (replaced the Gucci-Osteria SiteNav), mounted once here
     so it persists across navigations instead of remounting per page. -->
<BrandTopNav {brand} />

<!-- Fusion's own ambient motion: two-tone vines hanging from the top of the page,
     swaying. NOT <SakuraPetals> — the drifting sakura is Asia's signature, and
     running it here too was the single thing that made the two brands read as the
     same site with a recoloured stylesheet. These echo the painted hanging blossom
     in the Fusion hero artwork instead.

     HOME PAGE ONLY. They're mounted in the layout (rather than in +page.svelte) so
     they aren't torn down and regenerated on every intra-Fusion navigation, but
     they belong to the hero: the artwork is the thing they're growing out of, and
     their whole z-index story is written against the hero's stacking context
     (`.hero-bg` at 0, `.hero-inner` at 2) so the strands hang over the picture but
     behind the headline. On an interior page there is no hero — nothing to grow
     out of and nothing to sit behind, so they just hung over the content. -->
{#if onHome}
	<FusionVines />
{/if}

<div class="fusion-body" class:offset={!onHome}>
	{@render children()}
</div>

<!-- Guest assistant, mounted ONCE for all Fusion pages. -->
<AIAssistantChat brand="fusion" />

<BrandPageCurtain brand="fusion" />

{#if showIris}
	<div class="iris" class:closed={arriving} aria-hidden="true">
		<!-- Just the held frame. The scaling aperture and its gold ring that used to
		     live here are gone — see the note in the script block: they were a second
		     circular gesture on top of the landing's, which is what made the front
		     door feel like it played twice. -->
		<!-- The line the departure was already holding. It carries across the route
		     swap unchanged and simply fades — so the two pages read as one shot
		     rather than two covers handing off. -->
		<p class="iris-mark">
			<span class="iris-rule"></span>
			Entering Geisha Fusion
			<span class="iris-rule"></span>
		</p>
	</div>
{/if}

<style>
	/* Pages other than the home hero start their content at y=0; pad them clear of
	   the fixed bar. The home page needs no offset — its hero sits under it. */
	.fusion-body.offset {
		padding-top: 92px;
	}
	/* 1300 = where the bar folds to the burger and gets shorter (BrandTopNav). */
	@media (max-width: 1300px) {
		.fusion-body.offset {
			padding-top: 70px;
		}
	}

	/* ===== THE LIFT (arrival) =====
	   NOT a gesture. This sheet's entire job is to hold the frame the landing's iris
	   ended on — flat ink, mark still up — through the page load, and then get out of
	   the way. It performs nothing of its own: the landing already did the move, and
	   doing a second one here is what made the front door read as a repeat.

	   #0a0d0b is the hero's ground and exactly where the landing's iris settles. Any
	   difference here is a visible pop across the route swap. */
	.iris {
		position: fixed;
		inset: 0;
		z-index: 9999;
		pointer-events: none;
		overflow: hidden;
		display: grid;
		place-items: center;
		background: #0a0d0b;
		opacity: 0;
		will-change: opacity;
		transition: opacity 0.4s ease;
	}
	/* Covered on first paint, with NO transition, so nothing animates into place
	   before the lift — the sheet is simply already up. */
	.iris.closed {
		opacity: 1;
		transition: none;
	}

	/* The held title card. It goes a touch ahead of the sheet so the line is clear of
	   the hero before the hero is legible, rather than sitting over the copy. */
	.iris-mark {
		position: absolute;
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
		color: #f2ece0;
		opacity: 0;
		transition: opacity 0.22s ease;
	}
	.iris.closed .iris-mark {
		opacity: 1;
		transition: none;
	}
	.iris-rule {
		display: block;
		width: 34px;
		height: 1px;
		background: #dd8236;
	}
	/* Closed up on phones: at the tracking above this card is 363px wide and never
	   wraps, so on a 360px phone its rules ran off both edges of the screen. These
	   three numbers must match the landing's `.iris-mark` / `.iris-rule` at the
	   same breakpoint, or the line re-tracks as it is handed over. */
	@media (max-width: 760px) {
		.iris-mark {
			gap: 12px;
			letter-spacing: 0.26em;
		}
		.iris-rule {
			width: 22px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		/* Already just a fade; only shorten it. */
		.iris {
			transition: opacity 0.18s ease;
		}
		.iris-mark {
			transition: opacity 0.12s ease;
		}
	}
</style>
