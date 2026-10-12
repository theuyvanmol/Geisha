// GET/HEAD /api/health — "can this device reach the app server?"
//
// Used by the admin connection store ($lib/admin/connection.svelte.ts) to tell a
// genuinely dead line apart from a till that merely has wifi but no broadband —
// navigator.onLine cannot distinguish those, and that is exactly the case that
// matters in a restaurant with a failing connection.
//
// Deliberately touches NOTHING. No PocketBase call, no auth, no settings read: it
// must stay cheap enough to hit freely, and it must answer "is the app reachable"
// rather than "is everything healthy" — a slow database should not make every till
// in the building declare itself offline and hide behind the offline run sheet.

import type { RequestHandler } from './$types';

const headers = {
	// Never let a proxy, a browser or our own service worker answer this from cache:
	// a cached 200 would report a dead server as alive, which is the one failure this
	// endpoint must not have.
	'cache-control': 'no-store, no-cache, must-revalidate',
	'content-type': 'application/json'
};

export const GET: RequestHandler = async () =>
	new Response(JSON.stringify({ ok: true, at: new Date().toISOString() }), { headers });

export const HEAD: RequestHandler = async () => new Response(null, { status: 200, headers });
