// The site's public origin, for links that leave the server (emails, webhooks).
//
// Most links are built from the incoming request's origin, which is correct and
// needs nothing. But two paths have no guest request to read an origin from:
//
//   • the confirmation email sent from the Stripe webhook (the "request" came
//     from Stripe), and
//   • the reminder / comms crons (no request at all).
//
// Both need an absolute URL a guest can click, and getting it wrong sends them
// to a dead link on a preview deployment. So it is configured, not inferred.
//
// PUBLIC_SITE_URL should name wherever guests actually reach the booking system.
// During the ResDiary→bespoke changeover that is the NEW system's own hostname,
// because the iframe is embedded on the old WordPress site but the manage/cancel
// links must resolve to the app that holds the booking — not to the site the
// guest happened to be looking at.

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/** Fallback when nothing is configured: the live domain. */
const DEFAULT_ORIGIN = 'https://geisharestaurants.co.uk';

/**
 * The public origin, with no trailing slash. Order: PUBLIC_SITE_URL (private
 * env, so it can be set without a rebuild) → the same name in public env (set at
 * build time) → the live domain.
 *
 * Anything unparseable falls back rather than producing `undefined/book/…` in a
 * guest's inbox.
 */
export function siteOrigin(): string {
	const candidate =
		(env.PUBLIC_SITE_URL ?? '').trim() ||
		(publicEnv.PUBLIC_SITE_URL ?? '').trim() ||
		DEFAULT_ORIGIN;
	try {
		return new URL(candidate).origin;
	} catch {
		return DEFAULT_ORIGIN;
	}
}
