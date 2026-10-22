<script lang="ts">
	// Falling snow on the Fusion home page for the festive season: Fusion's answer
	// to Asia's drifting sakura (SakuraPetals.svelte), built the same way. One
	// canvas, one rAF, no per-frame allocation, paused while the tab is hidden and
	// nothing at all under prefers-reduced-motion.
	//
	// Kept subtle on purpose: mostly soft specks with the odd six-armed crystal,
	// in warm ivory at 12–45% opacity, so it reads as weather over the page rather
	// than confetti. Nearer flakes are bigger, brighter and fall faster, which
	// gives the drift a little depth.
	import { onMount } from 'svelte';

	let canvas: HTMLCanvasElement;

	type Flake = {
		x: number;
		y: number;
		r: number;
		fall: number;
		sway: number;
		swayFreq: number;
		phase: number;
		angle: number;
		spin: number;
		alpha: number;
		/** a six-armed crystal rather than a soft speck */
		crystal: boolean;
	};

	onMount(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		let w = 0;
		let h = 0;
		let dpr = 1;
		let flakes: Flake[] = [];
		let raf = 0;
		let last = 0;
		let t = 0;

		const rand = (a: number, b: number) => a + Math.random() * (b - a);

		const makeFlake = (seeded: boolean): Flake => {
			// depth 0 (far) → 1 (near): size, speed and brightness all follow it
			const d = Math.random() ** 1.6;
			const crystal = Math.random() < 0.22;
			return {
				x: rand(0, w),
				y: seeded ? rand(-h * 0.1, h) : rand(-40, -8),
				r: crystal ? 4 + d * 5 : 1 + d * 2.4,
				fall: 16 + d * 34,
				sway: rand(8, 26),
				swayFreq: rand(0.08, 0.22),
				phase: rand(0, Math.PI * 2),
				angle: rand(0, Math.PI),
				spin: rand(-0.3, 0.3),
				alpha: 0.12 + d * 0.33,
				crystal
			};
		};

		function resize() {
			dpr = Math.min(window.devicePixelRatio || 1, 2);
			w = window.innerWidth;
			h = window.innerHeight;
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
			canvas.style.width = w + 'px';
			canvas.style.height = h + 'px';
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			// ~16 on a phone, up to ~40 on a wide screen
			const want = Math.max(16, Math.min(40, Math.round(w / 48)));
			if (flakes.length > want) flakes.length = want;
			while (flakes.length < want) flakes.push(makeFlake(true));
		}

		function crystal(r: number) {
			ctx!.beginPath();
			for (let k = 0; k < 6; k++) {
				const a = (k * Math.PI) / 3;
				const cx = Math.cos(a);
				const cy = Math.sin(a);
				ctx!.moveTo(0, 0);
				ctx!.lineTo(cx * r, cy * r);
				// a small V on each arm
				const bx = cx * r * 0.55;
				const by = cy * r * 0.55;
				const s = r * 0.28;
				ctx!.moveTo(bx, by);
				ctx!.lineTo(bx + Math.cos(a + 0.7) * s, by + Math.sin(a + 0.7) * s);
				ctx!.moveTo(bx, by);
				ctx!.lineTo(bx + Math.cos(a - 0.7) * s, by + Math.sin(a - 0.7) * s);
			}
			ctx!.stroke();
		}

		function frame(now: number) {
			raf = requestAnimationFrame(frame);
			const dt = Math.min((now - last) / 1000 || 0, 0.05);
			last = now;
			t += dt;

			ctx!.clearRect(0, 0, w, h);
			ctx!.fillStyle = '#fbf6ec';
			ctx!.strokeStyle = '#fbf6ec';
			ctx!.lineCap = 'round';
			for (let i = 0; i < flakes.length; i++) {
				const f = flakes[i];
				f.y += f.fall * dt;
				f.angle += f.spin * dt;
				if (f.y - f.r > h) {
					flakes[i] = makeFlake(false);
					continue;
				}
				const x = f.x + Math.sin(t * f.swayFreq * Math.PI * 2 + f.phase) * f.sway;
				ctx!.globalAlpha = f.alpha;
				if (f.crystal) {
					ctx!.save();
					ctx!.translate(x, f.y);
					ctx!.rotate(f.angle);
					ctx!.lineWidth = Math.max(0.8, f.r / 6);
					crystal(f.r);
					ctx!.restore();
				} else {
					ctx!.beginPath();
					ctx!.arc(x, f.y, f.r, 0, Math.PI * 2);
					ctx!.fill();
				}
			}
			ctx!.globalAlpha = 1;
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

<canvas bind:this={canvas} class="snow" aria-hidden="true"></canvas>

<style>
	/* Same layer as Asia's petals: above page content, below the nav (200), the
	   ribbon (190) and the assistant, so nothing clickable sits behind a flake. */
	.snow {
		position: fixed;
		inset: 0;
		z-index: 60;
		pointer-events: none;
	}
</style>
