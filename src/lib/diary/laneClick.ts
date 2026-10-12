// What a click on an empty diary cell opens: the WALK-IN form or the BOOKING form.
//
// Owner request (Simone, 16 Sep 2026): a walk-in only makes sense for "now". At 3pm,
// clicking 3:00 or 3:15 should seat a walk-in, but clicking 3:30 means the host is
// taking a booking, so the booking form should open instead of the walk-in form.
//
//   • a cell starting no more than WALKIN_WINDOW_MIN after now → walk-in
//   • earlier today (London)                               → walk-in (a host catching
//                                                             up on a party already sat)
//   • later today beyond the window, or any other day       → booking
//
// "Today" is the London calendar day of `now`; the lower bound is its midnight, so
// at 23:55 the 00:00 slot (tomorrow, 5 minutes away) is still a walk-in.

export const WALKIN_WINDOW_MIN = 15;

function londonDay(ms: number): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/London',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(ms));
}

/** @param cellMs the clicked cell's start instant; @param nowMs the current instant. */
export function laneClickOpens(cellMs: number, nowMs: number): 'walkin' | 'book' {
	if (cellMs > nowMs + WALKIN_WINDOW_MIN * 60_000) return 'book';
	return londonDay(cellMs) >= londonDay(nowMs) ? 'walkin' : 'book';
}
