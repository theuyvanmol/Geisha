// THE "TO COME" FIGURE BESIDE A SERVICE'S PAX.
//
// Owner, 7 Oct 2026: "Can you put another number that decreases once we sit people? So for
// example around 6pm we know how many other covers are left to come." The Pax beside a
// service is everything booked into it, so it barely moves during service; this is the
// part of it that hasn't been sat yet. "Dinner 91 Pax · 64 to come" falls to 0 as the
// room fills.
//
// It is in COVERS, like the Pax it sits beside (see walkinFigure.ts for what happened
// the last time two units shared that strip).

/**
 * Is this party still to be sat? It goes by the SEAT, because that is what the owner asked
 * the number to follow: a party parked in the bar, or flagged "table ready", has not been
 * sat and still counts. A part-seated party counts as sat — some of it is at the table and
 * the board can't say how many are not.
 *
 * Read off `arrival`, not `status`: a tap on Seat or Unseat patches the bar's arrival on
 * the click and its status only once the server has answered, so going by status would
 * leave the number a beat behind the board.
 */
export function stillToCome(bar: { status: string; arrival: string }): boolean {
	if (bar.status === 'cancelled' || bar.status === 'no_show') return false;
	return (
		bar.arrival === 'unarrived' ||
		bar.arrival === 'late' ||
		bar.arrival === 'waiting_bar' ||
		bar.arrival === 'table_ready'
	);
}

/** The figure as the header shows it, and the words that go in the service's hover text. */
export function toComeFigure(toCome: number, pax: number): { text: string; title: string } {
	const title =
		toCome > 0 ? `${toCome} still to be seated` : pax > 0 ? 'everyone seated' : 'nobody booked yet';
	return { text: `${toCome} to come`, title };
}
