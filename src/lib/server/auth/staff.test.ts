// Coverage for staff sign-in and session loading (staff.ts). PocketBase is mocked;
// the real password hashing and cookie signing run.
//
// The property these pin down: A DATABASE OUTAGE IS NOT A WRONG PASSWORD, AND NOT A
// SIGN-OUT. Both functions used to swallow every PocketBase error and return null, so
// when the droplet ran out of memory on 2026-09-11 (12:22–12:34 UTC, connect timeouts)
// every open screen bounced to the login page, and every attempt to sign back in said
// "Incorrect email or password" — for a password that was right all along. Staff
// chased a password problem that did not exist while guests' bookings were failing.
//
// Only PocketBase's 404 means "there is no such account". Anything else means we never
// got an answer, and callers must be told so they can say so.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientResponseError } from 'pocketbase';
import type { Cookies } from '@sveltejs/kit';

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_SECRET: 'test-secret' } }));

type Row = Record<string, unknown> & { id: string };
let staff: Row[] = [];
/** When set, every PocketBase call fails with this instead of answering. */
let outage: unknown = null;
/** When set, obtaining the (superuser) client itself fails with this. */
let connectFailure: unknown = null;
let dbCalls = 0;

const notFound = () =>
	new ClientResponseError({ status: 404, response: { message: "The requested resource wasn't found." } });
/** What the SDK throws when the TCP connect to the droplet times out. */
const connectTimeout = () =>
	new ClientResponseError({
		status: 0,
		originalError: Object.assign(new TypeError('fetch failed'), {
			cause: { code: 'UND_ERR_CONNECT_TIMEOUT' }
		})
	});

const collection = () => ({
	getOne: async (id: string) => {
		dbCalls++;
		if (outage) throw outage;
		const hit = staff.find((r) => r.id === id);
		if (!hit) throw notFound();
		return hit;
	},
	getFirstListItem: async (filter: string) => {
		dbCalls++;
		if (outage) throw outage;
		const email = /email="([^"]+)"/.exec(filter)?.[1];
		const hit = staff.find((r) => r.email === email);
		if (!hit) throw notFound();
		return hit;
	}
});

vi.mock('../db/pb.js', () => ({
	pb: async () => {
		if (connectFailure) throw connectFailure;
		return { collection };
	}
}));

import {
	authenticate,
	hashPassword,
	loadStaffFromCookie,
	setSessionCookie,
	StaffStoreUnavailableError
} from './staff.js';

const EMAIL = 'georgia@example.com';
const PASSWORD = 'correct-horse-battery';

/** A minimal in-memory cookie jar: enough for set → get round-trips. */
function jar(): Cookies {
	const store = new Map<string, string>();
	return {
		get: (name: string) => store.get(name),
		set: (name: string, value: string) => void store.set(name, value),
		delete: (name: string) => void store.delete(name)
	} as unknown as Cookies;
}

/** A jar holding a genuinely signed session for staff id `s1`. */
function signedInJar(): Cookies {
	const c = jar();
	setSessionCookie(c, 's1');
	return c;
}

beforeEach(async () => {
	outage = null;
	connectFailure = null;
	dbCalls = 0;
	staff = [
		{
			id: 's1',
			email: EMAIL,
			name: 'Georgia',
			role: 'host',
			restaurants: [],
			active: true,
			password_hash: await hashPassword(PASSWORD)
		}
	];
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('authenticate', () => {
	it('signs in with the right password', async () => {
		expect(await authenticate(EMAIL, PASSWORD)).toMatchObject({ id: 's1', role: 'host' });
	});

	it('matches the email case-insensitively', async () => {
		expect(await authenticate('  GEORGIA@Example.com ', PASSWORD)).toMatchObject({ id: 's1' });
	});

	it('returns null for a wrong password', async () => {
		expect(await authenticate(EMAIL, 'not-it')).toBeNull();
	});

	it('returns null for an unknown email (PocketBase 404)', async () => {
		expect(await authenticate('nobody@example.com', PASSWORD)).toBeNull();
	});

	it('returns null for a deactivated account', async () => {
		staff[0].active = false;
		expect(await authenticate(EMAIL, PASSWORD)).toBeNull();
	});

	it('THROWS when the database cannot be reached — null would be reported as a wrong password', async () => {
		outage = connectTimeout();
		await expect(authenticate(EMAIL, PASSWORD)).rejects.toBeInstanceOf(StaffStoreUnavailableError);
	});

	it('THROWS when PocketBase answers with a server error', async () => {
		outage = new ClientResponseError({ status: 503 });
		await expect(authenticate(EMAIL, PASSWORD)).rejects.toBeInstanceOf(StaffStoreUnavailableError);
	});

	it('THROWS when the superuser connection itself fails', async () => {
		connectFailure = connectTimeout();
		await expect(authenticate(EMAIL, PASSWORD)).rejects.toBeInstanceOf(StaffStoreUnavailableError);
	});

	it('does not touch the database for a blank email or password', async () => {
		expect(await authenticate('', PASSWORD)).toBeNull();
		expect(await authenticate(EMAIL, '')).toBeNull();
		expect(dbCalls).toBe(0);
	});
});

describe('loadStaffFromCookie', () => {
	it('returns the staff member for a valid cookie', async () => {
		expect(await loadStaffFromCookie(signedInJar())).toMatchObject({ id: 's1', email: EMAIL });
	});

	it('returns null with no cookie, without touching the database', async () => {
		outage = connectTimeout(); // would throw if it were consulted
		expect(await loadStaffFromCookie(jar())).toBeNull();
		expect(dbCalls).toBe(0);
	});

	it('returns null for a tampered cookie, without touching the database', async () => {
		const c = signedInJar();
		const token = c.get('geisha_staff_session')!;
		c.set('geisha_staff_session', token.slice(0, -2) + 'xx', { path: '/' });
		outage = connectTimeout();
		expect(await loadStaffFromCookie(c)).toBeNull();
		expect(dbCalls).toBe(0);
	});

	it('returns null when the account has been deleted (PocketBase 404)', async () => {
		const c = signedInJar();
		staff = [];
		expect(await loadStaffFromCookie(c)).toBeNull();
	});

	it('returns null when the account has been deactivated — revocation still works', async () => {
		const c = signedInJar();
		staff[0].active = false;
		expect(await loadStaffFromCookie(c)).toBeNull();
	});

	it('THROWS when the database cannot be reached — an outage must not sign anyone out', async () => {
		const c = signedInJar();
		outage = connectTimeout();
		await expect(loadStaffFromCookie(c)).rejects.toBeInstanceOf(StaffStoreUnavailableError);
	});

	it('THROWS when the superuser connection itself fails', async () => {
		const c = signedInJar();
		connectFailure = connectTimeout();
		await expect(loadStaffFromCookie(c)).rejects.toBeInstanceOf(StaffStoreUnavailableError);
	});
});
