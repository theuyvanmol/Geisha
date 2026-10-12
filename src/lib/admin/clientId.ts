// CLIENT ID — "which device/tab made this change?"
//
// The realtime store must tell ITS OWN echo (a change this tab just made, already applied
// optimistically) from a change made on ANOTHER device (which must be pulled in). Getting
// that wrong is expensive in both directions: re-pulling your own echo causes the redraw
// flicker the diary spent many commits killing, while suppressing someone else's change
// leaves your board silently stale — the "I had to refresh to see their bookings" bug.
//
// It used to be guessed from TIMING (ignore everything for 4s after a local action), which
// cannot distinguish the two: any change a colleague made inside that window was dropped
// on the floor and never re-pulled.
//
// So we stamp it instead. Every action this tab POSTs carries this id in a header; the
// server records it on the pulse row it bumps (src/lib/server/booking/pulse.ts); the
// realtime store ignores exactly the pulses carrying its own id and re-pulls on every
// other. No windows, no guessing.
//
// Per TAB, not per browser: two diaries open side by side are genuinely two boards, and
// each must re-pull for the other's edits.

/** Header carrying the acting tab's id on every mutating request. */
export const CLIENT_ID_HEADER = 'x-geisha-client';

/** This tab's id. Empty on the server (there is no acting tab during SSR). */
export const CLIENT_ID: string =
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Merge the client-id header into a fetch headers object. */
export function withClientId(headers: Record<string, string> = {}): Record<string, string> {
	return { ...headers, [CLIENT_ID_HEADER]: CLIENT_ID };
}
