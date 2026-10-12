// amendBooking — the single canonical write path for CHANGING an existing
// reservation's date / time / party / requests (WP-S9-1).
//
// Admin, the AI agent, and guest self-service all funnel through here so none of
// them hand-roll an update that skips the availability re-check. Like create.ts
// we guard the allocate-then-write step with the multi-instance advisory lock
// (db/lock.ts) and re-check occupancy immediately before writing, so two
// concurrent amends/creates can't grab the same table.
//
// The booking being amended is EXCLUDED from the occupancy footprint before
// re-allocation — otherwise a no-op or party-size-only change would self-block on
// its own current table (the classic amend bug, covered by an explicit test).
//
// Payment side-effects are intentionally NOT applied here: we recompute the
// requirement and return `paymentChanged` so the caller decides (self-service
// routes to a deposit step; admin handles it manually). Releasing an obsolete
// hold when the party drops below a band is likewise left to the caller calling
// releaseHold().

import { addMinutes } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { pb } from '../db/pb.js';
import { acquireLock, releaseLock } from '../db/lock.js';
import type { AuditActor, Booking, Customer, Payment, Restaurant } from '../db/types.js';
import {
	allocateTables,
	turnMinutesFor,
	sectionCloseoutFootprints,
	OCCUPANCY_MARGIN_MIN,
	type BookingFootprint
} from './availability.js';
import { isPeriodClosed } from './closures.js';
import { manualSeatPeriod, periodForSeat } from './periodFallback.js';
import { getTableRanksById } from './ranking.js';
import { getChainsByRestaurant } from './chains.js';
import { getAutoJoinByRestaurant, policyFor } from './autojoin.js';
import { exceedsOnlineCap, paymentRequirementFor, type PaymentRequirement } from './policy.js';
import { selectPacingRule, slotWithinSlotCap, withinPeriodCap } from './pacing.js';
import {
	getActivePeriods,
	getClosures,
	getDepositRules,
	getJoins,
	getOccupyingBookings,
	getOccupyingBookingsWithId,
	getPacingRules,
	getSettings,
	getTables
} from './queries.js';
import { writeAudit } from './audit.js';
import { isBlockedContact } from './crm.js';
import { BookingError, applyAllergyFlagsForBooking } from './create.js';
import { syncFloorStateTables } from './mutate.js';
import { sendBookingAmended, confirmationExtras } from '../email/confirmations.js';
import { deferWork } from '../util/defer.js';

// --- shared advisory lock (multi-instance, via geisha_locks) -----------------
// Same helper create.ts uses: serialises allocate+write across ALL instances.
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const handle = await acquireLock(`booking:${key}`, 10_000, 8_000);
	try {
		return await fn();
	} finally {
		await releaseLock(handle);
	}
}

/** Statuses that may be amended. `seated` is admin-only — gated by the caller. */
const AMENDABLE_STATUSES = ['pending_payment', 'confirmed', 'seated'] as const;
/** What a GUEST may amend from /book/[token]: a booking that is still just a
 *  reservation. `seated` means the party is in the building and `completed` means
 *  they have been and gone — neither is something to reschedule from a web page,
 *  and letting a guest move a seated booking dragged the live floor plan with it
 *  (the deferred syncFloorStateTables follows booking.tables). Deliberately the
 *  same set as SELF_SERVICE_STATUSES in selfservice.ts, which decides whether the
 *  page even offers the button. */
const SELF_SERVICE_AMENDABLE = ['pending_payment', 'confirmed'] as readonly string[];
/** Statuses a STAFF diary edit (drag-to-move, drag-to-resize, re-time, swap, batch
 *  commit) accepts. Adds `completed` so a FINISHED ("closed") sitting can still be
 *  moved to another table or lengthened/shortened from the diary — the owner's case:
 *  the table closes and turns its finished colour, then the host realises the party
 *  was recorded on the wrong table (or stayed longer) and has to correct it. ResDiary
 *  allows the same. `cancelled`/`no_show` stay pinned: there is nothing on the floor
 *  to move. Guest self-service amends keep the strict AMENDABLE_STATUSES. */
const AMENDABLE_FOR_AMEND = [...AMENDABLE_STATUSES, 'completed'] as readonly string[];
/** Statuses whose floor_state rows must follow a table change: a live seated party,
 *  and a FINISHED sitting whose table the host is correcting from the diary (its rows
 *  are cleared, but they still record which table that party actually used). */
const holdsFloorState = (status: string): boolean => status === 'seated' || status === 'completed';

export interface AmendBookingInput {
	/** The booking to change. */
	bookingId: string;
	/** New local date 'YYYY-MM-DD'. Omit to keep the current date. */
	date?: string;
	/** New local time 'HH:mm'. Omit to keep the current time. */
	time?: string;
	/** New party size. Omit to keep the current size. */
	partySize?: number;
	/** New special requests. Omit to leave unchanged. */
	specialRequests?: string;
	/** New occasion. Omit to leave unchanged. */
	occasion?: string;
	/**
	 * New promotion LABEL (ResDiary's "Promotion" on the booking form), or '' to
	 * clear it. Omit to leave unchanged.
	 *
	 * The label, not an option id, because that is what the column holds and what
	 * the online path writes — see createBooking. Storing the id here would give
	 * the diary two things to understand instead of one.
	 */
	promotion?: string;
	/**
	 * PIN the booking to these exact tables instead of auto-allocating (diary
	 * drag-to-move: the host dropped the bar on a specific table/row). The set is
	 * still re-validated against the recomputed window — every table must fit the
	 * party and be free for [start, end) (the booking itself is excluded from the
	 * occupancy footprint), else NO_AVAILABILITY. Omit to keep today's behaviour
	 * (auto-allocate the best table for the new time). Staff-only by convention —
	 * the caller gates the role.
	 */
	tableIds?: string[];
	/**
	 * ResDiary "increase covers without table reassignment": when pinned `tableIds`
	 * are supplied AND this is true, KEEP those tables even if the (grown) party now
	 * exceeds their combined capacity — the host has decided the party fits in
	 * practice. Free-for-the-window is STILL enforced (we never silently double-book
	 * the table); only the seats-fit ceiling is waived. Ignored without `tableIds`.
	 */
	allowOverfill?: boolean;
	/**
	 * Pin the booking's CURRENT tables without the caller having to read them first.
	 * Equivalent to passing `tableIds: <the booking's own tables>`; ignored when
	 * `tableIds` is given.
	 *
	 * PERF (Sep 2026): a change-covers amend keeps the same tables, and the only reason
	 * the diary read the booking beforehand was to name them — a whole extra round trip to
	 * the droplet (with a customer expand it never used) for the very row this function
	 * then re-reads as `before`. The covers write measures ~3.2s on production, which is
	 * ~11 sequential PocketBase round trips; this was one of them, and pure duplication.
	 */
	keepTables?: boolean;
	/**
	 * Explicit dining duration in minutes (ResDiary drag-to-resize: the host dragged
	 * the bar's right edge to shorten/lengthen the sitting). Overrides the party-size
	 * turn time for this booking only. Clamped to a sane floor (>= 15) by the caller;
	 * omit to use the standard turn for the (new) party size. Staff-only by convention.
	 */
	durationMinutes?: number;
	/**
	 * Edit a booking that sits on a CLOSED date/service. A closure stops new demand
	 * arriving; it was never meant to freeze the bookings the restaurant chose to take
	 * anyway (the owner's Christmas case — closed to the public, filled by phone). The
	 * diary sends this on every staff edit, so a manually-added booking on a closed day
	 * can still be moved, resized and re-tabled. Never honoured for `actor: 'customer'`.
	 */
	allowClosed?: boolean;
	/**
	 * MOVE the booking to another venue (ResDiary "change venue": Asia ↔ Fusion).
	 * Omit, or pass the booking's own restaurant, for an ordinary amend.
	 *
	 * The SAME row changes `restaurant`, so everything keyed by the booking id —
	 * crucially its geisha_payments row, i.e. a deposit already paid online or a card
	 * on file — stays attached and no money moves. ResDiary couldn't carry a deposit
	 * across because its move was a cancel + re-book, and a cancel refunds.
	 *
	 * Tables, service, joins, closures and deposit rules all come from the TARGET
	 * venue. The old venue's tables never come along (their ids don't exist there), so
	 * `keepTables` is ignored; pass the target's `tableIds` or let it auto-allocate.
	 *
	 * Staff only, and only for a booking that is still just a reservation
	 * (`confirmed`): a seated party is in the other building, and a `pending_payment`
	 * guest is mid-checkout against this venue.
	 *
	 * Refunds and charges pick their Stripe key from the booking's CURRENT venue
	 * (payments.ts brandForBooking). Both brands share one Stripe account, so that's
	 * the same key either way. If the brands are ever split onto separate accounts, a
	 * moved booking's payment must remember the account it was taken on first.
	 */
	restaurantId?: string;
	/** Who is making the change (audit trail). Defaults to 'staff'. */
	actor?: AuditActor;
	/** Staff id an 'ai'/'system' amend was performed on behalf of (F3). */
	onBehalfOf?: string;
}

export interface AmendBookingResult {
	booking: Booking;
	/** The payment requirement AFTER the amend (under the new party/date). */
	payment: PaymentRequirement;
	/**
	 * True when the payment requirement changed band (kind OR amount differs from
	 * the existing payment row). The caller is responsible for any capture /
	 * refund / new-deposit step — amendBooking never moves money itself.
	 */
	paymentChanged: boolean;
}

/** Format an absolute instant as local 'HH:mm' in `tz` (mirrors availability.ts). */
function localHHmm(instant: Date, tz: string): string {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: tz,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(instant);
	const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
	return `${hh}:${mm}`;
}

/** Format an absolute instant as local 'YYYY-MM-DD' in `tz`. */
function localDate(instant: Date, tz: string): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(instant);
	const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
	const m = parts.find((p) => p.type === 'month')?.value ?? '01';
	const d = parts.find((p) => p.type === 'day')?.value ?? '01';
	return `${y}-${m}-${d}`;
}

/**
 * Would this amend ask the guest for money they haven't already put up?
 *
 * Compared on AMOUNT, not on kind: a party of 6 dropping to 4 on a Friday swaps a
 * £60 deposit for a £20 card guarantee, which is a different instrument but not a
 * new demand — the guest is already further out of pocket than the new rule asks,
 * so refusing that would be obstructive for no gain. Only a genuinely larger
 * figure is refused.
 *
 * No payment row at all means nothing has been put up, so any requirement above
 * 'none' is an increase. A row that exists but never cleared still counts as
 * cover for the SAME figure (its intent is live and the guest is mid-payment),
 * which is what keeps a plain time change working on a pending_payment booking.
 */
function demandsMoreMoney(next: PaymentRequirement, existing: Payment | null): boolean {
	if (next.kind === 'none') return false;
	if (!existing) return true;
	return next.amountPence > existing.amount;
}

/**
 * Did this amendment change anything the GUEST would notice?
 *
 * Exactly the three facts their confirmation states: when they are coming, how
 * many of them, and what they asked us for. Table assignment, service period,
 * allergy denormalisation and the `amended_from` bookkeeping are all internal —
 * the guest was never told which table they were on, so moving them between
 * tables is not news, and an email announcing an "update" with nothing updated
 * is worse than no email at all.
 *
 * Exported for the unit tests; pure, so it needs no database.
 */
export function guestVisibleChange(
	before: Pick<Booking, 'starts_at' | 'party_size' | 'special_requests'>,
	after: Pick<Booking, 'starts_at' | 'party_size' | 'special_requests'>
): boolean {
	if (new Date(before.starts_at).getTime() !== new Date(after.starts_at).getTime()) return true;
	if (before.party_size !== after.party_size) return true;
	return (before.special_requests ?? '') !== (after.special_requests ?? '');
}

/**
 * Re-validate via allocateTables and apply a change to an existing booking,
 * recording the original id in geisha_bookings.amended_from. Throws
 * {@link BookingError} on any rule failure (invalid status, no period, online
 * cap, no availability) — nothing is written in those cases.
 */
export async function amendBooking(input: AmendBookingInput): Promise<AmendBookingResult> {
	const { bookingId } = input;
	const actor: AuditActor = input.actor ?? 'staff';

	const c = await pb();
	const before = await c.collection('geisha_bookings').getOne<Booking>(bookingId);

	// A GUEST gets the reservation-only list; staff/AI get the diary's wider one.
	// This was documented on AMENDABLE_FOR_AMEND above but never actually branched
	// on, so a self-service link could re-time or re-table a party that was SEATED
	// (the deferred syncFloorStateTables then dutifully moved them on the live floor
	// plan mid-service) or reopen a COMPLETED sitting into a future slot.
	const amendable = actor === 'customer' ? SELF_SERVICE_AMENDABLE : AMENDABLE_FOR_AMEND;
	if (!(amendable as readonly string[]).includes(before.status)) {
		throw new BookingError(`A ${before.status} booking can't be amended.`, 'invalid');
	}

	// …and a guest may only touch a booking that hasn't started. Status alone isn't
	// enough: a table that nobody got round to marking `seated` is still a table
	// with people at it.
	if (actor === 'customer' && new Date(before.starts_at).getTime() <= Date.now()) {
		throw new BookingError(
			'This booking has already started, so it can no longer be changed online. Please call us.',
			'invalid'
		);
	}

	// A move to the other venue (see `restaurantId`): staff only, reservations only.
	const moving = !!input.restaurantId && input.restaurantId !== before.restaurant;
	if (moving && actor !== 'staff') {
		throw new BookingError('Only staff can move a booking to another venue.', 'invalid');
	}
	if (moving && before.status !== 'confirmed') {
		throw new BookingError(
			`A ${before.status.replace('_', ' ')} booking can't be moved to another venue.`,
			'invalid'
		);
	}

	// PERF: fetch the restaurant + every restaurant-scoped read this amend needs in
	// ONE parallel wave instead of ~6 serial cross-region round-trips. They only
	// depend on the venue (known), not on each other. getClosures still runs after
	// because it needs the resolved new date. On a move, every one of these is the
	// TARGET venue's.
	const [restaurant, previousVenue] = await Promise.all([
		c
			.collection('geisha_restaurants')
			.getOne<Restaurant>(moving ? input.restaurantId! : before.restaurant),
		moving
			? c.collection('geisha_restaurants').getOne<Restaurant>(before.restaurant)
			: Promise.resolve(null)
	]);
	const tz = restaurant.timezone || 'Europe/London';
	const [settings, periods, tables, joins, chains, autoJoinConfig, tableRanks] = await Promise.all([
		getSettings(restaurant.id),
		getActivePeriods(restaurant.id),
		getTables(restaurant.id),
		getJoins(restaurant.id),
		// staff-authored chains (ResDiary Table Joins), capacity-aware — preferred by
		// the allocator over an ad-hoc combination for a large party.
		getChainsByRestaurant(restaurant.id).catch(() => []),
		// which tables the owner allows the engine to auto-join (/admin/tables)
		getAutoJoinByRestaurant(restaurant.id),
		// getTableRanksById avoids re-resolving the restaurant (getTableRanks(brand) did).
		getTableRanksById(restaurant.id)
	]);
	// A guest changing their own booking is the online channel: staff-only tables
	// (Asia's counter) are never joined for them.
	const autoJoin = policyFor(autoJoinConfig, actor === 'customer' ? 'online' : 'staff');

	// Fields left undefined keep the current value (partial amend). Date/time fall
	// back to the booking's CURRENT local wall-clock derived in the restaurant tz —
	// using the server tz here would shift the slot on a UTC Vercel node.
	const currentStart = new Date(before.starts_at);
	const newDate = input.date ?? localDate(currentStart, tz);
	const newTime = input.time ?? localHHmm(currentStart, tz);
	const newPartySize = input.partySize ?? before.party_size;
	if (newPartySize < 1) throw new BookingError('Party size must be at least 1.', 'invalid');

	const startsAt = fromZonedTime(`${newDate}T${newTime}:00`, tz);
	if (isNaN(startsAt.getTime())) throw new BookingError('Invalid date/time.', 'invalid');
	const startMs = startsAt.getTime();

	// Online cap applies only to guest self-service; admin/AI amends bypass it
	// (mirrors create.ts's input.staff behaviour).
	if (actor === 'customer' && exceedsOnlineCap(newPartySize, settings)) {
		throw new BookingError(
			`Parties over ${settings.online_party_max} must book by phone.`,
			'phone_required'
		);
	}

	// Re-derive the service period exactly as create.ts does: an active period
	// whose day-of-week AND [start_time, last_booking_time] window contain the new
	// start. (`periods` was fetched in the parallel wave above.)
	const dowName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(
		startsAt
	);
	const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dowName);
	// A walk-in keeps being filed by the service RUNNING when it sits (periodForSeat),
	// so moving or resizing one can't quietly re-file it into a service that had
	// already ended — which would undo its filing on the run-sheet.
	let period =
		periodForSeat(periods, dow, newDate, startMs, tz, {
			walkin: (before.source ?? '') === 'walkin'
		}) ?? undefined;
	// Staff amends inherit create.ts's manual-seat leniency, filed by the same rule
	// (manualSeatPeriod: the service running then, else the nearest). Without it,
	// resizing/moving/re-covering a walk-in seated outside every window 409s "No service
	// available at that time" — a lie from the host's perspective, and (via the diary's
	// commit-before-create flush) it also blocks every subsequent walk-in. Guest
	// self-service amends stay strict — those are forward reservations.
	if (!period && actor !== 'customer') {
		period = manualSeatPeriod(periods, dow, newDate, startMs, tz) ?? undefined;
	}
	if (!period) throw new BookingError('No service available at that time.', 'no_period');

	// Every service running on the target DATE — see createBooking: a close-out's window
	// is enforced verbatim, so one filed under Lunch can cover the changeover into Dinner
	// or straddle both. Read across all of them, exactly as the availability engine does.
	const periodsForDay = periods.filter((p) => p.days_of_week?.includes(dow));
	if (!periodsForDay.some((p) => p.id === period.id)) periodsForDay.push(period);

	// Closures refuse ALL sources (physical, not a policy relaxation) — unless this is a
	// STAFF edit of a booking on a closed day (see `allowClosed`).
	const closures = await getClosures(restaurant.id, newDate, newDate);
	const overrideClosed = actor !== 'customer' && !!input.allowClosed;
	if (!overrideClosed && isPeriodClosed(newDate, period.id, closures)) {
		throw new BookingError('That date/service is closed for bookings.', 'no_period');
	}

	// ---- guest-only guards, mirroring createBooking's online rules --------------
	//
	// createBooking re-asserts these server-side for every ONLINE booking, but an
	// amend applied none of them — so a guest could book a slot the engine WOULD
	// offer and then amend into one it never would: past the online cut-off, beyond
	// the booking window, or into a slot already at its covers cap. Book legally,
	// then move. The wording is deliberately identical to create.ts's, so a guest
	// meets one voice whichever path refuses them.
	//
	// Duplicated rather than shared, matching how this file already re-derives the
	// service period "exactly as create.ts does" — the two paths differ in what
	// they have in hand, and a shared helper would need most of it threaded through.
	if (actor === 'customer') {
		const nowMs = Date.now();
		// The past is not bookable, whatever the lead-time policy says. Both venues
		// run with lead_time_minutes unset (= 0), which disables the branch below.
		if (startMs < nowMs) {
			throw new BookingError('That time has already passed. Please pick a later one.', 'invalid');
		}
		const lead = settings.lead_time_minutes;
		const cutoffAnchorMs =
			settings.lead_time_mode === 'service'
				? fromZonedTime(`${newDate}T${period.start_time}:00`, tz).getTime()
				: startMs;
		if (lead > 0 && cutoffAnchorMs < nowMs + lead * 60_000) {
			throw new BookingError(
				settings.lead_time_mode === 'service'
					? 'Online changes for that service have closed. Please call the restaurant.'
					: 'That time is too soon to book online.',
				'invalid'
			);
		}
		const window = settings.booking_window_days;
		if (window > 0 && startMs > nowMs + window * 86_400_000) {
			throw new BookingError('That date is beyond our booking window.', 'invalid');
		}

		// A guest blocked after a no-show ("No show - Block user") can't book online.
		// Without this they simply amended the booking they already held instead.
		const guest = await c
			.collection('geisha_customers')
			.getOne<Customer>(before.customer)
			.catch(() => null);
		if (guest && (await isBlockedContact(guest.email, guest.phone))) {
			throw new BookingError(
				'We can’t change this booking online. Please call the restaurant.',
				'blocked'
			);
		}
	}

	// Duration, in priority order:
	//  1. an explicit override (drag-to-resize) — floored at 15 min;
	//  2. otherwise, if the PARTY SIZE is unchanged, PRESERVE the booking's current
	//     length — so a plain move (or re-table) keeps a previously-resized sitting
	//     instead of snapping back to the default turn (ResDiary keeps the length);
	//  3. otherwise (party size changed, no override) recompute the party-size turn.
	const currentDurationMin = Math.round(
		(new Date(before.ends_at).getTime() - currentStart.getTime()) / 60_000
	);
	const partyChanged = newPartySize !== before.party_size;
	const turn =
		input.durationMinutes && input.durationMinutes >= 15
			? Math.round(input.durationMinutes)
			: !partyChanged && currentDurationMin >= 15
				? currentDurationMin
				: turnMinutesFor(newPartySize, period);
	const endsAt = addMinutes(startsAt, turn);

	// Recompute the payment requirement under the new party/date and compare it to
	// the EXISTING payment row (if any). We never auto-capture/refund here — the
	// caller decides what to do with paymentChanged.
	//
	// COMPUTED BEFORE THE WRITE, on purpose. It used to run after, which is what
	// made the guest self-service amend a free upgrade: /book/[token] has no
	// payment step, so it wrote the change, discovered a deposit was now due, and
	// merely TOLD the guest to ring — leaving a party of 6 on a Friday `confirmed`
	// having paid nothing. Knowing the requirement up front lets us refuse instead.
	const [depositRules, existingPayment, pacingRules] = await Promise.all([
		getDepositRules(restaurant.id),
		c
			.collection('geisha_payments')
			.getFirstListItem<Payment>(`booking="${bookingId.replace(/"/g, '\\"')}"`)
			.catch(() => null),
		// Only the guest path enforces covers caps (see the lock below); skip the
		// read entirely for staff/AI rather than pay for it on every diary drag.
		actor === 'customer' ? getPacingRules(restaurant.id) : Promise.resolve([])
	]);
	// Gated on a connected payment provider — see requirementIfCollectable(). Without
	// one the rule is inert, so growing a party to 6+ doesn't strand an existing
	// booking in a payment state nobody can clear.
	const { requirementIfCollectable } = await import('./payments.js');
	const payment = await requirementIfCollectable(
		paymentRequirementFor(newPartySize, startsAt, tz, settings, depositRules, period.id),
		restaurant.brand
	);
	const priorKind: PaymentRequirement['kind'] = existingPayment
		? (existingPayment.kind as PaymentRequirement['kind']) || 'none'
		: 'none';
	const priorAmount = existingPayment?.amount ?? 0;
	const paymentChanged = payment.kind !== priorKind || payment.amountPence !== priorAmount;

	// A guest may not amend their way INTO owing us more than they have already
	// settled. Downgrades still work (party 6 → 2), and so does a plain move that
	// leaves the figure alone — only an increase is refused, and it is refused
	// before anything is written. Staff/AI are unaffected: they take the money on
	// the phone, which is exactly what we now ask this guest to do.
	if (actor === 'customer' && demandsMoreMoney(payment, existingPayment)) {
		throw new BookingError(
			payment.kind === 'deposit'
				? `That change needs a deposit of £${(payment.amountPence / 100).toFixed(2)}, which we can’t take on this page. Please give us a ring and we’ll make the change and settle it with you.`
				: 'That change needs card details, which we can’t take on this page. Please give us a ring and we’ll make the change with you.',
			'phone_required'
		);
	}

	// `tables`, `joins`, `tableRanks` were fetched in the parallel wave above.
	// Lock + re-check + write so a concurrent amend/create can't take the same
	// table out from under us between allocate and update.
	const after = await withLock(restaurant.id, async () => {
		// ±300min margin window so a long turn starting either side could overlap.
		const fromISO = addMinutes(startsAt, -OCCUPANCY_MARGIN_MIN).toISOString();
		const toISO = addMinutes(startsAt, OCCUPANCY_MARGIN_MIN).toISOString();
		const occupying = await getOccupyingBookingsWithId(restaurant.id, fromISO, toISO);

		// EXCLUDE the booking being amended from its own footprint — otherwise a
		// no-op / party-only change self-blocks on its current table.
		//
		// BY IDENTITY, not by shape. This used to match on the booking's window+tables
		// as captured in `before` — which is read ~200 lines and several round-trips
		// ABOVE this lock. Anything that wrote the booking in that gap (another edit in
		// the host's burst; a seat or an un-finish, which now restore ends_at) left
		// `before` describing a window the row no longer had, the shape stopped
		// matching, and the booking landed in its OWN occupancy set. Lengthening it
		// then overlapped its own old footprint and was refused with "Table N is
		// already booked during that time" — naming the table it was already sitting on.
		//
		// The shape match was wrong in the other direction too: it keys on window+tables
		// with no id, so two bookings sharing a table set and a window (a walk-in
		// re-tabled onto another party's table) could exclude EACH OTHER and let a real
		// double-book through. getOccupyingBookingsWithId exists for exactly this.
		const existing: BookingFootprint[] = occupying.filter((f) => f.id !== bookingId);
		// Section close-outs (diary "CloseOuts"): treat closed sections' tables as
		// occupied for the service window so a re-allocation or a drag-to-move onto a
		// closed section is refused, same as landing on a taken table. Lifted by the
		// same staff override — on a day closed section-by-section, the host still has
		// to be able to move the bookings they took.
		if (!overrideClosed) {
			existing.push(...sectionCloseoutFootprints(newDate, tz, periodsForDay, tables, closures));
		}

		// `keepTables` resolves to the booking's own tables, so the pinned branch below is
		// the single place that validates a pin however the caller expressed it.
		// A move never keeps its tables: they belong to the venue it is leaving.
		const pinnedIds = input.tableIds?.length
			? input.tableIds
			: input.keepTables && !moving
				? (before.tables ?? []).filter((t) => t && t !== '__unassigned__')
				: [];

		let tableIds: string[] | null;
		if (pinnedIds.length) {
			// PINNED tables (diary drag-to-move; change-covers-on-the-fly): validate the
			// set is free for the new window, mirroring createBooking's manual seat.
			// `existing` already excludes THIS booking, so re-pinning its own table
			// doesn't self-block. The seats-fit ceiling is enforced UNLESS allowOverfill
			// (ResDiary "increase covers without table reassignment") — there the host
			// keeps the table for a bigger party deliberately; we still never overlap.
			const chosen = tables.filter((t) => pinnedIds.includes(t.id));
			const totalMax = chosen.reduce((n, t) => n + t.seats_max, 0);
			const allFree = chosen.every((t) =>
				existing.every(
					(b) =>
						!b.tableIds.includes(t.id) ||
						startsAt.getTime() >= new Date(b.endsAt).getTime() ||
						endsAt.getTime() <= new Date(b.startsAt).getTime()
				)
			);
			const fits =
				input.allowOverfill ||
				totalMax >= newPartySize ||
				keepsOwnFit(pinnedIds, newPartySize, before);
			// Distinguish the failure modes — a blanket "No tables available" is misleading
			// when the real reason is a clash with another booking at the new window (e.g.
			// after lengthening a sitting) or a table too small for the party.
			if (chosen.length !== pinnedIds.length) {
				throw new BookingError('That table is no longer on the floor.', 'no_availability');
			}
			if (!allFree) {
				const label = chosen.map((t) => t.label).join(' + ');
				throw new BookingError(
					`Table ${label} is already booked during that time.`,
					'no_availability'
				);
			}
			if (!fits) {
				const label = chosen.map((t) => t.label).join(' + ');
				throw new BookingError(
					`Table ${label} seats ${totalMax} — too small for a party of ${newPartySize}.`,
					'no_availability'
				);
			}
			tableIds = pinnedIds;
		} else {
			tableIds = allocateTables(startsAt, turn, newPartySize, tables, joins, existing, tableRanks, {
				chains,
				autoJoin
			});
			if (!tableIds) {
				throw new BookingError('No free table fits that party at that time.', 'no_availability');
			}
		}

		// Covers caps, for GUESTS only — the same pure predicates createBooking runs,
		// inside the same lock so two concurrent requests can't both slip past a full
		// slot. Staff and the diary deliberately bypass (a manager seats past a cap by
		// judgement); guests must not, or the pacing the owner asked for is one amend
		// away from meaningless. `existing` already excludes this booking, so we are
		// asking "does the NEW party size fit alongside everyone else".
		if (actor === 'customer') {
			const rule = selectPacingRule(period.id, dow, pacingRules);
			const periodStartMs = fromZonedTime(`${newDate}T${period.start_time}:00`, tz).getTime();
			const periodEndMs = fromZonedTime(`${newDate}T${period.end_time}:00`, tz).getTime();
			if (
				!slotWithinSlotCap(rule, startMs, settings.slot_interval_minutes, newPartySize, existing)
			) {
				throw new BookingError('That time is fully booked.', 'no_availability');
			}
			if (!withinPeriodCap(rule, periodStartMs, periodEndMs, newPartySize, existing)) {
				throw new BookingError('That service is fully booked.', 'no_availability');
			}
		}

		const cc = await pb();
		return cc.collection('geisha_bookings').update<Booking>(bookingId, {
			tables: tableIds,
			party_size: newPartySize,
			starts_at: startsAt.toISOString(),
			ends_at: endsAt.toISOString(),
			service_period: period.id,
			special_requests: input.specialRequests ?? before.special_requests,
			occasion: input.occasion ?? before.occasion,
			// '' rather than undefined when neither side has one: the column is optional,
			// and an undefined here would be sent as a field with no value.
			promotion: input.promotion ?? before.promotion ?? '',
			// Per the F2 schema: record the ORIGINAL booking id this one supersedes.
			amended_from: bookingId,
			// A move re-homes the row, and the new venue's "new booking" bell should
			// ring for it — their host has never seen this party.
			...(moving ? { restaurant: restaurant.id, seen_by_staff: false } : {})
		});
	});

	// The venue it left must drop the bar too. The pulse rings the restaurant named in
	// the written row, which is now the target; without this the old venue's other
	// screens keep showing the party until their next heartbeat.
	if (moving) {
		const { notifyWrite } = await import('./pulse.js');
		notifyWrite('geisha_bookings', { id: bookingId, restaurant: before.restaurant });
	}

	// PERF: the remaining work is all best-effort side-effects the caller never waits
	// on — allergy-flag denorm, the audit row, and the amendment confirmation email
	// (~4-5 serial cross-region round-trips). Run them AFTER the response via
	// deferWork so the diary drag returns as soon as the booking row is written.
	deferWork(async () => {
		// If a SEATED (or finished) booking was moved/re-tabled, its floor_state must
		// follow the new tables or the floor plan + turn board show the party on the OLD
		// table. No-op for an upcoming reservation (no floor_state). Never throws.
		// A change of START also RE-ANCHORS the seat stamp: the diary draws a seated bar
		// from its seat time, so leaving the stamp behind makes the move snap back on the
		// next refresh (see syncFloorStateTables' `reseatAtISO`).
		if (holdsFloorState(after.status)) {
			const reTimed = startsAt.getTime() !== currentStart.getTime();
			await syncFloorStateTables(
				after.id,
				after.tables ?? [],
				new Date().toISOString(),
				reTimed ? after.starts_at : undefined
			);
		}
		// mf-allergy-aware: re-derive allergy/dietary flags from the (possibly changed)
		// requests + the guest's profile so the floor + run-sheet badge tracks it.
		await applyAllergyFlagsForBooking(after.id, after.customer, after.special_requests);
		await writeAudit(
			actor,
			'amend_booking',
			'geisha_bookings',
			bookingId,
			before,
			after,
			input.onBehalfOf
		);
		// ONLY email when something the GUEST can see has changed.
		//
		// Which table a party sits on is a floor decision, not a booking change.
		// Dragging a booking one row down the diary — the single most common thing a
		// host does during service — was sending "Your booking has been updated" with
		// a details block identical to the one already in their inbox and no
		// "Previously:" line, because nothing guest-visible had in fact moved.
		// A change of venue always is: the guest has to go to a different building.
		if (moving || guestVisibleChange(before, after)) {
			const customer = await c.collection('geisha_customers').getOne<Customer>(after.customer);
			await sendBookingAmended(after, customer, restaurant, await confirmationExtras(after), {
				startsAt: before.starts_at,
				partySize: before.party_size,
				venueName: previousVenue?.display_name
			});
		}
	}, 'amend side-effects');

	return { booking: after, payment, paymentChanged };
}

// ---------------------------------------------------------------------------
// swapBookingTables — swap two bookings' tables atomically (diary
// drag-a-bar-onto-another-bar). Two flavours (see the window block below):
//   • HONOR-DROP (opts.newStartA, cross-table): the DRAGGED booking (A) lands at the
//     dropped time on B's table; the bumped partner (B) keeps its OWN time, only its
//     table changes. This is what the host means by "swap the tables, not the times".
//   • POSITIONAL (no newStartA, or a same-table swap): the two TRADE GRID POSITIONS —
//     each takes the OTHER's table AND start time.
// Either way each booking keeps its OWN turn length (a 90-min and a 120-min sitting
// stay 90 and 120, just relocated). This can't be expressed as two
// independent amendBooking calls: whichever writes first would clash with the
// OTHER booking still sitting on the destination table+time (each amend re-checks
// the pinned set is free), so one half always 409s. Here both participants are
// EXCLUDED from each other's occupancy footprint, both are validated at their NEW
// window (free vs everyone else), and both rows are written under one booking lock
// — so a swap is all-or-nothing and never transiently double-books.
//
// OVERSIZE swap (party bigger than the table it lands on): the diary NEVER shrinks
// the party — the covers are the covers. With `allowOverfill` the swap is written as
// asked and the host is left to squeeze the party in (the diary flags the booking
// with a red over-capacity icon). Free-for-the-window is STILL enforced either way —
// only the seats-fit ceiling is waived, exactly as in amendBooking. Without the flag
// an oversize destination is refused (no_availability).
// ---------------------------------------------------------------------------

export interface SwapBookingTablesResult {
	/** Both amended bookings, keyed by their (unchanged) ids. */
	a: Booking;
	b: Booking;
}

export interface SwapBookingTablesOptions {
	actor?: AuditActor;
	onBehalfOf?: string;
	/**
	 * Waive the seats-fit ceiling on BOTH destinations: a party may land on a table
	 * too small for it (the diary's staff drag — the host has decided it fits in
	 * practice). We still never overlap another booking. Party sizes are untouched.
	 */
	allowOverfill?: boolean;
	/**
	 * The DRAGGED booking's (bookingIdA) new start instant as an ISO string. When set on
	 * a cross-table swap, booking A lands at exactly this time (honoring where the host
	 * dropped it) and booking B keeps its OWN time, only changing table. Omit for the
	 * legacy positional swap (each takes the other's start). Ignored on a same-table swap.
	 */
	newStartA?: string;
	/**
	 * Where EACH booking lands, as the diary computed it — both or neither. A swap is the two
	 * parties trading places with each keeping its own number of tables
	 * ($lib/service/joinMove.swapTableSets), which an exchange of the two sets can't express
	 * when the counts differ. Sending the destinations also makes a swap do what the screen it
	 * came from showed: without them a swap from a screen that hadn't caught up with another
	 * swap exchanged whatever the tables were BY THEN, and reversed it (2026-09-11). Omitted by
	 * older diary builds, which get the exchange, as before.
	 */
	targetTablesA?: string[];
	targetTablesB?: string[];
}

export async function swapBookingTables(
	bookingIdA: string,
	bookingIdB: string,
	opts: SwapBookingTablesOptions = {}
): Promise<SwapBookingTablesResult> {
	const actor: AuditActor = opts.actor ?? 'staff';
	const onBehalfOf = opts.onBehalfOf;
	if (bookingIdA === bookingIdB) {
		throw new BookingError('Cannot swap a booking with itself.', 'invalid');
	}
	const c = await pb();
	const beforeA = await c.collection('geisha_bookings').getOne<Booking>(bookingIdA);
	const beforeB = await c.collection('geisha_bookings').getOne<Booking>(bookingIdB);

	// Same rule as the batch: a finished ("closed") sitting can still be swapped onto
	// another table, because the diary now lets staff drag it.
	for (const b of [beforeA, beforeB]) {
		if (!AMENDABLE_FOR_AMEND.includes(b.status)) {
			throw new BookingError(`A ${b.status} booking can't be swapped.`, 'invalid');
		}
	}
	if (beforeA.restaurant !== beforeB.restaurant) {
		throw new BookingError('Both bookings must be in the same restaurant.', 'invalid');
	}

	const restaurant = await c
		.collection('geisha_restaurants')
		.getOne<Restaurant>(beforeA.restaurant);

	// The tables each booking will END UP on: where the diary says (see targetTablesA), or —
	// from an older build that doesn't send them — the OTHER's current tables. Strip the
	// unassigned sentinel so a bar parked in the holding row can still swap onto a
	// real table (but a party can't be "swapped" ONTO nothing).
	const clean = (ids: string[] | undefined) =>
		(ids ?? []).filter((t) => t && t !== '__unassigned__');
	const explicit = opts.targetTablesA !== undefined || opts.targetTablesB !== undefined;
	if (explicit && !(opts.targetTablesA?.length && opts.targetTablesB?.length)) {
		throw new BookingError('A swap needs somewhere to put both bookings.', 'invalid');
	}
	const targetA = explicit ? clean(opts.targetTablesA) : clean(beforeB.tables);
	const targetB = explicit ? clean(opts.targetTablesB) : clean(beforeA.tables);
	if (!targetA.length || !targetB.length) {
		throw new BookingError('Both bookings must be seated at a table to swap.', 'invalid');
	}

	const startA0 = new Date(beforeA.starts_at).getTime();
	const endA0 = new Date(beforeA.ends_at).getTime();
	const startB0 = new Date(beforeB.starts_at).getTime();
	const endB0 = new Date(beforeB.ends_at).getTime();
	const lenA = endA0 - startA0;
	const lenB = endB0 - startB0;

	// A no-op swap (identical table+time on both sides) is meaningless — reject early so
	// the client's "nothing changed" case doesn't write a self-amend. `sameTables` also
	// tells us this is a SAME-TABLE swap (both bookings on one set), where only the
	// positional trade-slots behaviour is collision-free. (Compared on the bookings' own
	// tables, not the destinations, which the diary may now send explicitly.)
	const ownA = clean(beforeA.tables);
	const ownB = clean(beforeB.tables);
	const sameTables = ownA.length === ownB.length && ownA.every((t) => ownB.includes(t));
	if (sameTables && startA0 === startB0) {
		throw new BookingError('These two bookings are already in the same place.', 'invalid');
	}

	// Two swap flavours, chosen per the diary's drag intent:
	//
	//  • HONOR-DROP (default from the diary drag): A is the DRAGGED booking and lands at
	//    the exact time the host dropped it (`opts.newStartA`) on B's table, keeping A's
	//    length. B is the bumped partner: it moves to A's vacated table but KEEPS ITS OWN
	//    time. So dropping A at 15:00 onto B's 16:00 table leaves A at 15:00 — the drop
	//    time is never overridden. Only valid across DIFFERENT tables.
	//
	//  • POSITIONAL (legacy / same-table): each booking takes the OTHER's start, keeping
	//    its own length — the two literally trade grid slots. Used when no explicit drop
	//    time is given, or for a same-table swap (where trading slots can't self-overlap).
	const honorDrop = opts.newStartA != null && !sameTables;
	let newStartA: Date, newEndA: Date, newStartB: Date, newEndB: Date;
	if (honorDrop) {
		newStartA = new Date(opts.newStartA as string); // A lands where it was dropped
		newEndA = new Date(newStartA.getTime() + lenA); // …keeping A's length
		newStartB = new Date(startB0); // B keeps its OWN time
		newEndB = new Date(endB0);
	} else {
		newStartA = new Date(startB0); // A takes B's start
		newEndA = new Date(startB0 + lenA); // …keeping A's length
		newStartB = new Date(startA0); // B takes A's start
		newEndB = new Date(startA0 + lenB); // …keeping B's length
	}

	// The occupancy check below excludes BOTH participants, so it can't see them collide with
	// EACH OTHER. Across tables, never put the two on a common table at overlapping times.
	if (
		!sameTables &&
		newStartA.getTime() < newEndB.getTime() &&
		newStartB.getTime() < newEndA.getTime() &&
		targetA.some((t) => targetB.includes(t))
	) {
		throw new BookingError(
			'Those two bookings would end up on the same table at the same time.',
			'no_availability'
		);
	}

	// Party sizes are NEVER changed by a swap — each booking keeps its covers, even when
	// the table it lands on is smaller (allowOverfill).
	const partyA = beforeA.party_size;
	const partyB = beforeB.party_size;

	const tables = await getTables(restaurant.id);

	// Re-derive the service period for a NEW start instant (a swap may shift a booking
	// across a period boundary). Mirrors amendBooking: an active period whose day-of-week
	// AND [start, last_booking] window contains the local start. Null if none matches, in
	// which case the caller keeps the booking's existing period (defensive).
	const tz = restaurant.timezone || 'Europe/London';
	const periods = await getActivePeriods(restaurant.id);
	// A walk-in keeps the running-service rule through a swap too (periodForSeat).
	const periodForInstant = (instant: Date, walkin = false): string | null => {
		const localDay = localDate(instant, tz);
		const dowName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(
			instant
		);
		const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dowName);
		return periodForSeat(periods, dow, localDay, instant.getTime(), tz, { walkin })?.id ?? null;
	};

	const after = await withLock(restaurant.id, async () => {
		// Widest window across BOTH bookings' OLD and NEW spans, padded, so a long turn
		// either side is seen when we re-check occupancy at the new times.
		const lo = Math.min(startA0, startB0, newStartA.getTime(), newStartB.getTime());
		const hi = Math.max(endA0, endB0, newEndA.getTime(), newEndB.getTime());
		const fromISO = addMinutes(new Date(lo), -OCCUPANCY_MARGIN_MIN).toISOString();
		const toISO = addMinutes(new Date(hi), OCCUPANCY_MARGIN_MIN).toISOString();
		const occupying = await getOccupyingBookingsWithId(restaurant.id, fromISO, toISO);

		// Exclude BOTH swap participants so they don't block each other — BY IDENTITY.
		// This matched on window+tables, which a swap is the worst possible place for: the
		// two participants routinely share a table set mid-gesture, so the shape match
		// could drop a THIRD booking holding the same table for the same window, and a
		// stale `beforeA`/`beforeB` could fail to drop a participant and make the pair
		// block each other. See the note in amendBooking.
		const others = occupying.filter((f) => f.id !== bookingIdA && f.id !== bookingIdB);

		// Validate one destination: the chosen tables exist, seat the party (unless the
		// caller waived the ceiling with allowOverfill), and are free for the NEW
		// [start, end) window against everyone EXCEPT the two swap participants.
		const validate = (targetIds: string[], party: number, newStart: Date, newEnd: Date) => {
			const chosen = tables.filter((t) => targetIds.includes(t.id));
			if (chosen.length !== targetIds.length) {
				throw new BookingError('That table is no longer on the floor.', 'no_availability');
			}
			const totalMax = chosen.reduce((n, t) => n + t.seats_max, 0);
			if (!opts.allowOverfill && totalMax < party) {
				const label = chosen.map((t) => t.label).join(' + ');
				throw new BookingError(
					`Table ${label} seats ${totalMax} — too small for a party of ${party}.`,
					'no_availability'
				);
			}
			const s = newStart.getTime();
			const e = newEnd.getTime();
			const clash = chosen.some((t) =>
				others.some(
					(o) =>
						o.tableIds.includes(t.id) &&
						s < new Date(o.endsAt).getTime() &&
						new Date(o.startsAt).getTime() < e
				)
			);
			if (clash) {
				const label = chosen.map((t) => t.label).join(' + ');
				throw new BookingError(
					`Table ${label} is already booked during that time.`,
					'no_availability'
				);
			}
		};
		validate(targetA, partyA, newStartA, newEndA);
		validate(targetB, partyB, newStartB, newEndB);

		// Both directions valid → write both at their computed windows (honor-drop or
		// positional, decided above), keeping each own length. amended_from records the
		// supersede link, and we re-derive each new service_period so a swap across a
		// period boundary stays consistent.
		//
		// PocketBase has no cross-row transaction, so if the SECOND write fails after the
		// first committed we'd leave a real double-book (A on B's table while B is still
		// there). ROLL BACK the first write to its pre-swap state before surfacing the
		// error, so the swap stays all-or-nothing in practice. The compensating write is
		// itself guarded — if it too fails we log loudly (a genuine half-applied state that
		// needs manual repair) rather than masking the original error.
		const updatedA = await c.collection('geisha_bookings').update<Booking>(bookingIdA, {
			tables: targetA,
			party_size: partyA,
			starts_at: newStartA.toISOString(),
			ends_at: newEndA.toISOString(),
			service_period:
				periodForInstant(newStartA, (beforeA.source ?? '') === 'walkin') ?? beforeA.service_period,
			amended_from: bookingIdA
		});
		let updatedB: Booking;
		try {
			updatedB = await c.collection('geisha_bookings').update<Booking>(bookingIdB, {
				tables: targetB,
				party_size: partyB,
				starts_at: newStartB.toISOString(),
				ends_at: newEndB.toISOString(),
				service_period:
					periodForInstant(newStartB, (beforeB.source ?? '') === 'walkin') ??
					beforeB.service_period,
				amended_from: bookingIdB
			});
		} catch (err) {
			try {
				await c.collection('geisha_bookings').update<Booking>(bookingIdA, {
					tables: clean(beforeA.tables),
					party_size: beforeA.party_size,
					starts_at: beforeA.starts_at,
					ends_at: beforeA.ends_at,
					service_period: beforeA.service_period,
					amended_from: beforeA.amended_from ?? ''
				});
			} catch (rollbackErr) {
				console.error(
					'[swap] ROLLBACK FAILED — booking',
					bookingIdA,
					'is left on',
					bookingIdB,
					"'s table and needs manual repair:",
					rollbackErr
				);
			}
			throw err instanceof BookingError
				? err
				: new BookingError('Could not swap the tables — no change was made.', 'no_availability');
		}
		return { a: updatedA, b: updatedB };
	});

	// PERF: audit both legs + email both guests are best-effort side-effects — run
	// them after the response so the swap returns as soon as both rows are written.
	deferWork(async () => {
		// A SEATED booking that swapped tables must have its live floor_state follow the
		// new table or the floor plan / turn board show it on the old one. No-op for an
		// upcoming reservation. Both legs, best-effort.
		// A swap can re-time a leg (honor-drop moves the dragged booking to where it was
		// dropped), so each leg re-anchors its seat stamp only if ITS start actually moved.
		const nowISO = new Date().toISOString();
		if (holdsFloorState(after.a.status))
			await syncFloorStateTables(
				after.a.id,
				after.a.tables ?? [],
				nowISO,
				newStartA.getTime() !== startA0 ? after.a.starts_at : undefined
			);
		if (holdsFloorState(after.b.status))
			await syncFloorStateTables(
				after.b.id,
				after.b.tables ?? [],
				nowISO,
				newStartB.getTime() !== startB0 ? after.b.starts_at : undefined
			);
		await writeAudit(
			actor,
			'amend_booking',
			'geisha_bookings',
			bookingIdA,
			beforeA,
			after.a,
			onBehalfOf
		);
		await writeAudit(
			actor,
			'amend_booking',
			'geisha_bookings',
			bookingIdB,
			beforeB,
			after.b,
			onBehalfOf
		);
		for (const b of [after.a, after.b]) {
			try {
				const customer = await c.collection('geisha_customers').getOne<Customer>(b.customer);
				// A swap moves the TABLE, not the time or the party — so no "previously"
				// line: there is nothing the guest would notice as different.
				await sendBookingAmended(b, customer, restaurant, await confirmationExtras(b));
			} catch (e) {
				console.error('[swap] confirmation email failed:', e);
			}
		}
	}, 'swap side-effects');

	return after;
}

// ---------------------------------------------------------------------------
// applyBookingBatch — ALL-OR-NOTHING commit of N diary edits (moves, resizes AND
// swaps) in ONE lock against ONE occupancy read.
//
// Why this exists (the "Table X is already booked at that time" bug): the diary
// used to commit each staged edit / swap as an INDEPENDENT server call. Each one
// re-read the DB occupancy on its own and only knew to exclude ITSELF — so when the
// host staged "booking P → table 25" together with "booking Q (on 25) → elsewhere",
// whichever leg ran first saw the OTHER leg's not-yet-written old position and threw
// a false clash. The per-restaurant lock serialised the WRITES but not the READS, and
// no single call ever saw the host's whole intended end-state. 3-way rotations and
// two-bookings-at-different-times were even worse (they degraded to lone moves that
// clashed against each other).
//
// Here the client sends the FULL set of final positions. We read occupancy ONCE with
// EVERY participant excluded BY ID (not by the old fragile window+tables shape match),
// validate each destination against (a) every non-participant booking's real window
// AND (b) every OTHER batch entry's NEW window, and only if ALL pass do we write. So
// the batch is atomic and never sees a phantom clash from a sibling leg's stale row.
// ---------------------------------------------------------------------------

export interface BatchEntry {
	/** The booking to reposition. */
	bookingId: string;
	/** Final local date 'YYYY-MM-DD'. Omit to keep the booking's current date. */
	date?: string;
	/** Final local time 'HH:mm'. Omit to keep the current time. */
	time?: string;
	/** Final pinned tables. Omit to keep the booking's current tables. */
	tableIds?: string[];
	/** Explicit dining duration (resize). Omit to preserve length (party unchanged). */
	durationMinutes?: number;
	/** Final party size (oversize-drop shrink). Omit to keep current. */
	partySize?: number;
}

export interface ApplyBatchOptions {
	actor?: AuditActor;
	onBehalfOf?: string;
	/** Commit edits that land on a CLOSED date/service (see AmendBookingInput.allowClosed).
	 *  The diary sends it on every staff commit; never honoured for `actor: 'customer'`. */
	allowClosed?: boolean;
}

export interface ApplyBatchResult {
	/** Every updated booking, in the order the entries were supplied. */
	bookings: Booking[];
}

/**
 * A party that ALREADY sits on exactly these tables, at the same or fewer covers, is not
 * being squeezed onto them — nothing about the fit changes. So a re-time that keeps the
 * booking's own tables never needs the seats-fit waiver. That waiver (`allowOverfill`) is
 * a confirmed staff choice and is about CREATING an over-capacity seat: a bigger party, or
 * smaller tables. Owner: a party of 15 on counter tables 50–54 (10 seats) couldn't be moved
 * 17:30 → 17:45 by a host even through "Seat anyway".
 */
function keepsOwnFit(
	tableIds: string[],
	partySize: number,
	before: Pick<Booking, 'tables' | 'party_size'>
): boolean {
	const own = new Set((before.tables ?? []).filter((t) => t && t !== '__unassigned__'));
	return (
		partySize <= before.party_size &&
		tableIds.length === own.size &&
		tableIds.every((t) => own.has(t))
	);
}

/** A fully-resolved entry: the exact row we intend to write, computed under the lock. */
interface ResolvedEntry {
	bookingId: string;
	before: Booking;
	tableIds: string[];
	partySize: number;
	startMs: number;
	endMs: number;
	periodId: string;
	label: string; // combined table label, for error messages
}

export async function applyBookingBatch(
	entries: BatchEntry[],
	opts: ApplyBatchOptions = {}
): Promise<ApplyBatchResult> {
	const actor: AuditActor = opts.actor ?? 'staff';
	const onBehalfOf = opts.onBehalfOf;
	if (!entries.length) return { bookings: [] };

	// Reject duplicate ids up-front — an entry list with the same booking twice is a
	// client bug and would let two targets fight over one row.
	const seen = new Set<string>();
	for (const e of entries) {
		if (seen.has(e.bookingId)) {
			throw new BookingError('The same booking appears twice in this change.', 'invalid');
		}
		seen.add(e.bookingId);
	}

	const c = await pb();
	// Load fresh. A booking cancelled/deleted on another device between staging and
	// confirm surfaces here as a 404 — map it to a friendly BookingError so the whole
	// batch fails cleanly (bars stay staged client-side) rather than a scary 500.
	const befores = await Promise.all(
		entries.map((e) =>
			c
				.collection('geisha_bookings')
				.getOne<Booking>(e.bookingId)
				.catch(() => {
					throw new BookingError(
						'A booking in this change is no longer in service — refresh and retry.',
						'invalid'
					);
				})
		)
	);

	// Staff diary batch — a FINISHED sitting is still editable here (see
	// AMENDABLE_FOR_AMEND): dragging a closed table's bar onto another row commits
	// through this path, so gating it on AMENDABLE_STATUSES would refuse the move.
	for (const b of befores) {
		if (!AMENDABLE_FOR_AMEND.includes(b.status)) {
			throw new BookingError(`A ${b.status} booking can't be changed.`, 'invalid');
		}
	}
	const restId = befores[0].restaurant;
	if (befores.some((b) => b.restaurant !== restId)) {
		throw new BookingError('All bookings in a change must be in the same restaurant.', 'invalid');
	}

	const restaurant = await c.collection('geisha_restaurants').getOne<Restaurant>(restId);
	const tz = restaurant.timezone || 'Europe/London';
	const settings = await getSettings(restaurant.id);
	const periods = await getActivePeriods(restaurant.id);
	const tables = await getTables(restaurant.id);

	// Re-derive the service period for a NEW start instant (an edit may cross a period
	// boundary). Mirrors amendBooking / swapBookingTables. The batch is staff-only
	// (the diary Confirm), so an instant outside every window falls back to the
	// nearest period rather than refusing — a resize/swap of a walk-in that create.ts
	// seated off-window (its manual-seat fallback) must not 409 the whole batch.
	const periodForInstant = (
		instant: Date,
		localDay: string,
		walkin = false
	): (typeof periods)[number] | null => {
		const dowName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(
			instant
		);
		const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dowName);
		const ms = instant.getTime();
		// A walk-in is filed by the service running when it sits, so a resize or a
		// drag can't re-file it into a service that had already ended.
		return (
			periodForSeat(periods, dow, localDay, ms, tz, { walkin }) ??
			manualSeatPeriod(periods, dow, localDay, ms, tz)
		);
	};

	// ---- resolve every entry to a concrete (tables, window, party, period) ----
	const resolved: ResolvedEntry[] = entries.map((e, i) => {
		const before = befores[i];
		const currentStart = new Date(before.starts_at);
		const newDate = e.date ?? localDate(currentStart, tz);
		const newTime = e.time ?? localHHmm(currentStart, tz);
		const partySize = e.partySize && e.partySize >= 1 ? Math.round(e.partySize) : before.party_size;
		if (partySize < 1) throw new BookingError('Party size must be at least 1.', 'invalid');

		const startsAt = fromZonedTime(`${newDate}T${newTime}:00`, tz);
		if (isNaN(startsAt.getTime())) throw new BookingError('Invalid date/time.', 'invalid');

		// Duration, same priority ladder as amendBooking: explicit override wins; else if
		// the party is UNCHANGED preserve the booking's current length; else recompute the
		// party-size turn under the (re-derived) period.
		const period = periodForInstant(startsAt, newDate, (before.source ?? '') === 'walkin');
		if (!period) throw new BookingError('No service available at that time.', 'no_period');

		const currentDurationMin = Math.round(
			(new Date(before.ends_at).getTime() - currentStart.getTime()) / 60_000
		);
		const partyChanged = partySize !== before.party_size;
		const turn =
			e.durationMinutes && e.durationMinutes >= 15
				? Math.round(e.durationMinutes)
				: !partyChanged && currentDurationMin >= 15
					? currentDurationMin
					: turnMinutesFor(partySize, period);
		const endsAt = addMinutes(startsAt, turn);

		// Pinned tables (or keep current). Strip the unassigned sentinel.
		const rawTables = (e.tableIds?.length ? e.tableIds : before.tables) ?? [];
		const tableIds = rawTables.filter((t) => t && t !== '__unassigned__');
		if (!tableIds.length) {
			throw new BookingError('A booking must land on at least one table.', 'invalid');
		}
		const chosen = tables.filter((t) => tableIds.includes(t.id));
		if (chosen.length !== tableIds.length) {
			throw new BookingError('That table is no longer on the floor.', 'no_availability');
		}
		const label = chosen.map((t) => t.label).join(' + ');

		return {
			bookingId: e.bookingId,
			before,
			tableIds,
			partySize,
			startMs: startsAt.getTime(),
			endMs: endsAt.getTime(),
			periodId: period.id,
			label
		};
	});

	// Closures refuse ALL sources — reject if any entry lands on a closed date/service.
	const dates = [...new Set(resolved.map((r) => localDate(new Date(r.startMs), tz)))];
	const closures = await getClosures(
		restaurant.id,
		dates.sort()[0],
		dates.sort()[dates.length - 1]
	);
	// Staff may commit edits on a closed day (see AmendBookingInput.allowClosed) — the
	// bookings the restaurant chose to take there still have to be movable.
	const overrideClosed = actor !== 'customer' && !!opts.allowClosed;
	for (const r of resolved) {
		const day = localDate(new Date(r.startMs), tz);
		if (!overrideClosed && isPeriodClosed(day, r.periodId, closures)) {
			throw new BookingError('That date/service is closed for bookings.', 'no_period');
		}
	}

	// Online cap applies only to guest self-service (never the diary/AI).
	if (actor === 'customer') {
		for (const r of resolved) {
			if (exceedsOnlineCap(r.partySize, settings)) {
				throw new BookingError(
					`Parties over ${settings.online_party_max} must book by phone.`,
					'phone_required'
				);
			}
		}
	}

	const after = await withLock(restaurant.id, async () => {
		// ONE occupancy read spanning every entry's OLD and NEW span, padded ±300min.
		const spanLo = Math.min(
			...resolved.map((r) => Math.min(r.startMs, new Date(r.before.starts_at).getTime()))
		);
		const spanHi = Math.max(
			...resolved.map((r) => Math.max(r.endMs, new Date(r.before.ends_at).getTime()))
		);
		const fromISO = addMinutes(new Date(spanLo), -OCCUPANCY_MARGIN_MIN).toISOString();
		const toISO = addMinutes(new Date(spanHi), OCCUPANCY_MARGIN_MIN).toISOString();

		// Footprints WITH ids so we can exclude every participant by IDENTITY (the old
		// shape match broke mid-swap when two bookings shared a window+tableset).
		const participantIds = new Set(resolved.map((r) => r.bookingId));
		const occupying = await getOccupyingBookingsWithId(restaurant.id, fromISO, toISO);
		const others = occupying.filter((f) => !participantIds.has(f.id));
		// Section close-outs occupy their tables for the window, same as a taken table —
		// unless staff are working a closed day deliberately (see `allowClosed`).
		const closeouts = overrideClosed
			? []
			: sectionCloseoutFootprints(localDate(new Date(spanLo), tz), tz, periods, tables, closures);

		// Validate EACH entry's destination against (a) every NON-participant booking's
		// real window + close-outs, AND (b) every OTHER batch entry's NEW window. Both
		// are needed: excluding participants stops false self/sibling clashes on the rows
		// they're vacating; the pairwise NEW-window check stops two entries silently
		// targeting the same table+time.
		const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;
		for (const r of resolved) {
			const chosen = tables.filter((t) => r.tableIds.includes(t.id));
			const totalMax = chosen.reduce((n, t) => n + t.seats_max, 0);
			if (totalMax < r.partySize && !keepsOwnFit(r.tableIds, r.partySize, r.before)) {
				throw new BookingError(
					`Table ${r.label} seats ${totalMax} — too small for a party of ${r.partySize}.`,
					'no_availability'
				);
			}
			// (a) non-participant bookings + close-outs on any of this entry's tables.
			for (const o of [...others, ...closeouts]) {
				if (
					r.tableIds.some((t) => o.tableIds.includes(t)) &&
					overlaps(r.startMs, r.endMs, new Date(o.startsAt).getTime(), new Date(o.endsAt).getTime())
				) {
					throw new BookingError(
						`Table ${r.label} is already booked during that time.`,
						'no_availability'
					);
				}
			}
			// (b) any OTHER batch entry whose NEW window lands on a shared table.
			for (const s of resolved) {
				if (s.bookingId === r.bookingId) continue;
				if (
					r.tableIds.some((t) => s.tableIds.includes(t)) &&
					overlaps(r.startMs, r.endMs, s.startMs, s.endMs)
				) {
					throw new BookingError(
						`Two of these bookings both want table ${r.label} at the same time.`,
						'no_availability'
					);
				}
			}
		}

		// All destinations valid → write every row. Nothing before this point mutated the DB.
		// PocketBase has no cross-row transaction, so a failure partway through the loop
		// would half-apply a rotation (e.g. two bookings on one table). We track every row
		// already written and, on any failure, ROLL EACH BACK to its `before` snapshot so
		// the batch stays all-or-nothing in practice. A rollback that itself fails is logged
		// loudly (genuine half-applied state needing manual repair) but never masks the
		// original error.
		const cc = await pb();
		const written: Booking[] = [];
		try {
			for (const r of resolved) {
				written.push(
					await cc.collection('geisha_bookings').update<Booking>(r.bookingId, {
						tables: r.tableIds,
						party_size: r.partySize,
						starts_at: new Date(r.startMs).toISOString(),
						ends_at: new Date(r.endMs).toISOString(),
						service_period: r.periodId,
						amended_from: r.bookingId
					})
				);
			}
		} catch (err) {
			for (const done of written) {
				const b = resolved.find((r) => r.bookingId === done.id)?.before;
				if (!b) continue;
				try {
					await cc.collection('geisha_bookings').update<Booking>(done.id, {
						tables: b.tables,
						party_size: b.party_size,
						starts_at: b.starts_at,
						ends_at: b.ends_at,
						service_period: b.service_period,
						amended_from: b.amended_from ?? ''
					});
				} catch (rollbackErr) {
					console.error(
						'[batch] ROLLBACK FAILED — booking',
						done.id,
						'is left half-applied and needs manual repair:',
						rollbackErr
					);
				}
			}
			throw err instanceof BookingError
				? err
				: new BookingError('Could not apply the changes — nothing was changed.', 'no_availability');
		}
		return written;
	});

	// PERF: side-effects per booking are all best-effort and never unwind a committed
	// batch — this was a fully-serial 6×N loop (allergy + audit + email per booking),
	// the dominant cost of a multi-booking "Confirm changes". Defer the whole loop off
	// the response so the confirm returns as soon as every row is written; run each
	// booking's side-effects concurrently inside the deferred task.
	deferWork(
		() =>
			Promise.all(
				after.map(async (updated, i) => {
					const before = resolved[i].before;
					// A SEATED (or finished) booking repositioned in the batch must have its
					// floor_state follow the new table (else the floor plan / turn board
					// desync), and RE-ANCHOR its seat stamp when the entry moved its start —
					// otherwise the diary redraws it at the old seat time on the next refresh.
					// No-op for a booking that was never seated.
					if (holdsFloorState(updated.status)) {
						const reTimed = resolved[i].startMs !== new Date(before.starts_at).getTime();
						await syncFloorStateTables(
							updated.id,
							updated.tables ?? [],
							new Date().toISOString(),
							reTimed ? updated.starts_at : undefined
						);
					}
					await applyAllergyFlagsForBooking(updated.id, updated.customer, updated.special_requests);
					await writeAudit(
						actor,
						'amend_booking',
						'geisha_bookings',
						updated.id,
						before,
						updated,
						onBehalfOf
					);
					try {
						const customer = await c
							.collection('geisha_customers')
							.getOne<Customer>(updated.customer);
						await sendBookingAmended(
							updated,
							customer,
							restaurant,
							await confirmationExtras(updated),
							{ startsAt: before.starts_at, partySize: before.party_size }
						);
					} catch (e) {
						console.error('[batch] confirmation email failed:', e);
					}
				})
			),
		'batch side-effects'
	);

	return { bookings: after };
}

// ---------------------------------------------------------------------------
// AI tool spec (authored here per the plan; S2 registers it into adminTools.ts
// WRITE section next to move_booking). Kept as a documented constant rather than
// wired here so this WP touches only its own files.
//
//   {
//     name: 'amend_booking',
//     kind: 'write', // confirm-gated — MUST be confirmed before it runs
//     description:
//       "Change an existing booking's date, time, party size or requests. " +
//       'Re-checks table availability before applying. WRITE action — must be ' +
//       'confirmed before it runs.',
//     parameters: {
//       type: 'object',
//       properties: {
//         bookingId: { type: 'string' },
//         date: { type: 'string', description: 'YYYY-MM-DD' },
//         time: { type: 'string', description: 'HH:mm' },
//         partySize: { type: 'integer' },
//         specialRequests: { type: 'string' }
//       },
//       required: ['bookingId']
//     },
//     run: (args) => amendBooking({ ...args, actor: 'ai', onBehalfOf })
//   }
// ---------------------------------------------------------------------------
