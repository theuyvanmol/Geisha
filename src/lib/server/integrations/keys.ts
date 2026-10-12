// Integration keys & secrets — the single source of truth for third-party
// credentials (Stripe payments, Brevo/Resend email, the AI Gateway).
//
// DECISION (build memo): integration keys are entered by staff in admin
// Settings → Integrations and stored in geisha_settings, then read SERVER-SIDE
// with an env fallback. Keys are NEVER hardcoded and NEVER reach the browser
// (this module lives under src/lib/server). The admin screen masks stored
// values to their last 4 chars; the raw value is only ever read here, on the
// server, when actually calling the provider.
//
// RESOLUTION ORDER for a read:
//   1. the geisha_settings row for THIS brand carrying the key, if non-empty
//   2. ANY geisha_settings row carrying the key (account-wide secrets like the
//      Stripe/Brevo/AI keys are typically shared, so a value saved against one
//      brand still satisfies a context that lacks a brand) — only used by the
//      brand-less convenience helper below
//   3. the matching environment variable (dev / CI / first-run)
//   4. '' (empty) — callers treat empty as "not configured" and no-op
//
// Storage is per-brand (scoped to the brand's restaurant row) so the Settings
// UI can show/save each brand independently, but the provider modules
// (stripe.ts / send.ts / geminiAgent.ts) have no brand in scope, so they use
// getIntegrationKeyAny(), which honours order (2)→(3).

import { pb } from '../db/pb.js';
import { getRestaurant } from '../booking/queries.js';
import { env } from '$env/dynamic/private';
import type { BrandId } from '../db/types.js';
import { DEFAULT_GIFTUP_SITE_ID } from '$lib/data/giftup.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** The integration setting keys we manage. The value of each is the env var it
 *  falls back to, so a single map drives both reads and the admin screen. */
export const INTEGRATION_ENV_FALLBACK = {
	// Stripe — the ONLY card provider for website bookings. (A Dojo integration
	// briefly existed here; Dojo is the in-restaurant terminal provider and was
	// never used for website payments, so it was removed rather than left as dead
	// code someone might mistake for live.) The publishable key is NOT a secret —
	// it is designed to ship to the browser — so it is shown in full; the secret
	// key and webhook signing secret are masked like every other secret.
	stripe_secret_key: 'STRIPE_SECRET_KEY',
	stripe_publishable_key: 'STRIPE_PUBLISHABLE_KEY',
	stripe_webhook_secret: 'STRIPE_WEBHOOK_SECRET',
	resend_api_key: 'RESEND_API_KEY',
	// Brevo — preferred transactional email provider. When set it takes precedence
	// over Resend (see email/send.ts), so clearing it is the instant rollback.
	brevo_api_key: 'BREVO_API_KEY',
	email_from: 'EMAIL_FROM',
	/** Where guest replies to a confirmation should land. Blank = the From address. */
	email_reply_to: 'EMAIL_REPLY_TO',
	sms_api_key: 'SMS_API_KEY',
	sms_from: 'SMS_FROM',
	ai_gateway_api_key: 'AI_GATEWAY_API_KEY',
	ai_model: 'AI_MODEL',
	// Dishcult / ResDiary feedback connector (see reviews/dishcult.ts). The API key
	// is an account-wide secret; the per-brand listing slug is plain config so the
	// Feedback report knows which restaurant's reviews to pull.
	resdiary_api_key: 'RESDIARY_API_KEY',
	dishcult_slug: 'DISHCULT_SLUG',
	// Gift Up! gift-voucher checkout. The site-id is a PUBLIC identifier (not a
	// secret) — the gift-card page hands off to Gift Up's hosted checkout with it.
	// Editable per brand; falls back to DEFAULT_GIFTUP_SITE_ID when unset.
	giftup_site_id: 'GIFTUP_SITE_ID'
} as const;

export type IntegrationKeyName = keyof typeof INTEGRATION_ENV_FALLBACK;

/** Keys whose value is a SECRET (masked in the UI, never echoed back). The plain
 *  non-secret keys (email_from, sms_from, ai_model) are config shown in full. */
export const SECRET_KEYS: ReadonlySet<IntegrationKeyName> = new Set<IntegrationKeyName>([
	'stripe_secret_key',
	'stripe_webhook_secret',
	// stripe_publishable_key is deliberately NOT here — it is a public identifier
	// the browser must receive, and masking it would only hide a typo.
	'resend_api_key',
	'brevo_api_key',
	'sms_api_key',
	'ai_gateway_api_key',
	'resdiary_api_key'
]);

export const INTEGRATION_KEY_NAMES = Object.keys(
	INTEGRATION_ENV_FALLBACK
) as IntegrationKeyName[];

/** The env-var fallback value for a key (trimmed), or '' when unset. */
function envFallback(name: IntegrationKeyName): string {
	const v = env[INTEGRATION_ENV_FALLBACK[name]];
	return typeof v === 'string' ? v.trim() : '';
}

/** A stored string value out of a geisha_settings row, or '' for empty/absent. */
function asString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

// PERF: a resolved key is read on EVERY provider call, not once per request —
// stripe.ts's `call()` resolves the secret key before each individual API request,
// so refreshing N payment statuses meant N PocketBase settings reads interleaved
// with the N Stripe calls, all against the London droplet. These rows change only
// when someone saves the Settings → Integrations form, which busts the cache
// below, so a short TTL is safe and removes a round-trip per provider call.
//
// The PROMISE is cached, not the value: provider calls fan out concurrently
// (mapWithConcurrency in the deposit report), and a value-only cache would let
// the whole first wave miss and hit PB before any of them resolved. A rejected
// lookup is never cached — but note these helpers already swallow their own
// errors and fall back to env, so a miss resolves to '' rather than throwing;
// that '' is cached for the TTL, which is the same answer the caller would get
// by asking again immediately.
const KEY_TTL_MS = 60_000;
const keyCache = new Map<string, { at: number; value: Promise<string> }>();

/** Drop cached resolutions so the next read sees a just-saved value. */
export function invalidateIntegrationKeyCache(name?: IntegrationKeyName): void {
	if (!name) {
		keyCache.clear();
		return;
	}
	for (const k of [...keyCache.keys()]) {
		if (k.endsWith(`:${name}`)) keyCache.delete(k);
	}
}

function cached(cacheKey: string, load: () => Promise<string>): Promise<string> {
	const hit = keyCache.get(cacheKey);
	if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit.value;
	const value = load();
	keyCache.set(cacheKey, { at: Date.now(), value });
	value.catch(() => {
		if (keyCache.get(cacheKey)?.value === value) keyCache.delete(cacheKey);
	});
	return value;
}

/**
 * Resolve an integration key for a specific brand: the brand's stored value
 * first, then the env fallback, else ''. Used by the admin screen (which always
 * has a brand) and by any brand-aware caller.
 */
export async function getIntegrationKey(
	brand: BrandId,
	name: IntegrationKeyName
): Promise<string> {
	return cached(`${brand}:${name}`, async () => {
		try {
			const restaurant = await getRestaurant(brand);
			const c = await pb();
			const row = await c
				.collection('geisha_settings')
				.getFirstListItem<{ value: unknown }>(
					`restaurant=${q(restaurant.id)} && key=${q(name)}`
				)
				.catch(() => null);
			const stored = asString(row?.value);
			if (stored) return stored;
		} catch {
			// PB unreachable / no restaurant — fall through to env.
		}
		return envFallback(name);
	});
}

/**
 * EVERY distinct value configured for a key across all brands, plus the env
 * fallback — deduplicated, empties dropped.
 *
 * Exists for the one credential where "any brand's value" is the WRONG answer:
 * the Stripe webhook signing secret. Asia and Fusion can bank into separate
 * Stripe accounts, and each account signs its webhooks with its own `whsec_…`.
 * getIntegrationKeyAny() returns whichever brand's row it happens to read first,
 * so the OTHER brand's events fail signature verification and get a 401 — Stripe
 * then retries for days while those bookings sit in `pending_payment`, holding
 * tables, unconfirmed, with no email sent. Verifying against the whole SET is
 * the fix: one endpoint, N accounts.
 *
 * Deliberately UNCACHED. It is called once per inbound webhook — a rate Stripe
 * sets, not our traffic — and the cost of a stale hit here is a rejected real
 * payment, which is far worse than a PocketBase read.
 */
export async function getIntegrationKeyAll(name: IntegrationKeyName): Promise<string[]> {
	const out: string[] = [];
	const add = (v: string) => {
		if (v && !out.includes(v)) out.push(v);
	};
	try {
		const c = await pb();
		const rows = await c
			.collection('geisha_settings')
			.getFullList<{ value: unknown }>({ filter: `key=${q(name)}` })
			.catch(() => [] as Array<{ value: unknown }>);
		for (const row of rows) add(asString(row.value));
	} catch {
		// PB unreachable — the env fallback below still yields a working single
		// secret, which covers both the shared-account case and dev.
	}
	add(envFallback(name));
	return out;
}

/**
 * Resolve an integration key with NO brand in scope (the common case for the
 * provider modules). Tries any geisha_settings row carrying the key, then the
 * env fallback, else ''. Account-wide secrets are shared across brands, so the
 * first non-empty stored value wins regardless of which brand saved it.
 */
export async function getIntegrationKeyAny(name: IntegrationKeyName): Promise<string> {
	return cached(`*:${name}`, async () => {
		try {
			const c = await pb();
			const rows = await c
				.collection('geisha_settings')
				.getFullList<{ value: unknown }>({ filter: `key=${q(name)}` })
				.catch(() => [] as Array<{ value: unknown }>);
			for (const row of rows) {
				const stored = asString(row.value);
				if (stored) return stored;
			}
		} catch {
			// PB unreachable — fall through to env.
		}
		return envFallback(name);
	});
}

/**
 * Save (upsert) an integration key for a brand into geisha_settings, audited as
 * a settings change. An empty/whitespace value CLEARS the stored key (so the
 * env fallback applies again). Returns the resolved value AFTER the save so the
 * caller can re-mask it for display.
 */
export async function setIntegrationKey(
	brand: BrandId,
	name: IntegrationKeyName,
	value: string
): Promise<string> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const next = value.trim();
	const existing = await c
		.collection('geisha_settings')
		.getFirstListItem<{ id: string; value: unknown }>(
			`restaurant=${q(restaurant.id)} && key=${q(name)}`
		)
		.catch(() => null);

	const { writeAudit } = await import('../booking/audit.js');

	if (existing) {
		const before = { ...existing };
		const row = await c
			.collection('geisha_settings')
			.update(existing.id, { value: next });
		await writeAudit('staff', 'update_setting', 'geisha_settings', existing.id, before, row);
	} else {
		const row = await c
			.collection('geisha_settings')
			.create({ restaurant: restaurant.id, key: name, value: next });
		await writeAudit('staff', 'update_setting', 'geisha_settings', row.id, null, row);
	}
	// The read path caches resolutions for a minute — drop this key's entries so
	// the value staff just typed takes effect on the very next provider call, and
	// so the value we hand back for re-masking is the one that was actually saved.
	invalidateIntegrationKeyCache(name);
	return getIntegrationKey(brand, name);
}

/**
 * Resolve the Gift Up site-id for a brand: the brand's stored value, then the
 * env fallback, else the public default. Always returns a usable id so the
 * gift-card checkout works out of the box.
 */
export async function getGiftUpSiteId(brand: BrandId): Promise<string> {
	return (await getIntegrationKey(brand, 'giftup_site_id')) || DEFAULT_GIFTUP_SITE_ID;
}

/** Mask a secret to its last 4 chars (e.g. "sk_live_…AB12"). Empty → ''. */
export function maskKey(value: string): string {
	if (!value) return '';
	if (value.length <= 4) return '•'.repeat(value.length);
	return `•••• ${value.slice(-4)}`;
}

export interface IntegrationKeyStatus {
	name: IntegrationKeyName;
	/** True when a value is resolvable (stored or env). */
	configured: boolean;
	/** True when the resolved value comes from geisha_settings (vs env). */
	fromSettings: boolean;
	/** Masked display value for secrets; the full value for non-secret config. */
	display: string;
	secret: boolean;
	/** The env var that would be used as a fallback. */
	envVar: string;
}

/**
 * Resolve the display status of every managed key for a brand — used by the
 * admin loader. Secrets are masked; the two plain-config keys (email_from,
 * ai_model) show their full value. Never returns a raw secret.
 */
export async function getIntegrationStatus(brand: BrandId): Promise<IntegrationKeyStatus[]> {
	const out: IntegrationKeyStatus[] = [];
	for (const name of INTEGRATION_KEY_NAMES) {
		const value = await getIntegrationKey(brand, name);
		const secret = SECRET_KEYS.has(name);
		out.push({
			name,
			configured: Boolean(value),
			fromSettings: await storedExists(brand, name),
			display: value ? (secret ? maskKey(value) : value) : '',
			secret,
			envVar: INTEGRATION_ENV_FALLBACK[name]
		});
	}
	return out;
}

/** True if a non-empty value for this key is stored in settings for the brand. */
async function storedExists(brand: BrandId, name: IntegrationKeyName): Promise<boolean> {
	try {
		const restaurant = await getRestaurant(brand);
		const c = await pb();
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<{ value: unknown }>(
				`restaurant=${q(restaurant.id)} && key=${q(name)}`
			)
			.catch(() => null);
		return Boolean(asString(row?.value));
	} catch {
		return false;
	}
}
