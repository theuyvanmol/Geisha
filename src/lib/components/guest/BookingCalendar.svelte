<script lang="ts">
	// Inline month calendar for the guest booking widget.
	//
	// Replaces a native <input type="date">, which was the wrong control here for
	// two reasons. Chrome paints no visible picker affordance for it inside the
	// iframe — guests saw a bare `07/08/2026` box and had to know to type — and even
	// when the native popup opens it shows a bare month with no idea which days the
	// restaurant can actually take. ResDiary showed an availability-coloured grid,
	// and this is the step where a guest decides whether to bother.
	//
	// Colour carries meaning but never carries it ALONE: unavailable dates are also
	// disabled and carry an aria-label saying why, so the grid still works for a
	// colour-blind guest and for a screen reader.
	//
	// Inherits --ink/--muted/--line/--accent/--surface from the widget, so it picks
	// up each brand's accent and the dark theme without knowing about either.
	import type { DayStatus, MonthDay } from '$lib/server/booking/monthAvailability';

	interface Props {
		brand: string;
		/** Selected date, 'YYYY-MM-DD'. Bindable. */
		value: string;
		partySize: number;
		/** Today in the restaurant's timezone — never trust the guest's clock. */
		today: string;
	}

	let { brand, value = $bindable(), partySize, today }: Props = $props();

	/** First day of the month currently on screen. */
	let viewYear = $state(Number(today.slice(0, 4)));
	let viewMonth = $state(Number(today.slice(5, 7)));
	let days = $state<MonthDay[]>([]);
	// Starts TRUE. The month is fetched from an $effect, which never runs on the
	// server — so with `false` the server-rendered grid was every day greyed out
	// over "Nothing available this month for 2 guests — try the next one.", and
	// that is what a guest read until the script arrived (seconds, on a phone
	// line; for good, if it never does). It then vanished and the form jumped up
	// 32px. Loading is the honest first state: load() clears it either way.
	let loading = $state(true);
	let failed = $state(false);

	// Keep the grid on the month of whatever is selected, so re-entering the step
	// doesn't strand the guest in a different month from their own choice.
	let lastValue = value;
	$effect(() => {
		if (value && value !== lastValue) {
			lastValue = value;
			viewYear = Number(value.slice(0, 4));
			viewMonth = Number(value.slice(5, 7));
		}
	});

	const MONTH_NAMES = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	];
	// Monday-first: this is a UK restaurant and a Sunday-first grid mis-reads a
	// weekend at a glance, which is most of what a diner is scanning for.
	const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

	const statusByDate = $derived(new Map(days.map((d) => [d.date, d])));

	/** Blank cells before the 1st so the columns line up under the right weekday. */
	const leadingBlanks = $derived.by(() => {
		const dow = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay(); // 0=Sun
		return (dow + 6) % 7; // shift to Monday=0
	});

	const gridDays = $derived.by(() => {
		const last = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();
		const out: MonthDay[] = [];
		for (let d = 1; d <= last; d++) {
			const iso = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
			out.push(statusByDate.get(iso) ?? { date: iso, status: 'closed' });
		}
		return out;
	});

	/**
	 * Arrows are gated on the BOOKING HORIZON the server reports, not on months
	 * we've already fetched. Gating on "the furthest month seen with availability"
	 * disables the forward arrow on first render — the current month is trivially
	 * the furthest one seen — which strands the guest in this month entirely.
	 */
	let horizon = $state<{ firstDate: string; lastDate: string } | null>(null);
	const viewKey = $derived(`${viewYear}-${String(viewMonth).padStart(2, '0')}`);
	const canGoBack = $derived(viewKey > (horizon?.firstDate ?? today).slice(0, 7));
	const canGoForward = $derived(!horizon || viewKey < horizon.lastDate.slice(0, 7));

	async function load(year: number, month: number, party: number) {
		loading = true;
		failed = false;
		try {
			const r = await fetch(
				`/api/availability/month?brand=${brand}&year=${year}&month=${month}&party=${party}`
			);
			if (!r.ok) throw new Error(String(r.status));
			const j = await r.json();
			// Ignore a response that arrived after the guest paged on.
			if (j.year !== viewYear || j.month !== viewMonth) return;
			days = j.days ?? [];
			if (j.horizon) horizon = j.horizon;
		} catch {
			failed = true;
			days = [];
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		load(viewYear, viewMonth, partySize);
	});

	function step(delta: number) {
		let m = viewMonth + delta;
		let y = viewYear;
		if (m < 1) { m = 12; y -= 1; }
		if (m > 12) { m = 1; y += 1; }
		viewMonth = m;
		viewYear = y;
	}

	function labelFor(d: MonthDay): string {
		const human = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', {
			weekday: 'long', day: 'numeric', month: 'long'
		});
		switch (d.status) {
			case 'open': return human;
			case 'full': return `${human} — fully booked for ${partySize}`;
			case 'closed': return `${human} — closed${d.reason ? `: ${d.reason}` : ''}`;
			case 'beyond': return `${human} — too far ahead to book online`;
			default: return `${human} — unavailable`;
		}
	}

	function pick(d: MonthDay) {
		if (d.status !== 'open') return;
		value = d.date;
		lastValue = d.date;
	}
</script>

<div class="cal">
	<div class="cal-head">
		<button
			type="button"
			class="cal-nav"
			onclick={() => step(-1)}
			disabled={!canGoBack}
			aria-label="Previous month">‹</button
		>
		<span class="cal-title" aria-live="polite">{MONTH_NAMES[viewMonth - 1]} {viewYear}</span>
		<button
			type="button"
			class="cal-nav"
			onclick={() => step(1)}
			disabled={!canGoForward}
			aria-label="Next month">›</button
		>
	</div>

	<div class="cal-dow" aria-hidden="true">
		{#each WEEKDAYS as d, i (i)}<span>{d}</span>{/each}
	</div>

	<div class="cal-grid" class:is-loading={loading}>
		{#each Array(leadingBlanks) as _, i (`b${i}`)}<span class="cal-blank"></span>{/each}
		{#each gridDays as d (d.date)}
			<button
				type="button"
				class="cal-day"
				class:is-open={d.status === 'open'}
				class:is-sel={d.date === value}
				class:is-today={d.date === today}
				disabled={d.status !== 'open'}
				aria-label={labelFor(d)}
				aria-current={d.date === value ? 'date' : undefined}
				onclick={() => pick(d)}>{Number(d.date.slice(8))}</button
			>
		{/each}
	</div>

	{#if failed}
		<p class="cal-note" role="status">
			Couldn't load the calendar. Please pick a date and try again, or call us.
		</p>
	{:else if !loading && !gridDays.some((d) => d.status === 'open')}
		<p class="cal-note" role="status">
			Nothing available this month for {partySize}
			{partySize === 1 ? 'guest' : 'guests'} — try the next one.
		</p>
	{/if}
</div>

<style>
	.cal {
		border: 1px solid var(--line);
		border-radius: 2px;
		padding: 0.5rem 0.55rem 0.6rem;
	}

	.cal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem;
		margin-bottom: 0.4rem;
	}

	.cal-title {
		font-size: 0.9rem;
		font-weight: 500;
	}

	/* 44px, level with the day cells below — at 32px these were the smallest
	   thing to tap in a grid whose every other target is 42px+. */
	.cal-nav {
		width: 2.75rem;
		height: 2.75rem;
		flex: none;
		border: 1px solid var(--line);
		border-radius: 2px;
		background: transparent;
		color: var(--ink);
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
	}

	.cal-nav:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.cal-dow,
	.cal-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.cal-dow {
		margin-bottom: 2px;
	}

	.cal-dow span {
		padding: 0.2rem 0;
		text-align: center;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.cal-grid.is-loading {
		opacity: 0.45;
	}

	.cal-day {
		/* A square-ish cell that stays >=32px so it's a comfortable phone target
		   even in a 320px-wide frame — most bookings come from a phone. */
		aspect-ratio: 1;
		min-height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: 2px;
		background: transparent;
		color: var(--muted);
		font: inherit;
		font-size: 0.85rem;
		cursor: default;
	}

	/* Unavailable dates are disabled AND dimmed AND labelled — colour is never the
	   only signal. */
	.cal-day:disabled {
		opacity: 0.32;
	}

	.cal-day.is-open {
		color: var(--ink);
		border-color: var(--line);
		background: color-mix(in srgb, var(--accent) 7%, transparent);
		cursor: pointer;
	}

	.cal-day.is-open:hover {
		border-color: var(--accent);
	}

	.cal-day:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.cal-day.is-today {
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.cal-day.is-sel {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
		font-weight: 600;
	}

	.cal-blank {
		aspect-ratio: 1;
		min-height: 2rem;
	}

	.cal-note {
		margin: 0.5rem 0 0;
		font-size: 0.78rem;
		color: var(--muted);
	}
</style>
