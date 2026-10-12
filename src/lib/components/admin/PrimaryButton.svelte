<script lang="ts">
	// PrimaryButton — the canonical admin action button.
	//
	// Three variants share one set of metrics so actions line up across pages:
	//   primary — solid --admin-primary fill (default call-to-action)
	//   ghost   — bordered, transparent fill (secondary action)
	//   danger  — solid --admin-danger fill (destructive action)
	//
	//   import PrimaryButton from '$lib/components/admin/PrimaryButton.svelte';
	//   <PrimaryButton onclick={save}>Save</PrimaryButton>
	//   <PrimaryButton variant="danger" type="submit">Delete</PrimaryButton>

	import type { Snippet } from 'svelte';

	let {
		type = 'button',
		disabled = false,
		variant = 'primary',
		onclick,
		children
	}: {
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		variant?: 'primary' | 'ghost' | 'danger';
		onclick?: (event: MouseEvent) => void;
		children?: Snippet;
	} = $props();
</script>

<button class="a-btn" data-variant={variant} {type} {disabled} {onclick}>
	{@render children?.()}
</button>

<style>
	.a-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--admin-space-2);
		font: inherit;
		font-family: var(--admin-font, inherit);
		font-weight: 600;
		font-size: 0.85rem;
		line-height: 1;
		padding: 0.5rem 0.95rem;
		border: 1px solid transparent;
		border-radius: var(--admin-radius);
		cursor: pointer;
		transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
	}
	.a-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.a-btn[data-variant='primary'] {
		background: var(--admin-primary);
		color: var(--admin-primary-ink);
	}
	.a-btn[data-variant='primary']:not(:disabled):hover {
		background: var(--admin-accent);
		color: var(--admin-accent-ink);
	}

	.a-btn[data-variant='ghost'] {
		background: transparent;
		color: var(--admin-ink);
		border-color: var(--admin-border);
	}
	.a-btn[data-variant='ghost']:not(:disabled):hover {
		background: var(--admin-surface-2);
	}

	.a-btn[data-variant='danger'] {
		background: var(--admin-danger);
		color: var(--admin-primary-ink);
	}
	.a-btn[data-variant='danger']:not(:disabled):hover {
		filter: brightness(0.92);
	}
</style>
