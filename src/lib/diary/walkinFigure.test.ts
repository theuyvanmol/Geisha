import { describe, expect, it } from 'vitest';
import { walkinFigure } from './walkinFigure';

const PERIODS = [
	{ periodId: 'day', name: 'Daytime' },
	{ periodId: 'dinner', name: 'Dinner' }
];

describe('walkinFigure', () => {
	// Asia, 1 Oct 2026 — the client read "Daytime 18 Pax … Walk-ins 19 · 40 Pax" as
	// 19 walk-ins out of 18 covers. 19 was PARTIES for the whole DAY; every other figure
	// in the strip is COVERS for one service.
	it('splits walk-in covers by service, in the same unit as the service figures', () => {
		const f = walkinFigure(PERIODS, new Map([['day', 18], ['dinner', 22]]), {
			walkins: 19,
			walkinCovers: 40,
			covers: 72
		});
		expect(f.text).toBe('Daytime 18 · Dinner 22 Pax');
		expect(f.text).not.toContain('19');
	});

	it('keeps the party count, labelled as parties, in the hover text', () => {
		const f = walkinFigure(PERIODS, new Map([['day', 18], ['dinner', 22]]), {
			walkins: 19,
			walkinCovers: 40,
			covers: 72
		});
		expect(f.title).toContain('19 walk-in parties');
		expect(f.title).toContain('40 of 72 covers');
	});

	it('shows a service with no walk-ins as 0 rather than dropping it', () => {
		const f = walkinFigure(PERIODS, new Map([['dinner', 5]]), { walkins: 2, walkinCovers: 5, covers: 9 });
		expect(f.text).toBe('Daytime 0 · Dinner 5 Pax');
	});

	it('uses a single figure when the day has one service', () => {
		const f = walkinFigure([PERIODS[1]], new Map([['dinner', 4]]), { walkins: 1, walkinCovers: 4, covers: 4 });
		expect(f.text).toBe('4 Pax');
		expect(f.title).toContain('1 walk-in party');
	});
});
