// POST /api/webhooks/stripe — Stripe payment callbacks.
//
// This is the SOURCE OF TRUTH for confirming a booking that required payment.
// The widget's own "the card went through" is a client-side claim; this is
// Stripe telling the server directly. A booking sits in 'pending_payment' —
// holding its table but unconfirmed, and with no email sent — until an event
// here reports the deposit taken or the card filed.
//
// EVENTS WE ACT ON
//   payment_intent.succeeded        deposit charged        → Captured  → confirm
//   payment_intent.payment_failed   card declined          → (status only)
//   payment_intent.canceled         abandoned / cancelled  → Canceled
//   setup_intent.succeeded          card filed (guarantee) → Authorized → confirm
//   setup_intent.setup_failed       card refused           → (status only)
//   charge.refunded                 deposit returned       → Refunded
//
// Everything else is acknowledged and ignored, so Stripe doesn't retry events we
// have no opinion about.
//
// SIGNATURE VERIFICATION is mandatory in production. This endpoint is publicly
// reachable and moves bookings into 'confirmed', so an unverified POST would let
// anyone confirm an unpaid booking. In dev, with no secret set, it processes
// unverified events and says so loudly.

import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { paymentByIntentId } from '$lib/server/booking/payments.js';
import { confirmPaidBooking } from '$lib/server/booking/confirmPayment.js';
import {
	verifyWebhookSignatureAny,
	webhookSecrets,
	mapStatus
} from '$lib/server/payments/stripe.js';
import { writeAudit } from '$lib/server/booking/audit.js';
import type { RequestHandler } from './$types';

interface StripeEvent {
	id?: string;
	type?: string;
	data?: { object?: Record<string, unknown> };
}

export const POST: RequestHandler = async ({ request }) => {
	// Read the raw body exactly ONCE — the HMAC is over the exact bytes, and
	// request.text() cannot be called twice.
	const raw = await request.text();

	// PLURAL. Asia and Fusion may bank into separate Stripe accounts, each signing
	// this same endpoint with its own secret — see webhookSecrets(). With one
	// account this is a one-element list and behaves exactly as before.
	const secrets = await webhookSecrets();
	if (secrets.length === 0) {
		// GATED ON `dev`, NOT ON AN ENV FLAG.
		//
		// This used to read env.PUBLIC_GO_LIVE from $env/dynamic/private, copied
		// from the (now-removed) Dojo webhook. That module EXCLUDES anything starting with
		// `PUBLIC_` (SvelteKit's publicPrefix), so the value was always undefined
		// and the guard never fired — a deployed endpoint with no signing secret
		// would silently process forged events that confirm unpaid bookings.
		//
		// `dev` is true only under `vite dev` and false in every built artefact, so
		// there is no variable to forget, misname, or set on the wrong environment.
		// The failure mode is one-directional: the worst a mistake can do now is
		// refuse a legitimate event, which is loud and recoverable.
		if (!dev) throw error(503, 'Stripe webhook signing secret not configured');
		console.warn(
			'[webhook] STRIPE_WEBHOOK_SECRET / stripe_webhook_secret setting is unset — ' +
				'processing UNVERIFIED Stripe event (dev only). Do not expose this URL publicly.'
		);
	} else {
		const result = verifyWebhookSignatureAny(
			raw,
			request.headers.get('stripe-signature'),
			secrets
		);
		if (!result.ok) {
			const reason = result.reason;
			// Log the reason, never the secret.
			console.warn(
				`[webhook] rejected Stripe event: ${reason} (tried ${secrets.length} signing secret${secrets.length === 1 ? '' : 's'})`
			);
			throw error(401, 'Invalid webhook signature');
		}
	}

	let evt: StripeEvent;
	try {
		evt = JSON.parse(raw);
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const type = evt.type ?? '';
	const object = evt.data?.object ?? {};

	// `charge.refunded` carries a Charge, not an intent — the intent id we stored
	// is on `payment_intent`. Everything else IS the intent.
	const intentId =
		type === 'charge.refunded'
			? (typeof object.payment_intent === 'string' ? object.payment_intent : '')
			: (typeof object.id === 'string' ? object.id : '');

	if (!intentId) return json({ ok: true, ignored: true });

	const payment = await paymentByIntentId(intentId);
	// An unknown intent is normal — the same Stripe account may serve other things,
	// and a test event from the dashboard references nothing here. Ack it.
	if (!payment) return json({ ok: true, unknownIntent: true });

	// A DECLINE IS AN EVENT, NOT JUST A STATUS. `payment_intent.payment_failed`
	// maps back to 'Created' (the intent is reusable — Stripe expects another
	// attempt), which is indistinguishable from "the guest never reached the card
	// form at all". Both then expire and cancel the booking identically, so a run
	// of declined cards looked exactly like a run of people losing interest. Record
	// the failure and Stripe's own reason for it before the status is applied.
	if (type === 'payment_intent.payment_failed' || type === 'setup_intent.setup_failed') {
		const err = (object.last_payment_error ?? object.last_setup_error ?? {}) as Record<
			string,
			unknown
		>;
		await writeAudit('system', 'payment_failed', 'geisha_payments', payment.id, null, {
			booking: payment.booking,
			intent: intentId,
			kind: payment.kind,
			amount: payment.amount,
			// Stripe's vocabulary, unchanged: `code` is the failure class
			// (card_declined), `decline_code` the bank's reason (insufficient_funds),
			// `message` the sentence the guest was shown.
			code: typeof err.code === 'string' ? err.code : '',
			decline_code: typeof err.decline_code === 'string' ? err.decline_code : '',
			message: typeof err.message === 'string' ? err.message : '',
			source: 'stripe_webhook'
		});
	}

	const status = statusFor(type, object);
	if (!status) return json({ ok: true, ignored: true });

	// Idempotent — a Stripe retry of the same event confirms nothing twice.
	const result = await confirmPaidBooking(payment, status);
	return json({ ok: true, outcome: result.outcome });
};

/**
 * Map an event to the geisha_payments status it implies, or null to ignore.
 *
 * Deliberately driven off the EVENT TYPE rather than only the object's `status`
 * field: `charge.refunded` arrives with a Charge whose status is still
 * 'succeeded', so trusting the object alone would record a refund as a capture.
 */
function statusFor(
	type: string,
	object: Record<string, unknown>
): 'Created' | 'Authorized' | 'Captured' | 'Reversed' | 'Refunded' | 'Canceled' | null {
	const objStatus = typeof object.status === 'string' ? object.status : '';

	switch (type) {
		case 'payment_intent.succeeded':
		case 'payment_intent.amount_capturable_updated':
		case 'payment_intent.canceled':
		case 'payment_intent.payment_failed':
		case 'payment_intent.processing':
			return mapStatus('payment_intent', objStatus);

		case 'setup_intent.succeeded':
		case 'setup_intent.canceled':
		case 'setup_intent.setup_failed':
			return mapStatus('setup_intent', objStatus);

		case 'charge.refunded':
			return 'Refunded';

		default:
			return null;
	}
}
