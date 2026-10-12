import { redirect, error, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { loadStaffFromCookie, StaffStoreUnavailableError } from '$lib/server/auth/staff.js';
import { fallback, video } from '$lib/media/responsive';
import { runWithActor } from '$lib/server/util/actor.js';
import { CLIENT_ID_HEADER } from '$lib/admin/clientId';
import { ADMIN_PUBLIC_PATHS, canOpenPath } from '$lib/admin/access';
import { resolveLegacyRedirect } from '$lib/server/legacyRedirects';
import { stringify as devalueStringify } from 'devalue';

/**
 * Map a legacy /Content folder/… path to its optimized CDN URL, or null if we
 * have no variant for it (let that 404 as it always would have).
 */
function legacyMediaUrl(path: string): string | null {
	const img = fallback(path);
	if (img) return img;
	const clip = video(path);
	return clip.src && clip.src !== path ? clip.src : null;
}

// Paths under /admin reachable WITHOUT a session, so the guard never locks staff
// out of signing in. The set lives in $lib/admin/access.ts because the admin
// layout needs exactly the same list to decide which pages render bare.
const ADMIN_PUBLIC = ADMIN_PUBLIC_PATHS;

/**
 * Who may frame the booking widget and the confirmation page.
 *
 * `'self'` covers our own /{brand}/bookings pages. booking.resdiary.com is there
 * because ResDiary redirects ITS widget frame to our confirmation page. The two
 * geisharestaurants.co.uk entries are the client's WordPress site, which embeds
 * /embed/{brand}/book during the changeover trial — both the apex and www, since
 * a visitor arriving on either must get a working iframe.
 *
 * Additional origins can be added at deploy time with FRAME_ANCESTORS (space-
 * separated), so a staging host can be trialled without a code change. Anything
 * set there REPLACES this list, so it must include every origin that still needs
 * to frame us.
 */
const FRAME_ANCESTORS =
	(env.FRAME_ANCESTORS ?? '').trim() ||
	[
		"'self'",
		'https://booking.resdiary.com',
		'https://geisharestaurants.co.uk',
		'https://www.geisharestaurants.co.uk'
	].join(' ');

/** What a signed-in person sees when the database is down. Says the two things they
 *  need: it isn't them, and they don't need to sign in again. */
const STAFF_STORE_DOWN =
	'The booking system can’t reach its database right now. You’re still signed in — ' +
	'reload in a minute and you’ll be straight back in. No need to sign in again.';

// ---------------------------------------------------------------------------
// A refused SAVE must never read as a saved one.
// ---------------------------------------------------------------------------
//
// 2026-09-11: a phone booking typed into the diary during the database outage was
// never written, and the till showed it as saved. The guard below refuses a signed-out
// or can't-check-the-session request with a redirect or a thrown error — fine for a
// page, but a form ACTION posted from JS gets them back as `{ type: 'redirect' }` (an
// HTTP 200) and a bare `{ message }` with no `type` at all. The diary's Book, Edit and
// Walk-in read anything that isn't `failure`/`error` as success, and its shared
// postAction reads a type-less reply as success too — so the modal closed and nothing
// was saved.
//
// The one reply EVERY client path handles — the diary's hand-rolled fetches, the
// shared postServiceAction, SvelteKit's use:enhance, and the tills already open on
// older builds — is an action FAILURE. So a refused action gets one, with a plain
// "not saved" message, and a real 4xx/5xx status so the refusals are visible in the
// request log instead of hiding among the 200s.

/** The views service runs from. Their writes are JS fetches that ignore redirects. */
const SERVICE_VIEWS = new Set(['/admin/diary', '/admin/floor']);

/** A form action submitted from JS — SvelteKit's enhance and every service write send this. */
const isActionRequest = (request: Request) =>
	request.method === 'POST' && request.headers.get('x-sveltekit-action') === 'true';

/**
 * Refuse a form action the way SvelteKit's own `fail()` serialises: `data` is a
 * devalue string, which the browser's `deserialize()` decodes.
 */
function refuseAction(status: number, code: string, message: string): Response {
	return new Response(
		JSON.stringify({ type: 'failure', status, data: devalueStringify({ error: message, code }) }),
		{ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }
	);
}

const NOT_SAVED_STORE_DOWN =
	'Not saved — the booking system can’t reach its database right now. You’re still signed ' +
	'in: leave this open and try again in a minute.';
const NOT_SAVED_SIGNED_OUT =
	'Not saved — you’ve been signed out. Sign in again, then make this change again.';
const NOT_SAVED_FORBIDDEN = 'Not saved — your role can’t make this change. Ask a manager.';

// API routes that demand a signed-in staff member (return 401 rather than
// redirecting, since they're called by fetch()). The AI surfaces can act on the
// booking DB, so they MUST be staff-gated like the rest of the back office.
function isGuardedApi(path: string): boolean {
	return (
		path === '/api/admin-chat' ||
		path.startsWith('/api/admin-chat/') ||
		path.startsWith('/api/admin/')
	);
}

export const handle: Handle = async (input) =>
	// Bind the acting tab (sent by every mutating request from the service views) to this
	// request's async context, so the pulse writer can stamp it on the realtime doorbell it
	// rings — that's what lets a board ignore its OWN echo without going blind to everyone
	// else's changes. See src/lib/admin/clientId.ts.
	runWithActor(input.event.request.headers.get(CLIENT_ID_HEADER) ?? '', () => handleRequest(input));

const handleRequest: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	// 0) Legacy media safety net.
	//
	// The raw photos in static/Content folder/ are no longer deployed — the site
	// serves optimized AVIF/WebP variants from Cloudflare R2 (see
	// $lib/media/responsive). Every component was migrated, but a stale <img src>,
	// an old CMS blob, or an external link to one of these paths would otherwise
	// 404. Redirect to the CDN equivalent instead.
	//
	// Only fires for paths that never resolve to a real static file, so it costs
	// nothing on the happy path.
	if (path.startsWith('/Content folder/') || path.startsWith('/Content%20folder/')) {
		const target = legacyMediaUrl(decodeURIComponent(path));
		if (target) redirect(308, target);
	}

	// 0b) Old WordPress URLs.
	//
	// This domain served three WordPress installs before this rebuild, on entirely
	// different paths. Without these, the day DNS moves is the day every indexed
	// URL, every shared link and every table QR code pointing at a menu PDF starts
	// 404ing. See $lib/server/legacyRedirects for how the map was derived and what
	// is deliberately left to 404.
	//
	// 301 rather than 308: these are permanent moves of GET pages, and 301 is what
	// search engines treat as the canonical "this lives here now" signal.
	const legacy = resolveLegacyRedirect(path);
	if (legacy) redirect(301, legacy);

	// 1) Always populate locals.staff (null when signed out / bad cookie).
	//
	// A DATABASE OUTAGE IS NOT A SIGN-OUT. When the staff lookup can't be made, the
	// guards below answer 503 instead of redirecting to the login page — which is
	// what they used to do, and where signing in then failed with "Incorrect email or
	// password" until the database came back (2026-09-11). The cookie is untouched, so
	// the first reload after recovery walks straight back in. Public pages never needed
	// the lookup and carry on as if signed out.
	let staffStoreDown = false;
	try {
		event.locals.staff = await loadStaffFromCookie(event.cookies);
	} catch (e) {
		if (!(e instanceof StaffStoreUnavailableError)) throw e;
		event.locals.staff = null;
		staffStoreDown = true;
	}

	// 2) Cron routes: gate on the shared CRON_SECRET instead of staff.
	//
	// TWO ACCEPTED FORMS, because two different schedulers call these:
	//   • `x-cron-secret: <secret>`      — an external scheduler (a crontab on the
	//                                      droplet, cron-job.org, PocketBase cron).
	//   • `Authorization: Bearer <secret>` — VERCEL CRON, which sends exactly this
	//                                      when a CRON_SECRET env var exists and
	//                                      gives you no way to add a custom header.
	//
	// Supporting only the first meant Vercel's own scheduler could never
	// authenticate, so the release sweep and the reminder email would have been
	// scheduled and silently 401ing.
	if (path.startsWith('/api/cron/')) {
		if (!env.CRON_SECRET) throw error(503, 'Cron not configured (set CRON_SECRET).');
		const headerSecret = event.request.headers.get('x-cron-secret');
		const bearer = event.request.headers.get('authorization');
		const authorised = headerSecret === env.CRON_SECRET || bearer === `Bearer ${env.CRON_SECRET}`;
		if (!authorised) throw error(401, 'Unauthorized');
		// authorised cron — fall through to resolve()
	}

	// 3) Admin pages: redirect to the login screen when signed out (except the
	//    login/setup pages themselves, which must stay reachable), then enforce
	//    the role each page needs (src/lib/admin/access.ts). Hiding the sidebar
	//    link is cosmetic — this is what stops a floor host from reaching the
	//    floor editor / settings / guest data by typing the URL.
	else if (path === '/admin' || path.startsWith('/admin/')) {
		if (!ADMIN_PUBLIC.has(path)) {
			const action = isActionRequest(event.request);
			if (!event.locals.staff) {
				if (staffStoreDown) {
					if (action) return refuseAction(503, 'store_unavailable', NOT_SAVED_STORE_DOWN);
					throw error(503, STAFF_STORE_DOWN);
				}
				// Other pages' use:enhance follows a redirect to the login screen, so only
				// the service views — whose fetches don't — need the failure instead.
				if (action && SERVICE_VIEWS.has(path)) {
					return refuseAction(401, 'signed_out', NOT_SAVED_SIGNED_OUT);
				}
				const to = encodeURIComponent(event.url.pathname + event.url.search);
				throw redirect(303, `/admin/login?redirectTo=${to}`);
			}
			if (!canOpenPath(event.locals.staff.role, path, event.locals.staff.grants)) {
				if (action) return refuseAction(403, 'forbidden', NOT_SAVED_FORBIDDEN);
				throw error(
					403,
					'You do not have access to this page. Ask a manager if you need it opened up.'
				);
			}
		}
	}

	// 4) Guarded admin/AI APIs: 401 JSON-able error when signed out, 403 when the
	//    signed-in role is below what the endpoint needs (same access map).
	else if (isGuardedApi(path)) {
		if (!event.locals.staff) {
			throw staffStoreDown ? error(503, STAFF_STORE_DOWN) : error(401, 'Sign in required.');
		}
		if (!canOpenPath(event.locals.staff.role, path, event.locals.staff.grants)) {
			throw error(403, 'Your role does not allow this action.');
		}
	}

	// 5) Brand stamp for the public art-directed pages (unchanged): put
	//    data-route-brand on <html> during SSR so the first painted frame uses
	//    the brand's ground colour instead of flashing the browser default.
	const brand = path.startsWith('/fusion') ? 'fusion' : path.startsWith('/asia') ? 'asia' : '';

	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			brand
				? html.replace('<html lang="en">', `<html lang="en" data-route-brand="${brand}">`)
				: html
	});

	// 6) Security response headers.
	//
	// Cheap, standard hardening that costs nothing at runtime. Deliberately NOT a
	// Content-Security-Policy: this app inlines styles and the admin builds markup
	// that a strict CSP would break, so a CSP added blind here would either be so
	// permissive it means nothing or would silently break the diary mid-service.
	// (If we want one, SvelteKit can generate a nonce-based policy via
	// kit.csp in svelte.config.js — that is a deliberate project, not a one-liner.)
	//
	// HSTS is set on the apex response so a staff member who types the domain without
	// https:// on the restaurant's wifi cannot be downgraded to plain http and have a
	// session cookie lifted. `preload` is intentionally omitted — it is effectively
	// irreversible and should only be added once a custom domain is settled.
	const headers = response.headers;
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('X-Frame-Options', 'SAMEORIGIN');
	// `payment=()` blocks the Payment Request API, which is what Apple Pay and
	// Google Pay run on. That's the right default for a marketing site — but the
	// booking widget's card form offers exactly those wallets, and a blanket denial
	// silently removes the fastest way to pay a deposit on a phone. So the embed
	// grants it to itself and to Stripe's frames (the wallet sheet is opened by
	// js.stripe.com, nested inside ours, so both origins must be listed).
	//
	// The HOST page must also grant it on the iframe tag — `allow="payment"` — or
	// its own policy overrides ours. See the embed snippet in the changeover notes.
	//
	// The site's own booking pages mount that same widget directly (SiteBooking),
	// so they need the same grant — without it a deposit there could only be paid
	// by typing a card number.
	const takesPayment =
		path.startsWith('/embed/') ||
		path === '/asia/bookings' ||
		path === '/fusion/bookings' ||
		path === '/asia/bookings/' ||
		path === '/fusion/bookings/';
	headers.set(
		'Permissions-Policy',
		takesPayment
			? 'geolocation=(), camera=(), payment=(self "https://js.stripe.com")'
			: 'geolocation=(), camera=(), payment=()'
	);

	// Two things must be framable cross-origin, and for the same underlying reason:
	// a booking is taken inside someone else's iframe.
	//
	//   • /embed/{brand}/book — our own booking widget, embedded on the client's
	//     WordPress site in place of the ResDiary widget.
	//   • /{brand}/booking-confirmation — where the frame is redirected once the
	//     booking is taken. Under ResDiary the framing parent is
	//     booking.resdiary.com; under our widget it is the WordPress site. Left on
	//     SAMEORIGIN the browser blocks the render and the guest's booking ends in
	//     an empty box.
	//
	// (The confirmation case currently goes unnoticed only because ResDiary still
	// points at the old WordPress page, which sends no framing header at all. It
	// would have started failing the moment the domain moved.)
	//
	// X-Frame-Options can't express "these specific origins" (ALLOW-FROM is dead in
	// every current browser), so it's dropped in favour of CSP frame-ancestors,
	// which can — and which browsers prefer where both are present. Neither page
	// holds a session: the confirmation only echoes back query parameters, and the
	// widget's writes all go through the same public, rate-limited /api/bookings
	// that the site's own booking page uses.
	if (
		path === '/asia/booking-confirmation' ||
		path === '/fusion/booking-confirmation' ||
		path.startsWith('/embed/')
	) {
		headers.delete('X-Frame-Options');
		headers.set('Content-Security-Policy', `frame-ancestors ${FRAME_ANCESTORS}`);
	}
	if (event.url.protocol === 'https:') {
		headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	// The back office must never be cached by a shared proxy, and must never be
	// served from the browser's back/forward cache after a sign-out.
	if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin')) {
		headers.set('Cache-Control', 'no-store, private');
		headers.set('X-Robots-Tag', 'noindex, nofollow');
	}

	return response;
};
