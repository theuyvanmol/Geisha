// Stripe payments — deposits and card guarantees for online bookings.
//
// Docs: https://docs.stripe.com/api  (pinned API version below)
//
// THE ONLY CARD PROVIDER. An earlier Dojo integration lived here and has been
// removed: Dojo is the restaurants' in-restaurant TERMINAL provider, it was never
// usable for the online deposit flow (the July probe found five silent defects
// against the real API, on an account in live daily use by staff), and it created
// exactly zero payment records. Stripe is the account the restaurants already
// take web payments through.
//
// THE TWO MONEY SHAPES, AND WHY THEY USE DIFFERENT PRIMITIVES
// -----------------------------------------------------------
//   • DEPOSIT (6+ covers, brunch) — money moves now and comes off the bill.
//     → PaymentIntent, automatic capture, confirmed by the guest in the widget.
//
//   • CARD GUARANTEE / NO-SHOW HOLD (Fri–Sat 3–5) — no money moves unless the
//     guest doesn't turn up.
//     → SetupIntent (`usage: off_session`), which stores the card against a
//       Customer and charges nothing. On a no-show we then create an off-session
//       PaymentIntent with the saved card.
//
//     The obvious alternative — a manual-capture PaymentIntent held open until
//     the night — does NOT work here: an uncaptured authorisation expires after
//     7 days, and this restaurant takes bookings months out. It would silently
//     evaporate on exactly the bookings a guarantee exists to protect. A
//     SetupIntent has no expiry, which is why the July memo settled on it.
//
// GRACEFUL NO-KEY MODE: with no usable key (unset, or a live key without the
// STRIPE_ALLOW_LIVE opt-in) isConfiguredAsync() is false, the create calls
// return a clearly-flagged stub, and the booking flow behaves exactly as it did
// before Stripe existed — no deposits demanded, bookings confirm normally.
// See requirementIfCollectable() in booking/payments.ts for why that matters.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { BrandId } from '../db/types.js';
import { resolveSecretKey, resolvePublishableKey, classifyKey, liveAllowed } from './stripeKeys.js';

const BASE = 'https://api.stripe.com/v1';

/**
 * Pinned so a Stripe-side default upgrade can't change response shapes under us.
 * Bump deliberately, with the changelog open.
 *
 * WHY THIS EXACT VALUE. Three things have to agree, and Stripe's own guidance is
 * to keep them on one release train:
 *   1. this header (what our API calls return),
 *   2. the webhook destination's API version (what its payloads look like), and
 *   3. the Stripe.js version the browser loads — see $lib/bookings/stripe.ts.
 * The webhook endpoint on the restaurants' account is `2026-07-29.dahlia`, so
 * this matches it rather than leaving a two-major gap (Basil → Clover → Dahlia)
 * with silent payload conversion in between.
 *
 * Verified against the changelogs before bumping: none of the ~32 Clover or the
 * Dahlia breaking changes touch what this module does. They land on Billing,
 * Connect, Checkout, Treasury, Issuing and deprecated Stripe.js methods
 * (`handleCardPayment`, `confirmSetupIntent`, …) that we don't call. Creating and
 * reading PaymentIntents, SetupIntents, Customers and Refunds, and the `status`
 * field on both intent types, are unchanged — confirmed by reading the live API
 * under both versions and diffing the fields we consume.
 *
 * The one Clover change that touches this flow is a client-side guard: Elements
 * now refuses a client secret from an already-completed intent. We always create
 * a fresh intent per booking, so it can't bite — but it did surface a real gap in
 * our loader, now fixed (see the `loaderror` handling in $lib/bookings/stripe.ts).
 */
const API_VERSION = '2026-07-29.dahlia';

/** Resolve the usable secret key for a brand, or '' (gated / unconfigured). */
export async function secretKey(brand?: BrandId): Promise<string> {
	const resolved = await resolveSecretKey(brand);
	return resolved.usable ? resolved.key : '';
}

/** Sync best-effort check (env only), honouring the live gate. */
export function isConfigured(): boolean {
	const key = (env.STRIPE_SECRET_KEY ?? '').trim();
	if (!key) return false;
	return classifyKey(key) === 'test' || liveAllowed();
}

/** True once a USABLE secret key is configured for this brand. Prefer this. */
export async function isConfiguredAsync(brand?: BrandId): Promise<boolean> {
	return Boolean(await secretKey(brand));
}

/** The publishable key the widget needs to mount the card form. '' when the
 *  pair isn't fully configured — the widget then shows its manual fallback. */
export { resolvePublishableKey as publishableKey };

// --- request plumbing ------------------------------------------------------

/**
 * Stripe's API is form-encoded, and nests with bracket syntax
 * (`metadata[booking]=abc`, `automatic_payment_methods[enabled]=true`). This
 * flattens a plain object into that form so call sites can stay readable.
 * `undefined` and `null` values are dropped rather than sent as the strings
 * "undefined"/"null", which Stripe would happily store.
 */
function form(params: Record<string, unknown>, prefix = ''): URLSearchParams {
	const out = new URLSearchParams();
	for (const [rawKey, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		const key = prefix ? `${prefix}[${rawKey}]` : rawKey;
		if (typeof value === 'object' && !Array.isArray(value)) {
			for (const [k, v] of form(value as Record<string, unknown>, key)) out.append(k, v);
		} else if (Array.isArray(value)) {
			value.forEach((v, i) => out.append(`${key}[${i}]`, String(v)));
		} else {
			out.append(key, String(value));
		}
	}
	return out;
}

export class StripeError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
		readonly declineCode?: string
	) {
		super(message);
		this.name = 'StripeError';
	}
}

interface CallOptions {
	brand?: BrandId;
	/** Sent as Idempotency-Key. Stripe replays the original response for 24h,
	 *  so a double-submit or a retry can never double-charge. */
	idempotencyKey?: string;
	method?: 'GET' | 'POST';
}

/**
 * One authenticated Stripe call. Throws {@link StripeError} on a non-2xx so
 * callers can distinguish a card decline (which the guest must see) from a
 * configuration fault (which they must not).
 */
async function call<T>(
	path: string,
	params: Record<string, unknown> = {},
	opts: CallOptions = {}
): Promise<T> {
	const key = await secretKey(opts.brand);
	if (!key) throw new StripeError('Stripe is not configured.', 503, 'not_configured');

	const method = opts.method ?? 'POST';
	const body = method === 'POST' ? form(params) : undefined;
	const query = method === 'GET' ? `?${form(params)}` : '';

	const res = await fetch(`${BASE}${path}${query}`, {
		method,
		headers: {
			Authorization: `Bearer ${key}`,
			'Stripe-Version': API_VERSION,
			...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
			...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {})
		},
		body
	});

	const text = await res.text();
	let data: unknown;
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		throw new StripeError(`Stripe returned a non-JSON response (${res.status}).`, res.status);
	}

	if (!res.ok) {
		const err = (data as { error?: { message?: string; code?: string; decline_code?: string } })
			.error;
		throw new StripeError(
			err?.message || `Stripe request failed (${res.status}).`,
			res.status,
			err?.code,
			err?.decline_code
		);
	}
	return data as T;
}

// --- object shapes we actually read ----------------------------------------

export interface StripePaymentIntent {
	id: string;
	object: 'payment_intent';
	status:
		| 'requires_payment_method'
		| 'requires_confirmation'
		| 'requires_action'
		| 'processing'
		| 'requires_capture'
		| 'canceled'
		| 'succeeded';
	amount: number;
	amount_received?: number;
	client_secret?: string;
	customer?: string | null;
	payment_method?: string | null;
	latest_charge?: string | null;
	metadata?: Record<string, string>;
}

export interface StripeSetupIntent {
	id: string;
	object: 'setup_intent';
	status:
		| 'requires_payment_method'
		| 'requires_confirmation'
		| 'requires_action'
		| 'processing'
		| 'canceled'
		| 'succeeded';
	client_secret?: string;
	customer?: string | null;
	payment_method?: string | null;
	metadata?: Record<string, string>;
}

export interface StripeCustomer {
	id: string;
	object: 'customer';
}

export interface StripeRefund {
	id: string;
	object: 'refund';
	status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';
	amount: number;
}

/** What a create call hands back to the booking layer. */
export interface CardSession {
	/** PaymentIntent or SetupIntent id — `pi_…` / `seti_…`. The prefix is how
	 *  every later operation knows which primitive it is dealing with, which is
	 *  why nothing else needs storing. */
	id: string;
	/** The secret the browser confirms against. '' in stub mode. */
	clientSecret: string;
	/** Publishable key for Stripe.js. '' in stub mode. */
	publishableKey: string;
	/** False when Stripe isn't configured — the caller shows its manual fallback. */
	configured: boolean;
}

const STUB: CardSession = { id: '', clientSecret: '', publishableKey: '', configured: false };

/** Metadata written onto every object, so a Stripe dashboard row is traceable
 *  back to a booking without opening this codebase. */
function metadataFor(input: {
	bookingId?: string;
	reference?: string;
	brand?: BrandId;
	extra?: Record<string, string | undefined>;
}): Record<string, string> {
	const out: Record<string, string> = {};
	if (input.bookingId) out.booking_id = input.bookingId;
	if (input.reference) out.reference = input.reference;
	if (input.brand) out.brand = input.brand;
	for (const [k, v] of Object.entries(input.extra ?? {})) if (v) out[k] = v;
	return out;
}

// --- customers -------------------------------------------------------------

/**
 * Find-or-create the Stripe Customer a card is stored against.
 *
 * A Customer is REQUIRED for the guarantee flow — an off-session charge months
 * later needs a payment method attached to one. Matching on email keeps a repeat
 * guest as a single row rather than accumulating one per booking. Search failures
 * fall through to a create: a duplicate customer is untidy, a failed booking is
 * not.
 */
export async function ensureCustomer(input: {
	email: string;
	name?: string;
	phone?: string;
	brand?: BrandId;
}): Promise<string> {
	const email = input.email.trim().toLowerCase();
	if (email) {
		try {
			const found = await call<{ data: StripeCustomer[] }>(
				'/customers',
				{ email, limit: 1 },
				{ brand: input.brand, method: 'GET' }
			);
			if (found.data?.[0]?.id) return found.data[0].id;
		} catch {
			// fall through to create
		}
	}
	const created = await call<StripeCustomer>(
		'/customers',
		{
			email: email || undefined,
			name: input.name || undefined,
			phone: input.phone || undefined,
			metadata: metadataFor({ brand: input.brand })
		},
		{ brand: input.brand }
	);
	return created.id;
}

// --- deposits (money now) --------------------------------------------------

export interface CreateDepositInput {
	amountPence: number;
	/** Stable per booking — used as the idempotency key so a double-submitted
	 *  booking form can't create two deposits. */
	reference: string;
	bookingId?: string;
	brand?: BrandId;
	/** Shown on the guest's bank statement. Stripe truncates to 22 chars. */
	statementDescriptor?: string;
	description?: string;
	customerId?: string;
	metadata?: Record<string, string | undefined>;
}

/**
 * A deposit the guest pays now. Automatic capture, so a successful confirmation
 * in the widget means the money is taken — there is no second step to forget.
 *
 * DOES NOT SAVE THE CARD (no `setup_future_usage`). It used to set `off_session` "so
 * a later no-show fee could be charged without asking again" — but nothing ever did:
 * chargeNoShowManual refuses a deposit booking ("there is no card to charge"), because
 * the deposit IS the no-show money. Saving the card for later is what UK SCA makes the
 * bank challenge, so every deposit went through a banking-app approval (8 of 8 checked,
 * 2026-09-11) where ResDiary's on the same account had none, and Stripe printed "you
 * allow … to charge your card for future payments" above the Pay button.
 */
export function depositIntentParams(input: CreateDepositInput) {
	return {
		amount: Math.round(input.amountPence),
		currency: 'gbp',
		capture_method: 'automatic',
		customer: input.customerId,
		description: input.description,
		statement_descriptor_suffix: input.statementDescriptor?.slice(0, 22),
		// CARD ONLY — deliberately NOT automatic_payment_methods.
		//
		// `automatic_payment_methods` offers whatever is switched on in the Stripe
		// Dashboard, which includes LINK. Link recognises a returning guest from a
		// browser session and replaces the card fields with a masked saved card and
		// a "Confirm" button — so a guest being asked for a £70 deposit sees no card
		// form at all, just a card they may not remember saving. On a deposit taken
		// by a restaurant they've never paid before, that reads as wrong and costs
		// bookings at the last step.
		//
		// Apple Pay / Google Pay are unaffected: they are wallets UNDER the `card`
		// type, not separate types, so they still appear where the device supports
		// them (which is what the host iframe's allow="payment" exists for).
		payment_method_types: ['card'],
		metadata: metadataFor({
			bookingId: input.bookingId,
			reference: input.reference,
			brand: input.brand,
			extra: { kind: 'deposit', ...input.metadata }
		})
	};
}

export async function createDepositIntent(input: CreateDepositInput): Promise<CardSession> {
	if (!(await isConfiguredAsync(input.brand))) return STUB;

	const intent = await call<StripePaymentIntent>('/payment_intents', depositIntentParams(input), {
		brand: input.brand,
		idempotencyKey: `deposit-${input.reference}`
	});

	return {
		id: intent.id,
		clientSecret: intent.client_secret ?? '',
		publishableKey: await resolvePublishableKey(input.brand),
		configured: true
	};
}

// --- card guarantees (no money now) ----------------------------------------

export interface CreateGuaranteeInput {
	reference: string;
	bookingId?: string;
	brand?: BrandId;
	/** Required — the card must be filed against a Customer to be chargeable later. */
	customerId: string;
	/** The exact wording the guest agreed to. Stored on the intent so it can be
	 *  produced verbatim in a chargeback dispute; that is the only real defence. */
	terms?: string;
	/** Pence we would charge on a no-show. Recorded for the audit trail only —
	 *  nothing is authorised now. */
	feePence?: number;
	metadata?: Record<string, string | undefined>;
}

/**
 * A card guarantee: the card is verified and filed, and NOTHING is charged.
 * `usage: off_session` is what makes it chargeable later without the guest
 * present — omitting it produces a card that Stripe will refuse to charge on a
 * no-show, which is precisely the moment you find out.
 */
export async function createGuaranteeIntent(input: CreateGuaranteeInput): Promise<CardSession> {
	if (!(await isConfiguredAsync(input.brand))) return STUB;

	const intent = await call<StripeSetupIntent>(
		'/setup_intents',
		{
			customer: input.customerId,
			usage: 'off_session',
			// Card only, for the same reason as the deposit intent above — a card
			// GUARANTEE especially must show the guest the card they are putting up.
			payment_method_types: ['card'],
			metadata: metadataFor({
				bookingId: input.bookingId,
				reference: input.reference,
				brand: input.brand,
				extra: {
					kind: 'noshow_hold',
					fee_pence: input.feePence ? String(input.feePence) : undefined,
					// Stripe caps a metadata value at 500 chars.
					terms: input.terms?.slice(0, 500),
					...input.metadata
				}
			})
		},
		{ brand: input.brand, idempotencyKey: `guarantee-${input.reference}` }
	);

	return {
		id: intent.id,
		clientSecret: intent.client_secret ?? '',
		publishableKey: await resolvePublishableKey(input.brand),
		configured: true
	};
}

/**
 * Charge a guaranteed card after the fact (the no-show fee).
 *
 * Reads the card + customer off the SetupIntent rather than trusting anything
 * stored locally, then creates a confirmed, off-session PaymentIntent. The
 * idempotency key is derived from the intent id, so a double-click on "charge
 * no-show" in the diary cannot bill the guest twice.
 *
 * A declined off-session charge throws — the caller surfaces it to staff, since
 * a silently failed no-show fee is worse than none at all.
 */
export async function chargeGuarantee(
	setupIntentId: string,
	amountPence: number,
	opts: { brand?: BrandId; description?: string; bookingId?: string } = {}
): Promise<StripePaymentIntent> {
	const setup = await call<StripeSetupIntent>(
		`/setup_intents/${encodeURIComponent(setupIntentId)}`,
		{},
		{ brand: opts.brand, method: 'GET' }
	);
	if (!setup.payment_method || !setup.customer) {
		throw new StripeError(
			'No stored card on this guarantee — it was never completed.',
			400,
			'no_payment_method'
		);
	}

	return call<StripePaymentIntent>(
		'/payment_intents',
		{
			amount: Math.round(amountPence),
			currency: 'gbp',
			customer: setup.customer,
			payment_method: setup.payment_method,
			off_session: true,
			confirm: true,
			description: opts.description,
			metadata: metadataFor({
				bookingId: opts.bookingId,
				brand: opts.brand,
				extra: { kind: 'noshow_fee', setup_intent: setupIntentId }
			})
		},
		{ brand: opts.brand, idempotencyKey: `noshow-${setupIntentId}` }
	);
}

/**
 * Release a guarantee — the guest turned up, or cancelled in good time.
 *
 * There is nothing to reverse (no money was ever held), so this cancels an
 * incomplete SetupIntent and otherwise no-ops. Deliberately does NOT detach the
 * saved card: the same guest booking again is the common case, and a detached
 * card means asking for it a second time. Returns the intent's final status.
 */
export async function releaseGuarantee(
	setupIntentId: string,
	brand?: BrandId
): Promise<StripeSetupIntent> {
	const setup = await call<StripeSetupIntent>(
		`/setup_intents/${encodeURIComponent(setupIntentId)}`,
		{},
		{ brand, method: 'GET' }
	);
	if (setup.status === 'succeeded' || setup.status === 'canceled') return setup;
	return call<StripeSetupIntent>(
		`/setup_intents/${encodeURIComponent(setupIntentId)}/cancel`,
		{},
		{ brand }
	);
}

// --- refunds + reads -------------------------------------------------------

/** Refund a captured deposit, whole or in part. `idempotencyKey` must be stable
 *  per intended refund so a retry can't double-refund. */
export async function refundPaymentIntent(
	paymentIntentId: string,
	amountPence: number,
	idempotencyKey: string,
	reason?: string,
	brand?: BrandId
): Promise<StripeRefund> {
	return call<StripeRefund>(
		'/refunds',
		{
			payment_intent: paymentIntentId,
			amount: Math.round(amountPence),
			// Stripe only accepts a fixed vocabulary here; free text goes to metadata.
			reason: 'requested_by_customer',
			metadata: reason ? { note: reason.slice(0, 500) } : undefined
		},
		{ brand, idempotencyKey }
	);
}

/** Cancel an unpaid PaymentIntent (e.g. the guest abandoned the card step). */
export async function cancelPaymentIntent(
	paymentIntentId: string,
	brand?: BrandId
): Promise<StripePaymentIntent> {
	return call<StripePaymentIntent>(
		`/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
		{},
		{ brand }
	);
}

export async function getPaymentIntent(
	paymentIntentId: string,
	brand?: BrandId
): Promise<StripePaymentIntent> {
	return call<StripePaymentIntent>(
		`/payment_intents/${encodeURIComponent(paymentIntentId)}`,
		{},
		{ brand, method: 'GET' }
	);
}

export async function getSetupIntent(
	setupIntentId: string,
	brand?: BrandId
): Promise<StripeSetupIntent> {
	return call<StripeSetupIntent>(
		`/setup_intents/${encodeURIComponent(setupIntentId)}`,
		{},
		{ brand, method: 'GET' }
	);
}

// --- status mapping --------------------------------------------------------

/**
 * Map a Stripe status onto the PaymentStatus vocabulary geisha_payments already
 * stores (Created / Authorized / Captured / Reversed / Refunded / Canceled).
 *
 * Reusing the existing column instead of adding a Stripe-shaped one is
 * deliberate: it needs no PocketBase migration, and the diary, deposit report and
 * admin screens all keep reading the field they already read. The `object` tells
 * us which primitive we're mapping, because 'succeeded' means "card filed" on a
 * SetupIntent and "money taken" on a PaymentIntent.
 */
export function mapStatus(
	object: 'payment_intent' | 'setup_intent',
	status: string
): 'Created' | 'Authorized' | 'Captured' | 'Reversed' | 'Refunded' | 'Canceled' {
	if (status === 'canceled') return 'Canceled';
	if (object === 'setup_intent') {
		// A filed card is the guarantee equivalent of an authorisation.
		return status === 'succeeded' ? 'Authorized' : 'Created';
	}
	if (status === 'succeeded') return 'Captured';
	if (status === 'requires_capture') return 'Authorized';
	return 'Created';
}

/** Which primitive an id refers to. The id prefix is self-describing, which is
 *  why the payment row needs no extra provider column. */
export function intentKind(id: string): 'payment_intent' | 'setup_intent' | 'unknown' {
	if (id.startsWith('pi_')) return 'payment_intent';
	if (id.startsWith('seti_')) return 'setup_intent';
	return 'unknown';
}

/** True when this intent id belongs to Stripe (vs a legacy stub). */
export function isStripeIntent(id: string): boolean {
	return intentKind(id) !== 'unknown';
}

// --- webhook signature verification ----------------------------------------
//
// Stripe signs each webhook with HMAC-SHA256 over `${timestamp}.${rawBody}` using
// the endpoint's signing secret (whsec_…), sent as `t=<unix>,v1=<hex>` in the
// Stripe-Signature header.

/** Replay tolerance in seconds (5 min) — Stripe's own recommended default. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Per-brand signing-secret env vars, for a deployment with a Stripe account per
 *  brand. Both are optional; the shared STRIPE_WEBHOOK_SECRET covers the
 *  one-account case on its own. */
const BRAND_WEBHOOK_SECRET_ENV = ['STRIPE_WEBHOOK_SECRET_ASIA', 'STRIPE_WEBHOOK_SECRET_FUSION'];

/**
 * EVERY signing secret this deployment should accept, deduplicated.
 *
 * ONE ENDPOINT, POSSIBLY SEVERAL STRIPE ACCOUNTS. Asia and Fusion are separate
 * businesses that may bank separately, and a second Stripe account means a second
 * webhook endpoint registered in that account's dashboard — pointed at this same
 * URL, but signing with its OWN `whsec_…`. There is nothing in the request body
 * that tells us which account sent it before we have verified it (and trusting an
 * unverified body to pick the key is exactly the hole verification exists to
 * close), so the only sound move is to try every secret we hold and accept the
 * event if ANY of them matches. Each attempt is one HMAC over a small body.
 *
 * Sources: the per-brand env vars, the shared env var, and every
 * `stripe_webhook_secret` row saved per brand in Settings → Integrations.
 */
export async function webhookSecrets(): Promise<string[]> {
	const out: string[] = [];
	const add = (v: unknown) => {
		const s = typeof v === 'string' ? v.trim() : '';
		if (s && !out.includes(s)) out.push(s);
	};
	for (const name of BRAND_WEBHOOK_SECRET_ENV) add(env[name]);
	try {
		const { getIntegrationKeyAll } = await import('../integrations/keys.js');
		// Already includes the shared STRIPE_WEBHOOK_SECRET env fallback.
		for (const v of await getIntegrationKeyAll('stripe_webhook_secret')) add(v);
	} catch {
		// keys module / PB unreachable — fall through to env.
	}
	add(env.STRIPE_WEBHOOK_SECRET);
	return out;
}

/** The first configured signing secret, or '' — for callers that only need to
 *  know whether signing is set up at all. */
export async function webhookSecret(): Promise<string> {
	return (await webhookSecrets())[0] ?? '';
}

export async function webhookConfigured(): Promise<boolean> {
	return (await webhookSecrets()).length > 0;
}

/** Parse `t=<unix>,v1=<hex>[,v1=<hex>]` — Stripe may send several v1 values
 *  during a signing-secret rollover, and ANY of them matching is a valid event. */
function parseSignatureHeader(header: string): { t: string; v1: string[] } {
	let t = '';
	const v1: string[] = [];
	for (const part of header.split(',')) {
		const idx = part.indexOf('=');
		if (idx === -1) continue;
		const k = part.slice(0, idx).trim();
		const v = part.slice(idx + 1).trim();
		if (k === 't') t = v;
		else if (k === 'v1' && v) v1.push(v);
	}
	return { t, v1 };
}

/** Constant-time hex compare that can't throw on a length mismatch. */
function safeEqualHex(a: string, b: string): boolean {
	const ab = Buffer.from(a, 'hex');
	const bb = Buffer.from(b, 'hex');
	if (ab.length === 0 || ab.length !== bb.length) return false;
	return timingSafeEqual(ab, bb);
}

export type WebhookVerification = { ok: true } | { ok: false; reason: string };

/**
 * Verify a Stripe webhook signature. Pure + synchronous so the crypto is testable
 * without PocketBase; the route resolves the secret and passes it in.
 *
 * `nowSeconds` is injectable for the replay-window test.
 */
export function verifyWebhookSignature(
	rawBody: string,
	signatureHeader: string | null,
	secret: string,
	nowSeconds: number = Math.floor(Date.now() / 1000)
): WebhookVerification {
	if (!secret) return { ok: false, reason: 'no signing secret configured' };
	if (!signatureHeader) return { ok: false, reason: 'missing Stripe-Signature header' };

	const { t, v1 } = parseSignatureHeader(signatureHeader);
	if (!t || v1.length === 0) return { ok: false, reason: 'malformed Stripe-Signature header' };

	const timestamp = Number(t);
	if (!Number.isFinite(timestamp)) return { ok: false, reason: 'invalid timestamp' };
	if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
		return { ok: false, reason: 'timestamp outside tolerance (possible replay)' };
	}

	const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
	return v1.some((sig) => safeEqualHex(expected, sig))
		? { ok: true }
		: { ok: false, reason: 'signature mismatch' };
}

/**
 * Verify against a SET of signing secrets, accepting if any one matches — the
 * multi-Stripe-account case (see webhookSecrets()). Pure, so the route's only
 * job is to resolve the secrets and hand them over.
 *
 * The reported reason is the most SPECIFIC failure seen. With two accounts, a
 * legitimate Asia event necessarily mismatches Fusion's secret, so
 * 'signature mismatch' is expected noise; a malformed header or a replay is a
 * real diagnosis and must not be buried under it.
 */
export function verifyWebhookSignatureAny(
	rawBody: string,
	signatureHeader: string | null,
	secrets: readonly string[],
	nowSeconds: number = Math.floor(Date.now() / 1000)
): WebhookVerification {
	if (secrets.length === 0) return { ok: false, reason: 'no signing secret configured' };
	let reason = 'signature mismatch';
	for (const secret of secrets) {
		const result = verifyWebhookSignature(rawBody, signatureHeader, secret, nowSeconds);
		if (result.ok) return result;
		if (reason === 'signature mismatch') reason = result.reason;
	}
	return { ok: false, reason };
}
