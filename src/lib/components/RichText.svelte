<script lang="ts">
	// Renders editable copy with *em* / _underline_ emphasis as real <em>/<u>
	// elements — never {@html}, so staff input can't inject markup. See richText.ts.
	//
	// `autolink` additionally turns bare email addresses into mailto: links. The
	// href is built here from the matched address, never taken from the input, so
	// the editor can't supply a scheme (no javascript: etc).
	import { parseRich, parseRichLinked } from '$lib/content/richText';

	let { text, autolink = false }: { text: string; autolink?: boolean } = $props();
	const segments = $derived(autolink ? parseRichLinked(text) : parseRich(text));
</script>

{#each segments as seg}{#if seg.href}<a href={seg.href}>{seg.text}</a>{:else if seg.em}<em>{seg.text}</em>{:else if seg.u}<u>{seg.text}</u>{:else}{seg.text}{/if}{/each}
