<script lang="ts">
	// The site nav for BOTH brands, ported from the redesign template: a fixed
	// transparent bar that gains an ink backdrop + blur once you scroll off the
	// hero, spaced-caps links with a gold underline that draws in on hover, and an
	// outlined "Book a Table". Below 1300px the links collapse into a burger that
	// drops a full-screen panel.
	//
	// It replaced the scooped bottom pill (AsiaFloatNav) on Asia, and now the
	// Gucci-Osteria <SiteNav> on Fusion as well — the two restaurants run the same
	// bar in their own palettes, which is the whole point of the shared redesign.
	// Everything brand-specific is derived from `brand`: the link targets, the
	// wordmark, the "other restaurant" cross-link and the token block below.
	//
	// The bar carries the six primary destinations plus a "More" dropdown holding
	// the rest, so every page the old pill's sheet reached is still one click away
	// at any width — the burger (and the footer) carry the same full list.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { Brand } from '$lib/data/brand';
	import { CIRCLE_LIVE, COMING_SOON, GALLERY_PAGE_LIVE } from '$lib/data/features';

	let { brand }: { brand: Brand } = $props();

	type NavLink = { href: string; label: string; soon?: boolean; external?: boolean };

	/** This brand's route root — '/asia' or '/fusion'. */
	const root = $derived(`/${brand.id}`);
	/** ...and the other one, for the cross-link that ends the bar's left flank. */
	const other = $derived(
		brand.id === 'asia'
			? { href: '/fusion', label: 'Geisha Fusion' }
			: { href: '/asia', label: 'Geisha Asia' }
	);

	/** The bar. Six items, matching the template's rhythm. The wordmark sits
	    centred between them, so they're split into the two flanking clusters —
	    `primary` stays whole for the mobile panel. */
	const primary: NavLink[] = $derived([
		{ href: root, label: 'Home' },
		{ href: `${root}/menus`, label: 'Menus' },
		{ href: `${root}/offers`, label: "What's On" },
		{ href: `${root}/gift-cards`, label: 'Gift Vouchers' },
		// /order is delivery (Uber Eats) + collection (Touch Takeaway); it was
		// billed as "At Home Experience", which said nothing about either.
		{ href: `${root}/order`, label: 'Takeaway' },
		other
	]);
	// 4 | 2, not 3 | 3: the right flank also carries the "Book a Table" button, so
	// an even split of the LINKS makes that side much the wider of the two and
	// shoves the wordmark left of the bar's true centre.
	const primaryLeft = $derived(primary.slice(0, 4));
	const primaryRight = $derived(primary.slice(4));

	/** The rest of the site. These hang off the bar's "More" dropdown on desktop and
	    sit in the burger panel below 1300px — the old pill's sheet reached all of
	    them from every page, and dropping them from the bar orphaned Gift Cards. */
	const secondary: NavLink[] = $derived([
		...(GALLERY_PAGE_LIVE ? [{ href: `${root}/gallery`, label: 'Gallery' }] : []),
		{ href: `${root}/reviews`, label: 'Reviews' },
		// Fusion only: parties and functions are held downstairs in Fusion's back
		// room, never in Asia (owner, Aug 2026). /asia/parties 301s to Fusion.
		...(brand.id === 'fusion'
			? [{ href: `${root}/parties`, label: 'Parties & Functions' }]
			: []),
		{ href: `${root}/circle`, label: 'The Circle', soon: !CIRCLE_LIVE },
		{ href: `${root}/contact`, label: 'Contact' }
	]);

	/** Each brand's white wordmark, trimmed to transparent (so neither needs a
	    knock-out filter) — see the sizing note on `.nav-logo img`.
	    Fusion briefly ran the design template's TYPESET mark instead ("GEISHA
	    FUSION" over a gold strapline); it's back to the real wordmark image, which
	    is what this bar carried before the redesign. Both marks now sit CENTRED —
	    Fusion's hard-left placement was dropped for continuity between the two
	    sites; only the artwork and the palette differ. */
	const wordmark = $derived(
		brand.id === 'asia'
			? { src: '/geisha-asia-wordmark.png', w: 1554, h: 461 }
			: { src: '/geisha-fusion.png', w: 1890, h: 664 }
	);

	let scrolled = $state(false);
	let menuOpen = $state(false);
	let moreOpen = $state(false);
	/** The dropdown's wrapper — so an outside click can be told from an inside one. */
	let moreEl: HTMLDivElement | undefined = $state();

	// The root must match EXACTLY or every page under it would light up "Home".
	const isActive = (href: string) =>
		href === root ? page.url.pathname === root : page.url.pathname.startsWith(href);
	/** "More" lights up while you're on one of the pages it holds. */
	const moreActive = $derived(secondary.some((l) => !l.soon && isActive(l.href)));

	// Close the dropdown on navigation. Watching the pathname rather than hooking
	// each link covers back/forward and the wordmark too.
	$effect(() => {
		page.url.pathname;
		moreOpen = false;
	});

	function onScroll() {
		scrolled = window.scrollY > 40;
	}
	// Seed it: a restored scroll position or a #hash landing puts us down the page
	// with no scroll event to follow, and the bar would sit transparent over content.
	onMount(onScroll);
	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (menuOpen) menuOpen = false;
		if (moreOpen) moreOpen = false;
	}
	/** Anywhere outside the dropdown dismisses it (the usual menu contract). */
	function onDocClick(e: MouseEvent) {
		if (!moreOpen) return;
		if (moreEl && !moreEl.contains(e.target as Node)) moreOpen = false;
	}
</script>

<svelte:window onscroll={onScroll} onkeydown={onKey} onclick={onDocClick} />

{#snippet bookLabel()}
	Book a Table
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"
		><path d="M5 12h14M13 6l6 6-6 6" /></svg
	>
{/snippet}

<nav class="site-nav" data-brand={brand.id} class:scrolled class:panel-open={menuOpen}>
	<!-- Centred cluster — the shape BOTH brands' bars now use: the two link zones are
	     equal-width and justify INWARD, so the links gather either side of the
	     wordmark instead of drifting out to the bar's edges. An invisible width-twin
	     of the "Book a Table" button leads the row so the wordmark — the only rigid
	     item — still lands on true screen centre, and it is the only shrinkable item,
	     so a tight bar spends that balancing space before anything visible moves. -->
	<div class="nav-cluster">
		<span class="btn nav-ghost" aria-hidden="true">{@render bookLabel()}</span>

		<div class="nav-links nav-left">
			{#each primaryLeft as l}
				<a href={l.href} class:active={isActive(l.href)}>{l.label}</a>
			{/each}
		</div>

		<!-- The wordmark is taken OUT OF FLOW and pinned to the bar's true centre, with
		     this spacer holding its place in the row. In flow it could only be centred
		     when the two link flanks happened to be equal widths — they're frozen at
		     their content size, so the moment one side gained an item ("More") the
		     mark slid 40-odd px off centre. The spacer is wider than the mark, so the
		     clear zone still contains it however the flanks fall. -->
		<span class="nav-logo-slot" aria-hidden="true"></span>
		<a class="nav-logo" href={root} aria-label="{brand.name} — home">
			<img src={wordmark.src} alt={brand.name} width={wordmark.w} height={wordmark.h} />
		</a>

		<div class="nav-links nav-right">
			{#each primaryRight as l}
				<a href={l.href} class:active={isActive(l.href)}>{l.label}</a>
			{/each}

			<!-- Everything the bar has no room for. Without this the only route to Gift
			     Vouchers, Reviews, Parties, The Circle and Contact on a desktop-width
			     screen was the footer — the burger that holds them doesn't exist above
			     1180px. -->
			<div class="more" bind:this={moreEl}>
				<button
					type="button"
					class="more-trigger"
					class:active={moreActive || moreOpen}
					aria-expanded={moreOpen}
					aria-haspopup="true"
					onclick={() => (moreOpen = !moreOpen)}
				>
					More
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
					>
				</button>

				<div class="more-panel" class:open={moreOpen}>
					{#each secondary as l}
						{#if l.soon}
							<span class="soon" aria-disabled="true">{l.label}<em>{COMING_SOON}</em></span>
						{:else}
							<a
								href={l.href}
								class:active={isActive(l.href)}
								tabindex={moreOpen ? 0 : -1}
								onclick={() => (moreOpen = false)}>{l.label}</a
							>
						{/if}
					{/each}
				</div>
			</div>
		</div>

		<a class="btn nav-cta" href={brand.bookingUrl}>{@render bookLabel()}</a>
	</div>

	<!-- Burger sits in the bar's own corner, outside the cluster, so it can't pull
	     the centred wordmark off-centre once the cluster's other items fold away. -->
	<button
		class="nav-burger"
		aria-label={menuOpen ? 'Close menu' : 'Open menu'}
		aria-expanded={menuOpen}
		onclick={() => (menuOpen = !menuOpen)}
	>
		<span class:x={menuOpen}><span></span><span></span><span></span></span>
	</button>
</nav>

<div class="mobile-panel" data-brand={brand.id} class:open={menuOpen} aria-hidden={!menuOpen}>
	{#each [...primary, ...secondary] as l}
		{#if l.soon}
			<span class="soon" aria-disabled="true">{l.label}<em>{COMING_SOON}</em></span>
		{:else}
			<a
				href={l.href}
				class:active={isActive(l.href)}
				aria-current={isActive(l.href) ? 'page' : undefined}
				onclick={() => (menuOpen = false)}
				tabindex={menuOpen ? 0 : -1}>{l.label}</a
			>
		{/if}
	{/each}
	<a
		class="btn btn-solid"
		href={brand.bookingUrl}
		onclick={() => (menuOpen = false)}
		tabindex={menuOpen ? 0 : -1}>Book a Table</a
	>
</div>

<style>
	/* Tokens are declared here rather than inherited from the brand tokens, because
	   this bar is mounted OUTSIDE the `[data-brand]` page wrapper (it's fixed to the
	   viewport in the layout) and because the redesign's names — --gold, --ivory,
	   --sakura — deliberately differ from the sitewide --accent/--ink set. The same
	   block is repeated verbatim in each redesigned section for the same reason.
	   Asia's values are the default; Fusion overrides only what actually differs. */
	.site-nav,
	.mobile-panel {
		--ink: #08080b;
		--hair: rgba(255, 255, 255, 0.12);
		--gold: #d4af37;
		--gold-bright: #f4cf6b;
		--ivory: #f5f1e8;
		--muted: #a3a0a0;
		--sakura: #ef3c5c;
		--sakura-2: #ff7a94;
		--sakura-glow: rgba(239, 60, 92, 0.4);
		--display: 'Shippori Mincho', Georgia, serif;
		--body-f: 'Jost', system-ui, sans-serif;
		--ease: cubic-bezier(0.22, 0.9, 0.3, 1);
		/* The scrolled bar's backdrop and the dropdown's panel. Separate tokens
		   rather than a transparent --ink, because both sit over live page content
		   and each brand's ground has to be mixed to its own hue. */
		--veil: rgba(10, 9, 8, 0.88);
		--veil-solid: rgba(10, 9, 8, 0.97);
	}
	/* Fusion: green-black ground under ember orange, ember-tinted hairline, and the
	   action colour overridden from sakura pink to the mural's RED. The bar's "Book a
	   Table" is the most prominent button on the site, so leaving --sakura inherited
	   here would have kept a pink button on every Fusion page while the pages
	   themselves went red. Asia's block above still holds the pink and is untouched.
	   These are a local MIRROR of the brand tokens, not a read of them: the veils
	   have to be rgba (they sit over live page content) so they can't just be
	   var(--bg). When the brand palette moves, this block has to move with it, or
	   the bar keeps painting the old ground over the new pages — which is exactly
	   what happened when the accent went from gold to ember. */
	.site-nav[data-brand='fusion'],
	.mobile-panel[data-brand='fusion'] {
		--ink: #0a0d0b;
		--hair: rgba(221, 130, 54, 0.2);
		--gold: #dd8236;
		--gold-bright: #f79a4a;
		--ivory: #f2ece0;
		--muted: #9fb0a8;
		--sakura: #d92e22;
		--sakura-2: #f0503f;
		--sakura-glow: rgba(217, 46, 34, 0.42);
		--veil: rgba(10, 13, 11, 0.9);
		--veil-solid: rgba(10, 13, 11, 0.97);
	}

	.site-nav {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		/* 180, i.e. UNDER the Uber Eats ribbon (190). Once scrolled, this bar paints
		   an opaque band across the full width — at a higher z-index that band sliced
		   the corner ribbon in half. Nothing is lost by going under it: the padding
		   above already keeps every control inboard of the ribbon's corner. */
		z-index: 180;
		display: flex;
		align-items: center;
		padding: 26px 40px;
		box-sizing: border-box;
		transition:
			padding 0.4s var(--ease),
			background 0.4s var(--ease),
			box-shadow 0.4s var(--ease);
	}
	.site-nav.scrolled {
		padding: 14px 40px;
		background: var(--veil);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
		border-bottom: 1px solid var(--hair);
	}
	/* The markup has always set `.panel-open`, but nothing ever styled it, so the
	   bar stayed at z-180 under the opaque mobile panel at z-199. The burger does
	   morph into an X on open — it was just painted UNDERNEATH the panel, so it was
	   neither visible nor hittable (elementFromPoint over it returns .mobile-panel).
	   That left a full-screen menu with no close control at all: the only ways out
	   were picking a link or the browser's back button. Lift the bar over the panel
	   so the X is the close button it was always drawn to be. */
	.site-nav.panel-open {
		z-index: 200;
		/* Over the open panel the bar is the panel's own header, not a bar floating
		   on a page. Opened from a scrolled position it kept its veil, hairline and
		   40px drop shadow, which smeared a dark band across the top of the menu.
		   Same ink as the panel, so the two read as one sheet — and still opaque, so
		   links scrolling up a short screen pass UNDER the wordmark, not through it. */
		background: var(--ink);
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
		box-shadow: none;
		border-bottom-color: transparent;
	}

	/* The cluster's gap sets how close the links sit to the wordmark; it opens up
	   on wide screens and tightens towards the width the bar folds at. */
	.nav-cluster {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: clamp(22px, 2.4vw, 46px);
		width: 100%;
		min-width: 0;
		/* Asia's wordmark is absolutely centred on the bar (see `.nav-logo`), so it
		   contributes no height. Below 1300px the links are hidden too, which left
		   the cluster at 0 and the bar's height as pure padding — 21px once scrolled
		   at phone widths. The 31px mark, centred on that, hung 5px off the top of
		   the screen and rendered visibly sliced. The bar must be at least as tall as
		   the mark it centres. */
		min-height: 32px;
	}
	/* Balancing twin of the CTA — invisible, and the only shrinkable item in the
	   row. Its floor is the Uber Eats ribbon's reserve (108 + the bar's 40px
	   padding = the 148px the corner banner's diagonal needs), so however tight
	   the bar gets, the left-hand links never slide under the ribbon. */
	.nav-ghost {
		flex: 0 1 auto;
		min-width: 108px;
		overflow: hidden;
		visibility: hidden;
		pointer-events: none;
	}

	.nav-logo {
		position: absolute;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		display: flex;
		align-items: center;
		text-decoration: none;
	}
	/* Its stand-in in the row: the mark itself is ~104px, so this reserves that plus
	   the slack the flanks' imbalance can eat before anything would collide. */
	.nav-logo-slot {
		flex: 0 0 clamp(122px, 11vw, 170px);
	}
	/* 31px, not the template's 38px: our wordmark is trimmed to the ink, so the
	   same optical size needs a smaller box (see the hero for the same trade). */
	.nav-logo img {
		height: 31px;
		width: auto;
		display: block;
	}

	/* ===== FUSION: THE MARK, CENTRED TOO =====
	   Fusion's mark used to be pinned HARD LEFT, out of the cluster, so the two
	   brands' bars had different silhouettes. The owner asked for more continuity
	   between the sites (Aug 2026), and the bar is the one element on every page of
	   both — so Fusion now runs Asia's exact geometry: mark absolutely centred,
	   links gathered either side, CTA right. Nothing below overrides POSITION any
	   more; all that's left is the size the artwork needs.

	   Continuity, not sameness: the palette block above still repaints the whole bar
	   in Fusion's ember/red, and each brand keeps its own wordmark. The shape is
	   shared; the colour is not.

	   Taller than Asia's 31px, because Asia's wordmark is a single line of type but
	   the Fusion PNG is a STACKED lockup — "GEISHA" over "FUSION" — so at the same
	   box height each line is only ~13px and unreadable. It's out of flow, so the
	   extra height costs the row nothing; the cluster's min-height below is what
	   actually keeps the bar tall enough to contain it. */
	.site-nav[data-brand='fusion'] .nav-logo img {
		height: 42px;
		transition: height 0.4s var(--ease);
	}
	.site-nav[data-brand='fusion'].scrolled .nav-logo img {
		height: 36px;
	}
	/* The bar must be at least as tall as the mark it centres, or the taller Fusion
	   lockup renders sliced once the bar tightens on scroll — the same failure the
	   32px floor fixes for Asia, just at Fusion's mark height. */
	.site-nav[data-brand='fusion'] .nav-cluster {
		min-height: 42px;
	}
	@media (max-width: 600px) {
		/* Shrink the stacked lockup so it can't crowd the burger on a narrow bar —
		   but not to Asia's 32px box. Asia's mark is one line of type; this one is
		   two, so at the same box height its "GEISHA" came out 75px wide against
		   Asia's 104 and the Fusion bar looked like the junior of the pair. 38px is
		   88px of lettering, still 75px clear of the burger at 360 wide, and makes
		   the bar 70px — exactly the offset the Fusion layout pads its pages by. */
		.site-nav[data-brand='fusion'] .nav-logo img {
			height: 38px;
		}
		.site-nav[data-brand='fusion'].scrolled .nav-logo img {
			height: 34px;
		}
		.site-nav[data-brand='fusion'] .nav-cluster {
			min-height: 38px;
			/* Eased with the mark (and the bar's padding), so the bar doesn't step. */
			transition: min-height 0.4s var(--ease);
		}
		.site-nav[data-brand='fusion'].scrolled .nav-cluster {
			min-height: 34px;
		}
	}

	.nav-links {
		display: flex;
		gap: 40px;
		align-items: center;
	}
	/* Left cluster: held clear of the corner ribbon's diagonal. 108 + the bar's
	   40px padding = the 148px inset the CTA used to need on the other side. */
	/* Equal zones either side of the wordmark, each justified INWARD so its links
	   gather against the logo. `min-width: max-content` keeps them from ever
	   squeezing their own text — the ghost gives up its width instead. */
	.nav-left,
	.nav-right {
		flex: 1 1 0;
		min-width: max-content;
	}
	.nav-left {
		justify-content: flex-end;
	}
	.nav-right {
		justify-content: flex-start;
	}
	.nav-links a {
		font-family: var(--body-f);
		font-size: 0.72rem;
		font-weight: 400;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--muted);
		white-space: nowrap;
		position: relative;
		padding-bottom: 6px;
		transition: color 0.3s;
	}
	.nav-links a::after {
		content: '';
		position: absolute;
		left: 0;
		bottom: 0;
		width: 0;
		height: 1px;
		background: var(--gold);
		transition: width 0.35s var(--ease);
	}
	.nav-links a:hover,
	.nav-links a.active {
		color: var(--ivory);
	}
	.nav-links a:hover::after,
	.nav-links a.active::after {
		width: 100%;
	}

	.nav-cta {
		flex: 0 0 auto;
	}

	/* ===== "MORE" DROPDOWN =====
	   Styled as one of the bar's links (same spaced caps, same gold underline) with
	   a caret, so it reads as part of the row rather than a control bolted on. */
	.more {
		position: relative;
		display: flex;
		align-items: center;
	}
	.more-trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: 0;
		padding: 0 0 6px;
		font-family: var(--body-f);
		font-size: 0.72rem;
		font-weight: 400;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted);
		white-space: nowrap;
		cursor: pointer;
		position: relative;
		transition: color 0.3s;
	}
	.more-trigger::after {
		content: '';
		position: absolute;
		left: 0;
		bottom: 0;
		width: 0;
		height: 1px;
		background: var(--gold);
		transition: width 0.35s var(--ease);
	}
	.more-trigger:hover,
	.more-trigger:focus-visible,
	.more-trigger.active {
		color: var(--ivory);
	}
	.more-trigger:hover::after,
	.more-trigger:focus-visible::after,
	.more-trigger.active::after {
		width: 100%;
	}
	.more-trigger svg {
		width: 12px;
		height: 12px;
		transition: transform 0.3s var(--ease);
	}
	.more-trigger.active svg {
		transform: rotate(180deg);
	}

	.more-panel {
		position: absolute;
		top: calc(100% + 16px);
		/* Hangs from the trigger's left edge; it's the last item in the row, so a
		   right-anchored panel would run off a narrow bar. */
		left: -18px;
		min-width: 210px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 0;
		background: var(--veil-solid);
		-webkit-backdrop-filter: blur(14px);
		backdrop-filter: blur(14px);
		border: 1px solid var(--hair);
		border-top: 1px solid var(--gold);
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
		/* Closed: kept in the DOM (so the caret/panel can transition) but inert —
		   visibility, not just opacity, or it would still swallow clicks. */
		opacity: 0;
		visibility: hidden;
		transform: translateY(-8px);
		transition:
			opacity 0.28s var(--ease),
			transform 0.28s var(--ease),
			visibility 0s linear 0.28s;
	}
	.more-panel.open {
		opacity: 1;
		visibility: visible;
		transform: translateY(0);
		transition-delay: 0s;
	}
	.more-panel a,
	.more-panel .soon {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 10px 22px;
		font-family: var(--body-f);
		font-size: 0.72rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--muted);
		white-space: nowrap;
		transition:
			color 0.25s,
			background 0.25s,
			padding-left 0.25s var(--ease);
	}
	.more-panel a:hover,
	.more-panel a:focus-visible,
	.more-panel a.active {
		color: var(--ivory);
		/* A 10% wash of whichever gold this brand runs — hardcoding Asia's tinted
		   the Fusion dropdown's hover the wrong hue. */
		background: color-mix(in srgb, var(--gold) 10%, transparent);
		padding-left: 26px;
	}
	.more-panel .soon {
		color: rgba(163, 160, 160, 0.6);
	}
	.more-panel .soon em {
		font-style: normal;
		font-size: 0.58rem;
		letter-spacing: 0.2em;
		color: var(--gold);
	}

	/* Same button as the hero's, scoped again here (Svelte styles don't cross
	   component boundaries) so the two stay visually identical. */
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		border: 1px solid var(--sakura);
		color: var(--ivory);
		background: transparent;
		padding: 15px 30px;
		font-family: var(--body-f);
		font-size: 0.72rem;
		font-weight: 400;
		line-height: 1.6;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		text-decoration: none;
		white-space: nowrap;
		position: relative;
		overflow: hidden;
		z-index: 0;
		transition:
			color 0.5s var(--ease),
			box-shadow 0.4s var(--ease);
	}
	.btn::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2));
		transform: translateX(-101%);
		transition: transform 0.5s var(--ease);
		z-index: -1;
	}
	.btn:hover,
	.btn:focus-visible {
		color: #fff;
		box-shadow: 0 10px 30px var(--sakura-glow);
	}
	.btn:hover::before,
	.btn:focus-visible::before {
		transform: translateX(0);
	}
	.btn svg {
		width: 14px;
		height: 14px;
		transition: transform 0.4s var(--ease);
	}
	.btn:hover svg {
		transform: translateX(4px);
	}
	.btn-solid {
		background: linear-gradient(120deg, var(--sakura), var(--sakura-2));
		color: #fff;
		border-color: transparent;
		box-shadow: 0 10px 30px var(--sakura-glow);
	}
	.btn-solid::before {
		background: linear-gradient(120deg, var(--sakura-2), var(--sakura));
	}

	/* Out of flow deliberately — see the note on the markup. */
	.nav-burger {
		display: none;
		position: absolute;
		right: 20px;
		top: 50%;
		translate: 0 -50%;
		background: none;
		border: none;
		padding: 8px;
		cursor: pointer;
	}
	.nav-burger > span {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.nav-burger span span {
		width: 22px;
		height: 1px;
		background: var(--ivory);
		display: block;
		transition:
			transform 0.35s var(--ease),
			opacity 0.2s;
	}
	/* Burger → X while the panel is open. */
	.nav-burger .x span:nth-child(1) {
		transform: translateY(6px) rotate(45deg);
	}
	.nav-burger .x span:nth-child(2) {
		opacity: 0;
	}
	.nav-burger .x span:nth-child(3) {
		transform: translateY(-6px) rotate(-45deg);
	}

	.mobile-panel {
		position: fixed;
		inset: 0;
		z-index: 199;
		background: var(--ink);
		display: flex;
		flex-direction: column;
		align-items: center;
		/* Centred by the auto margins on the first and last item below, NOT by
		   `justify-content: center`. A centred flex column that overflows spills
		   equally off BOTH ends, and the top half of that spill is unreachable — you
		   can't scroll to a negative offset. The list needs ~760px, which is taller
		   than most phones' visible viewport once the browser's own bars are up
		   (≈660px on an iPhone), so "Home" sat half under the bar with no way to
		   bring it down. Auto margins centre it when there's room and collapse to 0
		   when there isn't, so it then starts at the top and scrolls normally. */
		justify-content: flex-start;
		gap: 8px;
		padding: 76px 24px calc(32px + env(safe-area-inset-bottom, 0px));
		box-sizing: border-box;
		overflow-y: auto;
		/* Reaching the end of the list must not start scrolling the page behind. */
		overscroll-behavior: contain;
		transform: translateY(-100%);
		transition: transform 0.5s var(--ease);
	}
	.mobile-panel > :first-child {
		margin-top: auto;
	}
	.mobile-panel > :last-child {
		margin-bottom: auto;
	}
	.mobile-panel.open {
		transform: translateY(0);
	}
	/* The row pitch is unchanged (30px of type + 22px of air), but 14px of that air
	   is now the link's own padding: each one was a 30px-tall target, and is now 44. */
	.mobile-panel a:not(.btn),
	.mobile-panel .soon {
		font-family: var(--display);
		font-size: 1.3rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		text-decoration: none;
		color: var(--ivory);
		padding: 7px 12px;
	}
	/* Where you are — the bar's links carry this on desktop, the panel never did. */
	.mobile-panel a.active:not(.btn) {
		color: var(--gold);
	}
	.mobile-panel .soon {
		color: var(--muted);
		display: inline-flex;
		align-items: baseline;
		gap: 10px;
	}
	.mobile-panel .soon em {
		font-family: var(--body-f);
		font-style: normal;
		font-size: 0.6rem;
		letter-spacing: 0.2em;
		color: var(--gold);
	}
	.mobile-panel .btn {
		margin-top: 18px;
	}
	/* Short viewports — which is every phone with its address bar showing. Tighten
	   the list so all of it, "Book a Table" included, lands on one screen down to
	   640px tall instead of asking for a scroll to reach the last two rows. */
	@media (max-height: 760px) {
		.mobile-panel {
			gap: 4px;
			padding-top: 70px;
			padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
		}
		.mobile-panel a:not(.btn),
		.mobile-panel .soon {
			font-size: 1.12rem;
			padding: 6px 12px;
		}
		.mobile-panel .btn {
			margin-top: 12px;
		}
	}

	/* The bar's compact mode. It used to start at 1340 (where the Uber ribbon drops
	   to 160×160); with "More" in the row the full-spacing bar overflows its own
	   padding by ~90px at 1440, so the same compaction now starts earlier rather
	   than being a new, third set of spacings. */
	@media (max-width: 1520px) {
		.nav-links {
			gap: 24px;
		}
		.nav-links a {
			letter-spacing: 0.14em;
		}
		.site-nav {
			padding: 22px 28px;
		}
		.site-nav.scrolled {
			padding: 12px 28px;
		}
		.btn {
			padding: 13px 20px;
		}
	}
	/* The template drops to the burger at 760px; ours holds six links plus the "More"
	   dropdown, so it has to fold sooner or the bar wraps. Was 1180 for six links;
	   the seventh item pushes the fold to 1300 —
	   below that the CTA was spilling past the bar's padding and the wordmark's
	   clearance from the right-hand links closed to nothing. Nothing is lost: the
	   burger panel below here carries every link the bar does. */
	@media (max-width: 1300px) {
		.nav-links,
		.nav-cta,
		.nav-ghost {
			display: none;
		}
		/* The three 1px bars stack only 13px tall, so `padding: 8px` alone gave a
		   38x29 hit area — under the 44px minimum, and on a phone this is the ONLY
		   navigation control on the page. Grow the box without moving the glyph. */
		.nav-burger {
			display: flex;
			align-items: center;
			justify-content: center;
			min-width: 44px;
			min-height: 44px;
			padding: 0;
		}
		/* The cluster is down to the wordmark alone, which its own `justify-content:
		   center` holds on true centre — the burger is out of flow and can't pull it. */
		.site-nav {
			padding: 18px 20px;
		}
		.site-nav.scrolled {
			padding: 12px 20px;
		}
	}
	@media (max-width: 600px) {
		.site-nav {
			padding: 16px;
		}
		.site-nav.scrolled {
			padding: 10px 16px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mobile-panel {
			transition-duration: 0.001ms;
		}
		/* The panel still needs its visibility flip, just without the slide. */
		.more-panel {
			transform: none;
			transition:
				opacity 0.001ms,
				visibility 0s;
		}
		.more-panel.open {
			transform: none;
		}
		.more-trigger svg {
			transition: none;
		}
	}
</style>
