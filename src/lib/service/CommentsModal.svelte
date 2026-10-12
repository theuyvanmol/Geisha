<script lang="ts">
	// Shared edit-comments modal (Floor ↔ Diary parity, ResDiary "Edit Comments").
	// Two textareas — booking comments (special requests) + note-to-restaurant (FOH).
	// View-agnostic: seeded from the passed values, calls onSave(comments, note).

	interface Props {
		guestName?: string;
		comments: string;
		noteToRestaurant: string;
		busy?: boolean;
		error?: string;
		onSave: (comments: string, noteToRestaurant: string) => void;
		onClose: () => void;
	}
	let {
		guestName,
		comments = $bindable(''),
		noteToRestaurant = $bindable(''),
		busy = false,
		error = '',
		onSave,
		onClose
	}: Props = $props();
</script>

<button type="button" class="qc-backdrop" aria-label="Close" onclick={onClose}></button>
<div class="qc qc-comments" role="dialog" aria-modal="true" aria-label="Edit comments">
	<header class="qc-head">
		<strong>Edit comments{guestName ? ` — ${guestName}` : ''}</strong>
		<button type="button" class="pop-x" onclick={onClose} aria-label="Close">×</button>
	</header>
	<label class="cm-field">
		<span>Booking comments (special requests)</span>
		<textarea bind:value={comments} rows="3"
			placeholder="e.g. window table, birthday cake at dessert…"></textarea>
	</label>
	<label class="cm-field">
		<span>Note to restaurant (FOH)</span>
		<textarea bind:value={noteToRestaurant} rows="3" placeholder="Internal note for the floor…"
		></textarea>
	</label>
	{#if error}<p class="pop-flash err">{error}</p>{/if}
	<div class="cm-actions">
		<button type="button" class="btn ghost" onclick={onClose}>Cancel</button>
		<button type="button" class="btn primary" disabled={busy}
			onclick={() => onSave(comments, noteToRestaurant)}>{busy ? 'Saving…' : 'Save comments'}</button
		>
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
	.qc-comments {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
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
	.cm-field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.78rem;
		padding: 0 0.9rem;
	}
	.cm-field span {
		color: var(--admin-muted);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.cm-field textarea {
		width: 100%;
		resize: vertical;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--admin-border);
		border-radius: 6px;
		background: var(--admin-surface);
		color: var(--admin-fg, inherit);
		font: inherit;
		font-size: 0.82rem;
		box-sizing: border-box;
	}
	.cm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0 0.9rem 0.9rem;
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
	.btn.primary {
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
	.pop-flash {
		margin: 0;
		padding: 0.4rem 0.9rem;
		font-size: 0.74rem;
	}
	.pop-flash.err {
		color: var(--admin-tone-danger-fg, #c0392b);
	}
</style>
