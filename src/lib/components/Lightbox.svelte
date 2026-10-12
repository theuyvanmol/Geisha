<script lang="ts">
	import { imgAttrs, fallback, srcset } from '$lib/media/responsive';
	// Accessible image lightbox. Keyboard: Esc closes, ←/→ navigate. Locks body
	// scroll while open and restores focus to the trigger on close.
	import type { GalleryImage } from '$lib/data/gallery';

	type Props = {
		images: GalleryImage[];
		index: number;
		onclose: () => void;
	};
	let { images, index = $bindable(), onclose }: Props = $props();

	const current = $derived(images[index]);

	function prev() {
		index = (index - 1 + images.length) % images.length;
	}
	function next() {
		index = (index + 1) % images.length;
	}
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'ArrowRight') next();
	}

	$effect(() => {
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = prevOverflow;
		};
	});
</script>

<svelte:window {onkeydown} />

<div
	class="overlay"
	role="dialog"
	aria-modal="true"
	aria-label="Image viewer"
	tabindex="-1"
>
	<button class="close" aria-label="Close" onclick={onclose}>×</button>
	<button class="arrow left" aria-label="Previous image" onclick={prev}>‹</button>

	<figure class="frame">
		<picture>
			<source type="image/avif" srcset={srcset(current.src, 'avif')} sizes="92vw" />
			<source type="image/webp" srcset={srcset(current.src, 'webp')} sizes="92vw" />
			<img src={fallback(current.src) ?? current.src} alt={current.alt} />
		</picture>
		<figcaption>{current.alt} · {index + 1} / {images.length}</figcaption>
	</figure>

	<button class="arrow right" aria-label="Next image" onclick={next}>›</button>

	<!-- Click backdrop to close -->
	<button class="backdrop" aria-label="Close" onclick={onclose}></button>
</div>

<style>
	picture {
		display: contents;
	}

	.overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: rgba(8, 6, 5, 0.94);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4rem 1rem;
	}
	.backdrop {
		position: absolute;
		inset: 0;
		z-index: 0;
		background: transparent;
		border: 0;
		cursor: zoom-out;
	}
	.frame {
		position: relative;
		z-index: 2;
		margin: 0;
		max-width: min(1100px, 92vw);
		max-height: 84vh;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		align-items: center;
		pointer-events: none;
	}
	.frame img {
		max-width: 100%;
		max-height: 76vh;
		object-fit: contain;
		border-radius: 4px;
		box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
	}
	figcaption {
		font-family: var(--font-sans, sans-serif);
		font-size: 0.74rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: rgba(236, 230, 220, 0.7);
	}
	.close {
		position: absolute;
		top: 1.2rem;
		right: 1.6rem;
		z-index: 3;
		background: none;
		border: 0;
		color: #ece6dc;
		font-size: 2.4rem;
		line-height: 1;
		cursor: pointer;
		opacity: 0.8;
	}
	.close:hover {
		opacity: 1;
	}
	.arrow {
		position: relative;
		z-index: 3;
		background: none;
		border: 0;
		color: #ece6dc;
		font-size: 3rem;
		line-height: 1;
		cursor: pointer;
		padding: 1rem;
		opacity: 0.7;
		transition: opacity 0.2s ease;
	}
	.arrow:hover {
		opacity: 1;
	}
	@media (max-width: 640px) {
		/* The arrows sit along the bottom edge here, so the photo is centred in
		   what is left ABOVE them rather than in the whole screen: 3.75rem at the
		   top for the close button, 6rem at the bottom for the arrow row. Centred
		   in the full height, a portrait photo on a short screen (390x664 — an
		   iPhone with Safari's bars showing) put its caption on top of the arrows.
		   `svh`, not `vh`: `vh` is the tall viewport on iOS, bars or no bars. Where
		   `svh` isn't understood the two max-heights drop out and the 84vh/76vh
		   above hold. */
		.overlay {
			padding: 3.75rem 1rem calc(6rem + env(safe-area-inset-bottom, 0px));
		}
		.frame {
			max-height: calc(100svh - 9.75rem - env(safe-area-inset-bottom, 0px));
		}
		/* Less the caption line and the gap above it. */
		.frame img {
			max-height: calc(100svh - 11.75rem - env(safe-area-inset-bottom, 0px));
		}
		/* <picture> is display:contents, so its two <source>s become flex items of
		   .frame — invisible, but each one still collects a 0.8rem gap, which
		   pushed the photo 26px down and the caption out of the bottom of the
		   frame. (True at every width; fixed here only so desktop doesn't move.) */
		.frame source {
			display: none;
		}
		figcaption {
			font-size: 0.75rem;
			text-align: center;
		}
		.close {
			top: 0.5rem;
			right: 0.6rem;
			width: 44px;
			height: 44px;
			padding: 0;
		}
		.arrow {
			position: absolute;
			bottom: 0.75rem;
			bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
			font-size: 2.4rem;
		}
		.arrow.left {
			left: 22%;
		}
		.arrow.right {
			right: 22%;
		}
	}
</style>
