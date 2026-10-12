// How close to a booking a cancellation counts as LATE — the one definition, in
// a module BOTH the server and the browser can import.
//
// It lived only in $lib/server/booking/policy.ts, which client code cannot import
// (SvelteKit refuses $lib/server in the browser bundle). So the cancel dialogs
// each hard-coded their own `8 * 3600 * 1000` and drifted: the window moved to 12
// hours when we found the WordPress page and ResDiary's payment T&Cs disagreed
// (see policy.ts), and the dialogs were never updated. A host cancelling a
// booking 10 hours out was shown "In-time cancellation — the deposit is
// refunded" while the server kept the money.
//
// policy.ts re-exports these, so there is still exactly one number.

/** Hours before the start inside which a cancellation is "late". */
export const LATE_CANCELLATION_HOURS = 12;

/** The window as a guest-facing phrase, e.g. "12 hours". */
export const LATE_CANCELLATION_LABEL = `${LATE_CANCELLATION_HOURS} hours`;

/** Is a cancellation late? Shared by the policy engine and the cancel dialogs. */
export function isLateCancellationAt(startsAtMs: number, nowMs: number): boolean {
	return startsAtMs - nowMs < LATE_CANCELLATION_HOURS * 60 * 60 * 1000;
}
