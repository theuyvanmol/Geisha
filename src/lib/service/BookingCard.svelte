<script lang="ts" module>
	// Actions a BookingCard can request. The host maps each to its own form endpoint
	// + optimistic patch. Payload carriers (tableIds, covers) travel on the second arg.
	export type CardAction =
		| 'edit-comments'
		| 'reset-arrival'
		| 'cancel'
		| 'no-show'
		| 'print'
		| 'seat'
		| 'partial-seat'
		| 'waiting-bar'
		| 'table-ready'
		| 'clear'
		| 'confirm'
		| 'reallocate'
		| 'resend'
		| 'covers' // payload: { covers: number }
		| 'view-customer' // payload: { customerId }
		| 'view-booking'
		| 'history'
		| 'close';

	export interface CardBusy {
		status?: boolean; // arrival/status writes in flight (greys the status buttons)
		covers?: boolean;
		realloc?: boolean;
		resend?: boolean;
	}
</script>

<script lang="ts">
	// Shared ResDiary-style booking detail card (Floor ↔ Diary parity).
	//
	// Lifted from the diary's inline popover so BOTH service views render the identical
	// card: quick-action toolbar, left status context-menu, 2-column detail grid,
	// covers stepper, notes/allergies, quick-status row, confirm/reallocate, and the
	// bottom action buttons. It is fully view-agnostic — it takes a normalized
	// `BookingView` and a single `dispatch(action, payload)` the host wires to its own
	// endpoints/optimistic patches — so it carries no diary/floor-specific state.
	//
	// It renders ONLY the card + toolbar + status-menu. Positioning (the fixed
	// `.pop-cluster` anchor) and the resend/error flash lines are left to the host, so
	// each view controls where the card floats and how it surfaces messages.

	import DiaryIcon from '$lib/components/admin/DiaryIcon.svelte';
	import { channelColour } from '$lib/diary/colourScheme';
	// PocketBase datetimes use a space, not a 'T' — only V8 parses that, so a plain
	// new Date() on one is Invalid Date on iOS. See $lib/bookings/datetime.
	import { parseBookingDate } from '$lib/bookings/datetime';
	import type { BookingView } from './bookingView';

	interface Props {
		booking: BookingView;
		brand: string;
		busy?: CardBusy;
		/** whether the booking can be reallocated/auto-assigned (movable). Default true. */
		movable?: boolean;
		/** whether the left status context-menu is open (host-controlled for keyboard). */
		statusMenuOpen?: boolean;
		onToggleStatusMenu?: (open: boolean) => void;
		dispatch: (action: CardAction, payload?: Record<string, unknown>) => void;
	}
	let {
		booking,
		brand,
		busy = {},
		movable = true,
		statusMenuOpen = $bindable(false),
		onToggleStatusMenu,
		dispatch
	}: Props = $props();

	const fmt = (iso: string) =>
		parseBookingDate(iso)?.toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/London'
		}) ?? '—';
	const fmtDateTime = (iso: string) =>
		parseBookingDate(iso)?.toLocaleString('en-GB', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/London'
		}) ?? '—';

	// Arrival state drives the header colour + label. Derived from status + floorStatus
	// so a normalized floor booking (no diary "arrival" field) colours correctly too.
	const arrival = $derived.by(() => {
		const s = booking.status;
		if (s === 'seated') return 'arrived';
		if (s === 'cancelled') return 'left';
		if (s === 'no_show') return 'no_show';
		if (booking.floorStatus === 'waiting_bar') return 'waiting_bar';
		if (booking.floorStatus === 'table_ready') return 'table_ready';
		return 'unarrived';
	});
	const ARRIVAL_LABEL: Record<string, string> = {
		unarrived: 'To arrive',
		late: 'Late',
		arrived: 'Arrived',
		left: 'Left / finished',
		waiting_bar: 'Waiting in bar',
		table_ready: 'Table ready',
		partially_seated: 'Partially seated',
		no_show: 'No-show'
	};

	function toggleMenu() {
		statusMenuOpen = !statusMenuOpen;
		onToggleStatusMenu?.(statusMenuOpen);
	}
	// Partial-seat: seat all but the LAST table of a multi-table booking (single-table
	// falls back to a full seat) — the host action re-derives partial vs full.
	function partialSeat() {
		const ids = booking.tableIds ?? [];
		const subset = ids.length > 1 ? ids.slice(0, -1) : ids;
		dispatch('partial-seat', { tableIds: subset.join(',') });
	}
</script>

<!-- ResDiary quick-action toolbar — the icon strip above the card. -->
<div class="pop-toolbar">
	<a
		class="tb"
		href="/admin/bookings/{booking.bookingId}?brand={brand}"
		title="Edit booking"
		aria-label="Edit booking"><DiaryIcon name="edit" /></a
	>
	<button type="button" class="tb" title="Edit comments" aria-label="Edit comments"
		onclick={() => dispatch('edit-comments')}><DiaryIcon name="comment" /></button
	>
	<button
		type="button"
		class="tb"
		title="Reset arrival (un-seat)"
		aria-label="Reset arrival"
		disabled={busy.status}
		onclick={() => dispatch('reset-arrival')}><DiaryIcon name="reset" /></button
	>
	<button
		type="button"
		class="tb tb-danger"
		title="Delete / cancel booking"
		aria-label="Delete booking"
		disabled={busy.status}
		onclick={() => dispatch('cancel')}><DiaryIcon name="trash" /></button
	>
	<button
		type="button"
		class="tb"
		class:on={arrival === 'table_ready'}
		title="Mark table ready (hold for this guest)"
		aria-label="Table ready"
		disabled={busy.status}
		onclick={() => dispatch('table-ready')}><DiaryIcon name="lock" /></button
	>
	<button
		type="button"
		class="tb tb-noshow"
		title="No-show"
		aria-label="No-show"
		disabled={busy.status}
		onclick={() => dispatch('no-show')}><DiaryIcon name="noshow" /></button
	>
	<button type="button" class="tb" title="Print booking slip" aria-label="Print"
		onclick={() => dispatch('print')}><DiaryIcon name="print" /></button
	>
	<button
		type="button"
		class="tb tb-menu"
		class:on={statusMenuOpen}
		title="Status / more"
		aria-label="More actions"
		aria-expanded={statusMenuOpen}
		onclick={toggleMenu}><DiaryIcon name="more" /></button
	>
</div>

<!-- left status context menu (ResDiary): arrival states + unallocate + W8List -->
{#if statusMenuOpen}
	<div class="status-menu" role="menu" aria-label="Set status">
		<button type="button" role="menuitem" class="sm-item" disabled={busy.status}
			onclick={() => dispatch('seat')}>
			<span class="sm-dot arr-arrived"></span> Fully Seated
		</button>
		<button
			type="button"
			role="menuitem"
			class="sm-item"
			disabled={busy.status || (booking.tableIds?.length ?? 0) < 1}
			onclick={partialSeat}
		>
			<span class="sm-dot arr-partially_seated"></span> Partially Seated
		</button>
		<button type="button" role="menuitem" class="sm-item" disabled={busy.status}
			onclick={() => dispatch('waiting-bar')}>
			<span class="sm-dot arr-waiting_bar"></span> Waiting in Bar
		</button>
		<button type="button" role="menuitem" class="sm-item" disabled={busy.status}
			onclick={() => dispatch('table-ready')}>
			<span class="sm-dot arr-table_ready"></span> Table Ready
		</button>
		<button type="button" role="menuitem" class="sm-item" disabled={busy.status}
			onclick={() => dispatch('clear')}>
			<span class="sm-dot arr-left"></span> Finished / Left
		</button>
		<div class="sm-sep"></div>
		<button type="button" role="menuitem" class="sm-item" onclick={() => dispatch('edit-comments')}>
			<span class="sm-ico"><DiaryIcon name="comment" /></span> Edit Comments
		</button>
		<button type="button" role="menuitem" class="sm-item" disabled={busy.status}
			onclick={() => dispatch('reset-arrival')}>
			<span class="sm-ico"><DiaryIcon name="reset" /></span> Unallocate
		</button>
	</div>
{/if}

<div class="pop" role="dialog" aria-label="Booking details">
	<div class="pop-head arr-{arrival}">
		<strong>{booking.guestName}</strong>
		<span class="pop-status">{ARRIVAL_LABEL[arrival] ?? booking.status}</span>
		<button type="button" class="pop-x" onclick={() => dispatch('close')} aria-label="Close"
			>×</button
		>
	</div>
	<div class="pop-grid">
		<div class="col">
			<div class="f"><span class="fl"><DiaryIcon name="hash" size={12} /> Ref#</span>{booking.ref}</div>
			{#if booking.phone}<div class="f">
					<span class="fl"><DiaryIcon name="phone" size={12} /> Phone</span>{booking.phone}
				</div>{/if}
			{#if booking.email}<div class="f">
					<span class="fl"><DiaryIcon name="mail" size={12} /> Email</span>{booking.email}
				</div>{/if}
			{#if booking.bookedOn}<div class="f">
					<span class="fl"><DiaryIcon name="clock" size={12} /> Booked on</span>{fmtDateTime(
						booking.bookedOn
					)}
				</div>{/if}
			<div class="f">
				<span class="fl"><DiaryIcon name="arrive" size={12} /> Arrival</span>{fmt(booking.startsAt)}
			</div>
			<div class="f">
				<span class="fl"><DiaryIcon name="leave" size={12} /> Leave</span>{fmt(booking.endsAt)}{#if booking.leaveTimeConfirmed}
					<em> · confirmed</em>{/if}
			</div>
		</div>
		<div class="col">
			<div class="f">
				<span class="fl"><DiaryIcon name="party" size={12} /> Party</span>
				<span class="covers-edit">
					<button
						type="button"
						class="cv"
						aria-label="Fewer covers"
						disabled={busy.covers || booking.partySize <= 1}
						onclick={() => dispatch('covers', { covers: booking.partySize - 1 })}>−</button
					>
					<strong>{booking.partySize}</strong>
					<button
						type="button"
						class="cv"
						aria-label="More covers"
						disabled={busy.covers}
						onclick={() => dispatch('covers', { covers: booking.partySize + 1 })}>+</button
					>
					{#if busy.covers}<em class="cv-busy">…</em>{/if}
				</span>
			</div>
			<div class="f">
				<span class="fl"><DiaryIcon name="table" size={12} /> Table(s)</span
				>{booking.tableLabels?.join(', ') || '—'}
			</div>
			<div class="f">
				<span class="fl"
					><i class="ch-sq" style="background: {channelColour(booking.channel).bar};"></i> Channel</span
				>{booking.channel}
			</div>
			{#if booking.promotion}<div class="f">
					<span class="fl"><DiaryIcon name="tag" size={12} /> Promotion</span>{booking.promotion}
				</div>{/if}
			{#if booking.menu}<div class="f">
					<span class="fl"><DiaryIcon name="menu" size={12} /> Menu</span>{booking.menu}
				</div>{/if}
			{#if booking.occasion}<div class="f">
					<span class="fl"><DiaryIcon name="occasion" size={12} /> Occasion</span>{booking.occasion}
				</div>{/if}
			<div class="f">
				<span class="fl"><DiaryIcon name="star" size={12} /> Visit</span>{booking.firstVisit
					? '1st visit'
					: 'Returning'}{#if booking.vip}
					· <strong>VIP</strong>{/if}
			</div>
			<div class="f">
				<span class="fl"><DiaryIcon name="check" size={12} /> Confirm</span
				>{booking.confirmAttempts} attempt{booking.confirmAttempts === 1 ? '' : 's'}{#if booking.confirmed}
					· confirmed{/if}
			</div>
		</div>
	</div>
	{#if booking.bookingComments || booking.noteToRestaurant || booking.customerComments || booking.allergies}
		<div class="pop-notes">
			{#if booking.allergies}<p class="allergy">
					<span><DiaryIcon name="allergy" size={12} /> Allergies</span>
					{booking.allergies}
				</p>{/if}
			{#if booking.bookingComments}<p>
					<span><DiaryIcon name="comment" size={12} /> Booking comments</span>
					{booking.bookingComments}
				</p>{/if}
			{#if booking.noteToRestaurant}<p>
					<span><DiaryIcon name="note" size={12} /> Note to restaurant</span>
					{booking.noteToRestaurant}
				</p>{/if}
			{#if booking.customerComments}<p>
					<span><DiaryIcon name="history" size={12} /> Customer history</span>
					{booking.customerComments}
				</p>{/if}
		</div>
	{/if}

	<!-- quick in-service status row (the four most-used, ResDiary-style) -->
	<div class="pop-status-row">
		<button type="button" class="qs" disabled={busy.status} onclick={() => dispatch('seat')}
			title="Seat the party now">Seat</button
		>
		<button type="button" class="qs" disabled={busy.status} onclick={() => dispatch('waiting-bar')}
			title="Waiting in the bar">In&nbsp;bar</button
		>
		<button type="button" class="qs" disabled={busy.status} onclick={() => dispatch('table-ready')}
			title="Table is ready">Table&nbsp;ready</button
		>
		<button type="button" class="qs" disabled={busy.status} onclick={() => dispatch('clear')}
			title="Finished / left">Finished</button
		>
	</div>

	{#if !booking.confirmed}
		<div class="pop-confirm-row">
			<button type="button" class="btn ghost" disabled={busy.status}
				onclick={() => dispatch('confirm')}>Confirm booking</button
			>
			{#if movable}
				<button
					type="button"
					class="btn ghost"
					disabled={busy.realloc}
					title="Let the system pick the best free table"
					onclick={() => dispatch('reallocate')}
					>{busy.realloc ? 'Reallocating…' : 'Reallocate'}</button
				>
			{/if}
		</div>
	{:else if movable}
		<div class="pop-confirm-row">
			<span class="confirmed-tag" title="Confirmed">✓ Confirmed</span>
			<button
				type="button"
				class="btn ghost"
				disabled={busy.realloc}
				title="Let the system pick the best free table"
				onclick={() => dispatch('reallocate')}>{busy.realloc ? 'Reallocating…' : 'Reallocate'}</button
			>
		</div>
	{/if}

	<!-- bottom buttons (ResDiary): Cancel · View Customer · History · View Booking · Resend -->
	<div class="pop-actions">
		<button
			type="button"
			class="btn danger"
			disabled={busy.status}
			title="Delete / cancel this booking"
			onclick={() => dispatch('cancel')}><DiaryIcon name="trash" size={13} /> Cancel booking</button
		>
		<span class="pop-actions-spacer"></span>
		{#if booking.customerId}
			<a class="btn" href="/admin/customers/{booking.customerId}?brand={brand}">View customer</a>
		{/if}
		<a class="btn" href="/admin/bookings/{booking.bookingId}?brand={brand}#history">History</a>
		<a class="btn" href="/admin/bookings/{booking.bookingId}?brand={brand}">View booking</a>
		<button type="button" class="btn" disabled={busy.resend} onclick={() => dispatch('resend')}>
			{busy.resend ? 'Sending…' : 'Resend confirmation'}
		</button>
	</div>
</div>

<style>
	/* --- detail popover (verbatim from the diary so both views match pixel-for-pixel) --- */
	.pop {
		position: relative;
		width: 100%;
		max-height: var(--pop-maxh, 80vh);
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 10px;
		box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
		font-size: 0.8rem;
	}
	.pop-toolbar {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 6px;
		padding: 0.28rem;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		box-shadow: 0 8px 22px rgba(0, 0, 0, 0.2);
		width: fit-content;
	}
	.tb {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: var(--admin-surface-2);
		color: var(--admin-fg, inherit);
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
		text-decoration: none;
		transition:
			background 0.12s,
			border-color 0.12s;
	}
	.tb:hover:not(:disabled) {
		background: var(--admin-primary);
		color: var(--admin-surface);
	}
	.tb:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.tb.on {
		border-color: var(--admin-primary);
		background: var(--admin-primary);
		color: var(--admin-surface);
	}
	.tb-danger:hover:not(:disabled) {
		background: var(--rd-danger-ink);
		color: #fff;
	}
	.tb-noshow {
		font-weight: 700;
	}
	.tb-noshow:hover:not(:disabled) {
		background: #1f1f1f;
		color: #fff;
	}

	.status-menu {
		position: absolute;
		top: 0;
		right: calc(100% + 8px);
		width: 196px;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		box-shadow: 0 12px 30px rgba(0, 0, 0, 0.26);
		padding: 0.3rem;
		z-index: 2;
	}
	.sm-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.42rem 0.5rem;
		border: none;
		background: transparent;
		color: var(--admin-fg, inherit);
		font-size: 0.82rem;
		text-align: left;
		border-radius: 5px;
		cursor: pointer;
	}
	.sm-item:hover:not(:disabled) {
		background: var(--admin-surface-2);
	}
	.sm-item:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.sm-dot {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: var(--bar, #ccc);
		flex: 0 0 auto;
	}
	.sm-ico {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		flex: 0 0 auto;
		opacity: 0.75;
	}
	.sm-sep {
		height: 1px;
		margin: 0.25rem 0.2rem;
		background: var(--admin-border);
	}
	.pop-head {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.7rem;
		background: var(--bar);
		color: var(--bar-ink);
	}
	.pop-head strong {
		font-size: 0.95rem;
	}
	.pop-status {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.85;
	}
	.pop-x {
		margin-left: auto;
		border: none;
		background: transparent;
		color: inherit;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.2rem;
	}
	.pop-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0 0.8rem;
		padding: 0.6rem 0.7rem;
	}
	.f {
		padding: 0.16rem 0;
		border-bottom: 1px solid var(--admin-surface-2);
		overflow-wrap: anywhere;
	}
	.f .fl {
		display: flex;
		align-items: center;
		gap: 0.28rem;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--admin-muted);
	}
	.f .fl :global(.di) {
		opacity: 0.7;
	}
	/* the channel band, same palette as the diary bar's covers square (set inline) */
	.ch-sq {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 2px;
		background: var(--admin-primary);
		vertical-align: middle;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12);
	}
	.f em {
		color: var(--rd-success-ink);
		font-style: normal;
	}
	.covers-edit {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.cv {
		width: 20px;
		height: 20px;
		border: 1px solid var(--admin-border);
		border-radius: 5px;
		background: var(--admin-surface-2);
		color: var(--admin-fg, inherit);
		font-size: 0.9rem;
		line-height: 1;
		cursor: pointer;
	}
	.cv:hover:not(:disabled) {
		background: var(--admin-primary);
		color: var(--admin-surface);
	}
	.cv:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.cv-busy {
		font-style: normal;
		color: var(--admin-muted);
	}
	.pop-notes {
		padding: 0.5rem 0.7rem;
		border-top: 1px solid var(--admin-border);
		background: var(--admin-surface-2);
	}
	.pop-notes p {
		margin: 0 0 0.4rem;
		line-height: 1.35;
	}
	.pop-notes p:last-child {
		margin-bottom: 0;
	}
	.pop-notes span {
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--admin-muted);
		display: flex;
		align-items: center;
		gap: 0.28rem;
	}
	.pop-notes span :global(.di) {
		opacity: 0.75;
	}
	.pop-notes .allergy {
		color: var(--rd-danger-ink);
		font-weight: 600;
	}
	.pop-status-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.3rem;
		padding: 0.5rem 0.7rem;
		border-top: 1px solid var(--admin-border);
	}
	.qs {
		padding: 0.34rem 0.2rem;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		background: var(--admin-surface-2);
		color: var(--admin-fg, inherit);
		font-size: 0.72rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.qs:hover:not(:disabled) {
		background: var(--admin-primary);
		color: var(--admin-surface);
		border-color: var(--admin-primary);
	}
	.qs:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.pop-confirm-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.7rem 0.5rem;
	}
	.confirmed-tag {
		font-size: 0.74rem;
		font-weight: 600;
		color: var(--rd-success-ink);
	}
	.pop-actions {
		padding: 0.55rem 0.7rem;
		border-top: 1px solid var(--admin-border);
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		justify-content: flex-end;
	}
	.btn {
		padding: 0.4rem 0.8rem;
		background: var(--admin-primary);
		color: var(--admin-surface);
		border: 1px solid var(--admin-primary);
		border-radius: 6px;
		text-decoration: none;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.btn.ghost {
		background: var(--admin-surface-2);
		color: var(--admin-fg, inherit);
		border-color: var(--admin-border);
	}
	.btn.ghost:hover:not(:disabled) {
		background: var(--admin-primary);
		color: var(--admin-surface);
		border-color: var(--admin-primary);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.danger {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: var(--rd-danger-dark);
		border-color: var(--rd-danger-dark);
		color: #fff;
		font-weight: 600;
	}
	.btn.danger:hover:not(:disabled) {
		background: var(--rd-danger-ink);
		border-color: var(--rd-danger-ink);
	}
	.pop-actions-spacer {
		flex: 1 1 auto;
	}

	/* arrival palette — drives the header --bar/--bar-ink + the status-menu dots.
	   Same --rd-* tokens the diary grid paints its bars with (admin.css), so a
	   booking's card header is the exact colour of the bar it opened from. */
	.arr-unarrived {
		--bar: var(--rd-unarrived);
		--bar-ink: var(--rd-unarrived-ink);
	}
	.arr-arrived {
		--bar: var(--rd-arrived);
		--bar-ink: var(--rd-arrived-ink);
	}
	.arr-late {
		--bar: var(--rd-late);
		--bar-ink: var(--rd-late-ink);
	}
	.arr-left {
		--bar: var(--rd-left);
		--bar-ink: var(--rd-left-ink);
	}
	.arr-waiting_bar {
		--bar: var(--rd-waiting-bar);
		--bar-ink: var(--rd-waiting-bar-ink);
	}
	.arr-table_ready {
		--bar: var(--rd-table-ready);
		--bar-ink: var(--rd-table-ready-ink);
	}
	.arr-partially_seated {
		--bar: var(--rd-partial);
		--bar-ink: var(--rd-partial-ink);
	}
	.arr-no_show {
		--bar: var(--rd-no-show);
		--bar-ink: var(--rd-no-show-ink);
	}
</style>
