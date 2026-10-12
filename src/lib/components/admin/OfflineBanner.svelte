<script lang="ts">
	// "This screen is not live" — the one thing a restaurant must never have to guess.
	//
	// A board that has silently stopped updating looks exactly like a quiet board.
	// That ambiguity is what sends staff back to hitting refresh and, worse, what lets
	// someone seat a table off information that stopped being true twenty minutes ago.
	// So when the server is unreachable this says so, in red, across the top, with a
	// route to the one screen that still works.
	//
	// It is driven by $lib/admin/connection.svelte.ts, which probes the origin rather
	// than trusting navigator.onLine — a till on the restaurant's wifi with the
	// broadband down reports itself perfectly online.

	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { connection } from '$lib/admin/connection.svelte';

	onMount(() => connection.start());

	// Already on the offline sheet? Then the banner would only be telling someone
	// what the page they are reading says in its own header.
	const onRunSheet = $derived(page.url.pathname.startsWith('/admin/offline'));
</script>

{#if connection.offline && !onRunSheet}
	<div class="offline-bar" role="status" aria-live="assertive">
		<span class="dot" aria-hidden="true"></span>
		<span class="msg">
			<strong>No connection.</strong>
			This screen is not updating and changes cannot be saved.
		</span>
		<a class="cta" href="/admin/offline">Open the offline run sheet</a>
		<button
			type="button"
			class="retry"
			disabled={connection.checking}
			onclick={() => connection.probe(true)}
		>
			{connection.checking ? 'Checking…' : 'Retry'}
		</button>
	</div>
{/if}

<style>
	.offline-bar {
		position: sticky;
		top: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.55rem 0.9rem;
		background: #9d2f14;
		color: #fff;
		font-size: 0.9rem;
		line-height: 1.3;
	}
	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: #fff;
		flex: none;
		/* A slow pulse reads as "still trying", not as an alarm to be dismissed. */
		animation: pulse 2s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
		}
	}
	.msg {
		flex: 1 1 16rem;
	}
	.cta {
		color: #fff;
		text-decoration: underline;
		white-space: nowrap;
	}
	.retry {
		font: inherit;
		color: #fff;
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.6);
		border-radius: 999px;
		padding: 0.2rem 0.75rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.retry:disabled {
		opacity: 0.6;
		cursor: default;
	}
	@media print {
		.offline-bar {
			display: none;
		}
	}
</style>
