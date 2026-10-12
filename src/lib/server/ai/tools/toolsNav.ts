// Navigation-domain tool for the admin assistant: navigate_to.
//
// A UI-kind tool (no data change) that asks the client to route to another admin
// page. Like open_settings/open_content it auto-runs in the agent loop and pushes
// a UiDirective { tool:'navigate_to', input, result } back to the client; the
// shared store (assistant.svelte.ts applyDirectives) sees result.kind==='navigate'
// and calls goto(href) — but only if href differs from the current path (so the
// assistant never triggers a pointless same-page reload).
//
// The page → href map mirrors pageContext.ts's AdminPageKey and the real admin
// routes (the route-group parens are stripped from the URL, so these are the
// public paths). Adding a page is a one-line entry here + in pageContext.ts.
// Server-only (registered in the composer ./index.ts). Kept in its OWN factory so
// each stream's tools stay disjoint and easy to merge.

import type { GeminiTool, ToolContext } from './types.js';

/** AdminPageKey → the admin route to navigate to. Keep in sync with pageContext.ts
 *  and the actual /admin routes (route-group parens are stripped from the URL). */
const PAGE_HREF: Record<string, { href: string; label: string }> = {
	dashboard: { href: '/admin', label: 'Dashboard' },
	diary: { href: '/admin/diary', label: 'Diary' },
	floor: { href: '/admin/floor', label: 'Floor Plan (live)' },
	tables: { href: '/admin/tables', label: 'Tables' },
	customers: { href: '/admin/customers', label: 'Customers' },
	reports: { href: '/admin/reports', label: 'Reports' },
	closures: { href: '/admin/closures', label: 'Closures' },
	settings: { href: '/admin/settings', label: 'Settings' },
	content: { href: '/admin/content', label: 'Content' },
	'floor-editor': { href: '/admin/floor-editor', label: 'Floor Editor' },
	pacing: { href: '/admin/pacing', label: 'Pacing' }
};

const PAGE_KEYS = Object.keys(PAGE_HREF);

/** Navigation-domain tools for a brand. */
export function navTools(_ctx: ToolContext): GeminiTool[] {
	return [
		{
			name: 'navigate_to',
			kind: 'ui',
			description:
				`Take the operator to another admin page (client-side navigation — no data change). Use this when they ask to "go to", "open" or "show me" a page, or when the right next step for a task lives on a specific page. The page must be one of: ${PAGE_KEYS.join(', ')}. Combine it with a visual result card or a settings/content editor where that helps. It only routes — it never changes any booking, table or setting.`,
			parameters: {
				type: 'object',
				properties: {
					page: {
						type: 'string',
						enum: PAGE_KEYS,
						description: 'Which admin page to open. One of the listed keys.'
					},
					highlight: {
						type: 'string',
						description:
							'Optional hint about what the operator is looking for on that page (advisory only; passed through for the client to use).'
					}
				},
				required: ['page']
			},
			run: async ({ page, highlight }: { page: string; highlight?: string }) => {
				const target = PAGE_HREF[page];
				if (!target) {
					return {
						kind: 'navigate',
						ok: false,
						error: `Unknown page "${page}". Valid pages: ${PAGE_KEYS.join(', ')}.`
					};
				}
				return {
					kind: 'navigate',
					ok: true,
					page,
					href: target.href,
					label: target.label,
					highlight: highlight?.trim() || undefined
				};
			}
		}
	];
}
