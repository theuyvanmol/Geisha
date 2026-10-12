// Sub-lane packing for the diary timeline (ResDiary "split row" behaviour).
//
// A table row draws its bookings as absolutely-positioned bars on ONE lane. When two
// bookings on the same table overlap in time — a deliberate overbook, a party held on
// past its slot while the next one is seated, a walk-in dropped onto a table that still
// has a live sitting — the later bar simply painted ON TOP of the earlier one and hid
// it. Staff reported it as "table on the top of the other": a booking they could see a
// sliver of, couldn't read, and couldn't click.
//
// ResDiary splits the table's row into as many sub-lanes as the deepest overlap needs,
// so every booking stays fully visible and clickable. This module is the pure core of
// that: given a row's bars, hand back which sub-lane each one sits in and how many
// sub-lanes the row needs. Framework-free and unit-tested, like diaryProjection.ts.
//
// The algorithm is the standard greedy interval packing: walk the bars in start order
// and drop each into the FIRST sub-lane whose last bar has already ended; open a new
// sub-lane only when none is free. That is provably minimal (it uses exactly the
// maximum number of bookings overlapping at any single instant) and it keeps a row at
// one lane — its normal height — whenever nothing overlaps, which is the common case.

/** The minimum a bar needs to be laid out: its identity and its span on the grid. */
export interface LaneBar {
	bookingId: string;
	startMin: number;
	endMin: number;
}

export interface LaneLayout {
	/** How many sub-lanes this row needs (always >= 1, so the row never collapses). */
	count: number;
	/** bookingId → its 0-based sub-lane index. */
	laneOf: Map<string, number>;
	/** True when anything on this row overlaps — the row is double-booked. */
	overlapping: boolean;
	/**
	 * The bookings that ACTUALLY overlap another booking on this row — i.e. the
	 * double-booked ones. A row can split because two of its four sittings clash while
	 * the other two are innocent; only the clashing pair should be flagged in the UI.
	 * The system refuses to create these unless staff explicitly tick "Overbook Table",
	 * so membership here means "a host deliberately double-booked this table".
	 */
	clashing: Set<string>;
}

/** A row with nothing on it still occupies one lane's worth of height. */
const EMPTY: LaneLayout = {
	count: 1,
	laneOf: new Map(),
	overlapping: false,
	clashing: new Set()
};

/**
 * Pack a row's bars into non-overlapping sub-lanes.
 *
 * Bars are treated as half-open intervals [startMin, endMin): a booking ending at 20:00
 * and the next starting at 20:00 are back-to-back, NOT overlapping, so they share a
 * lane (the diary is full of exactly-abutting sittings and splitting those rows would
 * be pure noise).
 *
 * The input is not mutated — the caller's array is usually the store's projected row.
 */
export function assignLanes(bars: readonly LaneBar[]): LaneLayout {
	if (!bars || bars.length === 0) return EMPTY;
	if (bars.length === 1) {
		return {
			count: 1,
			laneOf: new Map([[bars[0].bookingId, 0]]),
			overlapping: false,
			clashing: new Set()
		};
	}

	// Start order, longest-first on a tie so a long sitting takes the top lane and the
	// short ones stack under it (reads more like ResDiary than the reverse).
	const ordered = [...bars].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

	const laneEnds: number[] = []; // laneEnds[i] = where sub-lane i is free from
	const laneOf = new Map<string, number>();
	let overlapping = false;

	for (const bar of ordered) {
		const start = bar.startMin;
		const end = bar.endMin;
		// A zero/negative-width bar (a mid-gesture optimistic bar can briefly be one)
		// occupies no time, so it never forces the row to split — park it on lane 0.
		if (end <= start) {
			laneOf.set(bar.bookingId, 0);
			continue;
		}
		let lane = laneEnds.findIndex((freeFrom) => freeFrom <= start);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(end);
			if (lane > 0) overlapping = true; // opening a 2nd+ lane means a real clash
		} else {
			laneEnds[lane] = end;
		}
		laneOf.set(bar.bookingId, lane);
	}

	// Which bars genuinely double-book each other? Splitting the row tells us SOMETHING
	// clashed, not which — a row with four sittings can split because two of them overlap
	// while the other two are innocent back-to-back turns. Pairwise over the ordered list,
	// stopping as soon as a later bar starts after this one ends (they're start-sorted, so
	// nothing beyond can overlap it either).
	const clashing = new Set<string>();
	for (let i = 0; i < ordered.length; i++) {
		const a = ordered[i];
		if (a.endMin <= a.startMin) continue; // degenerate bar — never a clash
		for (let j = i + 1; j < ordered.length; j++) {
			const b = ordered[j];
			if (b.startMin >= a.endMin) break;
			if (b.endMin <= b.startMin) continue;
			clashing.add(a.bookingId);
			clashing.add(b.bookingId);
		}
	}

	return { count: Math.max(1, laneEnds.length), laneOf, overlapping, clashing };
}
