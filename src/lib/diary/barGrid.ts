/**
 * A BAR OCCUPIES WHOLE CELLS.
 *
 * The diary is a grid of 15-minute cells, and every way a host can put a booking on it —
 * clicking a slot, dragging, resizing, the time picker — moves in whole cells. Two things
 * do not: the SEAT-TIME TRIM (a bar's left edge is drawn from `floor_state.seated_at`, see
 * seatTrim.ts) and FINISH (which cuts `ends_at` to the clock). Both stamp a real minute, so
 * a party sat at 16:04 and finished at 16:57 drew a bar that started a third of the way into
 * the 16:00 cell and stopped short of the 16:45 one — a ragged sliver of empty grid down the
 * board wherever service had touched a table, which is exactly what the owner sees ResDiary
 * not doing: there a booking fills its cells edge to edge.
 *
 * So the DRAWN span is quantised: the left edge back to the start of the cell the sitting
 * began in, the right edge on to the end of the cell it ended in. A cell the table was busy
 * in for four minutes is a cell the table was busy in. `starts_at` / `ends_at` are untouched
 * — occupancy, turn prediction and pacing all read the booked window, not this.
 *
 * The one thing quantising can invent is an OVERLAP: stretching one bar's right edge into
 * the next party's first cell would split the row into sub-lanes and flag both as
 * double-booked over a rounding artefact — the same false ⚠ that seatTrimFloors exists to
 * stop at the other end. {@link snapEndCaps} caps that. A genuine overbook (windows that
 * really do overlap) is left alone and keeps its warning.
 */

export interface BarSpan {
	startMin: number;
	endMin: number;
}

/**
 * One bar's drawn span, snapped out to the cells it touches. `totalMin` is the grid's right
 * edge — the last cell may be a partial one, and a bar is never drawn past it.
 */
export function snapBarToCells(span: BarSpan, stepMin: number, totalMin: number): BarSpan {
	if (stepMin <= 0) return { startMin: span.startMin, endMin: span.endMin };
	const startMin = Math.max(0, Math.floor(span.startMin / stepMin) * stepMin);
	const ceiled = Math.ceil(span.endMin / stepMin) * stepMin;
	// Never past the grid's right edge, and never collapsed to nothing.
	const endMin = Math.max(startMin + 1, Math.min(totalMin, ceiled));
	return { startMin, endMin };
}

/** One table's bars, raw span and snapped span, for {@link snapEndCaps}. */
export interface SnappedBar {
	bookingId: string;
	/** The span as it came off the booking, BEFORE snapping. */
	rawStartMin: number;
	rawEndMin: number;
	/** The span after {@link snapBarToCells}. */
	snapStartMin: number;
	snapEndMin: number;
}

/**
 * HOW FAR RIGHT A SNAPPED BAR MAY REACH ON A GIVEN TABLE.
 *
 * Returns bookingId → the end minute it must not pass, for any bar whose snapped right edge
 * runs into a later party that its RAW span cleared. Bars with nothing after them, and bars
 * that genuinely overlap what follows (a deliberate overbook), are absent.
 *
 * One table per call — a booking joined across several tables gets a cap from each, and the
 * caller keeps the LOWEST so the block clears every table it sits on.
 */
export function snapEndCaps(bars: readonly SnappedBar[]): Map<string, number> {
	const caps = new Map<string, number>();
	if (bars.length < 2) return caps;
	const ordered = [...bars].sort(
		(a, b) => a.snapStartMin - b.snapStartMin || a.snapEndMin - b.snapEndMin
	);
	for (let i = 0; i < ordered.length - 1; i++) {
		const prev = ordered[i];
		for (let j = i + 1; j < ordered.length; j++) {
			const next = ordered[j];
			// Sorted by snapped start, so once one clears prev's end every later one does.
			if (next.snapStartMin >= prev.snapEndMin) break;
			// They really overlap — that's an overbook, not a rounding artefact. Leave it.
			if (prev.rawEndMin > next.rawStartMin) continue;
			const cap = Math.max(prev.snapStartMin + 1, next.snapStartMin);
			const cur = caps.get(prev.bookingId);
			if (cur === undefined || cap < cur) caps.set(prev.bookingId, cap);
		}
	}
	return caps;
}

/**
 * HOW LONG THE SITTING ACTUALLY IS, for a write that must not change it.
 *
 * A move re-tables a booking; it must not silently re-length it. But the numbers a bar
 * carries for DRAWING are not the booked window: {@link snapBarToCells} pushes the right
 * edge out to the end of a cell, {@link snapEndCaps} can pull it back in, and seatTrim.ts
 * moves the left edge to the seat stamp. Measuring a move's `durationMinutes` off those
 * writes the drawing back into the database — a 140-minute sitting drawn as 150 becomes a
 * 150-minute one, and drifts again on the next drag.
 *
 * So take the length from the BOOKED window (`starts_at`/`ends_at`, mapped to grid minutes
 * by the caller) whenever it is usable, and fall back to the drawn span when it is not —
 * an unparseable datetime, or a window the grid can't express because it runs off an edge
 * (both clamp, which shows up here as a non-positive length).
 *
 * @param bookedStartMin booked start as a grid minute, or null if it could not be derived
 * @param bookedEndMin   booked end as a grid minute, or null
 * @param drawn          the bar's drawn span, used when the booked window is unusable
 */
export function bookedDurationMin(
	bookedStartMin: number | null | undefined,
	bookedEndMin: number | null | undefined,
	drawn: BarSpan
): number {
	const drawnLen = drawn.endMin - drawn.startMin;
	if (
		typeof bookedStartMin !== 'number' ||
		typeof bookedEndMin !== 'number' ||
		!Number.isFinite(bookedStartMin) ||
		!Number.isFinite(bookedEndMin)
	)
		return drawnLen;
	const len = bookedEndMin - bookedStartMin;
	return len > 0 ? len : drawnLen;
}
