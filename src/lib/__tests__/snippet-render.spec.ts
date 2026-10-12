// A Svelte 5 snippet must be rendered with {@render name()}, never called as a bare
// expression {name()}.
//
// WHY THIS TEST EXISTS. `{coversBreakdown()}` compiles, type-checks and lints clean —
// it looks like any other expression in markup. At RUNTIME it invokes the snippet
// function with no anchor argument, and Svelte's internals immediately do
// `anchor.before(...)`:
//
//     Uncaught TypeError: Cannot read properties of undefined (reading 'before')
//
// The owner's report was "this button is not working": the diary's Σ covers-breakdown
// toggle flipped its state, threw before the popover could mount, and looked dead.
// Nothing in the build catches it, so a plain source scan does.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function svelteFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry === '.svelte-kit') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) svelteFiles(full, out);
		else if (entry.endsWith('.svelte')) out.push(full);
	}
	return out;
}

/** Markup comments legitimately QUOTE the broken form to warn about it (the diary does,
 *  right above the fixed line), so they're stripped before scanning. */
function stripComments(src: string): string {
	return src.replace(/<!--[\s\S]*?-->/g, '');
}

/** `{#snippet name(` → the snippet names a file declares. */
function snippetNames(src: string): string[] {
	return [...src.matchAll(/\{#snippet\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
}

/**
 * Bare `{name(` calls for a declared snippet. `{@render name()}` can't match: the
 * `@render ` sits between the brace and the name.
 */
function bareCalls(src: string, name: string): number {
	return [...src.matchAll(new RegExp(`\\{\\s*${name}\\s*\\(`, 'g'))].length;
}

describe('Svelte snippets are rendered, not called', () => {
	const files = svelteFiles(SRC);

	it('finds .svelte files to scan (the scan itself is not silently empty)', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it('has no bare {snippet()} invocations anywhere in src/', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const src = stripComments(readFileSync(file, 'utf8'));
			for (const name of new Set(snippetNames(src))) {
				const count = bareCalls(src, name);
				if (count > 0) {
					offenders.push(
						`${file.slice(SRC.length + 1)}: {${name}()} — use {@render ${name}()} (${count}×)`
					);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
