<script lang="ts" module>
	// StatusPill — THE single status-colour vocabulary for the whole admin.
	//
	// Every booking status and every floor-table state resolves to ONE of five
	// semantic tones (positive | info | warn | danger | neutral). This is the
	// ONLY place pill colours are allowed to live; pages must compose this
	// component rather than re-author per-status CSS.
	//
	//   import StatusPill from '$lib/components/admin/StatusPill.svelte';
	//   <StatusPill status={booking.status} kind="booking" />
	//   <StatusPill status={table.state} kind="floor" size="sm" />
	//
	// Tones map to the --admin-tone-{tone}-bg / --admin-tone-{tone}-fg tokens,
	// defined globally in src/lib/theme/admin.css (imported by the admin shell).

	export type Tone = 'positive' | 'info' | 'warn' | 'danger' | 'neutral';

	/** The canonical status -> tone map. Booking statuses + floor states share
	 *  one table; `seated` is intentionally shared by both kinds. */
	export const STATUS_TONE: Record<string, Tone> = {
		// booking statuses
		pending_payment: 'warn',
		confirmed: 'positive',
		seated: 'positive',
		completed: 'neutral',
		cancelled: 'danger',
		no_show: 'danger',
		// floor states
		free: 'neutral',
		upcoming: 'warn',
		finishing: 'warn',
		overdue: 'danger'
	};

	/** Resolve any status/state key to its tone (defaults to neutral). */
	export function toneFor(status: string): Tone {
		return STATUS_TONE[status] ?? 'neutral';
	}
</script>

<script lang="ts">
	let {
		status,
		kind = 'booking',
		size = 'md'
	}: {
		status: string;
		kind?: 'booking' | 'floor';
		size?: 'sm' | 'md';
	} = $props();

	const tone = $derived(toneFor(status));
	const label = $derived(status.replace(/_/g, ' '));
</script>

<span class="a-pill" data-tone={tone} data-size={size} data-kind={kind}>{label}</span>

<style>
	/* Tone tokens (--admin-tone-*) are defined globally in src/lib/theme/admin.css
	   and imported by the admin shell, so they resolve on every page. */
	.a-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--admin-font, inherit);
		font-weight: 600;
		line-height: 1;
		white-space: nowrap;
		border-radius: var(--admin-radius-pill, 999px);
		text-transform: capitalize;
		/* default = sm metrics; md overrides below */
		font-size: 0.72rem;
		padding: 0.25rem 0.55rem;
	}
	.a-pill[data-size='md'] {
		font-size: 0.78rem;
		padding: 0.32rem 0.7rem;
	}

	.a-pill[data-tone='positive'] {
		background: var(--admin-tone-positive-bg);
		color: var(--admin-tone-positive-fg);
	}
	.a-pill[data-tone='info'] {
		background: var(--admin-tone-info-bg);
		color: var(--admin-tone-info-fg);
	}
	.a-pill[data-tone='warn'] {
		background: var(--admin-tone-warn-bg);
		color: var(--admin-tone-warn-fg);
	}
	.a-pill[data-tone='danger'] {
		background: var(--admin-tone-danger-bg);
		color: var(--admin-tone-danger-fg);
	}
	.a-pill[data-tone='neutral'] {
		background: var(--admin-tone-neutral-bg);
		color: var(--admin-tone-neutral-fg);
	}
</style>
