import { describe, it, expect } from 'vitest';
import { snapBarToCells, snapEndCaps, bookedDurationMin, type SnappedBar } from './barGrid.js';

// The grid in these tests opens at 12:00 (axis minute 0) and runs 12 hours, so 16:04 is
// minute 244 and the cells are 15 minutes wide.
const STEP = 15;
const TOTAL = 720;
const snap = (startMin: number, endMin: number) =>
	snapBarToCells({ startMin, endMin }, STEP, TOTAL);

describe('snapBarToCells', () => {
	it('leaves a bar already on the grid exactly where it is', () => {
		expect(snap(240, 330)).toEqual({ startMin: 240, endMin: 330 }); // 16:00–17:30
	});

	it('pulls a late sit-down back to the start of the cell it sat in', () => {
		expect(snap(244, 330).startMin).toBe(240); // sat 16:04 → drawn from 16:00
	});

	it('pushes a finished sitting on to the end of the cell it ended in', () => {
		expect(snap(240, 297).endMin).toBe(300); // finished 16:57 → drawn to 17:00
	});

	it('snaps both edges of a bar that is off the grid at each end', () => {
		expect(snap(244, 297)).toEqual({ startMin: 240, endMin: 300 });
	});

	it('never draws past the right edge of the grid', () => {
		expect(snap(700, 719).endMin).toBe(TOTAL);
	});

	it('keeps a bar at least a minute wide', () => {
		expect(snapBarToCells({ startMin: 719, endMin: 720 }, STEP, 720).endMin).toBe(720);
	});

	it('is a no-op when there is no step to snap to', () => {
		expect(snapBarToCells({ startMin: 244, endMin: 297 }, 0, TOTAL)).toEqual({
			startMin: 244,
			endMin: 297
		});
	});
});

const bar = (bookingId: string, rawStartMin: number, rawEndMin: number): SnappedBar => ({
	bookingId,
	rawStartMin,
	rawEndMin,
	...(() => {
		const s = snap(rawStartMin, rawEndMin);
		return { snapStartMin: s.startMin, snapEndMin: s.endMin };
	})()
});

describe('snapEndCaps', () => {
	it('caps nothing when one bar is alone on the table', () => {
		expect(snapEndCaps([bar('a', 244, 297)]).size).toBe(0);
	});

	it('caps nothing when the snapped bars still clear each other', () => {
		// 16:04–16:57 → 16:00–17:00, then 17:00–18:30. They touch, they do not overlap.
		expect(snapEndCaps([bar('a', 244, 297), bar('b', 300, 390)]).size).toBe(0);
	});

	it('caps a bar whose snapped end runs into the next party', () => {
		// a finished at 16:57 and b was seated at 16:57 — snapping stretched a to 17:00 and
		// pulled b back to 16:45, which the row would otherwise read as a double-booking.
		const caps = snapEndCaps([bar('a', 244, 297), bar('b', 297, 390)]);
		expect(caps.get('a')).toBe(285); // 16:45 — where b's cell begins
	});

	it('leaves a genuine overbook overlapping, so it keeps its warning', () => {
		// Both parties really are on the table at 16:30 — that is a deliberate overbook.
		const caps = snapEndCaps([bar('a', 240, 330), bar('b', 270, 390)]);
		expect(caps.size).toBe(0);
	});

	it('skips past an overbooked partner to cap against the party after it', () => {
		// a genuinely overlaps b (an overbook, left alone), and its snapped end then runs
		// into c, which it had cleared by a minute. Only c caps it.
		const caps = snapEndCaps([bar('a', 240, 344), bar('b', 270, 300), bar('c', 344, 400)]);
		expect(caps.get('a')).toBe(330); // 17:30 — where c's cell begins
	});
});

describe('bookedDurationMin', () => {
	// Real board, 2026-09-08: Doreen Oliver is booked 12:30 → 14:49:53 (140 min) but,
	// finished mid-cell, DRAWS as 90 → 240. Moving her used to write the drawing.
	it('takes the length from the booked window, not the drawn one', () => {
		expect(bookedDurationMin(90, 230, { startMin: 90, endMin: 240 })).toBe(140);
	});

	// A party seated early draws from the seat stamp, so the drawn start is before the
	// booked one. The booked length is still the one to write.
	it('ignores a seat-trimmed left edge', () => {
		expect(bookedDurationMin(360, 510, { startMin: 330, endMin: 510 })).toBe(150);
	});

	it('leaves an untrimmed, cell-aligned booking alone', () => {
		expect(bookedDurationMin(60, 150, { startMin: 60, endMin: 150 })).toBe(90);
	});

	// The NaN that put a bar at 12:00 with an auto width: an unparseable datetime must
	// fall back to the drawn span, never propagate.
	it('falls back to the drawn span when the booked window is unusable', () => {
		expect(bookedDurationMin(null, null, { startMin: 60, endMin: 150 })).toBe(90);
		expect(bookedDurationMin(NaN, NaN, { startMin: 60, endMin: 150 })).toBe(90);
		expect(bookedDurationMin(60, null, { startMin: 60, endMin: 150 })).toBe(90);
	});

	// Both ends clamp to the grid, so a booking running off an edge can collapse to a
	// non-positive length. Draw on the drawn span rather than write nonsense.
	it('falls back when the clamped window is not positive', () => {
		expect(bookedDurationMin(720, 720, { startMin: 630, endMin: 720 })).toBe(90);
	});
});

// The staleness that made a move silently undo a resize. bookedDurationMin reads the
// BOOKED window, so whatever writes that window optimistically must keep it in step
// with the drawn minutes — otherwise a drag issued before the previous write settles
// measures the PREVIOUS length and writes it back, and the sitting shrinks for good.
describe('bookedDurationMin against a stale booked window', () => {
	it('returns the stale length when the ISO window lags the drawn span', () => {
		// Booked 16:00-17:30 (240-330). The host has just resized to 19:00 (420): the
		// drawn span knows, the booked window does not yet.
		expect(bookedDurationMin(240, 330, { startMin: 240, endMin: 420 })).toBe(90);
	});

	it('returns the new length once the window is kept in step', () => {
		// …which is why commitResize now moves endsAt with endMin.
		expect(bookedDurationMin(240, 420, { startMin: 240, endMin: 420 })).toBe(180);
	});
});
