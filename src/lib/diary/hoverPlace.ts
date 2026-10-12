/**
 * WHERE THE DIARY'S HOVER CARD GOES.
 *
 * The dark quick-facts card shown while a booking bar is hovered. It used to GUESS its own
 * height (132px) to choose between opening below the bar and flipping above it. A booking
 * with a few lines of comments is far taller than that, so for a bar in the lower part of
 * the board the guess said "fits below" and the comments — the one thing staff hover a
 * booking to read — ran off the bottom of the screen. The card can't be scrolled (it
 * ignores the pointer on purpose, so it never traps the hover), so the only fix is to put
 * it where all of it shows.
 *
 * Pure numbers: the page measures the rendered card and hands its real size in.
 */

/** Space between the bar and the card — room for the arrow. */
export const HOVER_GAP = 8;
/** The closest the card may sit to an edge of the screen. */
export const HOVER_MARGIN = 8;

/** The hovered bar's box, in viewport px. */
export type HoverAnchor = { left: number; top: number; bottom: number };
/** `over` = fits neither above nor below the bar, so it lies across it. */
export type HoverSide = 'below' | 'above' | 'over';
/** `top`/`left` are the card's own top-left corner, in viewport px. */
export type HoverPlacement = { left: number; top: number; side: HoverSide };

/**
 * Below the bar if the whole card fits there, else above it, else across it — pushed
 * against whichever edge of the screen has more room, so as little of the bar is covered
 * as the card allows. A card taller than the screen shows its start.
 */
export function placeHoverCard(
	anchor: HoverAnchor,
	card: { w: number; h: number },
	view: { w: number; h: number }
): HoverPlacement {
	const left = Math.max(HOVER_MARGIN, Math.min(anchor.left, view.w - card.w - HOVER_MARGIN));
	// The lowest the card's top can go with its last line still on screen.
	const lowest = view.h - HOVER_MARGIN - card.h;
	// (The max/min keep a bar that is itself part-way off the screen from dragging the
	// card off with it.)
	const below = Math.max(HOVER_MARGIN, anchor.bottom + HOVER_GAP);
	if (below <= lowest) return { left, top: below, side: 'below' };
	const above = Math.min(lowest, anchor.top - HOVER_GAP - card.h);
	if (above >= HOVER_MARGIN) return { left, top: above, side: 'above' };
	const moreRoomBelow = view.h - anchor.bottom >= anchor.top;
	return { left, top: Math.max(HOVER_MARGIN, moreRoomBelow ? lowest : HOVER_MARGIN), side: 'over' };
}
