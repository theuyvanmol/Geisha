// Insights-domain READ tools for the admin assistant.
//
// get_allergy_summary(date) (mf-allergy-aware) — the service-prep view the
// kitchen/floor asks the assistant for: every live booking on a date that carries
// an allergen or dietary signal, with the allergens, the dietary styles, the
// party, the time and the guest. It reads the SAME deterministic extractor the
// create/amend path writes to booking.dietary_flags, re-deriving live from
// special_requests + customer notes/allergies so it's correct even for bookings
// made before the extractor existed (no LLM — pure keyword pass, see ai/allergy.ts).
//
// get_noshow_risk(date) (mf-noshow-risk) — the deterministic no-show risk scores
// for a date's live bookings, computed by the same pure scorer the morning cron
// persists (ai/risk/noShowScore.ts). 0-100 score + low/medium/high band + the
// plain-English factors behind it. NO LLM — arithmetic only.
//
// get_demand_forecast(date) (mf-demand-forecast) — the nightly demand forecaster's
// recommended covers-cap curve for a date: expected covers + recommended pacing cap
// per service period (and per slot). Reads the stored `pacing_curve` setting written
// by /api/cron/forecast and resolves it with the PURE forecaster (ai/forecast.ts).
// NO LLM — seasonal-naive + moving-average arithmetic; flags cold-start honestly.
//
// propose_seating_plan(date) (mf-seating-optimiser) — the OPTIMISED seating diff
// for a whole service day from the pure proposeSeatingPlan engine (optimise.ts):
// packs parties onto tables/joins to waste the fewest seats + fewest joins,
// honours soft prefs (VIP/window), never moves a seated party. NO LLM — pure
// arithmetic. Kept in its OWN factory (seatingTools) and spread into insightTools
// so each stream's tools stay disjoint and easy to merge.
//
// get_alerts() (mf-anomaly-alerts) — the OPEN operational alerts the anomaly cron
// (api/cron/anomaly) has raised for the brand: each alert's metric, severity, the
// plain-English heads-up message and the day/window it covers. The detection
// behind them is pure z-score/threshold arithmetic; this tool just surfaces what
// was found so the assistant can answer "anything unusual lately?". Kept in its
// OWN factory (alertTools) and spread into insightTools so each stream's tools
// stay disjoint and easy to merge. READ only.
//
// propose_evening_plan(date) (mf-autonomous-copilot) — the CAPSTONE read tool.
// Assembles ONE structured evening plan for a date from the deterministic engines
// (seating optimiser + no-show scorer + briefing snapshot) and returns it as a
// CHECKLIST of discrete, individually-confirm-gated actions: recommended seating
// moves (→ move_booking WRITE), risky bookings to chase (→ draft_message READ),
// and VIP/allergy/pacing run-sheet notes. The narration prose is LLM-framed
// (text-only, grounded) with a deterministic fallback. It WRITES nothing — each
// firable item carries an `action` whose tool+input match an existing
// confirm-gated tool, applied later through the normal confirm path. Kept in its
// OWN factory (copilotTools) and spread into insightTools so each stream's tools
// stay disjoint and easy to merge. See ai/copilot.ts. READ only.
//
// draft_message(customerId, kind, occasion?) (mf-guest-comms) — DRAFTS a warm,
// personalised guest email (thank-you / win-back / occasion / reminder) for a
// customer using the SAME drafter the comms engine uses (runAgent text-only with
// a deterministic fallback), grounded in the guest's real visit history + notes.
// READ-only: it returns the subject + body for the assistant to show — it does
// NOT send or queue anything (sending stays in the manager-gated /admin/comms
// outbox). Kept in its OWN factory (commsTools) for disjoint, mergeable additions.
//
// READ only, registered in the composer (./index.ts). Adding a tool here is the
// only change needed.

import { getBookingsForDay, listPeriods } from '$lib/server/booking/admin.js';
import { getRestaurant } from '$lib/server/booking/queries.js';
import { pb } from '$lib/server/db/pb.js';
import { extractAllergyFlags, allergyLabel } from '../allergy.js';
import { computeDayRisk } from '../risk/noShowRisk.js';
import { getSeatingPlan } from '$lib/server/booking/optimise.js';
import { getBriefing } from '../briefing.js';
import { forecastForDate, PACING_CURVE_KEY, type PacingCurve } from '../forecast.js';
import { loadReviews, summariseReviews } from '../sentiment.js';
import type { Alert, Customer, Setting } from '$lib/server/db/types.js';
import type { GeminiTool, ToolContext } from './types.js';
import { dateStr } from './types.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** Load the stored demand-forecast pacing curve for a brand, or null if the cron
 *  hasn't computed one yet (the read tool then reports cold-start defaults). */
async function loadPacingCurve(restaurantId: string): Promise<PacingCurve | null> {
	const c = await pb();
	try {
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${q(restaurantId)} && key=${q(PACING_CURVE_KEY)}`);
		const v = row.value;
		return v && typeof v === 'object' ? (v as PacingCurve) : null;
	} catch {
		return null; // 404 = no curve yet — degrade to cold-start downstream.
	}
}

/** How many top-risk rows get_noshow_risk returns (kept small for context). */
const RISK_TOP_N = 25;

/** Pretty 'HH:mm' in the restaurant timezone for the model to read cleanly. */
function fmtTime(iso: string): string {
	return new Date(iso).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/London'
	});
}

/** Insights-domain tools for a brand. */
export function insightTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	return [
		{
			name: 'get_allergy_summary',
			kind: 'read',
			description:
				"The allergy & dietary run-down for a single service date: every live booking carrying a food allergy or dietary requirement, with the specific allergens (e.g. nuts, shellfish, gluten), dietary styles (e.g. vegan, halal), the guest, party size and time. Use this for 'any allergies tonight?' or 'who's gluten-free on Saturday'. Resolve relative phrases like 'today'/'tonight' to an absolute YYYY-MM-DD date first.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				const bookings = await getBookingsForDay(brand, date);
				// Live service only — drop cancelled / no-show so prep is what's coming in.
				const live = bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'no_show');

				const rows = live
					.map((b) => {
						const customer = b.expand?.customer;
						const flags = extractAllergyFlags({
							specialRequests: b.special_requests,
							notes: customer?.notes,
							allergies: customer?.allergies
						});
						return {
							bookingId: b.id,
							time: fmtTime(b.starts_at),
							guest: customer?.name?.trim() || `${b.party_size}p (no name)`,
							partySize: b.party_size,
							allergies: flags.allergies.map(allergyLabel),
							dietary: flags.dietary.map(allergyLabel),
							hasAllergy: flags.hasAllergy,
							summary: flags.summary
						};
					})
					// Only bookings that actually carry a signal are interesting here.
					.filter((r) => r.hasAllergy || r.dietary.length > 0);

				return {
					date,
					totalLiveBookings: live.length,
					flaggedBookings: rows.length,
					allergyAlerts: rows.filter((r) => r.hasAllergy).length,
					rows
				};
			}
		},
		{
			name: 'get_noshow_risk',
			kind: 'read',
			description:
				"Deterministic no-show RISK for a single date's live bookings — each booking's 0-100 risk score, a low/medium/high band, and the plain-English factors that drove it (prior no-shows, large party, no deposit, weekend dinner, last-minute booking, etc.). Use this to answer 'which bookings are most likely to no-show today?' or to advise chasing a deposit. The numbers come from a fixed heuristic, NOT a guess — quote them as-is. Resolve relative phrases like 'today' to an absolute YYYY-MM-DD date first.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
					throw new Error("Date must be 'YYYY-MM-DD'.");
				}
				const risks = await computeDayRisk(brand, date);
				const high = risks.filter((r) => r.risk.band === 'high').length;
				const medium = risks.filter((r) => r.risk.band === 'medium').length;
				return {
					date,
					totalLive: risks.length,
					high,
					medium,
					low: risks.length - high - medium,
					// Already sorted highest-risk first by computeDayRisk; cap for context.
					bookings: risks.slice(0, RISK_TOP_N).map((r) => ({
						bookingId: r.bookingId,
						name: r.customerName,
						partySize: r.partySize,
						time: fmtTime(r.startsAt),
						status: r.status,
						source: r.source,
						hasDeposit: r.hasDeposit,
						score: r.risk.score,
						band: r.risk.band,
						factors: r.risk.factors.map((f) => f.label)
					}))
				};
			}
		},
		{
			name: 'get_demand_forecast',
			kind: 'read',
			description:
				"Demand forecast for a single date: for each service period that runs that day, the expected number of covers and the recommended covers cap (how many guests pacing should allow), plus a per-slot breakdown of expected demand. Learned from historical bookings (seasonal-naive + moving average — deterministic, not a guess). Flags 'coldStart' when there isn't enough history yet and conservative defaults are used. Use this to answer 'how busy will we be on …' or 'what should we cap covers at for Friday dinner'. Resolve relative phrases like 'next Saturday' to an absolute YYYY-MM-DD date first.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
					throw new Error("Date must be 'YYYY-MM-DD'.");
				}
				const restaurant = await getRestaurant(brand);
				const [curve, periods] = await Promise.all([
					loadPacingCurve(restaurant.id),
					listPeriods(brand)
				]);
				const f = forecastForDate(date, curve, periods);
				return {
					date: f.date,
					dayOfWeek: f.dow,
					generatedAt: f.generatedAt,
					coldStart: f.coldStart,
					periods: f.periods.map((p) => ({
						periodId: p.periodId,
						periodName: p.periodName,
						expectedCovers: p.expectedCovers,
						recommendedPeriodCap: p.recommendedPeriodCap,
						sampleSize: p.sampleSize,
						coldStart: p.coldStart,
						slots: p.slots.map((s) => ({
							slot: s.slot,
							expectedCovers: s.expectedCovers,
							recommendedCap: s.recommendedCap
						}))
					}))
				};
			}
		},
		// mf-seating-optimiser — kept in its own factory below and spread in here so
		// each stream's tool list stays disjoint and trivially mergeable.
		...seatingTools(ctx),
		// mf-anomaly-alerts — same pattern: its own factory, spread in here.
		...alertTools(ctx),
		// mf-nightly-briefing — same pattern: its own factory, spread in here.
		...briefingTools(ctx),
		// mf-review-sentiment — same pattern: its own factory, spread in here.
		...reviewInsightTools(ctx),
		// mf-guest-comms — same pattern: its own factory, spread in here.
		...commsTools(ctx),
		// mf-autonomous-copilot (capstone) — same pattern: its own factory, spread in.
		...copilotTools(ctx)
	];
}

/**
 * Autonomous-copilot tool (mf-autonomous-copilot, the capstone). READ-only:
 * assembles the whole evening plan for a date via assembleEveningPlan (copilot.ts)
 * and returns it as a structured CHECKLIST. Every fact + proposed action comes
 * from the deterministic engines; the only LLM step is the framing narration
 * (text-only, grounded, with a deterministic fallback). It WRITES nothing — each
 * firable checklist item carries an `action` whose tool name + input shape match
 * an existing confirm-gated tool (move_booking / draft_message), so applying any
 * one of them stays a separate, individually-audited confirm step. Kept in its own
 * factory for disjoint, mergeable additions.
 */
export function copilotTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	return [
		{
			name: 'propose_evening_plan',
			kind: 'read',
			description:
				"Plan tonight in one shot. Assembles a single structured evening plan for a service date — the headline (bookings + covers), a short narration, and a CHECKLIST of concrete next actions: recommended seating moves (to free seats / tidy joins), risky bookings to chase with a pre-visit note, and VIP / allergy / pacing run-sheet notes. Use this for 'plan tonight', 'what should I do for Saturday service?' or 'give me tonight's run-sheet'. Every number and every proposed move comes from the deterministic booking engines (seating optimiser + no-show scorer + briefing snapshot), NOT a guess — quote them as-is. Each action in the checklist is applied separately and confirmed individually; this tool only PROPOSES. Resolve relative phrases like 'tonight'/'today' to an absolute YYYY-MM-DD date first.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
					throw new Error("Date must be 'YYYY-MM-DD'.");
				}
				const { assembleEveningPlan } = await import('../copilot.js');
				const plan = await assembleEveningPlan(brand, date);
				return {
					date: plan.date,
					generatedAt: plan.generatedAt,
					headline: plan.headline,
					narration: plan.narration,
					aiWritten: plan.aiWritten,
					stats: plan.stats,
					items: plan.items
				};
			}
		}
	];
}

/**
 * Guest-comms tools (mf-guest-comms). READ-only: drafts a personalised guest
 * email on demand for a customer using the SAME drafter the comms engine + cron
 * use (draftMessage → runAgent text-only, with a deterministic fallback so it
 * works with no AI key). It composes copy grounded in the guest's real visit
 * history/notes/occasion and returns the subject + body for the assistant to
 * show — it NEVER sends or queues (sending lives in the manager-gated
 * /admin/comms outbox). Kept in its own factory for disjoint, mergeable adds.
 */
export function commsTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	return [
		{
			name: 'draft_message',
			kind: 'read',
			description:
				"Draft a warm, personalised guest email for a customer — a post-visit thank-you, a win-back for a lapsed regular, an occasion (birthday/anniversary) acknowledgement, or a pre-service reminder. Grounds the copy in the guest's real booking history, notes and occasion. Use this for 'draft a thank-you to the Khan party' or 'write a win-back note for this lapsed regular'. Get the customerId from search_customers first. This ONLY drafts and returns the text — it does NOT send anything; sending is done by staff in the Comms outbox (/admin/comms).",
			parameters: {
				type: 'object',
				properties: {
					customerId: {
						type: 'string',
						description: 'The customer id, as returned by search_customers.'
					},
					kind: {
						type: 'string',
						enum: ['thank_you', 'win_back', 'occasion', 'reminder'],
						description:
							'Which kind of message to draft: thank_you (post-visit), win_back (lapsed regular), occasion (celebration), or reminder (pre-service).'
					},
					occasion: {
						type: 'string',
						description:
							"For kind 'occasion', the celebration (e.g. 'birthday', 'anniversary'). Optional otherwise."
					}
				},
				required: ['customerId', 'kind']
			},
			run: async ({
				customerId,
				kind,
				occasion
			}: {
				customerId: string;
				kind: 'thank_you' | 'win_back' | 'occasion' | 'reminder';
				occasion?: string;
			}) => {
				const { draftMessage } = await import('$lib/server/comms/draft.js');
				const { getCustomerHistory } = await import('$lib/server/booking/admin.js');
				const c = await pb();
				const [restaurant, customer] = await Promise.all([
					getRestaurant(brand),
					c.collection('geisha_customers').getOne<Customer>(customerId)
				]);
				if (customer.deleted_at)
					throw new Error('That guest has been erased and cannot be messaged.');

				const history = await getCustomerHistory(customerId).catch(() => []);
				const completed = history.filter((b) => b.status === 'completed');
				const lastVisitISO = completed
					.map((b) => b.starts_at)
					.sort()
					.at(-1);

				const drafted = await draftMessage(
					{
						kind,
						customer,
						occasion: occasion?.trim() || undefined,
						reason: `Drafted on request via the assistant (${kind})`
					},
					restaurant,
					{ visitCount: completed.length, lastVisitISO }
				);
				return {
					customerId,
					customerName: customer.name,
					kind,
					subject: drafted.subject,
					body: drafted.html,
					aiGenerated: drafted.aiGenerated,
					note: 'Draft only — not sent. Send from the Comms outbox (/admin/comms).'
				};
			}
		}
	];
}

/**
 * Anomaly-alert tools (mf-anomaly-alerts). READ-only: surfaces the OPEN
 * (unacknowledged) operational alerts raised by the deterministic anomaly cron
 * (api/cron/anomaly) for this brand — sudden spikes in cancellations/no-shows or
 * a collapse in new bookings, each with its severity and plain-English heads-up.
 * The maths behind them is pure z-score/threshold; this tool never recomputes or
 * invents — it just reports what's on file. Kept in its own factory and spread
 * into insightTools so each stream's tools stay disjoint and easy to merge.
 */
export function alertTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	/** How many alerts to return at most (newest first), kept small for context. */
	const ALERTS_TOP_N = 25;
	return [
		{
			name: 'get_alerts',
			kind: 'read',
			description:
				"List the OPEN operational alerts for this restaurant — unusual days the automatic monitor has flagged, such as a spike in cancellations or no-shows, or a sudden drop in new bookings. Each alert has a metric, a severity (info/warning/critical), the day/window it covers and a short plain-English explanation. Use this to answer 'is anything unusual?', 'any alerts?' or to brief the manager. The numbers come from a fixed statistical monitor (robust z-score vs the recent baseline), NOT a guess — quote them as-is. By default only unacknowledged alerts are returned.",
			parameters: {
				type: 'object',
				properties: {
					includeAcknowledged: {
						type: 'boolean',
						description:
							'Set true to also include alerts a manager has already acknowledged/dismissed (default false — open alerts only).'
					},
					severity: {
						type: 'string',
						enum: ['info', 'warning', 'critical'],
						description: 'Optionally return only alerts at this severity.'
					}
				}
			},
			run: async ({
				includeAcknowledged,
				severity
			}: {
				includeAcknowledged?: boolean;
				severity?: string;
			}) => {
				const restaurant = await getRestaurant(brand);
				const c = await pb();
				const clauses = [`restaurant=${q(restaurant.id)}`];
				if (!includeAcknowledged) clauses.push('acknowledged=false');
				if (severity) clauses.push(`severity=${q(severity)}`);
				let rows: Alert[] = [];
				try {
					rows = await c.collection('geisha_alerts').getFullList<Alert>({
						filter: clauses.join(' && '),
						sort: '-created'
					});
				} catch {
					rows = []; // collection absent (pre-migration) — degrade gracefully
				}
				const sliced = rows.slice(0, ALERTS_TOP_N);
				return {
					totalOpen: rows.filter((r) => !r.acknowledged).length,
					critical: rows.filter((r) => !r.acknowledged && r.severity === 'critical').length,
					warning: rows.filter((r) => !r.acknowledged && r.severity === 'warning').length,
					returned: sliced.length,
					alerts: sliced.map((a) => ({
						id: a.id,
						kind: a.kind,
						metric: a.metric,
						severity: a.severity,
						window: a.window,
						message: a.message,
						acknowledged: a.acknowledged,
						raisedAt: a.created
					}))
				};
			}
		}
	];
}

/**
 * Seating-optimiser tools (mf-seating-optimiser). READ-only: returns the
 * OPTIMISED seating diff for a date from the pure proposeSeatingPlan engine via
 * its DB-backed loader (optimise.ts). The AI reads the SAME diff the /admin/floor
 * "Optimise tonight" button shows — it never invents a plan. Applying any move is
 * a separate confirm-gated moveBooking step, so this stays safe to auto-run.
 */
export function seatingTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	return [
		{
			name: 'propose_seating_plan',
			kind: 'read',
			description:
				"Compute an OPTIMISED seating plan for a whole service day and return the proposed table changes (a diff vs the current allocation). The engine is pure arithmetic — it packs parties onto tables/joins to waste the fewest seats and split the fewest tables, honours soft preferences (VIP and window/section requests), and NEVER moves a party that is already seated. Use this to answer 'can we seat the room more tightly tonight' or to free up tables. Returns each move (which booking, from which table(s) to which, how many seats it frees) plus any parties that cannot be seated at all. Resolve relative dates like 'tonight' to an absolute YYYY-MM-DD first. This only PROPOSES — applying a move is a separate confirmed step.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
					throw new Error("Date must be 'YYYY-MM-DD'.");
				}
				const plan = await getSeatingPlan(brand, date);
				return {
					date: plan.date,
					considered: plan.considered,
					pinned: plan.pinned,
					summary: plan.summary,
					seatsFreed: plan.summary.wastedSeatsBefore - plan.summary.wastedSeatsAfter,
					moves: plan.moves.map((m) => ({
						bookingId: m.bookingId,
						partySize: m.partySize,
						time: fmtTime(m.startsAt),
						from: m.fromLabel,
						to: m.toLabel,
						wastedBefore: m.wastedBefore,
						wastedAfter: m.wastedAfter,
						createsJoin: m.createsJoin,
						removesJoin: m.removesJoin
					})),
					unseated: plan.unseated
				};
			}
		}
	];
}

/**
 * Review-insights tools (mf-review-sentiment). READ-only: aggregates the stored
 * sentiment + themes across a date range into the SAME deterministic summary the
 * /admin/reviews page shows — total reviews, average rating, the positive/neutral/
 * negative split, the themes ranked by mention (with their positive/negative
 * breakdown) and how many negative reviews still need a reply. PURE arithmetic over
 * the persisted analysis (the LLM only ran at ingestion); this tool never invents.
 * Also carries draft_review_reply (READ, drafts only): an LLM-drafted on-brand
 * PUBLIC reply to a single review (text-only runAgent with a deterministic
 * fallback) — it returns copy for the operator to post themselves, posting nothing.
 * Kept in its own factory and spread into insightTools so each stream's tools stay
 * disjoint and easy to merge.
 */
export function reviewInsightTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	return [
		{
			name: 'draft_review_reply',
			kind: 'read',
			description:
				"Draft an on-brand public reply to a single guest review. Pass the review text (and optionally its star rating and the tone you want). Returns a ready-to-review reply the operator can copy into the review platform — thanking the guest, acknowledging any specific praise or complaint, and inviting them back, in the restaurant's warm, sincere voice. This ONLY drafts the text — it does NOT post anything; the operator reviews and publishes the reply themselves. Use this for 'draft a reply to this review' on the Reviews page.",
			parameters: {
				type: 'object',
				properties: {
					reviewText: {
						type: 'string',
						description: 'The full text of the guest review to reply to.'
					},
					rating: {
						type: 'integer',
						description: 'The review star rating 1–5, if known (helps set the tone).'
					},
					tone: {
						type: 'string',
						description:
							"Optional desired tone, e.g. 'warm', 'apologetic', 'professional'. Defaults to warm + sincere."
					}
				},
				required: ['reviewText']
			},
			run: async ({
				reviewText,
				rating,
				tone
			}: {
				reviewText: string;
				rating?: number;
				tone?: string;
			}) => {
				const text = (reviewText || '').trim();
				if (!text) throw new Error('Provide the review text to reply to.');
				const restaurant = await getRestaurant(brand);
				const name = restaurant.display_name;
				const negative = typeof rating === 'number' && rating <= 3;
				// Deterministic fallback reply — always sendable, no AI required.
				const fallback = negative
					? `Thank you for taking the time to share your feedback. We're sorry your visit to ${name} didn't fully meet your expectations, and we take your comments seriously. We'd genuinely welcome the chance to put things right — please do reach out to us directly, and we hope to have the opportunity to welcome you back.`
					: `Thank you so much for your kind words — it means a great deal to all of us at ${name}. We're delighted you enjoyed your visit, and we look forward to welcoming you back again soon.`;

				let reply = fallback;
				let aiGenerated = false;
				try {
					const { runAgent, isConfiguredAsync } = await import('../geminiAgent.js');
					if (await isConfiguredAsync()) {
						const system =
							`You write short, warm, sincere PUBLIC replies to guest reviews for ${name}, an upscale ` +
							`restaurant in Benton, Newcastle. Voice: gracious, genuine, a touch elegant — never defensive, ` +
							`generic or robotic. British English. No emojis, no markdown. ` +
							`Thank the guest by acknowledging something specific they mentioned. If the review is critical, ` +
							`apologise sincerely without excuses and invite them to reach out so you can make it right; ` +
							`never argue or blame. Do NOT invent facts, offers or compensation. ` +
							`Reply with ONLY the reply text (2-4 short sentences), no greeting header, no sign-off, no subject.` +
							(tone ? ` Preferred tone: ${tone}.` : '');
						const user =
							`Review${typeof rating === 'number' ? ` (${rating}/5 stars)` : ''}:\n"${text.slice(0, 1500)}"`;
						const result = await runAgent(system, user, [], []);
						if (result.configured && !result.errored) {
							const body = (result.answer || '')
								.replace(/```[\s\S]*?```/g, ' ')
								.replace(/<[^>]+>/g, ' ')
								.replace(/\s+/g, ' ')
								.trim();
							if (body.length) {
								reply = body.length > 900 ? body.slice(0, 900).trimEnd() + '…' : body;
								aiGenerated = true;
							}
						}
					}
				} catch (err) {
					console.error('[reviews] draft_review_reply LLM failed (using fallback):', err);
				}

				return {
					reply,
					rating: rating ?? null,
					aiGenerated,
					note: 'Draft only — review and post it yourself on the review platform. Nothing was published.'
				};
			}
		},
		{
			name: 'get_review_insights',
			kind: 'read',
			description:
				"Summarise guest reviews over a date range: how many came in, the average star rating, the positive/neutral/negative split, the themes guests talked about most (food, service, value, ambience, wait time, …) each with how often they were praised vs criticised, and how many unhappy reviews still need a reply. Use this to answer 'how are our reviews looking this month?', 'what are people complaining about?' or 'how's our service feedback'. The numbers are a fixed aggregation of stored sentiment, NOT a guess — quote them as-is. Resolve relative phrases like 'this month' or 'last 30 days' to absolute YYYY-MM-DD dates first.",
			parameters: {
				type: 'object',
				properties: { from: dateStr, to: dateStr },
				required: ['from', 'to']
			},
			run: async ({ from, to }: { from: string; to: string }) => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
					throw new Error("Dates must be 'YYYY-MM-DD'.");
				}
				const reviews = await loadReviews(brand, from, to);
				return summariseReviews(reviews, from, to);
			}
		}
	];
}

/**
 * Nightly-briefing tool (mf-nightly-briefing). READ-only: returns the STORED
 * morning briefing for a date — the prose plus the structured snapshot of facts it
 * was written from (covers, no-show risk counts, allergies, VIPs, pacing, recent
 * review themes). The cron (api/cron/briefing) generates and persists one briefing
 * per brand per day; this tool just reads it back so the assistant can answer
 * "what's the brief for tonight?" without recomputing or inventing anything.
 * Returns generated:false when no briefing has been produced for that date yet.
 * Kept in its own factory and spread into insightTools so each stream's tools stay
 * disjoint and easy to merge.
 */
export function briefingTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	return [
		{
			name: 'get_briefing',
			kind: 'read',
			description:
				"Read the stored nightly manager briefing for a single date — the morning brief the system writes each day summarising tonight's service: total bookings and covers, the risky covers to chase, allergies for the pass, VIPs in, the pacing/cap picture and recent review themes. Use this to answer 'what's the brief for tonight?' or 'give me the morning briefing'. The prose is written from a structured snapshot of computed numbers (never invented). If no briefing has been generated for that date yet, generated will be false. Resolve relative phrases like 'today'/'tonight' to an absolute YYYY-MM-DD date first.",
			parameters: {
				type: 'object',
				properties: { date: dateStr },
				required: ['date']
			},
			run: async ({ date }: { date: string }) => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
					throw new Error("Date must be 'YYYY-MM-DD'.");
				}
				const briefing = await getBriefing(brand, date);
				if (!briefing) {
					return {
						date,
						generated: false,
						message: 'No briefing has been generated for this date yet.'
					};
				}
				return {
					date: briefing.date,
					generated: true,
					aiWritten: briefing.aiWritten,
					generatedAt: briefing.generatedAt,
					briefing: briefing.text,
					snapshot: briefing.snapshot
				};
			}
		}
	];
}
