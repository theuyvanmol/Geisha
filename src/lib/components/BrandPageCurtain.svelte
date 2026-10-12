<script lang="ts">
	// Full-screen page transition for EITHER brand: a dip to dark.
	//
	// beforeNavigate cancels the click, the cover fades up over the page we're
	// leaving, the swap happens while the screen is fully covered, and the cover
	// only lifts once the new page has really rendered. Mounted once in each
	// brand's +layout.svelte so it survives intra-brand navigation.
	//
	// Fusion used to run its own 400-line terracotta curtain (it drew the retired
	// <FrameGrid> ledger rules across the cover). Both brands now share this one;
	// all that differs is the ground it dips to and which route prefix it guards.
	//
	// THREE THINGS THIS HAD WRONG, all visible on one menus → gallery click:
	//   · The fade-out started when goto() was ISSUED, not when it resolved. The
	//     cover was at ~16% by the time the page actually swapped, so you watched
	//     the OLD page fade back in and then get replaced. The dip hid nothing.
	//     Fixed by awaiting the navigation (goto resolves once the new page is
	//     rendered) and giving it a frame to paint before uncovering.
	//   · noScroll kept the previous scroll offset, so you landed halfway down the
	//     new page. SvelteKit's own reset now runs — under the cover, where it
	//     can't be seen — and Lenis is re-synced to match.
	//   · Back/forward was cancelled and re-issued as a goto(), i.e. a fresh push
	//     instead of a history move, so Back never got you back. Those can't be
	//     gated at all, so they now dip OUT of the dark instead of into it.
	import { afterNavigate, beforeNavigate, goto, preloadData } from '$app/navigation';
	import { getLenis } from '$lib/lenis';
	import { clearCovered, markCovered } from '$lib/nav/entering';
	import type { BrandId } from '$lib/data/brand';

	let { brand }: { brand: BrandId } = $props();
	/** The route prefix this curtain guards — it must not dip when you leave. */
	const root = $derived(`/${brand}`);

	// Upper bounds on the CSS durations — only used to arm the backstop timers, since
	// a transitionend never fires in a backgrounded tab and the click must not be
	// swallowed if that happens. These are the LONGEST any brand runs (Fusion's), not
	// each brand's own figure: a backstop that fires early would swap the page
	// mid-fade, whereas one that fires late costs nothing, because transitionend is
	// the primary trigger and has already done the work by then.
	const IN_MS = 260;
	const OUT_MS = 460;

	// 'mount' → cover present at opacity 0, not yet transitioning (off-state paint).
	// 'in' → fading up over the old page. 'out' → fading off the new one.
	let phase = $state<'idle' | 'mount' | 'in' | 'out'>('idle');
	let active = $state(false); // in the DOM only while animating

	let pending: URL | null = null; // target held until the cover is opaque
	let resuming = false; // true while we re-issue the gated nav (let it through)
	let swapping = false; // one swap per navigation, whichever trigger wins
	let timer: ReturnType<typeof setTimeout>;

	// Respect reduced-motion: skip the dip entirely.
	let reduce = false;
	$effect(() => {
		if (typeof window !== 'undefined') {
			reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		}
	});

	function teardown() {
		clearTimeout(timer);
		active = false;
		phase = 'idle';
		pending = null;
		swapping = false;
	}

	beforeNavigate((nav) => {
		if (reduce) return;
		// The re-issued (gated) navigation is allowed straight through.
		if (resuming) {
			resuming = false;
			return;
		}
		// Back/forward is handled on the way out — see afterNavigate.
		if (nav.type === 'popstate') return;
		// Only genuine in-app navigations (not external links / full reloads).
		if (!nav.to || nav.to.url.origin !== location.origin) return;
		// Stay within this brand — don't dip when leaving it.
		if (!nav.to.url.pathname.startsWith(root)) return;
		// Don't dip a same-page navigation (e.g. hash links).
		if (nav.to.url.pathname === location.pathname && nav.to.url.search === location.search) return;

		nav.cancel();
		pending = nav.to.url;
		swapping = false;
		active = true;
		phase = 'mount';

		// Start the load NOW so it runs alongside the fade instead of behind it —
		// cancelling the nav also cancelled its load, and without this the new
		// page's latency would be added to the time spent in the dark.
		void preloadData(nav.to.url.href).catch(() => {});

		// Let the off-state paint once before flipping to .show, or the browser
		// coalesces the two and skips the fade-in. Same pattern as the layout's
		// arrival shoji.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				if (phase === 'mount') phase = 'in';
			})
		);

		clearTimeout(timer);
		timer = setTimeout(swap, IN_MS + 260);
	});

	// The screen is covered — swap the page, then lift.
	async function swap() {
		if (swapping) return;
		swapping = true;
		clearTimeout(timer);

		const url = pending;
		pending = null;
		if (!url) {
			teardown();
			return;
		}

		resuming = true;
		// Tell the destination it is arriving under a cover, so a page with its own
		// entry curtain (the home hero) doesn't play a second one as this one lifts.
		markCovered();
		try {
			// Resolves once the new page has loaded AND rendered.
			await goto(url);
		} catch {
			resuming = false;
		}
		// The new page has mounted, so every reader has already seen the flag.
		clearCovered();

		// SvelteKit has reset the scroll under the cover, but Lenis holds its own
		// position and would snap back to it on the next wheel event.
		getLenis()?.scrollTo(0, { immediate: true });

		// One frame for the new page to paint, so the lift never uncovers a
		// half-painted screen.
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

		// ...and then wait for the main thread to go QUIET before lifting.
		//
		// This is what made the transition look choppy. A new page's mount burst —
		// component init, image decode, IntersectionObserver setup, fonts settling —
		// lands in the tens of milliseconds right after its first paint, which was
		// exactly when the lift used to start. Measured on a fusion → fusion/menus
		// click, an 83ms block hit at cover opacity 0.72: a visible stutter through
		// the middle of the fade.
		//
		// The same block costs NOTHING a moment earlier, because the screen is still
		// covered. So the cover holds until the burst is done. Capped by the idle
		// timeout so a genuinely busy page can never hold it up indefinitely — the
		// worst case is the old behaviour plus a beat.
		await new Promise((r) => {
			if (typeof requestIdleCallback === 'function') {
				requestIdleCallback(() => r(null), { timeout: 260 });
			} else {
				setTimeout(() => r(null), 80);
			}
		});

		phase = 'out';
		clearTimeout(timer);
		timer = setTimeout(teardown, OUT_MS + 260);
	}

	// Back/forward can't be gated — cancelling a popstate and re-issuing it as a
	// goto() pushes a new entry, which is what broke the Back button. So we let it
	// through untouched and soften the arrival: mount the cover already opaque over
	// the new page and lift it. Same dip, second half only.
	afterNavigate((nav) => {
		if (reduce || nav.type !== 'popstate') return;
		if (!location.pathname.startsWith(root)) return;

		swapping = false;
		pending = null;
		active = true;
		phase = 'in';
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				if (phase === 'in') phase = 'out';
			})
		);
		clearTimeout(timer);
		timer = setTimeout(teardown, OUT_MS + 260);
	});

	function onTransitionEnd(e: TransitionEvent) {
		// transitionend BUBBLES. Fusion's cover carries an animated ring cluster whose
		// own opacity transition would otherwise land here and drive the state machine
		// — swapping the page early, or tearing the cover down before it had finished
		// lifting. Only the cover's own transition is allowed to advance a phase.
		if (e.target !== e.currentTarget) return;
		if (e.propertyName !== 'opacity') return;
		// `pending` distinguishes a gated forward navigation (swap now) from the
		// popstate dip, which has nothing left to do but lift.
		if (phase === 'in' && pending) void swap();
		else if (phase === 'out') teardown();
	}
</script>

{#if active}
	<div
		class="cover"
		class:show={phase === 'in'}
		data-brand={brand}
		data-phase={phase}
		aria-hidden="true"
		ontransitionend={onTransitionEnd}
	>
		<!-- Fusion's own gesture, on top of the shared dip. Asia keeps the plain fade:
		     its transitions are shoji panels, and giving both brands the same flourish
		     is exactly what made them read as one site with a recoloured stylesheet.

		     The cluster expands THROUGH the swap — it comes up small with the cover,
		     holds while the new page loads underneath, then opens past the frame as
		     the cover lifts. Rings are the motif the whole Fusion page is built on
		     (hero, story, menu), and the story cluster now grows on scroll, so the
		     transition is speaking the page's own language rather than a new one.

		     This is NOT the circular aperture that was cut from the front door. That
		     one was a second circle landing on top of the landing page's iris bloom,
		     which read as the transition replaying. This curtain never runs on that
		     path — it is mounted inside /fusion, so the landing's own transition owns
		     the arrival and this only ever plays between interior pages.

		     Purely decorative: it can't gate coverage, because the cover's own opacity
		     fade is still the only thing the state machine reads. -->
		{#if brand === 'fusion'}
			<svg class="rings" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet">
				<circle cx="300" cy="300" r="290" fill="none" stroke="#dd8236" stroke-width="1" />
				<circle cx="300" cy="300" r="215" fill="none" stroke="#5a9184" stroke-width="1" />
				<circle cx="300" cy="300" r="140" fill="none" stroke="#f79a4a" stroke-width="1" />
			</svg>
		{/if}
	</div>
{/if}

<style>
	/* Solid cover on the brand's own ground, so the dip has no visible seam against
	   the page it covers — the exact hex matters, because any difference between
	   this and the page ground shows as a flash at the moment the cover lands. The
	   faint gold bloom keeps it off being a flat black slab. */
	.cover {
		position: fixed;
		inset: 0;
		z-index: 200; /* above sticky nav (60) */
		pointer-events: none;
		background:
			radial-gradient(ellipse at 50% 45%, rgba(212, 175, 55, 0.07) 0%, transparent 62%), #08080b;
		opacity: 0;
		/* Lifting off is the unhurried half; see .show for the way in. */
		transition: opacity 320ms cubic-bezier(0.22, 0.9, 0.3, 1);
		/* Promote the cover to its own compositor layer for the whole time it exists.
		   An opacity transition Chrome has promoted keeps running on the compositor
		   thread, so it survives the main-thread work the new page is doing
		   underneath it — which is the difference between a fade that stutters and
		   one that doesn't. Left as a plain `will-change` rather than a translateZ
		   hack because the element is only in the DOM while it animates, so there is
		   no idle layer to pay for. */
		will-change: opacity;
	}
	/* Fusion's ground and its warmer gold. */
	.cover[data-brand='fusion'] {
		background:
			radial-gradient(ellipse at 50% 45%, rgba(221, 130, 54, 0.07) 0%, transparent 62%), #0a0d0b;
		/* A touch longer than Asia's, purely so the ring gesture is legible — at
		   320ms out it registered as a flicker rather than as an opening. */
		transition-duration: 460ms;
	}
	.cover.show {
		opacity: 1;
		/* Going dark is quicker than coming back, so the transition reads as
		   decisive on the way in and as a reveal on the way out. */
		transition-duration: 200ms;
		/* Swallow a second click while the screen is going dark — it would queue up
		   a navigation nobody can see they're triggering. */
		pointer-events: auto;
	}
	.cover[data-brand='fusion'].show {
		transition-duration: 260ms;
	}

	/* ===== FUSION: THE RING GESTURE =====
	   Three states, driven off data-phase rather than off `.show` alone, because
	   `.show` can't tell "not up yet" from "lifting" — both are simply its absence,
	   and the cluster has to start SMALL and end LARGE, never the reverse. */
	/* Laid out at the size it ENDS on, then only ever scaled DOWN from there.
	   Sized at its held size instead (and scaled up to 1.9 on the way out) the
	   layer is rasterised small and Chrome has to re-raster it as it grows to keep
	   the hairlines crisp — raster work landing in the middle of the lift, which is
	   the one moment nothing can afford it. Rastering once at full size and scaling
	   down is free by comparison, and the strokes stay sharp.
	   --ring-end is the final diameter; every scale below is a fraction of it. */
	.cover .rings {
		--ring-end: min(148vmin, 1368px);
		position: absolute;
		top: 50%;
		left: 50%;
		width: var(--ring-end);
		height: var(--ring-end);
		margin: calc(var(--ring-end) / -2) 0 0 calc(var(--ring-end) / -2);
		pointer-events: none;
		will-change: transform, opacity;
	}
	/* Off-state, painted once before the flip to `in` — same reason the cover itself
	   gets a mount phase: without it the browser coalesces the frames and the
	   expansion never runs. */
	.cover[data-phase='mount'] .rings {
		opacity: 0;
		transform: scale(0.29);
	}
	/* Up and held, through however long the new page takes to load underneath.
	   0.53 of the end size — the cluster reads at roughly 720px here, which is what
	   it was drawn against. */
	.cover[data-phase='in'] .rings {
		opacity: 0.5;
		transform: scale(0.53);
		transition:
			opacity 260ms ease-out,
			transform 260ms cubic-bezier(0.22, 0.9, 0.3, 1);
	}
	/* Opening out past the frame as the cover lifts — the half that carries the
	   gesture, so it runs on the cover's own unhurried duration. */
	.cover[data-phase='out'] .rings {
		opacity: 0;
		transform: scale(1);
		transition:
			opacity 460ms ease-in,
			transform 460ms cubic-bezier(0.22, 0.9, 0.3, 1);
	}

	@media (prefers-reduced-motion: reduce) {
		.cover {
			display: none;
		}
	}
</style>
