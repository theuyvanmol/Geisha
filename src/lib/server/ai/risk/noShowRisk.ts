// Server-side orchestration around the pure no-show scorer (noShowScore.ts).
//
// Loads a brand's bookings for a local date, resolves the two side inputs the
// pure scorer needs but can't read itself — whether a deposit/hold is on file
// (geisha_payments) and the guest's prior no_show/cancel history (the expanded
// customer row) — then scores each LIVE booking. Used by BOTH the morning cron
// (which persists the scores) and the get_noshow_risk read tool (which just
// reports them). The arithmetic itself stays in the pure module; this file is the
// only part that talks to PocketBase. Server-only.

import { pb } from '../../db/pb.js';
import type { Payment } from '../../db/types.js';
import { getBookingsForDay, type BookingWithRefs } from '../../booking/admin.js';
import { writeAudit } from '../../booking/audit.js';
import { getRestaurant } from '../../booking/queries.js';
import {
	scoreNoShow,
	historyFromCustomer,
	type RiskResult,
	type ScorableBooking
} from './noShowScore.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** Payment statuses that count as a live deposit/hold de-risking the booking. */
const ACTIVE_PAYMENT_STATUSES = new Set(['Created', 'Authorized', 'Captured']);

/** Booking statuses still in the future / pending — the only ones a no-show risk
 *  is meaningful for. Resolved bookings (seated/completed/cancelled/no_show)
 *  already have a known outcome, so they're skipped. */
const LIVE_STATUSES = new Set(['pending_payment', 'confirmed']);

export interface BookingRisk {
	bookingId: string;
	/** The guest's customer id (when the booking has one), '' otherwise. Needed by
	 *  the autonomous copilot to draft a pre-visit chase via draft_message. */
	customerId: string;
	customerName: string;
	partySize: number;
	startsAt: string;
	status: string;
	source: string;
	hasDeposit: boolean;
	risk: RiskResult;
}

/**
 * Batch-resolve which of the given bookings have a live deposit / hold on file.
 * One paged query over the booking ids (chunked) rather than N point reads, to
 * keep work bounded on the droplet. Degrades to "no deposits" if the collection
 * is absent (pre-payments dev data).
 */
async function depositsByBooking(bookingIds: string[]): Promise<Set<string>> {
	const held = new Set<string>();
	if (!bookingIds.length) return held;
	const c = await pb();
	// Chunk the OR-filter so a very busy day doesn't build a pathological query.
	const CHUNK = 40;
	for (let i = 0; i < bookingIds.length; i += CHUNK) {
		const chunk = bookingIds.slice(i, i + CHUNK);
		const filter = chunk.map((id) => `booking=${q(id)}`).join(' || ');
		try {
			const rows = await c.collection('geisha_payments').getFullList<Payment>({ filter });
			for (const p of rows) {
				if (p.status && ACTIVE_PAYMENT_STATUSES.has(p.status)) held.add(p.booking);
			}
		} catch {
			// collection missing / query failed — treat the chunk as deposit-free
		}
	}
	return held;
}

/**
 * Compute no-show risk for every LIVE booking on a brand's local date.
 * Pure-scorer driven; returns the per-booking results sorted highest-risk first
 * so callers (cron + tool) share one ordering. `nowMs` defaults to now and is
 * threadable for testing/back-dated runs.
 */
export async function computeDayRisk(
	brand: 'asia' | 'fusion',
	date: string,
	nowMs: number = Date.now()
): Promise<BookingRisk[]> {
	const bookings = await getBookingsForDay(brand, date);
	const live = bookings.filter((b) => LIVE_STATUSES.has(b.status));
	if (!live.length) return [];

	const held = await depositsByBooking(live.map((b) => b.id));

	const out: BookingRisk[] = live.map((b: BookingWithRefs) => {
		const hasDeposit = held.has(b.id);
		const scorable: ScorableBooking = {
			party_size: b.party_size,
			starts_at: b.starts_at,
			source: b.source,
			tables: b.tables,
			hasDeposit
		};
		const risk = scoreNoShow(scorable, historyFromCustomer(b.expand?.customer), nowMs);
		return {
			bookingId: b.id,
			customerId: b.expand?.customer?.id ?? (typeof b.customer === 'string' ? b.customer : ''),
			customerName: b.expand?.customer?.name ?? '(unknown)',
			partySize: b.party_size,
			startsAt: b.starts_at,
			status: b.status,
			source: b.source || '',
			hasDeposit,
			risk
		};
	});

	out.sort((a, b) => b.risk.score - a.risk.score);
	return out;
}

export interface RiskRunResult {
	brand: string;
	date: string;
	scored: number;
	updated: number;
	high: number;
	medium: number;
}

/**
 * Recompute + PERSIST morning risk scores for one brand's date. Writes
 * `risk_score` (stored 0..1 to match the geisha_bookings field contract) and
 * `risk_factors` (the explainable factor list) onto each booking, and records a
 * geisha_ai_insights row (kind 'noshow_risk', subject_id = booking id, score =
 * 0..100) so the insight history is queryable independent of the live booking.
 * Best-effort per row — a single write failure is logged and skipped, never
 * aborting the sweep. NO LLM: pure arithmetic from {@link computeDayRisk}.
 */
export async function runRiskScoring(
	brand: 'asia' | 'fusion',
	date: string,
	nowMs: number = Date.now()
): Promise<RiskRunResult> {
	const result: RiskRunResult = { brand, date, scored: 0, updated: 0, high: 0, medium: 0 };

	let restaurantId = '';
	try {
		restaurantId = (await getRestaurant(brand)).id;
	} catch {
		return result; // brand not provisioned — degrade gracefully
	}

	const risks = await computeDayRisk(brand, date, nowMs);
	result.scored = risks.length;
	if (!risks.length) return result;

	const c = await pb();
	for (const r of risks) {
		if (r.risk.band === 'high') result.high++;
		else if (r.risk.band === 'medium') result.medium++;

		try {
			await c.collection('geisha_bookings').update(r.bookingId, {
				// Stored 0..1 per the geisha_bookings.risk_score field contract; the
				// 0..100 form lives in risk_factors.score and the insight row.
				risk_score: r.risk.score / 100,
				risk_factors: {
					score: r.risk.score,
					band: r.risk.band,
					factors: r.risk.factors,
					computed_at: new Date(nowMs).toISOString()
				}
			});
			result.updated++;
		} catch (err) {
			console.error('[risk] failed to update booking', r.bookingId, err);
			continue;
		}

		// Append an insight row (best-effort — never aborts the sweep).
		try {
			await c.collection('geisha_ai_insights').create({
				restaurant: restaurantId,
				kind: 'noshow_risk',
				subject_id: r.bookingId,
				score: r.risk.score,
				payload: {
					date,
					band: r.risk.band,
					factors: r.risk.factors,
					party_size: r.partySize,
					starts_at: r.startsAt,
					has_deposit: r.hasDeposit
				}
			});
		} catch (err) {
			console.error('[risk] failed to write insight', r.bookingId, err);
		}
	}

	// One audit line summarising the automated sweep (actor 'ai', no human).
	await writeAudit('ai', 'noshow_risk_scored', 'geisha_bookings', `${brand}:${date}`, null, {
		scored: result.scored,
		updated: result.updated,
		high: result.high,
		medium: result.medium
	});

	return result;
}

/** Recompute + persist risk for both brands on a date. */
export async function runRiskScoringAll(
	date: string,
	nowMs: number = Date.now()
): Promise<Record<string, RiskRunResult>> {
	const [asia, fusion] = await Promise.all([
		runRiskScoring('asia', date, nowMs),
		runRiskScoring('fusion', date, nowMs)
	]);
	return { asia, fusion };
}
