// Where a booking's WHOLE table set lands when its bar is dragged (owner bug: "bookings can
// stretch between multiple tables — when I move one it shrinks to just one table").
//
// THE PROBLEM. A joined party is ONE booking holding N tables, drawn as one block but stored
// as one bar per table. The diary's drag sent only the row the host dropped on, so
// amendBooking pinned that single table and the party silently collapsed from four tables to
// one — covers unchanged, so the board then showed a party of 10 on a 2-top.
//
// THE RULE. The set keeps its SIZE and its SHAPE: it is SHIFTED along the board's row order by
// the delta between the row the bar was grabbed from and the row it was dropped on. Dropping a
// two-table party one row down puts it on the next two rows; dropping it back on its own row
// (delta 0) is a pure re-time and keeps exactly the same tables.
//
// REFUSED (null — the caller treats it as an invalid drop):
//   • the shift would run off the end of the board (no row to hold one of the tables);
//   • it would split a party that sits in ONE section across two — tables in different
//     sections aren't pushed together, so that "join" would be a fiction.
//
// PURE (no $state, no DOM), like barLanes.ts / joinBlocks.ts — unit-tested.

/** The board's table rows in display order (the unassigned holding row excluded), plus which
 *  section each belongs to. Both come straight off the rendered board. */
export interface RowOrder {
	/** tableIds in display order. */
	order: string[];
	/** tableId → section name. A table missing here is treated as its own section. */
	sectionOf: (tableId: string) => string | null;
}

/**
 * The destination table set for a drag, or null when the move can't be honoured.
 *
 * @param current  every table the booking currently holds, in board-row order
 * @param fromTableId  the row the bar was grabbed from (the set's anchor)
 * @param toTableId    the row it was dropped on
 */
export function shiftTableSet(
	current: string[],
	fromTableId: string,
	toTableId: string,
	rows: RowOrder
): string[] | null {
	// A plain (single-table) booking simply lands on the target row — nothing to keep together.
	if (current.length < 2) return [toTableId];
	// Re-time only: the party stays exactly where it is, on all of its tables.
	if (toTableId === fromTableId) return [...current];

	const { order, sectionOf } = rows;
	const from = order.indexOf(fromTableId);
	const to = order.indexOf(toTableId);
	if (from < 0 || to < 0) return null;
	const delta = to - from;

	const dest: string[] = [];
	for (const t of current) {
		const i = order.indexOf(t);
		if (i < 0) return null; // a table the board no longer lists — can't place the set
		const next = order[i + delta];
		if (!next) return null; // shifted off the end of the board
		dest.push(next);
	}

	// Keep a one-section party in one section (see the note at the top). A party already
	// spread across sections isn't held to a rule it's already breaking.
	const srcSections = new Set(current.map(sectionOf));
	if (srcSections.size === 1 && new Set(dest.map(sectionOf)).size !== 1) return null;

	return dest;
}

/**
 * Where each of two bookings lands when one is dropped onto the other — a SWAP.
 *
 * A swap is the two parties trading PLACES, and each keeps its own number of tables. With
 * the same count that is simply an exchange of the two sets. With different counts it used
 * to be an exchange too, which moved the tables with it: a 14 joined across two tables and an
 * 8 on one (Asia, 2026-09-11) came out as the 14 on the single 8-top and the 8 on both — an
 * over-capacity warning and a layout the host then had to fix by hand. Instead the two blocks
 * trade places on the board, shapes kept: the lower block moves up to start where the upper
 * one started, and the upper block moves down to end where the lower one ended. Side by side
 * that just swaps their order within the same rows (8 on T2 + 14 on T3–T4 → 14 on T2–T3, 8 on
 * T4); apart, each lands where the other was.
 *
 * Null — an invalid drop — when that runs off the board, splits a one-section party across two
 * sections, puts the two on a common table, or the parties already share a table (different
 * sizes on overlapping sets have no clean trade). A pair on the SAME set is the caller's
 * positional time-trade and never gets here.
 */
export function swapTableSets(
	dragged: string[],
	partner: string[],
	rows: RowOrder
): { dragged: string[]; partner: string[] } | null {
	if (dragged.length === partner.length) return { dragged: [...partner], partner: [...dragged] };
	if (dragged.some((t) => partner.includes(t))) return null;

	const { order, sectionOf } = rows;
	const di = dragged.map((t) => order.indexOf(t));
	const pi = partner.map((t) => order.indexOf(t));
	if (di.includes(-1) || pi.includes(-1)) return null;

	const draggedIsUpper = Math.min(...di) < Math.min(...pi);
	const [upper, lower] = draggedIsUpper ? [di, pi] : [pi, di];
	const shift = (set: number[], delta: number) => set.map((i) => i + delta);
	const newLower = shift(lower, Math.min(...upper) - Math.min(...lower));
	const newUpper = shift(upper, Math.max(...lower) - Math.max(...upper));

	if ([...newLower, ...newUpper].some((i) => i < 0 || i >= order.length)) return null;
	if (newLower.some((i) => newUpper.includes(i))) return null;
	// Same section rule as a drag (see shiftTableSet).
	const keepsSection = (from: number[], to: number[]) =>
		new Set(from.map((i) => sectionOf(order[i]))).size !== 1 ||
		new Set(to.map((i) => sectionOf(order[i]))).size === 1;
	if (!keepsSection(lower, newLower) || !keepsSection(upper, newUpper)) return null;

	const ids = (set: number[]) => set.map((i) => order[i]);
	return draggedIsUpper
		? { dragged: ids(newUpper), partner: ids(newLower) }
		: { dragged: ids(newLower), partner: ids(newUpper) };
}

/**
 * Every table set a dragged booking may land on, best first. The diary takes the first one
 * that's free at the dropped time.
 *
 * Staff put a booking wherever they want (owner, 2026-10-02: a 5 joined on 41+42 dropped onto
 * table 27, a 6-top on the last row of its section, was flatly refused because the two-table
 * block had no second row to go to). So the shifted block comes first, and the table the bar
 * was dropped on, on its own, is the fallback — a too-small one gets the over-capacity confirm,
 * not a refusal. A re-time on the party's own row never falls back: that would quietly shrink
 * the party to one table, the bug shiftTableSet exists to stop.
 */
export function moveCandidates(
	current: string[],
	fromTableId: string,
	toTableId: string,
	rows: RowOrder
): string[][] {
	const block = shiftTableSet(current, fromTableId, toTableId, rows);
	const out: string[][] = block ? [block] : [];
	if (toTableId !== fromTableId && !(block && sameTableSet(block, [toTableId]))) {
		out.push([toTableId]);
	}
	return out;
}

/**
 * Every way two bookings may trade places, best first: the in-place trade (each keeps its own
 * number of tables — swapTableSets), then a straight exchange of the two sets. The diary takes
 * the first that's free. Without the exchange, a joined party dropped onto a single table at the
 * end of a section had no swap at all (owner, 2026-10-02).
 */
export function swapCandidates(
	dragged: string[],
	partner: string[],
	rows: RowOrder
): { dragged: string[]; partner: string[] }[] {
	const exchange = { dragged: [...partner], partner: [...dragged] };
	if (sameTableSet(dragged, partner)) return [exchange];
	const inPlace = swapTableSets(dragged, partner, rows);
	if (!inPlace) return [exchange];
	const same =
		sameTableSet(inPlace.dragged, exchange.dragged) &&
		sameTableSet(inPlace.partner, exchange.partner);
	return same ? [inPlace] : [inPlace, exchange];
}

/** Do two bookings hold exactly the same tables? (Their swap is then POSITIONAL — they trade
 *  time slots on one set — rather than an exchange of two different sets.) */
export function sameTableSet(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((t) => b.includes(t));
}
