<script lang="ts" module>
	// Tiny, XSS-safe markdown renderer for ASSISTANT replies.
	//
	// The model answers in light markdown — **bold**, *italic*, `code`, "- " /
	// "• " bullet lists, "1." numbered lists, blank-line-separated paragraphs. The
	// chat surfaces were rendering that as raw text ("**1 booking**"). This parses
	// it into a block structure and renders through normal Svelte elements/text —
	// NEVER {@html} — so nothing in a reply can inject markup; the worst case is a
	// stray asterisk showing through. Deliberately minimal (no links/images/
	// headings/tables) to keep it safe and predictable for a chat bubble.

	export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
	export type Block =
		| { kind: 'p'; spans: Inline[] }
		| { kind: 'ul'; items: Inline[][] }
		| { kind: 'ol'; items: Inline[][] };

	// Inline emphasis: **bold** | __bold__ | *italic* | _italic_ | `code`.
	const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;

	export function parseInline(input: string): Inline[] {
		const src = input ?? '';
		const out: Inline[] = [];
		let last = 0;
		for (const m of src.matchAll(INLINE)) {
			const idx = m.index ?? 0;
			if (idx > last) out.push({ text: src.slice(last, idx) });
			const tok = m[0];
			if (tok.startsWith('**') || tok.startsWith('__')) {
				out.push({ text: tok.slice(2, -2), bold: true });
			} else if (tok.startsWith('`')) {
				out.push({ text: tok.slice(1, -1), code: true });
			} else {
				out.push({ text: tok.slice(1, -1), italic: true });
			}
			last = idx + tok.length;
		}
		if (last < src.length) out.push({ text: src.slice(last) });
		return out.length ? out : [{ text: src }];
	}

	const BULLET = /^\s*([-*•])\s+(.*)$/;
	const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;

	/** Parse light markdown into renderable blocks (paragraphs + bullet/numbered
	 *  lists). Consecutive list lines group into one list; blank lines break
	 *  paragraphs. */
	export function parseBlocks(input: string): Block[] {
		const lines = (input ?? '').replace(/\r\n/g, '\n').split('\n');
		const blocks: Block[] = [];
		let para: string[] = [];

		const flushPara = () => {
			if (para.length) {
				blocks.push({ kind: 'p', spans: parseInline(para.join(' ').trim()) });
				para = [];
			}
		};

		for (const raw of lines) {
			const line = raw ?? '';
			if (line.trim() === '') {
				flushPara();
				continue;
			}
			const bullet = line.match(BULLET);
			const numbered = !bullet ? line.match(NUMBERED) : null;
			if (bullet) {
				flushPara();
				const prev = blocks[blocks.length - 1];
				const item = parseInline(bullet[2]);
				if (prev && prev.kind === 'ul') prev.items.push(item);
				else blocks.push({ kind: 'ul', items: [item] });
			} else if (numbered) {
				flushPara();
				const prev = blocks[blocks.length - 1];
				const item = parseInline(numbered[2]);
				if (prev && prev.kind === 'ol') prev.items.push(item);
				else blocks.push({ kind: 'ol', items: [item] });
			} else {
				para.push(line.trim());
			}
		}
		flushPara();
		return blocks;
	}
</script>

<script lang="ts">
	let { text }: { text: string } = $props();
	const blocks = $derived(parseBlocks(text));
</script>

<div class="md">
	{#each blocks as b}
		{#if b.kind === 'p'}
			<p>
				{#each b.spans as s}{#if s.bold}<strong>{s.text}</strong>{:else if s.italic}<em>{s.text}</em
						>{:else if s.code}<code>{s.text}</code>{:else}{s.text}{/if}{/each}
			</p>
		{:else if b.kind === 'ul'}
			<ul>
				{#each b.items as item}
					<li>
						{#each item as s}{#if s.bold}<strong>{s.text}</strong>{:else if s.italic}<em
									>{s.text}</em
								>{:else if s.code}<code>{s.text}</code>{:else}{s.text}{/if}{/each}
					</li>
				{/each}
			</ul>
		{:else}
			<ol>
				{#each b.items as item}
					<li>
						{#each item as s}{#if s.bold}<strong>{s.text}</strong>{:else if s.italic}<em
									>{s.text}</em
								>{:else if s.code}<code>{s.text}</code>{:else}{s.text}{/if}{/each}
					</li>
				{/each}
			</ol>
		{/if}
	{/each}
</div>

<style>
	.md {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.md :global(p) {
		margin: 0;
		line-height: 1.5;
	}
	.md :global(ul),
	.md :global(ol) {
		margin: 0;
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.md :global(li) {
		line-height: 1.45;
	}
	.md :global(strong) {
		font-weight: 700;
	}
	.md :global(code) {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.88em;
		background: var(--admin-surface-2);
		padding: 0.05em 0.3em;
		border-radius: var(--admin-radius-sm);
	}
</style>
