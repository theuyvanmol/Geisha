// ALLERGY / DIETARY EXTRACTOR (mf-allergy-aware) — turns the free text a guest
// types into a booking's `special_requests` (plus anything on their customer
// `notes`) into a structured, denormalised `dietary_flags` payload that the live
// floor + run-sheet render as a loud allergy badge.
//
// MOONSHOT PRINCIPLE: the load-bearing layer is DETERMINISTIC — a fast
// keyword/regex pass with NO LLM. It catches the common UK allergens + dietary
// styles ("nut allergy", "coeliac", "vegan", "shellfish", …). It works with no
// AI key configured at all. An OPTIONAL second pass calls runAgent (text-only,
// structured JSON out) to catch fuzzy phrasing the keyword layer misses
// ("can't do anything with peanuts in it") — its result is merged ADDITIVELY and
// can only ADD flags, never remove what the keyword layer already found, and any
// failure (no key, bad JSON, rate limit) is swallowed so the keyword layer stands
// alone.
//
// Pure functions (extractAllergyFlags + helpers) take plain strings so they are
// unit-testable with no PocketBase / network. The PB write lives in
// applyAllergyFlags, called best-effort from createBooking / amendBooking.

import { stripHtml } from '../booking/crm.js';

/**
 * The denormalised allergy/dietary summary stored on `booking.dietary_flags`.
 * Distinct, intentionally-flat shape so the floor tile + run-sheet read it
 * without re-deriving anything:
 *  - `allergies`  : safety-critical allergen keys present (e.g. 'nuts').
 *  - `dietary`    : non-urgent dietary styles (e.g. 'vegan').
 *  - `hasAllergy` : true when ANY allergen signal is present (drives the badge).
 *  - `summary`    : a short human line for the badge/run-sheet (deduped).
 *  - `source`     : which layer produced the flags ('keyword' | 'keyword+ai').
 */
export interface AllergyFlags {
	allergies: string[];
	dietary: string[];
	hasAllergy: boolean;
	summary: string;
	source: 'keyword' | 'keyword+ai';
}

/**
 * Canonical allergen keys + the case-insensitive phrases that signal each one.
 * The 14 UK FIC allergens plus the common informal spellings. Order is the stable
 * display order. Each phrase is matched as a word-ish substring (see `mentions`).
 */
const ALLERGEN_LEXICON: Array<{ key: string; label: string; phrases: string[] }> = [
	{ key: 'nuts', label: 'Nuts', phrases: ['nut', 'nuts', 'peanut', 'peanuts', 'almond', 'cashew', 'walnut', 'hazelnut', 'pistachio', 'pecan'] },
	{ key: 'shellfish', label: 'Shellfish', phrases: ['shellfish', 'crustacean', 'prawn', 'prawns', 'shrimp', 'crab', 'lobster', 'mollusc', 'mollusk', 'oyster', 'mussel', 'clam'] },
	{ key: 'fish', label: 'Fish', phrases: ['fish allergy', 'allergic to fish'] },
	{ key: 'gluten', label: 'Gluten', phrases: ['gluten', 'coeliac', 'celiac', 'wheat'] },
	{ key: 'dairy', label: 'Dairy', phrases: ['dairy', 'milk allergy', 'lactose', 'lactose intoleran'] },
	{ key: 'eggs', label: 'Eggs', phrases: ['egg allergy', 'allergic to egg', 'eggs allergy'] },
	{ key: 'soy', label: 'Soy', phrases: ['soy', 'soya', 'soybean'] },
	{ key: 'sesame', label: 'Sesame', phrases: ['sesame', 'tahini'] },
	{ key: 'celery', label: 'Celery', phrases: ['celery'] },
	{ key: 'mustard', label: 'Mustard', phrases: ['mustard'] },
	{ key: 'sulphites', label: 'Sulphites', phrases: ['sulphite', 'sulfite', 'sulphur dioxide'] },
	{ key: 'lupin', label: 'Lupin', phrases: ['lupin'] }
];

/** Non-urgent dietary styles + their signal phrases. */
const DIETARY_LEXICON: Array<{ key: string; label: string; phrases: string[] }> = [
	{ key: 'vegan', label: 'Vegan', phrases: ['vegan'] },
	{ key: 'vegetarian', label: 'Vegetarian', phrases: ['vegetarian', 'veggie'] },
	{ key: 'pescatarian', label: 'Pescatarian', phrases: ['pescatarian', 'pescetarian'] },
	{ key: 'glutenFree', label: 'Gluten-free', phrases: ['gluten free', 'gluten-free', 'gf meal', 'no gluten'] },
	{ key: 'dairyFree', label: 'Dairy-free', phrases: ['dairy free', 'dairy-free', 'no dairy'] },
	{ key: 'halal', label: 'Halal', phrases: ['halal'] },
	{ key: 'kosher', label: 'Kosher', phrases: ['kosher'] }
];

/**
 * Generic allergy cues that say "this is an allergy" even when no specific
 * allergen is named ("severe allergy", "EpiPen", "anaphylaxis"). Their presence
 * flips `hasAllergy` so the badge shows even for an unnamed allergen the kitchen
 * must ask about.
 */
const GENERIC_ALLERGY_CUES = [
	'allerg', // allergy / allergic / allergen
	'intoleran', // intolerant / intolerance
	'anaphyla', // anaphylaxis / anaphylactic
	'epipen',
	'epi pen'
];

/**
 * Words that turn a generic cue into a REASSURANCE rather than a warning —
 * "2 adults one child no allergies" is the guest telling us there is nothing to
 * worry about, and it used to raise a red ALLERGY badge on the run-sheet and the
 * floor tile. Crying wolf is not a safe default here: a badge that fires on
 * "no allergies" is a badge the pass learns to scroll past.
 *
 * This ONLY ever suppresses the generic-cue path. A cue that names an actual
 * allergen ("no nuts please") is matched by ALLERGEN_LEXICON and stays flagged
 * whatever sits in front of it — negation can never clear a named allergen.
 */
const CUE_NEGATORS = ['no', 'none', 'not', 'nil', 'n/a', 'without', 'zero', 'never'];

/** How far back of a cue we read for a negator — one short clause, not the note. */
const NEGATION_WINDOW = 24;

/**
 * True when EVERY occurrence of a generic cue in `text` is negated. Requiring
 * *every* one is the safe direction: "no allergies for us but John is allergic to
 * sesame" still flags, because the second cue stands unnegated.
 */
function cueIsNegated(text: string, cue: string): boolean {
	let from = 0;
	let seen = false;
	for (;;) {
		const at = text.indexOf(cue, from);
		if (at === -1) break;
		seen = true;
		// The last few words before the cue, e.g. "one child no " -> ['one','child','no'].
		const before = text.slice(Math.max(0, at - NEGATION_WINDOW), at);
		const words = before.split(/[^a-z/]+/).filter(Boolean).slice(-3);
		if (!words.some((w) => CUE_NEGATORS.includes(w))) return false;
		from = at + cue.length;
	}
	return seen;
}

/** Lower-case + collapse whitespace; HTML-stripped so notes markup never hides a cue. */
function normalise(text: string | undefined): string {
	return stripHtml(text || '').toLowerCase();
}

/** True when `haystack` mentions `phrase` (whole-word-ish for short tokens). */
function mentions(haystack: string, phrase: string): boolean {
	if (!phrase) return false;
	// Multi-word / long phrases: a plain substring hit is specific enough.
	if (phrase.includes(' ') || phrase.length > 5) return haystack.includes(phrase);
	// Short tokens ("nut", "egg", "soy"): require a word boundary so "minute" or
	// "doughnut" doesn't trip "nut". Escape is unnecessary — phrases are [a-z]+.
	return new RegExp(`\\b${phrase}\\b`).test(haystack);
}

/**
 * The deterministic keyword/regex pass — NO LLM. Scans the combined free text and
 * returns the allergen + dietary keys it recognises. Pure + synchronous so the
 * test suite covers it with no network. Inputs are merged (both special_requests
 * and customer notes feed one scan) and de-duplicated.
 */
export function extractAllergyFlags(parts: {
	specialRequests?: string;
	notes?: string;
	/** A customer's explicit free-text allergies line (safety-critical, scanned too). */
	allergies?: string;
}): AllergyFlags {
	const text = [parts.specialRequests, parts.notes, parts.allergies]
		.map(normalise)
		.filter(Boolean)
		.join(' · ');

	const allergies: string[] = [];
	const dietary: string[] = [];

	if (text) {
		for (const a of ALLERGEN_LEXICON) {
			if (a.phrases.some((p) => mentions(text, p))) allergies.push(a.key);
		}
		for (const d of DIETARY_LEXICON) {
			if (d.phrases.some((p) => mentions(text, p))) dietary.push(d.key);
		}
	}

	// A generic allergy cue with no specific allergen still flags an allergy —
	// unless every mention of it is negated ("no allergies"), which is a guest
	// ruling allergies OUT, not in.
	const genericCue =
		!!text && GENERIC_ALLERGY_CUES.some((c) => text.includes(c) && !cueIsNegated(text, c));
	const hasAllergy = allergies.length > 0 || genericCue;

	return {
		allergies,
		dietary,
		hasAllergy,
		summary: buildSummary(allergies, dietary, genericCue && allergies.length === 0),
		source: 'keyword'
	};
}

const ALLERGEN_LABEL = new Map(ALLERGEN_LEXICON.map((a) => [a.key, a.label]));
const DIETARY_LABEL = new Map(DIETARY_LEXICON.map((d) => [d.key, d.label]));

/** Build the short human badge line, deduped, allergies first (they shout). */
function buildSummary(allergies: string[], dietary: string[], unnamedAllergy: boolean): string {
	const bits: string[] = [];
	for (const k of allergies) bits.push((ALLERGEN_LABEL.get(k) ?? k).toUpperCase());
	if (unnamedAllergy) bits.push('ALLERGY (see notes)');
	for (const k of dietary) bits.push(DIETARY_LABEL.get(k) ?? k);
	return bits.join(' · ');
}

/** Map a recognised allergen/dietary key to its display label (UI helper). */
export function allergyLabel(key: string): string {
	return ALLERGEN_LABEL.get(key) ?? DIETARY_LABEL.get(key) ?? key;
}

/** True when a `dietary_flags` payload carries any allergen signal. Tolerant of
 *  the loose `unknown` json shape stored on a booking. */
export function flagsHaveAllergy(flags: unknown): boolean {
	if (!flags || typeof flags !== 'object') return false;
	const f = flags as Record<string, unknown>;
	if (f.hasAllergy === true) return true;
	return Array.isArray(f.allergies) && f.allergies.length > 0;
}

// ---------------------------------------------------------------------------
// Optional LLM extraction pass (fuzzy phrasing) — additive, best-effort.
// ---------------------------------------------------------------------------

const KNOWN_ALLERGEN_KEYS = new Set(ALLERGEN_LEXICON.map((a) => a.key));
const KNOWN_DIETARY_KEYS = new Set(DIETARY_LEXICON.map((d) => d.key));

/**
 * OPTIONAL second pass: ask the model to extract the same canonical keys from
 * fuzzy phrasing the keyword layer can't catch. Text-only (no tools), with a
 * strict "reply with JSON only" instruction; we parse defensively and keep ONLY
 * keys from the known vocab. Merges ADDITIVELY onto `base` — it can add allergen/
 * dietary keys (and flip hasAllergy) but never removes what keywords found.
 *
 * Returns `base` unchanged on ANY problem (no AI key, network/rate-limit error,
 * non-JSON reply, unknown keys) so the deterministic layer always stands.
 */
export async function refineWithLLM(
	base: AllergyFlags,
	rawText: string
): Promise<AllergyFlags> {
	const text = normalise(rawText);
	if (!text) return base;

	try {
		const { runAgent, isConfiguredAsync } = await import('./geminiAgent.js');
		if (!(await isConfiguredAsync())) return base;

		const system =
			'You extract food allergy and dietary information from a restaurant booking note. ' +
			'Reply with ONLY a JSON object, no prose, no code fences. Shape: ' +
			'{"allergies":string[],"dietary":string[],"unnamedAllergy":boolean}. ' +
			`Use ONLY these allergy keys: ${[...KNOWN_ALLERGEN_KEYS].join(', ')}. ` +
			`Use ONLY these dietary keys: ${[...KNOWN_DIETARY_KEYS].join(', ')}. ` +
			'Set unnamedAllergy true if the note mentions an allergy/intolerance you cannot map to a key. ' +
			'If nothing applies, return empty arrays and false.';

		const result = await runAgent(system, rawText.slice(0, 800), [], []);
		if (!result.configured || result.errored) return base;

		const parsed = parseLooseJson(result.answer);
		if (!parsed) return base;

		const addAllergies = pickKeys(parsed.allergies, KNOWN_ALLERGEN_KEYS);
		const addDietary = pickKeys(parsed.dietary, KNOWN_DIETARY_KEYS);
		const unnamed = parsed.unnamedAllergy === true;

		const allergies = [...new Set([...base.allergies, ...addAllergies])];
		const dietary = [...new Set([...base.dietary, ...addDietary])];
		const changed =
			allergies.length !== base.allergies.length ||
			dietary.length !== base.dietary.length ||
			(unnamed && !base.hasAllergy);
		if (!changed) return base;

		const hasAllergy = base.hasAllergy || allergies.length > 0 || unnamed;
		return {
			allergies,
			dietary,
			hasAllergy,
			summary: buildSummary(allergies, dietary, hasAllergy && allergies.length === 0),
			source: 'keyword+ai'
		};
	} catch {
		return base; // any failure — fall back to the deterministic result
	}
}

/** Tolerantly parse a JSON object out of a model reply (handles stray prose / fences). */
function parseLooseJson(
	answer: string
): { allergies?: unknown; dietary?: unknown; unnamedAllergy?: unknown } | null {
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

/** Keep only string entries that are in the allowed vocab. */
function pickKeys(value: unknown, allowed: Set<string>): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === 'string' && allowed.has(v));
}

// ---------------------------------------------------------------------------
// PB write — called best-effort from createBooking / amendBooking.
// ---------------------------------------------------------------------------

/**
 * Extract allergy/dietary flags for a booking and write them to
 * `booking.dietary_flags`. BEST-EFFORT: every step is guarded and a failure is
 * swallowed (logged) so this NEVER blocks or rolls back the underlying booking.
 *
 * `useLLM` opts into the fuzzy LLM pass (off by default so the hot create/amend
 * path stays fast + deterministic); the keyword layer always runs first either
 * way. When nothing is detected we still write the (empty, hasAllergy:false)
 * payload so a re-amend that REMOVES an allergen clears a stale badge.
 */
export async function applyAllergyFlags(
	bookingId: string,
	input: { specialRequests?: string; notes?: string; allergies?: string },
	opts: { useLLM?: boolean } = {}
): Promise<AllergyFlags | null> {
	try {
		let flags = extractAllergyFlags(input);
		if (opts.useLLM) {
			const raw = [input.specialRequests, input.notes, input.allergies]
				.filter(Boolean)
				.join(' · ');
			flags = await refineWithLLM(flags, raw);
		}

		const { pb } = await import('../db/pb.js');
		const c = await pb();
		await c.collection('geisha_bookings').update(bookingId, { dietary_flags: flags });
		return flags;
	} catch (err) {
		console.error('[allergy] applyAllergyFlags failed (non-blocking):', err);
		return null;
	}
}
