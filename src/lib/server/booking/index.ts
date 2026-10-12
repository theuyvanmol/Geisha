// Public surface of the booking core. The API routes, admin, and (later) AI
// layer import from here. Combines the pure engine with the PB data loaders.

import { addDays, format } from 'date-fns';
import { checkAvailability, type AvailabilityResult } from './availability.js';
import { closuresForChannel } from './closures.js';
import {
	getRestaurant,
	getActivePeriods,
	getTables,
	getJoins,
	getOccupyingBookings,
	getClosures,
	getPacingRules,
	getSettings
} from './queries.js';
import { getTableRanks } from './ranking.js';
import { getChainsByRestaurant } from './chains.js';
import { getAutoJoinByRestaurant, policyFor } from './autojoin.js';
import type { BrandId } from '../db/types.js';

export { getTableRanks, setTableRanks } from './ranking.js';
export type { TableRanks } from './ranking.js';
export { getChains, setChains, chainKey } from './chains.js';
export type { TableChain } from './chains.js';
export { getAutoJoin, setAutoJoin, DEFAULT_AUTOJOIN } from './autojoin.js';
export type { AutoJoinConfig } from './autojoin.js';

export { createBooking, BookingError } from './create.js';
export type { CreateBookingInput, CreateBookingResult } from './create.js';
export { amendBooking, swapBookingTables, applyBookingBatch } from './amend.js';
export type {
	AmendBookingInput,
	AmendBookingResult,
	SwapBookingTablesResult,
	BatchEntry,
	ApplyBatchOptions,
	ApplyBatchResult
} from './amend.js';
export * from './mutate.js';
export {
	paymentRequirementFor,
	selectDepositRule,
	exceedsOnlineCap,
	depositRefundable
} from './policy.js';
export type { PaymentRequirement, DepositRuleResolved } from './policy.js';
export { getDepositRules } from './queries.js';
// Waitlist capture (WP-AVAIL-5) + in-service W8List management (ResDiary parity).
export {
	joinWaitlist,
	listWaitlist,
	cancelWaitlistEntry,
	addWaitlistWalkIn,
	markWaitlistOffered,
	markWaitlistClaimed,
	WaitlistError
} from './waitlist.js';
export type { JoinWaitlistInput, AddWaitlistInput, WaitlistRow } from './waitlist.js';

/**
 * Load everything and compute availability for a brand/date/party. This is the
 * one call the /api/availability route makes.
 */
export async function getAvailability(
	brand: BrandId,
	date: string,
	partySize: number,
	// Staff lookups (admin new-booking) take phone/manual reservations, so they
	// bypass the ONLINE party cap and the lead-time/booking-window horizon — exactly
	// as createBooking({ staff: true }) does. The room's physical fit (single table
	// or registered join) + closures + covers caps still apply, so we never offer a
	// slot that can't actually be seated. Defaults to the public widget's rules.
	opts: {
		staff?: boolean;
		/**
		 * Restrict allocation to one or more AREAS (table sections) — ResDiary's Area
		 * filter on the booking form. A host asked for "the Back Section at 7pm" wants
		 * to know whether THAT room can take the party, not whether the building can.
		 * Empty / absent = the whole floor (today's behaviour).
		 */
		areas?: string[];
		/**
		 * STAFF ONLY: compute the slot grid as if the day's closures weren't there. A
		 * closed day otherwise returns no slots at all, which left the host who means to
		 * take a Christmas booking (createBooking's `allowClosed`) with no time to pick.
		 * The room's real occupancy, table fit and covers caps still apply — this only
		 * lifts the closure itself. Ignored unless `staff`.
		 */
		ignoreClosures?: boolean;
	} = {}
): Promise<AvailabilityResult> {
	const restaurant = await getRestaurant(brand);
	const tz = restaurant.timezone || 'Europe/London';
	const [periods, tables, joins, chains, autoJoin, settings, closures, pacing, tableRanks] =
		await Promise.all([
			getActivePeriods(restaurant.id),
			getTables(restaurant.id),
			getJoins(restaurant.id),
			// staff-authored chains (ResDiary Table Joins) with their capacity — the
			// allocator prefers a registered chain over an ad-hoc table combination.
			getChainsByRestaurant(restaurant.id).catch(() => []),
			// which tables may be auto-joined at all (owner-set, /admin/tables)
			getAutoJoinByRestaurant(restaurant.id),
			getSettings(restaurant.id),
			// closures that touch this single calendar date (compared as 'YYYY-MM-DD')
			getClosures(restaurant.id, date, date),
			// pacing rules (covers caps per slot / period) — WP-AVAIL-1
			getPacingRules(restaurant.id),
			// fill-ranking map (table id → rank) — controls fill ORDER; {} = unchanged
			getTableRanks(brand)
		]);

	// pull occupying bookings across the date (± margin for long turns)
	const fromISO = `${date}T00:00:00.000Z`;
	const toISO = `${format(addDays(new Date(`${date}T00:00:00Z`), 1), 'yyyy-MM-dd')}T06:00:00.000Z`;
	const existing = await getOccupyingBookings(restaurant.id, fromISO, toISO);

	// Area filter (ResDiary): hide every table outside the requested section(s) from
	// the engine, so both the slot grid and the table it would allocate stay inside
	// the area the host asked about.
	const wanted = (opts.areas ?? []).filter(Boolean);
	const scopedTables = wanted.length
		? tables.filter((t) => wanted.includes(t.section || ''))
		: tables;

	return checkAvailability({
		date,
		partySize,
		timezone: tz,
		periods,
		tables: scopedTables,
		joins,
		chains,
		// staff-only tables join for a host's lookup, never for the public widget
		autoJoin: policyFor(autoJoin, opts.staff ? 'staff' : 'online'),
		existing,
		// ResDiary "Type": a close-out can block online-only, in-house-only or both. This
		// availability read is the ONLINE channel when a guest books and the INTERNAL
		// channel when staff check on someone's behalf, so drop the close-outs that don't
		// apply to the channel in play (a 'common' close-out always applies).
		closures:
			opts.staff && opts.ignoreClosures
				? []
				: closuresForChannel(closures, opts.staff ? 'internal' : 'online'),
		pacing,
		tableRanks,
		// Staff bypass the online party cap (they book big parties by phone). A very
		// high cap effectively disables the "requiresPhone" short-circuit while still
		// letting the physical table/join fit decide what's actually seatable.
		onlinePartyMax: opts.staff ? Number.MAX_SAFE_INTEGER : settings.online_party_max,
		slotIntervalMinutes: settings.slot_interval_minutes,
		// horizon enforcement (WP-AVAIL-3): the request instant + global limits. Staff
		// take same-day / far-ahead bookings, so they skip the lead-time/window horizon
		// (nowMs omitted) — mirrors createBooking({ staff: true }).
		nowMs: opts.staff ? undefined : Date.now(),
		bookingWindowDays: settings.booking_window_days,
		leadTimeMinutes: settings.lead_time_minutes,
		leadTimeMode: settings.lead_time_mode
	});
}
