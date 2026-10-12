<script lang="ts">
	// Privacy / cookie / alcohol policy. Every word is editable on the admin
	// Content → Pages tab; `copy` is that override and falls back to the defaults
	// in $lib/data/pages so an un-wired caller still renders the real policy.
	import type { Brand } from '$lib/data/brand';
	import type { PagesContent, BrandInfoContent } from '$lib/content/schema';
	import { getPagesDefaults, fillTokens, paragraphs, tokenSource } from '$lib/data/pages';
	import RichText from './RichText.svelte';

	let {
		brand,
		copy,
		brandInfo
	}: { brand: Brand; copy?: PagesContent['privacy']; brandInfo?: BrandInfoContent } = $props();

	const c = $derived(copy ?? getPagesDefaults(brand.id).privacy);
	const tok = $derived(tokenSource(brand, brandInfo));
	const fill = (s: string) => fillTokens(s, tok);
</script>

<section class="privacy" data-brand={brand.id}>
	<h1>{fill(c.title)}</h1>
	<p class="updated">{fill(c.subtitle)}</p>

	{#each c.sections as section}
		<h2>{fill(section.heading)}</h2>
		{#each paragraphs(fill(section.body)) as para}
			<p><RichText text={para} autolink /></p>
		{/each}
	{/each}
</section>

<style>
	.privacy {
		max-width: 740px;
		margin: 0 auto;
		padding: 3.5rem 1.6rem 5rem;
		color: var(--ink);
		font-family: var(--font-body);
	}
	h1 {
		font-family: var(--font-display);
		font-size: clamp(2.2rem, 5vw, 3.2rem);
		margin: 0 0 0.4rem;
		font-weight: 500;
	}
	.updated {
		font-style: italic;
		color: var(--ink-faint);
		margin: 0 0 2rem;
	}
	h2 {
		font-family: var(--font-display);
		font-size: 1.5rem;
		color: var(--accent);
		margin: 2rem 0 0.6rem;
		font-weight: 500;
	}
	p {
		font-size: 1.08rem;
		line-height: 1.7;
		color: var(--ink-soft);
		margin: 0 0 1rem;
		/* A pasted URL or long address must wrap, not widen the page. */
		overflow-wrap: break-word;
	}
	/* The links are rendered by <RichText>, a child component, so a scoped bare
	   `a` never reached them and they fell back to the UA's default blue —
	   near-invisible on the dark ground. :global crosses the boundary (the same
	   fix as ContactPanel's .note). */
	p :global(a) {
		color: var(--accent);
		text-underline-offset: 0.18em;
	}
	/* Phones: this is a page of reading. 17px at 1.7 gave a ~38-character measure
	   and a screen and a half per section; 16px at 1.65 reads properly and roughly
	   halves the scroll. The padding matches the other interior panels. */
	@media (max-width: 560px) {
		.privacy {
			padding: 2rem 1.25rem 3.5rem;
		}
		h1 {
			line-height: 1.15;
			margin-bottom: 0.6rem;
			/* two even lines rather than "Policy" alone on the second */
			text-wrap: balance;
		}
		p {
			font-size: 1rem;
			line-height: 1.65;
			text-wrap: pretty;
		}
		.updated {
			font-size: 0.95rem;
			line-height: 1.5;
			margin-bottom: 1.6rem;
			text-wrap: balance;
		}
		h2 {
			font-size: 1.35rem;
			line-height: 1.25;
			margin: 1.8rem 0 0.5rem;
		}
	}
</style>
