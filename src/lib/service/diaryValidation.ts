// Pure move/swap validation for the diary (instant-commit rewrite).
//
// The gesture handlers need to answer, on every drag-move and on drop, "can this booking go
// here?" — WITHOUT reading the legacy `tl` timeline. These pure functions operate on the
// store's projected rows (occupants) + scaffold (table capacity), so validation moves off tl
// onto the single-owner store and becomes unit-testable.
//
// Rules mirror the legacy checks exactly:
//   • MOVE: a drop is valid iff its window doesn't OVERLAP another booking on the TARGET row
//     (excluding the moving booking itself). Oversize (party > seatsMax) is NOT a block and NOT
//     a shrink — the party is seated as-is and flagged over-capacity. Off-grid: caller's job.
//   • SWAP (honor-drop: the DRAGGED booking lands at the DROPPED time on the partner's table,
//     keeping its own length; the PARTNER keeps its OWN time and only changes table): valid iff
//     neither NEW window clashes with a THIRD booking on its destination row (both swap
//     participants excluded). Same-table + same-time is not a swap. temp- bars are never
//     treated as a blocking third booking (the server can't see an un-created walk-in).

import type { DiarySection } from '$lib/server/booking/admin';

/** The minimal bar fields validation needs. */
export interface OccupantBar {
	bookingId: string;
	startMin: number;
	endMin: number;
	movable?: boolean;
}

/** A scaffold row (or any row) carrying table id + capacity. */
export interface CapRow {
	tableId: string;
	seatsMax: number;
}

const overlaps = (aS: number, aE: number, bS: number, bE: number): boolean => aS < bE && bS < aE;
const isTemp = (id: string): boolean => id.startsWith('temp-');

/** All bars currently on `tableId` across the given sections. */
export function occupantsOf(sections: DiarySection[], tableId: string): OccupantBar[] {
	for (const sec of sections)
		for (const row of sec.rows) if (row.tableId === tableId) return row.bars as OccupantBar[];
	return [];
}

/** Table capacity from the scaffold rows (0 if the table isn't found). */
export function seatsMaxOf(rows: CapRow[], tableId: string): number {
	return rows.find((r) => r.tableId === tableId)?.seatsMax ?? 0;
}

/**
 * The seats the WHOLE table set a booking sits on is rated for — the sum across a
 * pushed-together combination, not just one row. The '__unassigned__' placeholder is
 * not a table and contributes nothing.
 *
 * Returns 0 ("unknown") when ANY named table is missing from the rows, because a
 * partial sum under-reports the combination and would warn about a party that
 * actually fits. `isOverCapacity` never flags on 0, so unknown stays silent.
 */
export function seatsAcross(rows: CapRow[], tableIds: string[]): number {
	let total = 0;
	for (const id of tableIds) {
		if (!id || id === '__unassigned__') continue;
		const row = rows.find((r) => r.tableId === id);
		if (!row) return 0; // unknown table → unknown combination
		total += row.seatsMax;
	}
	return total;
}

/**
 * Is a party too big for the seats it's sitting on? A move/swap onto a small table is ALLOWED
 * (the host decides whether the party squeezes in) and the covers are NEVER reduced — so the
 * diary flags the booking over-capacity instead. Unknown capacity (seatsMax 0 = table not
 * found) never flags: we don't cry wolf on a guess.
 */
export function isOverCapacity(party: number, seatsMax: number): boolean {
	return seatsMax > 0 && party > seatsMax;
}

/**
 * MOVE validity: can a booking occupy `[startMin, endMin)` on `tableId` without overlapping a
 * DIFFERENT booking already there? Overlap is the only hard block (oversize → shrink, handled
 * by the caller). Temp bars DO count as occupants for a plain move (a still-pending walk-in
 * physically holds that cell on the board). Returns true if the placement is clear.
 */
export function canPlace(
	sections: DiarySection[],
	tableId: string,
	startMin: number,
	endMin: number,
	exceptId: string
): boolean {
	return !occupantsOf(sections, tableId).some(
		(b) => b.bookingId !== exceptId && overlaps(startMin, endMin, b.startMin, b.endMin)
	);
}

/** The two NEW windows a swap produces. Cross-table (honor-drop): the DRAGGED booking lands at
 *  `droppedStart` (where the host let go) keeping its OWN length; the PARTNER keeps its OWN time.
 *  Same-table (positional): the two TRADE starts — the only collision-free move on one row. */
export function swapWindows(
	dragged: { startMin: number; endMin: number },
	partner: { startMin: number; endMin: number },
	droppedStart: number,
	sameTable: boolean
): { dragged: { startMin: number; endMin: number }; partner: { startMin: number; endMin: number } } {
	const lenD = dragged.endMin - dragged.startMin;
	const lenP = partner.endMin - partner.startMin;
	if (sameTable) {
		return {
			dragged: { startMin: partner.startMin, endMin: partner.startMin + lenD },
			partner: { startMin: dragged.startMin, endMin: dragged.startMin + lenP }
		};
	}
	return {
		dragged: { startMin: droppedStart, endMin: droppedStart + lenD },
		partner: { startMin: partner.startMin, endMin: partner.endMin }
	};
}

/** The first booking on `tableId` whose window overlaps `[startMin, endMin)`, EXCLUDING the two
 *  swap participants (they're trading places) and any temp- bar. Null if none. */
export function rowClashExcluding(
	sections: DiarySection[],
	tableId: string,
	startMin: number,
	endMin: number,
	exceptA: string,
	exceptB: string
): OccupantBar | null {
	return (
		occupantsOf(sections, tableId).find(
			(b) =>
				b.bookingId !== exceptA &&
				b.bookingId !== exceptB &&
				!isTemp(b.bookingId) &&
				overlaps(startMin, endMin, b.startMin, b.endMin)
		) ?? null
	);
}

/**
 * SWAP validity: dragged (on `fromTableId`) dropped at `droppedStart` onto `partner` (on
 * `partnerTableId`). Valid iff it's a real swap (not same-table+same-time), the partner is
 * movable, and NEITHER booking's new window (dragged at the dropped time, partner at its own
 * time) clashes with a THIRD booking on its destination row. Returns the blocking bar (with which
 * side) when invalid, or null when the swap is allowed.
 */
export function canSwap(
	sections: DiarySection[],
	dragged: OccupantBar,
	fromTableId: string,
	partner: OccupantBar,
	partnerTableId: string,
	droppedStart: number
): { ok: true } | { ok: false; blocker: OccupantBar | null; reason: 'same-slot' | 'immovable' | 'clash' } {
	if (partner.bookingId === dragged.bookingId) return { ok: false, blocker: null, reason: 'same-slot' };
	if (partner.movable === false) return { ok: false, blocker: null, reason: 'immovable' };
	if (partnerTableId === fromTableId && partner.startMin === dragged.startMin)
		return { ok: false, blocker: null, reason: 'same-slot' };
	const w = swapWindows(dragged, partner, droppedStart, partnerTableId === fromTableId);
	const dClash = rowClashExcluding(
		sections,
		partnerTableId,
		w.dragged.startMin,
		w.dragged.endMin,
		dragged.bookingId,
		partner.bookingId
	);
	if (dClash) return { ok: false, blocker: dClash, reason: 'clash' };
	const pClash = rowClashExcluding(
		sections,
		fromTableId,
		w.partner.startMin,
		w.partner.endMin,
		dragged.bookingId,
		partner.bookingId
	);
	if (pClash) return { ok: false, blocker: pClash, reason: 'clash' };
	return { ok: true };
}
