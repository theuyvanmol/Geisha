<script lang="ts">
	// Field — a labelled form-field wrapper.
	//
	// Stacks a label above the input (supplied via the default `children`
	// snippet) with an optional hint below. `for` ties the label to the input's
	// id so clicking the label focuses the control; pass the same value as the
	// input's `id`.
	//
	//   import Field from '$lib/components/admin/Field.svelte';
	//   <Field label="Email" for="email" hint="We never share it.">
	//     <input id="email" type="email" />
	//   </Field>

	import type { Snippet } from 'svelte';

	let {
		label,
		hint,
		for: htmlFor,
		children
	}: {
		label: string;
		hint?: string;
		for?: string;
		children?: Snippet;
	} = $props();
</script>

<div class="a-field">
	<label class="a-field-label" for={htmlFor}>{label}</label>
	<div class="a-field-control">
		{@render children?.()}
	</div>
	{#if hint}<p class="a-field-hint">{hint}</p>{/if}
</div>

<style>
	.a-field {
		display: flex;
		flex-direction: column;
		gap: var(--admin-space-2);
		font-family: var(--admin-font, inherit);
	}
	.a-field-label {
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--admin-ink);
	}
	.a-field-control {
		display: flex;
		flex-direction: column;
	}
	.a-field-hint {
		margin: 0;
		font-size: 0.78rem;
		color: var(--admin-muted);
		line-height: 1.45;
	}
</style>
