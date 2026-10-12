// Joined-table bookings drawn as ONE block (ResDiary parity, owner request).
//
// THE PROBLEM. The server places a booking as one bar per table it occupies
// (admin.ts), so a party of 10 sitting across four pushed-together tables drew as
// FOUR identical "10 SSSS" bars stacked down the grid — it read as four separate
// parties of 10, and the covers arithmetic in the header (which counts a booking
// once) then disagreed with what the eye counted. ResDiary draws that party as a
// single block spanning the joined table rows, which is what the tables physically
// are: one table now.
//
// THE RULE. Within a section, take the rows a booking occupies IN ROW ORDER and cut
// them into maximal CONTIGUOUS runs. Each run of 2+ rows collapses to one block,
// drawn on the run's first row and spanning the rest; the duplicate bars on those
// rows are suppressed. A booking on non-adjacent tables (3 and 17) still draws one
// bar per run — nothing is ever hidden without something spanning over it.
//
// A run is only merged when every row in it is a SINGLE lane. A row splits into
// sub-lanes when two parties overlap on one table (the deliberate "Overbook Table"
// override), and a block spanning rows of differing heights would either cover the
// other party or land off its row — so those rows keep their own bars, which is the
// honest reading of a genuinely messy row.
//
// PURE (no $state, no DOM), like diaryProjection.ts / barLanes.ts — unit-tested.

/** The only row shape this needs: the table it is, and which bookings sit on it. */
export type JoinRow = {
	tableId: string;
	bars: { bookingId: string }[];
	/** sub-lanes this row is split into (1 normally) — from assignLanes. */
	laneCount: number;
};

/** Stable per-bar key: a booking has one bar per row it occupies. */
export const blockKey = (bookingId: string, tableId: string): string => `${bookingId}@${tableId}`;

export type JoinBlocks = {
	/** bar key → how many ROWS the block spans (only for the run's first bar). */
	spanOf: Map<string, number>;
	/** bar key → the block's height in row-heights (rows can be multi-lane elsewhere,
	 *  so this is the sum of the spanned rows' lane counts, not just the row count). */
	unitsOf: Map<string, number>;
	/** bar keys that must NOT be drawn — a block above already covers their row. */
	hidden: Set<string>;
};

/**
 * Work out which bars merge into a block for ONE section's rows (in display order).
 */
export function joinBlocks(rows: JoinRow[]): JoinBlocks {
	const spanOf = new Map<string, number>();
	const unitsOf = new Map<string, number>();
	const hidden = new Set<string>();

	// Which row indices each booking occupies, in row order.
	const rowsOf = new Map<string, number[]>();
	rows.forEach((row, i) => {
		for (const b of row.bars) {
			const list = rowsOf.get(b.bookingId);
			if (list) {
				// A row can legitimately list a booking once only (projectRows de-dupes),
				// but guard anyway so a repeat can't inflate a span.
				if (list[list.length - 1] !== i) list.push(i);
			} else {
				rowsOf.set(b.bookingId, [i]);
			}
		}
	});

	for (const [bookingId, idxs] of rowsOf) {
		if (idxs.length < 2) continue; // a single-table booking is already one block
		// Cut into maximal contiguous runs.
		let runStart = 0;
		for (let i = 1; i <= idxs.length; i++) {
			const breaks = i === idxs.length || idxs[i] !== idxs[i - 1] + 1;
			if (!breaks) continue;
			const run = idxs.slice(runStart, i);
			runStart = i;
			if (run.length < 2) continue;
			// Merge only across plain single-lane rows — see the note at the top.
			if (run.some((r) => (rows[r].laneCount || 1) !== 1)) continue;
			const head = blockKey(bookingId, rows[run[0]].tableId);
			spanOf.set(head, run.length);
			unitsOf.set(
				head,
				run.reduce((n, r) => n + (rows[r].laneCount || 1), 0)
			);
			for (const r of run.slice(1)) hidden.add(blockKey(bookingId, rows[r].tableId));
		}
	}

	return { spanOf, unitsOf, hidden };
}
