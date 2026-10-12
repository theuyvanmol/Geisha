<script lang="ts">
	// ONE-SCREEN GALLERY — "stage + filmstrip", with a contact-sheet overview.
	//
	// Replaces the parallax photo wall (AsiaGallery), which stacked every image in
	// a 3-column grid roughly seven screens tall. The client's objection was the
	// scrolling, so this holds the whole gallery inside a SINGLE viewport. Every
	// mode keeps to that:
	//
	//   • Slideshow — a large stage image, a thumbnail filmstrip beneath it, and
	//     arrows / keyboard / swipe between shots. Plays itself (a thin progress
	//     line along the bottom of the stage) until the guest pauses it; a mouse
	//     resting on the stage holds the current photo.
	//   • All photos — a contact sheet that fits EVERY photo into the same box the
	//     stage + strip fill (fitGrid picks the column count), never a tall grid.
	//   • Full screen — GalleryZoom, with wheel / pinch / double-tap zoom and pan.
	//
	// Behind it all, the current photo is blurred into a wide soft "spill" that
	// tints the page, so the room takes on the colour of whatever's on the stage.
	//
	// Shared by both brands and driven entirely by the tokens inherited from the
	// page's [data-brand] wrapper — Asia and Fusion run the same type pair and
	// differ only in palette, so there is deliberately no per-brand block here.
	// Keep it that way: the client wants the two gallery pages identical.
	//
	// Height: the section must end exactly at the bottom of the screen, and what
	// sits above it varies (the fixed nav is 92px, 70px under 1300px, and the
	// announcement banner adds more when one is live). CSS handles the common case
	// as a fallback; `measure()` then refines it from the element's own document
	// offset — the same self-measuring trick the diary chrome uses.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { srcset, fallback, thumbnail } from '$lib/media/responsive';
	import { getBrand, type BrandId } from '$lib/data/brand';
	import {
		GALLERY,
		GALLERY_CATEGORIES,
		type GalleryCategory,
		type GalleryImage
	} from '$lib/data/gallery';
	import GalleryZoom from './gallery/GalleryZoom.svelte';
	import { fitGrid, type GridFit } from './gallery/fitGrid';

	// The stage is the biggest image on the page; thumbs never need more than the
	// smallest rung. Without `sizes` the browser pulls 1600px for both.
	const STAGE_SIZES = '(max-width: 900px) 96vw, 68vw';
	const THUMB_SIZES = '120px';
	/** How long each photo holds in the slideshow. */
	const SLIDE_MS = 6000;
	const SHEET_GAP = 8;

	// `tagline` is the line each brand's page header used to carry above the wall.
	// It lives in the top bar under the title — the client's own copy, at a cost
	// of one row rather than the ~190px the old <header> took. Hidden on narrow
	// screens, where the width isn't there.
	let {
		brandId,
		images,
		tagline
	}: { brandId: BrandId; images?: GalleryImage[]; tagline?: string } = $props();

	const brandName = $derived(getBrand(brandId).name);

	// `?photo=N` (1-based, over the whole gallery) opens on a shared photo — the
	// link the Share button hands out.
	const linked = Number(page.url.searchParams.get('photo')) || 0;

	let filter = $state<GalleryCategory | 'all'>('all');
	let index = $state(linked > 0 ? linked - 1 : 0);
	let view = $state<'stage' | 'sheet'>('stage');
	let zoomed = $state(false);

	const all = $derived(images ?? GALLERY[brandId]);
	const shown = $derived(all.filter((g) => filter === 'all' || g.category === filter));
	// Filtering can leave `index` past the end for a frame; clamp on read rather
	// than trusting the reset in setFilter alone.
	const safeIndex = $derived(Math.min(index, Math.max(0, shown.length - 1)));
	const current = $derived(shown[safeIndex]);

	// Only offer a category that actually has photos in it. With the chips pruned
	// there is no way to reach an empty result — which matters when the empty
	// state would be a blank full-height stage.
	const counts = $derived.by(() => {
		const m: Record<string, number> = { all: all.length };
		for (const g of all) m[g.category] = (m[g.category] ?? 0) + 1;
		return m;
	});
	const cats = $derived(GALLERY_CATEGORIES.filter((c) => counts[c.id] > 0));

	const catLabel = (id: GalleryCategory) =>
		GALLERY_CATEGORIES.find((c) => c.id === id)?.label ?? id;

	// Captions in the CMS are often just a copy of the alt text; don't print the
	// same sentence twice. NO image name is ever printed: uploads carry the file
	// name as alt ("WhatsApp Image 2026-07-31 at 20.58.54 (1)"), so category,
	// the written caption and the counter are the only on-screen copy.
	const captionOf = (g: GalleryImage | undefined) =>
		g?.caption && g.caption !== (g.title ?? g.alt) ? g.caption : undefined;
	const caption = $derived(captionOf(current));

	function setFilter(id: GalleryCategory | 'all') {
		if (id === filter) return;
		filter = id;
		index = 0;
		loaded = [];
	}
	// On a phone the chips are a row that scrolls sideways, and the one just
	// tapped is usually the half-visible one at the edge. Bring it to the middle
	// — by scrollLeft, for the same reason the filmstrip does (see below). A row
	// that isn't scrolling (every desktop width) is left alone.
	function revealChip(el: HTMLElement) {
		const row = el.parentElement;
		if (!row || row.scrollWidth <= row.clientWidth) return;
		const a = row.getBoundingClientRect();
		const b = el.getBoundingClientRect();
		row.scrollTo({
			left: Math.max(0, row.scrollLeft + (b.left - a.left) - (row.clientWidth - b.width) / 2),
			behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		});
	}
	function go(i: number) {
		if (!shown.length) return;
		index = (i + shown.length) % shown.length;
	}
	const prev = () => go(safeIndex - 1);
	const next = () => go(safeIndex + 1);

	// ----- Slide mounting -----
	// Every slide is stacked and crossfaded, so `loading="lazy"` would be useless
	// (they are all technically in the viewport). Instead only the current shot
	// and its two neighbours are mounted, growing as the guest moves along — that
	// keeps the crossfade seamless without fetching a dozen full-size photos up
	// front. Reset whenever the filter remaps the indices.
	let loaded = $state<number[]>([]);
	$effect(() => {
		const n = shown.length;
		if (!n) return;
		const want = [safeIndex, (safeIndex + 1) % n, (safeIndex - 1 + n) % n];
		const add = want.filter((i) => !loaded.includes(i));
		if (add.length) loaded = [...loaded, ...add];
	});

	// ----- Slideshow -----
	// The progress line's own CSS animation IS the timer: it runs for SLIDE_MS
	// and `animationend` advances. Pausing is just animation-play-state, so the
	// line visibly stops where it is and resumes from there — no interval to
	// keep in step with it. {#key} on the index restarts it for every photo.
	let playing = $state(false);
	let hovering = $state(false);
	let pageVisible = $state(true);
	const autoplay = $derived(playing && view === 'stage' && shown.length > 1);
	const running = $derived(autoplay && !hovering && !zoomed && pageVisible);
	// The stage unmounts for the contact sheet, and a removed element never fires
	// pointerleave — without this the slideshow would come back stuck on pause.
	$effect(() => {
		void view;
		hovering = false;
	});

	onMount(() => {
		// Starts on its own unless the guest asked for less motion, or arrived on
		// a shared link to one particular photo (don't carry them away from it).
		if (!linked && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) playing = true;
		const vis = () => (pageVisible = document.visibilityState === 'visible');
		document.addEventListener('visibilitychange', vis);
		return () => document.removeEventListener('visibilitychange', vis);
	});

	// ----- Share -----
	let toast = $state('');
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	function say(msg: string) {
		toast = msg;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 2600);
	}
	async function share() {
		if (!current) return;
		const url = `${location.origin}${location.pathname}?photo=${all.indexOf(current) + 1}`;
		const title = `${brandName} gallery`;
		if (navigator.share && matchMedia('(hover: none)').matches) {
			try {
				await navigator.share({ title, text: caption ?? title, url });
			} catch {
				// Dismissing the share sheet rejects too; nothing to report.
			}
			return;
		}
		try {
			await navigator.clipboard.writeText(url);
			say('Link to this photo copied');
		} catch {
			say("Couldn't copy the link — use the address bar instead");
		}
	}

	// ----- Full screen -----
	let opener: HTMLElement | null = null;
	function openZoom() {
		opener = document.activeElement as HTMLElement | null;
		zoomed = true;
	}
	function closeZoom() {
		zoomed = false;
		opener?.focus({ preventScroll: true });
	}

	// ----- Keyboard -----
	function onkeydown(e: KeyboardEvent) {
		// Anything that isn't an element (a key sent to window/document) counts as
		// "nothing focused"; Node.contains() would throw on it.
		const t = e.target instanceof HTMLElement ? e.target : null;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const onPage = !t || t === document.body || !!rootEl?.contains(t);
		if (e.key === 'Escape' && zoomed) closeZoom();
		else if (e.key === 'Escape' && view === 'sheet') view = 'stage';
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'ArrowRight') next();
		else if (zoomed) return;
		else if (e.key === 'Home') go(0);
		else if (e.key === 'End') go(shown.length - 1);
		// Letter shortcuts only while focus is on the gallery (or nowhere), so
		// they can't fire from a link in the footer.
		else if (onPage && (e.key === 'g' || e.key === 'G')) view = view === 'stage' ? 'sheet' : 'stage';
		else if (onPage && (e.key === 'f' || e.key === 'F') && current) openZoom();
		// Space would press a focused button; only claim it when nothing is focused.
		else if ((e.key === ' ' || e.key === 'k') && (!t || t === document.body)) playing = !playing;
		else return;
		e.preventDefault();
	}

	// ----- Swipe -----
	// A swipe must not also count as the click that opens full screen.
	let swipeX = 0;
	let swipeY = 0;
	let swiped = false;
	function onpointerdown(e: PointerEvent) {
		swipeX = e.clientX;
		swipeY = e.clientY;
		swiped = false;
	}
	function onpointerup(e: PointerEvent) {
		const dx = e.clientX - swipeX;
		const dy = e.clientY - swipeY;
		if (Math.hypot(dx, dy) > 10) swiped = true;
		// Horizontal intent only, so a vertical drag on the page doesn't advance.
		if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
		if (dx > 0) prev();
		else next();
	}
	function onstageclick() {
		if (swiped) {
			swiped = false;
			return;
		}
		openZoom();
	}

	// ----- Filmstrip follows the stage -----
	// Set scrollLeft directly rather than scrollIntoView(): on a horizontally
	// scrollable strip that call can also nudge the PAGE vertically, which on a
	// deliberately unscrollable layout reads as a glitch.
	let stripEl = $state<HTMLElement>();
	$effect(() => {
		const i = safeIndex;
		const strip = stripEl;
		if (!strip) return;
		const thumb = strip.querySelector<HTMLElement>(`[data-i="${i}"]`);
		if (!thumb) return;
		const target = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2;
		strip.scrollTo({
			left: Math.max(0, target),
			behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		});
	});

	// ----- Contact sheet sizing -----
	let sheetEl = $state<HTMLElement>();
	let sheetW = $state(0);
	let sheetH = $state(0);
	$effect(() => {
		const el = sheetEl;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			sheetW = entry.contentRect.width;
			sheetH = entry.contentRect.height;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});
	// On a phone the sheet is top-aligned (see .sheet-grid) and the "Ask Geisha"
	// button is pinned over its bottom-right corner. Whether the button lands on a
	// photo was luck: 13 photos in three columns leave that cell empty, 15 fill it
	// and the button covered a third of the last tile. So, phones only:
	//   • if a tile would sit under the button, keep the same grid and take the
	//     button's height off the rows, so it gets a band of its own instead;
	//   • then let the tiles widen (a little, and never past 16:10) to meet the
	//     box's edges — a height-limited fit otherwise floats in a narrower
	//     column than the chips above it.
	// Pure arithmetic on the measured box: it never feeds back into the box's own
	// size, so it can't restart the ResizeObserver loop described at .sheet.
	const SHEET_PHONE = '(max-width: 720px)';
	/** The button's footprint in the sheet's corner (52px + a gap), as the strip's padding-right has it. */
	const FAB_W = 58;
	const FAB_H = 50;
	const SHEET_STRETCH = 1.2;
	const SHEET_MAX_ASPECT = 1.6;
	const sheet = $derived.by((): GridFit => {
		const n = shown.length;
		const fit = fitGrid(n, sheetW, sheetH, SHEET_GAP);
		if (!fit.tileW || typeof window === 'undefined' || !window.matchMedia(SHEET_PHONE).matches) return fit;
		const widen = (f: GridFit): GridFit => ({
			...f,
			tileW: Math.floor(
				Math.min(
					(sheetW - SHEET_GAP * (f.cols - 1)) / f.cols,
					f.tileW * SHEET_STRETCH,
					Math.max(f.tileW, f.tileH * SHEET_MAX_ASPECT)
				)
			)
		});
		// Only the last two rows can reach the corner.
		const underButton = (f: GridFit) => {
			const left = (sheetW - (f.cols * f.tileW + (f.cols - 1) * SHEET_GAP)) / 2;
			for (let i = n - 1; i >= Math.max(0, n - 2 * f.cols); i--) {
				const col = i % f.cols;
				const row = Math.floor(i / f.cols);
				const right = left + (col + 1) * f.tileW + col * SHEET_GAP;
				const bottom = (row + 1) * f.tileH + row * SHEET_GAP;
				if (right > sheetW - FAB_W && bottom > sheetH - FAB_H) return true;
			}
			return false;
		};
		const wide = widen(fit);
		if (!underButton(wide)) return wide;
		const tileH = Math.floor((sheetH - FAB_H - SHEET_GAP * (fit.rows - 1)) / fit.rows);
		return tileH > 0 ? widen({ ...fit, tileH }) : wide;
	});

	function pick(i: number) {
		go(i);
		view = 'stage';
	}

	// ----- Fit to exactly one screen -----
	let rootEl = $state<HTMLElement>();
	let boxH = $state(0);
	$effect(() => {
		const el = rootEl;
		if (!el) return;
		const measure = () => {
			const top = el.getBoundingClientRect().top + window.scrollY;
			// Take the SMALLEST of the three heights the browser will tell you.
			// They genuinely disagree: documentElement.clientHeight is the layout
			// viewport (100lvh — it does not shrink for a mobile URL bar),
			// innerHeight tracks the visual viewport but includes the horizontal
			// scrollbar gutter, and visualViewport.height is what's actually on
			// screen right now. Trusting innerHeight alone overshot by 145px on a
			// phone and pushed the filmstrip off the bottom — which is the one
			// failure this whole layout exists to avoid.
			const vh = Math.min(
				document.documentElement.clientHeight || Infinity,
				window.innerHeight || Infinity,
				window.visualViewport?.height ?? Infinity
			);
			// A floor so a very short window (or a landscape phone) degrades to a
			// usable stage with a little page scroll rather than a letterbox slit.
			const next = Math.max(420, vh - top - 8);
			if (Math.abs(next - boxH) > 1) boxH = next;
		};
		measure();
		window.addEventListener('resize', measure);
		window.visualViewport?.addEventListener('resize', measure);
		// Catches the banner mounting and the webfonts landing, both of which move
		// the section's top edge after first paint.
		const ro = new ResizeObserver(measure);
		ro.observe(document.body);
		return () => {
			window.removeEventListener('resize', measure);
			window.visualViewport?.removeEventListener('resize', measure);
			ro.disconnect();
		};
	});

	// Lock the page while the full-screen view is open.
	$effect(() => {
		if (!zoomed) return;
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prevOverflow;
		};
	});
</script>

<svelte:window {onkeydown} />

<section
	class="stage-gallery"
	bind:this={rootEl}
	style={boxH ? `--gal-h:${boxH}px` : undefined}
	aria-roledescription="carousel"
	aria-label="{brandName} gallery"
>
	<!-- The spill: the current photo, blurred far past the stage's edges, so the
	     page itself takes on its colour. Uses the smallest rung — at this blur a
	     320px image is indistinguishable from the master. -->
	<div class="spill" aria-hidden="true">
		{#each shown as img, i (img.src + '::' + i)}
			{#if loaded.includes(i)}
				<img class:on={i === safeIndex} src={thumbnail(img.src, 320) ?? fallback(img.src) ?? img.src} alt="" />
			{/if}
		{/each}
	</div>

	<div class="inner">
		<!-- Top bar: the page's title sits INSIDE the gallery rather than above it.
		     A full editorial header cost ~190px, and on a one-screen layout that
		     came straight off the photo. -->
		<div class="topbar">
			<div class="titles">
				<h1>Gallery</h1>
				{#if tagline}
					<p class="tagline">{tagline}</p>
				{/if}
			</div>

			<div class="chips" role="group" aria-label="Filter gallery">
				{#each cats as c}
					<button
						class="chip"
						class:on={filter === c.id}
						aria-pressed={filter === c.id}
						onclick={(e) => {
							setFilter(c.id);
							revealChip(e.currentTarget);
						}}
					>
						{c.label}<span class="n">{counts[c.id]}</span>
					</button>
				{/each}
			</div>

			<div class="tools">
				{#if view === 'stage' && shown.length > 1}
					<button
						class="tool"
						onclick={() => (playing = !playing)}
						aria-label={playing ? 'Pause slideshow' : 'Play slideshow'}
						title={playing ? 'Pause slideshow' : 'Play slideshow'}
					>
						{#if playing}
							<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="9" y1="6" x2="9" y2="18" /><line x1="15" y1="6" x2="15" y2="18" /></svg>
						{:else}
							<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="8 5.5 18.5 12 8 18.5" /></svg>
						{/if}
					</button>
				{/if}
				<button
					class="tool wide"
					class:on={view === 'sheet'}
					aria-pressed={view === 'sheet'}
					onclick={() => (view = view === 'stage' ? 'sheet' : 'stage')}
					title={view === 'stage' ? 'See every photo at once (G)' : 'Back to the slideshow (G)'}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
						<rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
					</svg>
					<span>All photos</span>
				</button>
			</div>
		</div>

		{#if view === 'stage'}
			<!-- The stage. The pointer handlers are the swipe gesture; the same
			     navigation is on the arrow buttons and the window's ←/→ handler. -->
			<div
				class="stage"
				role="group"
				aria-label="Current photo"
				{onpointerdown}
				{onpointerup}
				onpointerenter={(e) => e.pointerType === 'mouse' && (hovering = true)}
				onpointerleave={() => (hovering = false)}
			>
				{#each shown as img, i (img.src + '::' + i)}
					{#if loaded.includes(i)}
						<figure class="slide" class:on={i === safeIndex} aria-hidden={i !== safeIndex}>
							<!-- Ambient wash: the same photo, blurred, so a portrait shot
							     doesn't sit between two dead bars. Contained rather than
							     cropped on the front layer — these are plated dishes, and
							     cover-cropping cuts the food. -->
							<img class="ambient" src={thumbnail(img.src, 320) ?? fallback(img.src) ?? img.src} alt="" aria-hidden="true" />
							<picture>
								<source type="image/avif" srcset={srcset(img.src, 'avif')} sizes={STAGE_SIZES} />
								<source type="image/webp" srcset={srcset(img.src, 'webp')} sizes={STAGE_SIZES} />
								<img
									class="shot"
									src={fallback(img.src) ?? img.src}
									alt={img.alt}
									decoding="async"
									draggable="false"
									fetchpriority={i === safeIndex ? 'high' : 'low'}
								/>
							</picture>
						</figure>
					{/if}
				{/each}

				{#if current}
					<!-- The whole picture opens full screen. -->
					<button class="open" onclick={onstageclick} aria-label="View this photo full screen"></button>

					<div class="scrim">
						<div class="cap">
							<span class="cat">{catLabel(current.category)}</span>
							{#if caption}
								<p>{caption}</p>
							{/if}
						</div>
						<span class="count" aria-hidden="true">
							<b>{safeIndex + 1}</b><span class="of">/</span>{shown.length}
						</span>
					</div>

					<div class="corner">
						<button class="round" onclick={share} aria-label="Share this photo" title="Share this photo">
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M12 15V4" /><polyline points="7.5 8.5 12 4 16.5 8.5" /><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
							</svg>
						</button>
						<button class="round" onclick={openZoom} aria-label="View full screen" title="Full screen (F)">
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<polyline points="15 4 20 4 20 9" /><polyline points="9 20 4 20 4 15" />
								<line x1="20" y1="4" x2="13.5" y2="10.5" /><line x1="4" y1="20" x2="10.5" y2="13.5" />
							</svg>
						</button>
					</div>
				{/if}

				{#if shown.length > 1}
					<button class="arrow left" onclick={prev} aria-label="Previous photo">
						<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 5 8 12 15 19" /></svg>
					</button>
					<button class="arrow right" onclick={next} aria-label="Next photo">
						<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 5 16 12 9 19" /></svg>
					</button>
				{/if}

				{#if autoplay}
					{#key `${filter}:${safeIndex}`}
						<span
							class="progress"
							style:animation-duration="{SLIDE_MS}ms"
							style:animation-play-state={running ? 'running' : 'paused'}
							onanimationend={next}
							aria-hidden="true"
						></span>
					{/key}
				{/if}
			</div>

			<!-- Filmstrip -->
			<div class="strip" bind:this={stripEl} role="tablist" aria-label="Choose a photo">
				{#each shown as img, i (img.src + '::' + i)}
					<button
						class="thumb"
						class:on={i === safeIndex}
						data-i={i}
						role="tab"
						aria-selected={i === safeIndex}
						aria-label="Photo {i + 1}: {catLabel(img.category)}{captionOf(img) ? `, ${captionOf(img)}` : ''}"
						onclick={() => go(i)}
					>
						<picture>
							<source type="image/avif" srcset={srcset(img.src, 'avif')} sizes={THUMB_SIZES} />
							<source type="image/webp" srcset={srcset(img.src, 'webp')} sizes={THUMB_SIZES} />
							<img src={fallback(img.src) ?? img.src} alt="" loading="lazy" decoding="async" />
						</picture>
					</button>
				{/each}
			</div>
		{:else}
			<!-- Contact sheet: every photo at once, sized to fit the box exactly. -->
			<div class="sheet" bind:this={sheetEl}>
				{#if sheet.tileW}
					<div
						class="sheet-grid"
						style:grid-template-columns="repeat({sheet.cols}, {sheet.tileW}px)"
						style:grid-auto-rows="{sheet.tileH}px"
						style:gap="{SHEET_GAP}px"
					>
						{#each shown as img, i (img.src + '::' + i)}
							<button
								class="tile"
								class:on={i === safeIndex}
								style:animation-delay="{Math.min(i, 24) * 22}ms"
								onclick={() => pick(i)}
								aria-label="Open photo {i + 1}: {catLabel(img.category)}{captionOf(img) ? `, ${captionOf(img)}` : ''}"
							>
								<picture>
									<source type="image/avif" srcset={srcset(img.src, 'avif')} sizes="{sheet.tileW}px" />
									<source type="image/webp" srcset={srcset(img.src, 'webp')} sizes="{sheet.tileW}px" />
									<img src={fallback(img.src) ?? img.src} alt="" decoding="async" />
								</picture>
								<span class="tile-cap">
									<span class="cat">{catLabel(img.category)}</span>
									{#if captionOf(img) && sheet.tileW > 170}<span class="line">{captionOf(img)}</span>{/if}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<p class="sr-only" aria-live="polite">
		{#if current && view === 'stage'}Photo {safeIndex + 1} of {shown.length}: {catLabel(current.category)}{caption ? `. ${caption}` : ''}{/if}
	</p>
</section>

{#if zoomed && current}
	<GalleryZoom
		image={current}
		index={safeIndex}
		total={shown.length}
		category={catLabel(current.category)}
		{caption}
		onprev={prev}
		onnext={next}
		onclose={closeZoom}
		onshare={share}
	/>
{/if}

<div class="toast" class:show={!!toast} role="status" aria-live="polite">{toast}</div>

<style>
	picture {
		display: contents;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.stage-gallery {
		/* The JS measurement wins once it lands; this fallback is what the server
		   renders, and matches the layout's own .offset padding (92 / 70px). */
		height: var(--gal-h, calc(100dvh - 100px));
		position: relative;
		isolation: isolate;
		overflow: hidden;
	}
	@media (max-width: 1300px) {
		.stage-gallery {
			height: var(--gal-h, calc(100dvh - 78px));
		}
	}

	/* ----- The spill ----- */
	.spill {
		position: absolute;
		inset: 0;
		z-index: -1;
		pointer-events: none;
		/* Fade out top and bottom so it reads as light in the room, not a band
		   with edges. */
		-webkit-mask-image: linear-gradient(to bottom, transparent, #000 18%, #000 70%, transparent);
		mask-image: linear-gradient(to bottom, transparent, #000 18%, #000 70%, transparent);
	}
	.spill img {
		position: absolute;
		inset: -10%;
		width: 120%;
		height: 120%;
		object-fit: cover;
		filter: blur(90px) saturate(1.3);
		opacity: 0;
		transition: opacity 1.2s ease;
	}
	.spill img.on {
		opacity: 0.45;
	}

	.inner {
		height: 100%;
		max-width: 1560px;
		margin: 0 auto;
		padding: clamp(0.6rem, 1.6vh, 1.3rem) clamp(0.9rem, 3.5vw, 2.2rem) clamp(0.9rem, 2vh, 1.5rem);
		box-sizing: border-box;
		display: grid;
		/* minmax(0,1fr) — a plain 1fr refuses to shrink below the image's own
		   height and pushes the filmstrip off the bottom of the screen. */
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: clamp(0.6rem, 1.4vh, 1.1rem);
	}

	/* ----- Top bar ----- */
	.topbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		grid-template-areas: 'titles chips tools';
		align-items: center;
		gap: 0.6rem 1rem;
		min-width: 0;
	}
	/* Title over tagline, left-aligned as one block. Side by side — a large serif,
	   a vertical rule, then small grey sans centred against it — the two never
	   shared a line or a baseline and read as two unrelated labels. Stacked, the
	   tagline sits under the word it describes for ~18px of height. */
	.titles {
		grid-area: titles;
		min-width: 0;
	}
	.titles h1 {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: clamp(1.6rem, 2.6vw, 2.15rem);
		line-height: 1;
		letter-spacing: -0.01em;
		margin: 0;
		color: var(--ink);
	}
	.tagline {
		font-family: var(--font-body);
		font-size: 0.9rem;
		line-height: 1.3;
		color: var(--ink-soft);
		margin: 0.35rem 0 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Phones: the title shares its row with the play/grid buttons. */
	@media (max-width: 860px) {
		.tagline {
			display: none;
		}
	}

	.chips {
		grid-area: chips;
		display: flex;
		gap: 0.35rem;
		overflow-x: auto;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		padding: 3px;
		min-width: 0;
	}
	.chips::-webkit-scrollbar {
		display: none;
	}
	.chip {
		flex: none;
		display: inline-flex;
		align-items: baseline;
		gap: 0.45rem;
		font-family: var(--font-body);
		font-size: 0.9rem;
		letter-spacing: 0.01em;
		min-height: 40px;
		padding: 0.5rem 0.95rem;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--ink-soft);
		cursor: pointer;
		transition:
			color 0.2s ease,
			border-color 0.2s ease,
			background 0.2s ease;
	}
	.chip .n {
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		color: var(--ink-faint);
		transition: color 0.2s ease;
	}
	.chip:hover {
		border-color: var(--accent);
		color: var(--ink);
	}
	.chip.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--bg);
	}
	.chip.on .n {
		color: var(--bg);
		opacity: 0.7;
	}

	.tools {
		grid-area: tools;
		display: flex;
		gap: 0.35rem;
		padding-left: 1rem;
		border-left: 1px solid var(--line);
	}
	.tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-width: 40px;
		height: 40px;
		padding: 0 0.6rem;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--ink-soft);
		font-family: var(--font-body);
		font-size: 0.9rem;
		cursor: pointer;
		transition:
			color 0.2s ease,
			border-color 0.2s ease,
			background 0.2s ease;
	}
	.tool.wide {
		padding: 0 0.95rem 0 0.75rem;
	}
	.tool svg {
		width: 17px;
		height: 17px;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.tool polygon {
		fill: currentColor;
	}
	.tool:hover {
		border-color: var(--accent);
		color: var(--ink);
	}
	.tool.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--bg);
	}

	/* ----- Stage ----- */
	.stage {
		position: relative;
		min-height: 0;
		overflow: hidden;
		border-radius: 10px;
		background: var(--bg-2);
		box-shadow: 0 30px 70px -35px rgba(0, 0, 0, 0.9);
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
	}
	.slide {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		transition: opacity 0.6s ease;
		pointer-events: none;
	}
	.slide.on {
		opacity: 1;
	}
	.ambient {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		/* Scaled up because blur() samples transparent pixels past the edge and
		   would otherwise leave a pale halo around the frame. */
		transform: scale(1.2);
		filter: blur(38px) saturate(1.15) brightness(0.42);
	}
	.shot {
		position: relative;
		z-index: 1;
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
		/* The incoming photo settles from a hair larger — enough to feel like it
		   arrived, not enough to read as an effect. */
		transform: scale(1.025);
		transition: transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1);
		-webkit-user-drag: none;
	}
	.slide.on .shot {
		transform: none;
	}

	.open {
		position: absolute;
		inset: 0;
		z-index: 2;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: zoom-in;
	}

	.scrim {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 3;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1.5rem;
		padding: 4rem clamp(1rem, 2.4vw, 1.9rem) clamp(1rem, 2.2vh, 1.5rem);
		background: linear-gradient(to top, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.3) 45%, transparent);
		pointer-events: none;
	}
	.cap {
		min-width: 0;
	}
	.cat {
		display: block;
		font-family: var(--font-body);
		font-size: 0.82rem;
		letter-spacing: 0.04em;
		color: var(--accent);
	}
	.cap p {
		font-family: var(--font-display);
		font-size: clamp(1.02rem, 1.6vw, 1.4rem);
		line-height: 1.4;
		margin: 0.3rem 0 0;
		color: #fff;
		max-width: 44ch;
	}
	.count {
		flex: none;
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.6);
	}
	.count b {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: clamp(1.4rem, 2.4vw, 2rem);
		line-height: 1;
		color: #fff;
	}
	.count .of {
		margin: 0 0.35rem 0 0.3rem;
	}

	/* ----- Stage controls ----- */
	.round,
	.arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: rgba(0, 0, 0, 0.42);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		cursor: pointer;
		transition:
			background 0.2s ease,
			border-color 0.2s ease,
			opacity 0.25s ease;
	}
	.round svg,
	.arrow svg {
		fill: none;
		stroke: #fff;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.round:hover,
	.arrow:hover {
		background: var(--accent);
		border-color: var(--accent);
	}
	.round:hover svg,
	.arrow:hover svg {
		stroke: var(--bg);
	}
	.arrow {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: 4;
		width: 50px;
		height: 50px;
	}
	.arrow svg {
		width: 22px;
		height: 22px;
	}
	.arrow.left {
		left: clamp(0.6rem, 1.6vw, 1.2rem);
	}
	.arrow.right {
		right: clamp(0.6rem, 1.6vw, 1.2rem);
	}
	.corner {
		position: absolute;
		top: clamp(0.6rem, 1.6vw, 1.1rem);
		right: clamp(0.6rem, 1.6vw, 1.1rem);
		z-index: 4;
		display: flex;
		gap: 0.45rem;
	}
	.round {
		width: 42px;
		height: 42px;
	}
	.round svg {
		width: 18px;
		height: 18px;
	}
	/* With a mouse, the controls wait until the pointer is on the photo — the
	   picture gets the stage to itself otherwise. Touch keeps them visible. */
	@media (hover: hover) {
		.stage:not(:hover):not(:focus-within) .arrow,
		.stage:not(:hover):not(:focus-within) .corner {
			opacity: 0;
		}
	}

	.progress {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 4;
		height: 2px;
		background: var(--accent);
		transform-origin: left center;
		animation-name: progress;
		animation-timing-function: linear;
		animation-fill-mode: both;
		pointer-events: none;
	}
	@keyframes progress {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}

	/* ----- Filmstrip ----- */
	.strip {
		display: flex;
		gap: 0.45rem;
		height: clamp(54px, 9.5vh, 92px);
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		padding: 2px 2px 6px;
		/* The "Ask Geisha" assistant button is pinned to this exact corner on every
		   brand page. Trailing padding INSIDE the scroller means the strip still
		   spans the full width (matching the stage above it) while the last thumb
		   can always be scrolled out from under the button. */
		padding-right: 190px;
	}
	.strip::-webkit-scrollbar {
		display: none;
	}
	.thumb {
		flex: none;
		height: 100%;
		aspect-ratio: 4 / 3;
		padding: 0;
		border: 0;
		border-radius: 5px;
		overflow: visible;
		background: var(--bg-2);
		cursor: pointer;
		position: relative;
		opacity: 0.45;
		filter: saturate(0.7);
		transition:
			opacity 0.25s ease,
			filter 0.25s ease;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		border-radius: 5px;
	}
	/* The current thumb is marked by a short accent rule beneath it rather than
	   a box — it lines up with the progress line along the stage above. */
	.thumb::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: -5px;
		width: 0;
		height: 2px;
		background: var(--accent);
		transform: translateX(-50%);
		transition: width 0.3s ease;
	}
	.thumb:hover {
		opacity: 0.85;
		filter: none;
	}
	.thumb.on {
		opacity: 1;
		filter: none;
	}
	.thumb.on::after {
		width: 60%;
	}

	/* ----- Contact sheet ----- */
	/* The tiles are sized FROM this box, so they must not also size it: taken
	   out of flow, they can't feed back into the auto row the sheet spans. In
	   flow, they grew the box, the tiles were re-fitted to it, the box shrank
	   again, and ResizeObserver gave up mid-loop on a stale layout. */
	.sheet {
		grid-row: 2 / 4;
		min-height: 0;
		position: relative;
	}
	.sheet-grid {
		position: absolute;
		inset: 0;
		display: grid;
		justify-content: center;
		align-content: center;
	}
	.tile {
		position: relative;
		padding: 0;
		border: 0;
		border-radius: 6px;
		overflow: hidden;
		background: var(--bg-2);
		cursor: pointer;
		animation: tile-in 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}
	@keyframes tile-in {
		from {
			opacity: 0;
			transform: scale(0.96);
		}
	}
	.tile img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		transition: transform 0.5s ease;
	}
	.tile:hover img {
		transform: scale(1.04);
	}
	.tile.on {
		box-shadow: 0 0 0 2px var(--accent);
	}
	.tile-cap {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		padding: 1.6rem 0.7rem 0.55rem;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent);
		text-align: left;
		opacity: 0;
		transform: translateY(4px);
		transition:
			opacity 0.25s ease,
			transform 0.25s ease;
	}
	.tile:hover .tile-cap,
	.tile:focus-visible .tile-cap {
		opacity: 1;
		transform: none;
	}
	.tile-cap .cat {
		font-size: 0.75rem;
	}
	.tile-cap .line {
		font-family: var(--font-display);
		font-size: 0.85rem;
		line-height: 1.35;
		color: #fff;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	/* No hover on touch: show the category so a tile isn't just a picture. */
	@media (hover: none) {
		.tile-cap {
			opacity: 1;
			transform: none;
		}
		.tile-cap .line {
			display: none;
		}
	}

	/* Focus rings — the whole thing is keyboard-drivable, so they have to read. */
	.chip:focus-visible,
	.tool:focus-visible,
	.thumb:focus-visible,
	.tile:focus-visible,
	.arrow:focus-visible,
	.round:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.open:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -4px;
		border-radius: 10px;
	}

	/* ----- Toast ----- */
	.toast {
		position: fixed;
		left: 50%;
		bottom: 1.6rem;
		bottom: calc(1.6rem + env(safe-area-inset-bottom, 0px));
		z-index: 400;
		transform: translate(-50%, 12px);
		padding: 0.7rem 1.1rem;
		border-radius: 999px;
		background: var(--ink);
		color: var(--bg);
		font-family: var(--font-body);
		font-size: 0.9rem;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 0.2s ease,
			transform 0.2s ease;
	}
	.toast.show {
		opacity: 1;
		transform: translate(-50%, 0);
	}

	/* ----- Small screens -----
	   Title and tools share the first row, the chips get the second to scroll
	   along, and the layout is otherwise unchanged: still exactly one screen. */
	@media (max-width: 860px) {
		.topbar {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'titles tools'
				'chips chips';
			gap: 0.55rem;
		}
		.tools {
			border-left: 0;
			padding-left: 0;
		}
		.tool.wide span {
			display: none;
		}
		.tool.wide {
			padding: 0 0.6rem;
		}
		/* Finger-sized: every control in the top bar is a 44px target. */
		.tool {
			min-width: 44px;
			height: 44px;
		}
		.chip {
			min-height: 44px;
		}
		/* The row runs off the right edge on a phone. Fade that edge so the cut
		   chip reads as "more this way" rather than a clipping bug, with enough
		   trailing padding that the last chip scrolls clear of the fade. No
		   leading padding, so the first chip shares the title's and the stage's
		   left edge. */
		.chips {
			padding-left: 0;
			padding-right: 30px;
			-webkit-mask-image: linear-gradient(to right, #000 calc(100% - 30px), transparent);
			mask-image: linear-gradient(to right, #000 calc(100% - 30px), transparent);
		}
	}
	@media (max-width: 720px) {
		/* The 44px controls above cost the top bar 8px; take most of it back from
		   the padding over the title so the stage keeps its height. */
		.inner {
			padding-top: 0.5rem;
		}
		.stage {
			border-radius: 8px;
		}
		.arrow,
		.round {
			width: 44px;
			height: 44px;
		}
		.arrow svg {
			width: 18px;
			height: 18px;
		}
		/* On a short phone the scrim sits on the photo itself, not on the ambient
		   bars — a gold category label over a pale plate needs more behind it. */
		.scrim {
			padding-bottom: 0.85rem;
			background: linear-gradient(to top, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.5) 55%, transparent);
		}
		.cat,
		.cap p {
			text-shadow: 0 1px 3px rgba(0, 0, 0, 0.65);
		}
		.strip {
			/* A landscape photo in a portrait stage letterboxes whatever we do, so
			   spend the spare height on thumbs big enough to hit with a thumb. */
			height: clamp(66px, 12vh, 104px);
			/* First thumb flush with the stage's left edge. On the right, the
			   phone-sized "Ask Geisha" button (52px, 14px in from the screen edge)
			   still lands on this corner: enough trailing padding that the last
			   thumb comes to rest clear of it. */
			padding-left: 0;
			padding-right: 58px;
		}
		/* Top-align the contact sheet: its first row then sits where the stage
		   does, and the slack collects at the bottom — under the assistant
		   button. The `sheet` derived in the script relies on this alignment to
		   work out whether the button would still land on a tile. */
		.sheet-grid {
			align-content: start;
		}
		.spill img.on {
			opacity: 0.32;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.slide,
		.shot,
		.spill img,
		.thumb,
		.thumb::after,
		.tile,
		.tile img,
		.tile-cap,
		.arrow,
		.round,
		.chip,
		.tool,
		.toast {
			transition: none;
			animation: none;
		}
		.shot {
			transform: none;
		}
	}
</style>
