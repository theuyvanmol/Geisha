<script lang="ts" module>
	export type AdminTab = {
		/** Destination path, WITHOUT query (the bar re-attaches the live query). */
		href: string;
		label: string;
		/** Optional: extra paths that should also light this tab as active. */
		match?: string[];
		/** Match this path EXACTLY (no subtree). Use for an index route whose href
		 *  is a prefix of its siblings, e.g. /admin/settings vs /settings/deposits. */
		exact?: boolean;
	};
</script>

<script lang="ts">
	// AdminTabs — the shared tab bar that turns a cluster of sibling admin routes
	// into one tabbed surface (Service, Guests, Settings, Content…).
	//
	// Each tab is still its own route, so loaders, form actions, realtime and
	// deep-linking keep working untouched — switching tab is a normal client-side
	// navigation between siblings. The bar simply renders a token-styled,
	// brand-accented row of links and carries the current query string (?brand=,
	// and ?date= on the service pages) across the switch so context is preserved.
	//
	//   <AdminTabs tabs={[{ href: '/admin/diary', label: 'Diary' }, …]} />
	import { page } from '$app/state';

	let {
		tabs,
		/** Which query keys to carry across tab switches. brand is always carried. */
		carry = ['brand', 'date']
	}: { tabs: AdminTab[]; carry?: string[] } = $props();

	// Re-build the query string from the live URL, keeping only the carried keys
	// (so we don't drag a stale ?status= from Comms onto Reviews, etc.).
	const qs = $derived.by(() => {
		const out = new URLSearchParams();
		for (const k of carry) {
			const v = page.url.searchParams.get(k);
			if (v) out.set(k, v);
		}
		const s = out.toString();
		return s ? `?${s}` : '';
	});

	function isActive(t: AdminTab): boolean {
		const here = page.url.pathname;
		if (here === t.href) return true;
		// Index routes (exact) only match their own path, never a sibling subtree —
		// otherwise a prefix href like /admin/settings would light on every child.
		if (t.exact) return false;
		// Other tabs claim their own subtree (so /admin/customers/123 lights
		// "Customers") plus any explicitly listed sibling paths.
		const prefixes = [t.href, ...(t.match ?? [])];
		return prefixes.some((p) => here === p || here.startsWith(p + '/'));
	}
</script>

<nav class="admin-tabs" aria-label="Section tabs">
	{#each tabs as t}
		<a href="{t.href}{qs}" class:on={isActive(t)} aria-current={isActive(t) ? 'page' : undefined}>
			{t.label}
		</a>
	{/each}
</nav>

<style>
	.admin-tabs {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
		border-bottom: 1px solid var(--admin-border);
		margin: 0 0 1.4rem;
	}
	.admin-tabs a {
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 500;
		padding: 0.55rem 0.95rem;
		color: var(--admin-muted);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		border-radius: var(--admin-radius) var(--admin-radius) 0 0;
		/* comfortable tap target on floor tablets */
		min-height: var(--admin-tap);
		display: inline-flex;
		align-items: center;
	}
	.admin-tabs a:hover {
		color: var(--admin-ink);
		background: var(--admin-surface-2);
	}
	.admin-tabs a.on {
		color: var(--admin-ink);
		font-weight: 600;
		border-bottom-color: var(--admin-accent);
	}
</style>
