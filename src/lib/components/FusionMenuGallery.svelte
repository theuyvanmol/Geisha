<script lang="ts">
	// Fusion menus selector — an expanding horizontal "gallery" accordion. Each
	// menu is a panel that grows on hover/focus (inspired by the classic flex-grow
	// gallery codepen), with a terracotta reveal-rim border so it stays on-brand
	// with the Fusion editorial landing. Closed panels show a vertical title;
	// the active panel reveals a full image + title + subtitle + a "View" cue.
	// On narrow screens the strip stacks vertically (height-grow instead of width).
	import type { Brand } from '$lib/data/brand';
	import { getMenuIndex } from '$lib/data/menus';
	import { menuCover } from '$lib/data/menu-covers';
	import { menuFileKind } from '$lib/data/menu-types';

	type MenuIndexEntry = {
		slug: string;
		title: string;
		subtitle?: string;
		pdf?: string;
		/** Cover photo chosen in the admin Menus editor; overrides IMG below. */
		img?: string;
	};
	import UberEatsButton from './UberEatsButton.svelte';
	import TouchTakeawayButton from './TouchTakeawayButton.svelte';
	import { onMount } from 'svelte';

	// `menuIndex` comes from the page loader (editable content); falls back to the
	// static menu index when not provided.
	let { brand, menuIndex }: { brand: Brand; menuIndex?: MenuIndexEntry[] } = $props();
	const base = $derived(`/${brand.id}`);
	// Only show menus that have a downloadable PDF — each panel opens that PDF
	// directly (the built HTML menu pages are no longer linked).
	const menus = $derived((menuIndex ?? getMenuIndex(brand.id)).filter((m) => !!m.pdf));

	// Cover photos live in $lib/data/menu-covers, so this gallery and the Asia home
	// page's menu tiles can never disagree about which picture belongs to a menu.
	const imgFor = (m: MenuIndexEntry) => menuCover(m);

	// Which panel is expanded. Defaults to the Main Menu so it's the focused
	// panel on load (falls back to the first if there's no "main"); hover/focus
	// moves it. (Pointer hover via CSS handles the common case; we also track it
	// in state for keyboard focus + touch taps.)
	const homeIndex = $derived(
		Math.max(
			0,
			menus.findIndex((m) => m.slug === 'main')
		)
	);
	let active = $state(0);
	// Open on the Main Menu without clobbering later hover/focus: only re-sync
	// when the home panel itself moves (brand/menu-list change), not every render.
	let lastHome = -1;
	$effect(() => {
		if (homeIndex !== lastHome) {
			lastHome = homeIndex;
			active = homeIndex;
		}
	});

	// Touch/narrow screens have no hover, so the panels can't be expanded by
	// hovering — and because each panel is a link straight to its PDF, a first tap
	// would open the PDF before the guest has seen what the panel is. On mobile we
	// make the first tap EXPAND the panel (preview its image/title/subtitle); only
	// a tap on the already-open panel follows through to the PDF. Kept in sync with
	// the 760px CSS breakpoint below.
	let isMobile = $state(false);
	onMount(() => {
		const mq = window.matchMedia('(max-width: 760px)');
		const sync = () => (isMobile = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	function onPanelClick(i: number, e: MouseEvent) {
		// Desktop keeps the hover-to-expand + click-to-open behaviour untouched.
		if (!isMobile) return;
		// On mobile, the first tap only expands a closed panel; the PDF link follows
		// through on a second tap of the now-active panel.
		if (active !== i) {
			e.preventDefault();
			active = i;
		}
	}
</script>

<section class="wrap">
	<header class="head">
		<span class="kicker">The menus</span>
		<h1>Choose your <em>table</em></h1>
		<p class="lead">{brand.tagline}</p>
		<div class="cta">
			<a class="book" href="{base}/bookings">Book a Table</a>
			<UberEatsButton href={brand.uberEatsUrl} size="md" />
			<TouchTakeawayButton href={brand.touchTakeawayUrl} size="md" />
		</div>
	</header>

	<!-- Expanding gallery. `--n` lets the closed panels size themselves so the
	     active one can grow without overflowing. -->
	<nav
		class="gallery"
		style="--n:{menus.length}"
		aria-label="Menus"
		onmouseleave={() => (active = homeIndex)}
	>
		{#each menus as m, i}
			<a
				class="panel"
				class:is-active={active === i}
				href={m.pdf}
				target="_blank"
				rel="noopener"
				aria-label="Open the {m.title} menu ({menuFileKind(m.pdf)})"
				onmouseenter={() => (active = i)}
				onfocus={() => (active = i)}
				onclick={(e) => onPanelClick(i, e)}
			>
				<span class="panel-img" style="background-image:url('{imgFor(m)}')"></span>
				<span class="panel-scrim" aria-hidden="true"></span>
				<span class="panel-rim" aria-hidden="true"></span>

				<!-- Vertical label, always visible (rotates upright when active) -->
				<span class="panel-spine">{m.title}</span>

				<!-- Expanded content, fades in for the active panel -->
				<span class="panel-body">
					<span class="panel-num">{(i + 1).toString().padStart(2, '0')}</span>
					<span class="panel-title">{m.title}</span>
					{#if m.subtitle}<span class="panel-sub">{m.subtitle}</span>{/if}
					<!-- Not a hardcoded "PDF": Asia's main menu is published only as a
					     JPEG (the Aug 2026 reprint), so the label comes off the file. -->
					<span class="panel-cta">View {menuFileKind(m.pdf)} ›</span>
				</span>
			</a>
		{/each}
	</nav>
</section>

<style>
	.wrap {
		max-width: 1320px;
		margin: 0 auto;
		padding: clamp(2.2rem, 5vw, 3.6rem) clamp(1.2rem, 5vw, 3rem) clamp(3rem, 6vw, 5rem);
		color: var(--ink);
	}

	.head {
		text-align: center;
		margin-bottom: clamp(1.6rem, 4vw, 2.8rem);
	}
	.kicker {
		display: inline-block;
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: var(--accent-2);
		margin-bottom: 1rem;
	}
	.head h1 {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: clamp(2.4rem, 6vw, 4.4rem);
		line-height: 1.02;
		margin: 0 0 0.6rem;
		color: var(--ink);
	}
	.head h1 em {
		font-family: var(--font-serif);
		font-style: italic;
		color: var(--accent);
	}
	.lead {
		font-style: italic;
		font-family: var(--font-serif);
		font-size: 1.1rem;
		color: var(--ink-soft);
		margin: 0 0 1.6rem;
	}
	.cta {
		display: inline-flex;
		gap: 0.8rem;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
	}
	.book {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1rem;
		color: var(--accent);
		border: 1px solid var(--accent);
		padding: 0.7rem 1.4rem;
		border-radius: 2px;
		text-decoration: none;
		transition: background 0.25s ease;
	}
	.book:hover {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}

	/* ===== Expanding gallery ===== */
	.gallery {
		display: flex;
		flex-direction: row;
		gap: clamp(8px, 1vw, 14px);
		height: clamp(360px, 64vh, 640px);
		width: 100%;
	}

	.panel {
		position: relative;
		flex: 1 1 0;
		min-width: 0;
		height: 100%;
		overflow: hidden;
		text-decoration: none;
		color: #fff;
		background: var(--bg-2);
		/* terracotta hairline frame at rest; thickens on the active panel */
		outline: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
		outline-offset: -1px;
		transition: flex-grow 0.7s var(--ease-editorial);
		will-change: flex-grow;
	}
	/* The active panel takes the lion's share of the row. The slim closed panels
	   keep just enough width for the vertical spine label. */
	.panel.is-active {
		flex-grow: var(--n, 8);
	}

	/* background image — slightly zoomed, eases to full on activate */
	.panel-img {
		position: absolute;
		inset: 0;
		background-position: center;
		background-size: cover;
		background-repeat: no-repeat;
		transform: scale(1.08);
		filter: saturate(0.92) brightness(0.82);
		transition:
			transform 1.1s var(--ease-editorial),
			filter 0.6s var(--ease-editorial);
	}
	.panel.is-active .panel-img {
		transform: scale(1);
		filter: saturate(1) brightness(0.9);
	}

	/* readability scrim — heavier on closed panels so spine text reads */
	.panel-scrim {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			to top,
			rgba(20, 12, 8, 0.78) 0%,
			rgba(20, 12, 8, 0.28) 55%,
			rgba(20, 12, 8, 0.5) 100%
		);
		transition: background 0.6s var(--ease-editorial);
	}
	.panel.is-active .panel-scrim {
		background: linear-gradient(
			to top,
			rgba(20, 12, 8, 0.82) 0%,
			rgba(20, 12, 8, 0.12) 60%,
			rgba(20, 12, 8, 0.1) 100%
		);
	}

	/* terracotta reveal-rim — a thick inset border that appears on the active
	   panel (echoes the landing's frame-rim language). */
	.panel-rim {
		position: absolute;
		inset: 0;
		pointer-events: none;
		box-shadow: inset 0 0 0 0 var(--accent);
		transition: box-shadow 0.6s var(--ease-editorial);
	}
	.panel.is-active .panel-rim {
		box-shadow: inset 0 0 0 6px var(--accent);
	}

	/* ----- vertical spine label (closed state) ----- */
	.panel-spine {
		position: absolute;
		left: 50%;
		bottom: clamp(1rem, 2.4vw, 1.8rem);
		text-align: center;
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		translate: -50% 0;
		font-family: var(--font-display);
		font-weight: 400;
		font-size: clamp(0.86rem, 1.1vw, 1.05rem);
		letter-spacing: 0.04em;
		line-height: 1;
		white-space: nowrap;
		color: #fff;
		text-shadow: 0 1px 10px rgba(0, 0, 0, 0.5);
		opacity: 1;
		transition: opacity 0.4s var(--ease-editorial);
	}
	.panel.is-active .panel-spine {
		opacity: 0;
	}

	/* ----- expanded content (active state) ----- */
	.panel-body {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: clamp(1.4rem, 2.4vw, 2.4rem);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
		opacity: 0;
		transform: translateY(12px);
		transition:
			opacity 0.5s var(--ease-editorial) 0.18s,
			transform 0.6s var(--ease-editorial) 0.18s;
	}
	.panel.is-active .panel-body {
		opacity: 1;
		transform: translateY(0);
	}
	.panel-num {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.22em;
		color: color-mix(in srgb, var(--accent) 80%, #fff);
		font-feature-settings: 'tnum' 1;
	}
	.panel-title {
		font-family: var(--font-display);
		font-weight: 400;
		font-size: clamp(1.6rem, 2.6vw, 2.4rem);
		line-height: 1.04;
		color: #fff;
	}
	.panel-sub {
		font-family: var(--font-serif);
		font-style: italic;
		font-size: clamp(0.92rem, 1.2vw, 1.05rem);
		line-height: 1.4;
		max-width: 38ch;
		color: rgba(255, 255, 255, 0.86);
	}
	.panel-cta {
		margin-top: 0.7rem;
		font-family: var(--font-sans);
		font-size: 0.7rem;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		color: #fff;
		border-bottom: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
		padding-bottom: 3px;
		transition: border-color 0.3s var(--ease-editorial);
	}
	.panel.is-active:hover .panel-cta {
		border-color: var(--accent);
	}

	.panel:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	/* ===== Mobile: stack vertically, grow by height instead of width ===== */
	@media (max-width: 760px) {
		.gallery {
			flex-direction: column;
			height: auto;
			gap: 10px;
		}
		.panel {
			width: 100%;
			height: clamp(72px, 14vh, 96px);
			flex: 0 0 auto;
			transition: height 0.6s var(--ease-editorial);
		}
		.panel.is-active {
			height: clamp(300px, 50vh, 420px);
			flex: 0 0 auto;
		}
		.panel-spine {
			writing-mode: horizontal-tb;
			transform: none;
			translate: -50% 0;
			top: 50%;
			bottom: auto;
			margin-top: -0.6em;
			font-size: 1.1rem;
		}
		.panel.is-active .panel-spine {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.panel,
		.panel-img,
		.panel-scrim,
		.panel-rim,
		.panel-spine,
		.panel-body {
			transition: none;
		}
	}
</style>
