import { describe, it, expect } from 'vitest';
import {
	edgeVelocity,
	edgeScrollStep,
	withDragIntent,
	EDGE_ZONE_PX,
	EDGE_MIN_SPEED,
	EDGE_MAX_SPEED
} from './edgeScroll';

// A visible band of rows from y=100 (under the sticky time header) to y=700.
const LO = 100;
const HI = 700;

describe('edgeVelocity', () => {
	it('does nothing in the middle of the board', () => {
		expect(edgeVelocity(400, LO, HI)).toBe(0);
		expect(edgeVelocity(LO + EDGE_ZONE_PX + 1, LO, HI)).toBe(0);
		expect(edgeVelocity(HI - EDGE_ZONE_PX - 1, LO, HI)).toBe(0);
	});

	it('scrolls DOWN near the bottom edge, and UP near the top edge', () => {
		expect(edgeVelocity(HI - 10, LO, HI)).toBeGreaterThan(0);
		expect(edgeVelocity(LO + 10, LO, HI)).toBeLessThan(0);
	});

	it('goes faster the closer the pointer gets to the edge', () => {
		const shallow = edgeVelocity(HI - EDGE_ZONE_PX + 5, LO, HI);
		const deep = edgeVelocity(HI - 5, LO, HI);
		expect(deep).toBeGreaterThan(shallow);
		expect(shallow).toBeGreaterThanOrEqual(EDGE_MIN_SPEED);
	});

	it('is symmetric top and bottom', () => {
		expect(edgeVelocity(LO + 12, LO, HI)).toBeCloseTo(-edgeVelocity(HI - 12, LO, HI));
	});

	it('runs at full speed at the edge and past it (pointer dragged off the board)', () => {
		expect(edgeVelocity(HI, LO, HI)).toBe(EDGE_MAX_SPEED);
		expect(edgeVelocity(HI + 300, LO, HI)).toBe(EDGE_MAX_SPEED);
		expect(edgeVelocity(LO - 300, LO, HI)).toBe(-EDGE_MAX_SPEED);
	});

	it('shrinks the zones on a short board so they never swallow the middle', () => {
		// 120px of visible rows: a 56px zone at each end would leave 8px that doesn't scroll.
		expect(edgeVelocity(160, 100, 220)).toBe(0);
		expect(edgeVelocity(140, 100, 220)).toBe(0); // zone is 30px here, not 56
		expect(edgeVelocity(115, 100, 220)).toBeLessThan(0);
	});

	it('does nothing when there is no visible band at all', () => {
		expect(edgeVelocity(100, 100, 100)).toBe(0);
		expect(edgeVelocity(100, 200, 100)).toBe(0);
	});
});

describe('withDragIntent', () => {
	it('keeps a downward scroll once the drag has gone down from the grab point', () => {
		expect(withDragIntent(500, 690, 400, 4)).toBe(500);
	});

	it('drops it for a booking grabbed IN the bottom zone and slid sideways', () => {
		// Grabbed on the last visible row at y=680, dragged along that row to re-time it.
		expect(withDragIntent(500, 682, 680, 4)).toBe(0);
	});

	it('scrolls down once that same booking is pulled down past the dead band', () => {
		expect(withDragIntent(500, 690, 680, 4)).toBe(500);
	});

	it('drops an upward scroll unless the drag has gone up', () => {
		expect(withDragIntent(-500, 130, 120, 4)).toBe(0);
		expect(withDragIntent(-500, 110, 120, 4)).toBe(-500);
	});

	it('leaves "no scroll" alone', () => {
		expect(withDragIntent(0, 900, 100, 4)).toBe(0);
	});
});

describe('edgeScrollStep', () => {
	it('turns a speed into whole pixels for one frame', () => {
		const r = edgeScrollStep(600, 1000 / 60, 0);
		expect(r.px).toBe(10);
		expect(r.carry).toBeCloseTo(0);
	});

	it('carries the fraction so a slow scroll still moves instead of rounding to 0 forever', () => {
		// Half a pixel a frame — without the carry, every scrollTop += 0.5 rounds away to nothing.
		let carry = 0;
		let total = 0;
		for (let i = 0; i < 60; i++) {
			const r = edgeScrollStep(30, 1000 / 60, carry); // 0.5px a frame
			total += r.px;
			carry = r.carry;
			expect(Number.isInteger(r.px)).toBe(true);
		}
		expect(total).toBeGreaterThanOrEqual(29);
		expect(total).toBeLessThanOrEqual(30);
	});

	it('scrolls up (negative) as whole pixels too', () => {
		let carry = 0;
		let total = 0;
		for (let i = 0; i < 60; i++) {
			const r = edgeScrollStep(-30, 1000 / 60, carry);
			total += r.px;
			carry = r.carry;
		}
		expect(total).toBeLessThanOrEqual(-29);
		expect(total).toBeGreaterThanOrEqual(-30);
	});

	it('caps a long frame gap so a stalled tab does not leap the board', () => {
		expect(edgeScrollStep(EDGE_MAX_SPEED, 2000, 0).px).toBeLessThanOrEqual(
			Math.ceil(EDGE_MAX_SPEED * 0.05)
		);
	});
});
