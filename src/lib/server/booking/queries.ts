// Data-access helpers: load from PocketBase the rows the booking logic needs,
// and shape them for the (pure) availability engine + policy functions.
//
// These are the only place that talks to PB for booking reads; the engine and
// policy stay DB-free. Server-only (imports the superuser client).

import { pb } from '../db/pb.js';
import type {
	Booking,
	BrandId,
	Closure,
	Customer,
	DepositRule,
	DiningTable,
	Floor,
	FloorShape,
	PacingRule as PacingRuleRow,
	Restaurant,
	ServicePeriod,
	Setting,
	TableJoin
} from '../db/types.js';
import type { BookingFootprint, LeadTimeMode } from './availability.js';
import type { ClosureRule } from './closures.js';
import type { PacingRule } from './pacing.js';
import type { DepositRuleResolved, PolicySettings } from './policy.js';

/** Statuses that actually occupy a table (exclude cancelled / no_show). */
const OCCUPYING_STATUSES = ['pending_payment', 'confirmed', 'seated', 'completed'];

/**
 * PocketBase stores datetimes as "YYYY-MM-DD HH:mm:ss.SSSZ" (a SPACE, not "T")
 * and compares them lexicographically in filters. A JS ISO string uses "T", so
 * a filter bound built from `.toISOString()` would sort AFTER every stored value
 * and silently match nothing — which previously let overlapping bookings slip
 * past the availability check. Always normalise filter bounds through this.
 */
export function toPbDateFilter(iso: string): string {
	return iso.replace('T', ' ');
}

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

// PERF: getRestaurant has ~114 call sites and sits at the top of nearly every
// server helper (each one re-resolves brand → restaurant id before its real
// query). A single /admin/diary load was firing the SAME `brand="asia"` lookup
// 15 times — 15 of the load's 34 PocketBase round-trips, all for a row that
// holds only { brand, display_name, timezone } and that NOTHING in the codebase
// ever writes. It is immutable config, so it is cached here.
//
// We cache the PROMISE, not the resolved row: those 15 calls are mostly
// concurrent (the loader fans out), so a value-only cache would let all 15 miss
// and hit PB before the first one resolved. Caching the in-flight promise
// collapses them into one request. A rejected lookup is evicted so a transient
// PB error can't be cached as a permanent failure.
const RESTAURANT_TTL_MS = 5 * 60_000;
const restaurantCache = new Map<BrandId, { at: number; row: Promise<Restaurant> }>();

export function getRestaurant(brand: BrandId): Promise<Restaurant> {
	const hit = restaurantCache.get(brand);
	if (hit && Date.now() - hit.at < RESTAURANT_TTL_MS) return hit.row;

	const row = (async () => {
		const c = await pb();
		return c.collection('geisha_restaurants').getFirstListItem<Restaurant>(`brand=${q(brand)}`);
	})();
	restaurantCache.set(brand, { at: Date.now(), row });
	// Never cache a failure: drop the entry so the next caller retries.
	row.catch(() => {
		if (restaurantCache.get(brand)?.row === row) restaurantCache.delete(brand);
	});
	return row;
}

export async function getActivePeriods(restaurantId: string): Promise<ServicePeriod[]> {
	const c = await pb();
	return c
		.collection('geisha_service_periods')
		.getFullList<ServicePeriod>({ filter: `restaurant=${q(restaurantId)} && active=true` });
}

export async function getTables(restaurantId: string): Promise<DiningTable[]> {
	const c = await pb();
	return c
		.collection('geisha_tables')
		.getFullList<DiningTable>({ filter: `restaurant=${q(restaurantId)}` });
}

export async function getJoins(restaurantId: string): Promise<TableJoin[]> {
	const c = await pb();
	const registered = await c
		.collection('geisha_table_joins')
		.getFullList<TableJoin>({ filter: `restaurant=${q(restaurantId)}` });
	// Fold in the pairwise adjacency implied by staff-managed CHAINS (ResDiary Table
	// Joins) so a registered chain auto-combines for big parties — no engine change,
	// the allocator just sees more adjacency. Registered pairs + chain pairs coexist;
	// deduped by unordered pair. NB: this only shapes AUTO-allocation & join suggestions
	// — staff can still manually join ANY tables in the diary modals (createBooking's
	// explicit-tableIds path validates only fit + free, never the join graph).
	const { getChainsByRestaurant, chainsToJoinPairs } = await import('./chains.js');
	const chains = await getChainsByRestaurant(restaurantId).catch(() => []);
	const chainPairs = chainsToJoinPairs(restaurantId, chains);
	const seen = new Set(registered.map((j) => [j.table_a, j.table_b].sort().join('|')));
	const merged = [...registered];
	for (const p of chainPairs) {
		const key = [p.table_a, p.table_b].sort().join('|');
		if (!seen.has(key)) {
			seen.add(key);
			merged.push(p);
		}
	}
	return merged;
}

/** Floors for a restaurant, in display order. Empty if the migration hasn't run. */
export async function getFloors(restaurantId: string): Promise<Floor[]> {
	const c = await pb();
	try {
		return await c
			.collection('geisha_floors')
			.getFullList<Floor>({ filter: `restaurant=${q(restaurantId)}`, sort: 'sort_order' });
	} catch {
		return []; // collection not present yet (pre-migration) — degrade gracefully
	}
}

/** Wall/zone/label shapes for a floor. */
export async function getShapes(floorId: string): Promise<FloorShape[]> {
	const c = await pb();
	try {
		return await c
			.collection('geisha_floor_shapes')
			.getFullList<FloorShape>({ filter: `floor=${q(floorId)}` });
	} catch {
		return [];
	}
}

/**
 * Bookings that occupy tables on a given local date (plus a margin so a long
 * turn starting late the previous day is still considered). Returns the
 * footprint shape the availability engine consumes.
 */
export async function getOccupyingBookings(
	restaurantId: string,
	fromISO: string,
	toISO: string
): Promise<BookingFootprint[]> {
	const c = await pb();
	const statusFilter = OCCUPYING_STATUSES.map((s) => `status=${q(s)}`).join(' || ');
	// PocketBase stores datetimes with a space (not "T") — normalise the bounds.
	const from = toPbDateFilter(fromISO);
	const to = toPbDateFilter(toISO);
	const rows = await c.collection('geisha_bookings').getFullList<Booking>({
		filter: `restaurant=${q(restaurantId)} && starts_at>=${q(from)} && starts_at<=${q(to)} && (${statusFilter})`
	});
	return rows.map((b) => ({
		tableIds: b.tables ?? [],
		startsAt: b.starts_at,
		endsAt: b.ends_at,
		// Covers — the pacing engine (WP-AVAIL-1) sums these per slot / period.
		partySize: b.party_size ?? 0
	}));
}

/** A booking footprint that CARRIES its booking id, so callers that must exclude
 *  specific bookings from the occupancy set (the diary batch-commit / swap path)
 *  can do it by IDENTITY instead of the fragile window+tables shape match. */
export interface IdentifiedFootprint extends BookingFootprint {
	id: string;
}

/**
 * Same window read as {@link getOccupyingBookings} but each footprint keeps its
 * booking id. The batch/swap commit needs to exclude every participant reliably
 * (two bookings can legitimately share a window+tableset mid-swap, which defeats a
 * shape match) and to detect intra-batch clashes between the participants' NEW
 * windows — both need identity, not shape.
 */
export async function getOccupyingBookingsWithId(
	restaurantId: string,
	fromISO: string,
	toISO: string
): Promise<IdentifiedFootprint[]> {
	const c = await pb();
	const statusFilter = OCCUPYING_STATUSES.map((s) => `status=${q(s)}`).join(' || ');
	const from = toPbDateFilter(fromISO);
	const to = toPbDateFilter(toISO);
	const rows = await c.collection('geisha_bookings').getFullList<Booking>({
		filter: `restaurant=${q(restaurantId)} && starts_at>=${q(from)} && starts_at<=${q(to)} && (${statusFilter})`
	});
	return rows.map((b) => ({
		id: b.id,
		tableIds: b.tables ?? [],
		startsAt: b.starts_at,
		endsAt: b.ends_at,
		partySize: b.party_size ?? 0
	}));
}

/**
 * Pacing rules (covers caps, lead time, booking window) for a restaurant,
 * normalised to the pure {@link PacingRule} shape the availability engine
 * consumes. Degrades to [] if the collection isn't present yet (pre-migration),
 * mirroring getFloors / getClosures so availability never hard-fails (WP-AVAIL-1).
 */
export async function getPacingRules(restaurantId: string): Promise<PacingRule[]> {
	const c = await pb();
	try {
		const rows = await c
			.collection('geisha_pacing_rules')
			.getFullList<PacingRuleRow>({ filter: `restaurant=${q(restaurantId)}` });
		return rows.map((r) => ({
			servicePeriodId: r.service_period || undefined,
			dow: Array.isArray(r.dow) ? r.dow : [],
			maxCoversPerSlot: r.max_covers_per_slot ?? 0,
			maxCoversPerPeriod: r.max_covers_per_period ?? 0
		}));
	} catch {
		return []; // collection not present yet — degrade gracefully
	}
}

/**
 * Deposit / no-show-hold rules for a restaurant, normalised to the pure
 * {@link DepositRuleResolved} shape the policy engine consumes. Degrades to [] if
 * the collection isn't present yet (pre-migration) — paymentRequirementFor then
 * uses the seeded/legacy hardcoded fallback, so the booking flow never hard-fails
 * (mirrors getPacingRules / getClosures). Owner decision #4 (configurable deposits).
 */
export async function getDepositRules(restaurantId: string): Promise<DepositRuleResolved[]> {
	const c = await pb();
	try {
		const rows = await c
			.collection('geisha_deposit_rules')
			.getFullList<DepositRule>({ filter: `restaurant=${q(restaurantId)}`, sort: 'priority' });
		return rows.map((r) => ({
			priority: r.priority ?? 0,
			servicePeriodId: r.service_period || undefined,
			partyMin: r.party_min ?? 1,
			partyMax: r.party_max ?? 0,
			dow: Array.isArray(r.dow) ? r.dow : [],
			dateFrom: r.date_from || undefined,
			dateTo: r.date_to || undefined,
			kind: (r.kind || 'none') as DepositRuleResolved['kind'],
			perPersonPence: r.per_person_pence ?? 0,
			capture: (r.capture || 'auto') as DepositRuleResolved['capture'],
			promotion: r.promotion || undefined
		}));
	} catch {
		return []; // collection not present yet — degrade gracefully
	}
}

/**
 * Closures (full-day / per-period blackouts) overlapping [fromDate, toDate]
 * inclusive, normalised to the engine's pure {@link ClosureRule} shape. Compared
 * as 'YYYY-MM-DD' strings (lexicographic = calendar order). Degrades to [] if the
 * collection isn't present yet (pre-migration) so availability never hard-fails.
 */
export async function getClosures(
	restaurantId: string,
	fromDate: string,
	toDate: string
): Promise<ClosureRule[]> {
	const c = await pb();
	try {
		// date_from / date_to are PocketBase `date` fields, so PB stores + returns them
		// as full datetimes ('2026-06-30 00:00:00.000Z'), NOT bare 'YYYY-MM-DD'. The
		// closures engine compares calendar-date strings lexicographically, which only
		// works on the bare day — so we must (a) widen the SQL filter to whole-day
		// boundaries (a closure that STARTS on `toDate` is stored as `toDate 00:00…`,
		// which is > `toDate`, so the naive `date_from<=toDate` dropped same-day
		// closures), and (b) slice every returned value back to its 'YYYY-MM-DD' day
		// before handing it to the pure predicates. This is THE normalisation point for
		// availability, create, amend and the diary banner — fix it once here.
		const dayEnd = `${toDate} 23:59:59.999Z`; // any closure starting on toDate is < this
		const rows = await c.collection('geisha_closures').getFullList<Closure>({
			filter: `restaurant=${q(restaurantId)} && date_from<=${q(dayEnd)} && (date_to>=${q(fromDate)} || date_to="")`
		});
		const day = (v: string) => (v || '').slice(0, 10); // 'YYYY-MM-DD…' → 'YYYY-MM-DD'
		return rows
			.filter((r) => r.scope === 'full' || r.scope === 'period' || r.scope === 'section')
			.map((r) => ({
				dateFrom: day(r.date_from),
				dateTo: day(r.date_to) || day(r.date_from),
				scope: r.scope as 'full' | 'period' | 'section',
				servicePeriodId: r.service_period || undefined,
				section: r.section || undefined,
				table: r.table || undefined,
				timeFrom: r.time_from || undefined,
				timeTo: r.time_to || undefined,
				kind: r.kind || '',
				reason: r.reason || '',
				// ResDiary parity fields (migration 1785400000; undefined pre-migration).
				name: r.name || undefined,
				daysOfWeek: Array.isArray(r.days_of_week) ? r.days_of_week : undefined,
				channelType: r.channel_type || undefined,
				colour: r.colour || undefined
			}));
	} catch {
		return []; // collection not present yet — degrade gracefully
	}
}

/** Load settings for a restaurant as a typed PolicySettings object (+ extras). */
export async function getSettings(restaurantId: string): Promise<
	PolicySettings & {
		booking_window_days: number;
		slot_interval_minutes: number;
		unpaid_hold_minutes: number;
		lead_time_minutes: number;
		lead_time_mode: LeadTimeMode;
	}
> {
	const c = await pb();
	const rows = await c
		.collection('geisha_settings')
		.getFullList<Setting>({ filter: `restaurant=${q(restaurantId)}` });
	const map = new Map(rows.map((r) => [r.key, r.value]));
	const num = (k: string, def: number) => {
		const v = map.get(k);
		return typeof v === 'number' ? v : def;
	};
	return {
		// Max covers a guest can book online in one reservation. Staff bypass this
		// entirely (createBooking({ staff:true }) / staff amends raise the cap), so
		// only the public booking flow is held to it. Default 30; override per-venue
		// via the `online_party_max` setting.
		online_party_max: num('online_party_max', 30),
		deposit_per_person_6plus_pence: num('deposit_per_person_6plus_pence', 1000),
		noshow_fee_per_person_fri_sat_pence: num('noshow_fee_per_person_fri_sat_pence', 500),
		release_after_minutes: num('release_after_minutes', 20),
		booking_window_days: num('booking_window_days', 60),
		slot_interval_minutes: num('slot_interval_minutes', 15),
		// §S1-4: pre-start unpaid-hold timeout — cancel a pending_payment booking
		// whose card step was abandoned this many minutes after it was created.
		unpaid_hold_minutes: num('unpaid_hold_minutes', 15),
		// ResDiary "Online Booking Restriction": how long before a booking the website
		// stops taking it. ResDiary ships this OFF (0 = no restriction) and so do we —
		// the unconditional past floor in availability.ts is separate and always on.
		lead_time_minutes: num('lead_time_minutes', 0),
		// …and what those minutes are counted back from. ResDiary offers both; 'visit'
		// (the guest's own time) is the rolling cut-off most houses expect.
		lead_time_mode: map.get('lead_time_mode') === 'service' ? 'service' : 'visit'
	};
}

/** Find a customer by email, or create one. */
export async function upsertCustomer(input: {
	name: string;
	email: string;
	phone?: string;
	marketingConsent?: boolean;
}): Promise<Customer> {
	const c = await pb();
	const coll = c.collection('geisha_customers');
	// Email is the identity key. Walk-ins and other quick staff bookings often have
	// NO email — matching on email="" would collapse every anonymous guest onto one
	// shared customer record (and overwrite its name on each booking), so an empty
	// email always creates a fresh customer instead of matching. A phone, when given,
	// is used as a secondary key so a repeat phone walk-in still de-dupes.
	const emailKey = input.email.trim();
	const phoneKey = (input.phone ?? '').trim();
	try {
		if (!emailKey && !phoneKey) throw new Error('no identity key — create fresh');
		const match = emailKey ? `email=${q(emailKey)}` : `phone=${q(phoneKey)}`;
		const existing = await coll.getFirstListItem<Customer>(match);
		// NEVER overwrite an existing customer's details with a blank, and never let a
		// new booking retroactively rewrite the name on this guest's EARLIER bookings.
		// Each booking now snapshots its own guest_name/guest_phone (migration
		// 1785500000), so this record is CRM identity, not the source of truth for what
		// a past booking was called — which is how ResDiary separates the two.
		//
		// The name is refreshed only when the record has none yet: a repeat email that
		// arrives under a different spelling updates that BOOKING, not the history.
		// The phone uses a trimmed emptiness check, not `??` — an empty string is
		// neither null nor undefined, so `input.phone ?? existing.phone` used to keep
		// the empty string and wipe the number the run-sheet rings to chase a late table.
		const nextName = input.name.trim();
		const nextPhone = (input.phone ?? '').trim();
		const patch: Partial<Customer> = {};
		if (!existing.name?.trim() && nextName) patch.name = nextName;
		if (nextPhone) patch.phone = nextPhone;
		if (input.marketingConsent !== undefined) patch.marketing_consent = input.marketingConsent;
		if (Object.keys(patch).length === 0) return existing;
		return await coll.update<Customer>(existing.id, patch);
	} catch {
		return coll.create<Customer>({
			name: input.name,
			email: input.email,
			phone: input.phone ?? '',
			marketing_consent: input.marketingConsent ?? false,
			notes: ''
		});
	}
}
