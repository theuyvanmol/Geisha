// REVIEW SENTIMENT & THEME ANALYSIS (mf-review-sentiment) — turns the free text
// of a guest review (pasted in, or imported by CSV) into a structured signal the
// manager can act on: an overall sentiment, a small set of themes (food, service,
// value, ambience, …), and — on demand — an on-brand draft reply.
//
// MOONSHOT PRINCIPLE: the load-bearing layer is DETERMINISTIC. A fast keyword /
// rating pass (NO LLM) always produces a sentiment + themes, so ingestion works
// with no AI key configured at all and the numbers in the insights view are
// reproducible arithmetic, never a guess. An OPTIONAL second pass calls runAgent
// (text-only, structured JSON out) to sharpen the sentiment and catch themes the
// keyword layer misses; it merges ADDITIVELY (can refine sentiment + add themes,
// never silently drops a keyword theme) and any failure (no key, bad JSON, rate
// limit) is swallowed so the deterministic layer always stands.
//
// The REPLY DRAFT is the one piece that is LLM-only (comms copy), routed through
// runAgent text-only, returned for a human to confirm + edit before it is saved.
//
// Pure functions take plain strings so they are unit-testable with no PocketBase
// / network. The small PB read/aggregate helpers at the bottom (loadReviews,
// summariseReviews) ARE server-only — shared by the /admin/reviews route and the
// get_review_insights read tool so both read the same numbers.

import { stripHtml } from '../booking/crm.js';
import type { BrandId, Review } from '../db/types.js';

/** The three buckets a review's tone lands in. */
export type Sentiment = 'positive' | 'neutral' | 'negative';

/** Canonical theme keys we recognise (stable display order below). */
export type ThemeKey =
	| 'food'
	| 'service'
	| 'value'
	| 'ambience'
	| 'cleanliness'
	| 'wait'
	| 'booking'
	| 'drinks';

/**
 * The denormalised analysis stored on `review.sentiment` (string) +
 * `review.themes` (json). Flat + self-describing so the insights view and the
 * AI read tool render it without re-deriving anything.
 *  - `sentiment` : overall tone bucket.
 *  - `score`     : -100..100 signed confidence (negative = unhappy). Deterministic.
 *  - `themes`    : recognised theme keys, each with the polarity it appeared in.
 *  - `source`    : which layer produced it ('keyword' | 'keyword+ai').
 */
export interface ReviewAnalysis {
	sentiment: Sentiment;
	score: number;
	themes: ThemeTag[];
	source: 'keyword' | 'keyword+ai';
}

/** A theme detected in a review, with the polarity it was mentioned in. */
export interface ThemeTag {
	key: ThemeKey;
	label: string;
	polarity: Sentiment;
}

/** Theme keys + the phrases that signal each. Order is the display order. */
const THEME_LEXICON: Array<{ key: ThemeKey; label: string; phrases: string[] }> = [
	{ key: 'food', label: 'Food', phrases: ['food', 'dish', 'dishes', 'meal', 'sushi', 'ramen', 'flavour', 'flavor', 'cooked', 'menu', 'starter', 'dessert', 'portion', 'taste', 'tasty', 'delicious'] },
	{ key: 'service', label: 'Service', phrases: ['service', 'staff', 'waiter', 'waitress', 'server', 'waitstaff', 'attentive', 'rude', 'friendly', 'host', 'manager', 'team'] },
	{ key: 'value', label: 'Value', phrases: ['value', 'price', 'priced', 'pricey', 'expensive', 'cheap', 'overpriced', 'worth', 'bill', 'cost'] },
	{ key: 'ambience', label: 'Ambience', phrases: ['ambience', 'ambiance', 'atmosphere', 'decor', 'vibe', 'music', 'lighting', 'romantic', 'cosy', 'cozy', 'noisy', 'loud', 'interior'] },
	{ key: 'cleanliness', label: 'Cleanliness', phrases: ['clean', 'dirty', 'hygiene', 'spotless', 'filthy', 'toilet', 'bathroom', 'grubby'] },
	{ key: 'wait', label: 'Wait time', phrases: ['wait', 'waiting', 'waited', 'slow', 'quick', 'prompt', 'delay', 'delayed', 'queue', 'took ages', 'forever'] },
	{ key: 'booking', label: 'Booking', phrases: ['booking', 'reservation', 'reserved', 'table', 'seated', 'overbooked', 'cancelled', 'deposit', 'no show', 'no-show'] },
	{ key: 'drinks', label: 'Drinks', phrases: ['drink', 'drinks', 'cocktail', 'cocktails', 'wine', 'sake', 'beer', 'bar'] }
];

/** Words that push tone positive, with rough weights. */
const POSITIVE_WORDS: Array<[string, number]> = [
	['amazing', 3], ['excellent', 3], ['perfect', 3], ['outstanding', 3], ['fantastic', 3],
	['wonderful', 3], ['delicious', 2], ['lovely', 2], ['great', 2], ['brilliant', 2],
	['superb', 3], ['best', 2], ['recommend', 2], ['friendly', 1], ['attentive', 1],
	['good', 1], ['nice', 1], ['enjoyed', 2], ['enjoyable', 2], ['tasty', 2], ['fresh', 1],
	['impressed', 2], ['gem', 2], ['favourite', 2], ['favorite', 2], ['exceptional', 3]
];

/** Words that push tone negative, with rough weights. */
const NEGATIVE_WORDS: Array<[string, number]> = [
	['terrible', 3], ['awful', 3], ['horrible', 3], ['worst', 3], ['disgusting', 3],
	['rude', 3], ['cold', 1], ['slow', 2], ['disappointing', 2], ['disappointed', 2],
	['bland', 2], ['overpriced', 2], ['dirty', 2], ['poor', 2], ['bad', 2], ['mediocre', 2],
	['undercooked', 2], ['overcooked', 2], ['avoid', 3], ['never again', 3], ['rip off', 3],
	['ripoff', 3], ['waited', 1], ['ignored', 2], ['unfriendly', 2], ['stale', 2],
	['expensive', 1], ['noisy', 1], ['wrong', 1], ['mistake', 1], ['complaint', 2]
];

/** Lower-case + HTML-strip so markup never hides a signal. */
function normalise(text: string | undefined): string {
	return stripHtml(text || '').toLowerCase();
}

/** True when `phrase` appears as a word-ish token in `haystack`. */
function mentions(haystack: string, phrase: string): boolean {
	if (!phrase) return false;
	if (phrase.includes(' ') || phrase.length > 5) return haystack.includes(phrase);
	return new RegExp(`\\b${phrase}\\b`).test(haystack);
}

/** Map a numeric star rating (any 0..5-ish scale) to a signed lexical nudge. */
function ratingNudge(rating: number | undefined): number {
	if (rating == null || !Number.isFinite(rating) || rating <= 0) return 0;
	// 5★ → +6, 4★ → +3, 3★ → 0, 2★ → -3, 1★ → -6 (linear around the 3 midpoint).
	return Math.round((rating - 3) * 3);
}

/**
 * The deterministic analysis — NO LLM. Scans the review text for tone words +
 * theme phrases and folds in the star rating (when present) to produce a signed
 * score, a sentiment bucket and the themes (each tagged with the local polarity
 * around the mention). Pure + synchronous so the test suite covers it offline.
 */
export function analyseReview(input: { text?: string; rating?: number }): ReviewAnalysis {
	const text = normalise(input.text);

	let raw = ratingNudge(input.rating);
	let positives = 0;
	let negatives = 0;
	if (text) {
		for (const [w, weight] of POSITIVE_WORDS) {
			if (mentions(text, w)) {
				raw += weight;
				positives += weight;
			}
		}
		for (const [w, weight] of NEGATIVE_WORDS) {
			if (mentions(text, w)) {
				raw -= weight;
				negatives += weight;
			}
		}
	}

	// Normalise the raw tally to a -100..100 score with a gentle squash so a couple
	// of strong words don't peg it instantly.
	const score = Math.max(-100, Math.min(100, Math.round((raw / 8) * 100)));
	const sentiment: Sentiment = score >= 12 ? 'positive' : score <= -12 ? 'negative' : 'neutral';

	// Per-theme polarity: weigh tone words that sit near the theme phrase. Cheap
	// proxy — if the whole review is positive a mentioned theme is tagged positive
	// unless that theme's own window is clearly negative, and vice-versa.
	const themes: ThemeTag[] = [];
	if (text) {
		for (const t of THEME_LEXICON) {
			if (t.phrases.some((p) => mentions(text, p))) {
				themes.push({ key: t.key, label: t.label, polarity: themePolarity(text, t.phrases, sentiment) });
			}
		}
	}

	return { sentiment, score, themes, source: 'keyword' };
}

/** Estimate a single theme's polarity from tone words within its mention window. */
function themePolarity(text: string, phrases: string[], overall: Sentiment): Sentiment {
	let local = 0;
	for (const p of phrases) {
		const idx = text.indexOf(p.split(' ')[0]);
		if (idx === -1) continue;
		const window = text.slice(Math.max(0, idx - 40), idx + 40);
		for (const [w, weight] of POSITIVE_WORDS) if (window.includes(w)) local += weight;
		for (const [w, weight] of NEGATIVE_WORDS) if (window.includes(w)) local -= weight;
	}
	if (local >= 2) return 'positive';
	if (local <= -2) return 'negative';
	return overall; // no clear local signal — inherit the review's overall tone
}

/** Map a theme key to its display label (UI + tool helper). */
const THEME_LABEL = new Map(THEME_LEXICON.map((t) => [t.key, t.label]));
export function themeLabel(key: string): string {
	return THEME_LABEL.get(key as ThemeKey) ?? key;
}

const KNOWN_THEME_KEYS = new Set(THEME_LEXICON.map((t) => t.key));

// ---------------------------------------------------------------------------
// Optional LLM refinement pass — additive, best-effort.
// ---------------------------------------------------------------------------

/**
 * OPTIONAL second pass: ask the model to confirm the sentiment and surface themes
 * the keyword layer missed. Text-only (no tools), strict "JSON only" instruction;
 * parsed defensively, keeping ONLY known theme keys. Merges ADDITIVELY onto
 * `base` — it can adjust the sentiment bucket and ADD themes, but never drops a
 * theme the keyword layer already found.
 *
 * Returns `base` unchanged on ANY problem (no key, network/rate-limit, non-JSON,
 * unknown keys) so the deterministic layer always stands.
 */
export async function refineWithLLM(base: ReviewAnalysis, rawText: string): Promise<ReviewAnalysis> {
	const text = normalise(rawText);
	if (!text) return base;

	try {
		const { runAgent, isConfiguredAsync } = await import('./geminiAgent.js');
		if (!(await isConfiguredAsync())) return base;

		const system =
			'You classify a restaurant guest review. Reply with ONLY a JSON object, no prose, no code fences. ' +
			'Shape: {"sentiment":"positive"|"neutral"|"negative","themes":string[]}. ' +
			`Use ONLY these theme keys: ${[...KNOWN_THEME_KEYS].join(', ')}. ` +
			'Pick the sentiment that best matches the overall tone. List every theme the review actually discusses.';

		const result = await runAgent(system, rawText.slice(0, 1200), [], []);
		if (!result.configured || result.errored) return base;

		const parsed = parseLooseJson(result.answer);
		if (!parsed) return base;

		// Refine the sentiment if the model returned a valid bucket.
		const sentiment: Sentiment =
			parsed.sentiment === 'positive' || parsed.sentiment === 'neutral' || parsed.sentiment === 'negative'
				? parsed.sentiment
				: base.sentiment;

		// Add any themes the keyword pass missed (inheriting the review's sentiment).
		const have = new Set(base.themes.map((t) => t.key));
		const added: ThemeTag[] = [];
		if (Array.isArray(parsed.themes)) {
			for (const k of parsed.themes) {
				if (typeof k === 'string' && KNOWN_THEME_KEYS.has(k as ThemeKey) && !have.has(k as ThemeKey)) {
					have.add(k as ThemeKey);
					added.push({ key: k as ThemeKey, label: themeLabel(k), polarity: sentiment });
				}
			}
		}

		const changed = sentiment !== base.sentiment || added.length > 0;
		if (!changed) return base;

		return {
			sentiment,
			score: base.score, // score stays deterministic — the LLM only refines buckets/themes
			themes: [...base.themes, ...added],
			source: 'keyword+ai'
		};
	} catch {
		return base; // any failure — deterministic result stands
	}
}

/** Tolerantly parse a JSON object out of a model reply (handles stray prose / fences). */
function parseLooseJson(answer: string): { sentiment?: unknown; themes?: unknown } | null {
	if (!answer) return null;
	const start = answer.indexOf('{');
	const end = answer.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) return null;
	try {
		const obj = JSON.parse(answer.slice(start, end + 1));
		return obj && typeof obj === 'object' ? obj : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// On-brand reply drafting — LLM-only (comms copy), confirm-gated by the caller.
// ---------------------------------------------------------------------------

/**
 * Draft an on-brand reply to a review. LLM-only: this is comms copy, the one
 * place an LLM is genuinely warranted. Returns the draft text for a human to
 * read, edit and confirm before it is published anywhere — nothing is sent here.
 *
 * Returns `{ ok:false }` (with a short reason) on any problem so the UI can show
 * "AI reply unavailable" instead of failing — the manager can still reply by hand.
 */
export async function draftReply(input: {
	text: string;
	rating?: number;
	author?: string;
	sentiment: Sentiment;
	restaurantName?: string;
}): Promise<{ ok: true; draft: string } | { ok: false; reason: string }> {
	const body = stripHtml(input.text).trim();
	if (!body) return { ok: false, reason: 'The review has no text to reply to.' };

	try {
		const { runAgent, isConfiguredAsync } = await import('./geminiAgent.js');
		if (!(await isConfiguredAsync())) {
			return { ok: false, reason: 'The assistant is not switched on (add an AI Gateway key in Settings → Integrations).' };
		}

		const venue = input.restaurantName?.trim() || 'our restaurant';
		const tone =
			input.sentiment === 'negative'
				? 'The guest was unhappy. Acknowledge their experience sincerely, apologise without making excuses, and invite them to give us another chance (offer to make it right offline). Do NOT be defensive.'
				: input.sentiment === 'positive'
					? 'The guest was happy. Thank them warmly and specifically, and invite them back.'
					: 'The guest was mixed/neutral. Thank them for the feedback, address any concern briefly, and invite them back.';

		const system =
			`You are the guest-relations voice of ${venue}, a refined Japanese-Asian restaurant. ` +
			'Write a single short reply to a published guest review — warm, gracious, professional, never corporate or robotic. ' +
			'British English. 2-4 sentences. No emojis. Do not invent specifics (dishes, names, dates) the review did not mention. ' +
			'Sign off simply (e.g. "Warm regards, the team"). Reply with ONLY the message text, no preamble, no quotes. ' +
			tone;

		const prompt =
			(input.author ? `Reviewer: ${input.author}\n` : '') +
			(input.rating ? `Rating: ${input.rating}/5\n` : '') +
			`Review:\n${body.slice(0, 1500)}`;

		const result = await runAgent(system, prompt, [], []);
		if (!result.configured) return { ok: false, reason: 'The assistant is not switched on.' };
		if (result.errored) return { ok: false, reason: result.answer };

		const draft = result.answer.trim();
		if (!draft) return { ok: false, reason: 'The assistant returned an empty draft — please try again.' };
		return { ok: true, draft };
	} catch (e) {
		return { ok: false, reason: e instanceof Error ? e.message : 'Could not draft a reply.' };
	}
}

// ---------------------------------------------------------------------------
// Ingestion parsing — paste (one review per block) + CSV.
// ---------------------------------------------------------------------------

/** A parsed-but-not-yet-stored review row from paste/CSV import. */
export interface ParsedReview {
	source: string;
	rating: number;
	text: string;
	author: string;
	posted_at: string; // ISO datetime ('' if absent)
}

/** Coerce a loose rating cell ("4", "4.5", "★★★★") to a 0..5 number (0 = unknown). */
export function parseRating(raw: string | undefined): number {
	if (!raw) return 0;
	const stars = (raw.match(/★/g) || []).length;
	if (stars) return Math.min(5, stars);
	const n = Number(String(raw).replace(/[^\d.]/g, ''));
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.min(5, n);
}

/** Coerce a loose date cell to an ISO string, or '' if unparseable. */
export function parseDate(raw: string | undefined): string {
	if (!raw) return '';
	const t = Date.parse(raw.trim());
	return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/**
 * Parse pasted reviews: one review per blank-line-separated block. A block whose
 * first line looks like "Name — 5" (or "Name, 4 stars") seeds author + rating;
 * the rest is the review text. Falls back to treating the whole block as text.
 */
export function parsePastedReviews(raw: string, defaults: { source?: string } = {}): ParsedReview[] {
	const source = defaults.source || 'manual';
	return raw
		.split(/\n\s*\n/)
		.map((b) => b.trim())
		.filter(Boolean)
		.map((block) => {
			const lines = block.split('\n');
			const head = lines[0];
			// "Author — 5" / "Author - 4 stars" / "Author, 5/5"
			const m = head.match(/^(.{1,60}?)\s*[—–-]\s*([\d.]+|★+)(?:\s*(?:stars?|\/\s*5))?\s*$/i);
			if (m && lines.length > 1) {
				return {
					source,
					author: m[1].trim(),
					rating: parseRating(m[2]),
					text: lines.slice(1).join('\n').trim(),
					posted_at: ''
				};
			}
			return { source, author: '', rating: 0, text: block, posted_at: '' };
		})
		.filter((r) => r.text.length > 0);
}

/**
 * Parse a CSV of reviews. Header-driven: looks for columns named (case-insensitive,
 * fuzzy) author/name, rating/stars/score, text/review/comment, date/posted,
 * source. A row missing a recognised text column is skipped. Minimal RFC-ish CSV
 * (handles quoted fields with commas + doubled quotes) — no external dependency.
 */
export function parseReviewCsv(raw: string, defaults: { source?: string } = {}): ParsedReview[] {
	const rows = parseCsvRows(raw);
	if (rows.length < 2) return [];
	const header = rows[0].map((h) => h.trim().toLowerCase());

	const find = (...names: string[]) =>
		header.findIndex((h) => names.some((n) => h === n || h.includes(n)));

	const iAuthor = find('author', 'name', 'reviewer');
	const iRating = find('rating', 'stars', 'score');
	const iText = find('text', 'review', 'comment', 'body', 'content');
	const iDate = find('date', 'posted', 'time');
	const iSource = find('source', 'platform', 'site');

	const fallbackSource = defaults.source || 'manual';
	const out: ParsedReview[] = [];
	for (let r = 1; r < rows.length; r++) {
		const row = rows[r];
		if (row.every((c) => !c.trim())) continue; // blank line
		const text = (iText >= 0 ? row[iText] : row[row.length - 1] || '').trim();
		if (!text) continue;
		out.push({
			source: (iSource >= 0 ? row[iSource]?.trim() : '') || fallbackSource,
			author: (iAuthor >= 0 ? row[iAuthor]?.trim() : '') || '',
			rating: parseRating(iRating >= 0 ? row[iRating] : ''),
			text,
			posted_at: parseDate(iDate >= 0 ? row[iDate] : '')
		});
	}
	return out;
}

/** Split a CSV string into rows of fields (quoted fields + doubled-quote escapes). */
function parseCsvRows(raw: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	const text = raw.replace(/\r\n?/g, '\n');
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else inQuotes = false;
			} else field += ch;
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += ch;
	}
	// Flush the trailing field/row.
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

// ---------------------------------------------------------------------------
// Server-only: PB read + deterministic aggregation for the insights view + tool.
// ---------------------------------------------------------------------------

const pbStr = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** PocketBase stores datetimes "YYYY-MM-DD HH:mm:ss.SSSZ" (space, not "T") and
 *  compares lexicographically; normalise an ISO bound before using it in a filter. */
function pbBound(iso: string): string {
	return iso.replace('T', ' ');
}

/**
 * Load a brand's reviews whose `posted_at` (falling back to `created`) is in the
 * inclusive [from, to] date range. `from`/`to` are 'YYYY-MM-DD' local dates.
 * Newest first. Server-only.
 */
export async function loadReviews(brand: BrandId, from: string, to: string): Promise<Review[]> {
	const { pb } = await import('../db/pb.js');
	const { getRestaurant } = await import('../booking/queries.js');
	const c = await pb();
	const restaurant = await getRestaurant(brand);

	// Range bounds: start of `from` .. end of `to` in UTC (good enough for a
	// management view; reviews are not minute-critical).
	const lo = pbBound(new Date(`${from}T00:00:00.000Z`).toISOString());
	const hi = pbBound(new Date(`${to}T23:59:59.999Z`).toISOString());

	return c.collection('geisha_reviews').getFullList<Review>({
		filter:
			`restaurant=${pbStr(restaurant.id)} && ` +
			`((posted_at!="" && posted_at>=${pbStr(lo)} && posted_at<=${pbStr(hi)}) || ` +
			`(posted_at="" && created>=${pbStr(lo)} && created<=${pbStr(hi)}))`,
		sort: '-posted_at,-created'
	});
}

/** The deterministic insights summary the manager view + AI tool both render. */
export interface ReviewInsights {
	from: string;
	to: string;
	total: number;
	averageRating: number; // 0 if no rated reviews
	sentiment: { positive: number; neutral: number; negative: number };
	/** Themes ranked by mention count, each with a positive/negative split. */
	themes: Array<{ key: string; label: string; count: number; positive: number; negative: number }>;
	/** Reviews still needing attention: negative + no reply drafted yet. */
	needsAttention: number;
}

/** Read a stored `review.sentiment` string into a known bucket (default neutral). */
function readSentiment(s: string | undefined): Sentiment {
	return s === 'positive' || s === 'negative' ? s : 'neutral';
}

/** Read a stored `review.themes` json into ThemeTag[] (tolerant of loose shapes). */
function readThemes(raw: unknown): ThemeTag[] {
	if (!Array.isArray(raw)) return [];
	const out: ThemeTag[] = [];
	for (const t of raw) {
		if (t && typeof t === 'object' && typeof (t as ThemeTag).key === 'string') {
			const tag = t as ThemeTag;
			out.push({
				key: tag.key,
				label: tag.label || themeLabel(tag.key),
				polarity: readSentiment(tag.polarity)
			});
		} else if (typeof t === 'string') {
			out.push({ key: t as ThemeKey, label: themeLabel(t), polarity: 'neutral' });
		}
	}
	return out;
}

/**
 * Deterministically aggregate a set of reviews into the insights summary. PURE
 * arithmetic over the stored analysis — no LLM, so the numbers are reproducible.
 */
export function summariseReviews(reviews: Review[], from: string, to: string): ReviewInsights {
	const sentiment = { positive: 0, neutral: 0, negative: 0 };
	const themeMap = new Map<string, { label: string; count: number; positive: number; negative: number }>();
	let ratingSum = 0;
	let rated = 0;
	let needsAttention = 0;

	for (const r of reviews) {
		const s = readSentiment(r.sentiment);
		sentiment[s]++;
		if (Number.isFinite(r.rating) && r.rating > 0) {
			ratingSum += r.rating;
			rated++;
		}
		for (const t of readThemes(r.themes)) {
			const e = themeMap.get(t.key) ?? { label: t.label, count: 0, positive: 0, negative: 0 };
			e.count++;
			if (t.polarity === 'positive') e.positive++;
			else if (t.polarity === 'negative') e.negative++;
			themeMap.set(t.key, e);
		}
		// "Needs attention": a negative review with no published reply yet.
		const replied = Boolean(r.reply) && r.reply_status === 'published';
		if (s === 'negative' && !replied) needsAttention++;
	}

	const themes = [...themeMap.entries()]
		.map(([key, e]) => ({ key, label: e.label, count: e.count, positive: e.positive, negative: e.negative }))
		.sort((a, b) => b.count - a.count);

	return {
		from,
		to,
		total: reviews.length,
		averageRating: rated ? Math.round((ratingSum / rated) * 10) / 10 : 0,
		sentiment,
		themes,
		needsAttention
	};
}

// ---------------------------------------------------------------------------
// Feedback report — per-day star breakdown (ResDiary "Feedback Summary" parity).
// ---------------------------------------------------------------------------

/** One day's star breakdown, mirroring the ResDiary Feedback Summary columns. */
export interface FeedbackDayRow {
	date: string; // local 'YYYY-MM-DD' ('' for the synthetic Totals row)
	/** star -> count (index 1..5 used; 0 = unrated, excluded from the star cols). */
	counts: [number, number, number, number, number, number];
	/** star -> % of that day's RATED reviews (0..100, one decimal). */
	pct: [number, number, number, number, number, number];
	averageRating: number; // mean of that day's rated reviews (0 if none)
	total: number; // reviews that day (rated + unrated)
	rated: number; // reviews that day carrying a 1..5 star rating
}

/** The whole Feedback Summary: per-day rows (newest first) + a Totals row. */
export interface FeedbackReport {
	from: string;
	to: string;
	byDay: FeedbackDayRow[];
	totals: FeedbackDayRow;
}

/** Round a star rating to its 1..5 bucket, or 0 when absent/out of range. */
function starBucket(rating: number | undefined): number {
	if (rating == null || !Number.isFinite(rating) || rating <= 0) return 0;
	return Math.min(5, Math.max(1, Math.round(rating)));
}

/** Local 'YYYY-MM-DD' for an ISO instant in the given timezone (matches reporting.ts). */
function localDay(iso: string, timezone: string): string {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(t));
}

/**
 * Deterministically bucket reviews into a per-day star breakdown — the ResDiary
 * "Feedback Summary" table (1★..5★ counts + % of that day's rated reviews, the
 * day's average rating, and a total), plus a reconciling Totals row. PURE
 * arithmetic (no LLM), grouped by the review's local visit/review day
 * (`posted_at` falling back to `created`). Rows are newest-first to match the
 * ResDiary report. Exposed for unit tests (no live PB).
 */
export function summariseFeedbackByDay(
	reviews: Review[],
	from: string,
	to: string,
	timezone = 'Europe/London'
): FeedbackReport {
	const blank = (date: string): FeedbackDayRow => ({
		date,
		counts: [0, 0, 0, 0, 0, 0],
		pct: [0, 0, 0, 0, 0, 0],
		averageRating: 0,
		total: 0,
		rated: 0
	});

	const byDay = new Map<string, { row: FeedbackDayRow; ratingSum: number }>();
	const totals = { row: blank(''), ratingSum: 0 };

	for (const r of reviews) {
		const date = localDay(r.posted_at || r.created, timezone);
		if (!date) continue;
		const bucket = starBucket(r.rating);

		const entry = byDay.get(date) ?? { row: blank(date), ratingSum: 0 };
		const tally = (t: { row: FeedbackDayRow; ratingSum: number }) => {
			t.row.total++;
			if (bucket > 0) {
				t.row.counts[bucket]++;
				t.row.rated++;
				t.ratingSum += bucket;
			}
		};
		tally(entry);
		tally(totals);
		byDay.set(date, entry);
	}

	// Finalise a row: percentages over that row's RATED reviews + mean rating.
	const finalise = (t: { row: FeedbackDayRow; ratingSum: number }): FeedbackDayRow => {
		const rated = t.row.rated;
		for (let star = 1; star <= 5; star++) {
			t.row.pct[star] = rated > 0 ? Math.round((t.row.counts[star] / rated) * 1000) / 10 : 0;
		}
		t.row.averageRating = rated > 0 ? Math.round((t.ratingSum / rated) * 100) / 100 : 0;
		return t.row;
	};

	const byDayArr = [...byDay.values()]
		.map(finalise)
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first

	return { from, to, byDay: byDayArr, totals: finalise(totals) };
}
