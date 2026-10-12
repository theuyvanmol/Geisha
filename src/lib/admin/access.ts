// Admin access map — ONE source of truth for "who may open which back-office
// page", shared by the server guard (hooks.server.ts) and the sidebar nav
// (src/routes/admin/+layout.svelte).
//
// Why this exists (owner, Jul 2026): every staff account was an `owner`, so
// everyone saw the whole back office — floor editor, tables, guest data,
// content, settings. Floor staff have no use for those and can break the site
// with them. The rule now is:
//
//   owner / manager  → everything (setup, guests, insight, configure, team*)
//   host / server    → Dashboard, Service (diary/floor/run-sheet), Assistant,
//                      Training, My Account — and nothing else
//
//   (*) staff management stays owner-only, as it always was.
//
// On top of the role, an owner can open ONE area for ONE person without raising
// their whole level — a GRANT (see ROUTE_GRANT). Asked for by the floor team
// (Sep 2026): the hosts wanted Reports, and "Full access" would also have handed
// them Tables, Settings and guest data, which is what the tiers exist to prevent.
//
// Hiding a nav link is cosmetic; this map is enforced in hooks.server.ts for
// every /admin page and /api/admin* request, so typing the URL doesn't work
// either. Individual load functions / actions keep their own requireRole calls
// — this is the outer fence, not a replacement for them.

import type { StaffRole } from '$lib/server/db/types';
import { CIRCLE_LIVE } from '$lib/data/features';

/**
 * Paths under /admin reachable WITHOUT a session, so the guard can never lock
 * staff out of the doors they need in order to get a session in the first place:
 * the login form, first-run setup, the emailed invite link, and the two halves of
 * the forgotten-password flow.
 *
 * These are also the pages that render BARE (no sidebar, no brand chrome) —
 * there is no signed-in identity to build a back office around. The same list
 * therefore drives all three consumers (hooks.server.ts, +layout.server.ts,
 * +layout.svelte); it used to be copied into each of them, which is how you get
 * a new auth page that authenticates fine and then renders inside an empty shell.
 */
export const ADMIN_PUBLIC_PATHS: ReadonlySet<string> = new Set([
	'/admin/login',
	'/admin/setup',
	'/admin/accept-invite',
	'/admin/forgot-password',
	'/admin/reset-password'
]);

/** Privilege ranking — mirrors src/lib/server/auth/rbac.ts. */
export const ROLE_RANK: Record<StaffRole, number> = {
	owner: 4,
	manager: 3,
	host: 2,
	server: 1
};

export function rankOf(role: StaffRole | '' | null | undefined): number {
	return role && role in ROLE_RANK ? ROLE_RANK[role as StaffRole] : 0;
}

/** True if `role` is at least `min`. */
export function roleAtLeast(role: StaffRole | '' | null | undefined, min: StaffRole): boolean {
	return rankOf(role) >= ROLE_RANK[min];
}

/**
 * Minimum role per route prefix. Longest match wins, so a more specific entry
 * can tighten (or loosen) a subtree. Route groups — (service), (guests) — never
 * appear in URLs, so these are the real paths.
 */
const ROUTE_MIN: Array<[prefix: string, min: StaffRole]> = [
	// --- Service: every signed-in role runs the floor -----------------------
	['/admin/diary', 'server'],
	['/admin/floor', 'server'],
	['/admin/runsheet', 'server'],
	['/admin/training', 'server'],
	['/admin/account', 'server'],
	// The offline run sheet is what the floor falls back to when the line drops, so
	// the lowest service role must reach it — a host locked out of the only readable
	// board during an outage is the exact failure it exists to prevent. It shows no
	// more than the diary that same role already opens.
	['/admin/offline', 'server'],
	// A single booking's detail page is part of running service.
	['/admin/bookings', 'host'],
	['/admin/assistant', 'host'],

	// --- Setup / Guests / Insight / Configure: manager+ ---------------------
	['/admin/floor-editor', 'manager'],
	['/admin/tables', 'manager'],
	['/admin/customers', 'manager'],
	['/admin/comms', 'manager'],
	['/admin/reviews', 'manager'],
	['/admin/enquiries', 'manager'],
	['/admin/circle', 'manager'],
	['/admin/reports', 'manager'],
	['/admin/content', 'manager'],
	['/admin/closures', 'manager'],
	['/admin/pacing', 'manager'],
	['/admin/settings', 'manager'],

	// --- Staff management: owner only ---------------------------------------
	['/admin/team', 'owner'],
	// Developer diagnostics — request headers, Stripe intent ids, decline codes.
	// Owner-only and deliberately absent from ADMIN_NAV below: it is a maintenance
	// instrument, not a back-office destination.
	['/admin/diagnostics', 'owner'],

	// --- Admin APIs ----------------------------------------------------------
	// Writes that change the public website or house configuration are manager+.
	['/api/admin/content', 'manager'],
	['/api/admin/media', 'manager'],
	['/api/admin/setting', 'manager'],
	['/api/admin/evening-plan', 'manager'],
	['/api/admin/diagnostics', 'owner'],
	// Working endpoints every role needs during service.
	['/api/admin/search', 'server'],
	['/api/admin/prefs', 'server'],
	['/api/admin/realtime-token', 'server'],
	['/api/admin-chat', 'server'],

	// Catch-alls last: they're prefixes of everything above, so longest-match
	// keeps the specific entries winning. A NEW admin page or endpoint therefore
	// defaults to "any signed-in staff" — if it's a manager surface, add it here
	// (that one line also hides it from the sidebar).
	['/api/admin', 'server'],
	['/admin', 'server']
];

/**
 * A single area an owner can open for one person below its role bar, from the
 * Team page. Stored in $lib/server/auth/grants.ts and carried on the session as
 * `staff.grants`.
 */
export type AdminGrant = 'reports';

/**
 * Which grant opens which subtree, for someone below that subtree's ROUTE_MIN.
 * Keep each entry READ-ONLY in effect: a grant is a window into one area, never a
 * way round a write the role line guards. Reports has no form actions — only its
 * loader and the CSV exports, which live under the same prefix.
 */
const ROUTE_GRANT: Array<[prefix: string, grant: AdminGrant]> = [['/admin/reports', 'reports']];

/** How each grant is offered to an owner on the Team page. */
export const ADMIN_GRANTS: Array<{ grant: AdminGrant; label: string; blurb: string }> = [
	{
		grant: 'reports',
		label: 'Reports',
		blurb: 'Covers, no-shows, feedback and deposits, with the CSV downloads. Read-only.'
	}
];

const GRANT_IDS = new Set<string>(ADMIN_GRANTS.map((g) => g.grant));

/** Keep only real grant names — for values read back from storage. */
export function cleanGrants(raw: unknown): AdminGrant[] {
	if (!Array.isArray(raw)) return [];
	return [...new Set(raw.filter((g): g is AdminGrant => typeof g === 'string' && GRANT_IDS.has(g)))];
}

type Grants = readonly AdminGrant[] | null | undefined;

function prefixMatches(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?');
}

/**
 * Minimum role required to open `path`, or null when the path isn't governed by
 * this map (public site, login pages, cron, …).
 */
export function minRoleForPath(path: string): StaffRole | null {
	let best: { prefix: string; min: StaffRole } | null = null;
	for (const [prefix, min] of ROUTE_MIN) {
		if (!prefixMatches(path, prefix)) continue;
		if (!best || prefix.length > best.prefix.length) best = { prefix, min };
	}
	return best?.min ?? null;
}

/** The grant that opens `path` for someone below its role bar, or null. */
export function grantForPath(path: string): AdminGrant | null {
	let best: { prefix: string; grant: AdminGrant } | null = null;
	for (const [prefix, grant] of ROUTE_GRANT) {
		if (!prefixMatches(path, prefix)) continue;
		if (!best || prefix.length > best.prefix.length) best = { prefix, grant };
	}
	return best?.grant ?? null;
}

/**
 * True if a staff member holding `role` (plus any `grants`) may open `path`.
 * A grant lifts the role bar for its own subtree only, and never for someone
 * with no role at all.
 */
export function canOpenPath(
	role: StaffRole | '' | null | undefined,
	path: string,
	grants?: Grants
): boolean {
	const min = minRoleForPath(path);
	if (min === null || roleAtLeast(role, min)) return true;
	const grant = grantForPath(path);
	return grant !== null && rankOf(role) > 0 && !!grants?.includes(grant);
}

// ---------------------------------------------------------------------------
// The back-office destinations — ONE list, used by the sidebar AND by the Team
// page's "sees:" summary, so what an owner is told a role gets is literally what
// the nav shows and hooks.server.ts allows.
// ---------------------------------------------------------------------------

export type AdminNavItem = {
	href: string;
	label: string;
	/** Sibling routes that keep a cluster entry highlighted in the sidebar. */
	match?: string[];
	/** Index routes that are a prefix of their siblings — match exactly. */
	exact?: boolean;
	/** Extra query params appended to the sidebar link. */
	extra?: string;
	/** One line of "what this is for", shown on the Other page. The sidebar has
	 *  no room for it and doesn't read it. */
	blurb?: string;
	/**
	 * Built, but not launched to guests (see $lib/data/features). Shown greyed with
	 * a "Soon" tag instead of a link. The route itself still works if typed, so the
	 * content can be prepared ahead of launch — this is a signpost, not a lock.
	 */
	soon?: boolean;
};
export type AdminNavGroup = { title: string; items: AdminNavItem[] };

/** The Other page's own path — it is a nav entry, but never a "destination" in
 *  the areasFor() sense, because it opens nothing on its own. */
export const OTHER_HREF = '/admin/other';

/**
 * The sidebar (owner, Sep 2026). Six labelled groups became three unlabelled
 * blocks: the everyday surfaces, then the two you dip into rather than live in,
 * then the way through to everything else.
 *
 * The blocks carry EMPTY titles on purpose — the divider between them is the
 * whole signal, and a heading over two items read as clutter once the list was
 * this short. The group shape is kept (rather than one flat array) because it is
 * what draws those dividers, and because a future group can arrive with a title
 * without touching the layout.
 */
export const ADMIN_NAV: AdminNavGroup[] = [
	{
		title: '',
		items: [
			{ href: '/admin/diary', label: 'Service', match: ['/admin/floor', '/admin/runsheet'] },
			{ href: '/admin/tables', label: 'Tables' },
			{ href: '/admin/reports', label: 'Reports' },
			// Pacing, renamed: "pacing" is trade language. The page sets covers caps
			// and the booking window, and now carries the Settings tabs with it.
			{ href: '/admin/pacing', label: 'Table rules', match: ['/admin/settings'] },
			{ href: '/admin/team', label: 'Team' }
		]
	},
	{
		title: '',
		items: [
			{
				href: '/admin/customers',
				label: 'Guests',
				match: ['/admin/comms', '/admin/reviews', '/admin/enquiries']
			},
			{ href: '/admin/assistant', label: 'Assistant' }
		]
	},
	{
		title: '',
		items: [{ href: OTHER_HREF, label: 'Other', exact: true }]
	}
];

/**
 * Everything reachable from the Other page. These are real destinations that
 * simply aren't everyday ones — they keep their role rules (ROUTE_MIN above),
 * so the page is filtered per role exactly as the sidebar is.
 */
export const ADMIN_OTHER: AdminNavItem[] = [
	{
		href: '/admin',
		label: 'Dashboard',
		exact: true,
		extra: 'home=1',
		blurb: 'Tonight at a glance — covers, the next arrivals and what needs attention.'
	},
	{
		href: '/admin/floor-editor',
		label: 'Floor Editor',
		blurb: 'Draw the room: add, move and resize tables, and set which section each is in.'
	},
	{
		href: '/admin/circle',
		label: 'The Circle',
		soon: !CIRCLE_LIVE,
		blurb: 'The guest loyalty programme.'
	},
	// admin-onboarding: guided-tour checklist, open to every signed-in role.
	{
		href: '/admin/training',
		label: 'Training',
		blurb: 'Guided walkthroughs of the back office, page by page.'
	},
	{
		href: '/admin/content',
		label: 'Content',
		blurb: 'The public website — menus, offers, reviews, photos and page copy.'
	},
	{
		href: '/admin/closures',
		label: 'Closures',
		blurb: 'Close the restaurant, a service or one section for a date or a range.'
	},
	// Every signed-in role can reach their own account to change their password.
	{
		href: '/admin/account',
		label: 'My Account',
		blurb: 'Your own sign-in details and password.'
	}
];

/** The nav groups a role may see, with empty groups dropped. */
export function navGroupsFor(
	role: StaffRole | '' | null | undefined,
	grants?: Grants
): AdminNavGroup[] {
	return ADMIN_NAV.map((g) => ({
		title: g.title,
		items: g.items.filter((i) => canOpenPath(role, i.href, grants))
	})).filter((g) => g.items.length > 0);
}

/** The Other-page entries a role may open. */
export function otherItemsFor(
	role: StaffRole | '' | null | undefined,
	grants?: Grants
): AdminNavItem[] {
	return ADMIN_OTHER.filter((i) => canOpenPath(role, i.href, grants));
}

/**
 * Flat list of destination labels a role may open — for the Team page summary.
 *
 * Spans the sidebar AND the Other page, minus the Other link itself: an owner
 * choosing an access level needs to be told the PLACES a role reaches, and
 * "sees: … Other" would name a signpost rather than a destination.
 */
export function areasFor(role: StaffRole | '' | null | undefined, grants?: Grants): string[] {
	const nav = navGroupsFor(role, grants)
		.flatMap((g) => g.items)
		.filter((i) => i.href !== OTHER_HREF);
	return [...nav, ...otherItemsFor(role, grants)].map((i) => i.label);
}

/**
 * How the roles are described to an owner on the Team page. The role is still the
 * real thing being saved — these are just the words for it, because "Host" tells
 * nobody what they'd actually see.
 */
export const ROLE_TIERS: Array<{ role: StaffRole; label: string; blurb: string }> = [
	{
		role: 'owner',
		label: 'Full access + team',
		blurb: 'Everything, and can invite staff and change access on this page.'
	},
	{
		role: 'manager',
		label: 'Full access',
		blurb: 'Everything except managing the team.'
	},
	{
		role: 'host',
		label: 'Service only',
		blurb: 'Runs service and takes bookings. Cannot reach setup, guest data or settings.'
	},
	{
		role: 'server',
		label: 'Floor only',
		blurb: 'Service without the assistant — for floor staff who only work the live floor.'
	}
];

const TIER_BY_ROLE = new Map(ROLE_TIERS.map((t) => [t.role, t]));

/** The plain-English tier name for a role ('Service only'), for display. */
export function tierLabel(role: StaffRole | '' | null | undefined): string {
	return (role && TIER_BY_ROLE.get(role as StaffRole)?.label) || '—';
}

/** The one-line explanation for a role, for display. */
export function tierBlurb(role: StaffRole | '' | null | undefined): string {
	return (role && TIER_BY_ROLE.get(role as StaffRole)?.blurb) || '';
}
