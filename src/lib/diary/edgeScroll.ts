/**
 * EDGE AUTO-SCROLL WHILE DRAGGING A BOOKING.
 *
 * The board is taller (and often wider) than the screen. Moving a booking from a table at
 * the top to one at the bottom used to be pick up → drop part-way → scroll → pick up again,
 * because nothing scrolled the board under a drag. Now holding the dragged booking near an
 * edge of the grid scrolls the board that way, and keeps scrolling while the pointer stays
 * there — it doesn't need to keep moving.
 *
 * Pure numbers only; the page owns the rAF loop and the DOM. Everything is in CSS px and
 * px/second, so a 120Hz iPad scrolls at the same speed as a 60Hz laptop.
 */

/** How deep the scroll zone is inside each edge of the visible grid. About two compact rows. */
export const EDGE_ZONE_PX = 56;
/** px/s just inside a zone — slow enough to pick a neighbouring row. */
export const EDGE_MIN_SPEED = 60;
/** px/s at the edge itself (and past it) — a long board goes by in about a second. */
export const EDGE_MAX_SPEED = 1000;
/** The longest frame gap honoured. A stalled tab mustn't hurl the board on the next frame. */
const MAX_FRAME_MS = 50;

/**
 * Scroll speed along ONE axis for a pointer at `pos`, given the visible band [lo, hi]
 * (for the vertical axis: from under the sticky time header to the bottom of the grid).
 * Negative scrolls toward `lo`, positive toward `hi`, 0 when the pointer is clear of both
 * zones. Speed eases in with depth, and is flat-out at the edge and anywhere past it, so
 * dragging right off the board still scrolls.
 */
export function edgeVelocity(pos: number, lo: number, hi: number, zone = EDGE_ZONE_PX): number {
	const span = hi - lo;
	if (!(span > 0)) return 0;
	// On a short band two full zones would cover it and every drag would scroll. Cap each at
	// a quarter so the middle half always holds still.
	const z = Math.min(zone, span / 4);
	const intoLo = lo + z - pos;
	if (intoLo > 0) return -speedAt(intoLo / z);
	const intoHi = pos - (hi - z);
	if (intoHi > 0) return speedAt(intoHi / z);
	return 0;
}

/**
 * Keep a velocity only if the drag is actually heading that way from where it was grabbed.
 * A booking picked up on the bottom row starts INSIDE the bottom zone; sliding it sideways
 * to re-time it must not scroll the board away underneath it. Scrolling down needs the
 * pointer to be more than `deadband` px below the grab point, scrolling up more than that
 * above it (and the same for left/right).
 */
export function withDragIntent(
	velocity: number,
	pos: number,
	origin: number,
	deadband: number
): number {
	if (velocity > 0 && pos - origin <= deadband) return 0;
	if (velocity < 0 && origin - pos <= deadband) return 0;
	return velocity;
}

function speedAt(depth: number): number {
	const t = Math.min(1, depth);
	return EDGE_MIN_SPEED + (EDGE_MAX_SPEED - EDGE_MIN_SPEED) * t * t;
}

/**
 * Pixels to scroll this frame, as a WHOLE number, plus the fraction left over for the next.
 * Browsers round scrollTop/scrollLeft writes, so a slow scroll of half a pixel a frame would
 * round to nothing on every frame and never move. Carrying the remainder fixes that.
 */
export function edgeScrollStep(
	velocity: number,
	dtMs: number,
	carry: number
): { px: number; carry: number } {
	const exact = (velocity * Math.min(Math.max(dtMs, 0), MAX_FRAME_MS)) / 1000 + carry;
	const px = Math.round(exact);
	return { px, carry: exact - px };
}
