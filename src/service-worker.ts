/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// Offline shell for the restaurant.
//
// THE PROBLEM THIS SOLVES
// ───────────────────────
// Every screen in this app — including the diary the floor runs service from —
// arrives over the network. When the line drops mid-service the staff do not get a
// degraded board; they get the browser's "no internet" page, and the restaurant is
// running blind with a room full of people.
//
// This worker guarantees that the app itself always loads. Combined with the
// persisted day cache ($lib/service/dayStore.ts) and /admin/offline, that turns a
// dead screen into "here is tonight's book as it stood at 18:42".
//
// WHAT IT DELIBERATELY DOES NOT DO
// ────────────────────────────────
// It does not cache API or data responses. That is the tempting shortcut and it is
// the wrong one: a silently-served stale availability or booking response would let
// a screen look live while being wrong, which in a booking system is worse than an
// honest error. All offline DATA goes through the day cache, which timestamps what
// it holds and shows that timestamp to the user. The worker's job is the shell.
//
// It also never touches non-GET requests, so no mutation can be intercepted,
// deferred or replayed by accident.
//
// CACHE SAFETY
// ────────────
// `version` changes on every build, so each deploy gets a fresh cache and the old
// one is deleted on activate. That is what stops the classic service-worker failure
// where users are pinned to a stale build forever. Build assets are content-hashed
// and immutable, so they are safe to serve cache-first; everything else is
// network-first, meaning the network always wins when it is available and the cache
// is only ever a fallback.

import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const SHELL = `shell-${version}`;
const RUNTIME = `runtime-${version}`;

/** The page shown when a navigation fails and we have nothing cached for it. */
const OFFLINE_URL = '/offline.html';

/**
 * Precached on install. `build` is the content-hashed JS/CSS for this deploy.
 *
 * `files` (everything in static/) is deliberately FILTERED rather than taken whole:
 * static/ holds ~15 menu PDFs and a video, tens of megabytes that would make every
 * install a large download and could blow the origin's storage quota on a phone.
 * Only the small shell assets are worth precaching; the PDFs are a guest-facing
 * nicety that can fail offline without consequence.
 */
const PRECACHE = [
	...build,
	...files.filter((f) => /\.(png|jpg|jpeg|svg|ico|webmanifest)$/i.test(f) && !f.includes('/media/')),
	OFFLINE_URL
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(SHELL);
			// addAll is atomic — one 404 fails the whole install and we would ship a
			// worker that never activates. Add individually and tolerate misses.
			await Promise.all(
				PRECACHE.map((url) => cache.add(url).catch(() => undefined))
			);
			// Take over immediately rather than waiting for every tab to close. A till
			// that is open for a fortnight would otherwise never pick up a new worker.
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== SHELL && key !== RUNTIME) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

/**
 * Sign-out purge. The admin shell posts this when staff sign out, because the
 * runtime cache can hold admin HTML with guest details rendered into it, and that
 * must not survive the session. (The day cache clears itself the same way — see
 * dayCache.forgetAllDays.)
 */
self.addEventListener('message', (event) => {
	if (event.data?.type === 'purge-private') {
		event.waitUntil(caches.delete(RUNTIME));
	}
});

const isBuildAsset = (url: URL) =>
	build.includes(url.pathname) || url.pathname.startsWith('/_app/immutable/');

self.addEventListener('fetch', (event) => {
	const req = event.request;

	// Mutations, cross-origin (R2 media, the PocketBase pulse), and SvelteKit's own
	// data requests are all left entirely alone.
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== self.location.origin) return;

	// Content-hashed and immutable: cache-first is both safe and the whole point —
	// this is what makes the app boot with no network.
	if (isBuildAsset(url)) {
		event.respondWith(
			(async () => {
				const hit = await caches.match(req);
				if (hit) return hit;
				const res = await fetch(req);
				if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
				return res;
			})()
		);
		return;
	}

	// Never cache data endpoints — see the note at the top of this file. Let them
	// fail honestly so the app can show its offline state rather than stale truth.
	if (url.pathname.startsWith('/api/')) return;

	// Page navigations: network-first, cache as a fallback, offline page as the
	// last resort. The network always wins when it is there, so nobody is ever
	// pinned to a stale page while online.
	if (req.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					const res = await fetch(req);
					if (res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
					return res;
				} catch {
					const hit = await caches.match(req);
					if (hit) return hit;
					// An admin route with nothing cached goes to the offline run-sheet,
					// which reads the persisted board out of IndexedDB — far more useful
					// than a generic "you are offline" card.
					if (url.pathname.startsWith('/admin')) {
						const runsheet = await caches.match('/admin/offline');
						if (runsheet) return runsheet;
					}
					return (
						(await caches.match(OFFLINE_URL)) ??
						new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
					);
				}
			})()
		);
		return;
	}

	// Everything else same-origin (fonts, icons, the odd static file): network-first
	// with a cache fallback, so a flaky line degrades instead of breaking.
	event.respondWith(
		(async () => {
			try {
				const res = await fetch(req);
				if (res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
				return res;
			} catch {
				const hit = await caches.match(req);
				if (hit) return hit;
				throw new Error('offline and uncached');
			}
		})()
	);
});

export {};
