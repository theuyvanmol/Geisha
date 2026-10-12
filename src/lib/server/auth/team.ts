// Staff (team) management — list / invite / accept / role / activation.
//
// Owner-only in the UI (capability 'staff_mgmt'); this module is the server-side
// engine those actions call. It deliberately needs NO schema migration on the
// shared droplet: an OUTSTANDING INVITE is stored inside the existing
// `password_hash` field using a distinct, non-loginable prefix:
//
//     invite:<saltHex>:<tokenHashHex>:<expiryMs>
//
// A real password is scrypt "<saltHex>:<hashHex>" (two segments). Because an
// invite record's password_hash has the `invite:` prefix, verifyPassword() in
// staff.ts returns false for it (it splits on ':' and the hex parse / keylen
// check fails), so an un-accepted invite can NEVER be logged into. Accepting the
// invite overwrites password_hash with a normal scrypt hash and flips active=true.
//
// The raw invite token is only ever in the emailed link; the DB holds a scrypt
// HASH of it, so a DB leak can't be used to claim an account.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { pb } from '../db/pb.js';
import { hashPassword } from './staff.js';
import type { Staff, StaffRole } from '../db/types.js';

const INVITE_PREFIX = 'invite:';
const INVITE_TTL_MS = 1000 * 60 * 60 * 72; // 72h to accept
const SCRYPT_KEYLEN = 64;

function scryptAsync(value: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(value, salt, SCRYPT_KEYLEN, (err, derived) => (err ? reject(err) : resolve(derived)));
	});
}

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** Roles an owner can assign. (Owner can create owners too — co-owners.) */
export const ASSIGNABLE_ROLES: StaffRole[] = ['owner', 'manager', 'host', 'server'];

export interface TeamMember {
	id: string;
	name: string;
	email: string;
	role: StaffRole | '';
	active: boolean;
	/** 'active' = can sign in; 'invited' = outstanding invite; 'inactive' = deactivated. */
	state: 'active' | 'invited' | 'inactive';
	inviteExpired: boolean;
	created: string;
}

function isInvite(hash: string | undefined): boolean {
	return Boolean(hash && hash.startsWith(INVITE_PREFIX));
}

/** Parsed invite tuple from a stored `invite:` password_hash, or null. */
function parseInvite(hash: string): { saltHex: string; tokenHashHex: string; expiry: number } | null {
	if (!isInvite(hash)) return null;
	const [, saltHex, tokenHashHex, expiryStr] = hash.split(':');
	const expiry = Number(expiryStr);
	if (!saltHex || !tokenHashHex || !Number.isFinite(expiry)) return null;
	return { saltHex, tokenHashHex, expiry };
}

function memberState(rec: Staff): TeamMember['state'] {
	if (isInvite(rec.password_hash)) return 'invited';
	return rec.active === false ? 'inactive' : 'active';
}

function toMember(rec: Staff): TeamMember {
	const inv = parseInvite(rec.password_hash || '');
	return {
		id: rec.id,
		name: rec.name || rec.email,
		email: rec.email,
		role: rec.role,
		active: rec.active !== false,
		state: memberState(rec),
		inviteExpired: inv ? inv.expiry < Date.now() : false,
		created: rec.created
	};
}

/** All staff, most-recently-created first. */
export async function listTeam(): Promise<TeamMember[]> {
	const c = await pb();
	const res = await c.collection('geisha_staff').getFullList<Staff>({ sort: '-created' });
	return res.map(toMember);
}

/** Build the absolute accept-invite URL for an emailed link. */
export function inviteUrl(origin: string, staffId: string, token: string): string {
	const u = new URL('/admin/accept-invite', origin);
	u.searchParams.set('id', staffId);
	u.searchParams.set('token', token);
	return u.toString();
}

/** Hash a raw invite token for storage (scrypt, keyed by the per-invite salt). */
async function hashToken(token: string, salt: Buffer): Promise<string> {
	return (await scryptAsync(token, salt)).toString('hex');
}

export interface InviteResult {
	member: TeamMember;
	/** Raw token — goes ONLY into the emailed link, never persisted. */
	token: string;
}

/**
 * Create a new staff account in the INVITED state (active:false, invite hash) and
 * return the raw token so the caller can email a setup link. Rejects a duplicate
 * email. The account cannot be logged into until the invite is accepted.
 */
export async function inviteStaff(input: {
	email: string;
	name: string;
	role: StaffRole;
	restaurants?: string[];
}): Promise<InviteResult> {
	const email = input.email.trim().toLowerCase();
	if (!email.includes('@')) throw new Error('A valid email is required.');
	if (!ASSIGNABLE_ROLES.includes(input.role)) throw new Error('Pick a valid role.');

	const c = await pb();
	const existing = await c
		.collection('geisha_staff')
		.getFirstListItem<Staff>(`email=${q(email)}`)
		.catch(() => null);
	if (existing) throw new Error('A staff member with that email already exists.');

	const token = randomBytes(32).toString('base64url');
	const salt = randomBytes(16);
	const tokenHashHex = await hashToken(token, salt);
	const password_hash = `${INVITE_PREFIX}${salt.toString('hex')}:${tokenHashHex}:${Date.now() + INVITE_TTL_MS}`;

	const rec = await c.collection('geisha_staff').create<Staff>({
		email,
		name: input.name?.trim() || email,
		role: input.role,
		restaurants: input.restaurants ?? [],
		active: false,
		password_hash
	});
	return { member: toMember(rec), token };
}

/**
 * Re-issue an invite for an account that is still in the invited state (e.g. the
 * first email never arrived or the token expired). Returns a fresh token. Throws
 * if the account isn't an outstanding invite (already accepted/active).
 */
export async function resendInvite(staffId: string): Promise<InviteResult> {
	const c = await pb();
	const rec = await c.collection('geisha_staff').getOne<Staff>(staffId);
	if (!isInvite(rec.password_hash)) {
		throw new Error('This account has already been set up; nothing to resend.');
	}
	const token = randomBytes(32).toString('base64url');
	const salt = randomBytes(16);
	const tokenHashHex = await hashToken(token, salt);
	const password_hash = `${INVITE_PREFIX}${salt.toString('hex')}:${tokenHashHex}:${Date.now() + INVITE_TTL_MS}`;
	const updated = await c.collection('geisha_staff').update<Staff>(staffId, { password_hash });
	return { member: toMember(updated), token };
}

/** Public shape shown on the accept-invite page (no secrets). */
export interface PendingInvite {
	id: string;
	name: string;
	email: string;
	role: StaffRole | '';
}

/**
 * Validate an (id, token) pair against the stored invite hash. Returns the
 * pending invite when valid + unexpired, else null. Constant-time token compare.
 */
export async function verifyInvite(staffId: string, token: string): Promise<PendingInvite | null> {
	if (!staffId || !token) return null;
	let rec: Staff;
	try {
		rec = await (await pb()).collection('geisha_staff').getOne<Staff>(staffId);
	} catch {
		return null;
	}
	const inv = parseInvite(rec.password_hash || '');
	if (!inv) return null;
	if (inv.expiry < Date.now()) return null;
	const expected = Buffer.from(inv.tokenHashHex, 'hex');
	let derived: Buffer;
	try {
		derived = await scryptAsync(token, Buffer.from(inv.saltHex, 'hex'));
	} catch {
		return null;
	}
	if (expected.length !== derived.length || !timingSafeEqual(derived, expected)) return null;
	return { id: rec.id, name: rec.name || rec.email, email: rec.email, role: rec.role };
}

/**
 * Accept an invite: verify the token, set the chosen password and activate the
 * account. Returns the staff id on success (so the caller can sign them in), or
 * throws on an invalid/expired token or a too-short password.
 */
export async function acceptInvite(
	staffId: string,
	token: string,
	password: string
): Promise<string> {
	const invite = await verifyInvite(staffId, token);
	if (!invite) throw new Error('This invite link is invalid or has expired. Ask an owner to resend it.');
	if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
	const password_hash = await hashPassword(password);
	const c = await pb();
	await c.collection('geisha_staff').update(staffId, { password_hash, active: true });
	return staffId;
}

/** Change a member's role. Cannot be used to demote the last active owner. */
export async function setRole(staffId: string, role: StaffRole): Promise<void> {
	if (!ASSIGNABLE_ROLES.includes(role)) throw new Error('Pick a valid role.');
	const c = await pb();
	const rec = await c.collection('geisha_staff').getOne<Staff>(staffId);
	if (rec.role === 'owner' && role !== 'owner' && (await activeOwnerCount()) <= 1) {
		throw new Error('You cannot remove the last owner. Promote another owner first.');
	}
	await c.collection('geisha_staff').update(staffId, { role });
}

/** Deactivate (revoke access). Cannot deactivate the last active owner. */
export async function deactivate(staffId: string): Promise<void> {
	const c = await pb();
	const rec = await c.collection('geisha_staff').getOne<Staff>(staffId);
	if (rec.role === 'owner' && rec.active !== false && (await activeOwnerCount()) <= 1) {
		throw new Error('You cannot deactivate the last owner.');
	}
	await c.collection('geisha_staff').update(staffId, { active: false });
}

/** Re-activate a previously deactivated (already set-up) account. */
export async function reactivate(staffId: string): Promise<void> {
	const c = await pb();
	const rec = await c.collection('geisha_staff').getOne<Staff>(staffId);
	if (isInvite(rec.password_hash)) {
		throw new Error('This account has not been set up yet — resend the invite instead.');
	}
	await c.collection('geisha_staff').update(staffId, { active: true });
}

/** Count active owners with a real (non-invite) password — used for guardrails. */
async function activeOwnerCount(): Promise<number> {
	const c = await pb();
	const owners = await c
		.collection('geisha_staff')
		.getFullList<Staff>({ filter: `role="owner" && active=true` });
	return owners.filter((o) => !isInvite(o.password_hash)).length;
}
