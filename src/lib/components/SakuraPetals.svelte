<script lang="ts">
	// Falling sakura petals — the redesign template's idea, rebuilt. Sitewide on
	// BOTH brands: the pinks are shared (Fusion inherits --sakura rather than
	// overriding it), so this needs no per-brand variant.
	//
	// The template drew plain rotating ellipses in gold and dark red. These are
	// actual petal silhouettes (notched outer edge, gradient fill) in the hero's
	// sakura pinks, and they're deliberately thin on the ground: a dozen or so at
	// desktop width, 10–34% opacity, drifting on a sine sway rather than a straight
	// line. The point is something you notice on the second look, not confetti.
	//
	// One canvas, one rAF, no per-frame allocation. It pauses when the tab is
	// hidden and renders nothing at all under prefers-reduced-motion.
	import { onMount } from 'svelte';

	// `quiet` — set by the layout on every page but the home page. It only does
	// anything at phone widths; see the note on `.petals.quiet`.
	let { quiet = false }: { quiet?: boolean } = $props();

	let canvas: HTMLCanvasElement;

	type Petal = {
		x: number;
		y: number;
		r: number;
		fall: number;
		sway: number;
		swayFreq: number;
		phase: number;
		angle: number;
		spin: number;
		/** Flutter phase — scaling x by cos() turns the petal edge-on and back. */
		flutter: number;
		flutterRate: number;
		alpha: number;
		tone: number;
	};

	// Two tones off the hero's --sakura / --sakura-2, plus a pale one so the drift
	// doesn't read as a single flat colour.
	const TONES: [string, string][] = [
		['#ff9db2', '#ef3c5c'],
		['#ffc2ce', '#ff7a94'],
		['#ff7a94', '#c81e3a']
	];

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		let w = 0;
		let h = 0;
		let dpr = 1;
		let petals: Petal[] = [];
		let raf = 0;
		let last = 0;
		// Advances only while visible, so a backgrounded tab doesn't fast-forward
		// the whole flock into a clump on return.
		let t = 0;

		const rand = (a: number, b: number) => a + Math.random() * (b - a);

		const makePetal = (seeded: boolean): Petal => ({
			x: rand(0, w),
			// seeded = first fill (scattered down the page); otherwise re-enter above.
			y: seeded ? rand(-h * 0.2, h) : rand(-120, -20),
			r: rand(7, 16),
			fall: rand(14, 34), // px/sec — slow enough to read as drifting
			sway: rand(14, 46),
			swayFreq: rand(0.12, 0.32),
			phase: rand(0, Math.PI * 2),
			angle: rand(0, Math.PI * 2),
			spin: rand(-0.25, 0.25),
			flutter: rand(0, Math.PI * 2),
			flutterRate: rand(0.5, 1.3),
			alpha: rand(0.1, 0.34),
			tone: Math.floor(Math.random() * TONES.length)
		});

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 2);
			w = window.innerWidth;
			h = window.innerHeight;
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			canvas.style.width = w + 'px';
			canvas.style.height = h + 'px';
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

			// Density scales with width but stays sparse: ~7 on a phone, ~14 wide.
			const want = Math.max(6, Math.min(14, Math.round(w / 120)));
			if (petals.length > want) petals.length = want;
			while (petals.length < want) petals.push(makePetal(true));
		}

		/** A petal pointing "up", centred on the origin, with a notched outer edge. */
		function path(r: number) {
			ctx!.beginPath();
			ctx!.moveTo(0, -r);
			ctx!.bezierCurveTo(r * 0.85, -r * 0.5, r * 0.7, r * 0.6, r * 0.14, r * 0.92);
			ctx!.quadraticCurveTo(0, r * 0.68, -r * 0.14, r * 0.92);
			ctx!.bezierCurveTo(-r * 0.7, r * 0.6, -r * 0.85, -r * 0.5, 0, -r);
			ctx!.closePath();
		}

		function frame(now: number) {
			raf = requestAnimationFrame(frame);
			// Clamp dt so a dropped frame (or a tab regaining focus) can't teleport
			// petals across the viewport.
			const dt = Math.min((now - last) / 1000 || 0, 0.05);
			last = now;
			t += dt;

			ctx!.clearRect(0, 0, w, h);
			for (let i = 0; i < petals.length; i++) {
				const p = petals[i];
				p.y += p.fall * dt;
				p.angle += p.spin * dt;
				p.flutter += p.flutterRate * dt;

				if (p.y - p.r > h) petals[i] = makePetal(false);

				const x = p.x + Math.sin(t * p.swayFreq * Math.PI * 2 + p.phase) * p.sway;
				// Edge-on at cos ≈ 0; a floor of 0.15 keeps a sliver visible so petals
				// never blink out entirely mid-turn.
				const squash = Math.max(Math.abs(Math.cos(p.flutter)), 0.15);

				ctx!.save();
				ctx!.translate(x, p.y);
				ctx!.rotate(p.angle);
				ctx!.scale(squash, 1);
				ctx!.globalAlpha = p.alpha;
				const [from, to] = TONES[p.tone];
				const grad = ctx!.createLinearGradient(0, -p.r, 0, p.r);
				grad.addColorStop(0, from);
				grad.addColorStop(1, to);
				ctx!.fillStyle = grad;
				path(p.r);
				ctx!.fill();
				ctx!.restore();
			}
		}

		function start() {
			if (raf) return;
			last = performance.now();
			raf = requestAnimationFrame(frame);
		}
		function stop() {
			cancelAnimationFrame(raf);
			raf = 0;
		}
		function onVisibility() {
			if (document.hidden) stop();
			else start();
		}

		resize();
		start();
		window.addEventListener('resize', resize);
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			stop();
			window.removeEventListener('resize', resize);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});
</script>

<canvas bind:this={canvas} class="petals" class:quiet aria-hidden="true"></canvas>

<style>
	/* Above page content, below the nav (200), the Uber ribbon (190) and the
	   assistant, so nothing interactive ever sits behind drifting petals. */
	.petals {
		position: fixed;
		inset: 0;
		z-index: 60;
		pointer-events: none;
		transition: opacity 0.6s ease;
	}
	/* On a phone a petal is up to 32px across — taller than a line of body copy and
	   as wide as four or five of its letters — and the interior pages are all text:
	   a petal crossing a review's heading or the gallery caption blotted out part of
	   a word for a second or two. Over the home hero that's the effect; over prose
	   it's a smudge. So off the home page, at phone widths only, the whole canvas
	   drops to under half strength: still drifting, no longer in the way. */
	@media (max-width: 760px) {
		.petals.quiet {
			opacity: 0.45;
		}
	}
</style>
