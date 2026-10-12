// Forgotten-password reset for staff accounts.
//
// geisha_staff is a plain PocketBase collection, not a PB auth collection, so
// there is no built-in requestPasswordReset() to lean on — this module is the
// whole flow: issue a token, email a link, verify it, set the new hash.
//
// WHERE THE TOKEN LIVES
// ---------------------
// In a geisha_settings row keyed `pwreset:<staffId>`, holding
// { saltHex, tokenHashHex, expiry }. NOT in password_hash — the `invite:` trick
// in team.ts can do that because an invited account has no password to protect,
// whereas a reset must leave the CURRENT password working until a new one is
// chosen. Overwriting it would lock the person out the moment they clicked
// "forgot", which is the exact failure this feature exists to fix.
//
// A settings row also needs no schema migration, which matters here: the
// PocketBase droplet's migrations are applied by hand, so anything that wanted a
// new field on geisha_staff could not ship until someone SSHed in.
//
// The raw token is only ever in the emailed link. The row holds a scrypt HASH of
// it, so a leak of the settings collection cannot be used to seize an account.
//
// SINGLE USE, AND SELF-INVALIDATING: the row is deleted the moment a reset
// completes, and re-requesting overwrites it, so only the newest link works.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { pb } from '../db/pb.js';
import { getRestaurant } from '../booking/queries.js';
import { hashPassword } from './staff.js';
import type { Setting, Staff } from '../db/types.js';

/** How long a reset link stays good. Deliberately much shorter than the 72h
 *  invite TTL: an invite is expected to sit in an inbox until someone gets round
 *  to it, whereas a reset is requested by a person who is trying to sign in right
 *  now, and a live link to an existing account is worth more to an attacker. */
const RESET_TTL_MS = 1000 * 60 * 60; // 1h

const SCRYPT_KEYLEN = 64;

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** The settings key holding one staff member's outstanding reset token. */
export const resetKey = (staffId: string) => `pwreset:${staffId}`;

function scryptAsync(value: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(value, salt, SCRYPT_KEYLEN, (err, derived) => (err ? reject(err) : resolve(derived)));
	});
}

interface StoredReset {
	saltHex: string;
	tokenHashHex: string;
	expiry: number;
}

function parseStored(raw: unknown): StoredReset | null {
	const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
	if (!v) return null;
	const saltHex = typeof v.saltHex === 'string' ? v.saltHex : '';
	const tokenHashHex = typeof v.tokenHashHex === 'string' ? v.tokenHashHex : '';
	const expiry = typeof v.expiry === 'number' ? v.expiry : Number(v.expiry);
	if (!saltHex || !tokenHashHex || !Number.isFinite(expiry)) return null;
	return { saltHex, tokenHashHex, expiry };
}

/** geisha_settings rows are restaurant-scoped, but a reset token isn't a property
 *  of a restaurant — every row is anchored on Asia purely because the collection
 *  requires a parent. Same convention as auth/prefs.ts; don't read it as a brand. */
async function anchorId(): Promise<string> {
	return (await getRestaurant('asia')).id;
}

async function findRow(staffId: string): Promise<Setting | null> {
	const c = await pb();
	return c
		.collection('geisha_settings')
		.getFirstListItem<Setting>(`restaurant=${q(await anchorId())} && key=${q(resetKey(staffId))}`)
		.catch(() => null);
}

/** Build the absolute reset URL for the emailed link. */
export function resetUrl(origin: string, staffId: string, token: string): string {
	const u = new URL('/admin/reset-password', origin);
	u.searchParams.set('id', staffId);
	u.searchParams.set('token', token);
	return u.toString();
}

/** What a reset request resolved to, so the caller knows which email to send.
 *  The caller must NOT vary its HTTP response by this — see requestReset. */
export type ResetRequest =
	| { kind: 'reset'; staff: Staff; token: string }
	/** The account exists but has never been set up — a reset would be a dead end,
	 *  so the caller re-sends the account-setup invite instead. */
	| { kind: 'invite'; staff: Staff }
	/** No such account, or it is deactivated. Nothing is sent. */
	| { kind: 'none' };

/**
 * Issue a reset token for an email address.
 *
 * Returns what happened so the caller can pick the right email — but the PAGE
 * must answer identically in all three cases. This form is public, and an
 * "unknown email" reply turns it into an oracle that confirms which addresses
 * hold admin accounts: exactly the list an attacker wants before pointing a
 * password guesser at /admin/login.
 *
 * Never throws: a PocketBase blip resolves to 'none' rather than a 500, which
 * would itself distinguish a real account from a made-up one.
 */
export async function requestReset(email: string): Promise<ResetRequest> {
	const normalised = email.trim().toLowerCase();
	if (!normalised.includes('@')) return { kind: 'none' };

	let rec: Staff;
	try {
		const c = await pb();
		rec = await c.collection('geisha_staff').getFirstListItem<Staff>(`email=${q(normalised)}`);
	} catch {
		return { kind: 'none' };
	}

	// An invited-but-not-accepted account has no password to reset; its setup link
	// is the thing they actually need, and sending a reset link instead would drop
	// them on a page that can only tell them it didn't work. Deactivated accounts
	// get nothing — a reset must not be a way back in for revoked access.
	if ((rec.password_hash || '').startsWith('invite:')) return { kind: 'invite', staff: rec };
	if (rec.active === false) return { kind: 'none' };

	const token = randomBytes(32).toString('base64url');
	const salt = randomBytes(16);
	const tokenHashHex = (await scryptAsync(token, salt)).toString('hex');
	const value = {
		saltHex: salt.toString('hex'),
		tokenHashHex,
		expiry: Date.now() + RESET_TTL_MS
	};

	try {
		const c = await pb();
		const existing = await findRow(rec.id);
		if (existing) await c.collection('geisha_settings').update(existing.id, { value });
		else
			await c
				.collection('geisha_settings')
				.create({ restaurant: await anchorId(), key: resetKey(rec.id), value });
	} catch {
		return { kind: 'none' };
	}

	return { kind: 'reset', staff: rec, token };
}

/** The non-secret details shown on the reset form once the link checks out. */
export interface PendingReset {
	id: string;
	name: string;
	email: string;
}

/**
 * Validate an (id, token) pair against the stored reset row. Returns the pending
 * reset when valid and unexpired, else null. Constant-time token compare.
 */
export async function verifyReset(staffId: string, token: string): Promise<PendingReset | null> {
	if (!staffId || !token) return null;

	let rec: Staff;
	try {
		rec = await (await pb()).collection('geisha_staff').getOne<Staff>(staffId);
	} catch {
		return null;
	}
	if (rec.active === false) return null;

	const row = await findRow(staffId).catch(() => null);
	const stored = parseStored(row?.value);
	if (!stored) return null;
	if (stored.expiry < Date.now()) return null;

	let expected: Buffer;
	let derived: Buffer;
	try {
		expected = Buffer.from(stored.tokenHashHex, 'hex');
		derived = await scryptAsync(token, Buffer.from(stored.saltHex, 'hex'));
	} catch {
		return null;
	}
	if (expected.length !== derived.length || !timingSafeEqual(derived, expected)) return null;

	return { id: rec.id, name: rec.name || rec.email, email: rec.email };
}

/**
 * Complete a reset: verify the token, write the new password hash, and consume
 * the token so the link cannot be replayed out of the person's inbox — or anyone
 * else's, which in a restaurant sharing one mailbox is not hypothetical.
 *
 * Returns the staff id so the caller can sign them straight in.
 */
export async function completeReset(
	staffId: string,
	token: string,
	password: string
): Promise<string> {
	const pending = await verifyReset(staffId, token);
	if (!pending) {
		throw new Error('This reset link is invalid or has expired. Request a new one below.');
	}
	if (!password || password.length < 8) {
		throw new Error('Your new password must be at least 8 characters.');
	}

	const c = await pb();
	const password_hash = await hashPassword(password);
	await c.collection('geisha_staff').update(staffId, { password_hash });

	// Consume the token. Best-effort: the password IS already changed, and failing
	// the whole reset over a stale row would be worse than the row lingering — it
	// no longer matches any live link and expires within the hour regardless.
	try {
		const row = await findRow(staffId);
		if (row) await c.collection('geisha_settings').delete(row.id);
	} catch {
		// leave it; it expires on its own
	}

	return staffId;
}
