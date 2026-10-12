// Validation for the widget's post-booking redirect target.
//
// Its own module rather than a helper inside +page.server.ts because SvelteKit
// only permits its known exports (load, actions, prerender, …) from a server
// route file — anything else is an "Invalid export" that 500s the page — and
// because this is the security-critical part, so it deserves to be directly
// testable.
//
// WHY A REDIRECT PARAMETER EXISTS AT ALL
// -------------------------------------
// ResDiary redirects its widget frame to a URL configured in its account once a
// booking is taken. Ours matches that contract so the client can point the
// widget at their existing WordPress thank-you page during the changeover trial,
// by adding ?redirect=… to the iframe src.
//
// WHY IT IS ALLOWLISTED
// --------------------
// An unchecked ?redirect= is an open redirect: a link that looks exactly like
// the restaurant's booking flow, on the restaurant's own domain, that lands the
// guest somewhere else entirely. Anything not explicitly permitted returns '',
// and the widget falls back to its own confirmation page.

/** Hosts a post-booking redirect may target, besides our own origin. */
export const REDIRECT_ALLOWLIST = new Set([
	'geisharestaurants.co.uk',
	'www.geisharestaurants.co.uk'
]);

/**
 * Validate a caller-supplied redirect target against `origin`.
 *
 * DON'T PATTERN-MATCH THE STRING — RESOLVE IT AND JUDGE THE RESULT.
 * ----------------------------------------------------------------
 * This used to accept anything starting with a single `/` as a relative path,
 * blocking only the two forms it knew browsers treat as absolute (`//host` and
 * `/\host`). That is the wrong shape of check, and it leaked:
 *
 *     ?redirect=/%09/evil.com   →  "/\t/evil.com"  →  https://evil.com/
 *
 * The URL parser STRIPS tab, CR and LF from anywhere in a URL before parsing
 * (WHATWG URL §"basic URL parser"), so a value that reads as a relative path to
 * `startsWith` reads as protocol-relative to the browser. `.trim()` doesn't help:
 * the control character is in the middle, not at the ends. Any check that tries
 * to enumerate the dangerous prefixes will keep losing this race.
 *
 * So: reject control characters outright, then hand the value to the SAME parser
 * the browser will use, and make the decision on the resolved URL. What we
 * validate is then exactly what `new URL(target, location.origin)` produces in
 * $lib/components/guest/EmbedBookingWidget.svelte — no second interpretation for
 * an attacker to get between.
 *
 * Relative paths still come back relative (they can only resolve to us).
 * Absolute URLs must be https — which also rules out `javascript:` and `data:` —
 * and must match our origin exactly or sit on an allowlisted HOSTNAME. Comparing
 * hostname rather than a suffix is what stops `geisharestaurants.co.uk.evil.com`.
 */
export function safeRedirect(raw: string | null | undefined, origin: string): string {
	const value = raw?.trim();
	if (!value) return '';

	// C0 controls + DEL. Tab/CR/LF are the exploitable ones (the parser deletes
	// them mid-string); the rest have no business in a redirect target either.
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001F\u007F]/.test(value)) return '';

	// A leading `/` means "relative to us" and gets `origin` as its base. Anything
	// else must be absolute on its own — no base — so a bare `foo` still fails.
	const relative = value.startsWith('/');
	let url: URL;
	try {
		url = new URL(value, relative ? origin : undefined);
	} catch {
		return ''; // not a URL at all
	}

	// Resolved back onto us: hand back the path so the widget's own base applies.
	// `//evil.com` and `/\evil.com` both resolve AWAY from us and fall through to
	// the allowlist below, which refuses them — no special case needed.
	if (url.origin === origin) {
		return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
	}

	if (url.protocol !== 'https:') return '';
	if (REDIRECT_ALLOWLIST.has(url.hostname)) return url.toString();
	return '';
}
