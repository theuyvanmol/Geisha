<script lang="ts">
	// FUSION MOTION — the site-wide "everything moves" layer for Geisha Fusion,
	// in the spirit of thealchemistbars.com. Mounted once in fusion/+layout.svelte.
	//
	//   · A cursor follower (desktop mouse only): a small ember dot plus a lagging
	//     ring that swells over anything clickable and reads "Drag" over the menu
	//     carousel. The native cursor stays — this only adds to it.
	//   · Magnetic buttons: `.btn`-style buttons lean a few pixels toward the cursor.
	//   · Scroll reveals for anything that doesn't animate itself already: headings
	//     rise out of a line mask, photographs unveil from the bottom out of a
	//     push-in. Components with their own reveal ([data-reveal], .reveal, the
	//     hero, carousels…) are left alone, and so is anything already mid-transition,
	//     so nothing gets animated twice.
	//   · A hairline scroll-progress bar along the top of the screen.
	//
	// Hidden states are only ever applied by this script, so with no JS (or under
	// reduced motion) everything simply shows.
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';

	let dot: HTMLElement | undefined = $state();
	let ring: HTMLElement | undefined = $state();
	let bar: HTMLElement | undefined = $state();
	let label = $state('');
	let hot = $state(false);
	let showCursor = $state(false);
	let down = $state(false);

	const SKIP = [
		'[data-reveal]',
		'.reveal',
		'[class*="reveal"]',
		'[data-no-fx]',
		'.hero',
		'header',
		'nav',
		'footer',
		'.film',
		'.menus',
		'.home-cards',
		'.fusion-cards',
		'[class*="carousel"]',
		'[class*="slider"]',
		'[class*="marquee"]',
		'[role="dialog"]',
		'.iris'
	].join(',');

	let io: IntersectionObserver | undefined;
	let reduce = false;

	function busy(el: Element) {
		const cs = getComputedStyle(el);
		// Already animated by someone else, or not visible yet for their own reasons.
		return (
			parseFloat(cs.transitionDuration) > 0 ||
			cs.animationName !== 'none' ||
			parseFloat(cs.opacity) < 1
		);
	}

	function scan() {
		if (reduce || !io) return;
		const root = document.querySelector('.fusion-body');
		if (!root) return;
		const vh = window.innerHeight;
		const tag = (el: HTMLElement, kind: string) => {
			if (el.dataset.fx || el.closest(SKIP) || busy(el)) return;
			// Something already on screen at load stays put — no flash on arrival.
			const r = el.getBoundingClientRect();
			if (r.top < vh * 0.9 && r.bottom > 0) return;
			el.dataset.fx = kind;
			io!.observe(el);
		};
		root.querySelectorAll<HTMLElement>('h1, h2').forEach((el) => tag(el, 'line'));
		root.querySelectorAll<HTMLImageElement>('img').forEach((el) => {
			const r = el.getBoundingClientRect();
			if (r.width >= 220 && r.height >= 160) tag(el, 'unveil');
		});
	}

	afterNavigate(() => {
		requestAnimationFrame(() => requestAnimationFrame(scan));
	});

	onMount(() => {
		reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const cleanups: (() => void)[] = [];

		// ---- scroll reveals ----
		if (!reduce) {
			io = new IntersectionObserver(
				(entries) => {
					for (const e of entries) {
						if (e.isIntersecting) {
							(e.target as HTMLElement).dataset.fxIn = '';
							io?.unobserve(e.target);
						}
					}
				},
				{ threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
			);
			cleanups.push(() => io?.disconnect());
			// late-arriving content (lazy sections, client-side data) gets picked up too
			let t = 0;
			const mo = new MutationObserver(() => {
				clearTimeout(t);
				t = window.setTimeout(scan, 250);
			});
			const root = document.querySelector('.fusion-body');
			if (root) mo.observe(root, { childList: true, subtree: true });
			cleanups.push(() => {
				mo.disconnect();
				clearTimeout(t);
			});
		}

		// ---- progress bar ----
		let praf = 0;
		const onScroll = () => {
			if (praf) return;
			praf = requestAnimationFrame(() => {
				praf = 0;
				const max = document.documentElement.scrollHeight - window.innerHeight;
				bar?.style.setProperty('--sp', String(max > 0 ? Math.min(1, window.scrollY / max) : 0));
			});
		};
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		cleanups.push(() => window.removeEventListener('scroll', onScroll));

		// ---- cursor + magnetic buttons (mouse only) ----
		const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
		if (fine && !reduce) {
			let x = -100,
				y = -100,
				rx = -100,
				ry = -100,
				craf = 0;
			let magnet: HTMLElement | null = null;
			const loop = () => {
				rx += (x - rx) * 0.16;
				ry += (y - ry) * 0.16;
				if (dot) dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
				if (ring) ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
				craf = requestAnimationFrame(loop);
			};
			const onMove = (e: PointerEvent) => {
				if (e.pointerType !== 'mouse') return;
				x = e.clientX;
				y = e.clientY;
				showCursor = true;
				const t = e.target as Element | null;
				const drag = t?.closest('.menus .viewport, .menus [class*="track"], [data-cursor="drag"]');
				const link = t?.closest('a, button, [role="button"], input, select, textarea, label, summary');
				label = drag ? 'Drag' : '';
				hot = !!link || !!drag;
				// magnetic pull
				const m = (t?.closest('.btn, .btn-solid, [data-magnetic]') as HTMLElement | null) ?? null;
				if (magnet && magnet !== m) {
					magnet.style.translate = '';
					magnet = null;
				}
				if (m) {
					const r = m.getBoundingClientRect();
					const dx = (x - (r.left + r.width / 2)) / r.width;
					const dy = (y - (r.top + r.height / 2)) / r.height;
					m.style.translate = `${(dx * 7).toFixed(1)}px ${(dy * 5).toFixed(1)}px`;
					magnet = m;
				}
			};
			const onLeave = () => (showCursor = false);
			const onDown = () => (down = true);
			const onUp = () => (down = false);
			window.addEventListener('pointermove', onMove, { passive: true });
			document.documentElement.addEventListener('mouseleave', onLeave);
			window.addEventListener('pointerdown', onDown, { passive: true });
			window.addEventListener('pointerup', onUp, { passive: true });
			craf = requestAnimationFrame(loop);
			cleanups.push(() => {
				cancelAnimationFrame(craf);
				window.removeEventListener('pointermove', onMove);
				document.documentElement.removeEventListener('mouseleave', onLeave);
				window.removeEventListener('pointerdown', onDown);
				window.removeEventListener('pointerup', onUp);
				if (magnet) magnet.style.translate = '';
			});
		}

		scan();
		return () => {
			cancelAnimationFrame(praf);
			cleanups.forEach((f) => f());
		};
	});
</script>

<div class="fx-progress" bind:this={bar} aria-hidden="true"></div>

<div class="fx-cursor" class:on={showCursor} class:hot class:down class:labelled={!!label} aria-hidden="true">
	<div class="fx-ring" bind:this={ring}><span>{label}</span></div>
	<div class="fx-dot" bind:this={dot}></div>
</div>

<style>
	/* ---- progress hairline ---- */
	.fx-progress {
		position: fixed;
		left: 0;
		top: 0;
		z-index: 9999;
		height: 2px;
		width: 100%;
		pointer-events: none;
		background: linear-gradient(90deg, #d92e22, #dd8236 60%, #f79a4a);
		transform-origin: left;
		transform: scaleX(var(--sp, 0));
		opacity: 0.9;
	}

	/* ---- cursor ---- */
	.fx-cursor {
		position: fixed;
		inset: 0;
		z-index: 9998;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.3s ease;
	}
	.fx-cursor.on {
		opacity: 1;
	}
	.fx-dot,
	.fx-ring {
		position: fixed;
		left: 0;
		top: 0;
		will-change: transform;
	}
	.fx-dot::before {
		content: '';
		position: absolute;
		width: 6px;
		height: 6px;
		margin: -3px 0 0 -3px;
		border-radius: 50%;
		background: #f79a4a;
		transition: transform 0.25s ease;
	}
	.fx-ring > span {
		position: absolute;
		width: 38px;
		height: 38px;
		margin: -19px 0 0 -19px;
		border-radius: 50%;
		border: 1px solid rgba(242, 236, 224, 0.55);
		display: grid;
		place-items: center;
		font-family: 'Jost', system-ui, sans-serif;
		font-size: 0;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: #0a0d0b;
		transition:
			transform 0.45s cubic-bezier(0.16, 1, 0.3, 1),
			background 0.35s ease,
			border-color 0.35s ease,
			font-size 0.2s ease;
		mix-blend-mode: difference;
	}
	.hot .fx-ring > span {
		transform: scale(1.7);
		border-color: rgba(221, 130, 54, 0.9);
		background: rgba(221, 130, 54, 0.12);
		mix-blend-mode: normal;
	}
	.hot .fx-dot::before {
		transform: scale(0.4);
	}
	.labelled .fx-ring > span {
		transform: scale(2.2);
		background: #f2ece0;
		border-color: #f2ece0;
		font-size: 5px;
		mix-blend-mode: normal;
	}
	.labelled .fx-dot::before {
		transform: scale(0);
	}
	.down .fx-ring > span {
		transform: scale(0.8);
	}

	/* ---- scroll reveals (states set by the script only) ---- */
	:global(.fusion-body [data-fx='line']) {
		clip-path: inset(-0.3em -1em 100% -1em);
		transform: translate3d(0, 0.6em, 0);
		transition:
			clip-path 1.1s cubic-bezier(0.16, 1, 0.3, 1),
			transform 1.1s cubic-bezier(0.16, 1, 0.3, 1);
	}
	:global(.fusion-body [data-fx='line'][data-fx-in]) {
		clip-path: inset(-0.3em -1em -0.4em -1em);
		transform: none;
	}
	:global(.fusion-body [data-fx='unveil']) {
		clip-path: inset(22% 0 0 0);
		scale: 1.14;
		opacity: 0.4;
		transition:
			clip-path 1.3s cubic-bezier(0.65, 0, 0.35, 1),
			scale 1.8s cubic-bezier(0.16, 1, 0.3, 1),
			opacity 1s ease;
	}
	:global(.fusion-body [data-fx='unveil'][data-fx-in]) {
		clip-path: inset(0 0 0 0);
		scale: 1;
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.fx-cursor,
		.fx-progress {
			display: none;
		}
	}
	@media (hover: none), (pointer: coarse) {
		.fx-cursor {
			display: none;
		}
	}
</style>
