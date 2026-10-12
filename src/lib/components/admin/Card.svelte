<script lang="ts">
	// Card — the standard white admin surface.
	//
	// A neutral container for grouped content: a white surface with a hairline
	// border, token radius and a subtle shadow. An optional `title` renders a
	// small heading above the body; the body is supplied via the default
	// `children` snippet.
	//
	//   import Card from '$lib/components/admin/Card.svelte';
	//   <Card title="Booking policy">…content…</Card>
	//   <Card>{#snippet children()}…{/snippet}</Card>

	import type { Snippet } from 'svelte';

	let {
		title,
		children
	}: {
		title?: string;
		children?: Snippet;
	} = $props();
</script>

<section class="a-card">
	{#if title}<h2 class="a-card-title">{title}</h2>{/if}
	<div class="a-card-body">
		{@render children?.()}
	</div>
</section>

<style>
	.a-card {
		background: var(--admin-surface);
		border: 1px solid var(--admin-border);
		border-radius: var(--admin-radius-lg);
		box-shadow: var(--admin-shadow-sm);
		padding: var(--admin-space-5);
		color: var(--admin-ink);
		font-family: var(--admin-font, inherit);
	}
	.a-card-title {
		margin: 0 0 var(--admin-space-4);
		font-size: 1rem;
		font-weight: 600;
		color: var(--admin-ink);
	}
	.a-card-body {
		color: var(--admin-ink);
	}
</style>
