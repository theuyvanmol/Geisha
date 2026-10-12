<script lang="ts">
	// Shared closure banner (Floor ↔ Diary parity, ResDiary "Service Closures").
	// Red (whole day) / amber (single service) banner listing each closure with a
	// Remove button, plus an inline add-closure form (whole day or one service). When
	// nothing is closed it shows a slim "Close this day or a service…" affordance.
	// View-agnostic: reads the shared ServiceClosure loader shape, calls onAdd/onRemove.

	import {
		type ServiceClosure,
		closureBanner as bannerHeadline,
		periodName,
		CLOSURE_KIND_LABELS
	} from './closures';

	interface Props {
		closure: ServiceClosure | null | undefined;
		date: string;
		busy?: boolean;
		onAdd: (payload: {
			date: string;
			scope: 'full' | 'period';
			service_period: string;
			kind: string;
			reason: string;
		}) => void;
		onRemove: (id: string) => void;
	}
	let { closure, date, busy = false, onAdd, onRemove }: Props = $props();

	const closedFull = $derived(closure?.closedFull ?? false);
	const active = $derived(closure?.active ?? []);
	const periods = $derived(closure?.periods ?? []);
	const headline = $derived(bannerHeadline(closure));

	let addOpen = $state(false);
	let scope = $state<'full' | 'period'>('full');
	let period = $state('');
	let kind = $state('holiday');
	let reason = $state('');
	function openAdd() {
		scope = 'full';
		period = periods[0]?.id ?? '';
		kind = 'holiday';
		reason = '';
		addOpen = true;
	}
	function submit() {
		if (scope === 'period' && !period) return;
		onAdd({ date, scope, service_period: scope === 'period' ? period : '', kind, reason });
		addOpen = false;
	}
</script>

{#snippet form()}
	<form
		class="cb-form"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		<select bind:value={scope} aria-label="Closure scope">
			<option value="full">Whole day</option>
			<option value="period">Single service</option>
		</select>
		{#if scope === 'period'}
			<select bind:value={period} aria-label="Service to close" required>
				{#each periods as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
		{/if}
		<select bind:value={kind} aria-label="Reason kind">
			<option value="holiday">Holiday</option>
			<option value="private_hire">Private hire</option>
			<option value="maintenance">Maintenance</option>
		</select>
		<input bind:value={reason} placeholder="Note (optional)" aria-label="Closure note" />
		<button type="submit" class="cb-form-go" disabled={busy}>Add</button>
		<button type="button" class="cb-form-cancel" onclick={() => (addOpen = false)}>Cancel</button>
	</form>
{/snippet}

{#if active.length}
	<div class="closure-banner" class:full={closedFull} role="status">
		<div class="cb-top">
			<span class="cb-icon" aria-hidden="true">{closedFull ? '⛔' : '⚠'}</span>
			<span class="cb-text">{headline}</span>
			<span class="cb-sub">
				{closedFull
					? 'No new bookings or walk-ins can be taken for this date.'
					: 'New bookings into the closed service are blocked; the rest of the day is open.'}
			</span>
		</div>
		<ul class="cb-list">
			{#each active as c (c.id)}
				<li>
					<span class="cb-tag">{c.scope === 'period' ? periodName(closure, c.periodId) : 'Whole day'}</span>
					<span class="cb-reason">{c.reason || (CLOSURE_KIND_LABELS[c.kind] ?? c.kind)}</span>
					<button type="button" class="cb-remove" disabled={busy} onclick={() => onRemove(c.id)}
						>Remove</button
					>
				</li>
			{/each}
		</ul>
		{#if !addOpen}
			<button type="button" class="cb-add-link" onclick={openAdd}>＋ Close another service</button>
		{:else}
			{@render form()}
		{/if}
	</div>
{:else}
	<div class="closure-openbar">
		{#if !addOpen}
			<button type="button" class="cb-add-link" onclick={openAdd}
				>Close this day or a service…</button
			>
		{:else}
			{@render form()}
		{/if}
	</div>
{/if}

<style>
	.closure-banner {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.55rem 0.9rem;
		margin-bottom: 0.6rem;
		border-radius: 10px;
		background: color-mix(in srgb, #c8911f 16%, var(--admin-surface));
		border: 1px solid color-mix(in srgb, #c8911f 45%, transparent);
		color: var(--admin-tone-warning-fg, #8a5a00);
	}
	.closure-banner.full {
		background: color-mix(in srgb, var(--admin-tone-danger-fg, #c0392b) 14%, var(--admin-surface));
		border-color: color-mix(in srgb, var(--admin-tone-danger-fg, #c0392b) 45%, transparent);
		color: var(--admin-tone-danger-fg, #c0392b);
	}
	.cb-top {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35rem 0.7rem;
	}
	.cb-icon {
		font-size: 1rem;
		line-height: 1;
	}
	.cb-text {
		font-weight: 700;
		font-size: 0.9rem;
	}
	.cb-sub {
		font-size: 0.74rem;
		opacity: 0.85;
	}
	.cb-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.cb-list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
	}
	.cb-tag {
		font-weight: 700;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		background: color-mix(in srgb, currentColor 14%, transparent);
	}
	.cb-reason {
		opacity: 0.9;
	}
	.cb-remove {
		margin-left: auto;
		font: inherit;
		font-size: 0.74rem;
		padding: 0.15rem 0.55rem;
		border-radius: 5px;
		border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.cb-remove:hover:not(:disabled) {
		background: color-mix(in srgb, currentColor 12%, transparent);
	}
	.cb-remove:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.closure-openbar {
		margin-bottom: 0.6rem;
	}
	.cb-add-link {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.1rem 0;
		border: 0;
		background: transparent;
		color: var(--admin-muted);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.cb-add-link:hover {
		color: var(--admin-fg, inherit);
	}
	.closure-banner .cb-add-link {
		color: inherit;
		opacity: 0.85;
		align-self: flex-start;
	}
	.cb-form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding-top: 0.1rem;
	}
	.cb-form select,
	.cb-form input {
		font: inherit;
		font-size: 0.8rem;
		padding: 0.3rem 0.45rem;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		background: var(--admin-surface);
		color: var(--admin-fg, inherit);
	}
	.cb-form input {
		min-width: 12rem;
		flex: 1 1 12rem;
	}
	.cb-form-go {
		font: inherit;
		font-size: 0.8rem;
		padding: 0.32rem 0.8rem;
		border: 0;
		border-radius: 6px;
		background: var(--admin-primary);
		color: var(--admin-surface);
		cursor: pointer;
	}
	.cb-form-go:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.cb-form-cancel {
		font: inherit;
		font-size: 0.78rem;
		padding: 0.32rem 0.5rem;
		border: 0;
		background: transparent;
		color: var(--admin-muted);
		cursor: pointer;
	}
</style>
