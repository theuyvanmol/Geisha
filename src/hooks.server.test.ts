// The auth guard's behaviour when the staff database can't be reached.
//
// Before 2026-09-11 a database outage was indistinguishable from "signed out": the
// guard redirected every open admin screen to /admin/login, where signing in then
// failed with "Incorrect email or password". A signed-in person must instead get an
// honest 503 that leaves their session cookie alone, so the first reload after the
// database returns puts them straight back where they were. Public pages, which
// never needed the staff lookup, must keep rendering.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { parse as devalueParse } from 'devalue';

vi.mock('$env/dynamic/private', () => ({ env: {} }));

let lookup: () => Promise<unknown> = async () => null;

vi.mock('$lib/server/auth/staff.js', async (importActual) => {
	const actual = await importActual<typeof import('$lib/server/auth/staff.js')>();
	return { ...actual, loadStaffFromCookie: () => lookup() };
});

import { StaffStoreUnavailableError } from '$lib/server/auth/staff.js';
import { handle } from './hooks.server';

const HOST = {
	id: 's1',
	name: 'Georgia',
	email: 'georgia@example.com',
	role: 'host',
	restaurants: []
};

function run(path: string) {
	const url = new URL(`https://geisha.test${path}`);
	const event = {
		url,
		request: new Request(url),
		cookies: { get: () => 'a-signed-cookie', set: vi.fn(), delete: vi.fn() },
		locals: {} as Record<string, unknown>
	} as unknown as RequestEvent;
	const resolve = vi.fn(async () => new Response('ok'));
	return { event, resolve, result: handle({ event, resolve }) };
}

/**
 * A form-action POST as the diary's hand-rolled fetch and SvelteKit's use:enhance
 * both send it (`x-sveltekit-action: true`). `enhanced: false` is a plain no-JS
 * form post, which the browser navigates with instead of reading as data.
 */
function runAction(pathAndQuery: string, opts: { enhanced?: boolean } = {}) {
	const url = new URL(`https://geisha.test${pathAndQuery}`);
	const headers: Record<string, string> =
		opts.enhanced === false ? {} : { 'x-sveltekit-action': 'true' };
	const event = {
		url,
		request: new Request(url, { method: 'POST', headers, body: new FormData() }),
		cookies: { get: () => 'a-signed-cookie', set: vi.fn(), delete: vi.fn() },
		locals: {} as Record<string, unknown>
	} as unknown as RequestEvent;
	const resolve = vi.fn(async () => new Response('ok'));
	return { event, resolve, result: handle({ event, resolve }) };
}

/** Decode a reply exactly as SvelteKit's deserialize() does in the browser. */
async function decodeAction(res: Response) {
	const parsed = JSON.parse(await res.text());
	if (parsed.data) parsed.data = devalueParse(parsed.data);
	return parsed as { type?: string; status?: number; data?: { error?: string; code?: string } };
}

/** Settle a handle() call into the thing it threw, or the Response it returned. */
async function outcome(p: ReturnType<typeof handle>) {
	try {
		return await p;
	} catch (e) {
		return e;
	}
}

beforeEach(() => {
	lookup = async () => null;
});

describe('when the staff database is unreachable', () => {
	beforeEach(() => {
		lookup = async () => {
			throw new StaffStoreUnavailableError(new Error('connect timeout'));
		};
	});

	it('answers an admin page with 503 — NOT a redirect to the login page', async () => {
		const { result } = run('/admin/diary');
		const e = await outcome(result);
		expect(isRedirect(e)).toBe(false);
		expect(isHttpError(e) && e.status).toBe(503);
		expect(isHttpError(e) && e.body.message).toMatch(/still signed in/i);
	});

	it('answers a staff API with 503 — NOT 401 "sign in required"', async () => {
		const e = await outcome(run('/api/admin/diary-day').result);
		expect(isHttpError(e) && e.status).toBe(503);
	});

	it('still serves the login page, so nobody is locked out of trying', async () => {
		const { result, resolve } = run('/admin/login');
		expect(await outcome(result)).toBeInstanceOf(Response);
		expect(resolve).toHaveBeenCalled();
	});

	it('still serves public pages — they never needed the staff lookup', async () => {
		const { event, result, resolve } = run('/asia');
		expect(await outcome(result)).toBeInstanceOf(Response);
		expect(resolve).toHaveBeenCalled();
		expect(event.locals.staff).toBeNull();
	});
});

// 2026-09-11: a phone booking for Angel Mcdonnell was typed into the diary during the
// outage and never saved. The guard answered the Create with a redirect (and, after the
// outage fix, a bare `{ message }` error) — and the diary's Book form reads anything that
// isn't `failure` or `error` as SAVED, so the modal closed as if it had worked. A refused
// write must come back as an action FAILURE: the one reply every till's code shows and
// keeps its form for, including the tills already open on an older build.
describe('a refused save is answered with an action FAILURE, never read as saved', () => {
	it('database down: the diary Create is refused with "not saved", not a bare error', async () => {
		lookup = async () => {
			throw new StaffStoreUnavailableError(new Error('connect timeout'));
		};
		const { result, resolve } = runAction('/admin/diary?/create&brand=asia&date=2026-09-11');
		const res = await outcome(result);
		expect(res).toBeInstanceOf(Response);
		expect((res as Response).status).toBe(503);
		const body = await decodeAction(res as Response);
		expect(body.type).toBe('failure');
		expect(body.data?.code).toBe('store_unavailable');
		expect(body.data?.error).toMatch(/not saved/i);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('database down: a booking-page action (use:enhance) is refused the same way', async () => {
		lookup = async () => {
			throw new StaffStoreUnavailableError(new Error('connect timeout'));
		};
		const res = await outcome(runAction('/admin/bookings/abc123?/cancel').result);
		expect((res as Response).status).toBe(503);
		expect((await decodeAction(res as Response)).type).toBe('failure');
	});

	it('signed out: the diary Create is refused as a failure, NOT a redirect the Book form reads as saved', async () => {
		const { result, resolve } = runAction('/admin/diary?/create&brand=asia');
		const res = await outcome(result);
		expect(isRedirect(res)).toBe(false);
		expect((res as Response).status).toBe(401);
		const body = await decodeAction(res as Response);
		expect(body.type).toBe('failure');
		expect(body.data?.code).toBe('signed_out');
		expect(body.data?.error).toMatch(/not saved/i);
		expect(resolve).not.toHaveBeenCalled();
	});

	it("signed out: the floor's writes are refused the same way", async () => {
		const res = await outcome(runAction('/admin/floor?/seat').result);
		expect((res as Response).status).toBe(401);
		expect((await decodeAction(res as Response)).data?.code).toBe('signed_out');
	});

	it('wrong role: a form action the role may not use is refused as a failure', async () => {
		lookup = async () => HOST; // settings is manager+
		const { result, resolve } = runAction('/admin/settings?/save');
		const res = await outcome(result);
		expect((res as Response).status).toBe(403);
		const body = await decodeAction(res as Response);
		expect(body.type).toBe('failure');
		expect(body.data?.code).toBe('forbidden');
		expect(resolve).not.toHaveBeenCalled();
	});
});

describe('normal operation is unchanged', () => {
	it('a signed-out form action on a non-service page still redirects (use:enhance follows it)', async () => {
		const e = await outcome(runAction('/admin/settings?/save').result);
		expect(isRedirect(e) && e.status).toBe(303);
	});

	it('a signed-out plain (no-JS) form post still redirects to sign in', async () => {
		const e = await outcome(runAction('/admin/diary?/create', { enhanced: false }).result);
		expect(isRedirect(e) && e.status).toBe(303);
	});

	it("a signed-in host's diary save goes straight through", async () => {
		lookup = async () => HOST;
		const { result, resolve } = runAction('/admin/diary?/create&brand=asia');
		expect(await outcome(result)).toBeInstanceOf(Response);
		expect(resolve).toHaveBeenCalled();
	});

	it('redirects a signed-out admin page to the login page', async () => {
		const e = await outcome(run('/admin/diary').result);
		expect(isRedirect(e) && e.status).toBe(303);
		expect(isRedirect(e) && e.location).toBe('/admin/login?redirectTo=%2Fadmin%2Fdiary');
	});

	it('answers a signed-out staff API with 401', async () => {
		const e = await outcome(run('/api/admin/diary-day').result);
		expect(isHttpError(e) && e.status).toBe(401);
	});

	it('lets a signed-in host through to the diary', async () => {
		lookup = async () => HOST;
		const { event, result, resolve } = run('/admin/diary');
		expect(await outcome(result)).toBeInstanceOf(Response);
		expect(resolve).toHaveBeenCalled();
		expect(event.locals.staff).toEqual(HOST);
	});
});
