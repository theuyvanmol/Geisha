// Payments — the booking layer's entry point to the card provider.
//
// STRIPE IS THE ONLY PROVIDER. This was briefly a two-provider facade, because
// an earlier Dojo integration existed in the repo. Dojo is the restaurants'
// in-restaurant TERMINAL provider and was never used for website payments: the
// July probe found five silent defects against its API, its keys sat gated off,
// and it created exactly zero payment records. Confirmed against the live
// database before removing it — every geisha_payments row was a no-key stub, so
// there was nothing to keep compatibility with.
//
// What survives from that period is the column name: geisha_payments still calls
// its provider reference `dojo_payment_intent_id`. Renaming it needs a PocketBase
// migration for no functional gain, so it stays and simply means "the provider's
// id for this payment". Stripe's ids are self-describing (`pi_…` / `seti_…`),
// which is what {@link isStripeIntent} checks — a legacy `stub_…` value routes
// nowhere and every money operation no-ops on it.
//
// This module stays thin on purpose: it owns "which shape of Stripe object does
// this requirement need", so the booking layer never has to know the difference
// between a PaymentIntent and a SetupIntent.

import type { BrandId } from '../db/types.js';
import type { PaymentRequirement } from '../booking/policy.js';
import * as stripe from './stripe.js';

/** True when Stripe can take money for this brand (key present AND not gated off). */
export async function isConfiguredAsync(brand?: BrandId): Promise<boolean> {
	return stripe.isConfiguredAsync(brand);
}

/**
 * How the widget should collect the card.
 *   • 'inline'          — a card form rendered in place from `clientSecret`.
 *                         The only mode Stripe uses, and the only one that works
 *                         inside the embedded booking iframe (hosted Checkout
 *                         sets frame-ancestors and would render blank).
 *   • 'manual_fallback' — Stripe unconfigured, or a guarantee with no customer
 *                         to file the card against. The booking still exists;
 *                         staff resolve the payment.
 */
export type PaymentCollectionMode = 'inline' | 'manual_fallback';

export interface StartedSession {
	/** Stripe intent id, stored on the payment row. '' in stub mode. */
	intentId: string;
	mode: PaymentCollectionMode;
	/** The secret the browser confirms against. */
	clientSecret?: string;
	/** Publishable key for Stripe.js — public by design. */
	publishableKey?: string;
	configured: boolean;
}

export interface StartSessionInput {
	requirement: PaymentRequirement;
	/** Stable per booking — becomes the idempotency key. */
	reference: string;
	bookingId: string;
	brand?: BrandId;
	/** Needed to file the card against a Stripe Customer. A guarantee cannot be
	 *  created without one, because charging it later happens off-session. */
	customer?: { email: string; name?: string; phone?: string };
	description?: string;
}

const NOT_CONFIGURED: StartedSession = {
	intentId: '',
	mode: 'manual_fallback',
	configured: false
};

/**
 * Create the card session for a payment requirement.
 *
 * A DEPOSIT becomes a PaymentIntent (money moves now). A CARD GUARANTEE becomes
 * a SetupIntent (the card is filed, nothing is charged). See payments/stripe.ts
 * for why a guarantee is not a manual-capture hold.
 */
export async function startSession(input: StartSessionInput): Promise<StartedSession> {
	const { requirement, brand } = input;
	if (requirement.kind === 'none') return NOT_CONFIGURED;
	if (!(await stripe.isConfiguredAsync(brand))) return NOT_CONFIGURED;

	// A Customer is mandatory for a guarantee, and useful for a deposit — it files
	// the card so a later no-show fee on the same booking needs no second ask.
	let customerId: string | undefined;
	if (input.customer?.email) {
		try {
			customerId = await stripe.ensureCustomer({ ...input.customer, brand });
		} catch (err) {
			console.error('[payments] Stripe customer create failed:', err);
		}
	}

	const session =
		requirement.kind === 'deposit'
			? await stripe.createDepositIntent({
					amountPence: requirement.amountPence,
					reference: input.reference,
					bookingId: input.bookingId,
					brand,
					customerId,
					description: input.description,
					statementDescriptor: 'BOOKING DEPOSIT',
					metadata: { promotion: requirement.promotionName }
				})
			: customerId
				? await stripe.createGuaranteeIntent({
						reference: input.reference,
						bookingId: input.bookingId,
						brand,
						customerId,
						feePence: requirement.amountPence,
						terms: requirement.promotionTerms || requirement.reason,
						metadata: { promotion: requirement.promotionName }
					})
				: null;

	// No customer for a guarantee: there is nothing to attach the card to, so say
	// so rather than render a form that can never be charged.
	if (!session) {
		console.warn('[payments] no Stripe customer for guarantee — falling back to manual');
		return NOT_CONFIGURED;
	}

	return {
		intentId: session.id,
		clientSecret: session.clientSecret,
		publishableKey: session.publishableKey,
		mode: session.configured && session.clientSecret ? 'inline' : 'manual_fallback',
		configured: session.configured
	};
}

/** Outcome of a money operation on an existing payment. */
export interface ProviderResult {
	status: 'Created' | 'Authorized' | 'Captured' | 'Reversed' | 'Refunded' | 'Canceled';
}

/**
 * Take the no-show fee: charge the card filed by the SetupIntent.
 *
 * Returns null — a deliberate no-op — for anything that isn't a guarantee. A
 * deposit is already captured and is simply forfeited on a no-show, and a legacy
 * stub id refers to nothing at all.
 */
export async function captureNoShow(
	intentId: string,
	amountPence: number,
	brand?: BrandId,
	bookingId?: string
): Promise<ProviderResult | null> {
	if (stripe.intentKind(intentId) !== 'setup_intent') return null;
	const charged = await stripe.chargeGuarantee(intentId, amountPence, {
		brand,
		bookingId,
		description: 'No-show fee'
	});
	return { status: stripe.mapStatus('payment_intent', charged.status) };
}

/**
 * Release a guarantee — the guest attended, or cancelled in good time.
 *
 * No money was ever held, so there is nothing to reverse: this cancels an
 * INCOMPLETE SetupIntent and leaves a completed one in place (the card stays on
 * file, which saves asking a returning guest again).
 */
export async function releaseHold(
	intentId: string,
	brand?: BrandId
): Promise<ProviderResult | null> {
	if (stripe.intentKind(intentId) !== 'setup_intent') return null;
	const setup = await stripe.releaseGuarantee(intentId, brand);
	return { status: setup.status === 'canceled' ? 'Reversed' : 'Authorized' };
}

/** Refund a captured deposit, whole or in part. Null for a non-deposit. */
export async function refund(
	intentId: string,
	amountPence: number,
	idempotencyKey: string,
	reason?: string,
	brand?: BrandId
): Promise<ProviderResult | null> {
	if (stripe.intentKind(intentId) !== 'payment_intent') return null;
	await stripe.refundPaymentIntent(intentId, amountPence, idempotencyKey, reason, brand);
	return { status: 'Refunded' };
}
