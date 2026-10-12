// The configuration surface's tab bar (owner, Sep 2026).
//
// "Pacing" became "Table rules" and absorbed Settings: the two were always the
// same job — how many covers the room takes and on what terms — split across two
// sidebar entries. They are still separate routes with their own loaders and
// actions; this is the one list that renders them as a single tabbed surface.
//
// It lives here rather than in either layout because BOTH /admin/pacing and
// /admin/settings render it, and a bar that differs depending on which tab you
// are standing on is how you get a tab that vanishes when you click it.

import type { AdminTab } from '$lib/components/admin/AdminTabs.svelte';

export const CONFIG_TABS: AdminTab[] = [
	{ href: '/admin/pacing', label: 'Table rules' },
	// Policy is Settings' index route, so its href is a strict prefix of the
	// three below — it must match exactly or it lights on every one of them.
	{ href: '/admin/settings', label: 'Policy', exact: true },
	{ href: '/admin/settings/deposits', label: 'Deposits' },
	{ href: '/admin/settings/menus-preorder', label: 'Set Menus' },
	{ href: '/admin/settings/integrations', label: 'Integrations' }
];
