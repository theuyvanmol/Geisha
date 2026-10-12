// Stripe key resolution + the LIVE-MONEY SAFETY GATE.
//
// The posture here is deliberate: local dev points at the LIVE
// PocketBase droplet, so a dev machine holding a live key is one test booking
// away from charging a real card. Stripe at least uses distinguishable prefixes
// (`sk_test_` vs `sk_live_`), but it shares one host, so the prefix is again the
// only thing between a test object and real money.
//
// THE RULE: a `sk_live_` key is INERT unless STRIPE_ALLOW_LIVE is explicitly set.
// A test key needs no opt-in. An unrecognised prefix is treated as live (fail
// safe). With the gate closed, isConfiguredAsync() reports false and the whole
// payments layer stays in its inert mode — no deposits demanded, bookings
// confirm normally, nothing created at Stripe.
//
// PER-BRAND KEYS
// --------------
// Geisha Asia and Geisha Fusion are separate businesses banking separately. If
// they hold two Stripe accounts, set STRIPE_SECRET_KEY_ASIA /
// STRIPE_SECRET_KEY_FUSION and each brand's deposits settle to its own account.
// If they share ONE Stripe account, set the plain STRIPE_SECRET_KEY and both
// brands use it — that is a supported, deliberate configuration, not a fallback
// hazard — Stripe keys are not location-bound — so the shared key is a
// first-class option rather than a last resort.
//
// The PUBLISHABLE key is not a secret — it is designed to ship to the browser and
// is what mounts the card form — but it is still resolved here so the two halves
// of a key pair can never come from different accounts.

import { env } from '$env/dynamic/private';
import type { BrandId } from '../db/types.js';

/** Which Stripe environment a key belongs to. `unknown` is treated as `live`. */
export type StripeEnvironment = 'test' | 'live' | 'unknown';

/** Per-brand env vars. Both fall back to the shared, unsuffixed pair. */
const BRAND_SECRET_ENV: Record<BrandId, string> = {
	asia: 'STRIPE_SECRET_KEY_ASIA',
	fusion: 'STRIPE_SECRET_KEY_FUSION'
};
const BRAND_PUBLISHABLE_ENV: Record<BrandId, string> = {
	asia: 'STRIPE_PUBLISHABLE_KEY_ASIA',
	fusion: 'STRIPE_PUBLISHABLE_KEY_FUSION'
};

/**
 * Classify a key by prefix. Anything not provably test is treated as capable of
 * moving real money, so a typo'd or future-format key fails CLOSED.
 * Restricted keys (`rk_test_` / `rk_live_`) classify the same way.
 */
export function classifyKey(key: string): StripeEnvironment {
	const k = key.trim();
	if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'test';
	if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return 'live';
	return 'unknown';
}

/**
 * Has the operator explicitly opted in to real-money Stripe calls? A separate
 * switch from "is a key present", on purpose: setting it means "yes, I intend
 * this deployment to charge real cards".
 */
export function liveAllowed(): boolean {
	const v = (env.STRIPE_ALLOW_LIVE ?? '').trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes';
}

export interface ResolvedStripeKey {
	/** The raw secret key, or '' when unconfigured or gated off. */
	key: string;
	environment: StripeEnvironment;
	/** True when this key may actually be used for API calls. */
	usable: boolean;
	/** Where the value came from — never includes key material. */
	source: string;
	/** Why it is unusable, when it is. */
	blockedReason?: string;
	brand?: BrandId;
}

const NONE: ResolvedStripeKey = {
	key: '',
	environment: 'unknown',
	usable: false,
	source: 'none',
	blockedReason: 'No Stripe secret key configured.'
};

function envVar(name: string): string {
	const v = env[name];
	return typeof v === 'string' ? v.trim() : '';
}

// Warn once per (brand, reason) so a gated key doesn't spam the log every request.
const warned = new Set<string>();
function warnOnce(token: string, message: string): void {
	if (warned.has(token)) return;
	warned.add(token);
	console.warn(`[stripe] ${message}`);
}

/** Apply the live-money gate to a resolved key. */
function gate(key: string, source: string, brand?: BrandId): ResolvedStripeKey {
	if (!key) return { ...NONE, brand };
	const environment = classifyKey(key);
	if (environment === 'test') return { key, environment, usable: true, source, brand };

	// Name the ACTUAL prefix rather than a hardcoded 'sk_live_' — a restricted key
	// (rk_live_) is just as live, and an operator reading "sk_live_" about a key
	// that plainly starts rk_ will reasonably conclude the message isn't about them.
	const prefix = key.trim().split('_').slice(0, 2).join('_');
	const label =
		environment === 'live' ? `a LIVE (${prefix}_) key` : 'an UNRECOGNISED key prefix';
	if (!liveAllowed()) {
		const blockedReason =
			`Refusing to use ${label} without STRIPE_ALLOW_LIVE. ` +
			`Local dev writes to the live database, so real-money calls need an explicit opt-in. ` +
			`Use a sk_test_ / rk_test_ key for development, or set STRIPE_ALLOW_LIVE=1 to go live deliberately.`;
		warnOnce(`${brand ?? 'any'}:${environment}`, `${source}: ${blockedReason}`);
		return { key: '', environment, usable: false, source, blockedReason, brand };
	}

	warnOnce(
		`${brand ?? 'any'}:live-armed`,
		`LIVE MODE ARMED — ${label} in use for ${brand ?? 'an unbranded call'}. Real money can move.`
	);
	return { key, environment, usable: true, source, brand };
}

/**
 * Resolve the secret key for a brand.
 *
 * Order: the brand's env var → the brand's geisha_settings row → the shared env
 * var / settings value. Env wins over settings for the BRAND-SPECIFIC value so an
 * explicitly-scoped deployment variable can't be shadowed by a stale row typed
 * into the admin screen months ago.
 */
export async function resolveSecretKey(brand?: BrandId): Promise<ResolvedStripeKey> {
	if (brand) {
		const brandEnv = envVar(BRAND_SECRET_ENV[brand]);
		if (brandEnv) return gate(brandEnv, BRAND_SECRET_ENV[brand], brand);
		const shared = envVar('STRIPE_SECRET_KEY');
		try {
			const { getIntegrationKey } = await import('../integrations/keys.js');
			const resolved = (await getIntegrationKey(brand, 'stripe_secret_key')).trim();
			// getIntegrationKey already falls back to env internally, so a value here
			// may have come from EITHER place. Label it by what it actually is —
			// `source` is shown to staff in the admin diagnostics panel, and telling
			// them a key came from Settings when it came from a deployment variable
			// sends them looking in the wrong place when they try to change it.
			if (resolved) {
				return gate(
					resolved,
					resolved === shared ? 'STRIPE_SECRET_KEY (shared)' : `settings:${brand}`,
					brand
				);
			}
		} catch {
			// PocketBase unreachable — fall through to the shared env var.
		}
		if (shared) return gate(shared, 'STRIPE_SECRET_KEY (shared)', brand);
		return { ...NONE, brand };
	}

	// No brand in scope (webhook lookups, status refreshes).
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		const any = (await getIntegrationKeyAny('stripe_secret_key')).trim();
		if (any) return gate(any, 'settings/env (unbranded)');
	} catch {
		// fall through
	}
	const shared = envVar('STRIPE_SECRET_KEY');
	if (shared) return gate(shared, 'STRIPE_SECRET_KEY (unbranded)');
	return NONE;
}

/**
 * The PUBLISHABLE key for a brand — safe to send to the browser, and the value
 * Stripe.js needs to mount the card form.
 *
 * Returns '' when the secret key is missing or gated off, EVEN IF a publishable
 * key is present: handing the widget a publishable key it can't pair with a
 * server-side intent would render a card form that has nothing to submit to.
 * The pair is all-or-nothing.
 */
export async function resolvePublishableKey(brand?: BrandId): Promise<string> {
	const secret = await resolveSecretKey(brand);
	if (!secret.usable) return '';

	if (brand) {
		const brandEnv = envVar(BRAND_PUBLISHABLE_ENV[brand]);
		if (brandEnv) return brandEnv;
		try {
			const { getIntegrationKey } = await import('../integrations/keys.js');
			const stored = (await getIntegrationKey(brand, 'stripe_publishable_key')).trim();
			if (stored) return stored;
		} catch {
			// fall through
		}
	}
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		const any = (await getIntegrationKeyAny('stripe_publishable_key')).trim();
		if (any) return any;
	} catch {
		// fall through
	}
	return envVar('STRIPE_PUBLISHABLE_KEY');
}

/** Operator-facing status per brand, for the admin diagnostics panel. */
export interface StripeStatus {
	brand: BrandId;
	configured: boolean;
	environment: StripeEnvironment;
	usable: boolean;
	source: string;
	blockedReason?: string;
	/** True when a publishable key is also resolvable — without it the widget
	 *  cannot render a card form even though the server could create intents. */
	publishableConfigured: boolean;
}

export async function getStripeStatus(): Promise<StripeStatus[]> {
	const brands: BrandId[] = ['asia', 'fusion'];
	const out: StripeStatus[] = [];
	for (const brand of brands) {
		const r = await resolveSecretKey(brand);
		out.push({
			brand,
			configured: Boolean(r.key) || Boolean(r.blockedReason && r.blockedReason !== NONE.blockedReason),
			environment: r.environment,
			usable: r.usable,
			source: r.source,
			blockedReason: r.blockedReason,
			publishableConfigured: Boolean(await resolvePublishableKey(brand))
		});
	}
	return out;
}
