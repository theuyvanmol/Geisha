// Coverage for the staff password-reset engine (reset.ts). PocketBase is mocked;
// the real token issue / verify / consume logic runs, including the scrypt work.
//
// These pin the properties the flow is worthless without:
//   1. The CURRENT password keeps working until the reset completes. Getting this
//      wrong locks out everyone who clicks "forgot" and then changes their mind —
//      which is why the token lives in its own row and not in password_hash.
//   2. A link works ONCE. The consumed row is what stops a reset link sitting in a
//      shared restaurant mailbox as a permanent skeleton key.
//   3. Requesting again invalidates the older link, so a stolen earlier email is
//      dead the moment the real person asks for a new one.
//   4. Wrong / expired / deactivated never verifies.

import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };

let staff: Row[] = [];
let settings: Row[] = [];
let nextId = 1;

/** Pull `key="…"` / `email="…"` out of the PB filter strings reset.ts builds. */
function field(filter: string, name: string): string | undefined {
	return new RegExp(`${name}="([^"]+)"`).exec(filter)?.[1];
}

const collection = (name: string) => {
	const table = () => (name === 'geisha_staff' ? staff : settings);
	return {
		getOne: async (id: string) => {
			const hit = table().find((r) => r.id === id);
			if (!hit) throw new Error('not found');
			return hit;
		},
		getFirstListItem: async (filter: string) => {
			const hit =
				name === 'geisha_staff'
					? staff.find((r) => r.email === field(filter, 'email'))
					: settings.find(
							(r) =>
								r.key === field(filter, 'key') && r.restaurant === field(filter, 'restaurant')
						);
			if (!hit) throw new Error('not found');
			return hit;
		},
		update: async (id: string, data: Record<string, unknown>) => {
			const row = table().find((r) => r.id === id);
			if (!row) throw new Error('not found');
			Object.assign(row, data);
			return row;
		},
		create: async (data: Record<string, unknown>) => {
			const row = { id: `r${nextId++}`, ...data } as Row;
			table().push(row);
			return row;
		},
		delete: async (id: string) => {
			const list = table();
			const i = list.findIndex((r) => r.id === id);
			if (i >= 0) list.splice(i, 1);
			return true;
		}
	};
};

vi.mock('../db/pb.js', () => ({ pb: async () => ({ collection }) }));
vi.mock('../booking/queries.js', () => ({
	getRestaurant: async () => ({ id: 'rest_asia' })
}));

import { hashPassword, verifyPassword } from './staff.js';
import { completeReset, requestReset, resetKey, resetUrl, verifyReset } from './reset.js';

const EMAIL = 'simone@geisharestaurant.co.uk';
const OLD_PASSWORD = 'the-old-one';

/** The stored reset row for a staff id, or undefined. */
const rowFor = (id: string) => settings.find((r) => r.key === resetKey(id));

beforeEach(async () => {
	settings = [];
	nextId = 1;
	staff = [
		{
			id: 's1',
			email: EMAIL,
			name: 'Simone',
			role: 'owner',
			active: true,
			password_hash: await hashPassword(OLD_PASSWORD)
		}
	];
});

describe('requestReset', () => {
	it('issues a token and stores only a HASH of it', async () => {
		const result = await requestReset(EMAIL);
		expect(result.kind).toBe('reset');
		if (result.kind !== 'reset') return;

		const stored = rowFor('s1');
		expect(stored).toBeDefined();
		// A DB leak must not yield a usable link.
		expect(JSON.stringify(stored?.value)).not.toContain(result.token);
	});

	it('matches the address case-insensitively, as the login path does', async () => {
		expect((await requestReset('  SIMONE@GeishaRestaurant.co.uk ')).kind).toBe('reset');
	});

	it('leaves the current password working — the whole reason the token is not stored in password_hash', async () => {
		await requestReset(EMAIL);
		const rec = staff[0];
		expect(await verifyPassword(OLD_PASSWORD, rec.password_hash as string)).toBe(true);
	});

	it('routes an un-accepted invite to the invite flow instead of a dead reset link', async () => {
		staff[0].password_hash = 'invite:aa:bb:9999999999999';
		const result = await requestReset(EMAIL);
		expect(result.kind).toBe('invite');
		expect(rowFor('s1')).toBeUndefined(); // no reset token issued
	});

	it('does nothing for a deactivated account — a reset is not a way back in', async () => {
		staff[0].active = false;
		expect((await requestReset(EMAIL)).kind).toBe('none');
		expect(rowFor('s1')).toBeUndefined();
	});

	it('reports nothing for an unknown address (the caller must answer identically anyway)', async () => {
		expect((await requestReset('nobody@example.com')).kind).toBe('none');
		expect((await requestReset('not-an-email')).kind).toBe('none');
	});

	it('invalidates the previous link when a fresh one is requested', async () => {
		const first = await requestReset(EMAIL);
		const second = await requestReset(EMAIL);
		if (first.kind !== 'reset' || second.kind !== 'reset') throw new Error('expected resets');

		expect(settings.filter((r) => r.key === resetKey('s1'))).toHaveLength(1);
		expect(await verifyReset('s1', first.token)).toBeNull();
		expect(await verifyReset('s1', second.token)).not.toBeNull();
	});
});

describe('verifyReset', () => {
	it('accepts the issued token and rejects a wrong one', async () => {
		const result = await requestReset(EMAIL);
		if (result.kind !== 'reset') throw new Error('expected a reset');

		expect(await verifyReset('s1', result.token)).toMatchObject({ id: 's1', email: EMAIL });
		expect(await verifyReset('s1', 'not-the-token')).toBeNull();
		expect(await verifyReset('s1', '')).toBeNull();
		expect(await verifyReset('nope', result.token)).toBeNull();
	});

	it('rejects an expired token', async () => {
		const result = await requestReset(EMAIL);
		if (result.kind !== 'reset') throw new Error('expected a reset');

		const row = rowFor('s1');
		row!.value = { ...(row!.value as object), expiry: Date.now() - 1 };
		expect(await verifyReset('s1', result.token)).toBeNull();
	});

	it('rejects a token for an account deactivated after it was issued', async () => {
		const result = await requestReset(EMAIL);
		if (result.kind !== 'reset') throw new Error('expected a reset');

		staff[0].active = false;
		expect(await verifyReset('s1', result.token)).toBeNull();
	});
});

describe('completeReset', () => {
	it('sets the new password, retires the old one, and consumes the link', async () => {
		const result = await requestReset(EMAIL);
		if (result.kind !== 'reset') throw new Error('expected a reset');

		expect(await completeReset('s1', result.token, 'a-brand-new-one')).toBe('s1');

		const hash = staff[0].password_hash as string;
		expect(await verifyPassword('a-brand-new-one', hash)).toBe(true);
		expect(await verifyPassword(OLD_PASSWORD, hash)).toBe(false);

		// Single use: the row is gone, so the same link cannot be replayed out of a
		// shared inbox.
		expect(rowFor('s1')).toBeUndefined();
		await expect(completeReset('s1', result.token, 'another-one-again')).rejects.toThrow(
			/invalid or has expired/i
		);
	});

	it('refuses a short password and leaves the link usable', async () => {
		const result = await requestReset(EMAIL);
		if (result.kind !== 'reset') throw new Error('expected a reset');

		await expect(completeReset('s1', result.token, 'short')).rejects.toThrow(/8 characters/);
		expect(await verifyPassword(OLD_PASSWORD, staff[0].password_hash as string)).toBe(true);
		expect(await verifyReset('s1', result.token)).not.toBeNull();
	});

	it('refuses a bad token without touching the password', async () => {
		await requestReset(EMAIL);
		await expect(completeReset('s1', 'wrong', 'a-brand-new-one')).rejects.toThrow();
		expect(await verifyPassword(OLD_PASSWORD, staff[0].password_hash as string)).toBe(true);
	});
});

describe('resetUrl', () => {
	it('points at the reset page carrying id + token', () => {
		const u = new URL(resetUrl('https://example.test', 's1', 'tok en/+'));
		expect(u.pathname).toBe('/admin/reset-password');
		expect(u.searchParams.get('id')).toBe('s1');
		// Round-trips through the query string intact — base64url tokens contain
		// characters a naive concatenation would mangle.
		expect(u.searchParams.get('token')).toBe('tok en/+');
	});
});
