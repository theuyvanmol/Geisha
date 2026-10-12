<script lang="ts">
	// Visual result card for the admin assistant. Renders the render-only UI tools
	// (show_bookings / show_report) that come back as directives with a `.kind` and
	// are routed into the shared store's `resultCards[]` (assistant.svelte.ts). It's
	// a pure presentational switch on `card.kind` — a compact table for a day's
	// bookings, a stat card for a covers / no-show report — plus a dismiss button.
	// Styled only with --admin-* tokens (admin.css) so it reads native in both the
	// dock and the full-page /admin/assistant view, light and dark.
	//
	// The card shape mirrors what toolsCards.ts returns; `key` is the store's dedupe
	// key (see ResultCard in assistant.svelte.ts).

	import type { ResultCard } from '$lib/admin/assistant.svelte';

	let { card, onclose }: { card: ResultCard; onclose: (key: string) => void } = $props();

	// Narrow the union by kind for the template (the store carries the raw result).
	const r = $derived(card.result as Record<string, unknown>);

	/** Friendly label for a booking arrival/lifecycle status. */
	const STATUS_LABEL: Record<string, string> = {
		pending_payment: 'Awaiting payment',
		confirmed: 'Confirmed',
		seated: 'Seated',
		completed: 'Left',
		to_arrive: 'To arrive'
	};
	function statusLabel(s: unknown): string {
		const k = String(s ?? '');
		return STATUS_LABEL[k] ?? k.replace(/_/g, ' ');
	}
</script>

<div class="card" aria-label="Assistant result">
	<header class="head">
		<span class="tag">
			{#if r.kind === 'bookings-table'}
				Bookings
			{:else if r.kind === 'report'}
				{r.metric === 'noshow' ? 'No-show report' : 'Covers report'}
			{:else}
				Result
			{/if}
		</span>
		<span class="range">
			{#if r.kind === 'bookings-table'}
				{r.date}
			{:else if r.kind === 'report'}
				{r.from} → {r.to}
			{/if}
		</span>
		<button class="x" type="button" onclick={() => onclose(card.key)} aria-label="Dismiss">✕</button
		>
	</header>

	{#if r.kind === 'bookings-table'}
		{@const rows = (r.rows ?? []) as Array<Record<string, unknown>>}
		<div class="summary">
			<strong>{r.totalBookings}</strong> bookings · <strong>{r.totalCovers}</strong> covers
		</div>
		{#if rows.length === 0}
			<p class="empty">No live bookings for this date.</p>
		{:else}
			<div class="tablewrap">
				<table>
					<thead>
						<tr>
							<th>Time</th>
							<th>Guest</th>
							<th class="num">Party</th>
							<th>Table</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row}
							<tr>
								<td class="mono">{row.time}</td>
								<td>{row.name}</td>
								<td class="num">{row.party}</td>
								<td>{row.table}</td>
								<td><span class="pill {String(row.status)}">{statusLabel(row.status)}</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else if r.kind === 'report' && r.metric === 'noshow'}
		{@const t = (r.totals ?? {}) as Record<string, number>}
		{@const channels = (r.byChannel ?? []) as Array<Record<string, unknown>>}
		<div class="stats">
			<div class="stat big"><span class="v">{t.noShowRatePct}%</span><span class="l">No-show rate</span></div>
			<div class="stat"><span class="v">{t.cancelRatePct}%</span><span class="l">Cancel rate</span></div>
			<div class="stat"><span class="v">{t.noShows}</span><span class="l">No-shows</span></div>
			<div class="stat"><span class="v">{t.resolved}</span><span class="l">Resolved</span></div>
		</div>
		{#if channels.length > 0}
			<div class="tablewrap">
				<table>
					<thead>
						<tr><th>Channel</th><th class="num">Resolved</th><th class="num">No-shows</th><th class="num">Rate</th></tr>
					</thead>
					<tbody>
						{#each channels as c}
							<tr>
								<td>{c.label}</td>
								<td class="num">{c.resolved}</td>
								<td class="num">{c.noShows}</td>
								<td class="num">{c.noShowRatePct}%</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else if r.kind === 'report'}
		{@const t = (r.totals ?? {}) as Record<string, number>}
		{@const days = (r.byDay ?? []) as Array<Record<string, unknown>>}
		<div class="stats">
			<div class="stat big"><span class="v">{t.covers}</span><span class="l">Covers</span></div>
			<div class="stat"><span class="v">{t.bookings}</span><span class="l">Bookings</span></div>
			<div class="stat"><span class="v">{t.avgPartySize}</span><span class="l">Avg party</span></div>
			<div class="stat"><span class="v">{t.noShows}</span><span class="l">No-shows</span></div>
		</div>
		{#if days.length > 0}
			<div class="tablewrap">
				<table>
					<thead>
						<tr><th>Date</th><th class="num">Bookings</th><th class="num">Covers</th><th class="num">No-shows</th></tr>
					</thead>
					<tbody>
						{#each days as d}
							<tr>
								<td class="mono">{d.date}</td>
								<td class="num">{d.bookings}</td>
								<td class="num">{d.covers}</td>
								<td class="num">{d.noShows}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

<style>
	.card {
		align-self: stretch;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-left: 3px solid var(--admin-accent, #d4a04c);
		border-radius: var(--admin-radius, 8px);
		padding: 0.7rem 0.8rem 0.8rem;
		font-size: 0.82rem;
		color: var(--admin-ink);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.tag {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		font-weight: 700;
		color: var(--admin-accent, #b26a00);
	}
	.range {
		flex: 1;
		font-size: 0.72rem;
		color: var(--admin-muted);
		font-variant-numeric: tabular-nums;
	}
	.x {
		background: none;
		border: 0;
		color: var(--admin-faint);
		font-size: 0.8rem;
		cursor: pointer;
		padding: 0.1rem 0.3rem;
		border-radius: var(--admin-radius-sm, 4px);
	}
	.x:hover {
		background: var(--admin-surface-2);
		color: var(--admin-ink);
	}
	.summary {
		font-size: 0.8rem;
		color: var(--admin-muted);
		margin-bottom: 0.5rem;
	}
	.summary strong {
		color: var(--admin-ink);
	}
	.empty {
		margin: 0.3rem 0 0;
		font-size: 0.8rem;
		color: var(--admin-muted);
	}

	.tablewrap {
		overflow-x: auto;
		max-height: 16rem;
		overflow-y: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.76rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.3rem 0.4rem;
		border-bottom: 1px solid var(--admin-border);
		white-space: nowrap;
	}
	th {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--admin-faint);
		font-weight: 700;
		position: sticky;
		top: 0;
		background: var(--admin-surface);
	}
	td.num,
	th.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.mono {
		font-variant-numeric: tabular-nums;
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}

	.pill {
		display: inline-block;
		font-size: 0.66rem;
		font-weight: 600;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: var(--admin-surface-2);
		color: var(--admin-muted);
		white-space: nowrap;
	}
	.pill.seated {
		background: var(--admin-accent-soft, #f3e6cc);
		color: var(--admin-accent, #b26a00);
	}
	.pill.pending_payment {
		background: var(--admin-tone-warn-bg, #fff4e0);
		color: var(--admin-tone-warn-fg, #b26a00);
	}
	.pill.completed {
		color: var(--admin-faint);
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}
	.stat {
		background: var(--admin-surface-2);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius-sm, 6px);
		padding: 0.45rem 0.55rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.stat.big .v {
		color: var(--admin-accent, #b26a00);
	}
	.stat .v {
		font-size: 1.15rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.stat .l {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--admin-muted);
	}
</style>
