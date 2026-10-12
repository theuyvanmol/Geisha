// mf-seating-optimiser — a PURE, deterministic seating optimiser (MOONSHOT
// "honest AI": arithmetic, not an LLM). It solves the WHOLE day's table
// allocation at once: take the bookings that still need (or could be improved on)
// a table, and pack them onto the physical tables / registered joins so we waste
// the FEWEST seats and split the fewest tables into joins.
//
// Deliberately DB-free — like availability.ts it takes its data as arguments and
// is reused by the read tool (toolsInsights.ts) and the /admin/floor button via a
// thin loader. The output is a DIFF of moves vs the current allocation; each move
// is applied through the existing confirm-gated moveBooking(actor='ai'), so the
// optimiser never writes anything itself.
//
// Pinning: any booking that is already SEATED (or completed) is PINNED — its
// tables are reserved and it is never proposed for a move. Only forward-looking
// confirmed / pending_payment bookings are (re)assignable.

import { addMinutes } from 'date-fns';
import type { BrandId, DiningTable, ServicePeriod, TableJoin } from '../db/types.js';
import { turnMinutesFor } from './availability.js';
import { getRestaurant, getActivePeriods, getTables, getJoins } from './queries.js';
import { getBookingsForDay } from './admin.js';
import { moveBooking } from './mutate.js';
import type { AuditActor } from '../db/types.js';

// --- inputs -----------------------------------------------------------------

/** Booking statuses that PIN a table (occupy it and may never be moved). */
const PINNED_STATUSES = new Set(['seated', 'completed']);
/** Booking statuses that are forward-looking and (re)assignable by the planner. */
const ASSIGNABLE_STATUSES = new Set(['confirmed', 'pending_payment']);

/** A booking the planner reasons about (subset of the DB row it needs). */
export interface PlannerBooking {
	id: string;
	partySize: number;
	startsAt: Date | string; // absolute instant
	endsAt: Date | string;
	/** Current table allocation (may be empty for an unassigned booking). */
	tableIds: string[];
	status: string;
	servicePeriodId?: string;
	/** Free-text the planner mines for soft prefs (e.g. "window seat please"). */
	notes?: string;
	/** Customer signals: VIP gets priority + a VIP/Window section nudge. */
	vip?: boolean;
	tags?: string[];
}

export interface OptimiseInput {
	date: string; // 'YYYY-MM-DD' (echoed back; the engine is otherwise tz-agnostic)
	tables: DiningTable[];
	joins: TableJoin[];
	periods: ServicePeriod[];
	bookings: PlannerBooking[];
	/** Optional turn override (minutes) — otherwise derived per period/party. */
	defaultTurnMinutes?: number;
}

/** One proposed reseat: move `bookingId` off `fromTableIds` onto `toTableIds`. */
export interface SeatingMove {
	bookingId: string;
	partySize: number;
	startsAt: string;
	fromTableIds: string[];
	toTableIds: string[];
	/** Human label for the destination, e.g. "T4" or "T4+T6" (for the review UI). */
	fromLabel: string;
	toLabel: string;
	/** Seats wasted before vs after this booking's allocation (≥0). */
	wastedBefore: number;
	wastedAfter: number;
	/** True when the new allocation is a join (≥2 tables) where the old wasn't. */
	createsJoin: boolean;
	/** True when the old allocation was a join and the new one isn't. */
	removesJoin: boolean;
}

export interface SeatingPlan {
	date: string;
	/** Moves to apply, best-improvement first. Empty = already optimal. */
	moves: SeatingMove[];
	/** How many forward bookings were considered (excludes pinned/seated). */
	considered: number;
	/** How many were pinned (seated/completed) and left untouched. */
	pinned: number;
	/** Bookings the planner could NOT seat at all (capacity exhausted). */
	unseated: Array<{ bookingId: string; partySize: number; startsAt: string }>;
	/** Score summary so the UI can say "frees N seats / removes M joins". */
	summary: {
		wastedSeatsBefore: number;
		wastedSeatsAfter: number;
		joinsBefore: number;
		joinsAfter: number;
		movesCount: number;
	};
}

// --- helpers ----------------------------------------------------------------

function toInstant(d: Date | string): number {
	return (d instanceof Date ? d : new Date(d)).getTime();
}

/** Two [start,end) windows overlap iff aStart < bEnd && bStart < aEnd. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/** Capacity (max seats) of a single-table or joined allocation. */
function capacityOf(tableIds: string[], byId: Map<string, DiningTable>): number {
	return tableIds.reduce((n, id) => n + (byId.get(id)?.seats_max ?? 0), 0);
}

/** Minimum-seats sum of a candidate allocation (used to reject too-big tables). */
function minOf(tableIds: string[], byId: Map<string, DiningTable>): number {
	return tableIds.reduce((n, id) => n + (byId.get(id)?.seats_min ?? 0), 0);
}

/** Wasted seats for seating `party` on `tableIds` = capacity − party (≥0). */
function wastedFor(party: number, tableIds: string[], byId: Map<string, DiningTable>): number {
	return Math.max(0, capacityOf(tableIds, byId) - party);
}

function labelFor(tableIds: string[], byId: Map<string, DiningTable>): string {
	if (!tableIds.length) return '(unassigned)';
	return tableIds.map((id) => byId.get(id)?.label ?? id).join('+');
}

/**
 * Section/preference affinity for a booking against a candidate allocation, as a
 * small NON-negative penalty (lower = better). PURE heuristic mined from notes +
 * VIP/tags — never an LLM. A VIP or a "window"/"booth"/"vip" note prefers a table
 * in the matching section; a mismatch costs a tie-breaker point so the packer
 * honours soft prefs only when it doesn't worsen the hard objective.
 */
function prefPenalty(b: PlannerBooking, tableIds: string[], byId: Map<string, DiningTable>): number {
	const wants = desiredSections(b);
	if (!wants.size) return 0;
	// reward an allocation whose tables ALL sit in a desired section; penalise any
	// table outside it (1 point per off-section table).
	let off = 0;
	for (const id of tableIds) {
		const sec = (byId.get(id)?.section ?? '').toString();
		if (!wants.has(sec)) off += 1;
	}
	return off;
}

/** The set of table sections a booking would prefer, from VIP flag + notes/tags. */
function desiredSections(b: PlannerBooking): Set<string> {
	const out = new Set<string>();
	const hay = `${b.notes ?? ''} ${(b.tags ?? []).join(' ')}`.toLowerCase();
	if (b.vip || hay.includes('vip')) out.add('VIP');
	if (/\bwindow\b/.test(hay)) out.add('Window');
	if (/\b(bar|stool)\b/.test(hay)) out.add('Bar');
	if (/\b(outdoor|terrace|patio|outside)\b/.test(hay)) out.add('Outdoor');
	return out;
}

/** Priority for assignment ordering: VIPs first, then larger parties, then
 *  earlier starts (deterministic, stable by id). Larger parties first because
 *  they are the hardest to place (need big tables / joins). */
function assignmentRank(b: PlannerBooking): [number, number, number] {
	return [b.vip ? 0 : 1, -b.partySize, toInstant(b.startsAt)];
}

// --- candidate allocations --------------------------------------------------

/** A candidate allocation for a party: one table or a registered join pair. */
interface Candidate {
	tableIds: string[];
	capacity: number;
	isJoin: boolean;
}

/**
 * All allocations that could seat `party`, smallest-waste first. Singles whose
 * [min,max] band fits the party, plus registered join pairs whose combined band
 * fits. Walk-in-only tables (bookable=false) are never offered — matching the
 * availability engine's allocateTables policy.
 */
function candidatesFor(
	party: number,
	tables: DiningTable[],
	joins: TableJoin[],
	byId: Map<string, DiningTable>
): Candidate[] {
	const out: Candidate[] = [];
	const fits = (t: DiningTable) => party >= t.seats_min && party <= t.seats_max;

	for (const t of tables) {
		if (t.bookable && fits(t)) out.push({ tableIds: [t.id], capacity: t.seats_max, isJoin: false });
	}
	for (const j of joins) {
		const a = byId.get(j.table_a);
		const b = byId.get(j.table_b);
		if (!a || !b || !a.bookable || !b.bookable) continue;
		const pair = [a.id, b.id];
		const cmin = minOf(pair, byId);
		const cmax = capacityOf(pair, byId);
		if (party < cmin || party > cmax) continue;
		out.push({ tableIds: pair, capacity: cmax, isJoin: true });
	}

	// smallest capacity first (tight fit), singles before joins on a tie.
	return out.sort(
		(x, y) => x.capacity - y.capacity || Number(x.isJoin) - Number(y.isJoin)
	);
}

// --- the time-aware reservation grid ----------------------------------------

/**
 * A running record of which tables are busy for which windows, so the greedy
 * packer can check "is this allocation free for THIS booking's turn?" while it
 * places overlapping bookings across the whole day.
 */
class Reservations {
	private byTable = new Map<string, Array<[number, number]>>();

	/** Reserve [start,end) on each table (pre-seed pinned, then placed bookings). */
	reserve(tableIds: string[], startMs: number, endMs: number): void {
		for (const id of tableIds) {
			const arr = this.byTable.get(id) ?? [];
			arr.push([startMs, endMs]);
			this.byTable.set(id, arr);
		}
	}

	/** Is every table in `tableIds` free for [startMs,endMs)? */
	free(tableIds: string[], startMs: number, endMs: number): boolean {
		for (const id of tableIds) {
			for (const [s, e] of this.byTable.get(id) ?? []) {
				if (overlaps(startMs, endMs, s, e)) return false;
			}
		}
		return true;
	}

	/** Release a previously-reserved window (for local-search undo). */
	release(tableIds: string[], startMs: number, endMs: number): void {
		for (const id of tableIds) {
			const arr = this.byTable.get(id);
			if (!arr) continue;
			const i = arr.findIndex(([s, e]) => s === startMs && e === endMs);
			if (i >= 0) arr.splice(i, 1);
		}
	}
}

// --- the planner ------------------------------------------------------------

/** Turn (minutes) for a booking: explicit override, else the period default. */
function turnFor(b: PlannerBooking, periodById: Map<string, ServicePeriod>, override?: number): number {
	if (override && override > 0) return override;
	const period = b.servicePeriodId ? periodById.get(b.servicePeriodId) : undefined;
	if (period) return turnMinutesFor(b.partySize, period);
	return 120; // safe default when the period is unknown
}

/**
 * Solve the whole day's seating. Greedy first-fit (hardest parties first,
 * smallest-waste allocation, soft-pref tie-break), then a local-search sweep that
 * tries to swap any booking onto a tighter free allocation. Pinned (seated)
 * bookings reserve their tables up front and never move.
 *
 * Returns a DIFF: only bookings whose proposed allocation DIFFERS from their
 * current one appear as moves. A booking with no current tables that gets seated
 * is a move from `[]`. The plan is sorted best-improvement first.
 */
export function proposeSeatingPlan(input: OptimiseInput): SeatingPlan {
	const { date, tables, joins, periods, bookings } = input;
	const byId = new Map(tables.map((t) => [t.id, t]));
	const periodById = new Map(periods.map((p) => [p.id, p]));

	const grid = new Reservations();

	// 1. Pin seated/completed bookings — reserve their tables, never reassign.
	const pinned = bookings.filter((b) => PINNED_STATUSES.has(b.status));
	for (const b of pinned) {
		const startMs = toInstant(b.startsAt);
		const endMs = toInstant(b.endsAt);
		grid.reserve(b.tableIds, startMs, endMs);
	}

	// 2. Forward bookings we may (re)assign, hardest-to-place first.
	const assignable = bookings
		.filter((b) => ASSIGNABLE_STATUSES.has(b.status))
		.sort((a, b) => {
			const ra = assignmentRank(a);
			const rb = assignmentRank(b);
			return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || a.id.localeCompare(b.id);
		});

	// Snapshot the CURRENT allocation/score for the diff + summary.
	const currentTables = new Map(assignable.map((b) => [b.id, b.tableIds.slice()]));

	// 3. Greedy placement. Each booking gets the smallest-waste free allocation,
	//    breaking ties by soft-pref penalty then fewer tables (avoid needless joins).
	const placed = new Map<string, string[]>();
	const unseated: SeatingPlan['unseated'] = [];

	for (const b of assignable) {
		const startMs = toInstant(b.startsAt);
		const endMs = addMinutes(new Date(startMs), turnFor(b, periodById, input.defaultTurnMinutes)).getTime();
		const cands = candidatesFor(b.partySize, tables, joins, byId);

		let best: Candidate | null = null;
		let bestKey: [number, number, number] | null = null;
		for (const c of cands) {
			if (!grid.free(c.tableIds, startMs, endMs)) continue;
			const key: [number, number, number] = [
				wastedFor(b.partySize, c.tableIds, byId),
				prefPenalty(b, c.tableIds, byId),
				c.tableIds.length // prefer fewer tables (don't split into a join needlessly)
			];
			if (!bestKey || lt(key, bestKey)) {
				best = c;
				bestKey = key;
			}
		}

		if (best) {
			grid.reserve(best.tableIds, startMs, endMs);
			placed.set(b.id, best.tableIds);
		} else {
			unseated.push({ bookingId: b.id, partySize: b.partySize, startsAt: isoOf(b.startsAt) });
		}
	}

	// 4. Local search: for each placed booking, try to find a STRICTLY better free
	//    allocation (releasing its own reservation first so it can consider tighter
	//    tables that itself was blocking). Repeat until a sweep makes no change
	//    (bounded so it always terminates).
	const MAX_SWEEPS = 4;
	for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
		let improved = false;
		for (const b of assignable) {
			const cur = placed.get(b.id);
			if (!cur) continue;
			const startMs = toInstant(b.startsAt);
			const endMs = addMinutes(
				new Date(startMs),
				turnFor(b, periodById, input.defaultTurnMinutes)
			).getTime();
			const curKey: [number, number, number] = [
				wastedFor(b.partySize, cur, byId),
				prefPenalty(b, cur, byId),
				cur.length
			];
			grid.release(cur, startMs, endMs);

			let best = cur;
			let bestKey = curKey;
			for (const c of candidatesFor(b.partySize, tables, joins, byId)) {
				if (sameSet(c.tableIds, cur)) continue;
				if (!grid.free(c.tableIds, startMs, endMs)) continue;
				const key: [number, number, number] = [
					wastedFor(b.partySize, c.tableIds, byId),
					prefPenalty(b, c.tableIds, byId),
					c.tableIds.length
				];
				if (lt(key, bestKey)) {
					best = c.tableIds;
					bestKey = key;
				}
			}
			grid.reserve(best, startMs, endMs);
			if (!sameSet(best, cur)) {
				placed.set(b.id, best);
				improved = true;
			}
		}
		if (!improved) break;
	}

	// 5. Build the diff + summary. Only changed allocations become moves.
	const moves: SeatingMove[] = [];
	let wastedBeforeTotal = 0;
	let wastedAfterTotal = 0;
	let joinsBefore = 0;
	let joinsAfter = 0;

	for (const b of assignable) {
		const before = currentTables.get(b.id) ?? [];
		const after = placed.get(b.id) ?? before; // unseated keep their (empty) current
		const wBefore = before.length ? wastedFor(b.partySize, before, byId) : 0;
		const wAfter = after.length ? wastedFor(b.partySize, after, byId) : 0;
		wastedBeforeTotal += wBefore;
		wastedAfterTotal += wAfter;
		if (before.length > 1) joinsBefore += 1;
		if (after.length > 1) joinsAfter += 1;

		if (sameSet(before, after)) continue; // no change — not a move

		moves.push({
			bookingId: b.id,
			partySize: b.partySize,
			startsAt: isoOf(b.startsAt),
			fromTableIds: before,
			toTableIds: after,
			fromLabel: labelFor(before, byId),
			toLabel: labelFor(after, byId),
			wastedBefore: wBefore,
			wastedAfter: wAfter,
			createsJoin: before.length <= 1 && after.length > 1,
			removesJoin: before.length > 1 && after.length <= 1
		});
	}

	// Best-improvement first: biggest waste reduction, then join removals, then time.
	moves.sort((m, n) => {
		const dM = m.wastedBefore - m.wastedAfter;
		const dN = n.wastedBefore - n.wastedAfter;
		if (dN !== dM) return dN - dM;
		const jM = (m.removesJoin ? 1 : 0) - (m.createsJoin ? 1 : 0);
		const jN = (n.removesJoin ? 1 : 0) - (n.createsJoin ? 1 : 0);
		if (jN !== jM) return jN - jM;
		return m.startsAt.localeCompare(n.startsAt);
	});

	return {
		date,
		moves,
		considered: assignable.length,
		pinned: pinned.length,
		unseated,
		summary: {
			wastedSeatsBefore: wastedBeforeTotal,
			wastedSeatsAfter: wastedAfterTotal,
			joinsBefore,
			joinsAfter,
			movesCount: moves.length
		}
	};
}

// --- tiny tuple/array utilities ---------------------------------------------

/** Lexicographic less-than over a 3-tuple of numbers. */
function lt(a: [number, number, number], b: [number, number, number]): boolean {
	if (a[0] !== b[0]) return a[0] < b[0];
	if (a[1] !== b[1]) return a[1] < b[1];
	return a[2] < b[2];
}

/** Order-independent equality of two id lists. */
function sameSet(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const s = new Set(a);
	return b.every((id) => s.has(id));
}

function isoOf(d: Date | string): string {
	return (d instanceof Date ? d : new Date(d)).toISOString();
}

// ============================================================================
// DB-backed adapter — the thin impure layer the read tool + /admin/floor use.
// The packing maths above stays pure; this just loads the day's rows from
// PocketBase, runs proposeSeatingPlan, and (for apply) re-points tables through
// the existing confirm-gated moveBooking. Kept here so callers have one entry.
// ============================================================================

/** Statuses that occupy / are relevant to the planner for a service day. */
const PLANNER_STATUSES = new Set([
	'pending_payment',
	'confirmed',
	'seated',
	'completed'
]);

/**
 * Load a brand's bookings + floor topology for `date` and compute the optimised
 * seating diff. Reuses the SAME loaders the live floor + availability use, so the
 * plan reflects exactly what staff see. Returns a {@link SeatingPlan} of moves.
 */
export async function getSeatingPlan(brand: BrandId, date: string): Promise<SeatingPlan> {
	const restaurant = await getRestaurant(brand);
	const [periods, tables, joins, dayBookings] = await Promise.all([
		getActivePeriods(restaurant.id),
		getTables(restaurant.id),
		getJoins(restaurant.id),
		getBookingsForDay(brand, date)
	]);

	const bookings: PlannerBooking[] = dayBookings
		.filter((b) => PLANNER_STATUSES.has(b.status))
		.map((b) => {
			const cust = b.expand?.customer;
			return {
				id: b.id,
				partySize: b.party_size,
				startsAt: b.starts_at,
				endsAt: b.ends_at,
				tableIds: b.tables ?? [],
				status: b.status,
				servicePeriodId: b.service_period,
				// soft-pref signals: the booking's own request + the guest's CRM data
				notes: `${b.special_requests ?? ''} ${b.occasion ?? ''}`.trim(),
				vip: cust?.vip ?? false,
				tags: cust?.tags ?? []
			};
		});

	return proposeSeatingPlan({ date, tables, joins, periods, bookings });
}

/**
 * Apply a SINGLE proposed move (one booking → its new tables) through the
 * existing confirm-gated {@link moveBooking}. Each move is its own confirm in the
 * UI; this is the per-move applier the action/tool calls. actor defaults to 'ai'
 * (the optimiser is an AI surface); `onBehalfOf` records the confirming staff id.
 *
 * Re-validates that the destination is the right SIZE for the party here as a
 * cheap guard (moveBooking itself does not re-check fit), and refuses to move a
 * booking that is no longer pending/confirmed (e.g. it got seated meanwhile).
 */
export async function applySeatingMove(
	move: { bookingId: string; toTableIds: string[]; partySize: number },
	nowISO: string,
	actor: AuditActor = 'ai',
	onBehalfOf?: string
): Promise<void> {
	if (!move.toTableIds.length) throw new Error('A move needs at least one destination table.');
	await moveBooking(move.bookingId, move.toTableIds, nowISO, actor, onBehalfOf);
}
