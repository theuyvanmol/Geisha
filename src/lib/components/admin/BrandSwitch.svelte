<script lang="ts">
	// The Asia ↔ Fusion restaurant switch.
	//
	// ONE component for both places it appears — the service top bar and the
	// sidebar's brand head — because two hand-rolled copies is exactly how they
	// came to disagree: the sidebar's "Asia" link pointed at `/admin?brand=asia`
	// (jumping you out of whatever view you were working, and dropping ?date=)
	// while its "Fusion" link was a bare `?brand=fusion` that stayed put. Switching
	// restaurant in the sidebar after switching it on the tab bar therefore threw
	// you back to the dashboard on one side and not the other. Here both sides are
	// the same link: same path, same carried params, brand swapped.
	//
	// It also REMEMBERS the choice against the staff account (same store as the
	// diary's collapsed header), so the next admin page you open without an
	// explicit ?brand= comes up on the restaurant you were last working. The write
	// is fire-and-forget: the navigation is the real feedback, and a failed
	// preference save must never block or delay changing restaurant.

	import { page } from '$app/state';

	type Brand = 'asia' | 'fusion';

	let {
		/** Query keys to preserve across the switch (brand itself is always set). */
		carry = ['date'],
		/** Visual variant: 'bar' = the light pill on the tab row; 'rail' = the
		 *  sidebar's dark lacquer head. */
		variant = 'bar'
	}: { carry?: string[]; variant?: 'bar' | 'rail' } = $props();

	const brand = $derived((page.url.searchParams.get('brand') as Brand) || 'asia');

	/** The same page, same working context, other restaurant. */
	function hrefFor(b: Brand): string {
		const params = new URLSearchParams();
		params.set('brand', b);
		for (const k of carry) {
			if (k === 'brand') continue;
			const v = page.url.searchParams.get(k);
			if (v) params.set(k, v);
		}
		return `${page.url.pathname}?${params.toString()}`;
	}

	function remember(b: Brand) {
		if (b === brand) return;
		void fetch('/api/admin/prefs', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ brand: b })
		}).catch(() => {
			/* offline / transient — the switch itself still happened */
		});
	}
</script>

<div class="brand-switch {variant}" role="group" aria-label="Restaurant">
	{#each [{ id: 'asia', label: 'Asia' }, { id: 'fusion', label: 'Fusion' }] as const as b (b.id)}
		<a
			href={hrefFor(b.id)}
			class:on={brand === b.id}
			aria-current={brand === b.id ? 'true' : undefined}
			onclick={() => remember(b.id)}>{b.label}</a
		>
	{/each}
</div>

<style>
	.brand-switch {
		display: inline-flex;
		flex: none;
		border-radius: 999px;
		overflow: hidden;
	}
	.brand-switch a {
		text-decoration: none;
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0.3rem 0.95rem;
		min-height: 2rem;
		display: inline-flex;
		align-items: center;
		white-space: nowrap;
	}

	/* light pill — on paper, next to the service tabs */
	.brand-switch.bar {
		border: 1px solid var(--admin-border);
		background: var(--admin-surface);
	}
	.brand-switch.bar a {
		color: var(--admin-muted);
	}
	.brand-switch.bar a:hover {
		color: var(--admin-ink);
		background: var(--admin-surface-2);
	}
	.brand-switch.bar a.on {
		color: #fff;
		background: var(--admin-accent);
	}

	/* dark variant — on the lacquer rail / top bar */
	.brand-switch.rail {
		border: 1px solid var(--admin-side-line);
		background: rgba(0, 0, 0, 0.25);
	}
	/* On the top bar this switch was the tallest thing in the row, so it — not the
	   content — set the bar's height. Trimmed to sit inside the tabs' line. */
	.brand-switch.rail a {
		padding: 0.2rem 0.8rem;
		min-height: 1.6rem;
		font-size: 0.82rem;
	}
	.brand-switch.rail a {
		color: var(--admin-side-ink-muted);
	}
	/* On a narrow phone this switch shares one row with the burger and the three
	   service tabs, and at 0.8rem of side padding it was the reason "Run-sheet" came
	   up clipped. Asia and Fusion are short words that don't need the room. */
	@media (max-width: 400px) {
		.brand-switch.rail a {
			padding-inline: 0.5rem;
			font-size: 0.78rem;
		}
	}
	.brand-switch.rail a:hover {
		color: var(--admin-side-ink);
		background: var(--admin-side-hover);
	}
	.brand-switch.rail a.on {
		color: var(--admin-accent-ink);
		background: var(--admin-accent);
	}
</style>
