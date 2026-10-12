<script lang="ts">
	// The diary's jump-to-a-date calendar, dropped under the header's date pill.
	//
	// It replaces the native <input type="date"> popup. Owner, from the iMac: "this
	// needs to be bigger, like 2x bigger" — and that popup is drawn by the browser
	// (Safari on the Mac, Safari on the floor iPads) at a fixed size no page CSS can
	// reach. The only way to make it bigger was to draw it ourselves.
	//
	// Works on 'YYYY-MM-DD' calendar strings end to end, the same rule as the header's
	// label and steppers: Date.UTC is only ever used to add whole days/months to a
	// midnight and read the parts back, so a day can't slip across a timezone or DST.
	import { onMount, tick, untrack } from 'svelte';

	let {
		value,
		today,
		onpick
	}: {
		/** The day the diary is showing. */
		value: string;
		/** The venue's real today (the page's live one, not the loader snapshot). */
		today: string;
		/** A day was chosen — the page navigates and closes the picker. */
		onpick: (date: string) => void;
	} = $props();

	const MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	const HEADS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

	/** A calendar date from parts. Out-of-range days/months roll over (day 0 = the last
	 *  day of the previous month), which is what lets the grid spill into its neighbours. */
	const iso = (y: number, m: number, d: number) =>
		new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
	const parts = (date: string) => date.split('-').map(Number) as [number, number, number];

	function addDays(date: string, delta: number) {
		const [y, m, d] = parts(date);
		return iso(y, m, d + delta);
	}
	/** Same day-of-month a month over, clamped — 31 Jan → 28 Feb, not 3 Mar. */
	function addMonths(date: string, delta: number) {
		const [y, m, d] = parts(date);
		const last = new Date(Date.UTC(y, m + delta, 0)).getUTCDate();
		return iso(y, m + delta, Math.min(d, last));
	}

	// The month on show. Seeded once from the viewed day: the picker is mounted fresh
	// every time it opens, so it always opens on the month you're looking at.
	const [y0, m0] = untrack(() => parts(value));
	let view = $state({ y: y0, m: m0 });
	/** The day keyboard focus sits on (the grid's single tab stop). */
	let focusDate = $state(untrack(() => value));
	let gridEl: HTMLDivElement | undefined = $state();

	const inView = (date: string) => {
		const [y, m] = parts(date);
		return y === view.y && m === view.m;
	};
	/** Exactly one day in the grid takes Tab: the focused day if it's on show, else the
	 *  viewed day, else the 1st — so paging months never strands focus off-grid. */
	const tabDate = $derived(
		inView(focusDate) ? focusDate : inView(value) ? value : iso(view.y, view.m, 1)
	);

	// Always six weeks, Monday-first, padded with the neighbouring months' days (muted,
	// still pickable). A fixed six rows keeps the popover the same height as you page,
	// so the arrows don't jump out from under the pointer.
	const cells = $derived.by(() => {
		const { y, m } = view;
		const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
		return Array.from({ length: 42 }, (_, i) => {
			const date = iso(y, m, i - offset + 1);
			const [, cm, cd] = parts(date);
			return { date, day: cd, inMonth: cm === m };
		});
	});

	const longLabel = (date: string) => {
		const [y, m, d] = parts(date);
		return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
	};

	function showMonth(delta: number) {
		const [y, m] = parts(iso(view.y, view.m + delta, 1));
		view = { y, m };
	}

	async function moveFocus(next: string) {
		focusDate = next;
		const [y, m] = parts(next);
		if (y !== view.y || m !== view.m) view = { y, m };
		await tick();
		gridEl?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus();
	}

	// Arrows walk the days, PageUp/PageDown walk the months. Enter/Space are the day
	// buttons' own click; Escape is the page's (it owns the open flag).
	function onDayKey(e: KeyboardEvent) {
		const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
		if (e.key in step) {
			e.preventDefault();
			void moveFocus(addDays(tabDate, step[e.key]));
		} else if (e.key === 'PageUp' || e.key === 'PageDown') {
			e.preventDefault();
			void moveFocus(addMonths(tabDate, e.key === 'PageUp' ? -1 : 1));
		}
	}

	// Land keyboard focus on the viewed day, so the arrows work the moment it opens.
	onMount(() => {
		gridEl?.querySelector<HTMLButtonElement>(`[data-date="${tabDate}"]`)?.focus();
	});
</script>

<div class="dp" role="dialog" aria-label="Choose a date">
	<div class="dp-head">
		<span class="dp-title" aria-live="polite">{MONTHS[view.m - 1]} {view.y}</span>
		<div class="dp-navs">
			<button type="button" class="dp-nav" onclick={() => showMonth(-1)} aria-label="Previous month"
				>‹</button
			>
			<button type="button" class="dp-today" onclick={() => onpick(today)}>Today</button>
			<button type="button" class="dp-nav" onclick={() => showMonth(1)} aria-label="Next month"
				>›</button
			>
		</div>
	</div>

	<div class="dp-grid" bind:this={gridEl}>
		{#each HEADS as h (h)}
			<span class="dp-dow" aria-hidden="true">{h}</span>
		{/each}
		{#each cells as c (c.date)}
			<button
				type="button"
				class="dp-day"
				class:out={!c.inMonth}
				class:today={c.date === today}
				class:sel={c.date === value}
				data-date={c.date}
				tabindex={c.date === tabDate ? 0 : -1}
				aria-label={longLabel(c.date)}
				aria-pressed={c.date === value}
				aria-current={c.date === today ? 'date' : undefined}
				onfocus={() => (focusDate = c.date)}
				onkeydown={onDayKey}
				onclick={() => onpick(c.date)}>{c.day}</button
			>
		{/each}
	</div>
</div>

<style>
	/* Sized at twice the native popup it replaces: ~54px day targets and a 1.25rem
	   numeral, which is also a comfortable finger target on the floor iPads. */
	.dp {
		position: absolute;
		z-index: 63;
		top: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		padding: 1rem 1rem 1.1rem;
		background: var(--admin-surface);
		color: var(--admin-ink);
		border: 1px solid var(--admin-border);
		border-radius: 14px;
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.26);
		animation: dp-in 0.12s ease-out;
	}
	@keyframes dp-in {
		from {
			opacity: 0;
			transform: translate(-50%, -4px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dp {
			animation: none;
		}
	}

	.dp-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin: 0 0.15rem 0.7rem 0.35rem;
	}
	.dp-title {
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		white-space: nowrap;
	}
	.dp-navs {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.dp-nav,
	.dp-today {
		appearance: none;
		font: inherit;
		line-height: 1;
		border: 1px solid var(--admin-border);
		background: var(--admin-surface);
		color: var(--admin-ink);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background 0.12s ease;
	}
	.dp-nav {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 999px;
		font-size: 1.6rem;
		padding-bottom: 0.12em;
	}
	.dp-today {
		height: 2.75rem;
		padding: 0 1rem;
		border-radius: 999px;
		font-size: 1rem;
		font-weight: 600;
		color: var(--admin-accent-strong);
	}
	.dp-nav:hover,
	.dp-today:hover {
		background: var(--admin-surface-2);
	}

	.dp-grid {
		display: grid;
		grid-template-columns: repeat(7, 3.4rem);
		gap: 0.2rem;
	}
	.dp-dow {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 2.1rem;
		font-size: 0.9rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--admin-muted);
	}
	.dp-day {
		appearance: none;
		font: inherit;
		width: 3.4rem;
		height: 3.4rem;
		padding: 0;
		border: 0;
		border-radius: 12px;
		background: transparent;
		color: var(--admin-ink);
		font-size: 1.25rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition: background 0.1s ease;
	}
	.dp-day:hover {
		background: var(--admin-surface-2);
	}
	.dp-day.out {
		color: var(--admin-muted);
		opacity: 0.5;
		font-weight: 500;
	}
	/* Today: a ring, so it still reads when it's also the selected day. */
	.dp-day.today {
		box-shadow: inset 0 0 0 2px var(--admin-accent);
		color: var(--admin-accent-strong);
	}
	.dp-day.sel {
		background: var(--admin-accent);
		color: var(--admin-accent-ink);
		opacity: 1;
	}
	.dp-day.sel.today {
		box-shadow: inset 0 0 0 2px var(--admin-accent-ink);
	}
	.dp-day:focus-visible,
	.dp-nav:focus-visible,
	.dp-today:focus-visible {
		outline: 2px solid var(--admin-accent);
		outline-offset: 2px;
	}
</style>
