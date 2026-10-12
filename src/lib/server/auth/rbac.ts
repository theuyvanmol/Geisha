// Role-based access control (BUILD FOUNDATION F1).
//
// Role ordering (most → least privileged):  owner > manager > host > server.
// `requireRole` enforces a minimum role; `can` checks a named capability against
// the plan's RBAC matrix. Both throw a SvelteKit error(403) when unauthorized so
// load functions / actions / endpoints can call them inline.

import { error } from '@sveltejs/kit';
import type { StaffRole } from '../db/types.js';
import type { StaffSession } from './staff.js';
import type { AdminGrant } from '$lib/admin/access';

/** Privilege ranking — higher number = more privilege. */
const RANK: Record<StaffRole, number> = {
	owner: 4,
	manager: 3,
	host: 2,
	server: 1
};

/** True if `staff` holds at least `minRole`. */
export function hasRole(staff: StaffSession | null | undefined, minRole: StaffRole): boolean {
	if (!staff) return false;
	const have = RANK[staff.role];
	const need = RANK[minRole];
	return typeof have === 'number' && typeof need === 'number' && have >= need;
}

/**
 * Assert `staff` holds at least `minRole`, else throw 403 (401 if not signed in).
 * Returns the staff (narrowed non-null) so it can be used inline.
 */
export function requireRole(
	staff: StaffSession | null | undefined,
	minRole: StaffRole
): StaffSession {
	if (!staff) throw error(401, 'Sign in required.');
	if (!hasRole(staff, minRole)) {
		throw error(403, `This action requires the ${minRole} role or higher.`);
	}
	return staff;
}

/**
 * requireRole, except that a person holding `grant` (from the Team page) passes
 * too. For the pages an owner can open to one person below their level — keep
 * `grant` matching the route's ROUTE_GRANT entry in $lib/admin/access.ts.
 */
export function requireRoleOrGrant(
	staff: StaffSession | null | undefined,
	minRole: StaffRole,
	grant: AdminGrant
): StaffSession {
	if (staff?.grants?.includes(grant)) return staff;
	return requireRole(staff, minRole);
}

// ---------------------------------------------------------------------------
// Capability matrix (plan RBAC §11)
// ---------------------------------------------------------------------------
//
//   live-floor writes (seat/clear/status on the live floor):  all roles
//   create / amend / cancel bookings:                          host+
//   money (deposits/refunds/captures), floor-edit, settings,
//     CRM (customer edits/exports):                            manager+
//   staff management:                                          owner only

export type Capability =
	| 'live_floor' // seat / clear / move on the live floor during service
	| 'booking_create'
	| 'booking_amend'
	| 'booking_cancel'
	| 'money' // deposits, refunds, captures, no-show holds
	| 'floor_edit' // floor-editor CAD changes (tables/walls/layout)
	| 'settings' // edit geisha_settings (incl. integration keys)
	| 'crm' // customer edits / exports / GDPR
	| 'staff_mgmt'; // create/edit/deactivate staff

/** Minimum role required for each capability. */
const CAPABILITY_MIN: Record<Capability, StaffRole> = {
	live_floor: 'server',
	booking_create: 'host',
	booking_amend: 'host',
	booking_cancel: 'host',
	money: 'manager',
	floor_edit: 'manager',
	settings: 'manager',
	crm: 'manager',
	staff_mgmt: 'owner'
};

/** True if `staff` is allowed to perform `capability`. */
export function can(staff: StaffSession | null | undefined, capability: Capability): boolean {
	return hasRole(staff, CAPABILITY_MIN[capability]);
}

/** Assert `staff` may perform `capability`, else throw 403 (401 if signed out). */
export function requireCapability(
	staff: StaffSession | null | undefined,
	capability: Capability
): StaffSession {
	if (!staff) throw error(401, 'Sign in required.');
	if (!can(staff, capability)) {
		throw error(403, `You do not have permission to perform this action (${capability}).`);
	}
	return staff;
}
