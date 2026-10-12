// WHICH SERVICE COLUMN A DIARY BAR COUNTS IN.
//
// The header's per-service figures ("Dinner 132/180 Pax", the walk-in split) have
// to agree with the run-sheet and the reports, which read the service STORED on
// the booking. Reading it off the grid instead — the last band that has begun by
// the bar's start — disagrees the moment the two can differ: a Fusion walk-in
// seated at 16:50 is stored under Dinner (lunch ended at 16:45) but its bar, snapped
// back to the 16:45 cell, starts inside Lunch's band.
//
// So the stored service wins, and the band is the fallback for a bar that has none
// (an optimistic bar drawn from the tap, before the server has answered).

export interface PeriodBand {
	periodId: string;
	/** Minutes from the grid's left edge to where this service starts. */
	startMin: number;
}

export function barPeriodId(
	bar: { periodId?: string; startMin: number },
	bands: PeriodBand[]
): string {
	if (bands.length === 0) return '';
	// Only a service the grid is actually drawing: a booking filed under one that
	// isn't on this axis would tally a column the header cannot show.
	if (bar.periodId && bands.some((b) => b.periodId === bar.periodId)) return bar.periodId;
	let pid = bands[0].periodId;
	for (const b of bands) if (bar.startMin >= b.startMin) pid = b.periodId;
	return pid;
}
