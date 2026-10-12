// Client-side Stripe.js loader + a small wrapper over Elements.
//
// WHY NOT @stripe/stripe-js
// -------------------------
// The official loader is a ~5kB dependency whose entire job is to inject the
// same <script> this file injects. Stripe's own terms require the script to be
// loaded from js.stripe.com at runtime (it cannot be bundled), so the package
// buys nothing here but a version to keep current. Same reasoning as the REST-
// over-SDK choice on the server side.
//
// WHAT THIS WRAPS
// ---------------
// Exactly one flow: mount a Payment Element against a client secret, then
// confirm it. The caller doesn't touch Stripe's objects, which keeps the `any`
// surface (Stripe.js is untyped from here) inside this file instead of spread
// through the widget.
//
// LOADED ON DEMAND, ONCE. The script tag is injected the first time a booking
// actually needs a card — most don't — and reused after that, because a second
// tag would reset the Elements instance already on screen.

/**
 * Versioned Stripe.js, on the same release train as the server's pinned API
 * version and the webhook destination's — Stripe's own recommendation, and worth
 * following because a versioned Stripe.js **pins its own API version and does not
 * let you override it**. Loading `/v3/` while the server talks Dahlia means the
 * browser and the server can disagree about an object with no way to reconcile.
 *
 * `js.stripe.com/v3/` still works and is not deprecated — Stripe backport fixes
 * to it indefinitely — but it is explicitly "no longer recommended for
 * integrations", so this is the right default for new code.
 */
const STRIPE_JS = 'https://js.stripe.com/dahlia/stripe.js';

/** How long to wait for the card form to paint before giving up. */
const READY_TIMEOUT_MS = 20_000;

/** Stripe.js is untyped here; the wrapper below is the only place it leaks. */
type AnyStripe = any;

let scriptPromise: Promise<void> | null = null;

/**
 * Inject js.stripe.com once and resolve when it's ready.
 *
 * Rejects on load failure rather than hanging — ad blockers and strict corporate
 * proxies do block this host, and a promise that never settles would leave the
 * guest on a dead "loading" state with a booking already made.
 */
function loadScript(): Promise<void> {
	if (typeof window === 'undefined') return Promise.reject(new Error('Stripe.js needs a browser'));
	if ((window as AnyStripe).Stripe) return Promise.resolve();
	if (scriptPromise) return scriptPromise;

	scriptPromise = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[src^="${STRIPE_JS}"]`);
		const el = existing ?? document.createElement('script');
		const onLoad = () =>
			(window as AnyStripe).Stripe
				? resolve()
				: reject(new Error('Stripe.js loaded but did not initialise'));
		el.addEventListener('load', onLoad, { once: true });
		el.addEventListener(
			'error',
			() => {
				// Let a later attempt retry rather than caching the failure forever.
				scriptPromise = null;
				reject(new Error('Stripe.js could not be loaded'));
			},
			{ once: true }
		);
		if (!existing) {
			el.src = STRIPE_JS;
			el.async = true;
			document.head.appendChild(el);
		}
	});
	return scriptPromise;
}

/**
 * Start downloading Stripe.js now, before any card form is needed — call it as
 * soon as the booking is known to need a card (the options step says so). On a slow
 * phone line the card form took ~11s to appear after "Complete booking", ~2s of it
 * this download, all of it spent looking at an empty box. Fire-and-forget: a failure
 * here is retried by the real mount, which reports it properly.
 */
export function preloadStripe(): void {
	if (typeof window === 'undefined') return;
	loadScript().catch(() => undefined);
}

export interface StripeAppearance {
	theme?: 'light' | 'dark';
	fontFamily?: string;
	/**
	 * Where Stripe should send the guest for a payment method that MUST redirect
	 * (a bank app, say). Cards never use it — `redirect: 'if_required'` keeps
	 * those in-frame — but Stripe rejects the confirm call without one.
	 *
	 * Passed in rather than derived from the URL: this module has no business
	 * knowing the route shape, and a wrong guess only shows up on the minority of
	 * payment methods that actually redirect, which is the worst place to find a
	 * bug.
	 */
	returnUrl?: string;
	/**
	 * The business the card form names — in the mandate a card guarantee shows ("you
	 * allow X to charge your card…"). Without it Stripe uses the ACCOUNT's public
	 * name, which is "Geisha Bar and Grill" (the Jesmond site's), so Asia and Fusion
	 * guests were asked to authorise a restaurant they weren't booking.
	 */
	businessName?: string;
}

export interface ConfirmResult {
	/** A guest-facing message when the card was refused; undefined on success. */
	error?: string;
}

export interface StripeHandles {
	/** Render the card form into `node`. */
	mount(node: HTMLElement): Promise<void>;
	/**
	 * Confirm the intent. 'payment' for a deposit (PaymentIntent), 'setup' for a
	 * card guarantee (SetupIntent) — the two are different Stripe calls and using
	 * the wrong one fails with an unhelpful error.
	 */
	confirm(kind: 'payment' | 'setup'): Promise<ConfirmResult>;
	/** Tear down the Element (navigating away without this leaks its iframe). */
	destroy(): void;
}

/**
 * Prepare Stripe Elements for one intent.
 *
 * `appearance.theme` maps onto Stripe's own light/dark themes so the card form
 * doesn't sit as a white rectangle in a dark widget.
 */
export async function loadStripe(
	publishableKey: string,
	clientSecret: string,
	appearance: StripeAppearance = {}
): Promise<StripeHandles> {
	await loadScript();

	const stripe = (window as AnyStripe).Stripe(publishableKey);
	const elements = stripe.elements({
		clientSecret,
		appearance: {
			theme: appearance.theme === 'dark' ? 'night' : 'stripe',
			variables: appearance.fontFamily ? { fontFamily: appearance.fontFamily } : undefined
		}
	});
	const element = elements.create('payment', {
		layout: 'tabs',
		...(appearance.businessName ? { business: { name: appearance.businessName } } : {})
	});

	return {
		async mount(node: HTMLElement) {
			element.mount(node);
			// Resolves when the Element has actually painted, so the caller can
			// enable its Pay button on something real rather than on a guess.
			//
			// THREE OUTCOMES, NOT ONE. Waiting only on 'ready' means any failure to
			// load hangs this promise for ever, and the guest is left staring at a
			// permanently disabled Pay button with no error and a booking already
			// made. Stripe emits 'loaderror' for exactly that case — a dead client
			// secret, a network failure, or (since Clover) a client secret from an
			// intent that has already completed. The timeout is the backstop for a
			// failure mode that emits neither.
			await new Promise<void>((resolve, reject) => {
				let settled = false;
				const finish = (err?: Error) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					err ? reject(err) : resolve();
				};
				const timer = setTimeout(
					() => finish(new Error('The card form took too long to load.')),
					READY_TIMEOUT_MS
				);
				element.on('ready', () => finish());
				element.on('loaderror', (event: AnyStripe) =>
					finish(new Error(event?.error?.message || 'The card form could not be loaded.'))
				);
			});
		},

		async confirm(kind) {
			// `redirect: 'if_required'` keeps a plain card payment INSIDE this frame.
			// Without it Stripe navigates to return_url for every payment, which in an
			// embedded widget means the guest loses the host page. 3-D Secure still
			// works — Stripe opens its own modal over us. return_url is still required
			// as a fallback for methods that genuinely must redirect.
			const returnUrl = new URL(
				appearance.returnUrl ?? location.pathname,
				location.origin
			).toString();

			const result =
				kind === 'payment'
					? await stripe.confirmPayment({
							elements,
							confirmParams: { return_url: returnUrl },
							redirect: 'if_required'
						})
					: await stripe.confirmSetup({
							elements,
							confirmParams: { return_url: returnUrl },
							redirect: 'if_required'
						});

			if (result.error) {
				// Stripe's card_error / validation_error messages are written for
				// guests ("Your card was declined."); anything else is an integration
				// fault they can do nothing about, so it gets a generic line.
				const type = result.error.type;
				return {
					error:
						type === 'card_error' || type === 'validation_error'
							? result.error.message
							: 'We couldn’t take that payment. Please check the card details or try another card.'
				};
			}
			return {};
		},

		destroy() {
			try {
				element.destroy();
			} catch {
				// already gone
			}
		}
	};
}
