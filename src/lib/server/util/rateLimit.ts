// Request rate limiting for the public + auth-facing endpoints.
//
// WHY THIS EXISTS
// ───────────────
// Two endpoints were reachable from the open internet with no throttle at all:
//
//   • POST /api/bookings — anyone could script a few hundred fake reservations and
//     close the restaurant's book. That is a direct revenue loss, and unlike most
//     security problems it needs no skill to pull off.
//   • the /admin/login form action — unlimited password guesses against staff
//     accounts, which are the door to 870 customers' names, phones and emails.
//
// WHAT THIS IS (and what it deliberately is not)
// ──────────────────────────────────────────────
// A sliding-window counter held in module memory. On Vercel that memory is
// PER WARM LAMBDA INSTANCE, so this is NOT a globally exact quota: a burst spread
// across many cold starts gets more than its nominal allowance.
//
// That is a deliberate trade, not an oversight:
//   • It stops the realistic attack — one script hammering one endpoint — because
//     a sustained flood keeps hitting warm instances and gets throttled.
//   • It costs ZERO round-trips. A DB-backed counter would add a PocketBase call to
//     every booking lookup on the site's hottest public path.
//   • The abuse that DOES get through a distributed attempt is caught downstream by
//     the velocity guard in $lib/server/booking/velocity.ts, which asks the database
//     "has this person already booked five times today?" and is exact.
//
// So: this layer is the cheap blunt instrument, velocity.ts is the precise one, and
// a WAF (Cloudflare/Vercel) in front is the third. None of them is sufficient alone.
//
// PocketBase's own rate limiter should ALSO be switched on (it ships with sensible
// rules but `enabled: false`); that protects the database's own API surface, which
// this code cannot see.

/** One caller's hit timestamps within the current window. */
type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

/** Stop the Map growing without bound on a long-lived instance. Cheap: we only
 *  sweep when we cross the threshold, and only drop buckets with no live hits. */
const MAX_BUCKETS = 5000;

export interface RateLimitRule {
	/** Window length in milliseconds. */
	windowMs: number;
	/** Requests permitted per key per window. */
	max: number;
}

export interface RateLimitResult {
	/** true when the caller is within its allowance (the request may proceed). */
	ok: boolean;
	/** Requests still available in this window (0 when blocked). */
	remaining: number;
	/** Whole seconds until the window frees up. 0 when not blocked. */
	retryAfter: number;
}

function sweep(now: number, windowMs: number) {
	for (const [key, bucket] of buckets) {
		const live = bucket.hits.filter((t) => now - t < windowMs);
		if (live.length === 0) buckets.delete(key);
		else bucket.hits = live;
	}
}

/**
 * Record a hit for `key` and report whether it is allowed.
 *
 * Sliding window rather than fixed buckets: a fixed window lets an attacker send
 * `max` requests at 11:59:59 and `max` again at 12:00:00, doubling the intended
 * rate at the boundary. The cost is keeping the timestamps, which for these limits
 * is a handful of numbers per caller.
 */
export function rateLimit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
	if (buckets.size > MAX_BUCKETS) sweep(now, rule.windowMs);

	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = { hits: [] };
		buckets.set(key, bucket);
	}

	// Drop everything that has aged out of the window.
	bucket.hits = bucket.hits.filter((t) => now - t < rule.windowMs);

	if (bucket.hits.length >= rule.max) {
		// Blocked. Do NOT record this hit: counting rejected attempts would let a
		// caller who keeps hammering extend their own lockout indefinitely, which
		// turns a rate limit into a self-inflicted denial of service for a guest
		// who is merely refreshing.
		const oldest = bucket.hits[0];
		const waitMs = rule.windowMs - (now - oldest);
		return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
	}

	bucket.hits.push(now);
	return { ok: true, remaining: rule.max - bucket.hits.length, retryAfter: 0 };
}

/**
 * The caller's IP, as trustworthy as we can make it behind Vercel's proxy.
 *
 * `x-forwarded-for` is a client-settable header everywhere EXCEPT behind a proxy
 * that overwrites it — which Vercel does. We take the LEFTMOST entry (the original
 * client) rather than the rightmost, and fall back to SvelteKit's getClientAddress.
 *
 * If this ever runs somewhere without a trusted proxy in front, an attacker can
 * spoof the header and defeat the per-IP limit. That is precisely why the booking
 * path does not rely on IP alone — see velocity.ts.
 */
export function clientKey(request: Request, fallback: () => string): string {
	const fwd = request.headers.get('x-forwarded-for');
	if (fwd) {
		const first = fwd.split(',')[0]?.trim();
		if (first) return first;
	}
	const real = request.headers.get('x-real-ip');
	if (real) return real.trim();
	try {
		return fallback();
	} catch {
		return 'unknown';
	}
}

// ---------------------------------------------------------------------------
// The rules themselves, named so the call sites read as policy rather than magic
// numbers. Tuned to be invisible to a real guest and obstructive to a script.
// ---------------------------------------------------------------------------

/** Creating reservations. A guest books once, maybe twice; five an hour from one
 *  address is already generous for a family booking several tables. */
export const BOOKING_CREATE: RateLimitRule = { windowMs: 60 * 60 * 1000, max: 5 };

/** Joining the waitlist — same shape of action, same allowance. */
export const WAITLIST_JOIN: RateLimitRule = { windowMs: 60 * 60 * 1000, max: 5 };

/** Contact-form messages. A guest sends one; a spam script sends thousands, and
 *  every one of them lands in a human's inbox on the admin Enquiries page. */
export const CONTACT_SEND: RateLimitRule = { windowMs: 60 * 60 * 1000, max: 5 };

/** Availability lookups. Deliberately loose: the booking widget legitimately
 *  fires several as a guest scrolls dates, and blocking these breaks the UI.
 *  This is scrape/DoS protection, not abuse protection. */
export const AVAILABILITY_READ: RateLimitRule = { windowMs: 60 * 1000, max: 60 };

/** Staff password attempts. Ten per fifteen minutes per IP is far more than a
 *  human mistypes and far less than a dictionary needs. */
export const LOGIN_ATTEMPT: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 10 };

/** Per-ACCOUNT login attempts, so a distributed attack on one known staff email
 *  is throttled even though every request arrives from a different address. */
export const LOGIN_ACCOUNT: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 20 };

/** Password-reset requests, per IP. This form is public and every accepted
 *  request sends real email, so an unthrottled one is both a way to bury a
 *  colleague's inbox and a fast way to burn the Brevo daily allowance the
 *  booking confirmations depend on. */
export const RESET_REQUEST: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 5 };

/** Per-ACCOUNT reset requests. Looser than the IP rule for the same reason
 *  LOGIN_ACCOUNT is: the whole restaurant shares one router, so this must not
 *  lock a shift out because two people asked at once. */
export const RESET_ACCOUNT: RateLimitRule = { windowMs: 60 * 60 * 1000, max: 5 };

/** Attempts to SUBMIT a reset link (id + token). Guessing a 256-bit token is not
 *  a realistic attack, but an unthrottled endpoint that does an scrypt derivation
 *  per request is a cheap way to pin the server's CPU. */
export const RESET_SUBMIT: RateLimitRule = { windowMs: 15 * 60 * 1000, max: 20 };

/** TEST ONLY — drop all state so cases can't leak counts into each other. */
export function __resetRateLimits() {
	buckets.clear();
}
