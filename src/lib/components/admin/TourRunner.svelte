<script lang="ts">
	// Guided-tour runner — the floating step card that drives a walkthrough.
	//
	// Mounted ONCE in the admin shell (near AssistantDock) so it survives client-side
	// navigation; a tour can move between pages as it steps. It binds entirely to the
	// separate training rune store (src/lib/admin/training.svelte.ts): the active
	// tour, the step cursor, Next/Back/Exit. Renders nothing when no tour is running.
	//
	// SPOTLIGHT: when a step declares a `selector`, the runner finds that element,
	// scrolls it into view and draws a highlight ring around it (a dimmed backdrop
	// with a "hole" cut over the element). If the element can't be found (dynamic UI
	// not yet rendered, or a selector-less step) it falls back to a plain centred/
	// docked narration card with a soft scrim — the tour still reads as a guide.
	//
	// Styled only with --admin-* tokens (admin.css); reduced-motion friendly.
	import { training } from '$lib/admin/training.svelte';
	import { onMount, tick } from 'svelte';
	import { browser } from '$app/environment';

	// The measured box of the spotlighted element in viewport coords, or null when
	// the step has no selector or the element isn't on the page.
	let spot = $state<{ top: number; left: number; width: number; height: number } | null>(null);

	onMount(() => {
		training.hydrate();
	});

	// Re-measure the spotlight whenever the tour/step changes, and on resize/scroll.
	// A short retry covers controls that mount a frame or two after navigation.
	$effect(() => {
		// touch reactive deps so this re-runs on step change
		const tour = training.activeTour;
		const idx = training.stepIndex;
		void tour;
		void idx;
		if (!browser) return;
		let cancelled = false;
		let raf = 0;

		async function measure(attempt = 0): Promise<void> {
			await tick();
			if (cancelled) return;
			const step = training.currentStep;
			if (!tour || !step?.selector) {
				spot = null;
				return;
			}
			const el = document.querySelector(step.selector) as HTMLElement | null;
			if (!el) {
				// Retry a few times — the target may still be mounting after a nav.
				if (attempt < 8) {
					raf = window.setTimeout(() => void measure(attempt + 1), 120);
				} else {
					spot = null; // give up → narration-only card
				}
				return;
			}
			el.scrollIntoView({ block: 'center', behavior: 'smooth' });
			const r = el.getBoundingClientRect();
			spot = { top: r.top, left: r.left, width: r.width, height: r.height };
		}

		void measure();

		const onScrollResize = () => {
			const step = training.currentStep;
			if (!tour || !step?.selector) return;
			const el = document.querySelector(step.selector) as HTMLElement | null;
			if (!el) return;
			const r = el.getBoundingClientRect();
			spot = { top: r.top, left: r.left, width: r.width, height: r.height };
		};
		window.addEventListener('scroll', onScrollResize, true);
		window.addEventListener('resize', onScrollResize);

		return () => {
			cancelled = true;
			if (raf) clearTimeout(raf);
			window.removeEventListener('scroll', onScrollResize, true);
			window.removeEventListener('resize', onScrollResize);
		};
	});

	// Keyboard: Esc exits, arrow keys / Enter step (only while a tour runs).
	function onKey(e: KeyboardEvent) {
		if (!training.activeTour) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			training.exitTour();
		} else if (e.key === 'ArrowRight' || e.key === 'Enter') {
			e.preventDefault();
			training.nextStep();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			training.prevStep();
		}
	}

	// Pad the spotlight hole slightly so the ring sits off the element edge.
	const PAD = 6;
</script>

<svelte:window onkeydown={onKey} />

{#if training.activeTour}
	{@const tour = training.activeTour}
	{@const step = training.currentStep}
	{@const pos = training.position}
	{#if step}
		<!-- Backdrop: a scrim over the whole page. When a spotlight box exists we cut
		     a hole over it using a box-shadow ring so the target stays bright and the
		     rest dims; without one it's a soft full scrim behind the narration card. -->
		{#if spot}
			<div
				class="ring"
				style="top:{spot.top - PAD}px; left:{spot.left - PAD}px; width:{spot.width +
					PAD * 2}px; height:{spot.height + PAD * 2}px;"
				aria-hidden="true"
			></div>
		{:else}
			<div class="scrim" aria-hidden="true"></div>
		{/if}

		<!-- Step card: docked bottom-centre so it doesn't fight the spotlight (which is
		     usually elsewhere on the page). role=dialog for assistive tech. -->
		<section
			class="card"
			class:has-spot={!!spot}
			aria-label="{tour.title} — guided tour"
		>
			<header class="chead">
				<span class="ctour">{tour.title}</span>
				<span class="cprog">{pos.n} / {pos.total}</span>
				<button class="cx" type="button" onclick={() => training.exitTour()} aria-label="Exit tour"
					>✕</button
				>
			</header>
			<h3 class="ctitle">{step.title}</h3>
			<p class="cbody">{step.body}</p>
			{#if step.waitForClick}
				<p class="chint">Give it a try — then continue.</p>
			{/if}
			<div class="cbtns">
				<button
					class="back"
					type="button"
					onclick={() => training.prevStep()}
					disabled={pos.n <= 1}>Back</button
				>
				<div class="spacer"></div>
				<button class="exit" type="button" onclick={() => training.exitTour()}>Exit</button>
				<button class="next" type="button" onclick={() => training.nextStep()}>
					{pos.n >= pos.total ? 'Finish' : 'Next'}
				</button>
			</div>
		</section>
	{/if}
{/if}

<style>
	/* Spotlight ring: a fixed box over the target. The huge spread box-shadow is the
	   dimming scrim; the inner border is the highlight ring. pointer-events:none so
	   the operator can still interact with the spotlighted control. */
	.ring {
		position: fixed;
		z-index: 70;
		border-radius: var(--admin-radius, 8px);
		border: 2px solid var(--admin-accent, #d4a04c);
		box-shadow:
			0 0 0 4px var(--admin-accent-soft, rgba(212, 160, 76, 0.3)),
			0 0 0 100vmax rgba(20, 16, 12, 0.55);
		pointer-events: none;
		transition:
			top 0.25s ease,
			left 0.25s ease,
			width 0.25s ease,
			height 0.25s ease;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: rgba(20, 16, 12, 0.45);
		pointer-events: none;
	}

	.card {
		position: fixed;
		z-index: 72;
		left: 50%;
		bottom: 1.4rem;
		transform: translateX(-50%);
		width: min(92vw, 440px);
		background: var(--admin-surface);
		color: var(--admin-ink);
		border: 1px solid var(--admin-border);
		border-left: 3px solid var(--admin-accent, #d4a04c);
		border-radius: var(--admin-radius-lg, 12px);
		box-shadow: var(--admin-shadow-lg);
		padding: 0.9rem 1rem 0.85rem;
		font-family: var(--admin-font);
	}
	.chead {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}
	.ctour {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--admin-accent, #b26a00);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cprog {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--admin-muted);
		font-variant-numeric: tabular-nums;
	}
	.cx {
		background: none;
		border: 0;
		color: var(--admin-faint);
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0.1rem 0.3rem;
		border-radius: var(--admin-radius-sm, 4px);
		line-height: 1;
	}
	.cx:hover {
		background: var(--admin-surface-2);
		color: var(--admin-ink);
	}
	.ctitle {
		margin: 0.5rem 0 0.3rem;
		font-size: 1rem;
		font-weight: 600;
	}
	.cbody {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.55;
		color: var(--admin-ink);
	}
	.chint {
		margin: 0.55rem 0 0;
		font-size: 0.76rem;
		font-style: italic;
		color: var(--admin-muted);
	}
	.cbtns {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.85rem;
	}
	.spacer {
		flex: 1;
	}
	.cbtns button {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.45rem 0.9rem;
		border-radius: var(--admin-radius, 8px);
		cursor: pointer;
		border: 1px solid var(--admin-border);
	}
	.back {
		background: var(--admin-surface);
		color: var(--admin-muted);
	}
	.back:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.exit {
		background: var(--admin-surface);
		color: var(--admin-muted);
	}
	.next {
		background: var(--admin-primary);
		color: var(--admin-primary-ink);
		border-color: var(--admin-primary);
		font-weight: 600;
	}
	.back:hover:not(:disabled),
	.exit:hover {
		background: var(--admin-surface-2);
		color: var(--admin-ink);
	}
	.next:hover {
		filter: brightness(1.07);
	}

	@media (prefers-reduced-motion: reduce) {
		.ring {
			transition: none;
		}
	}
</style>
