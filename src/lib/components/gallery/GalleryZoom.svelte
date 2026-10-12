<script lang="ts">
	// Full-screen viewer for the gallery stage.
	//
	// The stage already shows each photo large, so this exists for two jobs: seeing
	// a shot edge to edge, and getting CLOSE to it — a plated dish is worth
	// zooming into. Wheel, pinch, double-click/double-tap and the +/−/0 keys zoom;
	// dragging pans once zoomed; a swipe at 1× moves to the next photo. ←/→ and
	// Escape are handled by the parent's window listener so there is one source
	// of truth for navigation.
	import { srcset, fallback } from '$lib/media/responsive';
	import type { GalleryImage } from '$lib/data/gallery';

	let {
		image,
		index,
		total,
		category,
		caption,
		onprev,
		onnext,
		onclose,
		onshare
	}: {
		image: GalleryImage;
		index: number;
		total: number;
		category: string;
		caption?: string;
		onprev: () => void;
		onnext: () => void;
		onclose: () => void;
		onshare: () => void;
	} = $props();

	const MAX = 4;

	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let dragging = $state(false);
	let imgEl = $state<HTMLImageElement>();
	let closeEl = $state<HTMLButtonElement>();

	// Fit the photo to the screen at 1× ourselves. Left to max-width/max-height
	// a small CMS upload (some are 550px wide) sat at its natural size — a
	// postage stamp in the middle of a black screen.
	let natW = $state(0);
	let natH = $state(0);
	let vw = $state(0);
	let vh = $state(0);
	const fitScale = $derived(natW && natH && vw && vh ? Math.min(vw / natW, vh / natH) : 0);
	function measureView() {
		vw = window.innerWidth;
		vh = window.innerHeight;
	}
	function onload(e: Event) {
		const el = e.currentTarget as HTMLImageElement;
		natW = el.naturalWidth;
		natH = el.naturalHeight;
	}
	$effect(measureView);

	// A new photo always opens un-zoomed and centred.
	$effect(() => {
		void image.src;
		reset();
	});

	// Move focus into the dialog on open so Escape/Tab behave; the parent hands it
	// back to the button that opened us.
	$effect(() => {
		closeEl?.focus({ preventScroll: true });
	});

	function reset() {
		scale = 1;
		tx = 0;
		ty = 0;
	}

	/** Keep the picture covering the screen: no dragging it off into black. */
	function clamp() {
		const el = imgEl;
		if (!el) return;
		const maxX = Math.max(0, (el.offsetWidth * scale - window.innerWidth) / 2);
		const maxY = Math.max(0, (el.offsetHeight * scale - window.innerHeight) / 2);
		tx = Math.max(-maxX, Math.min(maxX, tx));
		ty = Math.max(-maxY, Math.min(maxY, ty));
	}

	/**
	 * Zoom to `next`, keeping the image point under (px, py) fixed on screen.
	 * The image sits centred at (cx, cy) untransformed; a screen point P maps to
	 * image-local q = (P − C − t) / s, so holding q still gives
	 * t′ = P − C − (P − C − t) · s′/s.
	 */
	function zoomAt(next: number, px = window.innerWidth / 2, py = window.innerHeight / 2) {
		const s2 = Math.min(MAX, Math.max(1, next));
		const cx = window.innerWidth / 2;
		const cy = window.innerHeight / 2;
		tx = px - cx - ((px - cx - tx) * s2) / scale;
		ty = py - cy - ((py - cy - ty) * s2) / scale;
		scale = s2;
		if (s2 === 1) {
			tx = 0;
			ty = 0;
		}
		clamp();
	}

	// Attached by hand: Svelte adds `onwheel` as a passive listener, and a
	// passive listener can't stop ctrl+wheel from zooming the whole browser.
	let canvasEl = $state<HTMLElement>();
	$effect(() => {
		const el = canvasEl;
		if (!el) return;
		const onwheel = (e: WheelEvent) => {
			e.preventDefault();
			zoomAt(scale * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
		};
		el.addEventListener('wheel', onwheel, { passive: false });
		return () => el.removeEventListener('wheel', onwheel);
	});

	function ondblclick(e: MouseEvent) {
		// Touch gets its own double-tap in onpointerup; a synthesised dblclick
		// on top of it would zoom in and straight back out.
		if (lastPointerType !== 'mouse') return;
		if (scale > 1) zoomAt(1);
		else zoomAt(2.5, e.clientX, e.clientY);
	}

	// ----- Pointers: pan, pinch, swipe -----
	const pts = new Map<number, { x: number; y: number }>();
	let startX = 0;
	let startY = 0;
	let pinchDist = 0;
	let pinchScale = 1;
	let lastTap = 0;
	let lastPointerType = 'mouse';

	function dist() {
		const [a, b] = [...pts.values()];
		return Math.hypot(a.x - b.x, a.y - b.y);
	}
	function mid() {
		const [a, b] = [...pts.values()];
		return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
	}

	function onpointerdown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		lastPointerType = e.pointerType;
		pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pts.size === 1) {
			startX = e.clientX;
			startY = e.clientY;
			dragging = true;
		} else if (pts.size === 2) {
			pinchDist = dist();
			pinchScale = scale;
		}
	}

	function onpointermove(e: PointerEvent) {
		const prev = pts.get(e.pointerId);
		if (!prev) return;
		const cur = { x: e.clientX, y: e.clientY };
		pts.set(e.pointerId, cur);
		if (pts.size === 2 && pinchDist) {
			const m = mid();
			zoomAt((pinchScale * dist()) / pinchDist, m.x, m.y);
		} else if (pts.size === 1 && scale > 1) {
			tx += cur.x - prev.x;
			ty += cur.y - prev.y;
			clamp();
		}
	}

	function onpointerup(e: PointerEvent) {
		const had = pts.size;
		pts.delete(e.pointerId);
		if (pts.size < 2) pinchDist = 0;
		if (pts.size) return;
		dragging = false;
		if (had !== 1) return;

		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		const moved = Math.hypot(dx, dy);

		// Double-tap on touch (dblclick doesn't fire reliably there).
		if (e.pointerType !== 'mouse' && moved < 10) {
			const now = e.timeStamp;
			if (now - lastTap < 300) {
				lastTap = 0;
				if (scale > 1) zoomAt(1);
				else zoomAt(2.5, e.clientX, e.clientY);
				return;
			}
			lastTap = now;
		}

		// At 1× a horizontal swipe changes photo; a downward flick closes.
		if (scale === 1) {
			if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
				if (dx > 0) onprev();
				else onnext();
			} else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) {
				onclose();
			}
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === '+' || e.key === '=') zoomAt(scale * 1.5);
		else if (e.key === '-' || e.key === '_') zoomAt(scale / 1.5);
		else if (e.key === '0') zoomAt(1);
		else return;
		e.preventDefault();
	}
</script>

<svelte:window
	{onkeydown}
	onresize={() => {
		measureView();
		clamp();
	}}
/>

<div class="zoomer" role="dialog" aria-modal="true" aria-label="Photo {index + 1} of {total}">
	<div
		class="canvas"
		class:zoomed={scale > 1}
		class:dragging
		role="presentation"
		bind:this={canvasEl}
		{ondblclick}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={onpointerup}
	>
		<picture>
			<source type="image/avif" srcset={srcset(image.src, 'avif')} sizes="100vw" />
			<source type="image/webp" srcset={srcset(image.src, 'webp')} sizes="100vw" />
			<img
				bind:this={imgEl}
				src={fallback(image.src) ?? image.src}
				alt={image.alt}
				draggable="false"
				{onload}
				style:width={fitScale ? `${Math.round(natW * fitScale)}px` : undefined}
				style:height={fitScale ? `${Math.round(natH * fitScale)}px` : undefined}
				style:transform="translate({tx}px, {ty}px) scale({scale})"
			/>
		</picture>
	</div>

	<div class="bar top">
		<span class="count"><b>{index + 1}</b> of {total}</span>
		<div class="tools">
			<button class="icon" onclick={() => zoomAt(scale > 1 ? 1 : 2.5)} aria-label={scale > 1 ? 'Zoom out' : 'Zoom in'} title={scale > 1 ? 'Zoom out (0)' : 'Zoom in (+)'}>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="20" y2="20" />
					<line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
					{#if scale === 1}<line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />{/if}
				</svg>
			</button>
			<button class="icon" onclick={onshare} aria-label="Share this photo" title="Share this photo">
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 15V4" /><polyline points="7.5 8.5 12 4 16.5 8.5" /><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
				</svg>
			</button>
			<button class="icon close" bind:this={closeEl} onclick={onclose} aria-label="Close full screen" title="Close (Esc)">
				<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
			</button>
		</div>
	</div>

	{#if total > 1}
		<button class="arrow left" onclick={onprev} aria-label="Previous photo">
			<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 5 8 12 15 19" /></svg>
		</button>
		<button class="arrow right" onclick={onnext} aria-label="Next photo">
			<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 5 16 12 9 19" /></svg>
		</button>
	{/if}

	<div class="bar bottom" class:hide={scale > 1}>
		<span class="cat">{category}</span>
		{#if caption}<p>{caption}</p>{/if}
	</div>
</div>

<style>
	picture {
		display: contents;
	}
	.zoomer {
		position: fixed;
		inset: 0;
		z-index: 300;
		background: #000;
		overscroll-behavior: contain;
		animation: z-in 0.24s ease-out;
	}
	@keyframes z-in {
		from {
			opacity: 0;
		}
	}
	.canvas {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		touch-action: none;
		cursor: zoom-in;
		user-select: none;
		-webkit-user-select: none;
	}
	.canvas.zoomed {
		cursor: grab;
	}
	.canvas.zoomed.dragging {
		cursor: grabbing;
	}
	.canvas img {
		max-width: 100vw;
		max-height: 100vh;
		max-height: 100dvh;
		object-fit: contain;
		display: block;
		transform-origin: center center;
		transition: transform 0.22s ease-out;
		will-change: transform;
		-webkit-user-drag: none;
	}
	/* Follow the finger exactly while it's down; ease only the jumps. */
	.canvas.dragging img {
		transition: none;
	}

	.bar {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: clamp(0.7rem, 2vw, 1.2rem) clamp(0.9rem, 2.4vw, 1.6rem);
		pointer-events: none;
	}
	.bar > * {
		pointer-events: auto;
	}
	.top {
		top: 0;
		background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent);
	}
	.bottom {
		bottom: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
		padding-top: 3rem;
		/* Keep the caption off the very bottom of a phone screen, and clear of the
		   home indicator where the browser reports one. */
		padding-bottom: max(clamp(1rem, 2vw, 1.2rem), env(safe-area-inset-bottom, 0px));
		background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
		transition: opacity 0.25s ease;
	}
	.bottom.hide {
		opacity: 0;
	}
	.count {
		font-family: var(--font-body);
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.62);
		font-variant-numeric: tabular-nums;
	}
	.count b {
		font-family: var(--font-display);
		font-weight: 500;
		font-size: 1.15rem;
		color: #fff;
	}
	.cat {
		font-family: var(--font-body);
		font-size: 0.82rem;
		letter-spacing: 0.04em;
		color: var(--accent);
	}
	.bottom p {
		font-family: var(--font-display);
		font-size: clamp(1rem, 2vw, 1.3rem);
		line-height: 1.45;
		color: #fff;
		margin: 0;
		max-width: 52ch;
	}
	.tools {
		display: flex;
		gap: 0.5rem;
	}
	.icon,
	.arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: rgba(0, 0, 0, 0.45);
		cursor: pointer;
		transition:
			background 0.2s ease,
			border-color 0.2s ease;
	}
	.icon {
		width: 44px;
		height: 44px;
	}
	.icon svg,
	.arrow svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: #fff;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.icon:hover,
	.arrow:hover,
	.close {
		background: var(--accent);
		border-color: var(--accent);
	}
	.icon:hover svg,
	.arrow:hover svg,
	.close svg {
		stroke: var(--bg);
	}
	.arrow {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: 2;
		width: 52px;
		height: 52px;
	}
	.arrow.left {
		left: clamp(0.6rem, 2vw, 1.4rem);
	}
	.arrow.right {
		right: clamp(0.6rem, 2vw, 1.4rem);
	}
	.icon:focus-visible,
	.arrow:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	/* Phones swipe; the arrows only cover the photo there. */
	@media (hover: none) and (max-width: 720px) {
		.arrow {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.zoomer {
			animation: none;
		}
		.canvas img,
		.bottom {
			transition: none;
		}
	}
</style>
