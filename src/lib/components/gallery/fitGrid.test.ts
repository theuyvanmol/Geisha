import { describe, expect, it } from 'vitest';
import { fitGrid } from './fitGrid';

describe('fitGrid', () => {
	it('never overflows the box', () => {
		for (const n of [1, 2, 5, 7, 13, 15, 24, 40]) {
			for (const [w, h] of [
				[1340, 690],
				[358, 560],
				[800, 300]
			]) {
				const g = fitGrid(n, w, h, 8);
				expect(g.cols * g.rows).toBeGreaterThanOrEqual(n);
				expect(g.cols * g.tileW + (g.cols - 1) * 8).toBeLessThanOrEqual(w);
				expect(g.rows * g.tileH + (g.rows - 1) * 8).toBeLessThanOrEqual(h);
			}
		}
	});

	it('goes wide on a landscape box and tall on a portrait one', () => {
		expect(fitGrid(12, 1340, 690, 8).cols).toBeGreaterThan(fitGrid(12, 1340, 690, 8).rows);
		expect(fitGrid(12, 358, 560, 8).rows).toBeGreaterThan(fitGrid(12, 358, 560, 8).cols);
	});

	it('keeps landscape tiles on a wide box but fills a portrait phone', () => {
		const wide = fitGrid(15, 1342, 700, 8);
		expect(wide.tileW).toBeGreaterThan(wide.tileH);
		// 390px phone: 4:3 tiles in 3 columns left ~180px of the box empty.
		const phone = fitGrid(15, 340, 610, 8);
		const used = phone.rows * phone.tileH + (phone.rows - 1) * 8;
		expect(used).toBeGreaterThan(610 * 0.85);
	});

	it('returns an empty fit for nothing to lay out', () => {
		expect(fitGrid(0, 800, 600, 8).tileW).toBe(0);
		expect(fitGrid(5, 0, 600, 8).tileW).toBe(0);
	});
});
