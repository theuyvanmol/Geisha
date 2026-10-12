// Availability engine — the core of the booking system (BOOKING_SYSTEM_PLAN.md §4).
//
// Deliberately PURE: every function takes its data (tables, periods, existing
// bookings) as arguments and calls no database. The API route (P2) fetches from
// PocketBase and passes the data in. This keeps the hard logic fully unit-
// testable offline and reusable by the widget, admin, and AI layer alike.
//
// Times are handled in the restaurant's local wall-clock for slot generation
// (Europe/London) but compared as absolute instants (epoch ms) for overlap, so
// DST and timezone are correct as long as callers pass real Date/ISO instants.

import { addMinutes } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import type { DiningTable, ServicePeriod, TableJoin } from '../db/types.js';
import {
	isDateClosed,
	isPeriodClosed,
	sectionCloseoutsFor,
	activeClosuresFor,
	closureReasonFor,
	isWholeRestaurant,
	type ClosureRule
} from './closures.js';
import { selectPacingRule, slotWithinSlotCap, withinPeriodCap, type PacingRule } from './pacing.js';

// --- inputs the engine works on (subset of the DB rows it needs) -----------

/** An existing booking's footprint: which tables it holds and for what window. */
export interface BookingFootprint {
	tableIds: string[];
	startsAt: Date | string; // absolute instant
	endsAt: Date | string;
	/**
	 * Covers (party size) this booking holds — needed by the pacing engine
	 * (WP-AVAIL-1) to sum covers per slot/period. Optional only for back-compat
	 * with footprints built before pacing existed; treated as 0 when absent.
	 */
	partySize?: number;
	/** Statuses that DON'T occupy a table (cancelled/no_show) should be filtered
	 *  out by the caller before passing in; anything here is treated as occupying. */
}

export interface AvailabilityInput {
	/** 'YYYY-MM-DD' — the local calendar date the guest is booking. */
	date: string;
	partySize: number;
	timezone: string; // e.g. 'Europe/London'
	periods: ServicePeriod[]; // all active periods for the brand
	tables: DiningTable[]; // all tables for the brand
	joins: TableJoin[]; // combinable pairs for the brand
	/**
	 * Staff-managed table CHAINS (ResDiary "Table Joins") with their AUTHORED
	 * capacity. Passed IN to keep the engine pure. A chain whose members are all
	 * free is preferred over an ad-hoc combination, and its authored capacity (not
	 * the raw seats sum) decides what it seats. Absent/empty = today's behaviour.
	 */
	chains?: TableChainCapacity[];
	/**
	 * Which tables may be auto-joined at all, and whether unregistered (ad-hoc)
	 * combinations are allowed — see booking/autojoin.ts. Passed IN to keep the
	 * engine pure. Absent = every table combinable, ad-hoc allowed (today's
	 * behaviour).
	 */
	autoJoin?: AutoJoinPolicy;
	existing: BookingFootprint[]; // bookings that already occupy tables
	/** Closures (full-day / per-period blackouts) — passed IN to keep this pure. */
	closures?: ClosureRule[];
	/**
	 * Pacing rules (covers caps per slot / per period) — passed IN to keep this
	 * pure (WP-AVAIL-1). The most-specific rule per period is resolved internally
	 * via selectPacingRule. Empty / absent = uncapped (today's behaviour).
	 */
	pacing?: PacingRule[];
	/**
	 * Fill-ranking map (table id → rank, lower = filled first). Passed IN to keep
	 * this pure — the loader (index.ts) fetches it from geisha_settings. Absent /
	 * empty = today's smallest-fit ordering (no yield preference).
	 */
	tableRanks?: Record<string, number>;
	/** Limits — usually sourced from geisha_settings. */
	onlinePartyMax?: number; // default 30
	slotIntervalMinutes?: number; // default 15
	/**
	 * Booking-horizon enforcement (WP-AVAIL-3). All optional so existing callers
	 * and tests keep their behaviour. Passed IN — the engine never reads the clock
	 * itself, so it stays pure and deterministic.
	 */
	nowMs?: number; // the request instant (epoch ms); enables horizon checks
	bookingWindowDays?: number; // global "book at most N days ahead" (default 0 = no cap)
	leadTimeMinutes?: number; // online cut-off in minutes (default 0 = no restriction)
	/**
	 * WHAT the cut-off is measured against — ResDiary's two "Online Booking
	 * Restriction" modes:
	 *   'visit'   — block a booking N minutes before the GUEST'S OWN time. A rolling
	 *               cut-off: at 18:00 with 60 minutes, 19:00 is bookable and 18:30
	 *               isn't. This is what the engine has always done.
	 *   'service' — block a booking N minutes before the SERVICE STARTS. A cliff: if
	 *               dinner opens at 17:00 with 60 minutes, the whole of dinner closes
	 *               online at 16:00, whatever time the guest wanted.
	 * Default 'visit'. Irrelevant when leadTimeMinutes is 0.
	 */
	leadTimeMode?: LeadTimeMode;
}

/** ResDiary "Online Booking Restriction" mode — see AvailabilityInput.leadTimeMode. */
export type LeadTimeMode = 'visit' | 'service';

export interface Slot {
	/** Local 'HH:mm'. */
	time: string;
	/** Absolute instant the slot starts. */
	startsAt: Date;
	available: boolean;
	/** When available, the table id(s) that would be allocated. */
	tableIds?: string[];
	/** Why an unavailable slot is unavailable (for richer client messaging). */
	unavailableReason?: 'full' | 'too_soon' | 'beyond_window' | 'slot_cap' | 'period_cap';
}

/**
 * Why a date produced NO slots at all. The difference matters to a host: "we don't
 * run a lunch service on Saturdays" is a rota problem they fix in Settings, while
 * "every table is taken" is a floor problem. Both used to surface as the same
 * "no availability", which sent staff hunting for a bug that wasn't there.
 */
export type NoSlotsReason =
	| 'closed' // a full-day closure
	| 'no_service' // no active service period covers this weekday
	| 'party_too_large' // over the online cap (guests only — staff bypass)
	| 'invalid_party';

export interface AvailabilityResult {
	slots: Slot[];
	/** True when party exceeds the online cap — caller shows "please call". */
	requiresPhone: boolean;
	/** True when the whole date is closed (full-scope closure). */
	closed?: boolean;
	/** When closed (or a period was skipped), the reason to show the guest. */
	closureReason?: string;
	/** The effective horizon echoed back so the client can constrain its picker. */
	bookingWindow?: { leadMinutes: number; windowDays: number };
	/**
	 * Set ONLY when `slots` is empty, saying WHY there is nothing to offer. Lets the
	 * admin diary tell a host "no lunch service runs on Saturdays" instead of the
	 * misleading "no tables available for that party".
	 */
	noSlotsReason?: NoSlotsReason;
}

// --- helpers ----------------------------------------------------------------

function toInstant(d: Date | string): number {
	return (d instanceof Date ? d : new Date(d)).getTime();
}

/** Day-of-week 0..6 (Sun..Sat) for a 'YYYY-MM-DD' in the given timezone. */
function dayOfWeek(date: string, timezone: string): number {
	// noon avoids any DST edge at midnight
	const instant = fromZonedTime(`${date}T12:00:00`, timezone);
	return instant.getDay();
}

function parseHHmm(date: string, hhmm: string, timezone: string): Date {
	return fromZonedTime(`${date}T${hhmm}:00`, timezone);
}

/** Two [start,end) windows overlap iff aStart < bEnd && bStart < aEnd. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
	return aStart < bEnd && bStart < aEnd;
}

/** Is a single table free for [startMs, endMs)? */
function tableFree(
	tableId: string,
	startMs: number,
	endMs: number,
	existing: BookingFootprint[]
): boolean {
	for (const b of existing) {
		if (!b.tableIds.includes(tableId)) continue;
		if (overlaps(startMs, endMs, toInstant(b.startsAt), toInstant(b.endsAt))) return false;
	}
	return true;
}

// --- section close-outs -----------------------------------------------------

/**
 * Build synthetic {@link BookingFootprint}s for the diary "CloseOuts" — section-scope
 * closures that make part of the room unavailable. We model a close-out as occupancy
 * rather than a special case in the allocator, so it flows through the SAME `tableFree`
 * overlap machinery on both the read (availability) and write (create / amend) paths
 * with no allocator changes.
 *
 * Each section-scope close-out on `date` blocks:
 *   - a SINGLE table (when `table` is set) OR every table in a whole `section`;
 *   - for a sub-window `[timeFrom, timeTo]` when both are set, else the WHOLE service.
 *
 * The whole-service window spans the period's first bookable slot through its close —
 * the LATER of `end_time` and `last_booking_time + the longest turn`, so a party
 * seated right on last orders (whose sitting runs past the nominal close) is still
 * blocked. Pure: `date`/`timezone` are passed in and all instants derive from them.
 *
 * TWO PASSES, because the two kinds of close-out are scoped differently:
 *
 *  1. NO sub-window ("close the Terrace for Dinner") — genuinely period-scoped. It
 *     borrows the named service's window, so it can only bite on a day that service runs.
 *  2. WITH a sub-window ("close the restaurant 16:45–17:00") — scoped to the CLOCK, not
 *     to a service. Its window is honoured verbatim, so the service it is filed under is
 *     only a label. It therefore applies on EVERY day in its date range, whatever runs
 *     that day. Without this, Fusion's Mon–Sat "Lunch" filing meant a "closed 16:45–17:00
 *     until <date>" range silently stopped biting on Sundays (which run a Sunday-only
 *     period), and no window could ever be filed against the 16:45–17:00 changeover
 *     itself — the very gap it exists to shut.
 */
export function sectionCloseoutFootprints(
	date: string,
	timezone: string,
	periods: ServicePeriod[],
	tables: DiningTable[],
	closures: ClosureRule[]
): BookingFootprint[] {
	// Longest turn any party can hold a table (mirrors turnMinutesFor's 6+ ladder) —
	// so a late last-orders sitting is fully inside a whole-service block window.
	const LONGEST_TURN_MIN = 150;
	const out: BookingFootprint[] = [];

	// Which tables does a close-out block? A specific table wins over a section; the
	// whole-restaurant sentinel ('*', "close the restaurant 19:00–20:00") blocks the lot
	// regardless of section.
	const tablesFor = (co: ClosureRule): string[] =>
		co.table
			? tables.filter((t) => t.id === co.table).map((t) => t.id)
			: isWholeRestaurant(co)
				? tables.map((t) => t.id)
				: tables.filter((t) => (t.section || '') === (co.section || '')).map((t) => t.id);

	// A close-out's own [from, to] as instants, or null when it names none / names a
	// nonsense one (to <= from) — those fall back to the whole service, as before.
	const ownWindow = (co: ClosureRule): { startMs: number; endMs: number } | null => {
		if (!co.timeFrom || !co.timeTo) return null;
		const f = parseHHmm(date, co.timeFrom, timezone).getTime();
		const t = parseHHmm(date, co.timeTo, timezone).getTime();
		return Number.isFinite(f) && Number.isFinite(t) && t > f ? { startMs: f, endMs: t } : null;
	};

	const emit = (tableIds: string[], startMs: number, endMs: number) => {
		const startsAt = new Date(startMs);
		const endsAt = new Date(endMs);
		// One footprint per closed table so a partial-table allocation still can't slip
		// through, and so amend's shape-based self-exclusion never accidentally matches.
		for (const id of tableIds) out.push({ tableIds: [id], startsAt, endsAt, partySize: 0 });
	};

	// --- pass 1: whole-service close-outs, against the service they name ---------
	for (const period of periods) {
		const closeouts = sectionCloseoutsFor(date, period.id, closures).filter(
			(co) => ownWindow(co) === null
		);
		if (closeouts.length === 0) continue;
		const serviceStartMs = parseHHmm(date, period.start_time, timezone).getTime();
		const serviceCloseMs = parseHHmm(date, period.end_time, timezone).getTime();
		const lastTurnEndMs = addMinutes(
			parseHHmm(date, period.last_booking_time || period.end_time, timezone),
			LONGEST_TURN_MIN
		).getTime();
		const serviceEndMs = Math.max(serviceCloseMs, lastTurnEndMs);
		for (const co of closeouts) {
			const tableIds = tablesFor(co);
			if (tableIds.length) emit(tableIds, serviceStartMs, serviceEndMs);
		}
	}

	// --- pass 2: windowed close-outs, against the clock (any service, or none) ----
	for (const co of sectionCloseoutsFor(date, undefined, closures)) {
		const win = ownWindow(co);
		if (!win) continue; // handled by pass 1
		const tableIds = tablesFor(co);
		if (tableIds.length) emit(tableIds, win.startMs, win.endMs);
	}

	// --- pass 3: bridge the changeover between two closed services ---------------
	//
	// Services do not always butt up. Fusion's Lunch shuts at 16:45 and Dinner opens
	// at 17:00, so that quarter of an hour belongs to no service at all — and a
	// close-out that names a clock window is honoured verbatim, so shutting the room
	// service by service (which is how the diary's form works: one block per sitting)
	// stopped dead at 16:45 and picked up again at 17:00. The restaurant was closed
	// either side of a gap it was somehow open in: a white stripe through a solid red
	// board, and a slot the allocator would still seat a walk-in into.
	//
	// So: closed on BOTH sides of a stretch no service covers means closed across it.
	// Per TABLE, never per room — one table blocked either side bridges only itself.
	// Only the gaps BETWEEN services: the hours before the first opens and after the
	// last closes were never open to begin with, and are not this function's business.
	const svc = periods
		.map((p) => ({
			s: parseHHmm(date, p.start_time, timezone).getTime(),
			e: parseHHmm(date, p.end_time, timezone).getTime()
		}))
		.filter((w) => Number.isFinite(w.s) && Number.isFinite(w.e) && w.e > w.s)
		.sort((a, b) => a.s - b.s);
	const deadZones: { startMs: number; endMs: number }[] = [];
	for (let i = 1, reach = svc.length ? svc[0].e : 0; i < svc.length; i++) {
		if (svc[i].s > reach) deadZones.push({ startMs: reach, endMs: svc[i].s });
		reach = Math.max(reach, svc[i].e);
	}
	if (deadZones.length && out.length) {
		// Snapshot per table BEFORE emitting, so a bridge can never seed another bridge.
		const byTable = new Map<string, BookingFootprint[]>();
		for (const f of out) {
			const id = f.tableIds[0];
			const held = byTable.get(id);
			if (held) held.push(f);
			else byTable.set(id, [f]);
		}
		for (const [id, held] of byTable) {
			/** Does one block hold this table across the whole of [a, b]? */
			const shutAcross = (a: number, b: number) =>
				held.some((f) => toInstant(f.startsAt) <= a && toInstant(f.endsAt) >= b);
			for (const dz of deadZones) {
				// Already shut end to end — a close-out drawn straight across the changeover
				// needs no bridge, and emitting one would just duplicate it.
				if (shutAcross(dz.startMs, dz.endMs)) continue;
				// Otherwise: closed at BOTH boundaries means closed between them. A boundary
				// counts when a block reaches it from either direction — [12:00,16:45] ends
				// exactly ON 16:45 and [17:00,23:00] starts exactly ON 17:00, which is the
				// shape the console files when the room is shut one sitting at a time.
				if (shutAcross(dz.startMs, dz.startMs) && shutAcross(dz.endMs, dz.endMs))
					emit([id], dz.startMs, dz.endMs);
			}
		}
	}

	return out;
}

// --- allocation -------------------------------------------------------------

/**
 * Optional fill-ranking map (table id → rank, lower = filled first) — see
 * booking/ranking.ts. Passed IN so the engine stays pure (no DB). Absent / a
 * missing table both mean DEFAULT_RANK, so the no-config case is unchanged.
 */
export type TableRankMap = Record<string, number>;

/** Default fill rank for a table without an explicit one (kept in sync with
 *  ranking.ts DEFAULT_RANK; duplicated here so this module imports no DB code). */
const DEFAULT_TABLE_RANK = 100;

function rankFor(ranks: TableRankMap | undefined, tableId: string): number {
	const v = ranks?.[tableId];
	return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_TABLE_RANK;
}

/**
 * The shape {@link allocateTables} needs from a staff-configured table chain —
 * its member tables and the covers staff say it seats when combined. Structurally
 * compatible with booking/chains.ts `TableChain`, declared here so this module
 * imports no DB code (the engine stays pure).
 */
export interface TableChainCapacity {
	tableIds: string[];
	/** Authored capacity; 0/absent = derive from the members' seats_max. */
	capacity?: number;
}

/**
 * WHICH tables the engine may combine on its own (booking/autojoin.ts, stored in
 * geisha_settings). Declared here so this module imports no DB code — the engine
 * stays pure. Absent / empty = every table combinable, ad-hoc allowed.
 */
export interface AutoJoinPolicy {
	/** Table ids that must never be auto-joined to another table. */
	excluded?: string[];
	/**
	 * Table ids that may be auto-joined ONLY as part of a registered chain — never
	 * through a chain-derived neighbour pair, a graph-walk run or an ad-hoc
	 * combination. For tables whose owner has written down exactly which joins they
	 * make (Asia's high-sharing counter, 50–54). `excluded` wins over this.
	 */
	chainOnly?: string[];
	/**
	 * Table ids this CHANNEL may not be allocated AT ALL — not on their own, not as
	 * part of any combination. `excluded` and `chainOnly` only restrict COMBINING; a
	 * table listed here is invisible to the allocator, as though it weren't on the
	 * floor. Resolved by `policyFor()`: staff-only tables are unoffered online and
	 * fully available to staff.
	 *
	 * It does NOT make the table unbookable — a host pinning it explicitly is never
	 * touched by this (create.ts validates fit + free on an explicit pick, nothing
	 * else), and an existing booking on it still holds it.
	 */
	notOffered?: string[];
	/** Allow combinations that aren't a registered chain/join. Default true. */
	allowAdHoc?: boolean;
	/**
	 * Never set. The STORED config (autojoin.ts `AutoJoinConfig`) has a `staffOnly`
	 * list that means different things per channel; this makes passing it here
	 * without going through `policyFor(config, channel)` a type error, rather than a
	 * silent "staff-only tables join for everyone".
	 */
	staffOnly?: never;
}

/** Extra allocation inputs that don't change the legacy positional signature. */
export interface AllocateOptions {
	/** Registered chains, preferred over ad-hoc combinations (capacity-aware). */
	chains?: TableChainCapacity[];
	/**
	 * Staff-set automatic-joining policy. A table the owner marked "never
	 * auto-join" is still bookable on its own — it just can't be combined with
	 * anything by the engine, and staff can still join it BY HAND in the diary.
	 */
	autoJoin?: AutoJoinPolicy;
	/**
	 * Allow a LARGE party to be seated across several tables that aren't a
	 * registered join/chain — the ResDiary "table combination" a host would build
	 * by hand for a 19- or 40-cover party. Only ever reached when no single table,
	 * chain or registered join fits, and only for parties bigger than the largest
	 * single bookable table. Defaults to true: without it a restaurant whose
	 * biggest table seats 8 can never take a party of 19, which is the whole point.
	 */
	allowAdHocCombination?: boolean;
}

/** A candidate set of tables, scored so the best combination can be chosen. */
interface Combination {
	ids: string[];
	seats: number;
	rank: number;
}

/**
 * Prefer, in order: FEWEST tables (one party shouldn't be split more than it must),
 * then the TIGHTEST total capacity (don't burn a 40-seat run on a party of 19),
 * then the lowest fill-rank sum (yield management), then a stable id order so the
 * engine is deterministic — availability is computed on every request and must not
 * flap between equally-good answers.
 */
function betterCombination(a: Combination, b: Combination): Combination {
	if (a.ids.length !== b.ids.length) return a.ids.length < b.ids.length ? a : b;
	if (a.seats !== b.seats) return a.seats < b.seats ? a : b;
	if (a.rank !== b.rank) return a.rank < b.rank ? a : b;
	return a.ids.join() <= b.ids.join() ? a : b;
}

/**
 * Greedily build the smallest set of tables from `pool` that seats `partySize`.
 * Largest-first (fewest tables), then a trim pass drops any table the set doesn't
 * actually need — greedy can overshoot (8+8+2 for a party of 16 keeps the 2-top
 * needlessly). Returns null when the whole pool can't seat the party.
 */
function greedyCombination(
	pool: { id: string; seats: number; rank: number }[],
	partySize: number
): Combination | null {
	// largest table first; ties broken by fill rank then id (deterministic)
	const sorted = [...pool].sort(
		(a, b) => b.seats - a.seats || a.rank - b.rank || (a.id < b.id ? -1 : 1)
	);
	const taken: typeof sorted = [];
	let seats = 0;
	for (const t of sorted) {
		if (seats >= partySize) break;
		taken.push(t);
		seats += t.seats;
	}
	if (seats < partySize) return null;
	// Trim: walk the SMALLEST first and drop anything still leaving enough seats.
	for (let i = taken.length - 1; i >= 0; i--) {
		if (seats - taken[i].seats >= partySize) {
			seats -= taken[i].seats;
			taken.splice(i, 1);
		}
	}
	return {
		ids: taken.map((t) => t.id),
		seats,
		rank: taken.reduce((n, t) => n + t.rank, 0)
	};
}

/**
 * Choose the best table (or combination) for a party at a given instant, or null
 * if nothing fits. Strategy, in strict preference order:
 *
 *   1. the smallest single bookable table whose [seats_min, seats_max] fits —
 *      keeps big tables free for big parties;
 *   2. a registered CHAIN (ResDiary "Table Joins") whose AUTHORED capacity fits
 *      and whose every member is free — staff said these tables combine, and said
 *      what they seat when combined;
 *   3. a registered pairwise join whose combined seats fit and both halves free;
 *   4. a longer run reachable through the join/chain graph (3+ tables) — the
 *      adjacency staff configured, walked outward until the party is covered;
 *   5. for a party too big for ANY of the above, an ad-hoc combination of free
 *      tables WITHIN ONE SECTION (then, as a last resort, across sections) — the
 *      combination a host builds by hand for a 19- or 40-cover booking. Without
 *      this a house whose largest table seats 8 can never take a party of 19:
 *      every slot reads "no tables available", which is what it did.
 *
 * Walk-in-only tables (bookable=false) are never auto-allocated at any step, and a
 * table the owner excluded from AUTOMATIC JOINING (`opts.autoJoin.excluded`) is only
 * ever offered on its own — steps 2-5 skip it entirely, so a booth that can't be
 * pushed together is never sold as half of a combination. A CHAIN-ONLY table
 * (`opts.autoJoin.chainOnly`) takes step 2 but skips 3-5: it combines exactly as the
 * registered chains say and no other way. `allowAdHoc: false` drops step 5, leaving
 * only the combinations staff registered (ResDiary's own model).
 *
 * `ranks` (optional, table id → fill rank) controls the ORDER candidates are
 * tried: among tables that fit, a LOWER rank is preferred, then the existing
 * smallest-fit tiebreak. With no ranks the ordering is identical to before.
 */
export function allocateTables(
	startsAt: Date,
	turnMinutes: number,
	partySize: number,
	tables: DiningTable[],
	joins: TableJoin[],
	existing: BookingFootprint[],
	ranks?: TableRankMap,
	opts: AllocateOptions = {}
): string[] | null {
	const startMs = startsAt.getTime();
	const endMs = addMinutes(startsAt, turnMinutes).getTime();

	// Tables this channel may not be given at all (staff-only, resolved by policyFor).
	// Dropped from the pool up front rather than filtered step by step, so EVERY route
	// into a table — single, chain, pairwise join, graph walk, ad-hoc — skips them by
	// construction and no later step can quietly re-admit one. Occupancy is unaffected:
	// `existing` still holds whatever is booked on them.
	const notOffered = new Set(opts.autoJoin?.notOffered ?? []);
	const offerable = notOffered.size ? tables.filter((t) => !notOffered.has(t.id)) : tables;

	const byId = new Map(offerable.map((t) => [t.id, t]));
	const fits = (t: DiningTable) => partySize >= t.seats_min && partySize <= t.seats_max;
	const free = (id: string) => tableFree(id, startMs, endMs, existing);

	// Automatic-joining policy (staff-set, /admin/tables). An excluded table may
	// still be sold on its own (step 1) — it just can't be half of a combination,
	// so every step below filters it out. Absent policy = nothing excluded.
	const noJoin = new Set(opts.autoJoin?.excluded ?? []);
	const joinable = (id: string) => !noJoin.has(id);
	// Chain-only tables may still join, but only through step 2's registered chains —
	// so from step 3 on they are treated exactly like an excluded table.
	const chainOnly = new Set(opts.autoJoin?.chainOnly ?? []);
	const looseJoinable = (id: string) => joinable(id) && !chainOnly.has(id);
	// Only pairs where BOTH halves may auto-join feed the pairwise step AND the
	// graph walk (expandToJoinedSet builds its adjacency from this list), so an
	// excluded table can't be reached as a neighbour either.
	const openJoins =
		noJoin.size || chainOnly.size
			? joins.filter((j) => looseJoinable(j.table_a) && looseJoinable(j.table_b))
			: joins;

	// 1. single table — lowest fill-rank first, then smallest capacity / min for a
	// tight fit. With no ranks every table is DEFAULT_TABLE_RANK so the rank term
	// is a no-op and the original smallest-fit ordering is preserved exactly.
	const singles = offerable
		.filter((t) => t.bookable && fits(t))
		.sort(
			(a, b) =>
				rankFor(ranks, a.id) - rankFor(ranks, b.id) ||
				a.seats_max - b.seats_max ||
				a.seats_min - b.seats_min
		);

	for (const t of singles) {
		if (free(t.id)) return [t.id];
	}

	// 2. registered CHAINS (ResDiary "Table Joins") — staff-authored combinations,
	// capacity-aware. A chain's AUTHORED capacity wins over the raw seats sum (staff
	// may seat a 3-table run at 6 for comfort); capacity 0 falls back to the sum.
	// Every member must be bookable and free, else the chain isn't a candidate.
	//
	// Selection mirrors ResDiary exactly: pick the smallest CAPACITY BAND that holds
	// the party, and within that band honour the configured ORDER — "the join on top
	// of your list will be the first to be sold". So the list is a priority list, not
	// a set the engine is free to re-score.
	const chainCandidates = (opts.chains ?? [])
		.map((ch, index) => {
			// A chain containing a table the owner excluded from auto-joining is dead:
			// the exclusion is the stronger, later statement ("never combine THIS one"),
			// and the Tables editor warns which chains it switches off.
			if (ch.tableIds.some((id) => !joinable(id))) return null;
			const members = ch.tableIds.map((id) => byId.get(id));
			if (members.some((t) => !t || !t.bookable)) return null;
			const rows = members as DiningTable[];
			const seats =
				ch.capacity && ch.capacity > 0 ? ch.capacity : rows.reduce((n, t) => n + t.seats_max, 0);
			if (seats < partySize) return null;
			return { ids: rows.map((t) => t.id), seats, index };
		})
		.filter((x): x is { ids: string[]; seats: number; index: number } => x !== null)
		.sort((a, b) => a.seats - b.seats || a.index - b.index);

	for (const ch of chainCandidates) {
		if (ch.ids.every((id) => free(id))) return ch.ids;
	}

	// 3. registered pairwise joins — combined capacity must fit; both tables bookable
	// and free. Ordered by the pair's combined fill-rank first (the lower of the two
	// halves drives the pair, so a low-ranked table is still seated early as part of a
	// join), then by smallest viable combined capacity — a no-op with no ranks.
	const candidateJoins = openJoins
		.map((j) => {
			const a = byId.get(j.table_a);
			const b = byId.get(j.table_b);
			if (!a || !b || !a.bookable || !b.bookable) return null;
			const combinedMin = a.seats_min + b.seats_min;
			const combinedMax = a.seats_max + b.seats_max;
			if (partySize < combinedMin || partySize > combinedMax) return null;
			const rank = Math.min(rankFor(ranks, a.id), rankFor(ranks, b.id));
			return { a, b, combinedMax, rank };
		})
		.filter(
			(x): x is { a: DiningTable; b: DiningTable; combinedMax: number; rank: number } => x !== null
		)
		.sort((x, y) => x.rank - y.rank || x.combinedMax - y.combinedMax);

	for (const { a, b } of candidateJoins) {
		if (free(a.id) && free(b.id)) return [a.id, b.id];
	}

	// 4. longer runs through the configured join/chain graph. expandToJoinedSet walks
	// outward from a seed over FREE neighbours, so this picks up 3+ table chains that
	// the pairwise step can't express. Seeds are tried in fill-rank order and every
	// resulting run is scored, so the best run wins rather than the first found.
	const seeds = offerable
		.filter((t) => t.bookable && free(t.id) && looseJoinable(t.id))
		.sort((a, b) => rankFor(ranks, a.id) - rankFor(ranks, b.id) || b.seats_max - a.seats_max);
	let bestRun: Combination | null = null;
	for (const seed of seeds) {
		const ids = expandToJoinedSet(seed.id, partySize, offerable, openJoins, free);
		if (ids.length < 2) continue; // a single table was already covered by step 1
		const rows = ids.map((id) => byId.get(id)).filter((t): t is DiningTable => !!t);
		if (rows.length !== ids.length || !rows.every((t) => t.bookable)) continue;
		const seats = rows.reduce((n, t) => n + t.seats_max, 0);
		if (seats < partySize) continue;
		const cand: Combination = {
			ids,
			seats,
			rank: rows.reduce((n, t) => n + rankFor(ranks, t.id), 0)
		};
		bestRun = bestRun ? betterCombination(bestRun, cand) : cand;
	}
	if (bestRun) return bestRun.ids;

	// 5. AD-HOC COMBINATION for a large party (ResDiary's "combine tables"). Only for
	// a party no single table can hold — a small party must never be split across
	// tables just because its ideal table is busy. Prefer a set drawn from ONE section
	// (a party of 19 sits together in one area, not scattered across the room); fall
	// back to the whole floor only when no single section can hold them.
	// Two switches can turn this step off: the caller's `allowAdHocCombination` and
	// the owner's "only sell registered joins" policy (autoJoin.allowAdHoc: false).
	const largestSingle = offerable.reduce((n, t) => (t.bookable ? Math.max(n, t.seats_max) : n), 0);
	if (opts.allowAdHocCombination === false || opts.autoJoin?.allowAdHoc === false) return null;
	if (partySize <= largestSingle) return null;

	const pool = offerable
		.filter((t) => t.bookable && t.seats_max > 0 && free(t.id) && looseJoinable(t.id))
		.map((t) => ({
			id: t.id,
			seats: t.seats_max,
			rank: rankFor(ranks, t.id),
			section: t.section || ''
		}));

	let bestSection: Combination | null = null;
	for (const section of new Set(pool.map((t) => t.section))) {
		const cand = greedyCombination(
			pool.filter((t) => t.section === section),
			partySize
		);
		if (cand) bestSection = bestSection ? betterCombination(bestSection, cand) : cand;
	}
	if (bestSection) return bestSection.ids;

	return greedyCombination(pool, partySize)?.ids ?? null;
}

/**
 * Expand a host's chosen table to the full joined set that should be occupied
 * when a party is seated there (mf-join-seat). Industry-standard combine
 * behaviour: a table combination is one bookable unit, so seating a party that
 * needs the extra covers blocks every member table.
 *
 *   - If the single chosen table already seats the party, return just it (a small
 *     party never drags in its join partner — you don't burn a combo on a 2-top).
 *   - Otherwise walk the registered-join graph outward from the chosen table over
 *     tables that are FREE (per `isFree`), greedily adding the largest free
 *     neighbour each step until the combined seats_max covers the party.
 *   - If the reachable free chain still can't seat the party, return the single
 *     table unchanged — the caller's validation then rejects with a clear message
 *     ("Won't fit — pick another table or a joined pair") rather than silently
 *     seating a party that doesn't fit.
 *
 * Pure + deterministic: `isFree(id)` is supplied by the caller (live floor state).
 * The start table is always included even if isFree(start) is false, because the
 * host explicitly picked it (it may already belong to the booking being moved).
 */
export function expandToJoinedSet(
	startTableId: string,
	partySize: number,
	tables: Pick<DiningTable, 'id' | 'seats_max'>[],
	joins: TableJoin[],
	isFree: (tableId: string) => boolean
): string[] {
	const byId = new Map(tables.map((t) => [t.id, t]));
	const start = byId.get(startTableId);
	if (!start) return [startTableId];
	if (start.seats_max >= partySize) return [startTableId];

	// adjacency from the registered joins
	const adj = new Map<string, Set<string>>();
	for (const j of joins) {
		if (!adj.has(j.table_a)) adj.set(j.table_a, new Set());
		if (!adj.has(j.table_b)) adj.set(j.table_b, new Set());
		adj.get(j.table_a)!.add(j.table_b);
		adj.get(j.table_b)!.add(j.table_a);
	}

	const chosen = [startTableId];
	const inSet = new Set(chosen);
	let seats = start.seats_max;
	// frontier = free neighbours of the current set we haven't taken yet
	while (seats < partySize) {
		const frontier: { id: string; seats: number }[] = [];
		for (const id of inSet) {
			for (const n of adj.get(id) ?? []) {
				if (inSet.has(n)) continue;
				if (!isFree(n)) continue;
				const t = byId.get(n);
				if (t) frontier.push({ id: n, seats: t.seats_max });
			}
		}
		if (!frontier.length) break; // no more reachable free partners
		// take the largest free neighbour to reach capacity in the fewest tables
		frontier.sort((a, b) => b.seats - a.seats);
		const next = frontier[0];
		chosen.push(next.id);
		inSet.add(next.id);
		seats += next.seats;
	}
	return chosen;
}

/**
 * Is a slot inside the bookable horizon? (WP-AVAIL-3)
 *   - never already GONE — a slot whose start has passed can't be booked at all;
 *   - not sooner than now + leadMin minutes (minimum lead / same-day cutoff);
 *   - not later  than now + windowDays days (forward booking window).
 *
 * The past floor is UNCONDITIONAL and does not depend on `leadMin`. Both venues
 * run with `lead_time_minutes` unset (= 0), which used to disable the whole lead
 * branch — so at 7:35pm the site still offered, and accepted, "today at 12:00".
 * A lead time is a POLICY ("not within 2 hours of service"); the clock is
 * PHYSICS. `windowDays <= 0` disables the forward cap; `leadMin <= 0` disables
 * only the policy lead. Pure: `nowMs` is passed in, never read from the clock.
 */
export function withinBookingHorizon(
	slotStartMs: number,
	nowMs: number,
	leadMin: number,
	windowDays: number
): boolean {
	if (slotStartMs < nowMs) return false;
	if (leadMin > 0 && slotStartMs < nowMs + leadMin * 60_000) return false;
	if (windowDays > 0 && slotStartMs > nowMs + windowDays * 86_400_000) return false;
	return true;
}

/**
 * Average dining time per table, scaled by party size (the house turn-time rules):
 *   1–2 people → 90 min
 *   3 people   → 105 min
 *   4–5 people → 120 min
 *   6+ people  → 150 min
 * These are the authoritative turn times — they drive both the booking's `ends_at`
 * and how long it holds a table for availability. The `period` is kept in the
 * signature (callers pass it) but the ladder is fixed; `default_turn_minutes` is
 * no longer consulted so the rule is consistent across every service period.
 */
export function turnMinutesFor(partySize: number, _period: ServicePeriod): number {
	if (partySize <= 2) return 90;
	if (partySize === 3) return 105;
	if (partySize <= 5) return 120;
	return 150;
}

/**
 * The longest a single sitting may be held for, and the margin every occupancy
 * re-check reads around a booking's start. Staff may extend a sitting for as
 * long as they like (a private hire can hold a table the whole service), so the
 * cap is a full service day rather than a turn-time ceiling. The occupancy
 * margin MUST be >= this cap: a booking starting `margin` minutes before ours
 * and running up to `MAX_SITTING_MIN` long has to fall inside the read window
 * or the clash check would miss it. Keep the two equal.
 */
export const MAX_SITTING_MIN = 720;
export const OCCUPANCY_MARGIN_MIN = MAX_SITTING_MIN;

// --- the main entry point ---------------------------------------------------

/**
 * Compute bookable slots for a brand on a given date for a given party size.
 * Returns every candidate slot flagged available/unavailable, plus a
 * `requiresPhone` flag when the party exceeds the online cap.
 */
export function checkAvailability(input: AvailabilityInput): AvailabilityResult {
	const {
		date,
		partySize,
		timezone,
		periods,
		tables,
		joins,
		chains = [],
		autoJoin,
		existing,
		closures = [],
		pacing = [],
		tableRanks,
		onlinePartyMax = 30,
		slotIntervalMinutes = 15,
		nowMs,
		bookingWindowDays = 0,
		leadTimeMinutes = 0,
		leadTimeMode = 'visit'
	} = input;

	const bookingWindow = { leadMinutes: leadTimeMinutes, windowDays: bookingWindowDays };

	if (partySize > onlinePartyMax) {
		return { slots: [], requiresPhone: true, bookingWindow, noSlotsReason: 'party_too_large' };
	}
	if (partySize < 1) {
		return { slots: [], requiresPhone: false, bookingWindow, noSlotsReason: 'invalid_party' };
	}

	// Whole date closed (holiday / private hire / maintenance) — no slots at all.
	if (isDateClosed(date, closures)) {
		return {
			slots: [],
			requiresPhone: false,
			closed: true,
			closureReason: closureReasonFor(date, closures),
			bookingWindow,
			noSlotsReason: 'closed'
		};
	}

	const dow = dayOfWeek(date, timezone);
	const activePeriods = periods.filter((p) => p.active && p.days_of_week?.includes(dow));

	// Section close-outs (diary "CloseOuts" grid): treat every table in a closed
	// section as occupied for its service window, so the allocator naturally skips it.
	const closeoutFootprints = sectionCloseoutFootprints(
		date,
		timezone,
		activePeriods,
		tables,
		closures
	);
	const occupied = closeoutFootprints.length ? [...existing, ...closeoutFootprints] : existing;

	const slots: Slot[] = [];

	for (const period of activePeriods) {
		// Skip a service period closed on this date (period-scoped blackout).
		if (isPeriodClosed(date, period.id, closures)) continue;

		const turn = turnMinutesFor(partySize, period);
		const firstSlot = parseHHmm(date, period.start_time, timezone);
		const lastSlot = parseHHmm(date, period.last_booking_time, timezone);

		// Resolve the pacing rule (covers caps) once per period (WP-AVAIL-1). The
		// most-specific rule for this period + day-of-week wins; null = uncapped.
		const rule = selectPacingRule(period.id, dow, pacing);
		// Period window for the per-period covers cap: from the first slot to the
		// service close (end_time), compared as epoch ms so it stays DST-correct.
		const periodStartMs = firstSlot.getTime();
		const periodEndMs = parseHHmm(date, period.end_time, timezone).getTime();

		for (
			let t = firstSlot;
			t.getTime() <= lastSlot.getTime();
			t = addMinutes(t, slotIntervalMinutes)
		) {
			const slotMs = t.getTime();
			// Horizon check (only when a request instant was supplied). A slot must
			// be both far enough ahead (lead time) and within the forward window.
			let reason: Slot['unavailableReason'] | undefined;
			if (nowMs != null) {
				// A slot that has ALREADY STARTED is gone, whatever the lead-time policy
				// says — see withinBookingHorizon. Checked first and unconditionally so a
				// venue running with no lead time (both of ours do) still can't sell
				// "today at 12:00" at half seven in the evening.
				//
				// Then the staff-set cut-off, measured against whichever anchor the owner
				// chose: the guest's own time ('visit', a rolling cut-off) or the start of
				// the service ('service', a cliff that shuts the whole sitting at once).
				const cutoffAnchorMs = leadTimeMode === 'service' ? periodStartMs : slotMs;
				if (slotMs < nowMs) {
					reason = 'too_soon';
				} else if (leadTimeMinutes > 0 && cutoffAnchorMs < nowMs + leadTimeMinutes * 60_000) {
					reason = 'too_soon';
				} else if (bookingWindowDays > 0 && slotMs > nowMs + bookingWindowDays * 86_400_000) {
					reason = 'beyond_window';
				}
			}

			// Table allocation (skipped once the slot is already ruled out by horizon).
			const tableIds = reason
				? null
				: allocateTables(t, turn, partySize, tables, joins, occupied, tableRanks, {
						chains,
						autoJoin
					});
			if (!reason && tableIds === null) reason = 'full';

			// Pacing caps (WP-AVAIL-1): only meaningful when a table could be seated.
			// A physical "full" reason takes precedence in the message.
			if (!reason) {
				if (!slotWithinSlotCap(rule, slotMs, slotIntervalMinutes, partySize, existing)) {
					reason = 'slot_cap';
				} else if (!withinPeriodCap(rule, periodStartMs, periodEndMs, partySize, existing)) {
					reason = 'period_cap';
				}
			}

			const available = reason === undefined;
			slots.push({
				time: formatLocalHHmm(t, timezone),
				startsAt: t,
				available,
				tableIds: available ? (tableIds ?? undefined) : undefined,
				unavailableReason: reason
			});
		}
	}

	// de-dupe identical times across overlapping periods, keep the available one
	const byTime = new Map<string, Slot>();
	for (const s of slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
		const prev = byTime.get(s.time);
		if (!prev || (!prev.available && s.available)) byTime.set(s.time, s);
	}

	const out = [...byTime.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

	// WHY there is nothing to book, when there is nothing to book.
	//
	// Only a FULL-day closure short-circuits at the top of this function. A
	// period-scope blackout merely skips its loop iteration, and a close-out (one
	// table, a section, or the whole-restaurant '*' sentinel) arrives as synthetic
	// occupancy — so a date shut by either came back indistinguishable from a
	// genuinely busy one: "nothing free, try another time/area". The host who meant
	// to take a Christmas reservation on it was left with no way forward, which
	// reads as a missing permission. It never was one: staff have always been able
	// to book a closed day (createBooking's `allowClosed`) — they just had nothing
	// to click. Saying "closed" here is what lets the caller offer that override.
	//
	// The test is: would lifting this date's closures have produced anything? Re-run
	// the engine closure-free and see. That is the honest question, and unlike any
	// "are there closure rows on this date?" shortcut it cannot mistake a full house
	// for a shut one — a fully-booked night with an unrelated table close-out on it
	// keeps reporting a full house. Recursion terminates: the inner call passes no
	// closures, so `onDate` is empty and it never re-enters this branch.
	const onDate = activeClosuresFor(date, closures);
	if (activePeriods.length && onDate.length && !out.some((s) => s.available)) {
		const lifted = checkAvailability({ ...input, closures: [] });
		if (lifted.slots.some((s) => s.available)) {
			return {
				slots: [],
				requiresPhone: false,
				closed: true,
				closureReason: closureReasonFor(date, closures),
				bookingWindow,
				noSlotsReason: 'closed'
			};
		}
	}

	return {
		slots: out,
		requiresPhone: false,
		bookingWindow,
		// Nothing generated at all means no service period covers this weekday (or
		// every one of them is closed) — a rota fact, not a full restaurant. Say so.
		...(out.length === 0 ? { noSlotsReason: 'no_service' as const } : {})
	};
}

/** Format an absolute instant as local 'HH:mm' in the given timezone. */
function formatLocalHHmm(instant: Date, timezone: string): string {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: timezone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(instant);
	const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
	return `${hh}:${mm}`;
}
