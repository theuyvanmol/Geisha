// The admin access map is the fence around the back office, so the prefix
// scanning gets a test: '/admin/floor' (service, everyone) must NOT be confused
// with '/admin/floor-editor' (manager), and the catch-alls must never out-rank a
// specific entry.

import { describe, it, expect } from 'vitest';
import {
	ADMIN_GRANTS,
	ADMIN_NAV,
	ADMIN_OTHER,
	cleanGrants,
	grantForPath,
	OTHER_HREF,
	ROLE_TIERS,
	areasFor,
	canOpenPath,
	minRoleForPath,
	navGroupsFor,
	otherItemsFor,
	roleAtLeast,
	tierLabel
} from './access';
import type { StaffRole } from '$lib/server/db/types';

describe('minRoleForPath', () => {
	it('opens the service surfaces to every signed-in role', () => {
		for (const p of [
			'/admin',
			'/admin/diary',
			'/admin/floor',
			'/admin/runsheet',
			'/admin/training',
			'/admin/account'
		]) {
			expect(minRoleForPath(p), p).toBe('server');
		}
	});

	it('reserves setup / guests / insight / configure for manager+', () => {
		for (const p of [
			'/admin/floor-editor',
			'/admin/tables',
			'/admin/customers',
			'/admin/customers/abc123',
			'/admin/comms',
			'/admin/reviews',
			'/admin/circle',
			'/admin/reports',
			'/admin/content',
			'/admin/content/media',
			'/admin/closures',
			'/admin/pacing',
			'/admin/settings',
			'/admin/settings/deposits'
		]) {
			expect(minRoleForPath(p), p).toBe('manager');
		}
	});

	it('keeps staff management owner-only', () => {
		expect(minRoleForPath('/admin/team')).toBe('owner');
	});

	it('does not let the /admin catch-all beat a longer match', () => {
		expect(minRoleForPath('/admin/floor')).toBe('server');
		expect(minRoleForPath('/admin/floor-editor')).toBe('manager');
	});

	it('gates the website-changing APIs at manager, working APIs at server', () => {
		expect(minRoleForPath('/api/admin/content')).toBe('manager');
		expect(minRoleForPath('/api/admin/media')).toBe('manager');
		expect(minRoleForPath('/api/admin/setting')).toBe('manager');
		expect(minRoleForPath('/api/admin/search')).toBe('server');
		expect(minRoleForPath('/api/admin-chat')).toBe('server');
		// Anything new under /api/admin still needs a session at minimum.
		expect(minRoleForPath('/api/admin/something-new')).toBe('server');
	});

	it('leaves the public site ungoverned', () => {
		expect(minRoleForPath('/')).toBeNull();
		expect(minRoleForPath('/asia/book')).toBeNull();
	});
});

describe('canOpenPath', () => {
	it('gives a host exactly service + assistant + training + account', () => {
		expect(canOpenPath('host', '/admin')).toBe(true);
		expect(canOpenPath('host', '/admin/diary')).toBe(true);
		expect(canOpenPath('host', '/admin/assistant')).toBe(true);
		expect(canOpenPath('host', '/admin/training')).toBe(true);
		expect(canOpenPath('host', '/admin/account')).toBe(true);

		expect(canOpenPath('host', '/admin/floor-editor')).toBe(false);
		expect(canOpenPath('host', '/admin/tables')).toBe(false);
		expect(canOpenPath('host', '/admin/customers')).toBe(false);
		expect(canOpenPath('host', '/admin/settings')).toBe(false);
		expect(canOpenPath('host', '/admin/team')).toBe(false);
		expect(canOpenPath('host', '/api/admin/content')).toBe(false);
	});

	it('gives manager everything but the team page', () => {
		expect(canOpenPath('manager', '/admin/settings')).toBe(true);
		expect(canOpenPath('manager', '/admin/floor-editor')).toBe(true);
		expect(canOpenPath('manager', '/admin/team')).toBe(false);
	});

	it('gives owner everything', () => {
		expect(canOpenPath('owner', '/admin/team')).toBe(true);
		expect(canOpenPath('owner', '/admin/settings')).toBe(true);
	});

	it('refuses a signed-out / roleless caller on governed paths', () => {
		expect(canOpenPath(null, '/admin')).toBe(false);
		expect(canOpenPath('', '/admin/diary')).toBe(false);
		expect(roleAtLeast(undefined, 'server')).toBe(false);
	});
});

// The Team page tells an owner what each level grants using areasFor(). If that
// ever disagreed with the nav or the guard it would be worse than saying nothing,
// so pin the wording source to the same map.
describe('what the Team page tells an owner', () => {
	// Sidebar entries first, then the Other page's — the order the person will
	// actually meet them in, which is why the sidebar names come first here.
	it('lists a service-only person exactly what the sidebar and Other page show them', () => {
		expect(areasFor('host')).toEqual([
			'Service',
			'Assistant',
			'Dashboard',
			'Training',
			'My Account'
		]);
		expect(areasFor('server')).toEqual(['Service', 'Dashboard', 'Training', 'My Account']);
		expect(areasFor('owner')).toContain('Team');
		expect(areasFor('manager')).not.toContain('Team');
	});

	// 'Other' is a signpost, not a place. Telling an owner a role "sees Other"
	// would name the door rather than any of the rooms behind it.
	it('never names the Other link itself as a destination', () => {
		for (const t of ROLE_TIERS) expect(areasFor(t.role)).not.toContain('Other');
	});

	it('names a level for every assignable role', () => {
		for (const t of ROLE_TIERS) expect(tierLabel(t.role)).not.toBe('—');
		expect(ROLE_TIERS.map((t) => t.role)).toEqual(['owner', 'manager', 'host', 'server']);
	});

	it('only ever claims destinations that really exist in the sidebar or on Other', () => {
		const known = new Set(
			[...ADMIN_NAV.flatMap((g) => g.items), ...ADMIN_OTHER].map((i) => i.label)
		);
		for (const t of ROLE_TIERS) {
			for (const area of areasFor(t.role)) expect(known.has(area), area).toBe(true);
		}
	});

	// Whatever the nav is rearranged into, nothing may fall out of the building:
	// every destination an owner can open has to be named somewhere.
	it('loses no destination between the sidebar and the Other page', () => {
		const everything = [...ADMIN_NAV.flatMap((g) => g.items), ...ADMIN_OTHER]
			.filter((i) => i.href !== OTHER_HREF)
			.map((i) => i.label)
			.sort();
		expect([...areasFor('owner')].sort()).toEqual(everything);
	});

	it('drops nav blocks a role cannot use any of', () => {
		// The blocks are unlabelled, so this checks what survives, not titles.
		const labels = (r: Parameters<typeof navGroupsFor>[0]) =>
			navGroupsFor(r).map((g) => g.items.map((i) => i.label));
		expect(labels('host')).toEqual([['Service'], ['Assistant'], ['Other']]);
		expect(labels('server')).toEqual([['Service'], ['Other']]);
		expect(labels('manager')).toEqual([
			['Service', 'Tables', 'Reports', 'Table rules'],
			['Guests', 'Assistant'],
			['Other']
		]);
	});
});

// The sidebar (owner, Sep 2026): three unlabelled blocks, everything else behind
// the Other link.
describe('the sidebar', () => {
	const labels = (role: StaffRole) =>
		navGroupsFor(role).flatMap((g) => g.items.map((i) => i.label));

	it('gives an owner the agreed eight entries, in order', () => {
		expect(labels('owner')).toEqual([
			'Service',
			'Tables',
			'Reports',
			'Table rules',
			'Team',
			'Guests',
			'Assistant',
			'Other'
		]);
	});

	it('is three unlabelled blocks — the old group headings are gone', () => {
		expect(ADMIN_NAV.map((g) => g.title)).toEqual(['', '', '']);
	});

	it('never shows a role a link it would be bounced off', () => {
		for (const role of ['owner', 'manager', 'host', 'server'] as StaffRole[]) {
			for (const g of navGroupsFor(role)) {
				for (const item of g.items) {
					expect(canOpenPath(role, item.href), `${role} → ${item.href}`).toBe(true);
				}
			}
		}
	});
});

describe('the Other page', () => {
	it('holds everything moved off the sidebar', () => {
		expect(otherItemsFor('owner').map((i) => i.label)).toEqual([
			'Dashboard',
			'Floor Editor',
			'The Circle',
			'Training',
			'Content',
			'Closures',
			'My Account'
		]);
	});

	it('is role-filtered too, so no card 403s when tapped', () => {
		expect(otherItemsFor('host').map((i) => i.label)).toEqual([
			'Dashboard',
			'Training',
			'My Account'
		]);
		for (const item of otherItemsFor('host')) {
			expect(canOpenPath('host', item.href)).toBe(true);
		}
	});

	it('does not repeat anything already in the sidebar', () => {
		const inNav = new Set(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href)));
		for (const item of ADMIN_OTHER) expect(inNav.has(item.href)).toBe(false);
	});
});

// Grants: an owner opens ONE area for ONE person (Reports for the hosts, Sep
// 2026) without handing over Full access. The grant must open exactly its own
// subtree — page, CSV exports, nav entry — and nothing next to it.
describe('grants', () => {
	it('maps Reports and its exports to the reports grant, nothing else', () => {
		expect(grantForPath('/admin/reports')).toBe('reports');
		expect(grantForPath('/admin/reports?brand=fusion')).toBe('reports');
		expect(grantForPath('/admin/reports/export')).toBe('reports');
		expect(grantForPath('/admin/reports/deposit-export')).toBe('reports');
		expect(grantForPath('/admin/reports-anything')).toBeNull();
		expect(grantForPath('/admin/settings')).toBeNull();
	});

	it('opens Reports for a granted host, and only Reports', () => {
		expect(canOpenPath('host', '/admin/reports')).toBe(false);
		expect(canOpenPath('host', '/admin/reports', ['reports'])).toBe(true);
		expect(canOpenPath('server', '/admin/reports/noshow-export', ['reports'])).toBe(true);
		for (const p of ['/admin/settings', '/admin/tables', '/admin/customers', '/admin/team']) {
			expect(canOpenPath('host', p, ['reports']), p).toBe(false);
		}
	});

	it('never lets a grant stand in for a missing role', () => {
		expect(canOpenPath(null, '/admin/reports', ['reports'])).toBe(false);
		expect(canOpenPath('', '/admin/reports', ['reports'])).toBe(false);
	});

	it("shows Reports in a granted host's sidebar and Team summary", () => {
		const labels = navGroupsFor('host', ['reports']).flatMap((g) => g.items.map((i) => i.label));
		expect(labels).toContain('Reports');
		expect(labels).not.toContain('Tables');
		expect(areasFor('host', ['reports'])).toContain('Reports');
		expect(areasFor('host')).not.toContain('Reports');
	});

	it('drops unknown or junk grant names read back from storage', () => {
		expect(cleanGrants(['reports', 'settings', 7, 'reports'])).toEqual(['reports']);
		expect(cleanGrants('reports')).toEqual([]);
		expect(cleanGrants(null)).toEqual([]);
		for (const g of ADMIN_GRANTS) expect(grantForPath('/admin/' + g.grant)).toBe(g.grant);
	});
});
