// WALK-IN CLASSIFIER — the single answer to "was this party seated off the
// street rather than reserved ahead?".
//
// Its own leaf module (no imports) because three layers need it and two of them
// already import each other: reporting.ts imports admin.ts, so admin.ts cannot
// import reporting.ts back. Every screen that asks the question must get the
// same answer — the run-sheet's headline split, the Reservations-vs-Walk-ins
// report, and the diary's channel colour square — or the floor gets three
// different walk-in counts for one service and no way to tell which is right.

/**
 * The placeholder guest a walk-in is filed under when nobody takes a name.
 *
 * Anchored and whole-string on purpose: it must match the "Walk In" / "Walk-in"
 * placeholder records and NOTHING else. Real guests on this book include
 * "Alice Walk", "Jodi Walker" and "bruce walker" — a substring test would seat
 * all three off the street.
 */
const WALKIN_GUEST = /^\s*walk[\s-]?in\s*$/i;

/** The minimum a booking has to look like for the classifier to read it. */
export interface WalkinCandidate {
	source?: string | null;
	channel?: string | null;
	expand?: { customer?: { name?: string } | null } | null;
}

/**
 * Was this party seated off the street rather than reserved ahead?
 *
 * THREE tests, because a walk-in reaches the book by three different routes:
 *
 *  - `source: 'walkin'`   — the diary/floor one-tap seat.
 *  - `channel: 'Walk-in'` — an import, or a hand-typed row.
 *  - the guest is the walk-in PLACEHOLDER — a host who opened the ordinary Book
 *    form and typed "Walk In" as the name. That path stamps `source: 'phone'`,
 *    so the party read as a phone reservation in every total while the run-sheet
 *    listed it, by name, as a walk-in: two such parties on the sheet, "1 walk-in
 *    (2)" in the header. The guest name is the only signal such a row carries.
 *
 * Needs `expand.customer` to see the third. Callers that don't expand the guest
 * still get the first two, exactly as before.
 */
export function isWalkinBooking(b: WalkinCandidate): boolean {
	if ((b.source || '') === 'walkin') return true;
	const channel = (b.channel || '').trim().toLowerCase();
	if (channel === 'walk-in' || channel === 'walkin') return true;
	return WALKIN_GUEST.test(b.expand?.customer?.name || '');
}
