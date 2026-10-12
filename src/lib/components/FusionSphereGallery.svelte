<script lang="ts">
	import { srcset, fallback } from '$lib/media/responsive';
	// Immersive image-sphere gallery for Geisha Fusion, adapted from a CodePen the
	// owner liked. A canvas renders a rotating sphere of photo tiles; DRAG spins
	// it, hover highlights a tile, click assembles the full image in the centre.
	// Recoloured to the Fusion warm palette, with category filters layered on top.
	//
	// Deliberately diverged from the original pen to fix its problems:
	//  - Rotation is DRAG-based, not wheel-based — so the page still scrolls
	//    normally past the section (no scroll hijack / stuck feeling).
	//  - Dropped the random full-canvas glitch pass — that per-frame getImageData
	//    of the whole canvas was the jitter. Rotation is damped (lerp) for smooth.
	//  - Filters rebuild the sphere in place; no separate grid underneath.
	//  - Client-only (canvas/rAF); falls back to a static grid under
	//    prefers-reduced-motion or on small screens.
	import { onMount } from 'svelte';
	import type { GalleryImage, GalleryCategory } from '$lib/data/gallery';
	import { GALLERY_CATEGORIES } from '$lib/data/gallery';

	let { images }: { images: GalleryImage[] } = $props();

	let host = $state<HTMLElement>();
	let canvas = $state<HTMLCanvasElement>();
	let lineEl = $state<HTMLElement>();

	let useFallback = $state(false);
	let loaded = $state(false); // loader finished → fade overlay out
	let percent = $state(0);
	let filter = $state<GalleryCategory | 'all'>('all');
	// Drag affordance: a big centred "drag" cue shown until the user first spins
	// the sphere. Set from inside the sketch the moment a real drag begins.
	let hasInteracted = $state(false);
	let markInteracted = () => {
		hasInteracted = true;
	};

	// Only show category chips that actually have photos.
	const presentCategories = GALLERY_CATEGORIES.filter(
		(c) => c.id === 'all' || images.some((i) => i.category === c.id)
	);

	const shown = $derived(filter === 'all' ? images : images.filter((i) => i.category === filter));

	const fallbackImages = $derived(shown);

	// Warm Fusion palette (this surface is intentionally dark so photos pop).
	const COL = {
		bg: '#0a0d0b',
		accent: '#dd8236' // gold — focus rect
	};

	// Exposed so the filter UI can ask the running sketch to rebuild its tiles.
	let rebuild: (imgs: HTMLImageElement[]) => void = () => {};
	let imgCache = new Map<string, HTMLImageElement>();

	function imagesFor(list: GalleryImage[]): HTMLImageElement[] {
		return list.map((g) => {
			let im = imgCache.get(g.src);
			if (!im) {
				im = new Image();
				// Resolve to the DIRECT optimized CDN URL via the manifest. The raw
				// `/Content folder/…` path is only a manifest key in production (binaries
				// don't ship) and 308-redirects same-origin→R2. We deliberately DON'T set
				// `crossOrigin`: this canvas only draws (never reads pixels back — the
				// getImageData glitch pass was removed), so a tainted canvas is harmless,
				// whereas `crossOrigin='anonymous'` fails the load when the CDN sends no
				// CORS header — which left the Fusion sphere blank in production.
				im.src = fallback(g.src) ?? g.src;
				imgCache.set(g.src, im);
			}
			return im;
		});
	}

	function setFilter(id: GalleryCategory | 'all') {
		filter = id;
		if (!useFallback) rebuild(imagesFor(shown));
	}

	onMount(() => {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const small = window.matchMedia('(max-width: 640px)').matches;
		if (reduce || small) {
			useFallback = true;
			return;
		}

		const hostEl = host;
		const canvasEl = canvas;
		if (!hostEl || !canvasEl) return;

		// ---- preload + loader counter -------------------------------------------
		let raf = 0;
		let destroyed = false;
		let loadedCount = 0;
		let target = 0;
		let counter = 0;

		const allImgs = imagesFor(images);
		const bump = () => {
			loadedCount++;
			target = Math.floor((loadedCount / allImgs.length) * 100);
		};
		allImgs.forEach((im) => {
			if (im.complete) bump();
			else {
				im.addEventListener('load', bump, { once: true });
				im.addEventListener('error', bump, { once: true });
			}
		});

		const drawLoader = () => {
			if (destroyed) return;
			if (counter < target) counter++;
			percent = counter;
			if (lineEl) lineEl.style.width = counter + '%';
			if (counter >= 100) {
				setTimeout(() => {
					if (!destroyed) {
						loaded = true;
						startSketch();
					}
				}, 300);
				return;
			}
			raf = requestAnimationFrame(drawLoader);
		};
		raf = requestAnimationFrame(drawLoader);

		// ---- the sphere sketch ---------------------------------------------------
		let sketchRaf = 0;
		let cleanupSketch = () => {};

		const startSketch = () => {
			const canvas = canvasEl;
			const host = hostEl;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			const c = ctx as CanvasRenderingContext2D;

			let width = 0;
			let height = 0;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);

			type Tile = {
				xRadian: number;
				yRadian: number;
				img: HTMLImageElement;
				x: number;
				y: number;
				ratio: number;
				displayed: boolean;
			};
			let tiles: Tile[] = [];
			let pool: HTMLImageElement[] = imagesFor(images);
			let radius = 0;
			let size = 0;
			const NUM = 16;

			// Damped rotation: we lerp `delta` toward `targetDelta`, and `targetDelta`
			// gets a little auto-spin plus whatever the drag adds. Smooth, no jitter.
			const delta = { x: 0, y: 0 };
			const targetDelta = { x: 0, y: 0 };
			const mouse = { x: 0, y: 0 };
			const focus = { x: 0, y: 0, s: 0 };

			let dragging = false;
			let lastX = 0;
			let lastY = 0;
			let moved = false;

			// Idle hint: an incredibly subtle sway so the sphere reads as interactive
			// without drifting. It oscillates around the rest position (never
			// accumulates), and its strength eases to 0 while the user is dragging.
			let idleAmp = 1; // 0…1, eased down on interaction, back up when idle

			// click-to-reveal state — a clean centred lightbox that scales + fades the
			// full image up from the tile that was clicked, then fades it back down.
			let revealImg: HTMLImageElement | null = null;
			let revealStart = 0;
			let revealOrigin = { x: 0, y: 0 }; // where the click landed (sphere-local)
			let isDisplayed = false;
			let isDeleting = false;

			const setupSizes = () => {
				const r = host.getBoundingClientRect();
				width = r.width;
				height = r.height;
				canvas.width = width * dpr;
				canvas.height = height * dpr;
				canvas.style.width = width + 'px';
				canvas.style.height = height + 'px';
				c.setTransform(dpr, 0, 0, dpr, 0, 0);
			};

			const setupTiles = () => {
				const edge = Math.max(width, height);
				radius = edge / 2;
				size = radius / (NUM / 6);
				tiles = [];
				let idx = 0;
				for (let x = 0; x < NUM; x++) {
					for (let y = 0; y < NUM; y++) {
						tiles.push({
							xRadian: ((Math.PI * 2) / NUM) * x,
							yRadian: ((Math.PI * 2) / NUM) * y,
							img: pool[idx++ % pool.length],
							x: 0,
							y: 0,
							ratio: 0,
							displayed: true
						});
					}
				}
				focus.s = size;
			};

			// Let the filter UI swap the image pool and re-seed the tiles.
			rebuild = (imgs: HTMLImageElement[]) => {
				pool = imgs.length ? imgs : pool;
				setupTiles();
			};

			const ease3 = (t: number) => t * t * t;

			const updateTile = (s: Tile) => {
				s.x = Math.sin(s.xRadian + delta.x) * radius;
				s.y = Math.cos(s.yRadian + delta.y) * radius;
				let tmp = Math.sqrt(s.x * s.x + s.y * s.y) / radius;
				tmp = ease3(tmp);
				s.ratio = 1 - Math.min(tmp, 1);
			};

			const drawTile = (s: Tile) => {
				updateTile(s);
				if (Math.sin(s.yRadian + delta.y) > 0 || Math.cos(s.xRadian + delta.x) > 0) {
					s.displayed = false;
					return;
				}
				s.displayed = true;
				if (!s.img.complete || s.img.naturalWidth === 0) return;
				c.save();
				c.translate(s.x, s.y);
				c.scale(s.ratio, s.ratio);
				c.translate(-s.x, -s.y);
				c.globalAlpha = s.ratio;
				const iw = s.img.naturalWidth;
				const ih = s.img.naturalHeight;
				const side = Math.min(iw, ih);
				c.drawImage(
					s.img,
					iw / 2 - side / 2,
					ih / 2 - side / 2,
					side,
					side,
					s.x - size / 2,
					s.y - size / 2,
					size,
					size
				);
				c.restore();
			};

			const isHovered = (s: Tile, x: number, y: number) =>
				s.displayed &&
				x > s.x - (size / 2) * s.ratio &&
				x < s.x + (size / 2) * s.ratio &&
				y > s.y - (size / 2) * s.ratio &&
				y < s.y + (size / 2) * s.ratio;

			const drawFocus = (s: Tile | undefined, hover: boolean) => {
				const tx = hover && s ? s.x : mouse.x;
				const ty = hover && s ? s.y : mouse.y;
				const ts = hover && s ? size * s.ratio : 0;
				focus.s += (ts - focus.s) * 0.16;
				focus.x += (tx - focus.x) * 0.16;
				focus.y += (ty - focus.y) * 0.16;
				c.save();
				c.strokeStyle = COL.accent;
				c.lineWidth = hover && s ? 3 * s.ratio : 1;
				c.strokeRect(focus.x - focus.s / 2, focus.y - focus.s / 2, focus.s, focus.s);
				c.restore();
			};

			const buildReveal = (img: HTMLImageElement, ox: number, oy: number) => {
				revealImg = img;
				revealOrigin = { x: ox, y: oy };
				revealStart = performance.now();
			};

			// easeOutCubic — fast then settle, the calm editorial feel.
			const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

			// Fit the full image inside ~80% of the section, preserving aspect.
			const fitReveal = (img: HTMLImageElement) => {
				const maxW = width * 0.8;
				const maxH = height * 0.8;
				const r = img.naturalWidth / img.naturalHeight;
				let w = maxW;
				let h = w / r;
				if (h > maxH) {
					h = maxH;
					w = h * r;
				}
				return { w, h };
			};

			const drawReveal = (deleting: boolean) => {
				if (!revealImg || !revealImg.complete || revealImg.naturalWidth === 0) return;
				const { w, h } = fitReveal(revealImg);
				const DUR = 420; // ms
				let t = Math.min((performance.now() - revealStart) / DUR, 1);
				t = easeOut(t);
				// On open: grow from the clicked tile to centre. On close: shrink back.
				const p = deleting ? 1 - t : t;
				// translate origin (sphere-local) → canvas centre is (0,0)
				const cx = revealOrigin.x * (1 - p);
				const cy = revealOrigin.y * (1 - p);
				const scale = 0.12 + 0.88 * p; // start small at the tile, settle full size
				const dw = w * scale;
				const dh = h * scale;
				c.save();
				c.globalAlpha = p;
				// soft frame in the Fusion accent
				c.strokeStyle = COL.accent;
				c.lineWidth = 2;
				c.strokeRect(cx - dw / 2 - 6, cy - dh / 2 - 6, dw + 12, dh + 12);
				c.drawImage(revealImg, cx - dw / 2, cy - dh / 2, dw, dh);
				c.restore();
			};

			// ---- events: DRAG to spin (no wheel hijack) -----------------------------
			const localXY = (clientX: number, clientY: number) => {
				const r = canvas.getBoundingClientRect();
				return { x: clientX - r.left - width / 2, y: clientY - r.top - height / 2 };
			};
			const onMove = (e: MouseEvent) => {
				const p = localXY(e.clientX, e.clientY);
				mouse.x = p.x;
				mouse.y = p.y;
				if (dragging) {
					if (Math.abs(e.clientX - lastX) > 2 || Math.abs(e.clientY - lastY) > 2) {
						moved = true;
						markInteracted(); // first real spin → dismiss the drag cue
					}
					targetDelta.x += (e.clientX - lastX) * 0.005;
					targetDelta.y -= (e.clientY - lastY) * 0.005;
					lastX = e.clientX;
					lastY = e.clientY;
				}
			};
			const onDown = (e: MouseEvent) => {
				dragging = true;
				moved = false;
				lastX = e.clientX;
				lastY = e.clientY;
			};
			const onUp = (e: MouseEvent) => {
				if (dragging && !moved) handleClick(e.clientX, e.clientY);
				dragging = false;
			};

			let touchId: number | null = null;
			const onTouchStart = (e: TouchEvent) => {
				const t = e.changedTouches[0];
				touchId = t.identifier;
				dragging = true;
				moved = false;
				lastX = t.clientX;
				lastY = t.clientY;
			};
			const onTouchMove = (e: TouchEvent) => {
				const t = [...e.changedTouches].find((x) => x.identifier === touchId);
				if (!t) return;
				const p = localXY(t.clientX, t.clientY);
				mouse.x = p.x;
				mouse.y = p.y;
				// Touch: spin HORIZONTALLY only. Vertical finger movement is left to the
				// browser so the page scrolls normally (touch-action: pan-y) instead of
				// fighting a vertical spin. Desktop drag keeps full 2-axis control.
				targetDelta.x += (t.clientX - lastX) * 0.005;
				if (Math.abs(t.clientX - lastX) > 3 || Math.abs(t.clientY - lastY) > 3) {
					moved = true;
					markInteracted(); // first real spin → dismiss the drag cue
				}
				lastX = t.clientX;
				lastY = t.clientY;
			};
			const onTouchEnd = (e: TouchEvent) => {
				const t = [...e.changedTouches].find((x) => x.identifier === touchId);
				if (t && !moved) handleClick(t.clientX, t.clientY);
				dragging = false;
				touchId = null;
			};

			const handleClick = (clientX: number, clientY: number) => {
				if (isDisplayed) {
					// play the close (shrink + fade back to the tile), then clear.
					isDeleting = true;
					revealStart = performance.now();
					setTimeout(() => {
						isDeleting = false;
						isDisplayed = false;
						revealImg = null;
					}, 420);
					return;
				}
				const p = localXY(clientX, clientY);
				for (const s of tiles) {
					if (isHovered(s, p.x, p.y)) {
						isDisplayed = true;
						buildReveal(s.img, s.x, s.y);
						return;
					}
				}
			};

			const onResize = () => {
				setupSizes();
				setupTiles();
			};

			canvas.addEventListener('mousemove', onMove);
			canvas.addEventListener('mousedown', onDown);
			window.addEventListener('mouseup', onUp);
			canvas.addEventListener('touchstart', onTouchStart, { passive: true });
			canvas.addEventListener('touchmove', onTouchMove, { passive: true });
			canvas.addEventListener('touchend', onTouchEnd, { passive: true });
			window.addEventListener('resize', onResize);

			setupSizes();
			setupTiles();

			const render = () => {
				// damping toward the drag target — the sphere only moves when the user
				// drags it (no auto-spin).
				delta.x += (targetDelta.x - delta.x) * 0.08;
				delta.y += (targetDelta.y - delta.y) * 0.08;

				// Subtle idle sway, layered on top of the drag position. A slow Lissajous
				// oscillation around rest (so it never drifts), faded out while the user
				// interacts and while a photo is open. Amplitudes are tiny on purpose.
				const interacting = dragging || isDisplayed;
				idleAmp += ((interacting ? 0 : 1) - idleAmp) * 0.05;
				const tms = performance.now() * 0.001;
				const swayX = Math.sin(tms * 0.45) * 0.035 * idleAmp;
				const swayY = Math.cos(tms * 0.32) * 0.022 * idleAmp;
				delta.x += swayX;
				delta.y += swayY;

				c.clearRect(0, 0, width, height);
				c.fillStyle = COL.bg;
				c.fillRect(0, 0, width, height);
				c.save();
				c.translate(width / 2, height / 2);

				let hovered: Tile | undefined;
				let isHover = false;
				canvas.style.cursor = dragging ? 'grabbing' : 'grab';
				for (const s of tiles) {
					drawTile(s);
					if (!dragging && isHovered(s, mouse.x, mouse.y)) {
						isHover = true;
						hovered = s;
						canvas.style.cursor = 'zoom-in';
					}
				}
				drawFocus(hovered, isHover);

				if (isDisplayed) {
					// dim backdrop fades in/out with the reveal so the photo reads clearly.
					const prog = easeOut(Math.min((performance.now() - revealStart) / 420, 1));
					const dim = isDeleting ? 1 - prog : prog;
					c.globalAlpha = 0.82 * dim;
					c.fillStyle = COL.bg;
					c.fillRect(-width / 2, -height / 2, width, height);
					c.globalAlpha = 1;
					drawReveal(isDeleting);
				}

				c.restore();

				// remove the sway so it doesn't accumulate into the drag state — `delta`
				// must end the frame back at its lerped (drag-only) value.
				delta.x -= swayX;
				delta.y -= swayY;

				sketchRaf = requestAnimationFrame(render);
			};
			render();

			cleanupSketch = () => {
				cancelAnimationFrame(sketchRaf);
				canvas.removeEventListener('mousemove', onMove);
				canvas.removeEventListener('mousedown', onDown);
				window.removeEventListener('mouseup', onUp);
				canvas.removeEventListener('touchstart', onTouchStart);
				canvas.removeEventListener('touchmove', onTouchMove);
				canvas.removeEventListener('touchend', onTouchEnd);
				window.removeEventListener('resize', onResize);
				rebuild = () => {};
			};
		};

		return () => {
			destroyed = true;
			cancelAnimationFrame(raf);
			cleanupSketch();
		};
	});
</script>

{#if useFallback}
	<!-- Reduced-motion / small-screen: a calm static grid of the same photos. -->
	<div class="sphere-block" data-brand="fusion">
		<div class="chips" role="group" aria-label="Filter gallery">
			{#each presentCategories as cat}
				<button class="chip" class:on={filter === cat.id} onclick={() => (filter = cat.id)}>
					{cat.label}
				</button>
			{/each}
		</div>
		<div class="sphere-fallback">
			{#each fallbackImages as img}
				<figure>
					<picture>
						<source type="image/avif" srcset={srcset(img.src, 'avif')} sizes="(max-width: 800px) 92vw, 40vw" />
						<source type="image/webp" srcset={srcset(img.src, 'webp')} sizes="(max-width: 800px) 92vw, 40vw" />
						<img src={fallback(img.src) ?? img.src} alt={img.alt} loading="lazy" decoding="async" />
					</picture>
				</figure>
			{/each}
		</div>
	</div>
{:else}
	<div class="sphere-block" data-brand="fusion">
		<div class="chips" role="group" aria-label="Filter gallery">
			{#each presentCategories as cat}
				<button class="chip" class:on={filter === cat.id} onclick={() => setFilter(cat.id)}>
					{cat.label}
				</button>
			{/each}
		</div>

		<div class="sphere" bind:this={host}>
			<canvas bind:this={canvas} aria-label="Interactive Geisha Fusion image gallery"></canvas>

			<!-- Big, obvious drag affordance. Stays until the first real spin (or, as a
			     fallback, fades after a while). A hand glyph swings left↔right to mime
			     the gesture; pointer-events:none so it never blocks the drag itself. -->
			<div class="cue" class:show={loaded && !hasInteracted} aria-hidden="true">
				<div class="cue-hand">
					<svg viewBox="0 0 64 64" width="56" height="56" fill="none" aria-hidden="true">
						<path
							d="M26 30V16a4 4 0 0 1 8 0v12m0 0v-4a4 4 0 0 1 8 0v6m0 0v-2a4 4 0 0 1 8 0v12c0 9-6 16-16 16h-3c-5 0-8-2-11-6l-7-10a4 4 0 0 1 6-5l3 3V22a4 4 0 0 1 8 0v8"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span class="cue-arrows" aria-hidden="true">
						<svg viewBox="0 0 24 24" width="22" height="22"
							><path d="M14 6 8 12l6 6" stroke="currentColor" stroke-width="2.5"
								stroke-linecap="round" stroke-linejoin="round" fill="none" /></svg
						>
						<svg viewBox="0 0 24 24" width="22" height="22"
							><path d="m10 6 6 6-6 6" stroke="currentColor" stroke-width="2.5"
								stroke-linecap="round" stroke-linejoin="round" fill="none" /></svg
						>
					</span>
				</div>
				<p class="cue-title">Click &amp; drag to explore</p>
				<p class="cue-sub">Tap any photo to open it</p>
			</div>

			{#if !loaded}
				<div class="loader" aria-hidden="true">
					<div class="loader-inner">
						<p class="counter">{percent}%</p>
						<span class="line" bind:this={lineEl}></span>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	picture {
		display: contents;
	}

	.sphere-block {
		width: 100%;
	}

	/* Filter chips — sit above the sphere, on the page (light) background. */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		padding: 0 var(--frame-inset, 1rem) 1.6rem;
	}
	.chip {
		font-family: var(--font-sans);
		font-size: 0.72rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		min-height: 40px;
		padding: 0.65rem 1.15rem;
		border-radius: 0;
		border: 1px solid var(--frame-line, var(--line));
		background: transparent;
		color: var(--ink-soft);
		cursor: pointer;
		transition:
			color 0.35s var(--ease-editorial),
			border-color 0.35s var(--ease-editorial),
			background 0.35s var(--ease-editorial);
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

	.sphere {
		position: relative;
		width: 100%;
		height: clamp(440px, 78vh, 820px);
		background: #1a1410;
		overflow: hidden;
	}
	.sphere canvas {
		display: block;
		width: 100%;
		height: 100%;
		/* allow vertical page scroll to pass through; we spin via drag, not wheel */
		touch-action: pan-y;
	}

	/* ===== Drag affordance cue =====
	   Big, centred, unmistakable. Hidden by default; `.show` fades + floats it in.
	   It removes itself from the layout-feel via pointer-events:none so a drag that
	   starts on top of it still reaches the canvas. */
	.cue {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		text-align: center;
		color: #f4ecd8;
		pointer-events: none;
		opacity: 0;
		transform: translateY(8px);
		transition:
			opacity 0.7s var(--ease-editorial),
			transform 0.7s var(--ease-editorial);
		z-index: 3;
	}
	.cue.show {
		opacity: 1;
		transform: translateY(0);
	}
	/* the hand mimes the drag: swing left↔right, with arrows flanking it */
	.cue-hand {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #e0a96d;
		margin-bottom: 0.9rem;
		filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.5));
		animation: cue-swing 2.6s var(--ease-editorial) infinite;
	}
	.cue-arrows {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 132px;
		left: 50%;
		transform: translateX(-50%);
		color: rgba(224, 169, 109, 0.85);
		pointer-events: none;
	}
	.cue-arrows svg:first-child {
		animation: cue-arrow-l 2.6s var(--ease-editorial) infinite;
	}
	.cue-arrows svg:last-child {
		animation: cue-arrow-r 2.6s var(--ease-editorial) infinite;
	}
	.cue-title {
		font-family: var(--font-display, serif);
		font-size: clamp(1.1rem, 2.4vw, 1.6rem);
		letter-spacing: 0.02em;
		color: #f4ecd8;
		margin: 0;
	}
	.cue-sub {
		font-family: var(--font-sans);
		font-size: 0.66rem;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		color: rgba(244, 236, 216, 0.62);
		margin: 0.4rem 0 0;
	}
	@keyframes cue-swing {
		0%,
		100% {
			transform: translateX(-16px) rotate(-7deg);
		}
		50% {
			transform: translateX(16px) rotate(7deg);
		}
	}
	/* arrows pulse outward in sympathy with the swing */
	@keyframes cue-arrow-l {
		0%,
		100% {
			opacity: 1;
			transform: translateX(0);
		}
		50% {
			opacity: 0.3;
			transform: translateX(-4px);
		}
	}
	@keyframes cue-arrow-r {
		0%,
		100% {
			opacity: 0.3;
			transform: translateX(4px);
		}
		50% {
			opacity: 1;
			transform: translateX(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cue-hand,
		.cue-arrows svg {
			animation: none;
		}
	}

	/* Loader overlay (confined to the section) */
	.loader {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #1a1410;
		color: #e0a96d;
		z-index: 2;
	}
	.loader-inner {
		position: relative;
		width: 42%;
		max-width: 360px;
		overflow: hidden;
		text-align: center;
	}
	.counter {
		font-family: var(--font-display, serif);
		font-size: clamp(1.4rem, 4vw, 2.2rem);
		padding: 0.6rem 0;
		margin: 0;
		color: #f4ecd8;
	}
	.line {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 0;
		height: 2px;
		background: #e0a96d;
	}

	.sphere-fallback {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.4rem;
		padding: 0 var(--frame-inset, 0.4rem);
	}
	.sphere-fallback figure {
		margin: 0;
		aspect-ratio: 1;
		overflow: hidden;
		background: var(--bg-2);
	}
	.sphere-fallback img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	@media (max-width: 640px) {
		.sphere-fallback {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
