// Guest self-service token authority + thin amend/cancel wrappers (WP-S9-2).
//
// A logged-out guest opens a signed link from their confirmation email and can
// amend or cancel their OWN booking from the public /book/[token] page — no
// account, no staff intervention. The token is a stateless HMAC binding the
// booking id (and an expiry) to a server secret, so it is tamper-proof and
// self-contained (no DB lookup to validate the link itself).
//
// All crypto is server-only (Node's crypto). The page/loader never sees the
// secret; it calls verifyBookingToken() and gets back just a booking id (or null
// for an invalid/expired/forged link, which renders the friendly fallback).
//
// Token shape (three base64url parts, dot-joined):
//   base64url(`${bookingId}.${exp}`) . base64url(HMAC-SHA256(payload, secret))
// where `payload` is the literal `${bookingId}.${exp}` string and `exp` is a
// unix-seconds expiry. We constant-time compare the recomputed HMAC on verify.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { pb } from '../db/pb.js';
import type { Booking, Customer, Payment, Restaurant } from '../db/types.js';
import { amendBooking, type AmendBookingInput } from './amend.js';
import { BookingError } from './create.js';
import { cancelBooking } from './mutate.js';
import { isLateCancellation, LATE_CANCELLATION_LABEL, type PaymentRequirement } from './policy.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

// --- secret resolution -------------------------------------------------------
// Mirrors stripe.ts/send.ts graceful posture: prefer the dedicated
// BOOKING_LINK_SECRET; if unset, derive a stable key off an existing private env
// (POCKETBASE_ADMIN_PASSWORD) so dev still works. If NO secret material exists at
// all we refuse to mint/verify (verify always returns null) rather than fall back
// to a guessable constant — a leaked-but-working insecure state is worse than a
// disabled feature.

/** True once we have real secret material to sign links with. */
export function isConfigured(): boolean {
	return Boolean(env.BOOKING_LINK_SECRET || env.POCKETBASE_ADMIN_PASSWORD);
}

let warnedNoSecret = false;
let warnedDerived = false;
function resolveSecret(): string | null {
	const explicit = env.BOOKING_LINK_SECRET;
	if (explicit) return explicit;
	const derived = env.POCKETBASE_ADMIN_PASSWORD;
	if (derived) {
		// The fallback keeps dev working, but it is not a good place to leave a
		// deployment. Two reasons, and neither is visible without saying so:
		//
		//   1. It ties every outstanding management link to the DATABASE SUPERUSER
		//      password. Rotating that — which you should be able to do freely —
		//      silently invalidates every link already sitting in a guest's inbox.
		//   2. POCKETBASE_ADMIN_PASSWORD is typically scoped to preview builds too,
		//      so the signing key ends up in a lower-trust environment than the
		//      tokens it authorises.
		//
		// Warned once per instance rather than per call, and it names the fix.
		if (!warnedDerived) {
			warnedDerived = true;
			console.warn(
				'[selfservice] BOOKING_LINK_SECRET is not set — signing management links with a key ' +
					'derived from POCKETBASE_ADMIN_PASSWORD. Set BOOKING_LINK_SECRET (production-scoped) ' +
					'so link validity does not depend on the database superuser password.'
			);
		}
		return `geisha-booking-link:${derived}`;
	}
	if (!warnedNoSecret) {
		warnedNoSecret = true;
		console.error(
			'[selfservice] BOOKING_LINK_SECRET is not set and no fallback secret is ' +
				'available — self-service management links are DISABLED until a secret is configured.'
		);
	}
	return null;
}

// --- base64url helpers (no padding) -----------------------------------------
function b64url(buf: Buffer): string {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Buffer {
	const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
	return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** Default link lifetime when we can't derive a per-booking expiry: 180 days. */
const DEFAULT_TTL_SECONDS = 180 * 24 * 60 * 60;

/**
 * How long a link stays live AFTER the meal it manages, when we know the date.
 *
 * The flat 180 days was the whole lifetime of a link, regardless of when the
 * booking was — so a token sat valid for months after the table had come and
 * gone, which is precisely the window in which a forwarded confirmation email
 * turns into someone else's cancel button. Two weeks is enough slack for a guest
 * chasing a refund and short enough that a stale link is inert.
 */
const GRACE_AFTER_BOOKING_SECONDS = 14 * 24 * 60 * 60;

/**
 * The expiry a link for this booking should carry: shortly after the booking
 * itself, or the flat default when the date is unknown/unparseable. Never longer
 * than the default, so this can only ever tighten a link's life.
 */
export function expiryForBooking(endsAtIso: string | undefined): number {
	const fallback = Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS;
	if (!endsAtIso) return fallback;
	const ends = new Date(endsAtIso).getTime();
	if (!Number.isFinite(ends)) return fallback;
	return Math.min(Math.floor(ends / 1000) + GRACE_AFTER_BOOKING_SECONDS, fallback);
}

/**
 * Mint a signed self-service token for a booking. `exp` is unix seconds; callers
 * may pass a booking-end-based expiry (e.g. ends_at + 90 days) so old links die.
 * Returns '' when no secret is configured (caller treats that as "no link").
 */
export function signBookingToken(bookingId: string, exp?: number): string {
	const secret = resolveSecret();
	if (!secret) return '';
	const expiry = exp ?? Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS;
	const payload = `${bookingId}.${expiry}`;
	const sig = createHmac('sha256', secret).update(payload).digest();
	return `${b64url(Buffer.from(payload))}.${b64url(sig)}`;
}

/**
 * Verify a self-service token and return its booking id, or null for any
 * invalid / expired / tampered / unparseable token. Never throws — callers
 * translate null into the "this link is no longer valid" screen.
 */
export function verifyBookingToken(token: string): { bookingId: string } | null {
	const secret = resolveSecret();
	if (!secret || !token) return null;
	try {
		const parts = token.split('.');
		if (parts.length !== 2) return null;
		const [payloadPart, sigPart] = parts;
		const payload = fromB64url(payloadPart).toString('utf8');
		const dot = payload.lastIndexOf('.');
		if (dot <= 0) return null;
		const bookingId = payload.slice(0, dot);
		const expStr = payload.slice(dot + 1);
		const exp = Number(expStr);
		if (!bookingId || !Number.isFinite(exp)) return null;

		// Constant-time HMAC compare.
		const expected = createHmac('sha256', secret).update(payload).digest();
		const given = fromB64url(sigPart);
		if (given.length !== expected.length) return null;
		if (!timingSafeEqual(given, expected)) return null;

		// Expiry check AFTER signature so a forged token can't probe timing on exp.
		if (exp < Math.floor(Date.now() / 1000)) return null;

		return { bookingId };
	} catch {
		return null;
	}
}

// --- scoped tokens ------------------------------------------------------------
// Same wire shape as a booking token, but signed with a key DERIVED per scope.
// A link minted for one job (e.g. 'feedback' — "how was your meal?") therefore
// cannot be replayed at /book/[token], which can CANCEL the booking, and a
// management link cannot be replayed at the scoped page either. Nothing is stored.
//
// A derived key rather than a scope prefix inside the signed text: with a prefix,
// re-encoding a feedback token's payload as `feedback:<id>.<exp>` kept its
// signature valid for the booking verifier (as booking id 'feedback:<id>').

function scopedMac(secret: string, scope: string, payload: string): Buffer {
	const key = createHmac('sha256', secret).update(`scope:${scope}`).digest();
	return createHmac('sha256', key).update(payload).digest();
}

/** Mint a token valid only for `scope`. `exp` is unix seconds. '' when unconfigured. */
export function signScopedToken(scope: string, id: string, exp: number): string {
	const secret = resolveSecret();
	if (!secret) return '';
	const payload = `${id}.${exp}`;
	return `${b64url(Buffer.from(payload))}.${b64url(scopedMac(secret, scope, payload))}`;
}

/** Verify a scoped token. Null for the wrong scope, expired, tampered or garbage. */
export function verifyScopedToken(scope: string, token: string): { id: string } | null {
	const secret = resolveSecret();
	if (!secret || !token) return null;
	try {
		const parts = token.split('.');
		if (parts.length !== 2) return null;
		const payload = fromB64url(parts[0]).toString('utf8');
		const dot = payload.lastIndexOf('.');
		if (dot <= 0) return null;
		const id = payload.slice(0, dot);
		const exp = Number(payload.slice(dot + 1));
		if (!id || !Number.isFinite(exp)) return null;

		const expected = scopedMac(secret, scope, payload);
		const given = fromB64url(parts[1]);
		if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
		if (exp < Math.floor(Date.now() / 1000)) return null;
		return { id };
	} catch {
		return null;
	}
}

/**
 * The public management URL for a booking: `${origin}/book/${token}`.
 *
 * Pass `endsAtIso` wherever the booking is in hand — the link then dies a
 * fortnight after the meal instead of surviving for six months (see
 * {@link expiryForBooking}). Omitting it keeps the flat default, so callers that
 * genuinely only have an id still work.
 */
export function buildManagementUrl(
	bookingId: string,
	origin: string,
	endsAtIso?: string
): string {
	const token = signBookingToken(bookingId, expiryForBooking(endsAtIso));
	if (!token) return '';
	return `${origin.replace(/\/$/, '')}/book/${token}`;
}

// --- self-service read view --------------------------------------------------

export interface SelfServiceView {
	booking: Pick<
		Booking,
		'id' | 'party_size' | 'starts_at' | 'ends_at' | 'status' | 'special_requests' | 'occasion'
	>;
	/** Only the fields the guest already knows — never staff-only data. */
	customer: { name: string; email: string };
	restaurant: { brand: Restaurant['brand']; display_name: string; timezone: string };
	/** The recomputed payment requirement context, if a payment row exists. */
	payment: { kind: Payment['kind']; status: Payment['status']; amountPence: number } | null;
	/** Amend allowed: an upcoming pending/confirmed booking. */
	canAmend: boolean;
	/** Cancel allowed: same gate as amend. */
	canCancel: boolean;
	/**
	 * Consequence text shown BEFORE a cancel so the guest sees §6 outcomes (deposit
	 * forfeited / no-show fee) when cancelling late. Empty when there is none.
	 */
	policyNote: string;
}

/** Statuses a guest may self-service (upcoming + still live). */
const SELF_SERVICE_STATUSES = ['pending_payment', 'confirmed'];

/**
 * Load the public-safe view for a booking the token already authorised. Throws
 * if the booking does not exist (caller maps to the invalid-link screen).
 */
export async function getSelfServiceView(bookingId: string): Promise<SelfServiceView> {
	const c = await pb();
	const booking = await c.collection('geisha_bookings').getOne<Booking>(bookingId);
	const restaurant = await c
		.collection('geisha_restaurants')
		.getOne<Restaurant>(booking.restaurant);
	const customer = await c
		.collection('geisha_customers')
		.getOne<Customer>(booking.customer)
		.catch(() => null);
	const payment = await c
		.collection('geisha_payments')
		.getFirstListItem<Payment>(`booking=${q(bookingId)}`)
		.catch(() => null);

	const now = new Date();
	const startsAt = new Date(booking.starts_at);
	const upcoming = startsAt.getTime() > now.getTime();
	const live = SELF_SERVICE_STATUSES.includes(booking.status);
	const canAmend = upcoming && live;
	const canCancel = upcoming && live;

	const policyNote = buildPolicyNote(booking, payment, now);

	return {
		booking: {
			id: booking.id,
			party_size: booking.party_size,
			starts_at: booking.starts_at,
			ends_at: booking.ends_at,
			status: booking.status,
			special_requests: booking.special_requests,
			occasion: booking.occasion
		},
		customer: { name: customer?.name ?? '', email: customer?.email ?? '' },
		restaurant: {
			brand: restaurant.brand,
			display_name: restaurant.display_name,
			timezone: restaurant.timezone || 'Europe/London'
		},
		payment: payment
			? { kind: payment.kind, status: payment.status, amountPence: payment.amount }
			: null,
		canAmend,
		canCancel,
		policyNote
	};
}

/** Build the §6 cancel-consequence sentence shown before confirming a cancel. */
function buildPolicyNote(booking: Booking, payment: Payment | null, now: Date): string {
	const startsAt = new Date(booking.starts_at);
	if (!isLateCancellation(startsAt, now)) {
		return 'You can cancel free of charge — any deposit will be refunded and any card hold released.';
	}
	if (!payment || payment.kind === '') {
		return `This is a late cancellation (less than ${LATE_CANCELLATION_LABEL} before your booking). Please call us if your plans have changed.`;
	}
	const pounds = `£${(payment.amount / 100).toFixed(2)}`;
	if (payment.kind === 'deposit') {
		return `This is a late cancellation (less than ${LATE_CANCELLATION_LABEL} before your booking), so your ${pounds} deposit is non-refundable.`;
	}
	// noshow_hold. "May be" is the honest word now: cancelling never charges the
	// card by itself — the restaurant decides afterwards and takes the fee by hand
	// (payments.chargeNoShowManual). Promising a charge that no longer happens
	// automatically would be a lie, and one that invites a chargeback when a guest
	// is told they were billed and wasn't. The deterrent survives; the certainty
	// doesn't, because it isn't true.
	return `This is a late cancellation (less than ${LATE_CANCELLATION_LABEL} before your booking), so the ${pounds} no-show fee may be charged to your card. Please call us if your plans have changed.`;
}

// --- mutating wrappers (actor='customer') ------------------------------------

/**
 * Cancel a booking on the guest's behalf (audited as actor='customer').
 *
 * THE STATUS GATE LIVES HERE, NOT IN THE UI. `canCancel` above only decides
 * whether the page draws the button; the form action posts straight through, so
 * without this a direct POST could cancel a booking in ANY state. Two of those
 * states cost real money:
 *
 *   • `completed` — cancelBooking treated every cancellation of a booking whose
 *     start has passed as LATE (isLateCancellation is `startsAt - now < 12h`,
 *     which is true for the whole past), and a late cancel called chargeNoShow().
 *     Because releaseHold() deliberately leaves an honoured guarantee filed and
 *     `Authorized`, that charged a real no-show fee to a guest who turned up and
 *     ate. The link stays valid for months, so anyone the confirmation email was
 *     ever forwarded to could trigger it.
 *   • `seated` — cancelling a party mid-service, from a web page.
 *
 * A cancellation no longer bills a card by any route (see settleNoShowMoney), so
 * the money half of that is now structurally impossible rather than merely
 * guarded — but the status gate stays: cancelling a seated party from a web page
 * is wrong whatever it costs.
 */
export async function selfServiceCancel(bookingId: string): Promise<Booking> {
	const c = await pb();
	const booking = await c.collection('geisha_bookings').getOne<Booking>(bookingId);
	if (!SELF_SERVICE_STATUSES.includes(booking.status)) {
		throw new BookingError(
			'This booking can no longer be cancelled online. Please call us and we’ll sort it out.',
			'invalid'
		);
	}
	if (new Date(booking.starts_at).getTime() <= Date.now()) {
		throw new BookingError(
			'This booking has already started, so it can’t be cancelled online. Please call us.',
			'invalid'
		);
	}
	// Stamped with ResDiary's "Online Cancellation" reason (the one its reason table
	// marks Display Online) so the cancellation report separates guests who cancelled
	// themselves from anything staff did on the floor.
	return cancelBooking(bookingId, 'customer', { reason: 'online_cancellation' });
}

/**
 * Amend a booking on the guest's behalf. Funnels through the canonical
 * amendBooking() (re-validates availability under the lock, enforces the online
 * party cap for actor='customer', recomputes payment). Surfaces BookingError to
 * the caller and returns paymentChanged so the page can route to a deposit step.
 */
export async function selfServiceAmend(
	input: Omit<AmendBookingInput, 'actor' | 'onBehalfOf' | 'bookingId'> & { bookingId: string }
): Promise<{ booking: Booking; payment: PaymentRequirement; paymentChanged: boolean }> {
	const result = await amendBooking({ ...input, actor: 'customer' });
	return result;
}

/**
 * Lightweight abuse guard: count this booking's recent amend audit rows so a
 * leaked link can't thrash the floor. Returns true when the guest is over the
 * cap and the caller should refuse the amend. Best-effort — a count failure
 * never blocks a legitimate amend (returns false).
 */
export async function amendRateExceeded(
	bookingId: string,
	maxPerHour = 5
): Promise<boolean> {
	try {
		const c = await pb();
		const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ');
		const list = await c.collection('geisha_audit_log').getList(1, 1, {
			filter: `action=${q('amend_booking')} && entity_id=${q(bookingId)} && created>=${q(sinceIso)}`
		});
		return (list.totalItems ?? 0) >= maxPerHour;
	} catch {
		return false;
	}
}
