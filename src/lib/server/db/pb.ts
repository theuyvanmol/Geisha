// Server-only PocketBase client for the Geisha booking system.
//
// Talks to the reused `pmm` instance (https://pmm.gtdigital.dev) where all
// Geisha data lives in geisha_* collections. The browser NEVER imports this —
// it lives under src/lib/server so SvelteKit refuses to bundle it client-side.
//
// We authenticate as the PocketBase superuser (admin) so the server can read
// and write every geisha_* collection regardless of record rules. Real staff
// auth is a later phase (BOOKING_SYSTEM_PLAN.md §11); for now all privileged
// access goes through the server using this token.

import PocketBase from 'pocketbase';
import { env } from '$env/dynamic/private';
import { notifyResponse } from '../booking/pulse.js';

let _pb: PocketBase | null = null;

function client(): PocketBase {
	const url = env.POCKETBASE_URL;
	if (!url) throw new Error('POCKETBASE_URL is not set (see .env.example)');
	if (!_pb) {
		_pb = new PocketBase(url);
		_pb.autoCancellation(false); // server-side: don't auto-cancel overlapping requests

		// LIVE SYNC (see booking/pulse.ts): ring the realtime doorbell on every successful
		// write to a service collection. Hooking the CLIENT rather than the individual
		// mutation helpers means no write path can forget to do it — the diary, the floor
		// plan, online guest bookings, the AI assistant and the Stripe webhook all funnel
		// through here. Best-effort and non-blocking by contract: this must never be able
		// to fail, slow, or alter an already-committed mutation, so it swallows everything
		// and always returns `data` untouched.
		_pb.afterSend = (response: Response, data: unknown, options?: { method?: string }) => {
			notifyResponse(response.url, options?.method, response.ok, data);
			return data;
		};
	}
	return _pb;
}

/**
 * Returns an authenticated PocketBase client (superuser). Re-authenticates only
 * when the cached token is missing or expired, so most calls are token-free.
 */
export async function pb(): Promise<PocketBase> {
	const c = client();
	if (c.authStore.isValid) return c;

	const email = env.POCKETBASE_ADMIN_EMAIL;
	const password = env.POCKETBASE_ADMIN_PASSWORD;
	if (!email || !password) {
		throw new Error('POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD not set (see .env.example)');
	}

	// PocketBase 0.23+ superuser auth collection
	await c.collection('_superusers').authWithPassword(email, password);
	return c;
}

/** Convenience: a typed-ish accessor for a geisha collection. */
export async function coll(name: string) {
	return (await pb()).collection(name);
}
