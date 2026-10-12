<script lang="ts" module>
	// Cancellation reasons mirror the server's CANCELLATION_REASONS, which in turn
	// mirror the owner's ResDiary "Cancellation Reasons" settings screen — same
	// wording, same order. KEEP THE TWO LISTS IN STEP; the server resolves the label
	// for the cancellation report from its own copy.
	//
	// NO REASON CHARGES A CARD. Cancelling and marking a no-show never touch the
	// card (see payments.settleNoShowMoney); the "Card Manually Charged" reasons
	// RECORD that a manager took the fee by hand from the booking's payment panel.
	// Picking one does not charge anything.
	//
	// A no-show reason is a distinct status in our model, so the host routes it to
	// its no-show action rather than a plain cancel; `blockCustomer` also blocks the
	// guest online.
	export const CANCEL_REASONS: {
		code: string;
		label: string;
		noShow?: boolean;
		blockCustomer?: boolean;
	}[] = [
		{ code: 'illness', label: 'Illness' },
		{ code: 'competitor', label: 'One of party wished to go to competitor' },
		{ code: 'change_of_plans', label: 'Change of plans' },
		{ code: 'call_off', label: 'Call off from within party or group' },
		{ code: 'postponed', label: 'Postponed to a future date or time' },
		{ code: 'bad_experience', label: 'Bad Experience' },
		{ code: 'no_show_block', label: 'No Show and block user', noShow: true, blockCustomer: true },
		{ code: 'operator_error', label: 'Operator Error' },
		{ code: 'no_show', label: 'No Show and do not block user', noShow: true },
		{ code: 'online_cancellation', label: 'Online Cancellation' },
		{ code: 'covid', label: 'Covid 19' },
		{ code: 'bad_weather', label: 'Bad Weather' },
		{ code: 'late_cancel_charged', label: 'Late cancellation - Card Manually Charged' },
		{ code: 'no_show_charged', label: 'No show - Card Manually Charged', noShow: true }
	];
	/** Where the picker starts. Never a no-show or card-charged row. */
	export const DEFAULT_CANCEL_REASON = 'change_of_plans';
	export const isNoShowReason = (code: string) =>
		CANCEL_REASONS.find((r) => r.code === code)?.noShow ?? false;
	export const reasonBlocksCustomer = (code: string) =>
		CANCEL_REASONS.find((r) => r.code === code)?.blockCustomer ?? false;
</script>

<script lang="ts">
	// Shared cancel-booking modal (Floor ↔ Diary parity, ResDiary cancel dialog).
	// Reason picker + notify checkbox + a friendly (non-authoritative — the server
	// re-decides per §6) deposit-outcome preview. View-agnostic: takes a BookingView,
	// calls onConfirm(reason, notify); the host routes reason==='no_show' to no-show.

	import DiaryIcon from '$lib/components/admin/DiaryIcon.svelte';
	import { isLateCancellationAt, LATE_CANCELLATION_LABEL } from '$lib/bookings/lateWindow';
	// PocketBase datetimes use a space, not a 'T' — only V8 parses that, so a plain
	// new Date() on one is Invalid Date on iOS. See $lib/bookings/datetime.
	import { parseBookingDate } from '$lib/bookings/datetime';
	import type { BookingView } from './bookingView';

	interface Props {
		booking: BookingView;
		error?: string;
		onConfirm: (reason: string, notify: boolean) => void;
		onClose: () => void;
	}
	let { booking, error = '', onConfirm, onClose }: Props = $props();

	let reason = $state(DEFAULT_CANCEL_REASON);
	let notify = $state(true);

	const fmt = (iso: string) =>
		parseBookingDate(iso)?.toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/London'
		}) ?? '—';
	// Late = inside the §6 window → an already-paid deposit is kept rather than
	// refunded. (Shared constant: this used to hard-code 8h while the server used
	// 12, so the dialog promised refunds the server didn't make.)
	const isLate = $derived.by(() => {
		const start = Date.parse(booking.startsAt ?? '');
		if (Number.isNaN(start)) return false;
		return isLateCancellationAt(start, Date.now());
	});
	const hasDeposit = $derived((booking.paymentStatus ?? 'none') !== 'none');
	const noShow = $derived(isNoShowReason(reason));
	const blocks = $derived(reasonBlocksCustomer(reason));
	// A card on file is never charged by this dialog — only an already-PAID deposit
	// has an outcome to preview here. `paymentStatus` doesn't distinguish the two,
	// so fall back to the booking's payment kind when the view carries one.
	const cardOnFile = $derived(booking.paymentKind === 'noshow_hold');
	/** "£20" when we know the amount, else a bare word the sentences still read with. */
	const money = $derived(
		booking.paymentAmount ? `£${(booking.paymentAmount / 100).toFixed(2)}` : ''
	);
</script>

<button type="button" class="qc-backdrop" aria-label="Close" onclick={onClose}></button>
<div class="qc cx" role="dialog" aria-modal="true" aria-label="Cancel booking">
	<header class="qc-head cx-head">
		<strong>Cancel booking</strong>
		<button type="button" class="pop-x" onclick={onClose} aria-label="Close">×</button>
	</header>
	<p class="cx-ctx">
		<strong>{booking.guestName || 'Guest'}</strong> · party {booking.partySize} ·
		{fmt(booking.startsAt)}{#if booking.tableLabels?.length}
			· {booking.tableLabels.join(', ')}{/if}
	</p>

	<label class="cm-field">
		<span>Cancellation reason</span>
		<select bind:value={reason}>
			{#each CANCEL_REASONS as r (r.code)}
				<option value={r.code}>{r.label}</option>
			{/each}
		</select>
	</label>

	{#if !noShow}
		<label class="cx-notify">
			<input type="checkbox" bind:checked={notify} />
			<span>Email the guest a cancellation</span>
		</label>
	{/if}

	<!-- What happens to the money. NOTHING HERE CHARGES A CARD — the only outcomes
	     this dialog can produce are "a paid deposit is kept" and "a paid deposit is
	     refunded". A card on file is left alone, and a manager takes the fee (or
	     doesn't) afterwards from the booking's payment panel. -->
	<p class="cx-deposit" class:warn={noShow || (hasDeposit && isLate && !cardOnFile)}>
		{#if noShow}
			Marks the party a <strong>no-show</strong> and puts them on the no-show report. No
			cancellation email is sent.
			{#if cardOnFile}
				The card on file is <strong>not charged</strong> — to take the {money} fee, open the
				booking and charge it there.
			{/if}
			{#if blocks}
				The guest is also <strong>blocked from booking online</strong> (staff can still book them
				in; a manager can lift it on the guest's profile).
			{/if}
		{:else if cardOnFile}
			<DiaryIcon name="check" size={13} /> The {money} card guarantee is
			<strong>not charged</strong> — cancelling never bills a card. Charge it from the booking if
			you need to.
		{:else if hasDeposit}
			{#if isLate}
				⚠ Late cancellation (under {LATE_CANCELLATION_LABEL}) — the {money} deposit already paid
				is <strong>not refunded</strong>, per policy.
			{:else}
				<DiaryIcon name="check" size={13} /> In-time cancellation — the {money} deposit is
				<strong>refunded</strong> per policy.
			{/if}
		{:else}
			No deposit on this booking — nothing to charge or refund.
		{/if}
	</p>

	{#if error}<p class="pop-flash err">{error}</p>{/if}
	<div class="cm-actions">
		<button type="button" class="btn ghost" onclick={onClose}>Keep booking</button>
		<button type="button" class="btn danger" onclick={() => onConfirm(reason, notify)}>
			{#if noShow}
				<DiaryIcon name="noshow" size={13} />
				{blocks ? 'Mark no-show & block' : 'Mark no-show'}
			{:else}
				<DiaryIcon name="trash" size={13} /> Cancel booking
			{/if}
		</button>
	</div>
</div>

<style>
	.qc-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(20, 14, 8, 0.32);
		z-index: 60;
		border: none;
		padding: 0;
		cursor: default;
	}
	.qc {
		position: fixed;
		z-index: 61;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 460px;
		max-width: 94vw;
		max-height: 90vh;
		overflow: auto;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.3);
	}
	.cx {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 0 0.9rem 0.9rem;
	}
	.qc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.7rem 0.9rem;
		background: var(--admin-surface-2);
		border-bottom: 1px solid var(--admin-border);
	}
	.qc-head strong {
		font-size: 1rem;
	}
	.cx > .cx-head {
		margin: 0 -0.9rem 0.2rem;
	}
	.cx-head strong {
		color: var(--admin-tone-danger-fg, #c0392b);
	}
	.pop-x {
		border: none;
		background: transparent;
		color: inherit;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.2rem;
	}
	.cx-ctx {
		margin: 0;
		font-size: 0.82rem;
		color: var(--admin-fg, inherit);
	}
	.cm-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.78rem;
	}
	.cm-field span {
		color: var(--admin-muted);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.cm-field select {
		width: 100%;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		background: var(--admin-surface);
		color: var(--admin-fg, inherit);
		font: inherit;
		font-size: 0.82rem;
	}
	.cx-notify {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.cx-notify input {
		width: 16px;
		height: 16px;
		accent-color: var(--admin-primary);
	}
	.cx-deposit {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
		padding: 0.5rem 0.6rem;
		border-radius: 6px;
		font-size: 0.76rem;
		line-height: 1.35;
		background: var(--admin-surface-2);
		color: var(--admin-muted);
	}
	.cx-deposit.warn {
		background: color-mix(in srgb, var(--admin-tone-danger-fg, #c0392b) 12%, var(--admin-surface));
		color: var(--admin-tone-danger-fg, #c0392b);
	}
	.cm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.btn {
		padding: 0.4rem 0.8rem;
		border: 1px solid var(--admin-primary);
		border-radius: 6px;
		font-size: 0.78rem;
		cursor: pointer;
		background: var(--admin-primary);
		color: var(--admin-surface);
	}
	.btn.ghost {
		background: var(--admin-surface-2);
		color: var(--admin-fg, inherit);
		border-color: var(--admin-border);
	}
	.btn.danger {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: var(--admin-tone-danger-fg, #c0392b);
		border-color: var(--admin-tone-danger-fg, #c0392b);
		color: #fff;
		font-weight: 600;
	}
	.btn.danger:hover {
		background: #a5301f;
		border-color: #a5301f;
	}
	.pop-flash {
		margin: 0;
		font-size: 0.74rem;
	}
	.pop-flash.err {
		color: var(--admin-tone-danger-fg, #c0392b);
	}
</style>
