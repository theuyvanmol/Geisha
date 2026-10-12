// Staff authentication + sessions (BUILD FOUNDATION F1).
//
// geisha_staff is a *base* PocketBase collection (NOT a PB auth collection), so
// this module owns the whole password/session story itself:
//   - password_hash is stored as  scrypt   "<saltHex>:<hashHex>"  (node:crypto).
//   - a session is a stateless signed cookie: base64url(payload).HMAC-SHA256,
//     keyed by AUTH_SECRET. No server-side session table is needed; revoke by
//     setting active=false (verified against the DB on every load).
//
// Server-only: imports the superuser PB client. The browser never sees this.

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import { pb } from '../db/pb.js';
import type { Staff, StaffRole } from '../db/types.js';
import type { AdminGrant } from '$lib/admin/access';
import { getStaffGrants } from './grants.js';

// ---------------------------------------------------------------------------
// Secret / config
// ---------------------------------------------------------------------------

const COOKIE_NAME = 'geisha_staff_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const DEV_FALLBACK_SECRET = 'geisha-dev-insecure-secret-change-me';

let warnedNoSecret = false;

/**
 * The HMAC signing key.
 *
 * In dev this falls back to a built-in constant so a fresh clone can sign in without
 * ceremony. In PRODUCTION it throws instead.
 *
 * Why the change: DEV_FALLBACK_SECRET is committed to this repository, so anyone who
 * can read the source can mint a valid session cookie for any staff id — including an
 * owner — and walk into the back office. A misconfigured deploy (AUTH_SECRET absent,
 * mistyped, or scoped to the wrong environment) previously produced nothing but a
 * console warning that no one would ever see in a serverless log, and the site came up
 * looking perfectly healthy while being wide open.
 *
 * A booking system that will not start is a visible, fixable problem. One that starts
 * with forgeable sessions is not. So this fails closed: loud, immediate, unmissable.
 */
function secret(): string {
	const s = env.AUTH_SECRET;
	if (s && s.length > 0) return s;

	if (!dev) {
		throw new Error(
			'AUTH_SECRET is not set. Refusing to sign sessions with the public dev fallback — ' +
				'set AUTH_SECRET in the deployment environment (a long random string) and redeploy.'
		);
	}

	if (!warnedNoSecret) {
		warnedNoSecret = true;
		console.warn(
			'\n[auth] ⚠️  AUTH_SECRET is not set — using an INSECURE built-in dev secret.\n' +
				'[auth] ⚠️  Sessions are forgeable. This is refused outright in production.\n'
		);
	}
	return DEV_FALLBACK_SECRET;
}

// ---------------------------------------------------------------------------
// Password hashing — scrypt, "<saltHex>:<hashHex>"
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, SCRYPT_KEYLEN, (err, derived) => {
			if (err) reject(err);
			else resolve(derived);
		});
	});
}

/** Hash a plaintext password into a storable `password_hash` string. */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const derived = await scryptAsync(password, salt);
	return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Verify a plaintext password against a stored `password_hash`. Constant-time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	if (!stored || !stored.includes(':')) return false;
	const [saltHex, hashHex] = stored.split(':');
	if (!saltHex || !hashHex) return false;
	let expected: Buffer;
	try {
		expected = Buffer.from(hashHex, 'hex');
	} catch {
		return false;
	}
	if (expected.length !== SCRYPT_KEYLEN) return false;
	const derived = await scryptAsync(password, Buffer.from(saltHex, 'hex'));
	// Both are SCRYPT_KEYLEN bytes, so timingSafeEqual is safe to call.
	return timingSafeEqual(derived, expected);
}

// ---------------------------------------------------------------------------
// Session token — base64url(payload).HMAC
// ---------------------------------------------------------------------------

interface SessionPayload {
	sub: string; // staff id
	exp: number; // epoch ms
}

function b64url(buf: Buffer): string {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
	const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
	return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(data: string): string {
	return b64url(createHmac('sha256', secret()).update(data).digest());
}

function makeToken(staffId: string): string {
	const payload: SessionPayload = { sub: staffId, exp: Date.now() + SESSION_TTL_MS };
	const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
	return `${body}.${sign(body)}`;
}

function verifyToken(token: string): SessionPayload | null {
	const dot = token.lastIndexOf('.');
	if (dot <= 0) return null;
	const body = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const expectedSig = sign(body);
	// Constant-time compare of equal-length signatures.
	const a = Buffer.from(sig);
	const b = Buffer.from(expectedSig);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	try {
		const payload = JSON.parse(fromB64url(body).toString('utf8')) as SessionPayload;
		if (!payload || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
		if (payload.exp < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// The shape exposed to the rest of the app (locals.staff)
// ---------------------------------------------------------------------------

export interface StaffSession {
	id: string;
	name: string;
	email: string;
	role: StaffRole;
	restaurants: string[];
	/** Single areas opened for this person above their role (see grants.ts).
	 *  Only filled on the request path (loadStaffFromCookie). */
	grants?: AdminGrant[];
}

function toSession(rec: Staff, grants?: AdminGrant[]): StaffSession {
	return {
		id: rec.id,
		name: rec.name || rec.email,
		email: rec.email,
		role: (rec.role || 'server') as StaffRole,
		restaurants: rec.restaurants ?? [],
		...(grants ? { grants } : {})
	};
}

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

// ---------------------------------------------------------------------------
// "We couldn't ask" is not "no"
// ---------------------------------------------------------------------------

/**
 * The staff store (PocketBase) could not be asked — the droplet is down, out of
 * memory, or not accepting connections.
 *
 * authenticate() and loadStaffFromCookie() used to swallow EVERY PocketBase error
 * and return null. So when the droplet ran out of memory on 2026-09-11 (Vercel got
 * connect timeouts for 12 minutes), every open screen bounced to the login page, and
 * every attempt to sign back in said "Incorrect email or password" for a password
 * that was right all along. Staff chased a password problem that did not exist.
 *
 * Throwing this instead lets each caller say what actually happened: the login form
 * "couldn't check your password", the guard a 503 that leaves the cookie alone so
 * the next reload after the database returns walks straight back in.
 */
export class StaffStoreUnavailableError extends Error {
	constructor(cause: unknown) {
		super('The staff database could not be reached.', { cause });
		this.name = 'StaffStoreUnavailableError';
	}
}

/** PocketBase's "no such record" — the ONLY lookup failure that means the account
 *  genuinely isn't there. Network failures arrive as status 0, overload as 5xx. */
function isNotFound(e: unknown): boolean {
	return (e as { status?: unknown } | null)?.status === 404;
}

function unavailable(e: unknown): StaffStoreUnavailableError {
	console.error('[auth] staff store unreachable:', e);
	return new StaffStoreUnavailableError(e);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Authenticate a staff member by email + password. Returns the session shape on
 * success, or null when the answer is no (unknown email, wrong password, inactive).
 * THROWS StaffStoreUnavailableError when the database could not be asked — that is
 * not a wrong password, and must not be reported as one.
 * Does not set cookies — the caller (login action) does that with `setSessionCookie`.
 */
export async function authenticate(email: string, password: string): Promise<StaffSession | null> {
	const normalised = email.trim().toLowerCase();
	if (!normalised || !password) return null;
	let rec: Staff;
	try {
		const c = await pb();
		rec = await c.collection('geisha_staff').getFirstListItem<Staff>(`email=${q(normalised)}`);
	} catch (e) {
		if (isNotFound(e)) return null; // no such account
		throw unavailable(e);
	}
	if (rec.active === false) return null;
	const ok = await verifyPassword(password, rec.password_hash || '');
	if (!ok) return null;
	return toSession(rec);
}

/**
 * Change a staff member's own password: verify the current password against the
 * stored hash, then overwrite it with a fresh scrypt hash. Throws with a
 * user-facing message on a bad current password, a too-short/blank new password,
 * or an account that has no real password yet (still an outstanding invite).
 *
 * Re-reads the record from the DB (never trusts a cached hash) and, like the
 * login path, refuses inactive accounts.
 */
export async function changePassword(
	staffId: string,
	currentPassword: string,
	newPassword: string
): Promise<void> {
	if (!newPassword || newPassword.length < 8) {
		throw new Error('Your new password must be at least 8 characters.');
	}
	if (newPassword === currentPassword) {
		throw new Error('Your new password must be different from your current one.');
	}
	const c = await pb();
	let rec: Staff;
	try {
		rec = await c.collection('geisha_staff').getOne<Staff>(staffId);
	} catch {
		throw new Error('Your account could not be found. Sign out and back in.');
	}
	if (rec.active === false) throw new Error('This account is inactive.');
	// An outstanding invite has no real password to verify against.
	if (!rec.password_hash || rec.password_hash.startsWith('invite:')) {
		throw new Error('This account has not finished setup yet.');
	}
	const ok = await verifyPassword(currentPassword, rec.password_hash);
	if (!ok) throw new Error('Your current password is incorrect.');
	const password_hash = await hashPassword(newPassword);
	await c.collection('geisha_staff').update(staffId, { password_hash });
}

/** Issue a signed session cookie for an authenticated staff member. */
export function setSessionCookie(cookies: Cookies, staffId: string): void {
	cookies.set(COOKIE_NAME, makeToken(staffId), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !env.AUTH_INSECURE_COOKIE, // allow http in local dev via AUTH_INSECURE_COOKIE=1
		maxAge: Math.floor(SESSION_TTL_MS / 1000)
	});
}

/** Clear the session cookie (logout). */
export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(COOKIE_NAME, { path: '/' });
}

/**
 * Load the current staff member from the request cookie, or null. Verifies the
 * cookie signature/expiry locally, THEN re-checks the DB so a deactivated or
 * deleted account is rejected even with a still-valid cookie.
 *
 * THROWS StaffStoreUnavailableError when that re-check can't be made. Returning
 * null there is what signed the whole floor out during a database outage.
 */
export async function loadStaffFromCookie(cookies: Cookies): Promise<StaffSession | null> {
	const token = cookies.get(COOKIE_NAME);
	if (!token) return null;
	const payload = verifyToken(token);
	if (!payload) return null;
	let rec: Staff;
	// Grants are fetched alongside, not after: usually a cache hit, and when not,
	// the PocketBase round trip shouldn't be paid twice in a row. getStaffGrants
	// never throws — a failed read just means no extra access.
	const grants = getStaffGrants(payload.sub);
	try {
		const c = await pb();
		rec = await c.collection('geisha_staff').getOne<Staff>(payload.sub);
	} catch (e) {
		if (isNotFound(e)) return null; // account deleted
		throw unavailable(e);
	}
	if (rec.active === false) return null;
	return toSession(rec, await grants);
}

// ---------------------------------------------------------------------------
// First-run bootstrap
// ---------------------------------------------------------------------------

/** True when no staff accounts exist yet (controls first-run setup access). */
export async function noStaffExist(): Promise<boolean> {
	try {
		const c = await pb();
		const res = await c.collection('geisha_staff').getList<Staff>(1, 1);
		return res.totalItems === 0;
	} catch {
		// If we can't tell, fail closed (treat as staff existing) so we never open
		// the bootstrap form on a DB error.
		return false;
	}
}

/**
 * Create the first OWNER account. Only succeeds when zero staff exist — callers
 * MUST gate on noStaffExist() too, but this re-checks atomically-ish as a guard.
 * Returns the created session, or throws if staff already exist / inputs invalid.
 */
export async function bootstrapOwner(
	email: string,
	password: string,
	name: string
): Promise<StaffSession> {
	const normalised = email.trim().toLowerCase();
	if (!normalised.includes('@')) throw new Error('A valid email is required.');
	if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
	if (!(await noStaffExist())) throw new Error('Staff already exist; bootstrap is disabled.');

	const c = await pb();
	const password_hash = await hashPassword(password);
	const rec = await c.collection('geisha_staff').create<Staff>({
		email: normalised,
		name: name?.trim() || normalised,
		role: 'owner',
		restaurants: [],
		active: true,
		password_hash
	});
	return toSession(rec);
}

/**
 * If ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD are set in the env AND no
 * staff exist yet, auto-create the owner from them. Returns the session if it
 * created one, else null. Idempotent and safe to call on every login attempt.
 */
export async function maybeBootstrapFromEnv(): Promise<StaffSession | null> {
	const email = env.ADMIN_BOOTSTRAP_EMAIL;
	const password = env.ADMIN_BOOTSTRAP_PASSWORD;
	if (!email || !password) return null;
	if (!(await noStaffExist())) return null;
	try {
		return await bootstrapOwner(email, password, env.ADMIN_BOOTSTRAP_NAME || 'Owner');
	} catch (e) {
		console.error('[auth] env bootstrap failed:', e);
		return null;
	}
}
