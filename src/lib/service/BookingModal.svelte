<script lang="ts">
	// Shared new-reservation modal (Floor ↔ Diary parity).
	//
	// A focused, complete create form: party pills → search availability (posts the
	// host's ?/slots) → pick a slot from the grid → optional table pins + diner details
	// + duration → create (posts the host's ?/create). View-agnostic; the host supplies
	// the query (brand/date), the tables it can pin, and an onCreated(id) callback.
	//
	// This is deliberately simpler than the diary's two-pane staging-aware modal — the
	// floor has no staged-edit layer — but reaches the same endpoints, so a reservation
	// created here is identical to one created from the diary.

	import { postServiceAction } from './postAction';

	type AvailSlot = { time: string; available: boolean; booked: number };
	interface PickableTable {
		id: string;
		label: string;
		seatsMax: number;
	}

	interface Props {
		brand: string;
		date: string;
		/** free/upcoming tables the host offers for manual pinning (optional). */
		tables?: PickableTable[];
		onCreated: (bookingId: string) => void;
		onClose: () => void;
	}
	let { brand, date, tables = [], onCreated, onClose }: Props = $props();

	const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
	let party = $state(2);
	let time = $state('');
	let firstName = $state('');
	let surname = $state('');
	let phone = $state('');
	let email = $state('');
	let notes = $state('');
	let durationMin = $state(0);
	let pinned = $state<string[]>([]);
	let addPick = $state('');

	let slots = $state<AvailSlot[]>([]);
	let searched = $state(false);
	let searching = $state(false);
	let busy = $state(false);
	let error = $state('');

	const q = $derived(`brand=${brand}`);
	const pinnedSeats = $derived(
		pinned.reduce((n, id) => n + (tables.find((t) => t.id === id)?.seatsMax ?? 0), 0)
	);

	async function search() {
		searching = true;
		error = '';
		const { ok, data } = await postServiceAction('slots', q, {
			date,
			partySize: String(party)
		});
		searching = false;
		searched = true;
		slots = ok && Array.isArray(data?.slots) ? (data!.slots as AvailSlot[]) : [];
	}
	function addTable() {
		if (addPick && !pinned.includes(addPick)) pinned = [...pinned, addPick];
		addPick = '';
	}
	function removeTable(id: string) {
		pinned = pinned.filter((t) => t !== id);
	}

	async function submit() {
		if (busy) return;
		if (!time) {
			error = 'Pick a time.';
			return;
		}
		if (party < 1) {
			error = 'Party size must be at least 1.';
			return;
		}
		busy = true;
		error = '';
		const name = `${firstName} ${surname}`.trim();
		const fields: Record<string, string> = { date, time, partySize: String(party) };
		if (pinned.length) fields.tableIds = pinned.join(',');
		if (name) fields.name = name;
		if (phone) fields.phone = phone;
		if (email) fields.email = email;
		if (notes) fields.specialRequests = notes;
		if (durationMin >= 15) fields.durationMinutes = String(durationMin);
		const { ok, data, error: err } = await postServiceAction('create', q, fields);
		busy = false;
		if (!ok) {
			error = err ?? 'Could not create the booking.';
			return;
		}
		onCreated(typeof data?.created === 'string' ? data.created : '');
	}
</script>

<button type="button" class="qc-backdrop" aria-label="Close" onclick={onClose}></button>
<div class="qc bm" role="dialog" aria-modal="true" aria-label="New booking">
	<header class="qc-head">
		<strong>New booking</strong>
		<button type="button" class="pop-x" onclick={onClose} aria-label="Close">×</button>
	</header>

	<div class="bm-body">
		<div class="bm-field">
			<span class="bm-lbl">Party size</span>
			<div class="bm-pills">
				{#each PARTY_SIZES as n (n)}
					<button
						type="button"
						class="pill"
						class:on={party === n}
						onclick={() => {
							party = n;
							searched = false;
						}}>{n}</button
					>
				{/each}
			</div>
		</div>

		<button type="button" class="bm-search" disabled={searching} onclick={search}>
			{searching ? 'Searching…' : 'Search availability'}
		</button>

		{#if searched}
			{#if slots.length}
				<div class="bm-slots">
					{#each slots as s (s.time)}
						<button
							type="button"
							class="slot"
							class:on={time === s.time}
							class:full={!s.available}
							disabled={!s.available}
							onclick={() => (time = s.time)}
						>
							{s.time}
							<small>{s.booked}</small>
						</button>
					{/each}
				</div>
			{:else}
				<p class="bm-empty">No availability for {party} that day.</p>
			{/if}
		{/if}

		<div class="bm-grid">
			<label class="bm-fld">
				<span>First name</span>
				<input bind:value={firstName} placeholder="First" />
			</label>
			<label class="bm-fld">
				<span>Surname</span>
				<input bind:value={surname} placeholder="Surname" />
			</label>
			<label class="bm-fld">
				<span>Phone</span>
				<input bind:value={phone} placeholder="Phone" />
			</label>
			<label class="bm-fld">
				<span>Email</span>
				<input bind:value={email} type="email" placeholder="Email" />
			</label>
			<label class="bm-fld">
				<span>Duration (min, optional)</span>
				<input bind:value={durationMin} type="number" min="0" step="15" placeholder="auto" />
			</label>
		</div>

		{#if tables.length}
			<div class="bm-field">
				<span class="bm-lbl">Pin table(s) — optional (else auto-allocated)</span>
				<div class="bm-chips">
					{#each pinned as id (id)}
						<span class="chip">
							{tables.find((t) => t.id === id)?.label ?? id}
							<button type="button" aria-label="Remove" onclick={() => removeTable(id)}>×</button>
						</span>
					{:else}
						<span class="chip-empty">Auto-allocate</span>
					{/each}
				</div>
				<div class="bm-addrow">
					<select bind:value={addPick}>
						<option value="">Add a table…</option>
						{#each tables as t (t.id)}
							{#if !pinned.includes(t.id)}<option value={t.id}>{t.label} ({t.seatsMax})</option>{/if}
						{/each}
					</select>
					<button type="button" class="bm-addbtn" disabled={!addPick} onclick={addTable}>Add</button>
					{#if pinned.length}<span class="bm-seats" class:bad={pinnedSeats < party}
							>{pinnedSeats} seats</span
						>{/if}
				</div>
			</div>
		{/if}

		<label class="bm-fld bm-notes">
			<span>Notes / special requests</span>
			<textarea bind:value={notes} rows="2" placeholder="e.g. window table, allergy…"></textarea>
		</label>

		{#if error}<p class="bm-err">{error}</p>{/if}
	</div>

	<div class="bm-actions">
		<button type="button" class="btn ghost" onclick={onClose}>Cancel</button>
		<button type="button" class="btn primary" disabled={busy || !time} onclick={submit}>
			{busy ? 'Creating…' : 'Create booking'}
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
		width: 520px;
		max-width: 94vw;
		max-height: 90vh;
		overflow: auto;
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: 12px;
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.3);
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
	.pop-x {
		border: none;
		background: transparent;
		color: inherit;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.2rem;
	}
	.bm-body {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		padding: 0.9rem;
	}
	.bm-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.bm-lbl {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--admin-muted);
	}
	.bm-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.pill {
		min-width: 2rem;
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		background: var(--admin-surface);
		color: var(--admin-fg, inherit);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.pill.on {
		background: var(--admin-primary);
		color: var(--admin-surface);
		border-color: var(--admin-primary);
	}
	.bm-search {
		align-self: flex-start;
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--admin-primary);
		border-radius: 6px;
		background: var(--admin-surface);
		color: var(--admin-primary);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.bm-search:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.bm-slots {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4.2rem, 1fr));
		gap: 0.3rem;
		max-height: 9rem;
		overflow: auto;
	}
	.slot {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.3rem 0.2rem;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		background: var(--admin-surface);
		color: var(--admin-fg, inherit);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.slot small {
		font-size: 0.62rem;
		color: var(--admin-muted);
	}
	.slot.on {
		background: var(--admin-primary);
		color: var(--admin-surface);
		border-color: var(--admin-primary);
	}
	.slot.on small {
		color: color-mix(in srgb, var(--admin-surface) 80%, transparent);
	}
	.slot.full {
		opacity: 0.4;
		cursor: default;
	}
	.bm-empty {
		margin: 0;
		font-size: 0.82rem;
		color: var(--admin-muted);
	}
	.bm-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.bm-fld {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.78rem;
	}
	.bm-fld span {
		color: var(--admin-muted);
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.bm-fld input,
	.bm-fld textarea,
	.bm-addrow select {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		background: var(--admin-surface);
		color: var(--admin-fg, inherit);
		font: inherit;
		font-size: 0.82rem;
		box-sizing: border-box;
	}
	.bm-notes {
		grid-column: 1 / -1;
	}
	.bm-notes textarea {
		resize: vertical;
	}
	.bm-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		min-height: 1.8rem;
		align-items: center;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.3rem 0.15rem 0.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--admin-primary) 14%, var(--admin-surface));
		border: 1px solid color-mix(in srgb, var(--admin-primary) 35%, var(--admin-border));
		font-size: 0.8rem;
	}
	.chip button {
		border: none;
		background: none;
		color: var(--admin-muted);
		cursor: pointer;
		font-size: 0.95rem;
		line-height: 1;
		padding: 0;
	}
	.chip-empty {
		color: var(--admin-muted);
		font-size: 0.82rem;
	}
	.bm-addrow {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.35rem;
	}
	.bm-addrow select {
		width: auto;
		flex: 1;
	}
	.bm-addbtn {
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		background: var(--admin-surface-2);
		color: var(--admin-fg, inherit);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.bm-addbtn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.bm-seats {
		font-size: 0.78rem;
		color: var(--admin-muted);
	}
	.bm-seats.bad {
		color: var(--admin-tone-danger-fg, #c0392b);
	}
	.bm-err {
		margin: 0;
		font-size: 0.78rem;
		color: var(--admin-tone-danger-fg, #c0392b);
	}
	.bm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.7rem 0.9rem;
		border-top: 1px solid var(--admin-border);
	}
	.btn {
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--admin-primary);
		border-radius: 6px;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		background: var(--admin-primary);
		color: var(--admin-surface);
	}
	.btn.ghost {
		background: var(--admin-surface-2);
		color: var(--admin-fg, inherit);
		border-color: var(--admin-border);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
