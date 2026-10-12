// createBooking — the write path for a new reservation.
//
// PocketBase has no multi-row transactions, so we guard the double-book race
// with a per-restaurant advisory lock: allocate + create happen atomically from
// the system's point of view, and we re-check availability immediately before
// writing. The lock is backed by a PocketBase geisha_locks row (see
// db/lock.ts) so it holds ACROSS instances — the previous in-process Map only
// serialised within a single Node process, which breaks on multi-instance /
// serverless deploys (BOOKING_SYSTEM_PLAN.md §4 concurrency note).

import { addMinutes } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { pb } from '../db/pb.js';
import { acquireLock, releaseLock } from '../db/lock.js';
import type { Booking, BrandId } from '../db/types.js';
import {
	allocateTables,
	turnMinutesFor,
	sectionCloseoutFootprints,
	OCCUPANCY_MARGIN_MIN,
	type BookingFootprint
} from './availability.js';
import { isPeriodClosed, closuresForChannel } from './closures.js';
import { manualSeatPeriod, periodForSeat } from './periodFallback.js';
import { getTableRanksById } from './ranking.js';
import { getChainsByRestaurant } from './chains.js';
import { getAutoJoinByRestaurant, policyFor } from './autojoin.js';
import { selectPacingRule, slotWithinSlotCap, withinPeriodCap } from './pacing.js';
import { paymentRequirementFor, exceedsOnlineCap, type PaymentRequirement } from './policy.js';
import {
	getRestaurant,
	getActivePeriods,
	getTables,
	getJoins,
	getOccupyingBookings,
	getClosures,
	getPacingRules,
	getDepositRules,
	getSettings,
	upsertCustomer
} from './queries.js';
import { writeAudit } from './audit.js';
import { isBlockedContact } from './crm.js';
import {
	startPaymentForBooking,
	requirementIfCollectable,
	type PaymentCollectionMode
} from './payments.js';
import { resolveBookingOption, requirementForOption } from './options.js';
import { sendBookingConfirmation, confirmationExtras } from '../email/confirmations.js';
import { applyAllergyFlags } from '../ai/allergy.js';
import { resolvePreorder } from './setMenus.js';
import { deferWork } from '../util/defer.js';
import { seatBooking } from './mutate.js';
import type { AuditActor, BookingPreorder, Customer } from '../db/types.js';

// --- per-restaurant mutex (multi-instance, via geisha_locks) -----------------
// Same call-site signature as the old in-process Map mutex, but the lock now
// lives in PocketBase so it serialises bookings across ALL instances. The key is
// namespaced per restaurant; the TTL bounds how long a crashed holder can wedge
// it (a single allocate+create is sub-second, so 10s is generous head-room).
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const handle = await acquireLock(`booking:${key}`, 10_000, 8_000);
	try {
		return await fn();
	} finally {
		await releaseLock(handle);
	}
}

export interface CreateBookingInput {
	brand: BrandId;
	/** Local date 'YYYY-MM-DD'. */
	date: string;
	/** Local time 'HH:mm'. */
	time: string;
	partySize: number;
	customer: { name: string; email: string; phone?: string; marketingConsent?: boolean };
	specialRequests?: string;
	occasion?: string;
	/**
	 * Optional set-menu pre-order: the id of a menu in the brand's `set_menus`
	 * catalogue (geisha_settings). Resolved to a {@link BookingPreorder} snapshot
	 * and stored on booking.preorder. An empty/unknown id is ignored. Persisting is
	 * best-effort so it no-ops gracefully when the column hasn't been migrated yet.
	 */
	setMenuId?: string;
	/**
	 * The bookable OPTION the guest chose (ResDiary's "An option is required for
	 * this booking" step) — an id from the brand's catalogue in
	 * $lib/data/bookingOptions, resolved server-side against the slot.
	 *
	 * It does two things: stamps the promotion onto the booking so the diary shows
	 * what was booked, and — when the option declares one — OVERRIDES the deposit
	 * that the rules engine would otherwise apply. An empty, unknown, or
	 * out-of-window id is ignored and the booking proceeds under the standard
	 * rules, because this value arrives from the browser and must never be able to
	 * buy a cheaper deposit.
	 */
	optionId?: string;
	source?: 'online' | 'phone' | 'walkin';
	/**
	 * Staff-made booking (phone/walk-in). Relaxes the online-only rules: the
	 * party-size cap and the deposit/no-show payment are skipped (staff judge
	 * those in person / on the phone). Availability + table-fit STILL apply so we
	 * never double-book. The booking is created already `confirmed`.
	 */
	staff?: boolean;
	/**
	 * The geisha_staff id of the host taking a `staff` booking, recorded in the
	 * audit row's on_behalf_of so the booking history's "Made" line names them
	 * rather than a flat 'staff'. Ignored for guest bookings, which are the
	 * guest's own act.
	 */
	staffId?: string;
	/**
	 * Walk-ins: seat the party AS PART OF the create (`at` = the seat time; `actor`
	 * defaults to 'staff'). Staff bookings only. Never seat a fresh booking from the
	 * caller afterwards — see where this is applied for why that loses the seat.
	 */
	seat?: { at: string; actor?: AuditActor };
	/**
	 * Walk-ins: seat this exact free table now instead of auto-allocating. The
	 * table must fit the party and be free for the window, else NO_AVAILABILITY.
	 */
	tableIds?: string[];
	/**
	 * Manual seat (walk-in) only: force the seat onto the chosen table(s) even
	 * when a booking already overlaps the window ("Overbook table" in the diary
	 * walk-in modal). Skips ONLY the table-free check — seats-fit still applies.
	 * Staff judgement, e.g. a table due to leave imminently. Ignored unless
	 * `tableIds` is set (auto-allocation never overbooks).
	 */
	allowOccupied?: boolean;
	/**
	 * BOOK ON A CLOSED DAY (owner: "for Christmas we block the system and add
	 * reservations manually"). A closure exists to stop NEW demand arriving on its
	 * own — it was never meant to stop the restaurant taking a booking it has
	 * decided to take. With this set, a STAFF create goes through even though the
	 * date/service is closed, and the day's section/table close-outs stop counting
	 * as occupancy for it. The diary asks the host to confirm before sending it.
	 *
	 * Staff only, always: a guest request carrying this flag is ignored, so a closed
	 * day is still genuinely closed to the public.
	 */
	allowClosed?: boolean;
	/**
	 * TEMPORARY TABLE JOIN (ResDiary): the host combined tables from the booking
	 * form and stated the combination's capacity themselves. Waives ONLY the
	 * seats-fit ceiling on an explicit `tableIds` pin — two 8-tops pushed together
	 * seat more than 16 when staff say so, and refusing that is the difference
	 * between taking a 19-cover booking and turning it away. The tables must still
	 * be FREE (unless `allowOccupied`), so this never silently double-books.
	 * Ignored without `tableIds`.
	 */
	allowOverfill?: boolean;
	/**
	 * Manual seat (walk-in) only: override the turn time (minutes) so the bar's
	 * length matches the host's expectation (the diary walk-in "Duration" field).
	 * Falls back to the period's turn ladder when unset/invalid (< 15).
	 */
	durationMinutes?: number;
	/**
	 * Staff override: bypass the per-slot / per-service covers caps. The caps are there
	 * to pace ONLINE demand; a member of staff taking a booking or seating a walk-in can
	 * see the room and may go past a full slot. This was manager-only (Jul 2026) and
	 * shut the whole "Service only" floor team out on busy nights, so the diary now sends
	 * it for every staff account (owner, Sep 2026). Never set for online (guest) bookings.
	 */
	overrideCoverCaps?: boolean;
	/**
	 * Walk-in only: when the pre-seeded `tableIds` don't fit the party (or are taken),
	 * auto-allocate a correctly-sized free table instead of refusing. The diary walk-in
	 * modal seeds the first free table only to draw the optimistic bar; this lets a party
	 * that outgrows it land on the right table rather than "seat then cancel". Ignored when
	 * overbooking (`allowOccupied`) or when a join capacity was stated (`allowOverfill`).
	 */
	autoAllocateIfUnfit?: boolean;
}

export interface CreateBookingResult {
	booking: Booking;
	payment: PaymentRequirement;
	/** True when a live Stripe intent was created (false = none needed or stub). */
	paymentConfigured?: boolean;
	/**
	 * Card-collection session for the public widget's payment step (only present
	 * when a payment is required). hosted-URL-first, with a graceful fallback when
	 * Stripe isn't configured. The Stripe webhook remains the source of truth.
	 */
	paymentSession?: {
		paymentId: string;
		mode: PaymentCollectionMode;
		clientSecret?: string;
		/** Stripe publishable key. Public by design; needed to mount Elements. */
		publishableKey?: string;
		amountPence: number;
		kind: PaymentRequirement['kind'];
	};
}

export class BookingError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'phone_required'
			| 'no_availability'
			/**
			 * The date or service is SHUT — as opposed to full ('no_availability') or
			 * unserved ('no_period'). Its own code because it is the one refusal the
			 * caller can do something about: staff may retry the identical write with
			 * `allowClosed` and it will go through. Without the distinction the diary
			 * could only show a flat error, which is what the owner read as "the
			 * manager isn't allowed to book when the restaurant is closed".
			 */
			| 'closed'
			| 'no_period'
			| 'invalid'
			| 'blocked'
	) {
		super(message);
	}
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
	const { brand, date, time, partySize } = input;
	if (partySize < 1) throw new BookingError('Party size must be at least 1.', 'invalid');

	const restaurant = await getRestaurant(brand);
	const tz = restaurant.timezone || 'Europe/London';
	// PERF: fetch every restaurant-scoped read this create needs in ONE parallel wave
	// instead of ~6 serial cross-region round-trips. All key off restaurant.id and are
	// independent of each other; getClosures still runs later (needs the resolved date).
	const [settings, periods, tables, joins, chains, autoJoinConfig, tableRanks] = await Promise.all([
		getSettings(restaurant.id),
		getActivePeriods(restaurant.id),
		getTables(restaurant.id),
		getJoins(restaurant.id),
		// staff-authored chains (ResDiary Table Joins), capacity-aware — preferred by
		// the allocator over an ad-hoc combination for a large party.
		getChainsByRestaurant(restaurant.id).catch(() => []),
		// which tables the owner allows the engine to auto-join (/admin/tables). Only
		// gates AUTO-allocation — an explicit staff tableIds pick is never restricted.
		getAutoJoinByRestaurant(restaurant.id),
		// getTableRanksById avoids re-resolving the restaurant (getTableRanks(brand) did).
		getTableRanksById(restaurant.id)
	]);
	// Staff-only tables (Asia's counter) join for a host's booking, never a guest's.
	const autoJoin = policyFor(autoJoinConfig, input.staff ? 'staff' : 'online');

	// Blocked guests (the "No show - Block user" outcome) can't book ONLINE. Staff
	// bookings are never blocked — a host taking the party on the phone or at the
	// door is a deliberate judgement call, and the diary shows the `blocked` tag.
	if (!input.staff && (await isBlockedContact(input.customer.email, input.customer.phone))) {
		throw new BookingError(
			'We can’t complete this booking online. Please call the restaurant to book.',
			'blocked'
		);
	}

	// Online cap only applies to online bookings — staff can exceed it.
	if (!input.staff && exceedsOnlineCap(partySize, settings)) {
		throw new BookingError(
			`Parties over ${settings.online_party_max} must book by phone.`,
			'phone_required'
		);
	}

	const startsAt = fromZonedTime(`${date}T${time}:00`, tz);
	if (isNaN(startsAt.getTime())) throw new BookingError('Invalid date/time.', 'invalid');
	const dowName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(
		startsAt
	);
	const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dowName);

	// Find a period whose DAY and TIME WINDOW both contain the requested start.
	// (The availability endpoint only offers valid slots, but a direct POST must
	// be validated here too — start must be within [start_time, last_booking_time].)
	//
	// A WALK-IN instead takes the service RUNNING when they sat, so a party seated
	// as one service ends is counted in the one they're actually dining in — see
	// periodForSeat.
	const startMs = startsAt.getTime();
	let period =
		periodForSeat(periods, dow, date, startMs, tz, {
			walkin: (input.source ?? '') === 'walkin'
		}) ?? undefined;

	// A staff MANUAL SEAT (walk-in / explicit table pick) must be seatable whenever
	// a guest is physically present — even before lunch opens, after last orders, or
	// in the gap between services. So when no period's window contains "now", file it
	// under the service RUNNING then, else the nearest one (manualSeatPeriod — it also
	// decides which service the run-sheet counts the walk-in in), instead of refusing.
	// Online and staff-without-a-table bookings still require a real open window —
	// they're forward reservations, not someone standing at the pass. Closures
	// (checked next) remain a hard block for everyone.
	const manualSeat = !!input.staff && !!input.tableIds?.length;
	if (!period && manualSeat) {
		period = manualSeatPeriod(periods, dow, date, startMs, tz) ?? undefined;
	}
	if (!period) throw new BookingError('No service available at that time.', 'no_period');

	// The services running on this DATE — the window a close-out falls back to when it
	// names no sub-window, and the set the close-out footprints are read across below.
	// Falls back to the resolved period so a manual seat outside every window still gets
	// the close-outs filed against the period it borrowed its turn time from.
	const periodsForDay = periods.filter((p) => p.days_of_week?.includes(dow));
	if (!periodsForDay.some((p) => p.id === period.id)) periodsForDay.push(period);

	// Closures are physical, not a policy relaxation. A 'common' close-out (the default,
	// and every legacy row) refuses ALL sources, staff included. ResDiary's "Type" lets a
	// close-out target only ONE channel, so an online-only block never stops a staff write
	// and an internal-only block never stops an online one — drop the ones that don't apply.
	const closures = closuresForChannel(
		await getClosures(restaurant.id, date, date),
		input.staff ? 'internal' : 'online'
	);
	// …unless STAFF have explicitly said to book anyway (see `allowClosed`): the host
	// taking a Christmas reservation over the phone on a day that's shut to the public.
	const overrideClosed = !!input.staff && !!input.allowClosed;
	if (!overrideClosed && isPeriodClosed(date, period.id, closures)) {
		throw new BookingError('That date/service is closed for bookings.', 'closed');
	}

	// Re-assert the booking horizon server-side for ONLINE bookings (WP-AVAIL-3).
	// Staff bookings bypass: staff can take same-day / far-ahead bookings by phone.
	if (!input.staff) {
		const lead = settings.lead_time_minutes;
		const window = settings.booking_window_days;
		const nowMs = Date.now();
		// The past is not bookable, whatever the lead-time policy says. Both venues run
		// with `lead_time_minutes` unset (= 0), which disabled the branch below entirely
		// and let an online POST create a booking for a time that had already gone.
		// Mirrors the unconditional floor in checkAvailability / withinBookingHorizon.
		if (startMs < nowMs) {
			throw new BookingError('That time has already passed. Please pick a later one.', 'invalid');
		}
		// The staff-set online cut-off, measured against the same anchor availability
		// used: the guest's own time ('visit') or the start of the service ('service').
		const cutoffAnchorMs =
			settings.lead_time_mode === 'service'
				? fromZonedTime(`${date}T${period.start_time}:00`, tz).getTime()
				: startMs;
		if (lead > 0 && cutoffAnchorMs < nowMs + lead * 60_000) {
			throw new BookingError(
				settings.lead_time_mode === 'service'
					? 'Online bookings for that service have closed. Please call the restaurant.'
					: 'That time is too soon to book online.',
				'invalid'
			);
		}
		if (window > 0 && startMs > nowMs + window * 86_400_000) {
			throw new BookingError('That date is beyond our booking window.', 'invalid');
		}
	}

	// Manual walk-in seats may pin an explicit sitting length (the modal's Duration
	// field); everything else follows the period's turn-time ladder.
	const manualDuration =
		input.tableIds?.length && input.durationMinutes && input.durationMinutes >= 15
			? Math.round(input.durationMinutes)
			: null;
	const turn = manualDuration ?? turnMinutesFor(partySize, period);
	const endsAt = addMinutes(startsAt, turn);

	// `tables`, `joins`, `tableRanks` were fetched in the parallel wave above.
	// Staff bookings need no payment, so they're confirmed immediately.
	const initialStatus = input.staff ? 'confirmed' : 'pending_payment';

	// Resolve an optional set-menu pre-order to a persistable snapshot. A read
	// against the brand's catalogue; an empty/unknown id yields null (= no
	// pre-order). Best-effort: any failure leaves preorder null so the booking
	// proceeds without it. Resolved here (outside the lock) since it's read-only.
	let preorder: BookingPreorder | null = null;
	try {
		preorder = await resolvePreorder(restaurant.id, input.setMenuId);
	} catch {
		preorder = null;
	}

	// The promotion a HOST picked on the booking form (ResDiary's "Promotion" field).
	//
	// The online path stamps this much further down, after the deposit engine has run,
	// because for a guest the option and the money are the same decision. A staff
	// booking returns long before that — it takes no payment and is confirmed on the
	// spot — so its promotion has to be written with the row itself or it is lost.
	// That is why picking "Bottomless Brunch" on the diary used to change nothing.
	//
	// Availability is deliberately not enforced here: see resolveBookingOption's
	// `ignoreAvailability`. The host is the one deciding, and they are looking at the
	// table. Money is untouched either way — no staff booking has ever collected a
	// deposit, and attaching a promotion does not start.
	let staffPromotion = '';
	if (input.staff && input.optionId) {
		try {
			const opt = await resolveBookingOption(
				brand,
				input.optionId,
				startsAt,
				tz,
				partySize,
				undefined,
				{ ignoreAvailability: true }
			);
			staffPromotion = opt?.title ?? '';
		} catch {
			staffPromotion = ''; // a bad id names no promotion; never blocks the booking
		}
	}

	// Lock + re-check + create so two requests can't grab the same table.
	const booking = await withLock(restaurant.id, async () => {
		// margin window: anything starting within a turn before/after could overlap
		const fromISO = addMinutes(startsAt, -OCCUPANCY_MARGIN_MIN).toISOString();
		const toISO = addMinutes(startsAt, OCCUPANCY_MARGIN_MIN).toISOString();
		const occupying = await getOccupyingBookings(restaurant.id, fromISO, toISO);
		// Section close-outs (diary "CloseOuts"): block this period's closed sections by
		// treating their tables as occupied for the service window. Auto-allocation skips
		// them; an explicit staff pin onto a closed section is refused unless overbooked
		// (allowOccupied) — the host's deliberate override, same as seating onto a taken
		// table. A physical, source-blind block, exactly like a period closure.
		// `allowClosed` also lifts the section/table close-outs for this one write: a
		// restaurant that shuts for Christmas often does it by closing every section, and
		// the host who has decided to seat a party needs the tables back to do it.
		//
		// EVERY period that runs today, not just this booking's — a close-out's window is
		// enforced verbatim, so a whole-restaurant block filed under Lunch can legitimately
		// cover the changeover into Dinner (16:45–17:00) or straddle both services. Filed
		// under one period, read against all: this is what the availability engine already
		// does, so a staff create can no longer succeed where the guest engine and the
		// diary's own red band both say closed.
		// Held SEPARATELY from the real bookings rather than folded into one list: when
		// the seat fails we have to be able to ask *which* of the two refused it. A full
		// restaurant and a shut one are the same empty floor to the allocator and very
		// different things to the host — only one of them can be overridden.
		const closeoutFootprints = overrideClosed
			? []
			: sectionCloseoutFootprints(date, tz, periodsForDay, tables, closures);
		const existing = [...occupying, ...closeoutFootprints];

		let tableIds: string[] | null;
		if (input.tableIds?.length) {
			// Walk-in / manual seat: caller picked the table(s). Validate fit + free.
			// "Overbook table" (allowOccupied) lets the host seat onto a table that
			// still has an overlapping booking — staff judgement — so we skip ONLY the
			// free check; seats-fit and "all chosen tables exist" still hold.
			const chosen = tables.filter((t) => input.tableIds!.includes(t.id));
			const totalMax = chosen.reduce((n, t) => n + t.seats_max, 0);
			/** Are all the chosen tables clear of everything in `list` for this window? */
			const freeAgainst = (list: BookingFootprint[]) =>
				chosen.every((t) =>
					list.every(
						(b) =>
							!b.tableIds.includes(t.id) ||
							startsAt.getTime() >= new Date(b.endsAt).getTime() ||
							endsAt.getTime() <= new Date(b.startsAt).getTime()
					)
				);
			const allFree = input.allowOccupied || freeAgainst(existing);
			// A temporary join (allowOverfill) waives the seats ceiling — staff stated the
			// combination's capacity — but never the "table exists" or "table is free" rules.
			const fits = input.allowOverfill || totalMax >= partySize;
			tableIds =
				chosen.length === input.tableIds.length && fits && allFree ? input.tableIds! : null;
			// WALK-IN "BEST AVAILABLE" FALLBACK (owner request). The diary walk-in modal
			// pre-seeds the FIRST FREE table just so it has somewhere to draw the optimistic
			// bar; when the host then picks a PARTY SIZE that seeded table can be too small
			// (or since taken). Rather than refuse — the old "seat it on the first of the
			// list, then cancel it if it can't fit" — auto-allocate a correctly-sized free
			// table for the party, exactly like an online booking. Opt-in via
			// `autoAllocateIfUnfit` (walk-in only), and never when overbooking (the host
			// deliberately chose that occupied table) or when a temporary-join capacity was
			// stated (allowOverfill — they meant those specific tables).
			if (!tableIds && input.autoAllocateIfUnfit && !input.allowOccupied && !input.allowOverfill) {
				const auto = allocateTables(
					startsAt,
					turn,
					partySize,
					tables,
					joins,
					existing,
					tableRanks,
					{ chains, autoJoin }
				);
				if (auto) tableIds = auto;
			}
			// An EXPLICIT table pin that failed: say WHY, honestly. "No tables available"
			// is the auto-allocation message and is misleading here — the host chose a
			// specific table, so it's either taken, too small, or gone. (The diary blocks
			// an occupied one-tap up front; this covers a direct/edge POST and the modal.)
			if (!tableIds) {
				const label = chosen.map((t) => t.label).join(' + ') || 'That table';
				if (chosen.length !== input.tableIds.length) {
					throw new BookingError(`${label} is no longer on the floor.`, 'no_availability');
				}
				if (!fits) {
					throw new BookingError(
						`${label} only seats ${totalMax} — too small for a party of ${partySize}. Join more tables, or set a combined capacity.`,
						'no_availability'
					);
				}
				// Remaining case: occupied and not overbooking — but occupied by WHAT? A
				// close-out is not a booking, and telling the host to "overbook" a table
				// the restaurant has deliberately shut points at a door that isn't there.
				// Clear of the real bookings means the close-out is the only thing in the
				// way, so say so with the code that offers the override that does work.
				if (freeAgainst(occupying)) {
					throw new BookingError(`${label} is closed for that time.`, 'closed');
				}
				throw new BookingError(
					`${label} is already booked for that time. Use “overbook” to seat anyway.`,
					'no_availability'
				);
			}
		} else {
			tableIds = allocateTables(startsAt, turn, partySize, tables, joins, existing, tableRanks, {
				chains,
				autoJoin
			});
			if (!tableIds) {
				// Shut, or genuinely full? Re-run the allocation against the real bookings
				// alone: if a table appears, the close-outs are what took the floor away
				// and the host can take it back (`allowClosed`). "No tables available for
				// that time" is technically true of a closed Christmas Day and useless —
				// it was the dead end that read as a missing manager permission, when
				// staff have always been allowed to book a closed day.
				if (
					closeoutFootprints.length &&
					allocateTables(startsAt, turn, partySize, tables, joins, occupying, tableRanks, {
						chains,
						autoJoin
					})
				) {
					throw new BookingError('That date/service is closed for bookings.', 'closed');
				}
				throw new BookingError('No tables available for that time.', 'no_availability');
			}
		}

		// Re-assert the covers caps server-side (WP-AVAIL-1) so a direct POST cannot
		// bypass a cap the availability UI hid. The caps run for every create that
		// doesn't carry `overrideCoverCaps` — guests always, and any staff path that
		// doesn't send it. The same pure predicates the engine uses gate the create here,
		// inside the lock, so concurrent requests can't both slip past a slot/period cap.
		if (!input.overrideCoverCaps) {
			const rule = selectPacingRule(period.id, dow, await getPacingRules(restaurant.id));
			const slotMs = startsAt.getTime();
			const periodStartMs = fromZonedTime(`${date}T${period.start_time}:00`, tz).getTime();
			const periodEndMs = fromZonedTime(`${date}T${period.end_time}:00`, tz).getTime();
			if (!slotWithinSlotCap(rule, slotMs, settings.slot_interval_minutes, partySize, existing)) {
				throw new BookingError('That time is fully booked.', 'no_availability');
			}
			if (!withinPeriodCap(rule, periodStartMs, periodEndMs, partySize, existing)) {
				throw new BookingError('That service is fully booked.', 'no_availability');
			}
		}

		const customer = await upsertCustomer(input.customer);
		const c = await pb();
		// Set-menu pre-order (when chosen) is folded in conditionally. PocketBase
		// silently drops unknown fields on create, so including `preorder` is a safe
		// no-op until migration 1772700700 adds the column — the booking still writes.
		return c.collection('geisha_bookings').create<Booking>({
			restaurant: restaurant.id,
			customer: customer.id,
			party_size: partySize,
			starts_at: startsAt.toISOString(),
			ends_at: endsAt.toISOString(),
			tables: tableIds,
			service_period: period.id,
			status: initialStatus,
			source: input.source ?? 'online',
			special_requests: input.specialRequests ?? '',
			occasion: input.occasion ?? '',
			// Snapshot who actually booked THIS table (migration 1785500000). The
			// customer record is shared across every booking on the same email, so
			// without this a later booking under a different spelling rewrote the name
			// on all the earlier ones. Unknown fields are dropped silently by
			// PocketBase, so this is a safe no-op until the migration lands.
			guest_name: input.customer.name.trim(),
			guest_phone: (input.customer.phone ?? '').trim(),
			...(preorder ? { preorder } : {}),
			...(staffPromotion ? { promotion: staffPromotion } : {})
		});
	});

	// mf-allergy-aware: denormalise allergy/dietary flags from the booking's free
	// text (+ the guest's saved notes/allergies) onto booking.dietary_flags so the
	// live floor + run-sheet show a loud allergy badge. ADDITIVE + best-effort: the
	// deterministic keyword pass runs with no AI key, and any failure is swallowed
	// inside applyAllergyFlags so it NEVER blocks or rolls back the booking.
	// PERF: deferred off the response (see deferWork) — the caller never reads the
	// derived flags synchronously; the diary re-pulls them on its next refresh.

	// Staff bookings (phone/walk-in — includes the diary one-tap walk-in) take no
	// online payment and are already confirmed, so allergy denorm + audit + the
	// confirmation email are ALL best-effort side-effects. Defer them so the walk-in
	// returns as soon as its row is written (they were ~5 serial cross-region hops).
	if (input.staff) {
		// A WALK-IN IS SEATED HERE, BEFORE ANY DEFERRED WRITE STARTS — not by the caller
		// afterwards. PocketBase saves a whole row from the copy it loaded, so a write that
		// starts before another lands puts the other's fields back. The deferred allergy
		// write below used to race the caller's seat by 2–5ms and win: the walk-in went
		// back to 'confirmed' with no audit row, stayed green only because its floor_state
		// survived, and the release sweep marked a seated table a no-show 30 minutes in
		// (10 Sep: 5 of 19 walk-ins, "the system unseated them"). Best-effort, as before:
		// a failed seat must never lose the walk-in — it just reads unseated.
		let result = booking;
		if (input.seat) {
			try {
				result = await seatBooking(
					booking.id,
					input.seat.at,
					input.seat.actor ?? 'staff',
					undefined,
					input.staffId
				);
			} catch (e) {
				console.error('[create] walk-in seat failed:', e);
			}
		}
		deferWork(async () => {
			await applyAllergyFlagsForBooking(booking.id, booking.customer, input.specialRequests);
			await writeAudit(
				'staff',
				'create_booking',
				'geisha_bookings',
				booking.id,
				null,
				booking,
				input.staffId
			);
			const c = await pb();
			const customer = await c.collection('geisha_customers').getOne<Customer>(booking.customer);
			await sendBookingConfirmation(
				booking,
				customer,
				restaurant,
				undefined,
				await confirmationExtras(booking)
			);
		}, 'staff create side-effects');
		return {
			booking: result,
			payment: { kind: 'none', amountPence: 0, perPersonPence: 0, reason: '' }
		};
	}

	// Online bookings: run the allergy denorm off the response too (best-effort).
	deferWork(
		() => applyAllergyFlagsForBooking(booking.id, booking.customer, input.specialRequests),
		'online create allergy flags'
	);

	// Configurable deposit-rules engine (owner #4): match against geisha_deposit_rules,
	// scoped to the resolved service period; falls back to the seeded policy when no
	// rule matches or the collection is absent.
	const depositRules = await getDepositRules(restaurant.id);

	// The OPTION the guest picked wins over the rules engine when it declares a
	// deposit of its own — Bottomless Brunch takes £10pp from a table of two, where
	// the standard rules would take nothing. Resolved against the slot, so a
	// hand-edited id can't select an option that isn't running.
	//
	// An option WITHOUT its own deposit (the normal case — "Standard Booking") still
	// resolves: it contributes only its promotion label, and the rules engine decides
	// the money exactly as before.
	const chosenOption = await resolveBookingOption(brand, input.optionId, startsAt, tz, partySize);
	const optionRequirement = chosenOption ? requirementForOption(chosenOption, partySize) : null;

	// Gated on a connected payment provider — see requirementIfCollectable(). With no
	// Stripe credentials the rule is inert and the booking confirms normally,
	// rather than demanding a deposit the guest has no way to pay.
	const basePayment =
		optionRequirement ??
		paymentRequirementFor(partySize, startsAt, tz, settings, depositRules, period.id);
	// A chosen option always names itself on the booking, even when it left the money
	// to the rules engine — otherwise the diary can't tell a brunch from a normal
	// table on a Sunday.
	const payment = await requirementIfCollectable(
		chosenOption && !optionRequirement
			? { ...basePayment, promotionName: chosenOption.title, promotion: chosenOption.id }
			: basePayment,
		brand
	);

	// Stamp the matched promotion (ResDiary "Promotions") onto the booking so the
	// diary shows the tag + prints the policy the guest agreed to. A promotion can
	// match even a no-payment rule (a T&C-only promotion), so this is independent of
	// payment.kind. PocketBase drops the field silently until migration adds it.
	const promotionPatch = payment.promotionName ? { promotion: payment.promotionName } : {};

	// If no payment is needed, the booking is immediately confirmed.
	if (payment.kind === 'none') {
		const c = await pb();
		const confirmed = await c
			.collection('geisha_bookings')
			.update<Booking>(booking.id, { status: 'confirmed', ...promotionPatch });
		// audit + confirmation email are best-effort side-effects — defer off the response.
		deferWork(async () => {
			await writeAudit('system', 'create_booking', 'geisha_bookings', booking.id, null, confirmed);
			const customer = await c.collection('geisha_customers').getOne<Customer>(confirmed.customer);
			await sendBookingConfirmation(
				confirmed,
				customer,
				restaurant,
				undefined,
				await confirmationExtras(confirmed)
			);
		}, 'online create side-effects');
		return { booking: confirmed, payment };
	}

	// Payment required: stamp the promotion (if any), then create the Stripe intent
	// + payment record. The booking stays 'pending_payment' until the Stripe webhook
	// reports Authorized/Captured (see /api/webhooks/stripe). When Stripe isn't yet
	// configured, a stub intent is recorded so the flow is complete and goes live
	// once keys are added.
	let pendingBooking = booking;
	if (payment.promotionName) {
		try {
			const c = await pb();
			pendingBooking = await c
				.collection('geisha_bookings')
				.update<Booking>(booking.id, promotionPatch);
		} catch (e) {
			console.error('[create] promotion stamp failed:', e);
		}
	}
	// Pass the guest's contact details straight through: Stripe needs them to file
	// the card against a Customer, and re-reading them from PocketBase here would
	// be two more cross-region round-trips on the response path for data we hold.
	const started = await startPaymentForBooking(booking.id, payment, {
		brand,
		customer: {
			email: input.customer.email,
			name: input.customer.name,
			phone: input.customer.phone
		}
	});
	deferWork(
		() =>
			writeAudit('system', 'create_booking', 'geisha_bookings', booking.id, null, pendingBooking),
		'pending create audit'
	);
	return {
		booking: pendingBooking,
		payment,
		paymentConfigured: started?.configured ?? false,
		paymentSession: started
			? {
					paymentId: started.payment.id,
					mode: started.mode,
					clientSecret: started.clientSecret,
					publishableKey: started.publishableKey,
					amountPence: payment.amountPence,
					kind: payment.kind
				}
			: undefined
	};
}

/**
 * Best-effort allergy/dietary extraction for a freshly created or amended booking
 * (mf-allergy-aware). Reads the guest's saved notes/allergies (best-effort) so the
 * scan covers both the booking's free text AND the profile, then writes
 * booking.dietary_flags. NEVER throws — applyAllergyFlags swallows its own errors
 * and we guard the customer fetch too, so a hiccup here can't affect the booking.
 */
async function applyAllergyFlagsForBooking(
	bookingId: string,
	customerId: string,
	specialRequests?: string
): Promise<void> {
	let notes: string | undefined;
	let allergies: string | undefined;
	try {
		if (customerId) {
			const c = await pb();
			const customer = await c.collection('geisha_customers').getOne<Customer>(customerId);
			notes = customer.notes;
			allergies = customer.allergies;
		}
	} catch {
		// profile read failed — scan the booking's own text alone (still useful).
	}
	await applyAllergyFlags(bookingId, { specialRequests, notes, allergies });
}

export { applyAllergyFlagsForBooking };
