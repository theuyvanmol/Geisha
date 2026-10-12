import { describe, it, expect } from 'vitest';
import { placeHoverCard, HOVER_GAP, HOVER_MARGIN } from './hoverPlace';

// A 1440x900 window. The card is 260 wide; its height depends on how much was typed
// into the booking's comments.
const VIEW = { w: 1440, h: 900 };
const W = 260;

/** A one-row booking bar whose top edge is at `top`. */
const barAt = (top: number, left = 400) => ({ left, top, bottom: top + 24 });

describe('placeHoverCard', () => {
	it('opens below the bar when the whole card fits there', () => {
		const p = placeHoverCard(barAt(300), { w: W, h: 110 }, VIEW);
		expect(p).toEqual({ left: 400, top: 324 + HOVER_GAP, side: 'below' });
	});

	it('goes above a bar low on the board when a long comment makes the card too tall to fit below', () => {
		// The reported bug. 150px of screen is left under this bar: enough for the 132px the
		// card used to ASSUME it was, so it opened below — but with four lines of comments it
		// is really 240px tall, and the comments ran off the bottom of the screen.
		const bar = barAt(726);
		const p = placeHoverCard(bar, { w: W, h: 240 }, VIEW);
		expect(p.side).toBe('above');
		expect(p.top + 240).toBe(bar.top - HOVER_GAP);
		expect(p.top).toBeGreaterThanOrEqual(HOVER_MARGIN);
	});

	it('still opens below that same bar for a short card', () => {
		expect(placeHoverCard(barAt(726), { w: W, h: 110 }, VIEW).side).toBe('below');
	});

	it('lies over the bar, hard against the bottom of the screen, when neither side has room and below has more', () => {
		// A short window, a tall joined block in the middle of it, a long comment.
		const view = { w: 1440, h: 600 };
		const bar = { left: 400, top: 250, bottom: 330 };
		const p = placeHoverCard(bar, { w: W, h: 300 }, view);
		expect(p.side).toBe('over');
		expect(p.top).toBe(600 - HOVER_MARGIN - 300);
	});

	it('lies over the bar from the top of the screen when above has more room', () => {
		const view = { w: 1440, h: 600 };
		const bar = { left: 400, top: 290, bottom: 370 };
		const p = placeHoverCard(bar, { w: W, h: 300 }, view);
		expect(p).toMatchObject({ side: 'over', top: HOVER_MARGIN });
	});

	it('shows the START of a card taller than the whole screen', () => {
		const p = placeHoverCard(barAt(300), { w: W, h: 1200 }, VIEW);
		expect(p).toMatchObject({ side: 'over', top: HOVER_MARGIN });
	});

	it('keeps the card inside the left and right edges', () => {
		expect(placeHoverCard(barAt(300, 1400), { w: W, h: 110 }, VIEW).left).toBe(
			1440 - W - HOVER_MARGIN
		);
		// a bar scrolled part-way off the left of the grid
		expect(placeHoverCard(barAt(300, -60), { w: W, h: 110 }, VIEW).left).toBe(HOVER_MARGIN);
	});

	it('never lets any part of a card that fits on the screen fall outside it', () => {
		for (const h of [90, 132, 180, 240, 400, 700]) {
			for (let top = -40; top <= VIEW.h + 40; top += 7) {
				for (const span of [24, 80, 200]) {
					const p = placeHoverCard({ left: 400, top, bottom: top + span }, { w: W, h }, VIEW);
					expect(p.top, `h=${h} top=${top} span=${span}`).toBeGreaterThanOrEqual(HOVER_MARGIN);
					expect(p.top + h, `h=${h} top=${top} span=${span}`).toBeLessThanOrEqual(
						VIEW.h - HOVER_MARGIN
					);
				}
			}
		}
	});
});
