<script lang="ts">
	// FUSION MOTION — the site-wide "everything moves" layer for Geisha Fusion,
	// in the spirit of thealchemistbars.com. Mounted once in fusion/+layout.svelte.
	//
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
	let { brand = 'fusion' }: { brand?: 'fusion' | 'asia' } = $props();

	let bar: HTMLElement | undefined = $state();

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
		'.door',
		'.stage',
		'.rooms',
		'.fx-marquee',
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
		const root = document.querySelector('.fusion-body, .asia-body');
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
			const root = document.querySelector('.fusion-body, .asia-body');
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
				// Safety net: anything still waiting that is now on screen is shown,
				// whatever the observer did (pinned/sticky stages can starve it).
				const vh = window.innerHeight;
				document.querySelectorAll<HTMLElement>('[data-fx]:not([data-fx-in])').forEach((el) => {
					const r = el.getBoundingClientRect();
					if (r.top < vh * 0.94 && r.bottom > 0) el.dataset.fxIn = '';
				});
				const max = document.documentElement.scrollHeight - window.innerHeight;
				bar?.style.setProperty('--sp', String(max > 0 ? Math.min(1, window.scrollY / max) : 0));
			});
		};
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		cleanups.push(() => window.removeEventListener('scroll', onScroll));

		// ---- magnetic buttons (mouse only) ----
		const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
		if (fine && !reduce) {
			let magnet: HTMLElement | null = null;
			const onMove = (e: PointerEvent) => {
				if (e.pointerType !== 'mouse') return;
				const t = e.target as Element | null;
				const m = (t?.closest('.btn, .btn-solid, [data-magnetic]') as HTMLElement | null) ?? null;
				if (magnet && magnet !== m) {
					magnet.style.translate = '';
					magnet = null;
				}
				if (m) {
					const r = m.getBoundingClientRect();
					const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
					const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
					m.style.translate = `${(dx * 7).toFixed(1)}px ${(dy * 5).toFixed(1)}px`;
					magnet = m;
				}
			};
			window.addEventListener('pointermove', onMove, { passive: true });
			cleanups.push(() => {
				window.removeEventListener('pointermove', onMove);
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

<div class="fx-progress" data-brand={brand} bind:this={bar} aria-hidden="true"></div>



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

	/* ---- scroll reveals (states set by the script only) ---- */
	:global(:is(.fusion-body, .asia-body) [data-fx='line']) {
		clip-path: inset(-0.3em -1em 100% -1em);
		transform: translate3d(0, 0.6em, 0);
		transition:
			clip-path 1.1s cubic-bezier(0.16, 1, 0.3, 1),
			transform 1.1s cubic-bezier(0.16, 1, 0.3, 1);
	}
	:global(:is(.fusion-body, .asia-body) [data-fx='line'][data-fx-in]) {
		clip-path: inset(-0.3em -1em -0.4em -1em);
		transform: none;
	}
	:global(:is(.fusion-body, .asia-body) [data-fx='unveil']) {
		clip-path: inset(22% 0 0 0);
		scale: 1.14;
		opacity: 0.4;
		transition:
			clip-path 1.3s cubic-bezier(0.65, 0, 0.35, 1),
			scale 1.8s cubic-bezier(0.16, 1, 0.3, 1),
			opacity 1s ease;
	}
	:global(:is(.fusion-body, .asia-body) [data-fx='unveil'][data-fx-in]) {
		clip-path: inset(0 0 0 0);
		scale: 1;
		opacity: 1;
	}
	.fx-progress[data-brand='asia'] {
		background: linear-gradient(90deg, #ef3c5c, #d4af37 60%, #ff7a94);
	}
	@media (prefers-reduced-motion: reduce) {
		.fx-progress {
			display: none;
		}
	}

</style>
