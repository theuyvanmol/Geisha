// Which booking engine the public /bookings page renders — and the hard rule
// that guests can only ever be shown the live one.
//
// THE SITUATION
// -------------
// There are three things the page can render:
//
//   'widget'    Our own booking system: the form at /embed/{brand}/book, which has
//               taken the restaurants' real online bookings (and deposits, through
//               Stripe) since September 2026 from inside an iframe on the old
//               WordPress site. Since October 2026 it is what guests get here too
//               — see SiteBooking.svelte.
//   'resdiary'  The client's previous system, embedded as a widget. Kept so the
//               page can be put back on it by changing DEFAULT_ENGINE below.
//   'custom'    The art-directed flows (BookingPanel on Asia, the dial on Fusion).
//               Built but NOT trusted with real reservations: they have never
//               taken a live booking and their card step predates Stripe.
//
// All three need to be reachable DURING DEVELOPMENT, without any chance of a
// guest landing on anything but the default.
//
// THE RULE
// --------
// The toggle is available ONLY when the environment says so. Otherwise the whole
// switch is inert: `resolveEngine()` returns the default no matter what query
// string or localStorage value is present, so no user-controlled input can put a
// guest on the unproven flow.
//
// Two ways in, both deliberate:
//   • `dev` — true only under `vite dev`, false in every built artefact.
//   • PUBLIC_BOOKING_ENGINE_TOGGLE=1 — for a Vercel PREVIEW deployment, so the
//     client can click through the new flow on a real URL. Production must never
//     set this. (It is read via $env/dynamic/public rather than the static form
//     because the static form makes the variable MANDATORY at build time — a
//     production build with it unset would fail outright.)
//
// The failure mode is one-directional: the worst a stale toggle can do in
// production is show the default, which is what production shows anyway.

import { dev } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';

export type BookingEngine = 'widget' | 'resdiary' | 'custom';

export const BOOKING_ENGINE_KEY = 'geisha:booking-engine';
export const BOOKING_ENGINE_PARAM = 'engine';

/** What guests get, always, unless a dev explicitly switches it. */
export const DEFAULT_ENGINE: BookingEngine = 'widget';

/** Is the toggle available in this environment at all? See the header note. */
export const toggleAvailable: boolean =
	dev || publicEnv.PUBLIC_BOOKING_ENGINE_TOGGLE === '1';

/** Narrow an arbitrary string to a BookingEngine, or undefined. */
function parse(value: string | null | undefined): BookingEngine | undefined {
	if (value === 'widget' || value === 'resdiary' || value === 'custom') return value;
	return undefined;
}

/**
 * Resolve the engine to render.
 *
 * Precedence (dev only): ?engine=… in the URL, then the sticky choice in
 * localStorage, then the default. The query param wins so a link can pin an
 * engine regardless of what the browser remembers.
 *
 * In a production build this short-circuits to the default before reading
 * anything, so no user-controlled input can reach the custom flow.
 */
export function resolveEngine(url?: URL): BookingEngine {
	if (!toggleAvailable) return DEFAULT_ENGINE;

	const fromUrl = parse(url?.searchParams.get(BOOKING_ENGINE_PARAM));
	if (fromUrl) {
		persist(fromUrl);
		return fromUrl;
	}

	if (typeof localStorage !== 'undefined') {
		const stored = parse(localStorage.getItem(BOOKING_ENGINE_KEY));
		if (stored) return stored;
	}
	return DEFAULT_ENGINE;
}

/** Remember the dev's choice across navigations. No-op in production builds. */
export function persist(engine: BookingEngine): void {
	if (!toggleAvailable || typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(BOOKING_ENGINE_KEY, engine);
	} catch {
		// private mode / storage disabled — the query param still works.
	}
}
