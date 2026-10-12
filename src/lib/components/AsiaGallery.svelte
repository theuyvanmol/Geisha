<script lang="ts">
	import { srcset, fallback } from '$lib/media/responsive';

	// Without `sizes` the browser assumes a full-width image and pulls the 1600px
	// variant to fill a thumbnail.
	const CARD_SIZES = '(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 31vw';
	// Parallax photo wall with live search, category filters and a rich split
	// detail overlay (image + info panel). Built for Asia, now shared with Fusion:
	// it themes off the brand tokens inherited from the page's
	// [data-brand="asia|fusion"] wrapper, plus the few hardcoded Asia
	// brown/gold literals below get [data-brand='fusion'] midnight-saffron
	// counterparts (see the "Fusion palette" block at the end of the styles).
	//
	// The parallax is a gentler, page-flow-friendly take on the referenced CodePen:
	// instead of position:fixed + a manually-synced scroll height (fragile, and it
	// fights the nav/footer), each card's image wrapper is over-tall and shifted
	// within its overflow window based on the card's position in the viewport. A
	// single rAF loop updates every visible card. Fully disabled for users who
	// prefer reduced motion.
	import { getBrand, type BrandId } from '$lib/data/brand';
	import {
		GALLERY,
		GALLERY_CATEGORIES,
		type GalleryCategory,
		type GalleryImage
	} from '$lib/data/gallery';

	// `images` comes from the page loader (editable content); falls back to the
	// static GALLERY default so the component still works without a loader.
	let { brandId, images }: { brandId: BrandId; images?: GalleryImage[] } = $props();

	// Fusion reuses this wall too, so the overlay credit follows the brand
	// instead of always reading "Geisha Asia".
	const brandName = $derived(getBrand(brandId).name);

	let filter = $state<GalleryCategory | 'all'>('all');
	let query = $state('');

	const all = $derived(images ?? GALLERY[brandId]);
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return all.filter((g) => {
			const byCat = filter === 'all' || g.category === filter;
			if (!byCat) return false;
			if (!q) return true;
			const hay = `${g.title ?? ''} ${g.alt} ${g.caption ?? ''} ${g.category}`.toLowerCase();
			return hay.includes(q);
		});
	});

	// ----- Detail overlay -----
	let openIndex = $state<number | null>(null);
	let isLandscape = $state(false);
	const current = $derived(openIndex === null ? null : shown[openIndex]);
	// Images edited in the CMS often carry only an alt, so guard against the
	// title/caption pair printing the same sentence twice — and let the panel
	// centre itself when there's nothing but a title.
	const hasCaption = $derived(
		!!current?.caption && current.caption !== (current.title ?? current.alt)
	);

	function open(i: number) {
		openIndex = i;
		isLandscape = false;
		// Measure natural orientation so the overlay can switch layout.
		const probe = new Image();
		probe.onload = () => {
			isLandscape = probe.naturalWidth > probe.naturalHeight;
		};
		probe.src = shown[i].src;
	}
	function close() {
		openIndex = null;
	}
	function prev() {
		if (openIndex === null) return;
		open((openIndex - 1 + shown.length) % shown.length);
	}
	function next() {
		if (openIndex === null) return;
		open((openIndex + 1) % shown.length);
	}
	function onkeydown(e: KeyboardEvent) {
		if (openIndex === null) return;
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'ArrowRight') next();
	}

	// Lock body scroll while the overlay is open.
	$effect(() => {
		if (openIndex === null) return;
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prevOverflow;
		};
	});

	const catLabel = (id: GalleryCategory) =>
		GALLERY_CATEGORIES.find((c) => c.id === id)?.label ?? id;

	// ----- Parallax wall -----
	let trackEl = $state<HTMLElement>();
	let raf = 0;

	$effect(() => {
		if (typeof window === 'undefined') return;
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
		if (reduce.matches) return; // leave images centred, no motion

		// Touch shown so the loop re-binds when the visible set changes.
		void shown.length;

		const tick = () => {
			const cards = trackEl?.querySelectorAll<HTMLElement>('.card');
			if (cards) {
				const vh = window.innerHeight;
				cards.forEach((card) => {
					const wrap = card.querySelector<HTMLElement>('.card-image-wrapper');
					if (!wrap) return;
					const slack = card.offsetHeight - wrap.offsetHeight; // negative (wrapper taller)
					const { top } = card.getBoundingClientRect();
					// progress: 0 when card top at viewport top, 1 at viewport bottom.
					const progress = top / vh;
					wrap.style.transform = `translate3d(0, ${slack * progress}px, 0)`;
				});
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});
</script>

<svelte:window {onkeydown} />

<div class="asia-gallery" data-brand={brandId}>
	<!-- Controls: search pill + category chips -->
	<div class="controls">
		<div class="search">
			<input
				type="text"
				placeholder="Search the gallery"
				bind:value={query}
				aria-label="Search the gallery"
			/>
			<svg class="glass" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="11" cy="11" r="7" />
				<line x1="16.5" y1="16.5" x2="21" y2="21" />
			</svg>
		</div>

		<div class="chips" role="group" aria-label="Filter gallery">
			{#each GALLERY_CATEGORIES as c}
				<button class="chip" class:on={filter === c.id} onclick={() => (filter = c.id)}>
					{c.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Parallax wall -->
	{#if shown.length === 0}
		<p class="empty">No images match “{query}”.</p>
	{:else}
		<div class="track" bind:this={trackEl}>
			{#each shown as img, i (img.src + '::' + i)}
				<button class="card" onclick={() => open(i)} aria-label="View {img.title ?? img.alt}">
					<div class="card-image-wrapper">
						<picture>
							<source type="image/avif" srcset={srcset(img.src, 'avif')} sizes={CARD_SIZES} />
							<source type="image/webp" srcset={srcset(img.src, 'webp')} sizes={CARD_SIZES} />
							<img
								src={fallback(img.src) ?? img.src}
								alt={img.alt}
								loading="lazy"
								decoding="async"
							/>
						</picture>
					</div>
					<span class="card-tag">{catLabel(img.category)}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<!-- Rich detail overlay -->
{#if current}
	<div
		class="overlay"
		data-brand={brandId}
		role="dialog"
		aria-modal="true"
		aria-label="Image detail"
	>
		<button class="ov-backdrop" aria-label="Close" onclick={close}></button>

		<button class="ov-close" aria-label="Close" onclick={close}>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" /></svg
			>
		</button>

		<button class="ov-arrow left" aria-label="Previous" onclick={prev}>‹</button>

		<div class="ov-content" class:landscape={isLandscape}>
			<div class="ov-image">
				<picture>
					<source type="image/avif" srcset={srcset(current.src, 'avif')} sizes="92vw" />
					<source type="image/webp" srcset={srcset(current.src, 'webp')} sizes="92vw" />
					<img src={fallback(current.src) ?? current.src} alt={current.alt} />
				</picture>
			</div>
			<div class="ov-info" class:bare={!hasCaption}>
				<span class="ov-cat">{catLabel(current.category)}</span>
				<h2 class="ov-title">{current.title ?? current.alt}</h2>
				<!-- Both fall back to `alt`, so only show the caption when it adds
				     something (untitled images would otherwise print alt twice). -->
				{#if hasCaption}
					<p class="ov-caption">{current.caption}</p>
				{/if}
				<div class="ov-meta">
					<span>{brandName}</span>
					<span class="ov-sep">·</span>
					<span>{openIndex! + 1} / {shown.length}</span>
				</div>
			</div>
		</div>

		<button class="ov-arrow right" aria-label="Next" onclick={next}>›</button>
	</div>
{/if}

<style>
	picture {
		display: contents;
	}

	.asia-gallery {
		max-width: 1280px;
		margin: 0 auto;
		padding: 0 0.6rem 3rem;
	}

	/* ----- Controls ----- */
	.controls {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.4rem;
		margin: 0 auto 2.4rem;
	}
	.search {
		position: relative;
		width: min(420px, 90vw);
	}
	.search input {
		width: 100%;
		box-sizing: border-box;
		font-family: var(--font-sans);
		font-size: 0.95rem;
		letter-spacing: 0.04em;
		color: var(--ink);
		background: rgba(26, 20, 16, 0.55);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.95rem 3rem 0.95rem 1.5rem;
		text-align: center;
		transition:
			border-color 0.25s ease,
			background 0.25s ease;
	}
	.search input::placeholder {
		color: var(--ink-faint);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		font-size: 0.78rem;
	}
	.search input:focus {
		outline: none;
		border-color: var(--accent);
		background: rgba(26, 20, 16, 0.8);
	}
	.glass {
		position: absolute;
		right: 1.2rem;
		top: 50%;
		transform: translateY(-50%);
		width: 18px;
		height: 18px;
		fill: none;
		stroke: var(--accent);
		stroke-width: 2;
		stroke-linecap: round;
		pointer-events: none;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
	}
	.chip {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		min-height: 40px;
		padding: 0.6rem 1.1rem;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: transparent;
		color: var(--ink-soft);
		cursor: pointer;
		transition: all 0.2s ease;
	}
	.chip:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.chip.on {
		background: var(--accent);
		color: var(--bg);
		border-color: var(--accent);
	}

	.empty {
		text-align: center;
		font-family: var(--font-serif);
		font-style: italic;
		font-size: 1.2rem;
		color: var(--ink-soft);
		padding: 3rem 1rem;
	}

	/* ----- Parallax wall ----- */
	.track {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}
	.card {
		position: relative;
		height: clamp(280px, 32vw, 440px);
		overflow: hidden;
		padding: 0;
		margin: 0;
		border: 0;
		background: var(--bg-2);
		cursor: pointer;
		border-radius: 4px;
		transition:
			transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1),
			box-shadow 0.35s ease;
	}
	.card-image-wrapper {
		/* Taller than the card so there's room to parallax within the overflow. */
		height: 135%;
		will-change: transform;
	}
	.card-image-wrapper img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		filter: saturate(0.82) brightness(0.86);
		transition: filter 0.4s ease;
	}
	.card::after {
		/* Subtle dark gradient so the tag + Asia mood reads on any image. */
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgba(8, 6, 4, 0.55), transparent 45%);
		opacity: 0.9;
		pointer-events: none;
	}
	.card:hover {
		transform: scale(1.05);
		z-index: 2;
		box-shadow:
			rgba(0, 0, 0, 0.45) 0px 40px 55px,
			rgba(0, 0, 0, 0.22) 0px 12px 24px,
			0 0 0 1px rgba(212, 160, 76, 0.4);
	}
	.card:hover .card-image-wrapper img {
		filter: saturate(0.95) brightness(1);
	}
	.card-tag {
		position: absolute;
		left: 0.8rem;
		bottom: 0.7rem;
		z-index: 3;
		font-family: var(--font-sans);
		font-size: 0.58rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--ink);
		background: rgba(8, 6, 4, 0.55);
		border: 1px solid rgba(212, 160, 76, 0.35);
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		line-height: 1;
		opacity: 0;
		transform: translateY(6px);
		transition:
			opacity 0.25s ease,
			transform 0.25s ease;
	}
	.card:hover .card-tag {
		opacity: 1;
		transform: translateY(0);
	}

	@media (max-width: 800px) {
		.track {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 520px) {
		.track {
			grid-template-columns: 1fr;
		}
		.card {
			height: clamp(300px, 64vw, 420px);
		}
	}

	/* ----- Detail overlay ----- */
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4rem 1rem;
		background: rgba(8, 6, 4, 0.92);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}
	.ov-backdrop {
		position: absolute;
		inset: 0;
		border: 0;
		background: transparent;
		cursor: zoom-out;
	}
	.ov-content {
		position: relative;
		z-index: 2;
		display: flex;
		background: #100c08;
		border: 1px solid rgba(212, 160, 76, 0.28);
		box-shadow: 0 40px 90px -20px rgba(0, 0, 0, 0.8);
		max-width: 880px;
		width: 100%;
		max-height: 84vh;
		overflow: hidden;
		align-items: stretch;
	}
	.ov-image {
		flex: none;
		width: 380px;
		max-width: 50%;
		background: #000;
	}
	.ov-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.ov-info {
		padding: 2.4rem 2.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		overflow-y: auto;
	}
	/* Title-only images (no caption): centre the block so the panel doesn't read
	   as a tall empty column beside a portrait photo. */
	.ov-info.bare {
		justify-content: center;
	}
	.ov-info.bare .ov-meta {
		margin-top: 1.8rem;
	}
	.ov-cat {
		font-family: var(--font-sans);
		font-size: 0.62rem;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.ov-title {
		font-family: var(--font-serif);
		font-weight: 500;
		font-size: clamp(1.8rem, 3vw, 2.4rem);
		line-height: 1.1;
		color: #f4ecd8;
		margin: 0;
	}
	.ov-caption {
		font-family: var(--font-serif);
		font-size: 1.1rem;
		font-style: italic;
		font-weight: 300;
		line-height: 1.6;
		color: var(--ink-soft);
		margin: 0;
	}
	.ov-meta {
		margin-top: auto;
		padding-top: 1.4rem;
		font-family: var(--font-sans);
		font-size: 0.62rem;
		letter-spacing: 0.28em;
		text-transform: uppercase;
		color: var(--ink-faint);
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.ov-sep {
		color: var(--accent-2);
	}

	/* Landscape art: stack image on top, like the CodePen's flex-column switch. */
	.ov-content.landscape {
		flex-direction: column;
		max-width: 560px;
	}
	.ov-content.landscape .ov-image {
		width: 100%;
		max-width: 100%;
		max-height: 50vh;
	}

	.ov-close {
		position: fixed;
		top: 1.2rem;
		right: 1.4rem;
		z-index: 4;
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		border: 0;
		border-radius: 999px;
		cursor: pointer;
		transition: background 0.2s ease;
	}
	.ov-close svg {
		width: 20px;
		height: 20px;
		stroke: var(--bg);
		stroke-width: 2.2;
		stroke-linecap: round;
	}
	.ov-close:hover {
		background: #e6b860;
	}
	.ov-arrow {
		position: relative;
		z-index: 3;
		background: none;
		border: 0;
		color: #ece6dc;
		font-size: 3rem;
		line-height: 1;
		cursor: pointer;
		padding: 1rem;
		opacity: 0.65;
		transition: opacity 0.2s ease;
	}
	.ov-arrow:hover {
		opacity: 1;
	}

	@media (max-width: 760px) {
		.overlay {
			padding: 0;
			background: #000;
		}
		.ov-content,
		.ov-content.landscape {
			flex-direction: column;
			max-width: 100%;
			height: 100dvh;
			max-height: none;
			border: 0;
		}
		.ov-image,
		.ov-content.landscape .ov-image {
			width: 100%;
			max-width: 100%;
			height: auto;
			max-height: 48vh;
		}
		.ov-info {
			padding: 1.8rem 1.6rem 2.4rem;
		}
		.ov-arrow {
			position: absolute;
			bottom: 0.6rem;
			font-size: 2.4rem;
			z-index: 5;
		}
		.ov-arrow.left {
			left: 18%;
		}
		.ov-arrow.right {
			right: 18%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.card:hover {
			transition: box-shadow 0.2s ease;
			transform: none;
		}
		.card-image-wrapper {
			height: 100%;
		}
	}

	/* ── Fusion palette ───────────────────────────────────────────────────────
	   Everything above is token-driven except a handful of baked-in Asia values
	   (warm brown-black grounds #0e0c0a/#1a1410 and the gold #d4a04c). Fusion runs
	   a green-black ground (#0a0d0b / #101a15) with the warmer gold #dd8236, so
	   those literals get restated here. Asia is untouched.
	   These used to carry the retired Midnight Saffron blues (#0d1f29 / #f5a623);
	   left alone they put a cold teal cast on the one Fusion surface that ISN'T
	   token-driven, which read as a different site from the rest of the brand. */
	.asia-gallery[data-brand='fusion'] .search input {
		background: rgba(16, 26, 21, 0.55);
	}
	.asia-gallery[data-brand='fusion'] .search input:focus {
		background: rgba(16, 26, 21, 0.85);
	}
	.asia-gallery[data-brand='fusion'] .card::after {
		background: linear-gradient(to top, rgba(10, 13, 11, 0.6), transparent 45%);
	}
	.asia-gallery[data-brand='fusion'] .card:hover {
		box-shadow:
			rgba(0, 0, 0, 0.5) 0px 40px 55px,
			rgba(0, 0, 0, 0.25) 0px 12px 24px,
			0 0 0 1px rgba(221, 130, 54, 0.42);
	}
	.asia-gallery[data-brand='fusion'] .card-tag {
		background: rgba(10, 13, 11, 0.6);
		border-color: rgba(221, 130, 54, 0.35);
	}
	.overlay[data-brand='fusion'] {
		background: rgba(10, 13, 11, 0.93);
	}
	.overlay[data-brand='fusion'] .ov-content {
		background: #101a15;
		border-color: rgba(221, 130, 54, 0.28);
	}
	.overlay[data-brand='fusion'] .ov-title {
		/* Libre Baskerville, matching Fusion's editorial headings. */
		font-family: var(--font-display);
		font-size: clamp(1.5rem, 2.6vw, 2rem);
		color: var(--ink);
	}
	.overlay[data-brand='fusion'] .ov-close:hover {
		background: #f79a4a;
	}
</style>
