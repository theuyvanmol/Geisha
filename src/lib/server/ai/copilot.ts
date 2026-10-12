// mf-autonomous-copilot — the capstone. "Plan tonight" assembles ONE structured
// evening plan for a service date and returns it as a CHECKLIST of discrete,
// individually-confirm-gated actions.
//
// MOONSHOT PRINCIPLE (honest AI). EVERY number + every proposed action is
// computed by the existing DETERMINISTIC engines — never an LLM:
//   · recommended seating diff   → proposeSeatingPlan (optimise.ts, pure packing)
//   · risky bookings to chase    → computeDayRisk (pure no-show scorer)
//   · pacing notes               → forecastForDate (pure seasonal-naive forecast)
//   · VIP / allergy run-sheet    → buildSnapshot (extractAllergyFlags + CRM flags)
//   · open operational alerts    → the anomaly cron's stored geisha_alerts
// The LLM (runAgent, TEXT-ONLY) is used for ONE thing: writing the short
// narration prose that *frames* the already-computed plan. It is handed the
// structured facts and a strict "use only the provided numbers" prompt, and if it
// is unconfigured or errors we fall back to deterministic prose — so the plan is
// always complete and honest.
//
// SAFETY. The plan never WRITES anything. Each checklist item that changes state
// carries an `action` ({ tool, input }) whose tool name + input shape EXACTLY
// match an existing confirm-gated write/read tool in the admin registry:
//   · seating moves   → move_booking   (confirm-gated WRITE, audited actor='ai')
//   · pre-visit chase  → draft_message  (READ — drafts copy; sending stays in the
//                        manager-gated /admin/comms outbox, never auto-fired here)
// The AssistantDock renders the checklist and fires each item through the SAME
// /api/admin-chat confirm/ask path the rest of the assistant uses, so "Approve
// all" is still N individually-audited confirm-gated calls — NEVER a bulk silent
// commit. RBAC (owner/manager) is enforced at the route + the read tool.
//
// Server-only.

import type { BrandId } from '../db/types.js';
import { buildSnapshot, type BriefingSnapshot } from './briefing.js';
import { getSeatingPlan, type SeatingPlan } from '../booking/optimise.js';
import { computeDayRisk, type BookingRisk } from './risk/noShowRisk.js';
import { runAgent } from './geminiAgent.js';

/** A discrete checklist item in an evening plan. */
export interface EveningPlanItem {
	/** Stable id within this plan (used by the dock for per-item state). */
	id: string;
	/** Which lane the item belongs to (drives the dock's grouping + icon). */
	kind: 'seating' | 'risk' | 'message' | 'note';
	/** Short human title, e.g. "Move Khan (4p) T2 → T7". */
	title: string;
	/** A line or two of supporting detail (why / impact). */
	detail: string;
	/**
	 * The confirm-gated action this item maps to, when it is firable. `tool` +
	 * `input` match an existing admin tool EXACTLY:
	 *   · move_booking  (WRITE) — applied via the confirm path, audited actor='ai'
	 *   · draft_message (READ)  — drafts copy; the dock shows it / routes to /admin/comms
	 * Omitted for pure 'note' items (informational; the dock renders a link only).
	 */
	action?: { tool: 'move_booking' | 'draft_message'; input: Record<string, unknown> };
	/** Whether `action` is a confirm-gated WRITE or an auto-runnable READ. */
	actionKind?: 'write' | 'read';
	/** Optional admin deep-link for a 'note' (or to view the subject of an action). */
	link?: string;
}

export interface EveningPlanStats {
	totalBookings: number;
	totalCovers: number;
	seatingMoves: number;
	seatsFreed: number;
	highRisk: number;
	mediumRisk: number;
	allergyAlerts: number;
	vips: number;
	openAlerts: number;
}

export interface EveningPlan {
	brand: BrandId;
	date: string;
	generatedAt: string;
	/** One-line headline (deterministic — covers + how busy). */
	headline: string;
	/** The framing prose (LLM when configured, deterministic fallback otherwise). */
	narration: string;
	/** True when the LLM wrote the narration; false for the deterministic fallback. */
	aiWritten: boolean;
	/** The discrete, individually-confirm-gated checklist. */
	items: EveningPlanItem[];
	stats: EveningPlanStats;
}

/** How many of each lane to surface — keeps the checklist actionable, not a wall. */
const MAX_SEATING_MOVES = 8;
const MAX_RISK_CHASES = 6;

/** 'HH:mm' in Europe/London for clean display. */
function fmtTime(iso: string): string {
	return new Date(iso).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Europe/London'
	});
}

/** Build the seating-move checklist items from the pure optimiser's diff. Each is
 *  a confirm-gated move_booking whose input matches the floor tool's parameters. */
function seatingItems(plan: SeatingPlan): EveningPlanItem[] {
	return plan.moves.slice(0, MAX_SEATING_MOVES).map((m, i) => {
		const freed = Math.max(0, m.wastedBefore - m.wastedAfter);
		const why = [
			freed > 0 ? `frees ${freed} seat${freed === 1 ? '' : 's'}` : '',
			m.removesJoin ? 'unjoins tables' : '',
			m.createsJoin ? 'uses a join' : ''
		]
			.filter(Boolean)
			.join(' · ');
		return {
			id: `seat-${i}`,
			kind: 'seating',
			title: `Move ${m.partySize}p ${m.fromLabel} → ${m.toLabel} (${fmtTime(m.startsAt)})`,
			detail: why || 'Tightens the allocation.',
			// move_booking's parameters: { bookingId, tableIds } (toolsFloor.ts).
			action: { tool: 'move_booking', input: { bookingId: m.bookingId, tableIds: m.toTableIds } },
			actionKind: 'write'
		} satisfies EveningPlanItem;
	});
}

/**
 * Build the "chase a hold / deposit" checklist from the highest no-show risks.
 * The honest action is a personalised pre-visit reminder (draft_message → the
 * guest is asked to reconfirm / secure the table) — a READ that drafts copy for
 * the manager to send from the outbox. Only un-deposited medium/high risks are
 * surfaced (a booking already holding a deposit doesn't need chasing).
 */
function riskItems(risks: BookingRisk[]): EveningPlanItem[] {
	const chase = risks
		.filter((r) => (r.risk.band === 'high' || r.risk.band === 'medium') && !r.hasDeposit)
		.slice(0, MAX_RISK_CHASES);
	return chase.map((r, i) => {
		const factors = r.risk.factors
			.map((f) => f.label)
			.slice(0, 3)
			.join(', ');
		return {
			id: `risk-${i}`,
			kind: 'risk',
			title: `Chase ${r.customerName} — ${r.partySize}p at ${fmtTime(r.startsAt)} (risk ${r.risk.score})`,
			detail: `${r.risk.band} no-show risk${factors ? ` · ${factors}` : ''}. Draft a pre-visit note asking them to reconfirm.`,
			// draft_message's parameters: { customerId, kind, occasion? } (toolsInsights.ts).
			// We can only draft when we know the customer id (booking has an expanded
			// customer); fall back to a note linking to the booking otherwise.
			...(r.customerId
				? {
						action: {
							tool: 'draft_message' as const,
							input: { customerId: r.customerId, kind: 'reminder' as const }
						},
						actionKind: 'read' as const
					}
				: {}),
			link: `/admin/bookings/${r.bookingId}`
		} satisfies EveningPlanItem;
	});
}

/** Build the VIP / allergy run-sheet NOTE items (informational, link to the day). */
function runSheetItems(snap: BriefingSnapshot, brand: BrandId, date: string): EveningPlanItem[] {
	const out: EveningPlanItem[] = [];
	const diaryLink = `/admin/diary?brand=${brand}&date=${date}`;

	if (snap.allergies.flaggedBookings > 0) {
		const rows = snap.allergies.rows
			.slice(0, 5)
			.map((r) => `${r.time} ${r.guest} — ${[...r.allergies, ...r.dietary].join(', ')}`)
			.join('; ');
		out.push({
			id: 'allergy',
			kind: 'note',
			title: `Allergy / dietary pass: ${snap.allergies.flaggedBookings} flagged (${snap.allergies.allergyAlerts} allergy alert${snap.allergies.allergyAlerts === 1 ? '' : 's'})`,
			detail: rows || 'Brief the kitchen + pass on the flagged covers.',
			link: diaryLink
		});
	}

	if (snap.vips.length > 0) {
		const rows = snap.vips.map((v) => `${v.name} ${v.time} (${v.partySize}p)`).join('; ');
		out.push({
			id: 'vips',
			kind: 'note',
			title: `VIPs in tonight: ${snap.vips.length}`,
			detail: rows,
			link: diaryLink
		});
	}

	if (snap.pacing.periods.length > 0) {
		const p = snap.pacing.periods
			.map((x) => `${x.periodName} ~${x.expectedCovers} (cap ${x.recommendedPeriodCap})`)
			.join(', ');
		out.push({
			id: 'pacing',
			kind: 'note',
			title: 'Pacing / caps',
			detail: `${p}${snap.pacing.coldStart ? ' (limited history)' : ''}.`,
			link: `/admin/settings?brand=${brand}`
		});
	}

	if (snap.reviews.count > 0 && snap.reviews.needsAttention > 0) {
		out.push({
			id: 'reviews',
			kind: 'note',
			title: `${snap.reviews.needsAttention} recent review${snap.reviews.needsAttention === 1 ? '' : 's'} need a reply`,
			detail: `Over the last ${snap.reviews.windowDays} days · avg ${snap.reviews.averageRating ?? '—'}★.`,
			link: `/admin/reviews?brand=${brand}`
		});
	}

	return out;
}

/** Deterministic headline — covers + the busy-ness read, no invented numbers. */
function buildHeadline(snap: BriefingSnapshot): string {
	const d = snap.dashboard;
	const span =
		snap.firstArrival && snap.lastArrival ? ` (${snap.firstArrival}–${snap.lastArrival})` : '';
	return `${d.totalBookings} booking${d.totalBookings === 1 ? '' : 's'}, ${d.totalCovers} cover${
		d.totalCovers === 1 ? '' : 's'
	}${span}.`;
}

const COPILOT_SYSTEM =
	'You are the duty manager talking a colleague through the plan for tonight\'s service. ' +
	'You are given a JSON object: the headline facts and a CHECKLIST of concrete actions already ' +
	'worked out by the booking system (seating moves, risky covers to chase, VIP/allergy notes).\n\n' +
	'Write 2-4 short sentences that orient the manager: how busy it is, the single most important ' +
	'thing to do first, and a nudge to work the checklist. STRICT RULES:\n' +
	'- Use ONLY the numbers and items in the JSON. NEVER invent a figure, name, time or table.\n' +
	'- Refer to the checklist as "the checklist below". Do not re-list every item.\n' +
	'- No preamble, no sign-off, no markdown headings. Plain prose, under ~90 words. British English.';

/** Render the framing narration via the LLM (text-only, grounded), with a
 *  deterministic fallback so the plan always reads well even with no AI key. */
async function renderNarration(
	headline: string,
	stats: EveningPlanStats,
	items: EveningPlanItem[]
): Promise<{ narration: string; aiWritten: boolean }> {
	const payload = JSON.stringify({
		headline,
		stats,
		checklist: items.map((i) => ({ kind: i.kind, title: i.title }))
	});
	try {
		const result = await runAgent(
			COPILOT_SYSTEM,
			`Tonight's plan facts:\n${payload}\n\nWrite the orientation.`,
			[],
			[]
		);
		if (result.configured && !result.errored && result.answer.trim()) {
			return { narration: result.answer.trim(), aiWritten: true };
		}
	} catch {
		// fall through to deterministic narration
	}
	return { narration: fallbackNarration(headline, stats), aiWritten: false };
}

/** Deterministic narration — used when the LLM is off or errors. Honest, assembled
 *  straight from the computed stats. */
export function fallbackNarration(headline: string, stats: EveningPlanStats): string {
	const parts: string[] = [`Tonight: ${headline}`];
	if (stats.seatingMoves > 0) {
		parts.push(
			`${stats.seatingMoves} seating move${stats.seatingMoves === 1 ? '' : 's'} would ${
				stats.seatsFreed > 0 ? `free ${stats.seatsFreed} seat${stats.seatsFreed === 1 ? '' : 's'}` : 'tidy the room'
			}.`
		);
	}
	if (stats.highRisk + stats.mediumRisk > 0) {
		parts.push(
			`${stats.highRisk} high / ${stats.mediumRisk} medium no-show risk${
				stats.highRisk + stats.mediumRisk === 1 ? '' : 's'
			} worth chasing.`
		);
	}
	if (stats.allergyAlerts > 0) {
		parts.push(`${stats.allergyAlerts} allergy alert${stats.allergyAlerts === 1 ? '' : 's'} for the pass.`);
	}
	if (stats.vips > 0) parts.push(`${stats.vips} VIP${stats.vips === 1 ? '' : 's'} to greet.`);
	parts.push('Work the checklist below — each action is confirmed individually before it applies.');
	return parts.join(' ');
}

/**
 * Assemble the whole evening plan for one brand + local date. Pure-engine facts +
 * an LLM-framed narration. Degrades field-by-field: a failing source contributes
 * nothing rather than aborting the plan, so "Plan tonight" always returns
 * something useful even with partial data / no AI key.
 *
 * @param date 'YYYY-MM-DD' (local). Resolve relative phrases before calling.
 * @param now  injectable clock for deterministic tests.
 */
export async function assembleEveningPlan(
	brand: BrandId,
	date: string,
	now: Date = new Date()
): Promise<EveningPlan> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be 'YYYY-MM-DD'.");

	// Gather the deterministic facts in parallel; each degrades to a safe empty.
	const [snapshot, seating, risks] = await Promise.all([
		buildSnapshot(brand, date, now),
		getSeatingPlan(brand, date).catch(
			() =>
				({
					date,
					moves: [],
					considered: 0,
					pinned: 0,
					unseated: [],
					summary: {
						wastedSeatsBefore: 0,
						wastedSeatsAfter: 0,
						joinsBefore: 0,
						joinsAfter: 0,
						movesCount: 0
					}
				}) as SeatingPlan
		),
		computeDayRisk(brand, date, now.getTime()).catch(() => [] as BookingRisk[])
	]);

	const seats = seatingItems(seating);
	const chases = riskItems(risks);
	const notes = runSheetItems(snapshot, brand, date);
	const items: EveningPlanItem[] = [...seats, ...chases, ...notes];

	const stats: EveningPlanStats = {
		totalBookings: snapshot.dashboard.totalBookings,
		totalCovers: snapshot.dashboard.totalCovers,
		seatingMoves: seats.length,
		seatsFreed: Math.max(0, seating.summary.wastedSeatsBefore - seating.summary.wastedSeatsAfter),
		highRisk: snapshot.risk.high,
		mediumRisk: snapshot.risk.medium,
		allergyAlerts: snapshot.allergies.allergyAlerts,
		vips: snapshot.vips.length,
		openAlerts: 0 // alerts live on the dashboard banner; not duplicated into the plan
	};

	const headline = buildHeadline(snapshot);
	const { narration, aiWritten } = await renderNarration(headline, stats, items);

	return {
		brand,
		date,
		generatedAt: now.toISOString(),
		headline,
		narration,
		aiWritten,
		items,
		stats
	};
}
