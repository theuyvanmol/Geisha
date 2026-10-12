// The diary header's per-service figures must agree with the run-sheet's.
//
// The header used to read a bar's service off the grid ("the last band that has
// begun by its start"), while the run-sheet reads the service stored on the
// booking. The two agreed until a walk-in was filed by the service RUNNING when it
// sat: a Fusion party on the 16:45 cell is stored as Dinner (lunch ended 16:45)
// but begins inside Lunch's band, so the header alone would still count it in
// Lunch — the owner's "the walk-ins don't match" all over again.

import { describe, it, expect } from 'vitest';
import { barPeriodId } from './barPeriod';

// Fusion's bands as the axis hands them over: minutes from the grid's left edge,
// a grid opening at 12:00.
const BANDS = [
	{ periodId: 'lunch', startMin: 0 }, // 12:00
	{ periodId: 'dinner', startMin: 300 } // 17:00
];

describe('barPeriodId', () => {
	it('uses the service the booking is FILED under', () => {
		// The 16:45 walk-in: startMin 285 sits in Lunch's band, but it is stored as Dinner.
		expect(barPeriodId({ periodId: 'dinner', startMin: 285 }, BANDS)).toBe('dinner');
	});

	it('falls back to the band a bar starts in when it carries no service', () => {
		// An optimistic bar (the tap before the server answers) has no stored service.
		expect(barPeriodId({ startMin: 285 }, BANDS)).toBe('lunch');
		expect(barPeriodId({ periodId: '', startMin: 330 }, BANDS)).toBe('dinner');
	});

	it('ignores a stored service the grid knows nothing about', () => {
		// A booking filed under yesterday's service, or one since deleted: fall back to
		// the band rather than tallying a column the header cannot draw.
		expect(barPeriodId({ periodId: 'sunday', startMin: 330 }, BANDS)).toBe('dinner');
	});

	it('puts a bar starting before the first band in that first band', () => {
		expect(barPeriodId({ startMin: -30 }, BANDS)).toBe('lunch');
	});

	it('returns no service when the grid has no bands at all', () => {
		expect(barPeriodId({ periodId: 'dinner', startMin: 0 }, [])).toBe('');
	});
});
