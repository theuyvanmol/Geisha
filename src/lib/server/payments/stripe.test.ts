import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
	verifyWebhookSignature,
	verifyWebhookSignatureAny,
	mapStatus,
	intentKind,
	isStripeIntent,
	depositIntentParams,
	WEBHOOK_TOLERANCE_SECONDS
} from './stripe.js';
import { classifyKey } from './stripeKeys.js';
import { parseAddress } from '../email/brevo.js';

const SECRET = 'whsec_test_secret';
const BODY = '{"id":"evt_1","type":"payment_intent.succeeded"}';

function sign(body: string, t: number, secret = SECRET): string {
	const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
	return `t=${t},v1=${v1}`;
}

describe('verifyWebhookSignature', () => {
	const now = 1_800_000_000;

	it('accepts a correctly signed, fresh event', () => {
		expect(verifyWebhookSignature(BODY, sign(BODY, now), SECRET, now)).toEqual({ ok: true });
	});

	it('refuses when no signing secret is configured', () => {
		// The production route hard-fails on this rather than trusting the caller.
		const result = verifyWebhookSignature(BODY, sign(BODY, now), '', now);
		expect(result.ok).toBe(false);
	});

	it('refuses a missing header', () => {
		expect(verifyWebhookSignature(BODY, null, SECRET, now).ok).toBe(false);
	});

	it('refuses a malformed header', () => {
		expect(verifyWebhookSignature(BODY, 'garbage', SECRET, now).ok).toBe(false);
		expect(verifyWebhookSignature(BODY, 't=123', SECRET, now).ok).toBe(false);
	});

	it('refuses a signature computed with the wrong secret', () => {
		expect(verifyWebhookSignature(BODY, sign(BODY, now, 'other'), SECRET, now).ok).toBe(false);
	});

	// One endpoint, two Stripe accounts: Asia and Fusion can bank separately, and
	// each account signs with its own whsec_. Nothing in an UNVERIFIED body can be
	// trusted to say which account sent it, so the endpoint tries them all.
	describe('across several signing secrets (a Stripe account per brand)', () => {
		const ASIA = 'whsec_asia_secret';
		const FUSION = 'whsec_fusion_secret';

		it('accepts an event signed by the FIRST secret', () => {
			expect(verifyWebhookSignatureAny(BODY, sign(BODY, now, ASIA), [ASIA, FUSION], now)).toEqual({
				ok: true
			});
		});

		// The regression this whole change exists for: before it, whichever brand's
		// secret happened to be read second could never verify, so that brand's
		// deposits 401'd and its bookings stayed pending_payment.
		it('accepts an event signed by the SECOND secret', () => {
			expect(verifyWebhookSignatureAny(BODY, sign(BODY, now, FUSION), [ASIA, FUSION], now)).toEqual(
				{ ok: true }
			);
		});

		it('still refuses an event signed by no configured secret', () => {
			const result = verifyWebhookSignatureAny(
				BODY,
				sign(BODY, now, 'whsec_someone_else'),
				[ASIA, FUSION],
				now
			);
			expect(result).toEqual({ ok: false, reason: 'signature mismatch' });
		});

		it('refuses when the set is empty', () => {
			expect(verifyWebhookSignatureAny(BODY, sign(BODY, now), [], now)).toEqual({
				ok: false,
				reason: 'no signing secret configured'
			});
		});

		// A mismatch is EXPECTED noise when several accounts share an endpoint, so
		// it must not mask the reason that actually diagnoses the problem.
		it('reports the specific failure, not the mismatch it is buried under', () => {
			const replayed = sign(BODY, now - WEBHOOK_TOLERANCE_SECONDS - 60, ASIA);
			const result = verifyWebhookSignatureAny(BODY, replayed, [ASIA, FUSION], now);
			expect(result).toEqual({
				ok: false,
				reason: 'timestamp outside tolerance (possible replay)'
			});

			expect(verifyWebhookSignatureAny(BODY, 'garbage', [ASIA, FUSION], now)).toEqual({
				ok: false,
				reason: 'malformed Stripe-Signature header'
			});
		});
	});

	it('refuses when the body has been altered', () => {
		const header = sign(BODY, now);
		const tampered = BODY.replace('succeeded', 'canceled');
		expect(verifyWebhookSignature(tampered, header, SECRET, now).ok).toBe(false);
	});

	it('refuses a replayed event outside the tolerance window', () => {
		const old = now - WEBHOOK_TOLERANCE_SECONDS - 1;
		const result = verifyWebhookSignature(BODY, sign(BODY, old), SECRET, now);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/replay/);
	});

	it('accepts an event at the edge of the tolerance window', () => {
		const edge = now - WEBHOOK_TOLERANCE_SECONDS;
		expect(verifyWebhookSignature(BODY, sign(BODY, edge), SECRET, now).ok).toBe(true);
	});

	it('accepts any one of several v1 signatures (secret rollover)', () => {
		const good = createHmac('sha256', SECRET).update(`${now}.${BODY}`).digest('hex');
		const header = `t=${now},v1=deadbeef,v1=${good}`;
		expect(verifyWebhookSignature(BODY, header, SECRET, now).ok).toBe(true);
	});

	it('does not throw on a signature of the wrong length', () => {
		// timingSafeEqual throws on unequal buffer lengths — this must be caught.
		expect(() => verifyWebhookSignature(BODY, `t=${now},v1=ab`, SECRET, now)).not.toThrow();
		expect(verifyWebhookSignature(BODY, `t=${now},v1=ab`, SECRET, now).ok).toBe(false);
	});
});

// 2026-09-11: 8 of the 8 most recent deposits went through a 3-D Secure CHALLENGE
// (banking-app approval) while ResDiary's deposits on the same Stripe account had
// none. The difference was `setup_future_usage: off_session`: saving the card for
// later is what SCA makes the bank challenge, and it also made Stripe show "you allow
// … to charge your card for future payments". Nothing ever charged that saved card —
// chargeNoShowManual refuses deposit bookings — so it was all cost, no benefit.
describe('depositIntentParams', () => {
	const input = {
		amountPence: 8000,
		reference: 'ref_1',
		bookingId: 'bk_1',
		brand: 'asia' as const,
		customerId: 'cus_1',
		statementDescriptor: 'BOOKING DEPOSIT'
	};

	it('does not ask Stripe to save the card, so a deposit is not forced through a bank challenge', () => {
		expect(depositIntentParams(input)).not.toHaveProperty('setup_future_usage');
	});

	it('still takes the money immediately, card only, against the guest', () => {
		const p = depositIntentParams(input);
		expect(p.amount).toBe(8000);
		expect(p.currency).toBe('gbp');
		expect(p.capture_method).toBe('automatic');
		expect(p.payment_method_types).toEqual(['card']);
		expect(p.customer).toBe('cus_1');
	});
});

describe('mapStatus', () => {
	it('reads a succeeded SetupIntent as a card guarantee, not money taken', () => {
		expect(mapStatus('setup_intent', 'succeeded')).toBe('Authorized');
	});

	it('reads a succeeded PaymentIntent as money taken', () => {
		expect(mapStatus('payment_intent', 'succeeded')).toBe('Captured');
	});

	it('maps a manual-capture PaymentIntent awaiting capture to Authorized', () => {
		expect(mapStatus('payment_intent', 'requires_capture')).toBe('Authorized');
	});

	it('maps cancellation for both objects', () => {
		expect(mapStatus('payment_intent', 'canceled')).toBe('Canceled');
		expect(mapStatus('setup_intent', 'canceled')).toBe('Canceled');
	});

	it('leaves an incomplete intent as Created so nothing confirms early', () => {
		expect(mapStatus('payment_intent', 'requires_payment_method')).toBe('Created');
		expect(mapStatus('setup_intent', 'requires_action')).toBe('Created');
		expect(mapStatus('payment_intent', 'processing')).toBe('Created');
	});
});

describe('intentKind / isStripeIntent', () => {
	it('identifies Stripe ids by prefix', () => {
		expect(intentKind('pi_3Abc')).toBe('payment_intent');
		expect(intentKind('seti_1Abc')).toBe('setup_intent');
		expect(isStripeIntent('pi_3Abc')).toBe(true);
		expect(isStripeIntent('seti_1Abc')).toBe(true);
	});

	it('treats a legacy stub id as not-Stripe, so every money path no-ops on it', () => {
		expect(intentKind('7a1e2f00-1111-2222-3333-444455556666')).toBe('unknown');
		expect(isStripeIntent('stub_geisha-abc')).toBe(false);
		expect(isStripeIntent('')).toBe(false);
	});
});

describe('classifyKey (live-money gate)', () => {
	it('recognises test keys', () => {
		expect(classifyKey('sk_test_abc')).toBe('test');
		expect(classifyKey('rk_test_abc')).toBe('test');
	});

	it('recognises live keys', () => {
		expect(classifyKey('sk_live_abc')).toBe('live');
		expect(classifyKey('rk_live_abc')).toBe('live');
	});

	it('fails CLOSED on an unrecognised prefix', () => {
		// Anything not provably test is treated as capable of moving real money.
		expect(classifyKey('pk_abc')).toBe('unknown');
		expect(classifyKey('')).toBe('unknown');
	});
});

describe('parseAddress (Brevo sender)', () => {
	it('splits "Name <addr>"', () => {
		expect(parseAddress('Geisha Restaurants <bookings@example.com>')).toEqual({
			email: 'bookings@example.com',
			name: 'Geisha Restaurants'
		});
	});

	it('passes a bare address through with no name', () => {
		expect(parseAddress('bookings@example.com')).toEqual({ email: 'bookings@example.com' });
	});

	it('strips quotes around a display name', () => {
		expect(parseAddress('"Geisha" <a@b.com>')).toEqual({ email: 'a@b.com', name: 'Geisha' });
	});
});
