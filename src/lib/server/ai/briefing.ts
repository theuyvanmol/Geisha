// Nightly AI Manager Briefing (MF-NIGHTLY-BRIEFING) — hybrid: deterministic
// snapshot + LLM prose.
//
// EVERY FACT is computed by the existing deterministic tools/queries (getDashboard,
// getBookingsForDay, mf-noshow-risk, mf-allergy-aware, mf-demand-forecast,
// mf-review-sentiment themes). The LLM (runAgent text-only) ONLY writes the prose
// around those supplied numbers — it is handed the structured payload and a strict
// "use only the provided data, never invent a number" system prompt. If the LLM
// isn't configured or errors, we fall back to a deterministic plain-text brief so
// the email + the 'Tonight' card always have something useful.
//
// PERSISTENCE / IDEMPOTENCY: the finished briefing is stored as a geisha_ai_insights
// row (kind 'nightly_briefing', subject_id = the local date 'YYYY-MM-DD'). There is
// exactly ONE row per (restaurant, date): assembleBriefing reuses the existing row
// if present (so the cron can run repeatedly without duplicating), and getBriefing
// reads it back for the 'Tonight' card and the get_briefing read tool.
//
// Server-only. NO writes beyond the single insight row; the briefing observes, it
// never acts.

import { pb } from '../db/pb.js';
import type { AiInsight, BrandId, Restaurant } from '../db/types.js';
import { getRestaurant } from '../booking/queries.js';
import { getDashboard, getBookingsForDay, listPeriods, type BookingWithRefs } from '../booking/admin.js';
import { computeDayRisk } from './risk/noShowRisk.js';
import { extractAllergyFlags, allergyLabel } from './allergy.js';
import { forecastForDate, PACING_CURVE_KEY, type PacingCurve } from './forecast.js';
import { loadReviews, summariseReviews, themeLabel } from './sentiment.js';
import { runAgent } from './geminiAgent.js';
import type { Setting } from '../db/types.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** geisha_ai_insights.kind for the stored nightly briefing (one per brand/date). */
export const BRIEFING_KIND = 'nightly_briefing';

/** How many days of recent reviews to roll themes up from for the brief. */
const REVIEW_WINDOW_DAYS = 14;

/** Cap rows fed to the model so the prompt stays small on the 1GB droplet. */
const TOP_RISK = 8;
const TOP_ALLERGY = 12;
const TOP_VIP = 8;

/** 'HH:mm' in Europe/London for clean display. */
function fmtTime(iso: string): string {
	return new Date(iso).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/London'
	});
}

// ---------------------------------------------------------------------------
// Snapshot — the deterministic, LLM-free payload of facts.
// ---------------------------------------------------------------------------

export interface BriefingSnapshot {
	brand: BrandId;
	date: string; // 'YYYY-MM-DD' (local)
	restaurantName: string;
	dashboard: {
		totalBookings: number;
		totalCovers: number;
		seated: number;
		pendingPayment: number;
	};
	firstArrival: string | null; // 'HH:mm' of the earliest live arrival
	lastArrival: string | null;
	risk: {
		high: number;
		medium: number;
		low: number;
		top: Array<{ time: string; name: string; partySize: number; score: number; band: string; factors: string[] }>;
	};
	allergies: {
		flaggedBookings: number;
		allergyAlerts: number;
		rows: Array<{ time: string; guest: string; partySize: number; allergies: string[]; dietary: string[] }>;
	};
	vips: Array<{ time: string; name: string; partySize: number; tags: string[] }>;
	pacing: {
		coldStart: boolean;
		periods: Array<{ periodName: string; expectedCovers: number; recommendedPeriodCap: number; coldStart: boolean }>;
	};
	reviews: {
		windowDays: number;
		count: number;
		averageRating: number | null;
		topThemes: Array<{ theme: string; count: number; negative: number }>;
		sentiment: { positive: number; neutral: number; negative: number };
		needsAttention: number;
	};
}

/** Load the stored demand-forecast curve for a restaurant, or null (cold-start). */
async function loadPacingCurve(restaurantId: string): Promise<PacingCurve | null> {
	const c = await pb();
	try {
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${q(restaurantId)} && key=${q(PACING_CURVE_KEY)}`);
		const v = row.value;
		return v && typeof v === 'object' ? (v as PacingCurve) : null;
	} catch {
		return null;
	}
}

/** Pull a VIP/tag list off an expanded customer (defensive about json shapes). */
function customerTags(b: BookingWithRefs): { vip: boolean; tags: string[] } {
	const cust = b.expand?.customer as
		| { vip?: boolean; tags?: unknown }
		| undefined;
	const tags = Array.isArray(cust?.tags)
		? (cust!.tags as unknown[]).map((t) => String(t)).filter(Boolean)
		: [];
	return { vip: Boolean(cust?.vip), tags };
}

/** Roll up themes + sentiment from recent reviews. Reuses the SAME deterministic
 *  aggregator the /admin/reviews page + get_review_insights tool use (sentiment.ts)
 *  so the briefing's numbers never disagree with them. Degrades to an empty rollup
 *  if the reviews collection is absent (pre-migration dev data). */
async function reviewRollup(brand: BrandId, date: string, now: Date): Promise<BriefingSnapshot['reviews']> {
	const empty: BriefingSnapshot['reviews'] = {
		windowDays: REVIEW_WINDOW_DAYS,
		count: 0,
		averageRating: null,
		topThemes: [],
		sentiment: { positive: 0, neutral: 0, negative: 0 },
		needsAttention: 0
	};
	const from = new Date(now.getTime() - REVIEW_WINDOW_DAYS * 86_400_000)
		.toISOString()
		.slice(0, 10);
	let insights;
	try {
		const reviews = await loadReviews(brand, from, date);
		insights = summariseReviews(reviews, from, date);
	} catch {
		return empty; // collection absent / query failed — degrade gracefully
	}
	if (insights.total === 0) return empty;

	return {
		windowDays: REVIEW_WINDOW_DAYS,
		count: insights.total,
		averageRating: insights.averageRating > 0 ? insights.averageRating : null,
		topThemes: insights.themes
			.slice(0, 6)
			.map((t) => ({ theme: themeLabel(t.key), count: t.count, negative: t.negative })),
		sentiment: insights.sentiment,
		needsAttention: insights.needsAttention
	};
}

/**
 * Build the deterministic snapshot for one brand + local date. Every number here
 * comes from an existing pure/queried source — NO LLM. Degrades field-by-field so
 * a missing collection never aborts the whole brief.
 */
export async function buildSnapshot(
	brand: BrandId,
	date: string,
	now: Date = new Date()
): Promise<BriefingSnapshot> {
	const restaurant = await getRestaurant(brand);

	const [dashboard, bookings, risks, periods, curve, reviews] = await Promise.all([
		getDashboard(brand, date),
		getBookingsForDay(brand, date),
		computeDayRisk(brand, date, now.getTime()).catch(() => []),
		listPeriods(brand),
		loadPacingCurve(restaurant.id),
		reviewRollup(brand, date, now)
	]);

	const live = bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'no_show');
	const sortedLive = [...live].sort(
		(a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
	);

	// Allergy / dietary — re-derive live via the same deterministic extractor.
	const allergyRows = live
		.map((b) => {
			const customer = b.expand?.customer;
			const flags = extractAllergyFlags({
				specialRequests: b.special_requests,
				notes: customer?.notes,
				allergies: customer?.allergies
			});
			return {
				time: fmtTime(b.starts_at),
				guest: customer?.name?.trim() || `${b.party_size}p (no name)`,
				partySize: b.party_size,
				allergies: flags.allergies.map(allergyLabel),
				dietary: flags.dietary.map(allergyLabel),
				hasSignal: flags.hasAllergy || flags.dietary.length > 0,
				hasAllergy: flags.hasAllergy,
				startsAt: b.starts_at
			};
		})
		.filter((r) => r.hasSignal)
		.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

	// VIPs in tonight.
	const vips = live
		.map((b) => {
			const { vip, tags } = customerTags(b);
			return {
				time: fmtTime(b.starts_at),
				name: b.expand?.customer?.name?.trim() || `${b.party_size}p (no name)`,
				partySize: b.party_size,
				tags,
				isVip: vip || tags.includes('vip') || tags.includes('VIP'),
				startsAt: b.starts_at
			};
		})
		.filter((v) => v.isVip)
		.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
		.slice(0, TOP_VIP)
		.map(({ time, name, partySize, tags }) => ({ time, name, partySize, tags }));

	const high = risks.filter((r) => r.risk.band === 'high').length;
	const medium = risks.filter((r) => r.risk.band === 'medium').length;

	const forecast = forecastForDate(date, curve, periods);

	return {
		brand,
		date,
		restaurantName: restaurant.display_name,
		dashboard: {
			totalBookings: dashboard.totalBookings,
			totalCovers: dashboard.totalCovers,
			seated: dashboard.seated,
			pendingPayment: dashboard.pendingPayment
		},
		firstArrival: sortedLive.length ? fmtTime(sortedLive[0].starts_at) : null,
		lastArrival: sortedLive.length ? fmtTime(sortedLive[sortedLive.length - 1].starts_at) : null,
		risk: {
			high,
			medium,
			low: risks.length - high - medium,
			top: risks.slice(0, TOP_RISK).map((r) => ({
				time: fmtTime(r.startsAt),
				name: r.customerName,
				partySize: r.partySize,
				score: r.risk.score,
				band: r.risk.band,
				factors: r.risk.factors.map((f) => f.label)
			}))
		},
		allergies: {
			flaggedBookings: allergyRows.length,
			allergyAlerts: allergyRows.filter((r) => r.hasAllergy).length,
			rows: allergyRows
				.slice(0, TOP_ALLERGY)
				.map(({ time, guest, partySize, allergies, dietary }) => ({
					time,
					guest,
					partySize,
					allergies,
					dietary
				}))
		},
		vips,
		pacing: {
			coldStart: forecast.coldStart,
			periods: forecast.periods.map((p) => ({
				periodName: p.periodName,
				expectedCovers: p.expectedCovers,
				recommendedPeriodCap: p.recommendedPeriodCap,
				coldStart: p.coldStart
			}))
		},
		reviews
	};
}

// ---------------------------------------------------------------------------
// Prose — LLM text-only, strictly grounded in the snapshot.
// ---------------------------------------------------------------------------

const BRIEFING_SYSTEM =
	'You are the duty manager writing the morning operations briefing for a restaurant. ' +
	'You are given a JSON snapshot of TODAY\'s service, already computed from the booking system. ' +
	'Write a crisp, scannable brief for the manager about to run the shift.\n\n' +
	'STRICT RULES:\n' +
	'- Use ONLY the numbers and facts in the provided JSON. NEVER invent, estimate or round figures that are not present.\n' +
	'- If a section is empty (e.g. no allergies, no VIPs), say so briefly or skip it — do not pad.\n' +
	'- No preamble, no sign-off, no markdown headings with #. Use short labelled lines or tight bullet points.\n' +
	'- Lead with the headline: covers booked and how busy tonight is. Then flag the risky covers (chase deposits), ' +
	'allergies for the pass, VIPs to greet, the pacing/cap picture, and anything from recent reviews worth watching.\n' +
	'- Be specific with names, times and party sizes where the data gives them. Keep it under ~180 words.';

/** Render the LLM prose for a snapshot. Falls back to a deterministic brief if the
 *  model is unavailable/errors so the email + card always have content. */
export async function renderProse(snap: BriefingSnapshot): Promise<{ text: string; aiWritten: boolean }> {
	const payload = JSON.stringify(snap);
	try {
		const result = await runAgent(
			BRIEFING_SYSTEM,
			`Snapshot for ${snap.restaurantName} on ${snap.date}:\n${payload}\n\nWrite the briefing.`,
			[],
			[]
		);
		if (result.configured && !result.errored && result.answer.trim()) {
			return { text: result.answer.trim(), aiWritten: true };
		}
	} catch {
		// fall through to deterministic brief
	}
	return { text: fallbackProse(snap), aiWritten: false };
}

/** Deterministic plain-text brief — used when the LLM is off or errors. Honest,
 *  no invented numbers, assembled straight from the snapshot. */
export function fallbackProse(snap: BriefingSnapshot): string {
	const lines: string[] = [];
	const d = snap.dashboard;
	const span =
		snap.firstArrival && snap.lastArrival ? ` (${snap.firstArrival}–${snap.lastArrival})` : '';
	lines.push(
		`Tonight: ${d.totalBookings} booking${d.totalBookings === 1 ? '' : 's'}, ${d.totalCovers} cover${
			d.totalCovers === 1 ? '' : 's'
		}${span}.` + (d.pendingPayment ? ` ${d.pendingPayment} awaiting payment.` : '')
	);

	if (snap.risk.high || snap.risk.medium) {
		const top = snap.risk.top
			.filter((r) => r.band === 'high')
			.slice(0, 3)
			.map((r) => `${r.name} ${r.time} (${r.partySize}p, ${r.score})`)
			.join('; ');
		lines.push(
			`No-show risk: ${snap.risk.high} high, ${snap.risk.medium} medium.` +
				(top ? ` Chase: ${top}.` : '')
		);
	} else {
		lines.push('No-show risk: none flagged.');
	}

	if (snap.allergies.flaggedBookings) {
		const rows = snap.allergies.rows
			.slice(0, 5)
			.map((r) => `${r.time} ${r.guest} — ${[...r.allergies, ...r.dietary].join(', ')}`)
			.join('; ');
		lines.push(
			`Allergies/dietary: ${snap.allergies.flaggedBookings} flagged (${snap.allergies.allergyAlerts} allergy alert${
				snap.allergies.allergyAlerts === 1 ? '' : 's'
			}). ${rows}.`
		);
	} else {
		lines.push('Allergies/dietary: none flagged.');
	}

	if (snap.vips.length) {
		lines.push(
			`VIPs in: ${snap.vips.map((v) => `${v.name} ${v.time} (${v.partySize}p)`).join('; ')}.`
		);
	}

	if (snap.pacing.periods.length) {
		const p = snap.pacing.periods
			.map((x) => `${x.periodName} ~${x.expectedCovers} (cap ${x.recommendedPeriodCap})`)
			.join(', ');
		lines.push(`Pacing: ${p}.` + (snap.pacing.coldStart ? ' (limited history)' : ''));
	}

	if (snap.reviews.count) {
		const themes = snap.reviews.topThemes
			.map((t) => `${t.theme} (${t.count}${t.negative ? `, ${t.negative}−` : ''})`)
			.join(', ');
		lines.push(
			`Reviews (${snap.reviews.windowDays}d): ${snap.reviews.count}` +
				(snap.reviews.averageRating != null ? `, avg ${snap.reviews.averageRating}★` : '') +
				(themes ? `. Themes: ${themes}` : '') +
				`. Sentiment +${snap.reviews.sentiment.positive}/~${snap.reviews.sentiment.neutral}/-${snap.reviews.sentiment.negative}.` +
				(snap.reviews.needsAttention ? ` ${snap.reviews.needsAttention} need a reply.` : '')
		);
	}

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Persisted briefing — assemble (idempotent) + read.
// ---------------------------------------------------------------------------

export interface StoredBriefing {
	brand: BrandId;
	date: string;
	restaurantName: string;
	text: string; // the prose (AI or fallback)
	aiWritten: boolean;
	snapshot: BriefingSnapshot;
	generatedAt: string;
}

/** Shape persisted into geisha_ai_insights.payload for kind 'nightly_briefing'. */
interface BriefingPayload {
	date: string;
	text: string;
	aiWritten: boolean;
	snapshot: BriefingSnapshot;
	generatedAt: string;
}

/** Find the existing briefing insight row for (restaurant, date), or null. */
async function findBriefingRow(restaurantId: string, date: string): Promise<AiInsight | null> {
	const c = await pb();
	try {
		return await c
			.collection('geisha_ai_insights')
			.getFirstListItem<AiInsight>(
				`restaurant=${q(restaurantId)} && kind=${q(BRIEFING_KIND)} && subject_id=${q(date)}`
			);
	} catch {
		return null;
	}
}

/** Hydrate a StoredBriefing from a persisted insight row (defensive). */
function fromRow(brand: BrandId, restaurantName: string, row: AiInsight): StoredBriefing | null {
	const p = row.payload as BriefingPayload | null;
	if (!p || typeof p.text !== 'string') return null;
	return {
		brand,
		date: p.date,
		restaurantName,
		text: p.text,
		aiWritten: Boolean(p.aiWritten),
		snapshot: p.snapshot,
		generatedAt: p.generatedAt
	};
}

/**
 * Build + PERSIST the nightly briefing for one brand/date, IDEMPOTENTLY.
 *
 * If a briefing insight already exists for (restaurant, date) it is returned
 * as-is (unless `force` is set) so re-running the cron never duplicates or
 * re-bills the LLM. Otherwise a fresh snapshot is built, prose rendered, and a
 * single geisha_ai_insights row written (kind 'nightly_briefing', subject_id =
 * date, score = total covers for quick sorting). Returns the StoredBriefing plus
 * whether this call created it (so the cron only emails on first creation).
 */
export async function assembleBriefing(
	brand: BrandId,
	date: string,
	opts: { now?: Date; force?: boolean } = {}
): Promise<{ briefing: StoredBriefing; created: boolean }> {
	const now = opts.now ?? new Date();
	const restaurant: Restaurant = await getRestaurant(brand);

	if (!opts.force) {
		const existing = await findBriefingRow(restaurant.id, date);
		if (existing) {
			const hydrated = fromRow(brand, restaurant.display_name, existing);
			if (hydrated) return { briefing: hydrated, created: false };
		}
	}

	const snapshot = await buildSnapshot(brand, date, now);
	const { text, aiWritten } = await renderProse(snapshot);

	const briefing: StoredBriefing = {
		brand,
		date,
		restaurantName: restaurant.display_name,
		text,
		aiWritten,
		snapshot,
		generatedAt: now.toISOString()
	};

	const payload: BriefingPayload = { date, text, aiWritten, snapshot, generatedAt: now.toISOString() };
	const c = await pb();
	try {
		const existing = await findBriefingRow(restaurant.id, date);
		if (existing) {
			await c.collection('geisha_ai_insights').update(existing.id, {
				score: snapshot.dashboard.totalCovers,
				payload
			});
			// An existing row updated under force counts as "not newly created".
			return { briefing, created: false };
		}
		await c.collection('geisha_ai_insights').create({
			restaurant: restaurant.id,
			kind: BRIEFING_KIND,
			subject_id: date,
			score: snapshot.dashboard.totalCovers,
			payload
		});
	} catch (err) {
		// Persistence is best-effort — still return the briefing so the cron can
		// email it and the caller has the content even if the droplet write failed.
		console.error('[briefing] failed to persist insight', err);
		return { briefing, created: true };
	}
	return { briefing, created: true };
}

/**
 * Read the stored briefing for one brand/date, or null if none has been
 * generated. Used by the 'Tonight' admin card and the get_briefing read tool —
 * neither generates on demand (that's the cron's job) so a page load is cheap.
 */
export async function getBriefing(brand: BrandId, date: string): Promise<StoredBriefing | null> {
	let restaurant: Restaurant;
	try {
		restaurant = await getRestaurant(brand);
	} catch {
		return null;
	}
	const row = await findBriefingRow(restaurant.id, date);
	if (!row) return null;
	return fromRow(brand, restaurant.display_name, row);
}

/** Render the briefing as brand-tinted HTML for the manager email. Self-contained
 *  (inline styles, no external assets) so it reads in any client. */
export function briefingEmailHtml(briefing: StoredBriefing): string {
	const accent = briefing.brand === 'fusion' ? '#dd8236' : '#d4a04c';
	const dateLabel = new Date(`${briefing.date}T12:00:00Z`).toLocaleDateString('en-GB', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		timeZone: 'Europe/London'
	});
	// Preserve the prose's line breaks; escape the few HTML-significant chars.
	const esc = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const body = esc(briefing.text).replace(/\n/g, '<br>');
	return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2b">
		<div style="border-top:4px solid ${accent};padding:24px 8px">
			<h1 style="font-size:20px;margin:0 0 2px">${esc(briefing.restaurantName)} — Tonight</h1>
			<p style="font-size:13px;color:#6b7488;margin:0 0 16px">${dateLabel}</p>
			<div style="font-size:14px;line-height:1.7">${body}</div>
			<p style="font-size:12px;color:#8591a8;margin-top:28px">
				Automated morning briefing · figures computed from the booking system.
			</p>
		</div>
	</div>`;
}
