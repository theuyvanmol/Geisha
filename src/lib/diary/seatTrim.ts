/**
 * WHERE A SEATED BAR'S LEFT EDGE IS DRAWN.
 *
 * A diary bar is booked from `starts_at`, but a party rarely sits down at exactly that
 * minute. The bar's LEFT edge therefore tracks the real seat stamp (`floor_state.seated_at`,
 * earliest across the booking's tables) rather than the booked time, in BOTH directions:
 *
 *   • seated LATE  → the edge slides RIGHT to the seat time; the bar shortens from the left.
 *   • seated EARLY → the edge slides LEFT to the seat time; the bar lengthens from the left,
 *     because the table really is occupied from then.
 *   • seated before the grid opens → the raw minute comes back NEGATIVE and the caller
 *     clamps it to 0, so the bar snaps flush to the very left of the diary.
 *
 * DISPLAY ONLY. `starts_at` / `ends_at` are untouched, so occupancy, turn prediction and
 * pacing (all derived from the booked window) are unaffected — this only changes where the
 * bar is painted. The RIGHT edge is never moved by a seat stamp.
 *
 * THREE STAMPS ARE REFUSED, because they don't describe the window the bar occupies. All
 * three are the fingerprint of a booking RE-TIMED after it was seated, where
 * `syncFloorStateTables` couldn't re-anchor the stamp (legacy rows, and a finished sitting
 * whose new time lands after it was cleared) — or of a future booking seated by hand from a
 * day that isn't its own. Both are common in the live data, so the guards are load-bearing,
 * not theoretical:
 *
 *   1. A stamp at or past the booked END. Honouring it clamped the bar to a 1-minute sliver
 *      — the owner's "disappearing bookings".
 *   2. A stamp more than ONE FULL SITTING before the booked start. A real early arrival is
 *      minutes, not hours; anything earlier than the booking's own length is history from
 *      another service (or another day — a 15 Sep booking stamped 10 Jul), and stretching
 *      the bar back to it would smear one party across the whole grid. The bound scales
 *      with the booking rather than a magic number: a 105-minute sitting may be seated up
 *      to 105 minutes early. (For a booking that runs past the grid's right edge the length
 *      is measured to that edge, so the bound is a little tighter — deliberately safe.)
 *   3. A sitting already CLEARED at or before the booked start, i.e. the whole recorded
 *      visit lies before the window even though the stamp is close enough to pass (2).
 *
 * A party still seated (no clear stamp), or one that sat early and stayed into its booked
 * window, is a genuine early arrival and IS honoured.
 */
export interface SeatTrimInput {
	/** Booked start as an axis-minute offset. RAW — negative when it precedes the grid. */
	bookedStartMin: number;
	/** Booked end as an axis-minute offset, already clamped to the grid's right edge. */
	bookedEndMin: number;
	/** Earliest real seat time as an axis-minute offset, or null when never seated. */
	seatMin: number | null;
	/** Latest clear time as an axis-minute offset, or null while the party is still down. */
	clearedMin: number | null;
}

/**
 * The bar's left edge as a RAW axis minute — may be negative (sat before the grid opens),
 * which the caller clamps to 0. Returns the booked start whenever there's no usable stamp.
 */
export function seatedBarStartMin({
	bookedStartMin,
	bookedEndMin,
	seatMin,
	clearedMin
}: SeatTrimInput): number {
	if (seatMin === null) return bookedStartMin;
	if (seatMin >= bookedEndMin) return bookedStartMin; // (1) stamp at/after the booked end
	// (2) earlier than one whole sitting before the booked start → not this sitting
	if (seatMin < bookedStartMin - (bookedEndMin - bookedStartMin)) return bookedStartMin;
	// (3) the recorded visit ended before this window began
	if (clearedMin !== null && clearedMin <= bookedStartMin) return bookedStartMin;
	// Always leave at least a sliver of bar visible.
	return Math.min(seatMin, bookedEndMin - 1);
}

/** One table's bars, in whatever order, for {@link seatTrimFloors}. */
export interface TableBar {
	bookingId: string;
	/** Booked start as an axis minute, RAW (negative when it precedes the grid). */
	bookedStartMin: number;
	/** The bar's right edge as drawn — a seat stamp never moves this. */
	endMin: number;
}

/**
 * HOW FAR LEFT A TRIMMED BAR MAY REACH ON A GIVEN TABLE.
 *
 * The seat stamp is the moment a host pressed Seat, which is routinely a minute or two
 * off the truth — and the previous party is often still being cleared. Left unchecked, a
 * 13:28 stamp on a table booked to 13:30 draws the new bar two minutes INTO the outgoing
 * sitting, and the diary splits the row and flags BOTH parties as double-booked over a
 * two-minute artefact. (Real case: Nicky 12:00–13:30 and Aaron 13:30–14:41 on table 4.)
 *
 * A party cannot have been at a table while the previous party was still on it, so an
 * early trim may only reach back to when the table actually freed. Returns bookingId →
 * that floor, for the bars that have a predecessor here; bars with nothing before them on
 * the table are absent (nothing to clamp to). One table per call — a joined party gets a
 * floor from each of its tables, and the caller keeps the LATEST, so its bar clears the
 * last table to free up.
 *
 * The floor is never later than the booking's own booked start, so this can only ever undo
 * part of an EARLY trim — a late trim, and a DELIBERATE overbook (two bookings whose booked
 * windows genuinely overlap, which only the "Overbook Table" tick can create), are both
 * left exactly as they are and keep their ⚠.
 */
export function seatTrimFloors(bars: readonly TableBar[]): Map<string, number> {
	const floors = new Map<string, number>();
	if (bars.length < 2) return floors;
	// Booked order — the sequence the table was actually sold in, which the trim may have
	// visually reordered.
	const ordered = [...bars].sort(
		(a, b) => a.bookedStartMin - b.bookedStartMin || a.endMin - b.endMin
	);
	let prevEnd: number | null = null;
	for (const bar of ordered) {
		if (prevEnd !== null) {
			const floor = Math.min(Math.max(0, bar.bookedStartMin), prevEnd);
			const cur = floors.get(bar.bookingId);
			if (cur === undefined || floor > cur) floors.set(bar.bookingId, floor);
		}
		prevEnd = prevEnd === null ? bar.endMin : Math.max(prevEnd, bar.endMin);
	}
	return floors;
}
