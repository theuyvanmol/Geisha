<script lang="ts">
	// Shared service-view date navigator (Floor ↔ Diary parity).
	//
	// ResDiary-style centred date: ‹ Tuesday 30/06/2026 › — day steppers on either
	// side of a pill whose label shows the weekday and whose hidden native <input
	// type=date> jumps to any date. Lifted verbatim from the diary header so the floor
	// gets identical date navigation (its #1 missing feature) from one source.
	//
	// View-agnostic: it owns NO navigation. It calls `onChange(newDate)` with a
	// 'YYYY-MM-DD' string; the host decides what that means (both views goto() with
	// their own brand/date/floor params). Parsing is done on the string parts so the
	// label/stepping never drift across a timezone (no Date(string) UTC surprises).

	interface Props {
		/** current date as 'YYYY-MM-DD'. */
		date: string;
		/** the host navigates to this date. */
		onChange: (date: string) => void;
	}
	let { date, onChange }: Props = $props();

	const parts = $derived(date.split('-').map(Number) as [number, number, number]);
	const label = $derived.by(() => {
		const [y, m, d] = parts;
		const dt = new Date(Date.UTC(y, m - 1, d));
		const weekday = dt.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
		const dmy = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
		return `${weekday} ${dmy}`;
	});
	function stepDay(delta: number) {
		const [y, m, d] = parts;
		const dt = new Date(Date.UTC(y, m - 1, d + delta));
		onChange(dt.toISOString().slice(0, 10));
	}
	// Open the native calendar from anywhere on the pill (not just the tiny OS glyph).
	// showPicker() is widely supported; fall back to focus if it throws / is absent.
	function openPicker(e: MouseEvent | KeyboardEvent) {
		const input = (e.currentTarget as HTMLElement).querySelector(
			'.date-input'
		) as HTMLInputElement | null;
		if (!input) return;
		if (typeof input.showPicker === 'function') {
			try {
				input.showPicker();
				return;
			} catch {
				/* not user-activated — fall through to focus */
			}
		}
		input.focus();
	}
</script>

<div class="date-nav">
	<button type="button" class="date-step" onclick={() => stepDay(-1)} aria-label="Previous day"
		>‹</button
	>
	<div
		class="date-current"
		role="button"
		tabindex="0"
		onclick={openPicker}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openPicker(e);
			}
		}}
	>
		<span class="date-label">{label}</span>
		<input
			class="date-input"
			type="date"
			value={date}
			onchange={(e) => onChange((e.target as HTMLInputElement).value)}
			aria-label="Pick a date"
		/>
	</div>
	<button type="button" class="date-step" onclick={() => stepDay(1)} aria-label="Next day">›</button>
</div>

<style>
	.date-nav {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.date-step {
		appearance: none;
		border: 1px solid var(--admin-border);
		background: var(--admin-surface);
		color: var(--admin-ink);
		width: 2rem;
		height: 2rem;
		border-radius: 999px;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background 0.12s ease;
	}
	.date-step:hover {
		background: var(--admin-surface-2);
	}
	/* the label + an invisible native date picker laid over it: clicking the date
	   text opens the OS calendar to jump anywhere; the steppers do ±1 day. */
	.date-current {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 14rem;
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--admin-border);
		border-radius: 999px;
		background: var(--admin-surface);
		cursor: pointer;
	}
	.date-label {
		font-size: 1.02rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--admin-ink);
		white-space: nowrap;
		pointer-events: none;
	}
	.date-input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		border: 0;
		padding: 0;
		margin: 0;
		cursor: pointer;
	}
</style>
