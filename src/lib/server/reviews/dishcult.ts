// Dishcult / ResDiary feedback connector — pulls guest reviews from the
// restaurants' Dishcult listings into geisha_reviews so the Feedback report
// (/admin/reports) and the reviews page read the SAME rows the manual paste/CSV
// import produces.
//
// WHY A CONNECTOR (not scraping): Dishcult's public restaurant pages bot-block
// (403) and render client-side, so scraping is fragile and against their terms.
// ResDiary instead exposes a partner Data-Extraction / feedback API gated by an
// account API key. This module calls that API when the key is configured and
// degrades to nothing (returns []) when it isn't — the manual paste/CSV import
// (see ai/sentiment.ts + /admin/reviews) remains the always-available path.
//
// GRACEFUL NO-KEY MODE (mirrors payments/stripe.ts): until `resdiary_api_key` is
// set in Settings → Integrations (env fallback RESDIARY_API_KEY), isConfigured()
// is false and fetchDishcultReviews() returns an empty, clearly-flagged result.
// The moment the real key + per-brand slug are added, live pulls happen with no
// code change here.
//
// PARTNER-SPECIFIC SHAPE: the exact ResDiary feedback endpoint + auth header are
// granted per account. They're isolated to ENDPOINT/authHeaders/mapRemoteReview
// below so wiring real access is a small, contained edit — the rest of the app
// (report, sync action, store path) is already built against ParsedReview.

import { env } from '$env/dynamic/private';
import type { BrandId } from '../db/types.js';
import { parseRating, parseDate, type ParsedReview } from '../ai/sentiment.js';

/** The label stored on `review.source` for anything pulled from Dishcult. */
export const DISHCULT_SOURCE = 'dishcult';

/** ResDiary feedback API base. Partner-specific — override via RESDIARY_API_BASE. */
const DEFAULT_BASE = 'https://api.resdiary.com';

function apiBase(): string {
	return (env.RESDIARY_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
}

/**
 * Resolve the ResDiary API key: staff-entered geisha_settings value first
 * (key 'resdiary_api_key'), then env.RESDIARY_API_KEY, else ''. Account-wide
 * (not brand-scoped), so a value saved against either brand satisfies both —
 * matches how the Stripe/AI keys resolve.
 */
export async function apiKey(): Promise<string> {
	try {
		const { getIntegrationKeyAny } = await import('../integrations/keys.js');
		return await getIntegrationKeyAny('resdiary_api_key');
	} catch {
		return env.RESDIARY_API_KEY ?? '';
	}
}

/** True once a ResDiary API key is configured (settings or env). */
export async function isConfiguredAsync(): Promise<boolean> {
	return Boolean(await apiKey());
}

/**
 * The per-brand Dishcult listing slug (e.g. 'geishaasia' /
 * 'geishafusionrestaurant'), stored in geisha_settings under `dishcult_slug`.
 * Identifies WHICH restaurant's feedback to pull for this brand. '' when unset.
 */
export async function dishcultSlug(brand: BrandId): Promise<string> {
	try {
		const { getRestaurant } = await import('../booking/queries.js');
		const { pb } = await import('../db/pb.js');
		const restaurant = await getRestaurant(brand);
		const c = await pb();
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<{ value: unknown }>(
				`restaurant="${restaurant.id}" && key="dishcult_slug"`
			)
			.catch(() => null);
		return typeof row?.value === 'string' ? row.value.trim() : '';
	} catch {
		return '';
	}
}

/** The outcome of a sync attempt — always resolves (never throws). */
export interface DishcultFetch {
	/** True when a live pull ran (key + slug present and the call succeeded). */
	configured: boolean;
	/** Parsed reviews ready for the existing store path (empty when not configured). */
	reviews: ParsedReview[];
	/** A short human reason when configured is false / the pull was skipped. */
	reason?: string;
}

/** A loosely-typed remote review as ResDiary might return it (defensive read). */
interface RemoteReview {
	[k: string]: unknown;
}

/** Auth headers for the ResDiary feedback API (Bearer key — partner-specific). */
function authHeaders(key: string): HeadersInit {
	return { Authorization: `Bearer ${key}`, Accept: 'application/json' };
}

/**
 * Map ONE remote ResDiary/Dishcult review onto our ParsedReview shape, reading
 * each field defensively across a few plausible key names (the exact payload is
 * account-specific). Returns null for a row with no usable review text.
 */
function mapRemoteReview(r: RemoteReview): ParsedReview | null {
	const str = (...keys: string[]): string => {
		for (const k of keys) {
			const v = r[k];
			if (typeof v === 'string' && v.trim()) return v.trim();
			if (typeof v === 'number') return String(v);
		}
		return '';
	};

	const text = str('comment', 'review', 'text', 'body', 'feedback', 'message');
	if (!text) return null;

	return {
		source: DISHCULT_SOURCE,
		rating: parseRating(str('rating', 'overallRating', 'score', 'stars')),
		text,
		author: str('reviewerName', 'author', 'name', 'guestName', 'customerName'),
		posted_at: parseDate(str('visitDate', 'reviewDate', 'date', 'created', 'submittedAt'))
	};
}

/**
 * Pull reviews for a brand from the ResDiary/Dishcult feedback API. ALWAYS
 * resolves (never throws) so callers can render a clean "not configured" /
 * "sync failed" message and fall back to manual import:
 *   • no key           → { configured:false, reviews:[], reason:'…key…' }
 *   • no slug          → { configured:false, reviews:[], reason:'…slug…' }
 *   • network / !ok    → { configured:false, reviews:[], reason:'<status>' }
 *   • ok               → { configured:true,  reviews:[…] }
 *
 * `since` (ISO date) narrows the pull to recent feedback when the API supports
 * it. De-duplication against already-stored rows is the caller's job (the sync
 * action) — this function only fetches + maps.
 */
export async function fetchDishcultReviews(
	brand: BrandId,
	opts: { since?: string } = {}
): Promise<DishcultFetch> {
	const key = await apiKey();
	if (!key) {
		return {
			configured: false,
			reviews: [],
			reason: 'No ResDiary API key set (add it in Settings → Integrations).'
		};
	}
	const slug = await dishcultSlug(brand);
	if (!slug) {
		return {
			configured: false,
			reviews: [],
			reason: `No Dishcult slug set for ${brand} (add it in Settings → Integrations).`
		};
	}

	// ENDPOINT is partner-specific; kept in one place so granting real API access
	// is a contained edit. The query params (restaurant slug + optional since) are
	// the two knobs the feedback report needs.
	const params = new URLSearchParams({ restaurant: slug });
	if (opts.since) params.set('since', opts.since);
	const url = `${apiBase()}/feedback/reviews?${params.toString()}`;

	try {
		const res = await fetch(url, { headers: authHeaders(key) });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			return {
				configured: false,
				reviews: [],
				reason: `ResDiary feedback API → ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`
			};
		}
		const data = (await res.json()) as unknown;
		// Accept either a bare array or a { reviews: [...] } / { items: [...] } wrapper.
		const list: RemoteReview[] = Array.isArray(data)
			? (data as RemoteReview[])
			: Array.isArray((data as { reviews?: unknown }).reviews)
				? ((data as { reviews: RemoteReview[] }).reviews)
				: Array.isArray((data as { items?: unknown }).items)
					? ((data as { items: RemoteReview[] }).items)
					: [];

		const reviews = list
			.map(mapRemoteReview)
			.filter((r): r is ParsedReview => r !== null);

		return { configured: true, reviews };
	} catch (e) {
		return {
			configured: false,
			reviews: [],
			reason: e instanceof Error ? e.message : 'Could not reach the ResDiary feedback API.'
		};
	}
}

/**
 * A stable de-dupe key for a parsed review, used to skip rows already stored on a
 * repeat sync: source + author + posted day + the first 40 chars of the text.
 * Deliberately tolerant (day-granular date, text prefix) so tiny formatting
 * drift on the remote side doesn't create duplicates.
 */
export function reviewDedupeKey(r: {
	source: string;
	author: string;
	posted_at: string;
	text: string;
}): string {
	const day = (r.posted_at || '').slice(0, 10);
	const head = r.text.replace(/\s+/g, ' ').trim().slice(0, 40).toLowerCase();
	return `${r.source}|${r.author.trim().toLowerCase()}|${day}|${head}`;
}
