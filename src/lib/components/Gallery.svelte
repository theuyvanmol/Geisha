<script lang="ts">
	// Filterable masonry gallery + lightbox, themed per brand.
	import type { BrandId } from '$lib/data/brand';
	import {
		GALLERY,
		GALLERY_CATEGORIES,
		type GalleryCategory,
		type GalleryImage
	} from '$lib/data/gallery';
	import Lightbox from './Lightbox.svelte';
	import { srcset, fallback } from '$lib/media/responsive';

	// Grid is 3-up on desktop, 2-up on tablet, 1-up on mobile (see .grid below).
	// Without this the browser assumes a full-viewport-wide image and downloads
	// the largest variant for every thumbnail.
	const CELL_SIZES = '(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 31vw';

	// `images` is an optional override (editable content); defaults to the static
	// GALLERY. The home teaser stays on the default for now — pass `images` to
	// make it editable later without further changes here.
	let { brandId, max, images }: { brandId: BrandId; max?: number; images?: GalleryImage[] } =
		$props();

	let filter = $state<GalleryCategory | 'all'>('all');

	const all = $derived(images ?? GALLERY[brandId]);
	const shown = $derived.by(() => {
		let list: GalleryImage[] = filter === 'all' ? all : all.filter((g) => g.category === filter);
		if (max) list = list.slice(0, max);
		return list;
	});

	let lightboxIndex = $state<number | null>(null);
	function open(i: number) {
		lightboxIndex = i;
	}
	function close() {
		lightboxIndex = null;
	}
</script>

<div class="gallery" data-brand={brandId}>
	<div class="filters" role="group" aria-label="Filter gallery">
		{#each GALLERY_CATEGORIES as c}
			<button class="chip" class:on={filter === c.id} onclick={() => (filter = c.id)}>
				{c.label}
			</button>
		{/each}
	</div>

	<div class="grid">
		{#each shown as img, i}
			<button class="cell" onclick={() => open(i)} aria-label="View {img.alt}">
				<!-- A grid cell is a few hundred px wide, so `sizes` is what stops the
				     browser pulling a 1600px file to fill it. AVIF first, WebP fallback. -->
				<picture>
					<source type="image/avif" srcset={srcset(img.src, 'avif')} sizes={CELL_SIZES} />
					<source type="image/webp" srcset={srcset(img.src, 'webp')} sizes={CELL_SIZES} />
					<img src={fallback(img.src) ?? img.src} alt={img.alt} loading="lazy" decoding="async" />
				</picture>
				<span class="cat">{img.category}</span>
			</button>
		{/each}
	</div>
</div>

{#if lightboxIndex !== null}
	<Lightbox images={shown} bind:index={lightboxIndex} onclose={close} />
{/if}

<style>
	.gallery {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 1.2rem;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		margin-bottom: 1.6rem;
	}
	.chip {
		font-family: var(--font-sans);
		font-size: 0.68rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		padding: 0.5rem 1rem;
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
	/* Masonry via CSS columns */
	.grid {
		columns: 4 220px;
		column-gap: 12px;
	}
	.cell {
		display: block;
		width: 100%;
		margin: 0 0 12px;
		padding: 0;
		border: 0;
		background: none;
		cursor: zoom-in;
		position: relative;
		break-inside: avoid;
		overflow: hidden;
		border-radius: 6px;
		line-height: 0;
	}
	/* <picture> must not generate a box, or it lands between .cell and the img
	   and breaks the cell's layout. */
	picture {
		display: contents;
	}

	.cell img {
		width: 100%;
		height: auto;
		display: block;
		transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.3s ease;
	}
	.cell:hover img {
		transform: scale(1.04);
	}
	.cat {
		position: absolute;
		left: 0.6rem;
		bottom: 0.6rem;
		font-family: var(--font-sans);
		font-size: 0.58rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #fff;
		background: rgba(0, 0, 0, 0.55);
		padding: 0.25rem 0.55rem;
		border-radius: 999px;
		line-height: 1;
		opacity: 0;
		transition: opacity 0.25s ease;
	}
	.cell:hover .cat {
		opacity: 1;
	}
	@media (max-width: 520px) {
		.grid {
			columns: 2 140px;
		}
		/* 31px-high chips in 10.9px caps were a fiddly target on a phone. */
		.chip {
			font-size: 0.72rem;
			min-height: 40px;
		}
	}
</style>
