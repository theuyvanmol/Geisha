// Booking ↔ payment glue: turns a PaymentRequirement (§6 policy) into a card
// session + a geisha_payments record, and handles capture/release/refund when a
// booking is marked no-show / cancelled / attended.
//
// Server-only. Sits between the booking mutations and payments/index.ts, which
// owns the Stripe detail — nothing below needs to know whether a requirement
// becomes a PaymentIntent or a SetupIntent.

import { pb } from '../db/pb.js';
import type { AuditActor, BrandId, Booking, Customer, Payment, PaymentKind, Restaurant } from '../db/types.js';
import type { PaymentRequirement } from './policy.js';
import {
	startSession,
	captureNoShow as providerCaptureNoShow,
	releaseHold as providerReleaseHold,
	refund as providerRefund,
	isConfiguredAsync
} from '../payments/index.js';
import {
	sendNoShowFeeCharged,
	sendRefundIssued,
	confirmationExtras
} from '../email/confirmations.js';
import { writeAudit } from './audit.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/**
 * Which brand a booking belongs to, so a money operation resolves the right
 * Stripe key.
 *
 * Both brands currently share one Stripe account, so this is usually academic —
 * but the key resolver supports a separate account per brand (Asia and Fusion
 * are separate businesses and could bank separately), and the capture / release
 * / refund paths only ever receive a bookingId. Resolving the brand here rather
 * than threading it through every call site means they can't get it wrong.
 * Returns undefined when it can't be determined; the caller then uses the shared
 * key, which is the correct behaviour for a single-account setup.
 */
export async function brandForBooking(bookingId: string): Promise<BrandId | undefined> {
	try {
		const c = await pb();
		const booking = await c.collection('geisha_bookings').getOne<Booking>(bookingId);
		const restaurant = await c
			.collection('geisha_restaurants')
			.getOne<Restaurant>(booking.restaurant);
		return restaurant.brand;
	} catch {
		return undefined;
	}
}

/**
 * How the public widget should collect the card for this payment:
 *   • 'inline'          — render a card form in place with the clientSecret.
 *                         The only mode that works inside the embedded booking
 *                         iframe, since Stripe's hosted Checkout sets
 *                         frame-ancestors and would render blank there.
 *   • 'manual_fallback' — Stripe unconfigured; show "we'll confirm shortly" and
 *                         let staff resolve it. The booking still exists.
 */
export type PaymentCollectionMode = 'inline' | 'manual_fallback';

export interface StartedPayment {
	payment: Payment;
	/** True when a live Stripe session was created (false = stub / not set up). */
	configured: boolean;
	/** The secret the browser confirms the card against. */
	clientSecret?: string;
	/** Stripe publishable key — safe for the browser, needed to mount Elements. */
	publishableKey?: string;
	mode: PaymentCollectionMode;
}

/**
 * Gate a payment requirement on there actually being a payment provider connected.
 *
 * ResDiary parity: deposits and card guarantees are hard-gated behind a connected
 * payment account. A venue with no available provider does not get a degraded
 * deposit — it gets **no deposit feature at all**, and bookings are taken normally.
 * (Their own documented case: a Jersey operator, where Stripe is unavailable, simply
 * "can not take any deposits ... through ResDiary" and handles payment elsewhere.)
 *
 * Ours did the opposite, and it was the single most expensive defect in the July QA
 * sweep. With no credentials the widget still demanded a deposit, rendered no way
 * to pay it, told the guest "your table is reserved", and wrote the booking as
 * `pending_payment` / `confirmed: false` — permanently. Because the live no-show rule
 * is party 1+ on Fri/Sat, that silently swallowed EVERY Friday and Saturday booking on
 * both brands, plus every party of 6+ any day.
 *
 * So: no Stripe → no requirement → the booking confirms like any other. The moment
 * credentials are added (and STRIPE_ALLOW_LIVE armed) the rules light up again with
 * no code change.
 *
 * NOTE the deliberate asymmetry with ResDiary: they never confirm an unpaid booking
 * (it stays "incomplete", holds no table and sends no email). That is the right shape
 * now that a working provider exists, and is worth revisiting once the changeover
 * trial has shown real deposits clearing reliably.
 */
export async function requirementIfCollectable(
	requirement: PaymentRequirement,
	brand?: BrandId
): Promise<PaymentRequirement> {
	if (requirement.kind === 'none') return requirement;
	if (await isConfiguredAsync(brand)) return requirement;
	// Keep any matched promotion label — a promotion can be T&C-only and is
	// independent of whether money changes hands.
	return { ...requirement, kind: 'none', amountPence: 0 };
}

/**
 * The guest's contact details, needed by Stripe to file the card against a
 * Customer. Read from the booking's customer row when the caller didn't pass
 * them. Best-effort: a failure here downgrades a guarantee to manual_fallback
 * rather than failing the booking.
 */
async function customerForBooking(
	bookingId: string
): Promise<{ email: string; name?: string; phone?: string } | undefined> {
	try {
		const c = await pb();
		const booking = await c.collection('geisha_bookings').getOne<Booking>(bookingId);
		const customer = await c.collection('geisha_customers').getOne<Customer>(booking.customer);
		if (!customer.email) return undefined;
		return { email: customer.email, name: customer.name, phone: customer.phone };
	} catch {
		return undefined;
	}
}

/**
 * Start the payment for a booking that requires one. Creates the Stripe card
 * session (a charge for deposits, a stored-card guarantee for no-show holds) and
 * a geisha_payments row. Returns the payment row, whether a live session was
 * created (vs a stub), the client secret / publishable key that drive the
 * widget's card step, and the recommended collection `mode`. The Stripe webhook
 * remains the source of truth for advancing the payment + confirming the booking.
 */
export async function startPaymentForBooking(
	bookingId: string,
	requirement: PaymentRequirement,
	opts: {
		brand?: BrandId;
		customer?: { email: string; name?: string; phone?: string };
	} = {}
): Promise<StartedPayment | null> {
	if (requirement.kind === 'none') return null;

	// Resolve the brand from the booking when the caller didn't name one, so the
	// intent is created against the right merchant account either way.
	const brand = opts.brand ?? (await brandForBooking(bookingId));
	const customer = opts.customer ?? (await customerForBooking(bookingId));

	const reference = `geisha-${bookingId}`;
	const session = await startSession({
		requirement,
		reference,
		bookingId,
		brand,
		customer,
		description:
			requirement.kind === 'deposit'
				? `Booking deposit — ${requirement.promotionName || 'reservation'}`
				: `Card guarantee — ${requirement.promotionName || 'reservation'}`
	});

	const c = await pb();
	const payment = await c.collection('geisha_payments').create<Payment>({
		booking: bookingId,
		// Historic column name (see payments/index.ts) — it holds "the provider's id
		// for this payment". Renaming it would need a PocketBase migration for no
		// functional gain, so it stays.
		dojo_payment_intent_id: session.intentId || `stub_${reference}`,
		kind: requirement.kind as PaymentKind,
		amount: requirement.amountPence,
		status: 'Created', // webhook advances it to Authorized/Captured
		captured_at: '',
		reversed_at: ''
	});

	await writeAudit('system', 'create_payment', 'geisha_payments', payment.id, null, payment);

	return {
		payment,
		configured: session.configured,
		clientSecret: session.clientSecret,
		publishableKey: session.publishableKey,
		mode: session.mode
	};
}

/** Find the payment row for a booking, if any. */
async function paymentForBooking(bookingId: string): Promise<Payment | null> {
	const c = await pb();
	return c
		.collection('geisha_payments')
		.getFirstListItem<Payment>(`booking=${q(bookingId)}`)
		.catch(() => null);
}

/**
 * What a no-show / late-cancellation settlement did with the money.
 *
 * The caller needs this to decide what to TELL the guest. The outcomes are not
 * symmetrical:
 *
 *  • 'fee_captured' — a filed card was charged, and the charging function has
 *    already sent the guest a dedicated "charge for your missed booking" email.
 *    ONLY {@link chargeNoShowFee} produces this; no automatic path does.
 *  • 'deposit_forfeited' — an already-captured deposit is simply kept. Nothing
 *    moves at the provider and NO email is sent from here, so a caller that stays
 *    silent leaves the guest with no word at all about their money.
 */
export interface NoShowChargeOutcome {
	kind: 'fee_captured' | 'deposit_forfeited' | 'none';
	amountPence: number;
	/** True when this function has already emailed the guest about the money. */
	guestNotified: boolean;
}

const NO_CHARGE: NoShowChargeOutcome = { kind: 'none', amountPence: 0, guestNotified: false };

/**
 * What a booking's money does on a late cancel / no-show — WITHOUT moving any.
 *
 * MATCHES RESDIARY, AND THE DISTINCTION IS THE WHOLE POINT. ResDiary's
 * cancellation reasons carry no charge flag at all: cancelling never bills a
 * card, and its two "Card Manually Charged" reasons exist precisely because a
 * human took the fee as a separate, deliberate act. We had the opposite — the
 * clock decided — and `isLateCancellation` is `startsAt - now < 12h`, which is
 * true for the ENTIRE PAST. So correcting a booking put in the wrong brand, or
 * cancelling hours before service, silently billed the guest's filed card.
 *
 * The two money shapes differ by whether money MOVES:
 *
 *  • a filed card (`noshow_hold`) — charging it moves money, so it is never
 *    automatic. The card is left ON FILE, untouched, for staff to charge
 *    deliberately via {@link chargeNoShowManual}. Reports 'none'.
 *  • a captured deposit — the guest already paid it under the §6 policy they
 *    agreed to at booking. Keeping it moves nothing: it is the ABSENCE of a
 *    refund, not a charge. Reports 'deposit_forfeited' so the caller can say so
 *    in the cancellation email it is already sending.
 */
export async function settleNoShowMoney(bookingId: string): Promise<NoShowChargeOutcome> {
	const payment = await paymentForBooking(bookingId);
	if (!payment) return NO_CHARGE;
	if (payment.kind === 'deposit' && payment.status === 'Captured') {
		return { kind: 'deposit_forfeited', amountPence: payment.amount, guestNotified: false };
	}
	return NO_CHARGE;
}

/**
 * Charge a booking's filed card the no-show fee.
 *
 * DELIBERATE ACTION ONLY — nothing automatic calls this. See
 * {@link settleNoShowMoney} for why. Staff reach it through
 * {@link chargeNoShowManual}, which adds the role guard and the audit row.
 *
 * On Stripe the "hold" was never a hold — the card was filed, not authorised —
 * so this is a fresh off-session charge, which is why it can fail (an expired or
 * blocked card) where capturing a held authorisation would simply have worked. The throw is
 * deliberate: staff need to know a no-show fee didn't land.
 */
export async function chargeNoShowFee(bookingId: string): Promise<NoShowChargeOutcome> {
	const payment = await paymentForBooking(bookingId);
	if (!payment) return NO_CHARGE;

	// A GUEST WHO TURNED UP IS NEVER CHARGED A NO-SHOW FEE.
	//
	// Kept now that the automatic callers are gone, because staff can aim this at
	// any booking from the payments panel — and charging a party that sat and ate
	// is a chargeback and a phone call. The rule belongs on the function that
	// actually moves the money, not on whoever calls it.
	const c = await pb();
	const booking = await c
		.collection('geisha_bookings')
		.getOne<Booking>(bookingId)
		.catch(() => null);
	if (booking && (booking.status === 'seated' || booking.status === 'completed')) {
		console.warn(
			`[payments] refusing a no-show fee on booking ${bookingId}: status is ${booking.status} (the guest attended).`
		);
		return NO_CHARGE;
	}

	const brand = await brandForBooking(bookingId);
	if (!(await isConfiguredAsync(brand))) return NO_CHARGE;

	if (payment.kind === 'noshow_hold' && payment.status === 'Authorized') {
		const result = await providerCaptureNoShow(
			payment.dojo_payment_intent_id,
			payment.amount,
			brand,
			bookingId
		);
		if (result) {
			await markPayment(payment.id, result.status, { captured_at: new Date().toISOString() });
			// TELL THE GUEST. A fee that appears on a statement days later with no
			// explanation is a chargeback and a phone call during service. Sent only
			// after the charge actually succeeded, so we never announce money we
			// didn't take. Best-effort — a failed email must not undo a taken fee.
			await notifyGuest(bookingId, (booking, customer, restaurant, extras) =>
				sendNoShowFeeCharged(booking, customer, restaurant, payment.amount, extras)
			);
			return { kind: 'fee_captured', amountPence: payment.amount, guestNotified: true };
		}
		return NO_CHARGE;
	}

	// A deposit is already captured, so there is nothing to charge — forfeiting it
	// moves no money and there is nothing to call the provider about. Reported the
	// same way settleNoShowMoney reports it, so a caller that aims this at a
	// deposit booking still learns what the guest's money did.
	if (payment.kind === 'deposit' && payment.status === 'Captured') {
		return { kind: 'deposit_forfeited', amountPence: payment.amount, guestNotified: false };
	}

	return NO_CHARGE;
}

/**
 * Load a booking's guest + restaurant and hand them to an email sender.
 *
 * NEVER throws and never blocks the money path: every caller here has already
 * moved real money by the time this runs, and an email provider being down must
 * not turn a successful charge into an exception the caller treats as failure.
 */
async function notifyGuest(
	bookingId: string,
	sender: (
		booking: Booking,
		customer: Customer,
		restaurant: Restaurant,
		extras: Awaited<ReturnType<typeof confirmationExtras>>
	) => Promise<{ sent: boolean }>
): Promise<void> {
	try {
		const c = await pb();
		const booking = await c.collection('geisha_bookings').getOne<Booking>(bookingId);
		const [customer, restaurant] = await Promise.all([
			c.collection('geisha_customers').getOne<Customer>(booking.customer),
			c.collection('geisha_restaurants').getOne<Restaurant>(booking.restaurant)
		]);
		await sender(booking, customer, restaurant, await confirmationExtras(booking));
	} catch (err) {
		console.error('[payments] guest notification failed (non-fatal):', err);
	}
}

/**
 * Guest attended (or cancelled in good time): release a no-show guarantee, or
 * refund a deposit if policy says so. No-op without Stripe / a payment.
 */
export async function releaseHold(bookingId: string): Promise<void> {
	const payment = await paymentForBooking(bookingId);
	if (!payment) return;
	const brand = await brandForBooking(bookingId);
	if (!(await isConfiguredAsync(brand))) return;

	if (payment.kind === 'noshow_hold' && payment.status === 'Authorized') {
		const result = await providerReleaseHold(payment.dojo_payment_intent_id, brand);
		// Stripe leaves a completed guarantee in place (no money was ever held, and
		// keeping the card on file saves asking a returning guest again), so it
		// reports 'Authorized' unchanged. Only stamp reversed_at on a real reversal.
		if (result && result.status === 'Reversed') {
			await markPayment(payment.id, result.status, { reversed_at: new Date().toISOString() });
		}
	}
}

/**
 * Refund a captured deposit (e.g. a valid early cancellation).
 *
 * `notify` defaults to true — a standalone refund needs its own email. The
 * cancellation path sets it FALSE and folds the refund line into the
 * cancellation email instead, so a guest cancelling in good time gets one clear
 * message rather than two in the same second saying related things.
 *
 * Returns the refunded amount in pence (0 when nothing was refunded), so the
 * caller can say the actual figure rather than guess it.
 */
export async function refundDeposit(
	bookingId: string,
	reason?: string,
	opts: { notify?: boolean } = {}
): Promise<number> {
	const payment = await paymentForBooking(bookingId);
	if (!payment) return 0;
	const brand = await brandForBooking(bookingId);
	if (!(await isConfiguredAsync(brand))) return 0;
	if (payment.status !== 'Captured') return 0;

	const result = await providerRefund(
		payment.dojo_payment_intent_id,
		payment.amount,
		`refund-${payment.id}`,
		reason,
		brand
	);
	if (!result) return 0;
	// Stamp when the money went back — the deposit report dates refunds by it.
	await markPayment(payment.id, result.status, { reversed_at: new Date().toISOString() });
	if (opts.notify !== false) {
		// A refund is invisible on most statements for days, so guests chase it —
		// by phone, during service. Saying "it's on its way, allow 5–10 days" costs
		// nothing and removes the call.
		await notifyGuest(bookingId, (booking, customer, restaurant) =>
			sendRefundIssued(booking, customer, restaurant, payment.amount, reason)
		);
	}
	return payment.amount;
}

/** Outcome of a manual money action: what happened + the (possibly unchanged) row. */
export interface ManualPaymentResult {
	/** 'refunded' | 'released' | 'charged' on success; 'skipped' when a guard short-circuited. */
	outcome: 'refunded' | 'released' | 'charged' | 'skipped';
	/** Why it was skipped (no payment / not configured / wrong status). */
	reason?: string;
	payment: Payment | null;
}

/**
 * Manager-initiated refund of a captured deposit (the §6 in-time refund happens
 * automatically in cancelBooking; this is the manual override for edge cases —
 * goodwill, errors, partial refunds). Guards:
 *   • no payment / Stripe not configured → skipped (no-op).
 *   • only a CAPTURED payment may be refunded → skipped otherwise (status guard).
 * The refund uses a stable idempotency key (`manual-refund-${paymentId}`)
 * so a double-submit can't double-refund. Writes a `refund_deposit_manual` audit
 * row attributing the human actor (+ on_behalf_of for ai/system).
 *
 * `amount` is pence, or 'full' for the whole captured amount.
 */
export async function refundDepositManual(
	bookingId: string,
	amount: number | 'full',
	reason: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<ManualPaymentResult> {
	const payment = await paymentForBooking(bookingId);
	if (!payment) return { outcome: 'skipped', reason: 'no payment for booking', payment: null };
	const brand = await brandForBooking(bookingId);
	if (!(await isConfiguredAsync(brand))) {
		return { outcome: 'skipped', reason: 'no payment provider configured', payment };
	}
	if (payment.status !== 'Captured') {
		return { outcome: 'skipped', reason: `cannot refund a ${payment.status || 'new'} payment`, payment };
	}

	const amountPence = amount === 'full' ? payment.amount : Math.min(Math.max(0, Math.round(amount)), payment.amount);
	if (amountPence <= 0) return { outcome: 'skipped', reason: 'refund amount must be positive', payment };

	const result = await providerRefund(
		payment.dojo_payment_intent_id,
		amountPence,
		`manual-refund-${payment.id}`,
		reason,
		brand
	);
	if (!result) {
		return { outcome: 'skipped', reason: 'this payment cannot be refunded', payment };
	}
	const after = await markPayment(payment.id, result.status, {
		reversed_at: new Date().toISOString()
	});
	await writeAudit(
		actor,
		'refund_deposit_manual',
		'geisha_payments',
		payment.id,
		payment,
		{ ...after, refundedPence: amountPence, reason },
		onBehalfOf
	);
	return { outcome: 'refunded', payment: after };
}

/**
 * Manager-initiated release/void of an authorisation hold (e.g. waiving a
 * no-show fee). Guards: no payment / not configured → skipped; only an
 * `Authorized` no-show hold may be released → skipped otherwise. Reversal is
 * idempotent at Stripe; we also short-circuit if already reversed via the status
 * guard. Writes a `release_hold_manual` audit row attributing the actor.
 */
export async function releaseHoldManual(
	bookingId: string,
	reason: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<ManualPaymentResult> {
	const payment = await paymentForBooking(bookingId);
	if (!payment) return { outcome: 'skipped', reason: 'no payment for booking', payment: null };
	const brand = await brandForBooking(bookingId);
	if (!(await isConfiguredAsync(brand))) {
		return { outcome: 'skipped', reason: 'no payment provider configured', payment };
	}
	if (!(payment.kind === 'noshow_hold' && payment.status === 'Authorized')) {
		return {
			outcome: 'skipped',
			reason: `cannot release a ${payment.kind || 'payment'} in status ${payment.status || 'new'}`,
			payment
		};
	}

	const result = await providerReleaseHold(payment.dojo_payment_intent_id, brand);
	if (!result) {
		return { outcome: 'skipped', reason: 'this payment has no hold to release', payment };
	}
	// Waiving a Stripe guarantee is a bookkeeping act, not a money one: the card
	// was filed, never authorised, so there is nothing to reverse at the provider.
	// Stamp it locally anyway so staff see the waiver on the payment row.
	const after = await markPayment(payment.id, 'Reversed', { reversed_at: new Date().toISOString() });
	await writeAudit(
		actor,
		'release_hold_manual',
		'geisha_payments',
		payment.id,
		payment,
		{ ...after, reason },
		onBehalfOf
	);
	return { outcome: 'released', payment: after };
}

/**
 * Manager-initiated no-show fee charge — the ONLY route by which a filed card is
 * ever billed.
 *
 * This is ResDiary's model made explicit: cancelling or marking a no-show never
 * touches the card, and taking the fee is a separate act a human chose, logged
 * against their name. ResDiary's "Late cancellation - Card Manually Charged" and
 * "No show - Card Manually Charged" reasons are the label for having done this;
 * pick one of them on the cancellation so the reports agree with the money.
 *
 * Guards, all of which report 'skipped' rather than throwing:
 *   • no payment / Stripe not configured → nothing to charge.
 *   • only an `Authorized` no-show hold is chargeable — a captured deposit has
 *     already been paid, and a reversed hold has been let go deliberately.
 *   • {@link chargeNoShowFee} additionally refuses a seated / completed booking.
 *
 * A successful charge emails the guest (from chargeNoShowFee) and writes a
 * `charge_no_show_manual` audit row attributing the human actor.
 */
export async function chargeNoShowManual(
	bookingId: string,
	reason: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<ManualPaymentResult> {
	const payment = await paymentForBooking(bookingId);
	if (!payment) return { outcome: 'skipped', reason: 'no payment for booking', payment: null };
	const brand = await brandForBooking(bookingId);
	if (!(await isConfiguredAsync(brand))) {
		return { outcome: 'skipped', reason: 'no payment provider configured', payment };
	}
	if (!(payment.kind === 'noshow_hold' && payment.status === 'Authorized')) {
		return {
			outcome: 'skipped',
			reason:
				payment.kind === 'deposit'
					? 'this booking paid a deposit — there is no card to charge'
					: `cannot charge a ${payment.kind || 'payment'} in status ${payment.status || 'new'}`,
			payment
		};
	}

	const outcome = await chargeNoShowFee(bookingId);
	if (outcome.kind !== 'fee_captured') {
		// The attended-booking guard, or the provider declining. Either way no money
		// moved, so say so plainly instead of reporting a charge that didn't happen.
		return { outcome: 'skipped', reason: 'the card was not charged', payment };
	}
	const after = await paymentForBooking(bookingId);
	await writeAudit(
		actor,
		'charge_no_show_manual',
		'geisha_payments',
		payment.id,
		payment,
		{ ...(after ?? payment), chargedPence: outcome.amountPence, reason },
		onBehalfOf
	);
	return { outcome: 'charged', payment: after };
}

/** Persist a Stripe status change onto the payment row (used by webhook + above). */
export async function markPayment(
	paymentId: string,
	status: string,
	extra: Partial<Pick<Payment, 'captured_at' | 'reversed_at'>>
): Promise<Payment> {
	const c = await pb();
	const before = await c.collection('geisha_payments').getOne<Payment>(paymentId);
	// Idempotency: a Stripe retry of the same event (same status, no new timestamp
	// to set) must be a no-op so we don't write a duplicate audit row.
	if (
		before.status === status &&
		(!extra.captured_at || before.captured_at) &&
		(!extra.reversed_at || before.reversed_at)
	) {
		return before;
	}
	const after = await c
		.collection('geisha_payments')
		.update<Payment>(paymentId, { status, ...extra });
	await writeAudit('system', 'payment_status', 'geisha_payments', paymentId, before, after);
	return after;
}

/** Look up a payment row by its Stripe intent id (for the webhook). */
export async function paymentByIntentId(intentId: string): Promise<Payment | null> {
	const c = await pb();
	return c
		.collection('geisha_payments')
		.getFirstListItem<Payment>(`dojo_payment_intent_id=${q(intentId)}`)
		.catch(() => null);
}
