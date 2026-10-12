// The "All photos" contact sheet has to hold EVERY photo inside the one box the
// stage + filmstrip normally fill — the client rejected scrolling galleries, so
// the overview can't be a tall grid either. Given a tile count and the box, try
// every column count and tile shape, and keep whichever gives the biggest tiles
// that still fit both ways. Offering a squarer shape matters on a portrait
// phone, where 4:3 tiles in three columns left a third of the box empty.

export interface GridFit {
	cols: number;
	rows: number;
	tileW: number;
	tileH: number;
}

export function fitGrid(
	n: number,
	w: number,
	h: number,
	gap: number,
	aspects: number[] = [4 / 3, 1, 3 / 4]
): GridFit {
	let best: GridFit = { cols: 1, rows: Math.max(1, n), tileW: 0, tileH: 0 };
	if (n <= 0 || w <= 0 || h <= 0) return best;
	let bestArea = 0;
	for (const aspect of aspects) {
		for (let cols = 1; cols <= n; cols++) {
			const rows = Math.ceil(n / cols);
			const maxW = (w - gap * (cols - 1)) / cols;
			const maxH = (h - gap * (rows - 1)) / rows;
			const tileW = Math.floor(Math.min(maxW, maxH * aspect));
			const tileH = Math.floor(tileW / aspect);
			// The first shape (landscape — how most of these photos were taken,
			// so it crops least) is preferred: another shape has to be at least
			// 15% bigger to win. Strictly greater, so a tie keeps fewer columns.
			const score = tileW * tileH * (aspect === aspects[0] ? 1 : 0.85);
			if (tileW > 0 && score > bestArea) {
				bestArea = score;
				best = { cols, rows, tileW, tileH };
			}
		}
	}
	return best;
}
