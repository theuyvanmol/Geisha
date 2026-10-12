<script lang="ts">
	// Dev-only floating switch between our own booking form (what guests get), the
	// old ResDiary widget and the unproven art-directed flow. Renders NOTHING
	// unless `toggleAvailable` — see
	// $lib/bookings/engine.ts for why that guard is the whole safety story.
	//
	// Styled to look unmistakably like a dev tool (mono type, warning stripe) so
	// it can never be mistaken for part of the restaurant's site if it somehow
	// appears where it shouldn't.
	import { toggleAvailable, persist, type BookingEngine } from '$lib/bookings/engine';

	let { engine = $bindable() }: { engine: BookingEngine } = $props();

	function choose(next: BookingEngine) {
		engine = next;
		persist(next);
	}
</script>

{#if toggleAvailable}
	<div class="switch" role="group" aria-label="Booking engine (development only)">
		<span class="tag">DEV</span>
		<button
			type="button"
			class:active={engine === 'widget'}
			aria-pressed={engine === 'widget'}
			onclick={() => choose('widget')}
		>
			Ours
		</button>
		<button
			type="button"
			class:active={engine === 'resdiary'}
			aria-pressed={engine === 'resdiary'}
			onclick={() => choose('resdiary')}
		>
			ResDiary
		</button>
		<button
			type="button"
			class:active={engine === 'custom'}
			aria-pressed={engine === 'custom'}
			onclick={() => choose('custom')}
		>
			Custom
		</button>
	</div>
{/if}

<style>
	.switch {
		position: fixed;
		right: 1rem;
		bottom: 1rem;
		z-index: 9999;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.35rem;
		border-radius: 999px;
		background: #14110f;
		border: 1px solid #f0b429;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		letter-spacing: 0.04em;
	}

	.tag {
		padding: 0 0.5rem 0 0.35rem;
		color: #f0b429;
		font-weight: 700;
	}

	button {
		appearance: none;
		border: 0;
		cursor: pointer;
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		background: transparent;
		color: #d8d2cc;
		font: inherit;
		transition: background 0.15s ease, color 0.15s ease;
	}

	button:hover {
		background: #2a2520;
		color: #fff;
	}

	button.active {
		background: #f0b429;
		color: #14110f;
		font-weight: 700;
	}

	/* The switch sits over the page; keep it out of the way of thumbs on mobile. */
	@media (max-width: 600px) {
		.switch {
			right: 0.5rem;
			bottom: 0.5rem;
			transform: scale(0.9);
			transform-origin: bottom right;
		}
	}
</style>
