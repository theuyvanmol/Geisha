// Diary "make room" reshuffle (owner request).
//
// When a host drops a booking on a table/time that's already taken, the old diary just said
// "won't fit here". This computes a plan that seats it there anyway by RE-SEATING the other
// bookings it displaces onto free tables — then the caller applies the whole thing atomically.
//
// ── ResDiary parity ─────────────────────────────────────────────────────────────────────
// ResDiary's documented behaviour on a conflict is "unallocate → reseat to the NEXT-BEST free
// table, chosen by your table RANKINGS" (help-resdiary: "Un-allocate & re-seat bookings"). That
// is a ONE-LEVEL reseat, not a whole-service re-optimise — so this deliberately re-tables only
// the bookings the drop DIRECTLY displaces, each onto the best free table via allocateTables()
// (which already honours geisha_table_ranks). We do NOT bump bookings that didn't need to move,
// which keeps the result predictable ("to seat X here, move Y to T4") and matches ResDiary.
//
// Never moved: SEATED / COMPLETED parties (physically there or done). If one blocks the target,
// the reshuffle fails with a clear reason and the diary keeps the plain "won't fit" message.
// Close-outs are respected exactly as amendBooking / applyBookingBatch model them, so a plan is
// never proposed that the atomic apply would then reject.

import { fromZonedTime } from 'date-fns-tz';
import type { BrandId, DiningTable, TableJoin } from '../db/types.js';
import { getRestaurant, getActivePeriods, getTables, getJoins, getClosures } from './queries.js';
import { getTableRanksById } from './ranking.js';
import { getBookingsForDay } from './admin.js';
import { allocateTables, sectionCloseoutFootprints } from './availability.js';
import type { AutoJoinPolicy, BookingFootprint, TableRankMap } from './availability.js';
import { getAutoJoinByRestaurant, policyFor } from './autojoin.js';
import { isPeriodClosed } from './closures.js';
import type { BatchEntry } from './amend.js';

/** Statuses physically holding a table that we must never move (a party sitting there, or a
 *  finished sitting). */
const PINNED = new Set(['seated', 'completed']);
/** Forward-looking bookings we're allowed to re-table to make room. */
const MOVABLE = new Set(['confirmed', 'pending_payment']);

/** One booking the reshuffle proposes to re-table (for the confirm UI + the batch). */
export interface ReshuffleMoveItem {
	bookingId: string;
	guestName: string;
	time: string; // HH:mm local
	fromTables: string[];
	toTables: string[];
	fromLabel: string;
	toLabel: string;
}

export interface ReshufflePlan {
	ok: boolean;
	/** Why a reshuffle isn't possible (a seated party blocks it, or nothing's free). */
	reason?: string;
	/** The OTHER bookings that move to free the spot (empty ⇒ the plain move already fits). */
	moves: ReshuffleMoveItem[];
}

export interface ReshuffleInput {
	brand: BrandId;
	date: string; // 'YYYY-MM-DD'
	time: string; // 'HH:mm' — where the dragged booking now starts
	draggedId: string;
	targetTableIds: string[];
	/** Explicit sitting length (drag also resized). Omit to preserve the booking's length. */
	durationMinutes?: number;
}

/** The minimal, DB-free shape the pure planner reasons about. */
export interface PlanBooking {
	id: string;
	party: number;
	startMs: number;
	endMs: number;
	tables: string[];
	status: string;
	name: string;
}

/** Everything the pure planner needs, with all IO already done. */
export interface ReshuffleCoreArgs {
	tables: DiningTable[];
	joins: TableJoin[];
	ranks: TableRankMap;
	/**
	 * Automatic-joining policy (booking/autojoin.ts) — a reshuffle RE-ALLOCATES the
	 * bookings it displaces, so it must respect the same "these tables never combine"
	 * rule the booking engine does. Absent = nothing excluded.
	 */
	autoJoin?: AutoJoinPolicy;
	/** Section/table/time-slot close-outs, as occupancy footprints. */
	closeoutFootprints: BookingFootprint[];
	/** Every live booking for the day (including the dragged one). */
	bookings: PlanBooking[];
	draggedId: string;
	targetTableIds: string[];
	startMs: number;
	endMs: number;
	/** Render helpers (kept out of the core so it stays timezone/format agnostic). */
	label: (ids: string[]) => string;
	hhmm: (ms: number) => string;
}

const overlaps = (aS: number, aE: number, bS: number, bE: number): boolean => aS < bE && bS < aE;
const ms = (v: Date | string): number => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/**
 * PURE core of the reshuffle (no DB, no clock) so it's unit-testable. Given the day's bookings
 * + tables, decide which bookings the dragged one displaces and where each is reseated. Returns
 * `{ ok, moves }`; `moves` EXCLUDES the dragged booking (the caller adds that leg). `ok:false`
 * with a reason when a seated party blocks the spot, the target is closed/too small, or a
 * displaced booking has no free table.
 */
export function planReshuffleCore(args: ReshuffleCoreArgs): ReshufflePlan {
	const { tables, joins, ranks, autoJoin, closeoutFootprints, bookings, draggedId, targetTableIds, startMs, endMs, label, hhmm } = args;
	const byId = new Map(tables.map((t) => [t.id, t]));
	const targetSet = new Set(targetTableIds);

	const dragged = bookings.find((b) => b.id === draggedId);
	if (!dragged) return { ok: false, reason: 'That booking is no longer in service.', moves: [] };

	// The batch applier enforces seats-fit, so don't propose a reshuffle it will reject: if the
	// party is too big for the target table(s), fail up front (a plain drag can still overfill).
	const targetSeats = targetTableIds.reduce((n, id) => n + (byId.get(id)?.seats_max ?? 0), 0);
	if (targetSeats > 0 && dragged.party > targetSeats) {
		return {
			ok: false,
			reason: `${label(targetTableIds)} seats ${targetSeats} — too small for a party of ${dragged.party}.`,
			moves: []
		};
	}

	// The drop target must not itself be closed out at that time.
	const targetBlocked = closeoutFootprints.some(
		(f) => f.tableIds.some((t) => targetSet.has(t)) && overlaps(startMs, endMs, ms(f.startsAt), ms(f.endsAt))
	);
	if (targetBlocked) {
		return { ok: false, reason: `${label(targetTableIds)} is closed out at that time.`, moves: [] };
	}

	// Live bookings that hold a table (skip cancelled/no-show and the dragged one).
	const live = bookings.filter((b) => b.id !== draggedId && (PINNED.has(b.status) || MOVABLE.has(b.status)));

	// The reservation grid re-allocation validates against: the dragged booking pinned where it
	// was dropped, plus every close-out footprint (so a displaced booking never re-homes onto a
	// closed table).
	const reserved: BookingFootprint[] = [
		{ tableIds: targetTableIds, startsAt: new Date(startMs), endsAt: new Date(endMs) },
		...closeoutFootprints
	];

	// Split into bookings the dragged one DISPLACES (share a target table AND overlap its window)
	// and those that keep their tables (reserved so nothing re-homes onto them).
	const displaced: PlanBooking[] = [];
	for (const b of live) {
		const clashes = b.tables.some((t) => targetSet.has(t)) && overlaps(startMs, endMs, b.startMs, b.endMs);
		if (!clashes) {
			reserved.push({ tableIds: b.tables, startsAt: new Date(b.startMs), endsAt: new Date(b.endMs), partySize: b.party });
			continue;
		}
		if (PINNED.has(b.status)) {
			const on = label(b.tables.filter((t) => targetSet.has(t)));
			return { ok: false, reason: `${b.name} is already on ${on} — they can't be moved.`, moves: [] };
		}
		displaced.push(b);
	}

	if (!displaced.length) return { ok: true, moves: [] };

	// Reseat each displaced booking (biggest party first — hardest to place) to the next-best free
	// table by rankings. If any has nowhere to go, the whole reshuffle is impossible — fail cleanly
	// (all-or-nothing, so nothing half-applies).
	displaced.sort((a, b) => b.party - a.party || a.startMs - b.startMs);
	const moves: ReshuffleMoveItem[] = [];
	for (const b of displaced) {
		const bLen = Math.round((b.endMs - b.startMs) / 60_000) || 120;
		const alloc = allocateTables(new Date(b.startMs), bLen, b.party, tables, joins, reserved, ranks, {
			autoJoin
		});
		if (!alloc) {
			return {
				ok: false,
				reason: `No free table for ${b.name} (party ${b.party}) at ${hhmm(b.startMs)} — can't make room.`,
				moves: []
			};
		}
		reserved.push({ tableIds: alloc, startsAt: new Date(b.startMs), endsAt: new Date(b.endMs), partySize: b.party });
		moves.push({
			bookingId: b.id,
			guestName: b.name,
			time: hhmm(b.startMs),
			fromTables: b.tables,
			toTables: alloc,
			fromLabel: label(b.tables),
			toLabel: label(alloc)
		});
	}

	return { ok: true, moves };
}

/**
 * Load the day's data and compute a reshuffle plan to seat `draggedId` on `targetTableIds` at
 * `time`. Thin IO wrapper around {@link planReshuffleCore}.
 */
export async function planReshuffleForMove(input: ReshuffleInput): Promise<ReshufflePlan> {
	const restaurant = await getRestaurant(input.brand);
	const tz = restaurant.timezone || 'Europe/London';
	const [periods, tables, joins, ranks, autoJoin, bookings, closures] = await Promise.all([
		getActivePeriods(restaurant.id),
		getTables(restaurant.id),
		getJoins(restaurant.id),
		getTableRanksById(restaurant.id),
		// reseating a displaced booking is auto-allocation, so it obeys the same
		// "these tables never combine" policy as a fresh booking
		getAutoJoinByRestaurant(restaurant.id),
		getBookingsForDay(input.brand, input.date),
		getClosures(restaurant.id, input.date, input.date)
	]);

	const byId = new Map(tables.map((t) => [t.id, t]));
	const label = (ids: string[]) => ids.map((id) => byId.get(id)?.label ?? id).join('+') || '—';
	const hhmm = (msVal: number) =>
		new Date(msVal).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });

	const dragged = bookings.find((b) => b.id === input.draggedId);
	if (!dragged) return { ok: false, reason: 'That booking is no longer in service.', moves: [] };

	const startMs = fromZonedTime(`${input.date}T${input.time}:00`, tz).getTime();
	if (!Number.isFinite(startMs)) return { ok: false, reason: 'Invalid drop time.', moves: [] };
	const curLen = Math.round((new Date(dragged.ends_at).getTime() - new Date(dragged.starts_at).getTime()) / 60_000);
	const dur = input.durationMinutes && input.durationMinutes >= 15 ? Math.round(input.durationMinutes) : curLen >= 15 ? curLen : 120;
	const endMs = startMs + dur * 60_000;

	// A whole service / day closed at the drop instant blocks the move outright (same as amend).
	const dropPeriod = periods.find((p) => {
		const openMs = fromZonedTime(`${input.date}T${p.start_time}:00`, tz).getTime();
		const lastMs = fromZonedTime(`${input.date}T${p.last_booking_time || p.end_time}:00`, tz).getTime();
		return startMs >= openMs && startMs <= lastMs;
	});
	if (dropPeriod && isPeriodClosed(input.date, dropPeriod.id, closures)) {
		return { ok: false, reason: 'That service is closed for bookings.', moves: [] };
	}

	const closeoutFootprints = sectionCloseoutFootprints(input.date, tz, periods, tables, closures);
	const planBookings: PlanBooking[] = bookings.map((b) => ({
		id: b.id,
		party: b.party_size,
		startMs: new Date(b.starts_at).getTime(),
		endMs: new Date(b.ends_at).getTime(),
		tables: (b.tables ?? []).filter(Boolean),
		status: b.status,
		name: b.expand?.customer?.name || 'Booking'
	}));

	return planReshuffleCore({
		tables,
		joins,
		ranks,
		// a diary drag is a host's move, so the staff rules apply
		autoJoin: policyFor(autoJoin, 'staff'),
		closeoutFootprints,
		bookings: planBookings,
		draggedId: input.draggedId,
		targetTableIds: input.targetTableIds,
		startMs,
		endMs,
		label,
		hhmm
	});
}

/** Build the atomic batch that applies a reshuffle: the dragged booking to its dropped
 *  table/time, plus every displaced booking to its new table (each keeps its own time). */
export function reshuffleBatchEntries(
	dragged: { bookingId: string; date: string; time: string; tableIds: string[]; durationMinutes?: number },
	plan: ReshufflePlan
): BatchEntry[] {
	const entries: BatchEntry[] = [
		{
			bookingId: dragged.bookingId,
			date: dragged.date,
			time: dragged.time,
			tableIds: dragged.tableIds,
			...(dragged.durationMinutes ? { durationMinutes: dragged.durationMinutes } : {})
		}
	];
	for (const m of plan.moves) {
		entries.push({ bookingId: m.bookingId, tableIds: m.toTables });
	}
	return entries;
}
