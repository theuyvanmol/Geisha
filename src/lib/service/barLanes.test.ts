import { describe, it, expect } from 'vitest';
import { assignLanes, type LaneBar } from './barLanes.js';

const bar = (bookingId: string, startMin: number, endMin: number): LaneBar => ({
	bookingId,
	startMin,
	endMin
});

describe('assignLanes', () => {
	it('keeps an empty row at one lane', () => {
		const l = assignLanes([]);
		expect(l.count).toBe(1);
		expect(l.overlapping).toBe(false);
	});

	it('puts a single booking on lane 0', () => {
		const l = assignLanes([bar('a', 0, 90)]);
		expect(l.count).toBe(1);
		expect(l.laneOf.get('a')).toBe(0);
	});

	it('shares one lane for sequential sittings', () => {
		const l = assignLanes([bar('a', 0, 90), bar('b', 120, 210)]);
		expect(l.count).toBe(1);
		expect(l.laneOf.get('b')).toBe(0);
		expect(l.overlapping).toBe(false);
	});

	it('treats exactly abutting sittings as NOT overlapping', () => {
		// 19:00-20:30 then 20:30-22:00 on the same table is the normal double turn.
		const l = assignLanes([bar('a', 0, 90), bar('b', 90, 180)]);
		expect(l.count).toBe(1);
		expect(l.overlapping).toBe(false);
	});

	it('splits the row when two bookings overlap (the reported bug)', () => {
		// Two walk-ins on one table: 19:52-21:00 and 20:05-22:15.
		const l = assignLanes([bar('w1', 52, 120), bar('w2', 65, 195)]);
		expect(l.count).toBe(2);
		expect(l.overlapping).toBe(true);
		expect(l.laneOf.get('w1')).toBe(0);
		expect(l.laneOf.get('w2')).toBe(1);
	});

	it('uses only as many lanes as the deepest overlap', () => {
		// a and b overlap; c starts after both end, so it re-uses lane 0.
		const l = assignLanes([bar('a', 0, 60), bar('b', 30, 90), bar('c', 100, 160)]);
		expect(l.count).toBe(2);
		expect(l.laneOf.get('c')).toBe(0);
	});

	it('stacks three-deep when three parties overlap', () => {
		const l = assignLanes([bar('a', 0, 90), bar('b', 10, 100), bar('c', 20, 110)]);
		expect(l.count).toBe(3);
		expect(new Set([l.laneOf.get('a'), l.laneOf.get('b'), l.laneOf.get('c')]).size).toBe(3);
	});

	it('is order-independent (input need not be sorted)', () => {
		const sorted = assignLanes([bar('a', 0, 60), bar('b', 30, 90)]);
		const shuffled = assignLanes([bar('b', 30, 90), bar('a', 0, 60)]);
		expect(shuffled.count).toBe(sorted.count);
		expect(shuffled.laneOf.get('a')).toBe(sorted.laneOf.get('a'));
		expect(shuffled.laneOf.get('b')).toBe(sorted.laneOf.get('b'));
	});

	it('does not mutate the caller’s array', () => {
		const input = [bar('b', 30, 90), bar('a', 0, 60)];
		assignLanes(input);
		expect(input[0].bookingId).toBe('b');
	});

	it('gives a zero-width bar its own place without claiming a lane forever', () => {
		const l = assignLanes([bar('a', 60, 60), bar('b', 60, 120)]);
		expect(l.laneOf.get('a')).toBe(0);
		expect(l.laneOf.get('b')).toBe(0); // 'a' ends where it starts, so the lane is free
		expect(l.count).toBe(1);
	});

	it('assigns every booking a lane', () => {
		const bars = [bar('a', 0, 90), bar('b', 30, 120), bar('c', 45, 60), bar('d', 200, 260)];
		const l = assignLanes(bars);
		for (const b of bars) expect(l.laneOf.has(b.bookingId)).toBe(true);
	});
});

describe('assignLanes — which bars are actually double-booked', () => {
	it('flags only the clashing pair, not every bar on a split row', () => {
		// a & b overlap (a genuine overbook); c is a normal back-to-back turn after them.
		const l = assignLanes([bar('a', 0, 60), bar('b', 30, 90), bar('c', 90, 150)]);
		expect(l.count).toBe(2);
		expect([...l.clashing].sort()).toEqual(['a', 'b']);
	});

	it('flags nothing when the row never overlaps', () => {
		const l = assignLanes([bar('a', 0, 90), bar('b', 90, 180), bar('c', 200, 260)]);
		expect(l.clashing.size).toBe(0);
		expect(l.overlapping).toBe(false);
	});

	it('flags all three when three parties share the table', () => {
		const l = assignLanes([bar('a', 0, 90), bar('b', 10, 100), bar('c', 20, 110)]);
		expect([...l.clashing].sort()).toEqual(['a', 'b', 'c']);
	});

	it('flags a clash that skips a lane (a long sitting overlapped much later)', () => {
		// a runs 0-200; b is a short turn inside it. Both are double-booked.
		const l = assignLanes([bar('a', 0, 200), bar('b', 150, 190)]);
		expect([...l.clashing].sort()).toEqual(['a', 'b']);
	});

	it('does not flag exactly-abutting sittings', () => {
		const l = assignLanes([bar('a', 0, 90), bar('b', 90, 180)]);
		expect(l.clashing.size).toBe(0);
	});
});
