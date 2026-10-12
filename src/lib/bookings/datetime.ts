// PARSING A BOOKING'S DATETIME IN THE BROWSER.
//
// PocketBase serialises a `date` field as `2026-09-02 12:00:00.000Z` — a SPACE
// between the date and the time, not the `T` that ISO 8601 requires. We hand those
// strings to the client verbatim (a diary bar's `startsAt`/`endsAt`, and the window
// every write action echoes back), so every `new Date(value)` on the client is at
// the mercy of that engine's non-standard date parsing.
//
// V8 accepts the space. JavaScriptCore does NOT: on Safari and on every iOS browser
// — which is what the floor runs — `new Date('2026-09-02 12:00:00.000Z')` is an
// Invalid Date. `getTime()` is then NaN, and NaN is the worst possible failure here
// because it is not null and not falsy: it slides through every `?? fallback` and
// ends up in the DOM as `left: NaNpx`, which the browser drops, dropping the bar at
// the left edge of its lane. That is the "the booking jumped to 12" report, and it
// only ever happened on the host's own screen because the DB never saw the NaN.
//
// So: parse both forms, and return NULL — never an Invalid Date, never NaN — when a
// value genuinely will not parse, so the caller's fallback actually fires.

/** `YYYY-MM-DD<sep>HH:mm[:ss[.sss]][zone]`, with `sep` a space or a `T`. */
const DATETIME =
	/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parse a booking datetime that may arrive in either ISO 8601 or PocketBase's
 * space-separated form. A value with no zone is read as UTC — that is how
 * PocketBase stores every instant, and reading it as local time would silently
 * shift a sitting by the offset.
 *
 * @returns the instant, or `null` if the value is empty or unparseable.
 */
export function parseBookingDate(value: string | null | undefined): Date | null {
	if (!value) return null;
	const raw = String(value).trim();
	if (!raw) return null;

	const m = DATETIME.exec(raw);
	if (m) {
		const [, y, mo, d, h, mi, s, ms, zone] = m;
		// Normalise to a form every engine agrees on, defaulting an absent zone to UTC.
		const iso = `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}.${(ms ?? '0').padEnd(3, '0')}${
			zone ? (zone === 'Z' ? 'Z' : zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : 'Z'
		}`;
		const t = Date.parse(iso);
		return Number.isNaN(t) ? null : new Date(t);
	}

	// Anything else (a bare date, an engine-specific format) — let the engine try,
	// but still refuse to hand back an Invalid Date.
	const t = Date.parse(raw);
	return Number.isNaN(t) ? null : new Date(t);
}

/** {@link parseBookingDate} as epoch milliseconds. `null`, never `NaN`, on failure. */
export function bookingMs(value: string | null | undefined): number | null {
	return parseBookingDate(value)?.getTime() ?? null;
}
