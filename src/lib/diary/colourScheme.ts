// Diary colour schemes (ResDiary parity) — PURE so the diary component imports it
// AND the unit tests cover it without a browser.
//
// ResDiary lets staff repaint the grid bars by one of several "colour schemes"
// (the dropdown top-right of the diary): Arrival Status, Confirmation, Preorder
// Status, Payment Info, Channels, Important, Large Party. Each scheme maps a
// booking to a BAND, and each band has a fill + ink colour. The component sets the
// bar's `--bar` / `--bar-ink` custom properties from `bandColours(scheme, bar)`.
//
// `arrival` is the default and the CSS still owns its palette via the `.arr-*`
// classes, so this module only needs to PAINT the other schemes; for `arrival` it
// returns null and the component leaves the CSS classes to do the colouring.
//
// COLOURS: every band below is one of the --rd-* tokens in src/lib/theme/admin.css
// (the ResDiary-aligned service palette — see the long comment there for where the
// values come from). They're repeated as literals here because this module is pure
// TS painting inline styles and can't read a custom property; the token block is
// the source of truth, so change a value THERE and mirror it here.

import type { DiaryColourScheme, DiaryPaymentStatus } from '$lib/server/booking/admin';
// A bar's startsAt arrives in PocketBase's space-separated form, which only V8
// parses — see $lib/bookings/datetime. new Date() on it is Invalid Date on iOS, and a
// NaN start silently made `nowMs > startMs` false, so a late party never turned red
// on the very devices the floor uses.
import { bookingMs } from '$lib/bookings/datetime';

export type { DiaryColourScheme };

/** The subset of a DiaryBar this module needs to choose a colour. */
export interface ColourableBar {
	arrival: string;
	channel: string;
	partySize: number;
	confirmed: boolean;
	hasPreorder: boolean;
	important: boolean;
	paymentStatus: DiaryPaymentStatus;
}

export interface BarColour {
	bar: string; // fill
	ink: string; // text/foreground
	label: string; // legend label for this band
}

export const SCHEME_LABELS: Record<DiaryColourScheme, string> = {
	arrival: 'Arrival status',
	service: 'Service status',
	confirmation: 'Confirmation',
	preorder: 'Preorder',
	payment: 'Payment',
	channel: 'Channel',
	important: 'Important',
	large_party: 'Large party'
};

export const SCHEMES: DiaryColourScheme[] = [
	'service',
	'arrival',
	'confirmation',
	'preorder',
	'payment',
	'channel',
	'important',
	'large_party'
];

// --- Channels -------------------------------------------------------------
// ResDiary's booking bar carries a coloured square on its LEFT edge holding the
// covers; the square's colour is the booking's CHANNEL — where the booking came
// from. The square answers one question, and the house wants it answered in two
// colours: YELLOW = the guest booked it themselves on the site. BLUE = we booked
// it — a walk-in seated at the door, a phone call, the pass, the assistant; it
// makes no odds, a member of staff put it in the diary.
//
// These are the same colours the `channel` COLOUR SCHEME paints whole bars with,
// so the square and the scheme can never drift apart: both come from here, as
// does the square in the booking card.

const ONLINE: BarColour = { bar: '#ffeb66', ink: '#453d00', label: 'Online' }; // --rd-online
const INTERNAL: BarColour = { bar: '#93c7fa', ink: '#0c2b47', label: 'Internal' }; // --rd-internal
const CHANNEL_OTHER: BarColour = { bar: '#d7c7a9', ink: '#3a3020', label: 'Other' }; // ResPhone tan

const CHANNEL_COLOUR: Record<string, BarColour> = {
	online: ONLINE,
	web: ONLINE,
	// every staff-entered channel shares the one blue band
	internal: INTERNAL,
	phone: INTERNAL,
	resphone: INTERNAL,
	ai: INTERNAL,
	staff: INTERNAL,
	walkin: INTERNAL
};

/** The legend bands, in the order staff read them. */
export const CHANNEL_BANDS: BarColour[] = [ONLINE, INTERNAL, CHANNEL_OTHER];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** The colour band for a channel label ('Online', 'Walk-in', 'Internal', …). */
export function channelColour(channel: string): BarColour {
	return CHANNEL_COLOUR[norm(channel ?? '')] ?? CHANNEL_OTHER;
}

// --- the remaining schemes' bands ----------------------------------------
// Declared once and shared by barColour() + schemeLegend() so a bar and the key
// below it can never disagree about what a colour means. Fills are --rd-* tokens.
//
// ResDiary reuses ONE ramp across every scheme, and the meanings are positional:
// cyan = nothing has happened yet, green = the good/complete end, amber = acted
// upon, pink = the problem end, grey = spent. Follow that grammar for anything
// added here; it is what lets someone read a scheme they've never opened before.

const CYAN = '#77d9ff'; // "nothing set yet" — Unconfirmed / No payments / Normal / Standard
const CYAN_INK = '#05384d';
const GREEN = '#88d435'; // arrived / fully paid / important
const GREEN_INK = '#1b3300';
const AMBER = '#ffad00'; // confirmed / waiting in bar
const AMBER_INK = '#402a00';
const PINK = '#ff6682'; // late / outstanding — ResDiary's problem colour, NOT the alert red
const PINK_INK = '#4d0010';
const GREY = '#d5d5d5'; // spent / finished
const GREY_INK = '#333333';
const PARTY_AMBER = '#f6a804'; // ResDiary's Complete Area
const PARTY_AMBER_INK = '#402a00';

// NOTE: ResDiary paints Confirmed AMBER and Unconfirmed CYAN — not the green/yellow
// pairing a "confirmed = good" reading would suggest. Amber is its "someone has
// acted on this" colour, and confirmation is an action, not an outcome.
const CONFIRMED: BarColour = { bar: AMBER, ink: AMBER_INK, label: 'Confirmed' };
const UNCONFIRMED: BarColour = { bar: CYAN, ink: CYAN_INK, label: 'Unconfirmed' };
const PREORDER_DONE: BarColour = { bar: GREEN, ink: GREEN_INK, label: 'Completed' };
const PREORDER_NONE: BarColour = { bar: CYAN, ink: CYAN_INK, label: 'Incomplete' };
const PAID: BarColour = { bar: GREEN, ink: GREEN_INK, label: 'Fully paid' };
const OUTSTANDING: BarColour = { bar: PINK, ink: PINK_INK, label: 'Outstanding' };
const UNPAID: BarColour = { bar: CYAN, ink: CYAN_INK, label: 'No payment' };
const HAS_NOTES: BarColour = { bar: GREEN, ink: GREEN_INK, label: 'Has notes' };
const NO_NOTES: BarColour = { bar: CYAN, ink: CYAN_INK, label: 'No notes' };
const STANDARD_PARTY: BarColour = { bar: CYAN, ink: CYAN_INK, label: 'Standard' };

// --- Service status (ours, not one of ResDiary's schemes) ----------------------
// A calm booking-LIFECYCLE palette: a booking that simply hasn't arrived yet is
// "Booked", NOT alarming — only a genuine no-show goes pink. This is the difference
// from the `arrival` scheme, which paints every past-its-time-but-unseated booking
// "Late" (a wall of pink on a busy or past day). Keyed off the same `arrival` value
// the board already derives, remapped so lateness never dominates the colour.
//
// The bands are ResDiary's exact colours even though the scheme is ours, so someone
// switching between the two schemes never has to relearn what a colour means. Booked
// is the cyan (ResDiary's own "nothing has happened yet"), which also frees the
// yellow that used to collide with Partially seated.
const MINT = '#81e4b8'; // ResDiary's Concierge — unused by us, so free for "held"
const SVC_BOOKED: BarColour = { bar: CYAN, ink: CYAN_INK, label: 'Booked' };
const SVC_IN_BAR: BarColour = { bar: AMBER, ink: AMBER_INK, label: 'In bar' };
const SVC_TABLE_READY: BarColour = { bar: MINT, ink: '#04372a', label: 'Table ready' };
const SVC_SEATED: BarColour = { bar: GREEN, ink: GREEN_INK, label: 'Seated' };
const SVC_PART_SEATED: BarColour = { bar: '#ffeb66', ink: '#453d00', label: 'Part-seated' };
const SVC_FINISHED: BarColour = { bar: GREY, ink: GREY_INK, label: 'Finished' };
const SVC_NO_SHOW: BarColour = { bar: PINK, ink: PINK_INK, label: 'No-show' };

/** Map a bar's arrival value to its Service-status band. */
function serviceColour(arrival: string): BarColour {
	switch (norm(arrival)) {
		case 'noshow':
			return SVC_NO_SHOW;
		case 'left':
			return SVC_FINISHED;
		case 'arrived':
			return SVC_SEATED;
		case 'partiallyseated':
			return SVC_PART_SEATED;
		case 'waitingbar':
			return SVC_IN_BAR;
		case 'tableready':
			return SVC_TABLE_READY;
		default:
			// unarrived / late / anything upcoming — a calm "Booked", never red.
			return SVC_BOOKED;
	}
}
const largeParty = (min: number): BarColour => ({
	bar: PARTY_AMBER,
	ink: PARTY_AMBER_INK,
	label: `Large (${min}+)`
});

// --- LATE, right now ------------------------------------------------------
// Owner: "booked at 7pm and not here in time — from 7.00 and 1 second it needs to turn
// red, so it's more visible for us when it's busy."
//
// This is deliberately NOT a scheme. A late table is an ALERT, and the floor needs to
// see it whichever scheme happens to be on the screen, so the diary paints it over the
// top of whatever colour the scheme chose (`.bar.late-now`). Kept here, pure, because
// it is a colour decision and because the board it runs against is live production data
// — the only way to pin the rule down is a test.

/** Arrival states that mean THE GUEST IS NOT HERE. Waiting in the bar or a part-seated
 *  party has arrived; left/no-show are settled. Only these two are still outstanding. */
const NOT_HERE_YET = new Set(['unarrived', 'late']);

/**
 * Is this booking past its start with nobody here — as of `nowMs`?
 *
 * `live` is the caller's "the clock is inside the day on screen" flag: on any date other
 * than today every unseated booking is trivially past its time, and lighting all of them
 * up would drown the one that matters. No grace period — the owner wants the second it
 * ticks past, not ten minutes later.
 */
export function isLateNow(
	bar: { arrival: string; startsAt: string },
	nowMs: number,
	live: boolean
): boolean {
	if (!live) return false;
	if (!NOT_HERE_YET.has(norm(bar.arrival))) return false;
	const startMs = bookingMs(bar.startsAt);
	return startMs !== null && nowMs > startMs;
}

/**
 * The colour a bar should paint under `scheme`. Returns null for the `arrival`
 * scheme (the CSS `.arr-*` classes own that palette) — the component then leaves
 * the inline custom-props unset. For every other scheme it returns an explicit
 * fill/ink the component writes to `--bar` / `--bar-ink`.
 *
 * `largePartyMin` (default 8) is the threshold for the Large Party scheme.
 */
export function barColour(
	scheme: DiaryColourScheme,
	bar: ColourableBar,
	largePartyMin = 8
): BarColour | null {
	switch (scheme) {
		case 'arrival':
			return null; // CSS .arr-* classes colour this
		case 'service':
			return serviceColour(bar.arrival);
		case 'confirmation':
			return bar.confirmed ? CONFIRMED : UNCONFIRMED;
		case 'preorder':
			return bar.hasPreorder ? PREORDER_DONE : PREORDER_NONE;
		case 'payment':
			return bar.paymentStatus === 'paid'
				? PAID
				: bar.paymentStatus === 'outstanding'
					? OUTSTANDING
					: UNPAID;
		case 'channel':
			return channelColour(bar.channel);
		case 'important':
			return bar.important ? HAS_NOTES : NO_NOTES;
		case 'large_party':
			return bar.partySize >= largePartyMin ? largeParty(largePartyMin) : STANDARD_PARTY;
	}
}

/**
 * The legend bands for a scheme (label + swatch), so the diary can render a key
 * that matches the active scheme. For `arrival` the component uses its own static
 * strip; this returns the bands for every other scheme.
 */
export function schemeLegend(scheme: DiaryColourScheme, largePartyMin = 8): BarColour[] {
	switch (scheme) {
		case 'arrival':
			return [];
		case 'service':
			return [
				SVC_BOOKED,
				SVC_IN_BAR,
				SVC_TABLE_READY,
				SVC_SEATED,
				SVC_PART_SEATED,
				SVC_FINISHED,
				SVC_NO_SHOW
			];
		case 'confirmation':
			return [CONFIRMED, UNCONFIRMED];
		case 'preorder':
			return [PREORDER_DONE, PREORDER_NONE];
		case 'payment':
			return [PAID, OUTSTANDING, UNPAID];
		case 'channel':
			return CHANNEL_BANDS;
		case 'important':
			return [HAS_NOTES, NO_NOTES];
		case 'large_party':
			return [largeParty(largePartyMin), STANDARD_PARTY];
	}
}
