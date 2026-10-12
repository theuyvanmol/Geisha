// Admin data layer — reads/writes for the back-office (BOOKING_SYSTEM_PLAN §8).
// Server-only. The admin pages call these via +page.server.ts loaders + actions.
// Auth is deferred (§11) — for now everything runs with the superuser token.

import { fromZonedTime } from 'date-fns-tz';
import { pb } from '../db/pb.js';
import { invalidatePublicHours } from './hoursCache.js';
import type {
	AuditActor,
	Booking,
	BookingStatus,
	BrandId,
	Closure,
	Customer,
	DepositCapture,
	DepositKind,
	DepositRule,
	DiningTable,
	Floor,
	FloorShape,
	FloorState,
	PacingRuleRow,
	Payment,
	PaymentKind,
	PaymentStatus,
	Restaurant,
	ServicePeriod,
	Setting,
	TableJoin
} from '../db/types.js';
import {
	getRestaurant,
	getTables,
	getJoins,
	getFloors,
	getShapes,
	getActivePeriods,
	getPacingRules,
	toPbDateFilter
} from './queries.js';
import { selectPacingRule } from './pacing.js';
import { writeAudit } from './audit.js';
import { bookingReference } from '../../bookings/reference.js';
import { getPromotion } from '../../data/promotions.js';
import { estimateTurnMinutes, predictFree, type TurnSample, type FreePrediction } from './turns.js';
import { seatedBarStartMin, seatTrimFloors } from '../../diary/seatTrim.js';
import { snapBarToCells, snapEndCaps } from '../../diary/barGrid.js';
import { isWholeRestaurant, dayOfWeekOf } from './closures.js';
import { isWalkinBooking } from './walkin.js';
import { planDateEdits } from './closureRanges.js';
import { shiftDay, MAX_RANGE_DAYS } from '../../service/closureCalendar.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export interface BookingWithRefs extends Booking {
	expand?: { customer?: Customer };
}

/**
 * Overlay each booking's own guest snapshot onto the expanded customer (B5).
 *
 * Every service screen reads the guest through `b.expand.customer.name`, but that
 * record is SHARED by every booking on the same email. Bookings now carry their own
 * `guest_name`/`guest_phone` (migration 1785500000); resolving them here — at the one
 * funnel every diary/floor/run-sheet read passes through — means each screen shows the
 * name the booking was actually made under, with no change at ~20 call sites.
 *
 * Back-compat: bookings written before the migration have no snapshot and fall through
 * to the customer record exactly as before.
 */
function withGuestSnapshot<T extends BookingWithRefs>(rows: T[]): T[] {
	for (const b of rows) {
		const name = (b as { guest_name?: string }).guest_name?.trim();
		const phone = (b as { guest_phone?: string }).guest_phone?.trim();
		if (!name && !phone) continue;
		// Clone rather than mutate the shared expand object — several bookings can
		// point at the SAME customer instance, and mutating it would make the last
		// booking's name win on all of them (the very bug this fixes).
		b.expand = { ...b.expand, customer: { ...(b.expand?.customer as Customer) } };
		if (name) b.expand.customer!.name = name;
		if (phone) b.expand.customer!.phone = phone;
	}
	return rows;
}

/**
 * "Today" as the RESTAURANT sees it — 'YYYY-MM-DD' in Europe/London.
 *
 * The service loaders used to derive this with `new Date().toISOString().slice(0, 10)`,
 * which is UTC. Through British Summer Time — late March to late October, seven months
 * of the year — local time is UTC+1, so between 00:00 and 01:00 the UTC date is still
 * YESTERDAY. That is precisely the window in which this restaurant is closing down a
 * service that ran to 23:45: staff marking no-shows and checking tomorrow's book landed
 * on the wrong day, and the floor plan's "now" was wrong with it.
 *
 * Pinning the Vercel functions to lhr1 does not help — the server clock is UTC whatever
 * the region. 'en-CA' is the locale trick that yields ISO-shaped 'YYYY-MM-DD'.
 */
export function todayISO(tz: string = DIARY_TZ): string {
	return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

/** All bookings for a brand on a local date, chronological, with customer expanded. */
export async function getBookingsForDay(brand: BrandId, date: string): Promise<BookingWithRefs[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	// date is local 'YYYY-MM-DD'; widen the window to be safe for tz/long turns.
	// NOTE: PocketBase stores datetimes as "YYYY-MM-DD HH:mm:ss.SSSZ" (space, not
	// "T") and compares them lexicographically, so filter bounds MUST use a space.
	const from = toPbDateFilter(`${date}T00:00:00.000Z`);
	const to = toPbDateFilter(`${date}T23:59:59.999Z`);
	const rows = await c.collection('geisha_bookings').getFullList<BookingWithRefs>({
		filter: `restaurant=${q(restaurant.id)} && starts_at>=${q(from)} && starts_at<=${q(to)}`,
		sort: 'starts_at',
		expand: 'customer'
	});
	return withGuestSnapshot(rows);
}

export interface DashboardStats {
	restaurant: Restaurant;
	date: string;
	totalBookings: number;
	totalCovers: number;
	upcoming: BookingWithRefs[];
	seated: number;
	pendingPayment: number;
	/** Live bookings that arrived off the street (isWalkinBooking), and their covers. */
	walkins: number;
	walkinCovers: number;
}

/** Today-at-a-glance numbers for the dashboard. */
export async function getDashboard(brand: BrandId, date: string): Promise<DashboardStats> {
	const restaurant = await getRestaurant(brand);
	const bookings = await getBookingsForDay(brand, date);
	const live = bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'no_show');
	return {
		restaurant,
		date,
		totalBookings: live.length,
		totalCovers: live.reduce((n, b) => n + (b.party_size || 0), 0),
		upcoming: live
			.filter((b) => b.status === 'confirmed' || b.status === 'pending_payment')
			.slice(0, 8),
		seated: bookings.filter((b) => b.status === 'seated').length,
		pendingPayment: bookings.filter((b) => b.status === 'pending_payment').length,
		// Counted off `live` so the walk-in figure sits on the same base as
		// Bookings/Covers — cancelled and no-show rows are excluded from all three.
		walkins: live.filter((b) => isWalkinBooking(b)).length,
		walkinCovers: live.reduce((n, b) => n + (isWalkinBooking(b) ? b.party_size || 0 : 0), 0)
	};
}

/** A single booking with customer expanded (for the detail page). */
export async function getBookingDetail(id: string): Promise<BookingWithRefs> {
	const c = await pb();
	const row = await c
		.collection('geisha_bookings')
		.getOne<BookingWithRefs>(id, { expand: 'customer' });
	return withGuestSnapshot([row])[0];
}

/**
 * The payment row attached to a booking, or null if none. Read-only loader for
 * the booking-detail Payment panel; the refund/release actions live in
 * booking/payments.ts. Degrades to null on any error (collection missing in dev,
 * no payment created for a no-deposit booking, etc.).
 */
export async function getPaymentForBooking(bookingId: string): Promise<Payment | null> {
	const c = await pb();
	return c
		.collection('geisha_payments')
		.getFirstListItem<Payment>(`booking=${q(bookingId)}`)
		.catch(() => null);
}

// --- tables ----------------------------------------------------------------

export async function listTables(brand: BrandId): Promise<DiningTable[]> {
	const restaurant = await getRestaurant(brand);
	return getTables(restaurant.id);
}

export async function listJoins(brand: BrandId): Promise<TableJoin[]> {
	const restaurant = await getRestaurant(brand);
	return getJoins(restaurant.id);
}

export async function createTable(
	brand: BrandId,
	data: Partial<DiningTable>,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<DiningTable> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const row = await c.collection('geisha_tables').create<DiningTable>({
		restaurant: restaurant.id,
		label: data.label ?? 'New',
		seats_min: data.seats_min ?? 2,
		seats_max: data.seats_max ?? 4,
		section: data.section ?? 'Main',
		bookable: data.bookable ?? true,
		x: data.x ?? 40,
		y: data.y ?? 40,
		width: data.width ?? 90,
		height: data.height ?? 90,
		shape: data.shape ?? 'rect',
		floor: data.floor ?? '',
		rotation: data.rotation ?? 0,
		width_cm: data.width_cm ?? 180,
		height_cm: data.height_cm ?? 180
	});
	await writeAudit(actor, 'create_table', 'geisha_tables', row.id, null, row, onBehalfOf);
	return row;
}

export async function updateTable(
	id: string,
	data: Partial<DiningTable>,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<DiningTable> {
	const c = await pb();
	const row = await c.collection('geisha_tables').update<DiningTable>(id, data);
	await writeAudit(actor, 'update_table', 'geisha_tables', id, null, row, onBehalfOf);
	return row;
}

/**
 * Delete a table from the floor plan.
 *
 * `geisha_tables` is referenced by three collections with REQUIRED, non-cascade
 * relations — `geisha_table_joins` (table_a/table_b), `geisha_floor_state`
 * (table), and `geisha_bookings.tables` (multi-rel). PocketBase refuses to delete
 * a record those still point at, so a bare `.delete(id)` 500s for any table that
 * was ever joined or seated (the floor-editor "Delete table" doing nothing). We
 * therefore clear the references first — but never silently drop a LIVE booking:
 *
 *  - If an active booking (pending_payment / confirmed / seated) still holds this
 *    table, refuse with a clear message so staff move/clear it first.
 *  - Otherwise delete its join rows + floor_state rows, scrub the id out of any
 *    historical (completed/cancelled/no_show) bookings' `tables`, then delete.
 */
export async function deleteTable(
	id: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<void> {
	const c = await pb();

	// 1. Block if a live reservation still holds this table.
	const ACTIVE = ['pending_payment', 'confirmed', 'seated'] as const;
	const activeHolders = await c.collection('geisha_bookings').getFullList<Booking>({
		filter: `tables ~ ${q(id)} && (${ACTIVE.map((s) => `status=${q(s)}`).join(' || ')})`
	});
	if (activeHolders.length > 0) {
		throw new Error(
			`Can't delete this table: ${activeHolders.length} active booking(s) are on it. Move or clear them first.`
		);
	}

	// 2. Remove the REQUIRED-relation references that would otherwise block delete.
	const joinRows = await c
		.collection('geisha_table_joins')
		.getFullList<TableJoin>({ filter: `table_a=${q(id)} || table_b=${q(id)}` });
	for (const j of joinRows) await c.collection('geisha_table_joins').delete(j.id);

	const stateRows = await c
		.collection('geisha_floor_state')
		.getFullList<FloorState>({ filter: `table=${q(id)}` });
	for (const s of stateRows) await c.collection('geisha_floor_state').delete(s.id);

	// 3. Scrub the id from any historical bookings' multi-rel `tables` (non-required,
	//    so this just tidies the array — the booking row itself is kept for history).
	const histHolders = await c
		.collection('geisha_bookings')
		.getFullList<Booking>({ filter: `tables ~ ${q(id)}` });
	for (const b of histHolders) {
		const next = (b.tables ?? []).filter((t) => t !== id);
		await c.collection('geisha_bookings').update(b.id, { tables: next });
	}

	// 4. Now the table is unreferenced — delete it.
	await c.collection('geisha_tables').delete(id);
	await writeAudit(actor, 'delete_table', 'geisha_tables', id, null, null, onBehalfOf);
}

/** One table's geometry as persisted by the floor editor. Only `id`/`x`/`y` are
 *  required; the rest are written when present (back-compat with old callers). */
export interface TableGeometry {
	id: string;
	x: number;
	y: number;
	width?: number; // rendered px (derived from cm * px_per_cm)
	height?: number;
	width_cm?: number; // canonical real-world size
	height_cm?: number;
	rotation?: number;
	floor?: string;
}

/** Persist floor-plan geometry for many tables at once (from the editor). */
export async function saveLayout(
	positions: TableGeometry[],
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<void> {
	const c = await pb();
	for (const p of positions) {
		const patch: Record<string, unknown> = { x: Math.round(p.x), y: Math.round(p.y) };
		if (p.width != null) patch.width = Math.round(p.width);
		if (p.height != null) patch.height = Math.round(p.height);
		if (p.width_cm != null) patch.width_cm = p.width_cm;
		if (p.height_cm != null) patch.height_cm = p.height_cm;
		if (p.rotation != null) patch.rotation = p.rotation;
		if (p.floor != null) patch.floor = p.floor;
		await c.collection('geisha_tables').update(p.id, patch);
	}
	// One bulk-geometry audit row (the editor saves the whole layout at once).
	await writeAudit(actor, 'save_layout', 'geisha_tables', '', null, positions, onBehalfOf);
}

export async function createJoin(
	brand: BrandId,
	tableA: string,
	tableB: string
): Promise<TableJoin> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	return c
		.collection('geisha_table_joins')
		.create<TableJoin>({ restaurant: restaurant.id, table_a: tableA, table_b: tableB });
}

export async function deleteJoin(id: string): Promise<void> {
	const c = await pb();
	await c.collection('geisha_table_joins').delete(id);
}

/**
 * Reconcile the full set of joins for a brand against `desired` (unordered
 * pairs). Creates pairs that are new and deletes existing joins no longer
 * present. Called by the floor editor's Save, where snapped-together tables
 * define the combinable pairs.
 */
export async function setJoins(
	brand: BrandId,
	desired: Array<{ table_a: string; table_b: string }>,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<void> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const key = (a: string, b: string) => [a, b].sort().join('|');
	const wanted = new Set(desired.map((d) => key(d.table_a, d.table_b)));

	const existing = await getJoins(restaurant.id);
	const existingKeys = new Set<string>();
	for (const j of existing) {
		const k = key(j.table_a, j.table_b);
		existingKeys.add(k);
		if (!wanted.has(k)) await c.collection('geisha_table_joins').delete(j.id);
	}
	for (const d of desired) {
		if (existingKeys.has(key(d.table_a, d.table_b))) continue;
		await c
			.collection('geisha_table_joins')
			.create<TableJoin>({ restaurant: restaurant.id, table_a: d.table_a, table_b: d.table_b });
	}
	await writeAudit(
		actor,
		'set_joins',
		'geisha_table_joins',
		restaurant.id,
		existing,
		desired,
		onBehalfOf
	);
}

// --- floors & shapes -------------------------------------------------------

export async function listFloors(brand: BrandId): Promise<Floor[]> {
	const restaurant = await getRestaurant(brand);
	return getFloors(restaurant.id);
}

export async function createFloor(
	brand: BrandId,
	data: Partial<Floor>,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Floor> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	// place new floors after the current last one
	const existing = await getFloors(restaurant.id);
	const nextOrder = existing.reduce((m, f) => Math.max(m, f.sort_order ?? 0), -1) + 1;
	const row = await c.collection('geisha_floors').create<Floor>({
		restaurant: restaurant.id,
		name: data.name ?? 'New floor',
		sort_order: data.sort_order ?? nextOrder,
		width_cm: data.width_cm ?? 1000,
		height_cm: data.height_cm ?? 800,
		px_per_cm: data.px_per_cm ?? 0.5
	});
	await writeAudit(actor, 'create_floor', 'geisha_floors', row.id, null, row, onBehalfOf);
	return row;
}

export async function updateFloor(
	id: string,
	data: Partial<Floor>,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Floor> {
	const c = await pb();
	const row = await c.collection('geisha_floors').update<Floor>(id, data);
	await writeAudit(actor, 'update_floor', 'geisha_floors', id, null, row, onBehalfOf);
	return row;
}

/**
 * Delete a floor. Guards against orphaning tables: if any table still references
 * this floor, the delete is refused (the caller must move those tables first).
 * Shapes on the floor are removed by the relation's cascadeDelete.
 */
export async function deleteFloor(
	id: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<void> {
	const c = await pb();
	const onFloor = await c
		.collection('geisha_tables')
		.getFullList<DiningTable>({ filter: `floor=${q(id)}` });
	if (onFloor.length > 0) {
		throw new Error(
			`Cannot delete floor: ${onFloor.length} table(s) are still on it. Move them to another floor first.`
		);
	}
	await c.collection('geisha_floors').delete(id);
	await writeAudit(actor, 'delete_floor', 'geisha_floors', id, null, null, onBehalfOf);
}

export async function listShapes(floorId: string): Promise<FloorShape[]> {
	return getShapes(floorId);
}

/**
 * Reconcile the full set of shapes for a floor against `desired`. Shapes with an
 * existing id are updated; new shapes (no id, or id not present) are created;
 * existing shapes absent from `desired` are deleted. Mirrors {@link setJoins}.
 */
export async function setShapes(
	floorId: string,
	desired: Array<Partial<FloorShape> & { id?: string }>,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<void> {
	const c = await pb();
	const existing = await getShapes(floorId);
	const desiredIds = new Set(desired.map((d) => d.id).filter(Boolean) as string[]);

	for (const s of existing) {
		if (!desiredIds.has(s.id)) await c.collection('geisha_floor_shapes').delete(s.id);
	}
	for (const d of desired) {
		const payload = {
			floor: floorId,
			kind: d.kind ?? 'wall',
			x: Math.round(d.x ?? 0),
			y: Math.round(d.y ?? 0),
			width: Math.round(d.width ?? 0),
			height: Math.round(d.height ?? 0),
			rotation: d.rotation ?? 0,
			label: d.label ?? '',
			color: d.color ?? ''
		};
		if (d.id && existing.some((e) => e.id === d.id)) {
			await c.collection('geisha_floor_shapes').update(d.id, payload);
		} else {
			await c.collection('geisha_floor_shapes').create(payload);
		}
	}
	await writeAudit(
		actor,
		'set_shapes',
		'geisha_floor_shapes',
		floorId,
		existing,
		desired,
		onBehalfOf
	);
}

// --- settings & periods ----------------------------------------------------

export async function listSettings(brand: BrandId): Promise<Setting[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	return c
		.collection('geisha_settings')
		.getFullList<Setting>({ filter: `restaurant=${q(restaurant.id)}`, sort: 'key' });
}

/** One setting's value for a brand by key, or `undefined` if not set. */
export async function getSettingValue<T = unknown>(
	brand: BrandId,
	key: string
): Promise<T | undefined> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	try {
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${q(restaurant.id)} && key=${q(key)}`);
		return row.value as T;
	} catch {
		return undefined;
	}
}

export async function updateSetting(id: string, value: unknown): Promise<Setting> {
	const c = await pb();
	const before = await c.collection('geisha_settings').getOne<Setting>(id);
	const row = await c.collection('geisha_settings').update<Setting>(id, { value });
	await writeAudit('staff', 'update_setting', 'geisha_settings', id, before, row);
	return row;
}

/**
 * Write one brand-scoped setting BY KEY, creating the row when this brand has
 * never held that key. `updateSetting` needs a row id, which is fine for a value
 * the settings list just rendered; this is for writes that must land regardless —
 * a key added after the seed ran, or a brand seeded before the key existed.
 */
export async function setSettingByKey(
	brand: BrandId,
	key: string,
	value: unknown,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Setting> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	let before: Setting | null = null;
	try {
		before = await c
			.collection('geisha_settings')
			.getFirstListItem<Setting>(`restaurant=${q(restaurant.id)} && key=${q(key)}`);
	} catch {
		before = null; // no row yet — this is a create
	}
	const row = before
		? await c.collection('geisha_settings').update<Setting>(before.id, { value })
		: await c
				.collection('geisha_settings')
				.create<Setting>({ restaurant: restaurant.id, key, value });
	await writeAudit(
		actor,
		before ? 'update_setting' : 'create_setting',
		'geisha_settings',
		row.id,
		before,
		row,
		onBehalfOf
	);
	return row;
}

// --- diary interface settings (ResDiary's per-diary UI prefs) ----------------
// One brand-scoped geisha_settings row, key 'diary_ui', holds the in-service
// diary preferences: which colour scheme the grid opens on, the "new booking"
// highlight window (how recently-created a booking must be to ring the bell),
// and the party size at which a booking counts as a "large party". Stored as a
// single json blob so it needs no migration — managers edit it in /admin/settings.
export const DIARY_UI_KEY = 'diary_ui';
export type DiaryColourScheme =
	| 'arrival'
	| 'service'
	| 'confirmation'
	| 'preorder'
	| 'payment'
	| 'channel'
	| 'important'
	| 'large_party';
export interface DiaryUiConfig {
	defaultColourScheme: DiaryColourScheme;
	/** ResDiary "new booking" bell: rings when a booking was made within this many
	 *  minutes BEFORE its arrival time (a last-minute reservation). 0 = never ring. */
	lastMinuteThresholdMins: number;
	largePartyMin: number; // party >= this reads as a "large party"
	/** Wall-clock 'HH:mm' where the diary draws the lunch↕dinner service divider.
	 *  Empty string = AUTO: derive it from the gap between service periods (the
	 *  midpoint of lunch's close and dinner's open). Blank with no gap = no line. */
	serviceDividerTime: string;
	/** Covers the owner aims to seat per service (service period id → covers), shown as
	 *  "Dinner 132/180 Pax · 48 left" over the diary. DISPLAY ONLY — nothing refuses a
	 *  booking over it; the enforced limit is a pacing rule's max_covers_per_period.
	 *  Absent / 0 = no target for that service. */
	coverTargets: Record<string, number>;
}
export const DIARY_UI_DEFAULTS: DiaryUiConfig = {
	// ResDiary opens on a calm booking-lifecycle palette, not one that paints every
	// yet-to-arrive booking red the moment it's a minute late. 'service' matches that.
	defaultColourScheme: 'service',
	lastMinuteThresholdMins: 120,
	largePartyMin: 8,
	serviceDividerTime: '',
	coverTargets: {}
};

/** Load the diary UI config for a brand, merged over defaults (never throws).
 *  Back-compat: an older stored row may carry `newBookingThresholdMins` (the
 *  pre-parity key) — fold it into `lastMinuteThresholdMins` so saved configs keep
 *  working without a data migration. */
export async function getDiaryUiConfig(brand: BrandId): Promise<DiaryUiConfig> {
	const v = await getSettingValue<Partial<DiaryUiConfig> & { newBookingThresholdMins?: number }>(
		brand,
		DIARY_UI_KEY
	).catch(() => undefined);
	const stored = v && typeof v === 'object' ? v : {};
	const legacy =
		typeof stored.newBookingThresholdMins === 'number'
			? { lastMinuteThresholdMins: stored.newBookingThresholdMins }
			: {};
	return { ...DIARY_UI_DEFAULTS, ...legacy, ...stored };
}

/** Create-or-update the brand's diary_ui settings row (merged over current). Audited. */
export async function setDiaryUiConfig(
	brand: BrandId,
	patch: Partial<DiaryUiConfig>
): Promise<DiaryUiConfig> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const merged = { ...(await getDiaryUiConfig(brand)), ...patch };
	const existing = await c
		.collection('geisha_settings')
		.getFirstListItem<Setting>(`restaurant=${q(restaurant.id)} && key=${q(DIARY_UI_KEY)}`)
		.catch(() => null);
	if (existing) {
		const row = await c
			.collection('geisha_settings')
			.update<Setting>(existing.id, { value: merged });
		await writeAudit('staff', 'update_setting', 'geisha_settings', existing.id, existing, row);
	} else {
		const row = await c
			.collection('geisha_settings')
			.create<Setting>({ restaurant: restaurant.id, key: DIARY_UI_KEY, value: merged });
		await writeAudit('staff', 'create_setting', 'geisha_settings', row.id, null, row);
	}
	return merged;
}

export async function listPeriods(brand: BrandId): Promise<ServicePeriod[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	return c
		.collection('geisha_service_periods')
		.getFullList<ServicePeriod>({ filter: `restaurant=${q(restaurant.id)}`, sort: 'start_time' });
}

/**
 * The service periods that actually RUN on `date` — active, and covering that
 * date's weekday. This is the same gate the availability/forecast engines and the
 * diary timeline grid apply; anything staff-facing that says "the services on this
 * day" must use it, or a day-scoped period leaks into every other day. Fusion is
 * the case that exposed it: it has a Sunday-only "Sunday" service alongside its
 * Mon–Sat Lunch/Dinner, so the diary's create modal offered a Sunday tab on a
 * Friday and `periodIdForTime` mapped a Sunday lunch slot to the (not-running)
 * Lunch period — which also mis-targeted period-scope closure checks.
 * dow uses noon to dodge any DST edge, matching the booking engines.
 */
export async function listPeriodsForDate(brand: BrandId, date: string): Promise<ServicePeriod[]> {
	const [restaurant, periods] = await Promise.all([getRestaurant(brand), listPeriods(brand)]);
	const dow = fromZonedTime(`${date}T12:00:00`, restaurant.timezone || DIARY_TZ).getDay();
	return periods.filter((p) => p.active !== false && p.days_of_week?.includes(dow));
}

/**
 * Editable fields of a service period (ResDiary "Service Times"). A period is the
 * ONLY thing that makes a slot bookable: no period covering a weekday means that
 * whole day is unbookable, which is exactly how weekend lunch quietly disappeared
 * (both brands' daytime services were configured Mon–Fri while the doors open at
 * noon seven days). Staff must be able to fix that themselves, hence this.
 */
export interface ServicePeriodInput {
	name: string;
	days_of_week: number[]; // 0=Sun … 6=Sat
	start_time: string; // 'HH:mm'
	end_time: string; // 'HH:mm' — service close
	last_booking_time: string; // 'HH:mm' — latest bookable slot
	default_turn_minutes: number;
	active: boolean;
}

/** Coerce + validate raw form input into a clean period payload. Throws on nonsense. */
export function normaliseServicePeriod(raw: Partial<ServicePeriodInput>): ServicePeriodInput {
	const name = String(raw.name ?? '').trim();
	if (!name) throw new Error('Give the service a name.');
	const days = [...new Set((raw.days_of_week ?? []).map(Number))]
		.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
		.sort((a, b) => a - b);
	if (!days.length) throw new Error('Pick at least one day.');
	const start = String(raw.start_time ?? '').trim();
	const end = String(raw.end_time ?? '').trim();
	const last = String(raw.last_booking_time ?? '').trim();
	for (const [label, v] of [
		['Open', start],
		['Close', end],
		['Last booking', last]
	] as const) {
		if (!HHMM.test(v)) throw new Error(`${label} must be a time like 12:00.`);
	}
	if (last < start) throw new Error('Last booking cannot be before the service opens.');
	if (end <= start) throw new Error('Close must be after open.');
	const turn = Number(raw.default_turn_minutes);
	return {
		name,
		days_of_week: days,
		start_time: start,
		end_time: end,
		last_booking_time: last,
		default_turn_minutes: Number.isFinite(turn) && turn >= 15 ? Math.round(turn) : 120,
		active: raw.active !== false
	};
}

export async function createPeriod(
	brand: BrandId,
	input: Partial<ServicePeriodInput>,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<ServicePeriod> {
	const restaurant = await getRestaurant(brand);
	const clean = normaliseServicePeriod(input);
	const c = await pb();
	const row = await c
		.collection('geisha_service_periods')
		.create<ServicePeriod>({ restaurant: restaurant.id, ...clean });
	await writeAudit(
		actor,
		'update_setting',
		'geisha_service_periods',
		row.id,
		null,
		row,
		onBehalfOf
	);
	// The public site renders these same periods as its opening hours.
	invalidatePublicHours();
	return row;
}

export async function updatePeriod(
	id: string,
	input: Partial<ServicePeriodInput>,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<ServicePeriod> {
	const c = await pb();
	const before = await c.collection('geisha_service_periods').getOne<ServicePeriod>(id);
	const clean = normaliseServicePeriod({ ...before, ...input });
	const row = await c.collection('geisha_service_periods').update<ServicePeriod>(id, clean);
	await writeAudit(actor, 'update_setting', 'geisha_service_periods', id, before, row, onBehalfOf);
	invalidatePublicHours();
	return row;
}

export async function deletePeriod(
	id: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<void> {
	const c = await pb();
	const before = await c
		.collection('geisha_service_periods')
		.getOne<ServicePeriod>(id)
		.catch(() => null);
	await c.collection('geisha_service_periods').delete(id);
	await writeAudit(actor, 'update_setting', 'geisha_service_periods', id, before, null, onBehalfOf);
	invalidatePublicHours();
}

// --- closures (blackout / private-hire calendar) ---------------------------

/** Input shape for create/update of a closure (all dates are 'YYYY-MM-DD'). */
export interface ClosureInput {
	date_from: string;
	date_to?: string; // blank/equal = single day
	scope: 'full' | 'period' | 'section';
	service_period?: string; // required when scope === 'period' | 'section'
	section?: string; // section-scope: floor-section name (whole-section close-out)
	table?: string; // section-scope: a single table id (table close-out); wins over section
	time_from?: string; // section-scope: optional 'HH:mm' sub-window start
	time_to?: string; // section-scope: optional 'HH:mm' sub-window end
	kind?: string; // 'holiday' | 'private_hire' | 'maintenance'
	reason?: string; // ResDiary "Description"
	// ResDiary "Add New Period" parity fields:
	name?: string; // ResDiary "Name"
	days_of_week?: number[]; // ResDiary "Periodic" weekdays (0=Sun); empty = one-off
	channel_type?: 'common' | 'internal' | 'online'; // ResDiary "Type"
	colour?: string; // ResDiary "Colour" (hex)
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** All closures for a brand, soonest first. */
export async function listClosures(brand: BrandId): Promise<Closure[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	try {
		return await c
			.collection('geisha_closures')
			.getFullList<Closure>({ filter: `restaurant=${q(restaurant.id)}`, sort: 'date_from' });
	} catch {
		return []; // collection not present yet — degrade gracefully
	}
}

/** Validate + normalise a closure payload; throws on bad input. */
function normaliseClosure(data: ClosureInput): {
	date_from: string;
	date_to: string;
	scope: 'full' | 'period' | 'section';
	service_period: string;
	section: string;
	table: string;
	time_from: string;
	time_to: string;
	kind: string;
	reason: string;
	name: string;
	days_of_week: number[];
	channel_type: 'common' | 'internal' | 'online';
	colour: string;
} {
	const date_from = (data.date_from || '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date_from)) {
		throw new Error('A valid start date (YYYY-MM-DD) is required.');
	}
	const date_to = (data.date_to || date_from).trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
		throw new Error('A valid end date (YYYY-MM-DD) is required.');
	}
	if (date_to < date_from) throw new Error('End date cannot be before the start date.');
	if (data.scope !== 'full' && data.scope !== 'period' && data.scope !== 'section') {
		throw new Error("Scope must be 'full', 'period' or 'section'.");
	}
	// Both period- and section-scope closures target a single service period.
	if ((data.scope === 'period' || data.scope === 'section') && !data.service_period) {
		throw new Error('A service period is required for this closure.');
	}
	const table = (data.table || '').trim();
	const section = (data.section || '').trim();
	// A section-scope close-out must target SOMETHING: a table or a floor section.
	if (data.scope === 'section' && !table && !section) {
		throw new Error('Pick a table or a section to close out.');
	}
	// Optional sub-window: both bounds or neither, well-formed, and from < to.
	const timeFrom = (data.time_from || '').trim();
	const timeTo = (data.time_to || '').trim();
	if (data.scope === 'section' && (timeFrom || timeTo)) {
		if (!HHMM.test(timeFrom) || !HHMM.test(timeTo)) {
			throw new Error('Give a valid HH:mm start and end for the close-out window.');
		}
		if (timeTo <= timeFrom) throw new Error('The close-out end must be after its start.');
	}
	const isSection = data.scope === 'section';
	// ResDiary parity: normalise the weekday list (0..6, deduped), the channel type and
	// the colour. Days empty = a one-off ("Manual") close-out; non-empty = "Periodic".
	const days = [...new Set((data.days_of_week ?? []).map(Number))]
		.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
		.sort((a, b) => a - b);
	const channel: 'common' | 'internal' | 'online' =
		data.channel_type === 'internal' || data.channel_type === 'online'
			? data.channel_type
			: 'common';
	const colour = (data.colour || '').trim();
	if (colour && !/^#[0-9a-fA-F]{3,8}$/.test(colour)) {
		throw new Error('Colour must be a hex value like #c0392b.');
	}
	return {
		date_from,
		date_to,
		scope: data.scope,
		service_period: data.scope === 'period' || data.scope === 'section' ? data.service_period! : '',
		// A table close-out wins over a section: store the table and clear the section
		// name so the two are never ambiguous.
		section: isSection && !table ? section : '',
		table: isSection ? table : '',
		time_from: isSection ? timeFrom : '',
		time_to: isSection ? timeTo : '',
		kind: data.kind || 'holiday',
		reason: data.reason || '',
		name: (data.name || '').trim(),
		days_of_week: days,
		channel_type: channel,
		colour
	};
}

export async function createClosure(
	brand: BrandId,
	data: ClosureInput,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Closure> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const row = await c
		.collection('geisha_closures')
		.create<Closure>({ restaurant: restaurant.id, ...normaliseClosure(data) });
	await writeAudit(actor, 'create_closure', 'geisha_closures', row.id, null, row, onBehalfOf);
	return row;
}

export async function updateClosure(
	id: string,
	data: ClosureInput,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Closure> {
	const c = await pb();
	const before = await c.collection('geisha_closures').getOne<Closure>(id);
	const row = await c.collection('geisha_closures').update<Closure>(id, normaliseClosure(data));
	await writeAudit(actor, 'update_closure', 'geisha_closures', id, before, row, onBehalfOf);
	return row;
}

export async function deleteClosure(
	id: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<void> {
	const c = await pb();
	await c.collection('geisha_closures').delete(id);
	await writeAudit(actor, 'delete_closure', 'geisha_closures', id, null, null, onBehalfOf);
}

// --- the Close-Outs CALENDAR (paint whole dates open/closed) -----------------

/** An existing closure row as a re-submittable payload (for range shrinks/splits). */
function closureInputFromRow(row: Closure, dates: { from: string; to: string }): ClosureInput {
	return {
		date_from: dates.from,
		date_to: dates.to,
		scope: (row.scope || 'full') as 'full' | 'period' | 'section',
		service_period: row.service_period || undefined,
		section: row.section || '',
		table: row.table || '',
		time_from: row.time_from || '',
		time_to: row.time_to || '',
		kind: row.kind || 'holiday',
		reason: row.reason || '',
		name: row.name || '',
		days_of_week: Array.isArray(row.days_of_week) ? row.days_of_week : [],
		channel_type: row.channel_type || 'common',
		colour: row.colour || ''
	};
}

/** What the calendar painted, plus the labelling for any rows it has to create. */
export interface DateClosureEdit {
	/** 'full' closes the whole day; 'period' closes one service on that day. */
	scope: 'full' | 'period';
	servicePeriodId?: string;
	close: string[];
	open: string[];
	name?: string;
	reason?: string;
	kind?: string;
	colour?: string;
	channelType?: 'common' | 'internal' | 'online';
}

export interface DateClosureResult {
	/** How many dates ended up newly closed / reopened. */
	closed: number;
	opened: number;
	/** Dates that were already closed for this target — nothing was written for them. */
	redundant: number;
	/** Dates that could not be reopened here, each with the reason to show the manager. */
	blocked: { date: string; reason: string }[];
	/** Rows written: created (incl. range splits), shrunk, deleted. */
	rowsCreated: number;
	rowsUpdated: number;
	rowsDeleted: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Apply a batch of whole-DATE open/close edits from the Close-Outs calendar.
 *
 * The calendar is a painting surface, so a single Save can touch dozens of dates at once
 * and can cut a hole in the middle of an existing range. All of that decision-making is
 * the pure {@link planDateEdits}; this function only validates the request, executes the
 * plan, and reports back. It deliberately does NOT touch recurring ("Periodic")
 * close-outs — the planner reports those as blocked so the manager edits the rule itself
 * rather than having a click silently fork it.
 */
export async function applyDateClosures(
	brand: BrandId,
	edit: DateClosureEdit,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<DateClosureResult> {
	const close = [...new Set(edit.close ?? [])].filter((d) => ISO_DATE.test(d));
	const open = [...new Set(edit.open ?? [])].filter((d) => ISO_DATE.test(d));
	if (close.length + open.length === 0) throw new Error('No dates were changed.');
	// Guard against a runaway paint (a stuck drag, or a hand-rolled POST).
	if (close.length + open.length > MAX_RANGE_DAYS) {
		throw new Error(`Too many dates in one save (max ${MAX_RANGE_DAYS}).`);
	}
	if (edit.scope !== 'full' && edit.scope !== 'period') {
		throw new Error("Scope must be 'full' or 'period'.");
	}
	if (edit.scope === 'period') {
		if (!edit.servicePeriodId) throw new Error('Pick the service to close.');
		const periods = await listPeriods(brand);
		if (!periods.some((p) => p.id === edit.servicePeriodId)) {
			throw new Error('That service no longer exists.');
		}
	}

	const rows = await listClosures(brand);
	const byId = new Map(rows.map((r) => [r.id, r]));
	const plan = planDateEdits(
		rows.map((r) => ({
			id: r.id,
			// PB returns date fields as full datetimes — the engine compares bare days.
			dateFrom: (r.date_from || '').slice(0, 10),
			dateTo: (r.date_to || '').slice(0, 10),
			scope: (r.scope || 'full') as 'full' | 'period' | 'section',
			servicePeriodId: r.service_period || undefined,
			daysOfWeek: Array.isArray(r.days_of_week) ? r.days_of_week : [],
			name: r.name || ''
		})),
		{ scope: edit.scope, servicePeriodId: edit.servicePeriodId, close, open }
	);

	// New rows the calendar creates carry the labelling from the page's paint controls.
	const base: Omit<ClosureInput, 'date_from' | 'date_to'> = {
		scope: edit.scope,
		service_period: edit.scope === 'period' ? edit.servicePeriodId : undefined,
		kind: edit.kind || 'holiday',
		reason: edit.reason || '',
		name: edit.name || '',
		days_of_week: [],
		channel_type: edit.channelType || 'common',
		colour: edit.colour || ''
	};

	let rowsCreated = 0;
	let rowsUpdated = 0;
	let rowsDeleted = 0;

	// Order matters only for tidiness: shrink/split before create so a reopened hole is
	// never briefly re-covered. Each write is audited by the create/update/delete helpers.
	for (const s of plan.shrink) {
		const row = byId.get(s.id);
		if (!row) continue;
		await updateClosure(
			s.id,
			closureInputFromRow(row, { from: s.dateFrom, to: s.dateTo }),
			actor,
			onBehalfOf
		);
		rowsUpdated++;
	}
	for (const s of plan.split) {
		const row = byId.get(s.from);
		if (!row) continue;
		await createClosure(
			brand,
			closureInputFromRow(row, { from: s.dateFrom, to: s.dateTo }),
			actor,
			onBehalfOf
		);
		rowsCreated++;
	}
	for (const id of plan.remove) {
		await deleteClosure(id, actor, onBehalfOf);
		rowsDeleted++;
	}
	for (const r of plan.create) {
		await createClosure(
			brand,
			{ ...base, date_from: r.dateFrom, date_to: r.dateTo },
			actor,
			onBehalfOf
		);
		rowsCreated++;
	}

	return {
		closed: plan.closed.length,
		opened: plan.opened.length,
		redundant: plan.redundant.length,
		blocked: plan.blocked,
		rowsCreated,
		rowsUpdated,
		rowsDeleted
	};
}

/**
 * Live bookings per local date across [from, to] — what the calendar shows as a dot on a
 * day cell. A manager about to shut a fortnight needs to see that the 27th already has
 * four tables on it BEFORE clicking Save, which is the one thing the ResDiary grid can't
 * tell you. Cancelled / no-show bookings don't count.
 *
 * One query for the whole window (not one per day): the grid can span a year, and a
 * per-date round-trip to the London droplet would cost hundreds.
 */
export async function countBookingsInRange(
	brand: BrandId,
	from: string,
	to: string
): Promise<Record<string, { bookings: number; covers: number }>> {
	if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) return {};
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	// Widen a day either side so a late sitting can't fall outside the UTC window.
	const lo = toPbDateFilter(`${shiftDay(from, -1)}T00:00:00.000Z`);
	const hi = toPbDateFilter(`${shiftDay(to, 1)}T23:59:59.999Z`);
	let rows: Booking[] = [];
	try {
		rows = await c.collection('geisha_bookings').getFullList<Booking>({
			filter:
				`restaurant=${q(restaurant.id)} && starts_at>=${q(lo)} && starts_at<=${q(hi)}` +
				` && status!="cancelled" && status!="no_show"`,
			fields: 'starts_at,party_size'
		});
	} catch {
		return {}; // the calendar still paints — it just shows no cover counts
	}
	const tz = restaurant.timezone || DIARY_TZ;
	const localDay = new Intl.DateTimeFormat('en-CA', {
		timeZone: tz,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const out: Record<string, { bookings: number; covers: number }> = {};
	for (const b of rows) {
		if (!b.starts_at) continue;
		const date = localDay.format(new Date(b.starts_at));
		if (date < from || date > to) continue;
		const cell = (out[date] ??= { bookings: 0, covers: 0 });
		cell.bookings++;
		cell.covers += b.party_size || 0;
	}
	return out;
}

/** One closed cell of the diary "CloseOuts" grid: a floor section × a service. */
export interface CloseoutCell {
	section: string;
	servicePeriodId: string;
}

/** A single table / time-slot close-out (richer than a grid cell — carries its id so
 *  the diary can list + remove it, plus the optional table + sub-window). */
export interface TableCloseout {
	id: string;
	servicePeriodId: string;
	/** A whole floor section (when no `table`). */
	section: string;
	/** A single table id (wins over `section`). */
	table: string;
	/** Optional sub-window 'HH:mm' bounds ('' = whole service). */
	timeFrom: string;
	timeTo: string;
	/** First + last day ('YYYY-MM-DD') the close-out spans; equal for a single day. Lets
	 *  the console distinguish a one-off from a "closed until <date>" multi-day block. */
	dateFrom: string;
	dateTo: string;
	reason: string;
	/** ResDiary "Colour" — hex for the diary band ('' = default red). */
	colour: string;
}

/** True for a grid cell: a whole-section, whole-service close-out (no table, no window).
 *  The WHOLE-RESTAURANT sentinel ('*') is deliberately excluded — it isn't a row on the
 *  section grid, so a grid save must neither list nor delete it; it's managed in the
 *  console's individual close-out list like a table/time block. */
const isWholeSectionCell = (r: Closure) =>
	!!(r.section && r.section.trim()) &&
	!isWholeRestaurant({ section: r.section, table: r.table }) &&
	!r.table &&
	!r.time_from &&
	!r.time_to;

/** Only the section-scope rows active on `date` (single-day spans handled by caller). */
async function sectionRowsOn(brand: BrandId, date: string): Promise<Closure[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const day = (v: string | undefined) => (v || '').slice(0, 10);
	const rows = await c.collection('geisha_closures').getFullList<Closure>({
		filter: `restaurant=${q(restaurant.id)} && scope="section"`
	});
	return rows.filter((r) => {
		const from = day(r.date_from);
		const to = day(r.date_to) || from;
		if (from > date || date > to) return false;
		// ResDiary "Periodic": a close-out carrying weekdays only bites on those days inside
		// its range (empty = every day). Mirrors the engine's spans() so the diary shows a
		// periodic block on exactly the days it's actually enforced.
		const dow = Array.isArray(r.days_of_week) ? r.days_of_week : [];
		return dow.length === 0 || dow.includes(dayOfWeekOf(date));
	});
}

/** WHOLE-SECTION close-out cells active on a single date (the grid's checked cells).
 *  Table + time-window close-outs are surfaced separately by {@link getTableCloseouts}. */
export async function getCloseouts(brand: BrandId, date: string): Promise<CloseoutCell[]> {
	try {
		return (await sectionRowsOn(brand, date))
			.filter(isWholeSectionCell)
			.map((r) => ({ section: r.section || '', servicePeriodId: r.service_period || '' }));
	} catch {
		return [];
	}
}

/** Table / time-slot close-outs active on a single date (everything section-scope that
 *  ISN'T a plain whole-section grid cell): single-table blocks and time-windowed blocks. */
export async function getTableCloseouts(brand: BrandId, date: string): Promise<TableCloseout[]> {
	try {
		return (await sectionRowsOn(brand, date))
			.filter((r) => !isWholeSectionCell(r))
			.map((r) => {
				const from = (r.date_from || '').slice(0, 10);
				return {
					id: r.id,
					servicePeriodId: r.service_period || '',
					section: r.section || '',
					table: r.table || '',
					timeFrom: r.time_from || '',
					timeTo: r.time_to || '',
					dateFrom: from,
					dateTo: (r.date_to || '').slice(0, 10) || from,
					reason: r.reason || '',
					colour: r.colour || ''
				};
			});
	} catch {
		return [];
	}
}

/**
 * Reconcile the diary "CloseOuts Management Console" for a SINGLE date: the grid
 * posts the full set of currently-checked section × service cells, and this makes the
 * stored single-day section-scope closures match it exactly — creating the newly
 * checked cells and deleting the ones that were unchecked. Existing full/period
 * closures and section closeouts on OTHER dates are never touched. Manager+; audited.
 *
 * Idempotent: re-saving the same grid is a no-op. A `reason` (and kind) applies to
 * every newly-created cell; already-present cells keep their stored reason.
 */
export async function saveCloseouts(
	brand: BrandId,
	date: string,
	desired: CloseoutCell[],
	opts: { kind?: string; reason?: string } = {},
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<{ added: number; removed: number }> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid date (YYYY-MM-DD) is required.');
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const day = (v: string | undefined) => (v || '').slice(0, 10);
	const key = (cell: { section: string; servicePeriodId: string }) =>
		JSON.stringify([cell.section, cell.servicePeriodId]);

	// Desired set (drop any blank cell), de-duped.
	const want = new Map<string, CloseoutCell>();
	for (const cell of desired) {
		const section = (cell.section || '').trim();
		const servicePeriodId = (cell.servicePeriodId || '').trim();
		if (!section || !servicePeriodId) continue;
		want.set(key({ section, servicePeriodId }), { section, servicePeriodId });
	}

	// Current single-day section closures ON THIS DATE — but ONLY whole-section grid
	// cells. Table / time-window close-outs are managed separately and must survive a
	// grid save, so they're excluded from the reconcile set here.
	const rows = await c.collection('geisha_closures').getFullList<Closure>({
		filter: `restaurant=${q(restaurant.id)} && scope="section"`
	});
	const onThisDate = rows.filter(
		(r) =>
			day(r.date_from) === date && day(r.date_to || r.date_from) === date && isWholeSectionCell(r)
	);
	const have = new Map<string, Closure>();
	for (const r of onThisDate) {
		have.set(key({ section: r.section || '', servicePeriodId: r.service_period || '' }), r);
	}

	let added = 0;
	let removed = 0;
	// Create cells that are wanted but not present.
	for (const [k, cell] of want) {
		if (have.has(k)) continue;
		await createClosure(
			brand,
			{
				date_from: date,
				date_to: date,
				scope: 'section',
				service_period: cell.servicePeriodId,
				section: cell.section,
				kind: opts.kind || 'maintenance',
				reason: opts.reason || ''
			},
			actor,
			onBehalfOf
		);
		added++;
	}
	// Remove cells that are present but no longer wanted.
	for (const [k, row] of have) {
		if (want.has(k)) continue;
		await deleteClosure(row.id, actor, onBehalfOf);
		removed++;
	}
	return { added, removed };
}

/** Longest turn any party can hold a table — mirrors availability.ts's whole-service
 *  block window, so "the trading day" ends where the last possible sitting does. */
const LONGEST_SITTING_MIN = 150;

/** 'HH:mm' + minutes, clamped to 23:45 so a day window can never wrap past midnight
 *  (close-out times are stored as wall-clock on ONE date and compared as strings). */
function addMinutesToHHmm(hhmm: string, minutes: number): string {
	const [h, m] = hhmm.split(':').map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
	const total = Math.min(h * 60 + m + minutes, 23 * 60 + 45);
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Input for a single table / time-slot close-out (diary grid click or modal form). */
export interface TableCloseoutInput {
	date: string; // 'YYYY-MM-DD' — first day of the close-out.
	/**
	 * Optional last day ('YYYY-MM-DD') for a multi-day close-out (ResDiary's "close a
	 * table/these hours until <date>"). Absent / equal to `date` = a single day. The
	 * availability engine already honours [date_from, date_to] on every affected day,
	 * so a range needs no other change — just the persisted end date.
	 */
	dateTo?: string;
	servicePeriodId: string;
	/** Target: a single table id, OR a whole section name (table wins). */
	table?: string;
	section?: string;
	/** Optional sub-window ('HH:mm'); both or neither. Absent = whole service. */
	timeFrom?: string;
	timeTo?: string;
	reason?: string;
}

/**
 * Create ONE table / time-slot close-out (a section-scope row that targets a specific
 * table and/or a sub-window). Distinct from {@link saveCloseouts}, which reconciles the
 * whole-section grid — these are added/removed individually. Returns the new row so the
 * diary can list it. Manager+; audited.
 */
export async function createCloseout(
	brand: BrandId,
	input: TableCloseoutInput,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Closure> {
	// A sub-window has to land inside the TRADING DAY. Without this a close-out like
	// "03:30–05:00" is stored happily, blocks nothing anyone could have booked, and paints
	// no band on the diary — which reads to staff as a save that silently failed. Rejected
	// at the source so every caller (diary console, right-click slot, AI assistant) gets
	// the same answer.
	//
	// It is deliberately the DAY and not the named service. A windowed close-out is scoped
	// to the clock: sectionCloseoutFootprints honours [timeFrom, timeTo] verbatim whatever
	// service is running, so the service is only the label it is filed under. Checking
	// against that label made the dead ground BETWEEN two services unclosable — Fusion's
	// Lunch shuts at 16:45 and Dinner opens at 17:00, and that quarter-hour belongs to
	// neither (owner: "there's a gap in close-outs 16:45–17:00 that can't be closed").
	// The day runs to the LATER of the last service's close and its last sitting, so a
	// table still held after nominal close can be shut too.
	const timeFrom = (input.timeFrom || '').trim();
	const timeTo = (input.timeTo || '').trim();
	if (timeFrom && timeTo) {
		const periods = (await listPeriods(brand)).filter((p) => p.active !== false);
		const opens = periods.map((p) => (p.start_time || '').slice(0, 5)).filter(Boolean);
		const closes = periods.flatMap((p) => {
			const end = (p.end_time || '').slice(0, 5);
			const last = (p.last_booking_time || '').slice(0, 5);
			return [end, last ? addMinutesToHHmm(last, LONGEST_SITTING_MIN) : ''].filter(Boolean);
		});
		const dayStart = opens.length ? opens.reduce((a, b) => (b < a ? b : a)) : '';
		const dayEnd = closes.length ? closes.reduce((a, b) => (b > a ? b : a)) : '';
		if (dayStart && dayEnd && (timeTo <= dayStart || timeFrom >= dayEnd)) {
			throw new Error(
				`${timeFrom}–${timeTo} is outside the trading day (${dayStart}–${dayEnd}), so it would close nothing.`
			);
		}
	}
	// A multi-day close-out persists an end date; a blank/earlier `dateTo` collapses to a
	// single day. normaliseClosure re-checks date_to >= date_from, so an inverted range
	// throws there rather than storing a block that spans nothing.
	const dateTo = (input.dateTo || '').trim();
	return createClosure(
		brand,
		{
			date_from: input.date,
			date_to: dateTo && dateTo > input.date ? dateTo : input.date,
			scope: 'section',
			service_period: input.servicePeriodId,
			table: input.table,
			section: input.section,
			time_from: input.timeFrom,
			time_to: input.timeTo,
			kind: 'maintenance',
			reason: input.reason || ''
		},
		actor,
		onBehalfOf
	);
}

// --- pacing rules (covers caps / lead time / booking window) ----------------
// The config that powers WP-AVAIL-1 (covers throttle) and WP-AVAIL-3 (horizon).

/** Input shape for create/update of a pacing rule. */
export interface PacingRuleInput {
	service_period?: string; // blank/undefined = all services
	dow?: number[]; // [0..6]; empty = all days
	max_covers_per_slot?: number;
	max_covers_per_period?: number;
	lead_time_minutes?: number;
	booking_window_days?: number;
}

/** All pacing rules for a brand. */
export async function listPacingRules(brand: BrandId): Promise<PacingRuleRow[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	try {
		return await c.collection('geisha_pacing_rules').getFullList<PacingRuleRow>({
			filter: `restaurant=${q(restaurant.id)}`,
			sort: 'service_period'
		});
	} catch {
		return []; // collection not present yet — degrade gracefully
	}
}

/** Validate + normalise a pacing-rule payload; throws on bad input. */
function normalisePacingRule(
	data: PacingRuleInput,
	periodIds: Set<string>
): {
	service_period: string;
	dow: number[];
	max_covers_per_slot: number;
	max_covers_per_period: number;
	lead_time_minutes: number;
	booking_window_days: number;
} {
	const service_period = (data.service_period || '').trim();
	if (service_period && !periodIds.has(service_period)) {
		throw new Error('That service period does not belong to this restaurant.');
	}
	const dow = Array.isArray(data.dow) ? data.dow : [];
	for (const d of dow) {
		if (!Number.isInteger(d) || d < 0 || d > 6) {
			throw new Error('Days of week must be integers 0–6 (Sun–Sat).');
		}
	}
	const nonNeg = (n: number | undefined, label: string): number => {
		const v = n ?? 0;
		if (!Number.isInteger(v) || v < 0)
			throw new Error(`${label} must be a non-negative whole number.`);
		return v;
	};
	return {
		service_period,
		// de-dupe and sort for a stable stored value
		dow: [...new Set(dow)].sort((a, b) => a - b),
		max_covers_per_slot: nonNeg(data.max_covers_per_slot, 'Covers per slot'),
		max_covers_per_period: nonNeg(data.max_covers_per_period, 'Covers per period'),
		lead_time_minutes: nonNeg(data.lead_time_minutes, 'Lead time'),
		booking_window_days: nonNeg(data.booking_window_days, 'Booking window')
	};
}

export async function createPacingRule(
	brand: BrandId,
	data: PacingRuleInput,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<PacingRuleRow> {
	const restaurant = await getRestaurant(brand);
	const periods = await listPeriods(brand);
	const c = await pb();
	const row = await c.collection('geisha_pacing_rules').create<PacingRuleRow>({
		restaurant: restaurant.id,
		...normalisePacingRule(data, new Set(periods.map((p) => p.id)))
	});
	await writeAudit(
		actor,
		'create_pacing_rule',
		'geisha_pacing_rules',
		row.id,
		null,
		row,
		onBehalfOf
	);
	return row;
}

export async function updatePacingRule(
	id: string,
	data: PacingRuleInput,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<PacingRuleRow> {
	const c = await pb();
	const before = await c.collection('geisha_pacing_rules').getOne<PacingRuleRow>(id);
	const restaurant = before.restaurant;
	const periods = await c
		.collection('geisha_service_periods')
		.getFullList<ServicePeriod>({ filter: `restaurant=${q(restaurant)}` });
	const row = await c
		.collection('geisha_pacing_rules')
		.update<PacingRuleRow>(id, normalisePacingRule(data, new Set(periods.map((p) => p.id))));
	await writeAudit(actor, 'update_pacing_rule', 'geisha_pacing_rules', id, before, row, onBehalfOf);
	return row;
}

export async function deletePacingRule(
	id: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<void> {
	const c = await pb();
	await c.collection('geisha_pacing_rules').delete(id);
	await writeAudit(actor, 'delete_pacing_rule', 'geisha_pacing_rules', id, null, null, onBehalfOf);
}

// --- deposit rules (configurable deposit / no-show-hold policy) --------------
// Owner decision #4: the deposit policy is editable here instead of hardcoded.
// These power booking/policy.ts paymentRequirementFor() — the lowest-`priority`
// rule matching (party size, dow, date range, service period) wins; no match
// falls back to the seeded/legacy policy. Edited in /admin/settings/deposits.

/** Input shape for create/update of a deposit rule. */
export interface DepositRuleInput {
	priority?: number;
	service_period?: string; // blank/undefined = any service
	party_min?: number;
	party_max?: number; // 0 = no upper bound
	dow?: number[]; // [0..6]; empty = all days
	date_from?: string; // 'YYYY-MM-DD' or blank
	date_to?: string; // 'YYYY-MM-DD' or blank
	kind?: DepositKind;
	per_person_pence?: number;
	capture?: DepositCapture;
	promotion?: string; // id in $lib/data/promotions (blank = no promotion)
}

/** All deposit rules for a brand, priority order (lowest = highest precedence). */
export async function listDepositRules(brand: BrandId): Promise<DepositRule[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	try {
		return await c
			.collection('geisha_deposit_rules')
			.getFullList<DepositRule>({ filter: `restaurant=${q(restaurant.id)}`, sort: 'priority' });
	} catch {
		return []; // collection not present yet — degrade gracefully
	}
}

/** Validate + normalise a deposit-rule payload; throws on bad input. */
function normaliseDepositRule(
	data: DepositRuleInput,
	periodIds: Set<string>
): {
	priority: number;
	service_period: string;
	party_min: number;
	party_max: number;
	dow: number[];
	date_from: string;
	date_to: string;
	kind: DepositKind;
	per_person_pence: number;
	capture: DepositCapture;
	promotion: string;
} {
	const service_period = (data.service_period || '').trim();
	if (service_period && !periodIds.has(service_period)) {
		throw new Error('That service period does not belong to this restaurant.');
	}
	const dow = Array.isArray(data.dow) ? data.dow : [];
	for (const d of dow) {
		if (!Number.isInteger(d) || d < 0 || d > 6) {
			throw new Error('Days of week must be integers 0–6 (Sun–Sat).');
		}
	}
	const nonNeg = (n: number | undefined, label: string): number => {
		const v = n ?? 0;
		if (!Number.isInteger(v) || v < 0)
			throw new Error(`${label} must be a non-negative whole number.`);
		return v;
	};
	const party_min = nonNeg(data.party_min ?? 1, 'Minimum party size');
	const party_max = nonNeg(data.party_max, 'Maximum party size');
	if (party_max > 0 && party_max < party_min) {
		throw new Error('Maximum party size cannot be less than the minimum.');
	}
	const kind: DepositKind =
		data.kind === 'deposit' || data.kind === 'noshow_hold' ? data.kind : 'none';
	const capture: DepositCapture = data.capture === 'manual' ? 'manual' : 'auto';
	const dateOk = (s: string) => s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s);
	const date_from = (data.date_from || '').trim();
	const date_to = (data.date_to || '').trim();
	if (!dateOk(date_from)) throw new Error('Start date must be YYYY-MM-DD (or blank).');
	if (!dateOk(date_to)) throw new Error('End date must be YYYY-MM-DD (or blank).');
	if (date_from && date_to && date_to < date_from) {
		throw new Error('End date cannot be before the start date.');
	}
	const promotion = (data.promotion || '').trim();
	if (promotion && !getPromotion(promotion)) {
		throw new Error('That promotion does not exist.');
	}
	return {
		priority: nonNeg(data.priority, 'Priority'),
		service_period,
		party_min: Math.max(1, party_min),
		party_max,
		dow: [...new Set(dow)].sort((a, b) => a - b),
		date_from,
		date_to,
		kind,
		// A 'none' rule (suppress any deposit for a band) needs no fee.
		per_person_pence: kind === 'none' ? 0 : nonNeg(data.per_person_pence, 'Per-person fee'),
		capture,
		promotion
	};
}

export async function createDepositRule(
	brand: BrandId,
	data: DepositRuleInput,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<DepositRule> {
	const restaurant = await getRestaurant(brand);
	const periods = await listPeriods(brand);
	const c = await pb();
	const row = await c.collection('geisha_deposit_rules').create<DepositRule>({
		restaurant: restaurant.id,
		...normaliseDepositRule(data, new Set(periods.map((p) => p.id)))
	});
	await writeAudit(
		actor,
		'create_deposit_rule',
		'geisha_deposit_rules',
		row.id,
		null,
		row,
		onBehalfOf
	);
	return row;
}

export async function updateDepositRule(
	id: string,
	data: DepositRuleInput,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<DepositRule> {
	const c = await pb();
	const before = await c.collection('geisha_deposit_rules').getOne<DepositRule>(id);
	const periods = await c
		.collection('geisha_service_periods')
		.getFullList<ServicePeriod>({ filter: `restaurant=${q(before.restaurant)}` });
	const row = await c
		.collection('geisha_deposit_rules')
		.update<DepositRule>(id, normaliseDepositRule(data, new Set(periods.map((p) => p.id))));
	await writeAudit(
		actor,
		'update_deposit_rule',
		'geisha_deposit_rules',
		id,
		before,
		row,
		onBehalfOf
	);
	return row;
}

export async function deleteDepositRule(
	id: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<void> {
	const c = await pb();
	await c.collection('geisha_deposit_rules').delete(id);
	await writeAudit(
		actor,
		'delete_deposit_rule',
		'geisha_deposit_rules',
		id,
		null,
		null,
		onBehalfOf
	);
}

// --- book a whole area (ResDiary) ------------------------------------------

/**
 * The bookable tables that make up a named section/area for a brand, with the
 * area's combined capacity. Used by the "book a whole area" flow so the diary can
 * offer each area + its seat count, and so the booking can hold every table in it.
 * Walk-in-only (bookable=false) tables are excluded — booking an area reserves the
 * reservable tables in it.
 */
export interface AreaSummary {
	section: string;
	tableIds: string[];
	tableLabels: string[];
	seatsMax: number;
}

export async function listBookableAreas(brand: BrandId): Promise<AreaSummary[]> {
	const restaurant = await getRestaurant(brand);
	const tables = (await getTables(restaurant.id)).filter((t) => t.bookable && t.section);
	const bySection = new Map<string, DiningTable[]>();
	for (const t of tables) {
		(bySection.get(t.section) ?? bySection.set(t.section, []).get(t.section)!).push(t);
	}
	return [...bySection.entries()]
		.map(([section, ts]) => ({
			section,
			tableIds: ts.map((t) => t.id),
			tableLabels: ts.map((t) => t.label).sort(labelCmp),
			seatsMax: ts.reduce((n, t) => n + (t.seats_max || 0), 0)
		}))
		.sort((a, b) => a.section.localeCompare(b.section));
}

// --- customers -------------------------------------------------------------

export async function listCustomers(search = ''): Promise<Customer[]> {
	const c = await pb();
	const opts: { sort: string; filter?: string } = { sort: '-created' };
	if (search) {
		opts.filter = `name ~ ${q(search)} || email ~ ${q(search)} || phone ~ ${q(search)}`;
	}
	return c.collection('geisha_customers').getFullList<Customer>(opts);
}

/** One magic-search hit: a customer or a booking, in the shape the diary expects. */
export interface DiarySearchHit {
	kind: 'booking' | 'customer';
	id: string;
	bookingId?: string;
	customerId?: string;
	title: string;
	subtitle: string;
	ref?: string;
}

/**
 * Magic search (ResDiary parity): one query → matching customers (name/email/
 * phone), the booking whose ref equals the query (exact 6-char ref), plus that
 * booking's upcoming reservations so an arrival is one click away. Scoped to a
 * brand. Returns un-ranked hits; the client ranks/caps via magicSearch.rankResults
 * (pure, unit-tested). Keeps reads small: customers are filtered server-side, and
 * a ref query pulls only the recent window of bookings to scan for the tail match.
 */
export async function searchDiary(brand: BrandId, query: string): Promise<DiarySearchHit[]> {
	const ql = query.trim();
	if (ql.length < 2) return [];
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const hits: DiarySearchHit[] = [];

	// Customers (name / email / phone), capped.
	try {
		const customers = await c.collection('geisha_customers').getList<Customer>(1, 20, {
			filter: `name ~ ${q(ql)} || email ~ ${q(ql)} || phone ~ ${q(ql)}`,
			sort: '-created'
		});
		for (const cu of customers.items) {
			hits.push({
				kind: 'customer',
				id: cu.id,
				customerId: cu.id,
				title: cu.name || '(no name)',
				subtitle: [cu.email, cu.phone].filter(Boolean).join(' · ') || 'Guest',
				ref: undefined
			});
		}
	} catch {
		/* customer read failed — still return any booking hits */
	}

	// Bookings: match the query against the booking REFERENCE — the same 7-character
	// code the guest's confirmation email quotes, so someone reading it down the
	// phone is found. The ref is derived from the id, not a column, so the match is
	// done in JS over the recent + upcoming window for this brand. Also surface
	// bookings for any matched customer so "find Smith" jumps to Smith's reservation.
	try {
		const matchedCustomerIds = new Set(hits.filter((h) => h.customerId).map((h) => h.customerId!));
		const recent = await c.collection('geisha_bookings').getList<BookingWithRefs>(1, 200, {
			filter: `restaurant=${q(restaurant.id)} && status!="cancelled"`,
			sort: '-starts_at',
			expand: 'customer'
		});
		// Guests read references aloud and staff type them back with stray spaces or
		// a hyphen; none of that should be the difference between a hit and a miss.
		const refQ = ql.replace(/[\s-]/g, '').toUpperCase();
		for (const b of recent.items) {
			const ref = refOf(b.id);
			const cust = b.expand?.customer;
			const byRef = ref === refQ;
			const byCustomer = matchedCustomerIds.has(b.customer);
			if (!byRef && !byCustomer) continue;
			hits.push({
				kind: 'booking',
				id: b.id,
				bookingId: b.id,
				customerId: b.customer,
				// The name this TABLE is under, not the account holder's — a regular who
				// books for someone else must show up as the party on the floor.
				title: b.guest_name || cust?.name || `${b.party_size}p`,
				subtitle: `${ref} · ${new Date(b.starts_at).toLocaleString('en-GB', {
					day: '2-digit',
					month: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					timeZone: DIARY_TZ
				})} · ${b.party_size}p`,
				ref
			});
		}
	} catch {
		/* booking read failed — return whatever customers matched */
	}

	return hits;
}

export async function getCustomerHistory(customerId: string): Promise<Booking[]> {
	const c = await pb();
	return c
		.collection('geisha_bookings')
		.getFullList<Booking>({ filter: `customer=${q(customerId)}`, sort: '-starts_at' });
}

export async function updateCustomerNotes(id: string, notes: string): Promise<Customer> {
	const c = await pb();
	return c.collection('geisha_customers').update<Customer>(id, { notes });
}

// --- live floor plan -------------------------------------------------------

export interface FloorTable extends DiningTable {
	/** Current state derived from bookings + floor_state for the service date. */
	state: 'free' | 'upcoming' | 'seated' | 'finishing' | 'overdue';
	booking?: BookingWithRefs;
}

/**
 * Compute the live floor-plan state for each table on a date, as of `nowISO`.
 * "Seated" tables come from floor_state without cleared_at; "upcoming" from
 * confirmed bookings starting soon; "overdue" = seated past expected end.
 *
 * WP-LIVE-3 — optional `floorId` scopes the returned tiles to a single floor so
 * a multi-floor room doesn't render every floor's tables overlapped at the same
 * absolute x/y. When omitted, defaults to the first floor (by sort_order). A
 * restaurant with NO floors (pre-1772700200 data) returns ALL tables — keeping
 * the existing 3-arg AI `get_floor_plan` call working unchanged. Returns the
 * active `floor` (for canvas sizing) and the full `floors` list (for the
 * switcher) alongside the scoped tables.
 */
export async function getFloorPlan(
	brand: BrandId,
	date: string,
	nowISO: string,
	floorId?: string,
	/**
	 * The instant the plan is drawn FOR. Defaults to `nowISO`, which is right for the
	 * live board — but the plan also has date arrows, and on any other date "now" never
	 * falls inside that day's service, so every tile resolved to `free`. The header
	 * said "Dinner 15 booked · Arrivals 5" above fifty empty tables, and two testers
	 * independently reported the floor plan and the diary disagreeing about the same
	 * night because of it.
	 *
	 * ResDiary treats its table plan as one of three views of the same date-scoped
	 * diary, scrubbed by a time-interval bar with the current time merely highlighted —
	 * not as a live-only monitor. Passing `atISO` is what makes that possible.
	 */
	atISO?: string
): Promise<{
	tables: FloorTable[];
	restaurant: Restaurant;
	floor?: Floor;
	floors: Floor[];
}> {
	const restaurant = await getRestaurant(brand);
	const allTables = await getTables(restaurant.id);
	const floors = await getFloors(restaurant.id); // sorted by sort_order
	const bookings = await getBookingsForDay(brand, date);
	const c = await pb();
	const floorRows = await c.collection('geisha_floor_state').getFullList<FloorState>({
		filter: bookings.length ? bookings.map((b) => `booking=${q(b.id)}`).join(' || ') : 'id=""'
	});

	// Resolve the active floor and scope the rendered tiles to it. With ≥1 floor,
	// default to the requested floor or the first by sort_order; with zero floors
	// (legacy data) render every table so nothing disappears (back-compat).
	const activeFloor: Floor | undefined = floors.length
		? (floors.find((f) => f.id === floorId) ?? floors[0])
		: undefined;
	const tables = activeFloor ? allTables.filter((t) => t.floor === activeFloor.id) : allTables;

	const now = new Date(nowISO).getTime();
	// The instant the room is drawn for. Same as `now` on the live board; a chosen
	// point inside the service when the user has stepped to another date/time.
	const at = atISO ? new Date(atISO).getTime() : now;
	const bookingById = new Map(bookings.map((b) => [b.id, b]));

	// active (uncleared) seating per table
	const seatedByTable = new Map<string, { booking?: BookingWithRefs }>();
	for (const f of floorRows) {
		if (f.cleared_at) continue;
		seatedByTable.set(f.table, { booking: bookingById.get(f.booking) });
	}

	const SOON_MS = 90 * 60 * 1000; // "upcoming" within 90 min

	const ft: FloorTable[] = tables.map((t) => {
		const seated = seatedByTable.get(t.id);
		if (seated) {
			const b = seated.booking;
			const overdue = b ? new Date(b.ends_at).getTime() < now : false;
			return { ...t, state: overdue ? 'overdue' : 'seated', booking: b };
		}
		// A live booking that either COVERS the drawn instant, or starts within the
		// next 90 minutes of it. Keyed on `at`, not `now`: on the live board the two
		// are identical, but on any other date `now` sits outside the service entirely
		// and this test could never match — which is why a future night rendered as an
		// empty restaurant under a header counting its covers.
		const upcoming = bookings.find(
			(b) =>
				(b.status === 'confirmed' || b.status === 'pending_payment') &&
				b.tables?.includes(t.id) &&
				new Date(b.starts_at).getTime() - at < SOON_MS &&
				new Date(b.ends_at).getTime() > at
		);
		if (upcoming) return { ...t, state: 'upcoming', booking: upcoming };
		return { ...t, state: 'free' };
	});

	return { tables: ft, restaurant, floor: activeFloor, floors };
}

// --- service turn prediction ("what frees next") ---------------------------

/**
 * Recent COMPLETED seatings (cleared_at set) as turn samples, so the predictor
 * can learn this venue's real turn times by party size. We read the last
 * `lookbackDays` of floor_state rows, join each to its booking for party_size,
 * and return the actual minutes occupied. Pure data — the math lives in turns.ts.
 */
async function getRecentTurnSamples(
	restaurantId: string,
	beforeISO: string,
	lookbackDays = 60
): Promise<TurnSample[]> {
	const c = await pb();
	const fromMs = new Date(beforeISO).getTime() - lookbackDays * 86_400_000;
	const fromISO = new Date(fromMs).toISOString();
	// completed occupancies in the window: both timestamps present.
	const rows = await c.collection('geisha_floor_state').getFullList<FloorState>({
		filter: `seated_at>=${q(toPbDateFilter(fromISO))} && seated_at<=${q(toPbDateFilter(beforeISO))} && cleared_at!=""`,
		sort: '-seated_at'
	});
	if (!rows.length) return [];
	// fetch the party sizes for the referenced bookings in one go.
	const bookingIds = [...new Set(rows.map((r) => r.booking).filter(Boolean))];
	const partyById = new Map<string, number>();
	// chunk the OR filter so a busy venue's id list can't blow the query length.
	for (let i = 0; i < bookingIds.length; i += 40) {
		const chunk = bookingIds.slice(i, i + 40);
		const filter = chunk.map((id) => `id=${q(id)}`).join(' || ');
		const bs = await c
			.collection('geisha_bookings')
			.getFullList<Booking>({ filter, fields: 'id,party_size' });
		for (const b of bs) partyById.set(b.id, b.party_size ?? 0);
	}
	const samples: TurnSample[] = [];
	for (const r of rows) {
		const seated = new Date(r.seated_at).getTime();
		const cleared = new Date(r.cleared_at).getTime();
		const minutes = Math.round((cleared - seated) / 60_000);
		const partySize = partyById.get(r.booking) ?? 0;
		if (partySize > 0 && minutes > 0) samples.push({ partySize, minutes });
	}
	return samples;
}

/** A seated table with its predicted free time, for the "freeing next" view. */
export interface TurnTile extends FreePrediction {
	tableId: string;
	label: string;
	seatsMax: number;
	partySize: number;
	bookingId: string;
	guestName: string;
	seatedAt: string; // ISO
}

/** A waiting/upcoming booking that a soon-to-free table could take next. */
export interface UpcomingMatch {
	tableId: string;
	bookingId: string;
	guestName: string;
	partySize: number;
	startsAt: string;
	/** minutes between the table freeing and this booking's start (may be < 0). */
	slackMinutes: number;
}

export interface ServiceTurns {
	/** Every currently-seated table on the active floor, soonest-to-free first. */
	freeingNext: TurnTile[];
	/** For each seated table, the best upcoming booking it could turn over to. */
	matches: UpcomingMatch[];
	/** Whether the estimates used learned history (for a small UI confidence hint). */
	usingHistory: boolean;
}

/**
 * Forward-looking turn view for the live floor (mf-turn-predict): for each seated
 * table, when it should free (learned turn time from real history where possible,
 * else the period default), flagged overdue when lingering, sorted soonest-first,
 * and matched to a waiting booking that would fit as it opens up. Scoped to the
 * same active floor as {@link getFloorPlan}.
 */
export async function getServiceTurns(
	brand: BrandId,
	date: string,
	nowISO: string,
	floorId?: string
): Promise<ServiceTurns> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const [allTables, floors, bookings, periods, samples] = await Promise.all([
		getTables(restaurant.id),
		getFloors(restaurant.id),
		getBookingsForDay(brand, date),
		getActivePeriods(restaurant.id),
		getRecentTurnSamples(restaurant.id, nowISO)
	]);

	const activeFloor = floors.length
		? (floors.find((f) => f.id === floorId) ?? floors[0])
		: undefined;
	const onFloor = (tid: string) =>
		!activeFloor || allTables.find((t) => t.id === tid)?.floor === activeFloor.id;

	const bookingById = new Map(bookings.map((b) => [b.id, b]));
	const tableById = new Map(allTables.map((t) => [t.id, t]));
	const periodById = new Map(periods.map((p) => [p.id, p]));
	const now = new Date(nowISO).getTime();

	// active (uncleared) seatings, scoped to the active floor.
	const seated = await c.collection('geisha_floor_state').getFullList<FloorState>({
		filter: bookings.length
			? `(${bookings.map((b) => `booking=${q(b.id)}`).join(' || ')}) && cleared_at=""`
			: 'id=""'
	});

	let usingHistory = false;
	const freeingNext: TurnTile[] = [];
	for (const s of seated) {
		if (!onFloor(s.table)) continue;
		const b = bookingById.get(s.booking);
		const t = tableById.get(s.table);
		if (!b || !t) continue;
		const period = periodById.get(b.service_period) ?? null;
		const { minutes: turn, basis } = estimateTurnMinutes(b.party_size, period, samples);
		if (basis === 'historical') usingHistory = true;
		const pred = predictFree(new Date(s.seated_at).getTime(), turn, now, basis);
		freeingNext.push({
			...pred,
			tableId: t.id,
			label: t.label,
			seatsMax: t.seats_max,
			partySize: b.party_size,
			bookingId: b.id,
			guestName: b.expand?.customer?.name ?? `${b.party_size}p`,
			seatedAt: s.seated_at
		});
	}
	freeingNext.sort((a, b) => a.freeAtMs - b.freeAtMs);
	// One tile PER TABLE — bad data (a table with >1 uncleared floor_state seating, e.g.
	// after a re-seat that didn't clear the old row) would otherwise push the same
	// tableId twice and crash the floor's keyed {#each ... (t.tableId)}. After the sort
	// the first entry is the soonest-freeing, which is the one to keep.
	const seenTbl = new Set<string>();
	const freeingDedup = freeingNext.filter((tile) =>
		seenTbl.has(tile.tableId) ? false : (seenTbl.add(tile.tableId), true)
	);
	freeingNext.length = 0;
	freeingNext.push(...freeingDedup);

	// match each freeing table to the best upcoming booking that fits: a confirmed/
	// pending party not yet seated, starting near the free time, whose size fits.
	const seatedBookingIds = new Set(seated.map((s) => s.booking));
	const waiting = bookings
		.filter(
			(b) =>
				(b.status === 'confirmed' || b.status === 'pending_payment') &&
				!seatedBookingIds.has(b.id) &&
				new Date(b.ends_at).getTime() > now
		)
		.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

	const matches: UpcomingMatch[] = [];
	const claimed = new Set<string>();
	for (const tile of freeingNext) {
		// first waiting booking that fits this table's seats and isn't already claimed
		const fit = waiting.find((b) => !claimed.has(b.id) && b.party_size <= tile.seatsMax);
		if (!fit) continue;
		claimed.add(fit.id);
		matches.push({
			tableId: tile.tableId,
			bookingId: fit.id,
			guestName: fit.expand?.customer?.name ?? `${fit.party_size}p`,
			partySize: fit.party_size,
			startsAt: fit.starts_at,
			slackMinutes: Math.round((new Date(fit.starts_at).getTime() - tile.freeAtMs) / 60_000)
		});
	}

	return { freeingNext, matches, usingHistory };
}

// --- diary timeline (ResDiary-style grid) ----------------------------------
// Rows = tables (grouped by section), columns = time, bookings as horizontal
// bars spanning the minutes they occupy. The page renders this verbatim; all the
// time-window + placement maths is done here so the loader stays thin and the
// component is pure layout.

/**
 * The live-service arrival status that drives the bar colour in the default
 * (Arrival Status) view — mirrors ResDiary's View Management key:
 *   unarrived (blue) · late (pink) · arrived (green) · left (grey) ·
 *   waiting_bar (orange) · partially_seated (yellow). Derived from the booking
 *   status + floor_state seating + the clock, not stored.
 */
export type ArrivalStatus =
	| 'unarrived'
	| 'late'
	| 'arrived'
	| 'left'
	| 'waiting_bar'
	| 'table_ready'
	| 'partially_seated'
	| 'no_show';

/** The full booking-detail payload shown in the diary popover (ResDiary parity). */
export interface DiaryBooking {
	ref: string; // short human ref (uppercase id tail) — ResDiary's "Ref#"
	guestName: string;
	email?: string;
	phone?: string;
	bookedOn?: string; // ISO — booking.created
	partySize: number;
	startsAt: string; // arrival time
	endsAt: string; // leave time
	leaveTimeConfirmed: boolean;
	status: BookingStatus;
	channel: string; // 'Online' | 'Internal' | 'Walk-in' (colour square)
	tableLabels: string[];
	tableIds: string[]; // the booking's table record ids (for partial-seat from the diary)
	customerId?: string; // -> Customer.id (for the "View Customer" popover link)
	customerComments?: string; // customer.notes (CRM history)
	noteToRestaurant?: string;
	bookingComments?: string; // special_requests
	promotion?: string;
	menu?: string; // preorder name (+courses)
	occasion?: string;
	confirmAttempts: number;
	firstVisit: boolean;
	vip: boolean;
	allergies?: string;
	/** The money on this booking — absent when nothing was ever taken. ResDiary shows
	 *  this on the booking card; without it the only signal we had was the whole-grid
	 *  "Payment" colour scheme, which can't tell you HOW MUCH or WHEN. */
	payment?: DiaryPayment;
}

/** The one payment row that matters for a booking, as the diary card shows it. */
export interface DiaryPayment {
	/** Coarse bucket — same value the bar paints with. */
	state: DiaryPaymentStatus;
	/** Raw row status, so the card can say "Captured" vs "Authorized" vs "Refunded". */
	status: PaymentStatus | '';
	kind: PaymentKind | '';
	amount: number; // pence
	capturedAt?: string;
	reversedAt?: string;
}

/** One booking bar placed on a table row, with the minute offsets the page needs. */
/** Coarse payment bucket for the "Payment Info" colour scheme (ResDiary). */
export type DiaryPaymentStatus = 'none' | 'outstanding' | 'paid';

export interface DiaryBar {
	bookingId: string;
	/** booking.updated — the optimistic-version token the drag-to-move action checks
	 *  so a concurrent change (another device, the live floor) returns 409 instead of
	 *  being clobbered. Mirrors the live floor's `version`. */
	version: string;
	/** Whether this bar may be dragged to re-time / re-table it. False for the
	 *  synthetic Unassigned row and for finished/no-show bookings (nothing to move). */
	movable: boolean;
	/** Whether this bar's duration may be extended/restricted (drag the right edge). More
	 *  permissive than `movable`: a FINISHED sitting is resizable but not movable, so staff
	 *  can still adjust how long a table that already left stayed. False only for
	 *  no-show/cancelled. */
	resizable: boolean;
	guestName: string;
	partySize: number;
	status: BookingStatus;
	arrival: ArrivalStatus; // colour driver for the Arrival Status view
	channel: string; // colour square next to the party size
	/** The service this booking is FILED under (booking.service_period). The header
	 *  tallies by it so its per-service figures match the run-sheet and the reports —
	 *  a walk-in filed by the service running when it sat can start inside the
	 *  previous service's band (see periodFallback.ts / barPeriod.ts).
	 *
	 *  Optional: an optimistic bar drawn from the tap has no service until the server
	 *  answers, and falls back to the band its start lands in (barPeriod.ts). */
	periodId?: string;
	// --- extra colour-scheme dimensions (ResDiary's switchable schemes) --------
	/** Payment Info scheme bucket. */
	paymentStatus: DiaryPaymentStatus;
	/** Confirmation scheme: a guest-confirmed (or staff-confirmed) booking. */
	confirmed: boolean;
	/** Preorder scheme: true when a set-menu pre-order is attached. */
	hasPreorder: boolean;
	/** "Important" scheme: has any note/comment/allergy worth flagging. */
	important: boolean;
	// --- new-booking bell (ResDiary "highlight new bookings") ------------------
	/** Created within the venue's "new booking" window AND not yet acknowledged. */
	isNew: boolean;
	startsAt: string;
	endsAt: string;
	/** minutes from the grid's start edge to the bar's left/right (clamped to window). */
	startMin: number;
	endMin: number;
	startsBefore: boolean; // booking began before the window (clipped left)
	endsAfter: boolean; // booking runs past the window (clipped right)
	risk_score?: number;
	risk_factors?: unknown;
	special_requests?: string;
	// per-bar flag icons (ResDiary booking codes / glance flags)
	hasNote: boolean; // speech-bubble — a note/comment exists
	hasPromotion: boolean; // tag — promotion / booking code
	firstVisit: boolean; // "1" — first-time guest
	leaveTimeConfirmed: boolean; // clock — leave time agreed
	/** full detail for the hover/click popover. */
	detail: DiaryBooking;
}

export interface DiaryRow {
	tableId: string;
	label: string;
	seatsMax: number;
	bars: DiaryBar[];
	/** join-set id (shared by tables that combine) — null when the table stands alone. */
	joinGroup?: string | null;
	/** position within its join set, for drawing the connector: 'first'|'mid'|'last'|'solo'. */
	joinPos?: 'first' | 'mid' | 'last' | 'solo';
	/** labels of the other tables this one joins with (for the row tooltip). */
	joinedWith?: string[];
}

export interface DiarySection {
	name: string; // '' rows collapse under this; page shows "Unassigned"
	rows: DiaryRow[];
}

/** Per-period covers summary, e.g. "Lunch 20/20 Pax" in the ResDiary header. */
export interface DiaryPeriodTotal {
	periodId: string;
	name: string;
	covers: number; // live covers booked into this period
	/** Per-period covers cap for this date (max_covers_per_period from the most
	 *  specific matching pacing rule), or null when the period is uncapped. */
	cap: number | null;
	/** The owner's display-only covers target for this service (DiaryUiConfig
	 *  .coverTargets), or null when none is set. */
	target: number | null;
	/** The period's window as minute offsets from the axis start, clamped to the
	 *  visible grid — lets the header draw a "Lunch"/"Dinner" band over its columns. */
	startMin: number;
	endMin: number;
}

/**
 * ResDiary's "covers breakdown" popover (the Σ next to the Bookings/Covers header):
 * a section × service grid of Pax. One row per floor section, a covers count per
 * service period, plus the sub-total (placed covers) and an "excluded" count
 * (no-shows — covers that don't count toward the seated total).
 */
export interface DiaryCoversBreakdown {
	/** period columns, in the same order/name as `periodTotals`. */
	periods: { periodId: string; name: string }[];
	/** one row per section, covers per period keyed by periodId. */
	rows: { section: string; byPeriod: Record<string, number> }[];
	/** sub-total (placed covers) per period. */
	subTotal: Record<string, number>;
	/** excluded (no-show) covers per period — shown but not in the sub-total. */
	excluded: Record<string, number>;
}

export interface DiaryTimeline {
	sections: DiarySection[];
	/** axis: inclusive start, exclusive end, in ms; total minutes; tick step. */
	startMs: number;
	endMs: number;
	totalMin: number;
	stepMin: number; // 15 — quarter-hour columns
	/** quarter-hour tick marks. `major` = on the hour (bold label). */
	ticks: { label: string; min: number; major: boolean }[];
	/** covers arriving in each 15-min slot, aligned to `ticks` (ResDiary's count row). */
	slotCovers: number[];
	periodTotals: DiaryPeriodTotal[];
	/** section × service Pax grid for the header's covers-breakdown popover. */
	coversBreakdown: DiaryCoversBreakdown;
	floor?: Floor;
	floors: Floor[];
	nowMin: number | null; // "now" line offset, or null if outside the window/other day
	/** Lunch↕dinner service-divider line offset (minutes from window start), or null
	 *  when there's no configured/derivable split. Set from ui.serviceDividerTime, else
	 *  auto-derived from the gap between consecutive service periods. */
	dividerMin: number | null;
	covers: number;
	bookingCount: number;
	/** Diary UI prefs (colour scheme to open on, large-party threshold) so the
	 *  client renders ResDiary's switchable schemes without a second round-trip. */
	ui: DiaryUiConfig;
}

const DIARY_TZ = 'Europe/London';

/**
 * Front-to-back layout order for diary sections — mirrors how the room actually
 * reads (and the floor-editor's per-brand SECTION_PRESETS), so the grid isn't
 * alphabetised into "Back / Counter / Front / Middle". Covers both brands' real
 * section names; any unlisted section falls in after these (alphabetically) and
 * the unnamed group sits last. Tweak this list to reorder the diary.
 */
const DIARY_SECTION_ORDER = [
	// Asia — matches the owner's floor-plan section order (front → back → counter)
	'Front right section',
	'Middle section',
	'Front left section',
	'Back right section',
	'Back left section',
	'Counter section',
	// Fusion — matches the owner's floor-plan section order
	'Front Section',
	'Middle Section',
	'Back Section',
	'Bar Area',
	// generic presets
	'Main',
	'Window',
	'VIP',
	'Bar',
	'Outdoor'
];

/** Compare two table labels numerically when both are numbers (1,2,…10,11). */
function labelCmp(a: string, b: string): number {
	const na = Number(a);
	const nb = Number(b);
	if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
	return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Wall-clock 'HH:mm' on a local date → absolute ms, in the restaurant timezone
 * (Europe/London = GMT in winter, BST in summer). Uses fromZonedTime so the axis
 * window is correct regardless of the SERVER's timezone (e.g. UTC on Vercel) —
 * the same UK-time helper the availability engine uses. All display formatting
 * elsewhere pins timeZone:'Europe/London', so the whole diary is UK/GMT-locked.
 */
function localTimeToMs(date: string, hhmm: string, tz: string = DIARY_TZ): number {
	return fromZonedTime(`${date}T${hhmm}:00`, tz).getTime();
}

/**
 * Minutes a booking can be past its start before it counts as "Late" (Arrival view).
 *
 * ZERO, by the owner: "booked at 7pm and not here in time — from 7.00 and 1 second it
 * needs to turn red, so it's more visible for us when it's busy." A ten-minute grace
 * meant the board stayed calm through exactly the window the floor uses to chase a
 * table. The diary paints the same rule live off its own clock (`isLateNow`); this
 * constant keeps the server-derived label — the Arrivals panel's "late" tag, the
 * booking card's status — agreeing with the colour instead of trailing it by 10 minutes.
 */
const DIARY_LATE_GRACE_MIN = 0;

/**
 * Derive the ResDiary Arrival-Status colour band for a booking, given whether it
 * has a live (uncleared) seating, has been cleared, and the current time. Mirrors
 * the View Management key: unarrived/late/arrived/left/partially_seated.
 */
function arrivalStatusOf(
	b: BookingWithRefs,
	seating: { seated: boolean; cleared: boolean; seatedCount: number; tableCount: number },
	nowMs: number
): ArrivalStatus {
	if (b.status === 'no_show') return 'no_show';
	if (seating.cleared || b.status === 'completed') return 'left';
	if (seating.seated || b.status === 'seated') {
		// Host explicitly marked this booking "Partially Seated" (the diary/floor partial
		// action stamps floor_status='partially_seated'). Honour the stored marker first,
		// so a SINGLE-table booking — which has no seatedCount<tableCount signal of its own
		// — reads as partial too. Multi-table partials also satisfy the count check below.
		// String-compared because the value is deliberately kept out of the floor_status
		// union (see db/types.ts) so the narrower BookingView consumer still type-checks.
		if ((b.floor_status as string) === 'partially_seated') return 'partially_seated';
		// Some but not all of a multi-table booking seated → partially seated. Compare
		// the count of seated tables against the booking's FULL table count (a partial
		// seat creates floor_state for only some of the tables), not just the number of
		// floor rows present — so seating 1 of a 2-table booking reads as partial.
		const bookedTables = b.tables?.length ?? seating.tableCount;
		if (bookedTables > 1 && seating.seatedCount > 0 && seating.seatedCount < bookedTables)
			return 'partially_seated';
		return 'arrived';
	}
	// Host-set PRE-seating holding state (ResDiary's "Waiting in Bar" / "Table Ready").
	// Only meaningful while the party isn't seated yet (the cases above already
	// returned for seated/left/no-show), so it takes priority over the late/unarrived
	// clock derivation below.
	if (b.floor_status === 'waiting_bar') return 'waiting_bar';
	if (b.floor_status === 'table_ready') return 'table_ready';
	// not yet seated: late once we're past start + grace, else still to arrive
	const startMs = new Date(b.starts_at).getTime();
	if (nowMs > startMs + DIARY_LATE_GRACE_MIN * 60_000) return 'late';
	return 'unarrived';
}

/**
 * The booking ref shown on the diary card, the search subtitle and the printed
 * slip (ResDiary's "Ref#").
 *
 * This is deliberately the SAME code the guest is emailed. It used to be
 * `id.slice(-6).toUpperCase()`, which meant a guest quoting their confirmation
 * reference got "No matches" in search — see $lib/bookings/reference.
 */
function refOf(id: string): string {
	return bookingReference(id);
}

/**
 * Is this the customer's first booking? True when no OTHER live booking for the
 * same customer was created before this one. Uses the day's bookings only (cheap,
 * good enough for the "1st visit" glance flag); a brand-new walk-in with no
 * customer record also reads as a first visit.
 */
function isFirstVisitOf(b: BookingWithRefs, all: BookingWithRefs[]): boolean {
	if (!b.customer) return true;
	return !all.some(
		(o) =>
			o.id !== b.id &&
			o.customer === b.customer &&
			o.status !== 'cancelled' &&
			new Date(o.created).getTime() < new Date(b.created).getTime()
	);
}

/**
 * Human channel label for the colour square — from booking.channel, else source.
 *
 * Three channels reach this diary: the guest booked it themselves on the site
 * (Online), staff put it in the diary — over the phone, at the pass, or via the
 * assistant (Internal), or they walked through the door (Walk-in). `$lib/diary/
 * colourScheme` paints each one: yellow / blue / grey.
 */
function channelLabel(b: BookingWithRefs): string {
	// Asked first, so a party filed under the "Walk In" placeholder guest paints
	// grey here as well as counting as a walk-in on the run-sheet. That route
	// stamps source:'phone', which used to paint it blue (Internal) — the diary
	// and the run-sheet disagreeing about a booking whose guest column literally
	// reads "Walk In". One classifier, three screens: see walkin.ts.
	if (isWalkinBooking(b)) return 'Walk-in';
	if (b.channel) return b.channel;
	switch (b.source) {
		case 'online':
			return 'Online';
		case 'phone':
		case 'ai':
			return 'Internal';
		case 'walkin':
			return 'Walk-in';
		default:
			return 'Online';
	}
}

/**
 * Assemble the diary timeline for a brand/date, scoped to one floor (defaults to
 * the first). The time window spans the earliest period start to the latest
 * period end (falling back to the spread of actual bookings, then to 12:00–23:00)
 * so the grid always frames the day's service. Cancelled bookings are dropped;
 * no-shows are kept (greyed) — the diary shows the live plan, like the floor board.
 * Columns are quarter-hours; a per-slot covers row + per-period pax totals ride
 * along, and each bar carries its live arrival status (colour) and full detail.
 */
export async function getDiaryTimeline(
	brand: BrandId,
	date: string,
	nowISO: string,
	floorId?: string
): Promise<DiaryTimeline> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const [allTables, floors, bookings, periods, joins, uiConfig, pacing] = await Promise.all([
		getTables(restaurant.id),
		getFloors(restaurant.id),
		getBookingsForDay(brand, date),
		listPeriods(brand),
		getJoins(restaurant.id),
		getDiaryUiConfig(brand),
		getPacingRules(restaurant.id)
	]);

	// Table joins (ResDiary "table joins"): tables that combine for larger parties.
	// Build connected-component sets via union-find so a chain A↔B↔C is one group.
	// The diary keeps joined tables adjacent and draws a connector down the set so a
	// booking sat across them reads as one party (each joined table still gets its
	// own bar — the booking holds every table in its `tables[]`).
	const parent = new Map<string, string>();
	const find = (x: string): string => {
		let r = x;
		while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
		return r;
	};
	const union = (a: string, b: string) => {
		parent.set(parent.has(a) ? find(a) : a, parent.has(b) ? find(b) : find(a));
		parent.set(a, find(a));
		parent.set(b, find(a));
	};
	for (const j of joins) {
		if (!parent.has(j.table_a)) parent.set(j.table_a, j.table_a);
		if (!parent.has(j.table_b)) parent.set(j.table_b, j.table_b);
		union(j.table_a, j.table_b);
	}
	// group id → member table ids (only groups with ≥2 members are "joined")
	const groupMembers = new Map<string, Set<string>>();
	for (const tid of parent.keys()) {
		const root = find(tid);
		(groupMembers.get(root) ?? groupMembers.set(root, new Set()).get(root)!).add(tid);
	}

	const activeFloor = floors.length
		? (floors.find((f) => f.id === floorId) ?? floors[0])
		: undefined;
	// Scope to the active floor — BUT if no table is tagged to that floor (legacy /
	// not-yet-assigned data: every table has floor=''), fall back to all tables so
	// the diary still shows the room instead of an empty grid. Mirrors getFloorPlan.
	const scoped = activeFloor ? allTables.filter((t) => t.floor === activeFloor.id) : [];
	const tables = scoped.length ? scoped : allTables;

	// Cancelled bookings vanish; no-shows stay (greyed) so the slot reads as burned.
	const live = bookings.filter((b) => b.status !== 'cancelled');
	const nowMs = new Date(nowISO).getTime();

	// PERF: the floor_state (arrival status) and payments (Payment Info colour) reads
	// both depend ONLY on `live` (the day's bookings, already resolved above) and not
	// on each other — so fetch them concurrently instead of one-after-the-other,
	// collapsing two serial cross-region round-trips into one wall-clock hop. Both use
	// the `booking=x || booking=y` id filter; payments still degrades to [] on error.
	const bookingFilter = live.length ? live.map((b) => `booking=${q(b.id)}`).join(' || ') : '';
	const [floorRows, payRows] = await Promise.all([
		live.length
			? c.collection('geisha_floor_state').getFullList<FloorState>({ filter: bookingFilter })
			: Promise.resolve([] as FloorState[]),
		live.length
			? c
					.collection('geisha_payments')
					.getFullList<Payment>({ filter: bookingFilter })
					.catch(() => [] as Payment[])
			: Promise.resolve([] as Payment[])
	]);

	// Live seatings (floor_state) so each bar gets its true arrival status: a row
	// without cleared_at = currently seated; with cleared_at = left/finished. Keyed
	// by booking so multi-table parties resolve "partially seated" correctly.
	const seatingByBooking = new Map<
		string,
		{
			seated: boolean;
			cleared: boolean;
			seatedCount: number;
			tableCount: number;
			// SEAT-TIME TRIM: earliest actual seat time across this booking's tables, in ms.
			// 0 = never seated / unknown. Display-only — see the bar loop.
			seatedAtMs: number;
			// …and the LATEST clear, which tells a genuine early arrival apart from a stale
			// stamp on a re-timed sitting (see seatedBarStartMin). 0 = still seated.
			clearedAtMs: number;
		}
	>();
	for (const fs of floorRows) {
		const cur = seatingByBooking.get(fs.booking) ?? {
			seated: false,
			cleared: false,
			seatedCount: 0,
			tableCount: 0,
			seatedAtMs: 0,
			clearedAtMs: 0
		};
		cur.tableCount += 1;
		if (fs.cleared_at) cur.cleared = true;
		else {
			cur.seated = true;
			cur.seatedCount += 1;
		}
		// Track the EARLIEST seat time (across seated OR cleared rows) so an early or late
		// sit-down moves the bar's left edge to the real seat time — even after they leave.
		const seatedMs = fs.seated_at ? new Date(fs.seated_at).getTime() : 0;
		if (seatedMs && (!cur.seatedAtMs || seatedMs < cur.seatedAtMs)) cur.seatedAtMs = seatedMs;
		// …and the LATEST clear, so the trim can reject a sitting that finished before the
		// booked window ever started (a re-timed booking's stale stamp).
		const clearedMs = fs.cleared_at ? new Date(fs.cleared_at).getTime() : 0;
		if (clearedMs > cur.clearedAtMs) cur.clearedAtMs = clearedMs;
		seatingByBooking.set(fs.booking, cur);
	}

	// Payment status per booking (ResDiary "Payment Info" colour scheme), mapped to a
	// coarse bucket the bar reads. 'none' = no payment row (no deposit needed);
	// 'paid' = Authorized/Captured (card held or deposit taken); 'outstanding' =
	// a payment was required but isn't settled yet (Created / pending). Reversed/
	// Refunded/Canceled fall back to 'none' (no live money held).
	const paymentByBooking = new Map<string, DiaryPaymentStatus>();
	// …and the ROW itself, for the booking card. The bucket alone answers "is there
	// money on this?" but not "how much, and is it taken or just held?" — which is the
	// question a host actually asks when a party arrives claiming they've paid.
	const paymentRowByBooking = new Map<string, Payment>();
	// Which row wins when a booking has several (a released hold followed by a real
	// deposit, a refund after a capture). Highest rank is the live/most-recent truth.
	const payRank = (s: PaymentStatus | ''): number =>
		s === 'Captured' ? 5 : s === 'Authorized' ? 4 : s === 'Created' ? 3 : s === 'Refunded' ? 2 : 1;
	for (const p of payRows) {
		const bucket: DiaryPaymentStatus =
			p.status === 'Authorized' || p.status === 'Captured'
				? 'paid'
				: p.status === 'Created'
					? 'outstanding'
					: 'none';
		// keep the "strongest" status if a booking somehow has >1 payment row
		const prev = paymentByBooking.get(p.booking);
		if (!prev || bucket === 'paid' || (bucket === 'outstanding' && prev === 'none')) {
			paymentByBooking.set(p.booking, bucket);
		}
		const prevRow = paymentRowByBooking.get(p.booking);
		if (!prevRow || payRank(p.status) > payRank(prevRow.status)) {
			paymentRowByBooking.set(p.booking, p);
		}
	}

	// --- time window -----------------------------------------------------------
	// Prefer the configured service periods (earliest start → latest end). If none,
	// frame the actual bookings. If neither, a sane lunch-to-late default.
	const tz = restaurant.timezone || DIARY_TZ;
	// Only the services that actually RUN on the viewed date's weekday — the same
	// day-of-week gate the availability/forecast engines use. Without this the diary
	// showed every restaurant period regardless of day, so on a Sunday Fusion drew
	// its Mon–Fri "Lunch" and Mon–Sat "Dinner" bands stacked under the Sunday-only
	// "Sunday" service (overlapping labels), and the window ran to the widest of all
	// of them. dow uses noon to dodge any DST edge, matching the booking engines.
	const dow = fromZonedTime(`${date}T12:00:00`, tz).getDay();
	const dayPeriods = periods.filter((p) => p.active !== false && p.days_of_week?.includes(dow));
	let startMs = Infinity;
	let endMs = -Infinity;
	for (const p of dayPeriods) {
		startMs = Math.min(startMs, localTimeToMs(date, p.start_time, tz));
		endMs = Math.max(endMs, localTimeToMs(date, p.end_time, tz));
	}
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
		for (const b of live) {
			startMs = Math.min(startMs, new Date(b.starts_at).getTime());
			endMs = Math.max(endMs, new Date(b.ends_at).getTime());
		}
	}
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
		startMs = localTimeToMs(date, '12:00', tz);
		endMs = localTimeToMs(date, '23:00', tz);
	}
	// Guarantee the operator's full at-a-glance service window (owner #1+#2): the
	// grid must always span at least 12:00 → 23:30 so lunch-to-late is visible
	// without scrolling, even when a period (or the only bookings) sit inside it.
	// We only ever WIDEN to this floor/ceiling — a period that opens earlier or
	// closes later than the default still shows in full.
	startMs = Math.min(startMs, localTimeToMs(date, '12:00', tz));
	endMs = Math.max(endMs, localTimeToMs(date, '23:30', tz));
	// Pad to whole hours so the axis ticks land cleanly, and give a little headroom.
	startMs = Math.floor(startMs / 3_600_000) * 3_600_000;
	endMs = Math.ceil(endMs / 3_600_000) * 3_600_000;
	const totalMin = Math.round((endMs - startMs) / 60_000);

	// --- ticks (quarter-hour) --------------------------------------------------
	// ResDiary's axis: every 15 min, the hour shown in bold (major). The page reads
	// `major` to bold the on-the-hour labels and draw a heavier gridline there.
	const stepMin = 15;
	const ticks: { label: string; min: number; major: boolean }[] = [];
	for (let t = startMs; t <= endMs; t += stepMin * 60_000) {
		const d = new Date(t);
		const min = Math.round((t - startMs) / 60_000);
		const onHour = d.getMinutes() === 0;
		ticks.push({
			label: onHour
				? d.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: DIARY_TZ })
				: String(d.getMinutes()).padStart(2, '0'),
			min,
			major: onHour
		});
	}

	// Covers arriving in each 15-min slot (aligned to `ticks`) + per-period pax
	// totals — the count row and "Lunch 20/20" header figures in ResDiary.
	const slotCovers = new Array(ticks.length).fill(0);
	const periodCovers = new Map<string, number>();
	// Section × service Pax grid for the header's covers-breakdown popover (ResDiary
	// Σ). Resolve each booking's section from its FIRST assigned table; a booking
	// with no (on-floor) table lands in the '' section, shown as "Unassigned".
	// No-shows are tallied separately under "excluded" — they don't count toward
	// the seated sub-total, matching ResDiary's red "Excluded" row.
	const sectionByTable = new Map(allTables.map((t) => [t.id, t.section || '']));
	const bkPlaced = new Map<string, Map<string, number>>(); // section → periodId → pax
	const bkExcluded = new Map<string, number>(); // periodId → no-show pax
	const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
	for (const b of live) {
		const pid = b.service_period || '';
		const pax = b.party_size || 0;
		if (b.status === 'no_show') {
			bump(bkExcluded, pid, pax); // a no-show isn't a seated cover
			continue;
		}
		const s = new Date(b.starts_at).getTime();
		const slotIdx = Math.floor((s - startMs) / 60_000 / stepMin);
		if (slotIdx >= 0 && slotIdx < slotCovers.length) slotCovers[slotIdx] += pax;
		periodCovers.set(pid, (periodCovers.get(pid) ?? 0) + pax);
		const firstTable = (b.tables ?? []).find((t) => t && t !== '__unassigned__');
		const section = (firstTable && sectionByTable.get(firstTable)) || '';
		const bySec = bkPlaced.get(section) ?? bkPlaced.set(section, new Map()).get(section)!;
		bump(bySec, pid, pax);
	}
	// Per-period covers cap for this date: the most-specific pacing rule that
	// matches (period, day-of-week). A cap of 0 (or no rule) means uncapped → null,
	// so the header shows a bare covers count rather than "n/0". `dow` uses noon to
	// dodge any DST edge, matching the availability engine's dayOfWeek.
	// Period window as axis-minute offsets, clamped to the visible grid so the
	// header band never overflows either end. Only the day's active services (dow-
	// filtered above) get a band — no stale off-day period draws its label.
	const clampMin = (m: number) => Math.max(0, Math.min(totalMin, m));
	const periodTotals: DiaryPeriodTotal[] = dayPeriods.map((p) => {
		const rule = selectPacingRule(p.id, dow, pacing);
		const cap = rule && rule.maxCoversPerPeriod > 0 ? rule.maxCoversPerPeriod : null;
		const startMin = clampMin(
			Math.round((localTimeToMs(date, p.start_time, tz) - startMs) / 60_000)
		);
		const endMin = clampMin(Math.round((localTimeToMs(date, p.end_time, tz) - startMs) / 60_000));
		const target = Number(uiConfig.coverTargets?.[p.id]);
		return {
			periodId: p.id,
			name: p.name,
			covers: periodCovers.get(p.id) ?? 0,
			cap,
			target: Number.isFinite(target) && target > 0 ? target : null,
			startMin,
			endMin
		};
	});

	// Assemble the breakdown grid in the diary's front-to-back section order (unnamed
	// section last, labelled "Unassigned"), columns = the service periods.
	const bdOrderIdx = (name: string) => {
		const i = DIARY_SECTION_ORDER.indexOf(name);
		return i === -1 ? DIARY_SECTION_ORDER.length : i;
	};
	const bdSectionNames = [...bkPlaced.keys()].sort((a, b) => {
		if (a === '') return 1;
		if (b === '') return -1;
		const oa = bdOrderIdx(a);
		const ob = bdOrderIdx(b);
		return oa !== ob ? oa - ob : a.localeCompare(b);
	});
	const bdSubTotal: Record<string, number> = {};
	const coversBreakdown: DiaryCoversBreakdown = {
		periods: dayPeriods.map((p) => ({ periodId: p.id, name: p.name })),
		rows: bdSectionNames.map((name) => {
			const byPeriod: Record<string, number> = {};
			const secMap = bkPlaced.get(name)!;
			for (const p of dayPeriods) {
				const n = secMap.get(p.id) ?? 0;
				byPeriod[p.id] = n;
				bdSubTotal[p.id] = (bdSubTotal[p.id] ?? 0) + n;
			}
			return { section: name || 'Unassigned', byPeriod };
		}),
		subTotal: Object.fromEntries(dayPeriods.map((p) => [p.id, bdSubTotal[p.id] ?? 0])),
		excluded: Object.fromEntries(dayPeriods.map((p) => [p.id, bkExcluded.get(p.id) ?? 0]))
	};

	// --- place each booking on each of its tables ------------------------------
	const tableLabelById = new Map(allTables.map((t) => [t.id, t.label]));
	const barsByTable = new Map<string, DiaryBar[]>();
	// Booked start (raw axis minute) per booking, for the early-seat clamp below — the bar
	// itself only carries the TRIMMED start, which is the thing being clamped.
	const bookedStartByBooking = new Map<string, number>();
	let covers = 0;
	for (const b of live) {
		if (b.status !== 'no_show') covers += b.party_size || 0;
		const s = new Date(b.starts_at).getTime();
		const e = new Date(b.ends_at).getTime();
		// skip bookings entirely outside the window (shouldn't happen given the day filter)
		if (e <= startMs || s >= endMs) continue;
		const bookedStartMin = Math.round((s - startMs) / 60_000); // raw; negative = before the grid
		const endMin = Math.min(totalMin, Math.round((e - startMs) / 60_000));
		bookedStartByBooking.set(b.id, bookedStartMin);

		const seating = seatingByBooking.get(b.id) ?? {
			seated: false,
			cleared: false,
			seatedCount: 0,
			tableCount: b.tables?.length ?? 0,
			seatedAtMs: 0,
			clearedAtMs: 0
		};
		// SEAT-TIME TRIM: the bar's LEFT edge is drawn from the party's REAL seat time, in
		// both directions — right for a late sit-down (the bar shortens), left for an early
		// one (it lengthens, because the table is genuinely occupied from then), and flush to
		// the very left of the grid when they were sat before service opened. The right edge
		// (ends_at) never moves. Display only: starts_at is untouched, so occupancy / turn /
		// pacing are unaffected. Full rule + the stamps it refuses: seatedBarStartMin.
		const seatMin = seating.seatedAtMs ? Math.round((seating.seatedAtMs - startMs) / 60_000) : null;
		const clearedMin = seating.clearedAtMs
			? Math.round((seating.clearedAtMs - startMs) / 60_000)
			: null;
		const rawStartMin = seatedBarStartMin({
			bookedStartMin,
			bookedEndMin: endMin,
			seatMin,
			clearedMin
		});
		const startMin = Math.max(0, rawStartMin);
		const arrival = arrivalStatusOf(b, seating, nowMs);
		const channel = channelLabel(b);
		const cust = b.expand?.customer;
		const guestName = cust?.name ?? `${b.party_size}p`;
		const firstVisit = isFirstVisitOf(b, bookings);
		const menuName = b.preorder
			? `${b.preorder.name}${b.preorder.courses ? ` · ${b.preorder.courses}` : ''}`
			: undefined;

		// Colour-scheme bucket (also read by the bar below) + the row behind it.
		const paymentStatus = paymentByBooking.get(b.id) ?? 'none';
		const payRow = paymentRowByBooking.get(b.id);
		const paymentDetail: DiaryPayment | undefined = payRow
			? {
					state: paymentStatus,
					status: payRow.status,
					kind: payRow.kind,
					amount: payRow.amount ?? 0,
					capturedAt: payRow.captured_at || undefined,
					reversedAt: payRow.reversed_at || undefined
				}
			: undefined;

		const detail: DiaryBooking = {
			ref: refOf(b.id),
			guestName,
			email: cust?.email || undefined,
			phone: cust?.phone || undefined,
			bookedOn: b.created,
			partySize: b.party_size,
			startsAt: b.starts_at,
			endsAt: b.ends_at,
			leaveTimeConfirmed: b.leave_time_confirmed ?? false,
			status: b.status,
			channel,
			tableLabels: (b.tables ?? []).map((tid) => tableLabelById.get(tid) ?? tid),
			tableIds: (b.tables ?? []).filter((t) => t && t !== '__unassigned__'),
			customerId: b.customer || undefined,
			customerComments: cust?.notes || undefined,
			noteToRestaurant: b.note_to_restaurant || undefined,
			bookingComments: b.special_requests || undefined,
			promotion: b.promotion || undefined,
			menu: menuName,
			occasion: b.occasion || undefined,
			confirmAttempts: b.confirm_attempts ?? 0,
			firstVisit,
			vip: cust?.vip ?? false,
			allergies: cust?.allergies || undefined,
			payment: paymentDetail
		};

		// A bar is draggable whenever the sitting still exists on the floor plan —
		// including a FINISHED ("closed") one. The owner's case: a table is closed out
		// at the end of the sitting and turns its finished colour, but the host then
		// needs to correct WHICH table (or when) that party actually sat at. ResDiary
		// lets you drag a departed booking for exactly that reason, so only truly-gone
		// states (no-show / cancelled) are pinned. (The synthetic Unassigned row further
		// forces movable=false below, since it has no real table to move on.)
		const movable = b.status !== 'no_show' && b.status !== 'cancelled';
		// RESIZABLE follows the same rule — a finished sitting can be lengthened/shortened
		// to record how long the table was actually held.
		const resizable = b.status !== 'no_show' && b.status !== 'cancelled';

		// Colour-scheme dimensions (computed once; the client picks which to paint).
		// `paymentStatus` is resolved above, with the payment row the card shows.
		// "Confirmed" = the explicit flag, OR any status past pending_payment (a
		// seated/completed booking is self-evidently confirmed). Back-compat: the
		// flag is absent pre-migration, so status carries it.
		const confirmed =
			b.confirmed === true || (b.status !== 'pending_payment' && b.status !== 'cancelled');
		const hasPreorder = Boolean(b.preorder && b.preorder.id);
		const important = Boolean(
			b.special_requests || b.note_to_restaurant || cust?.notes || cust?.allergies
		);
		// New-booking bell (ResDiary "highlight new bookings"): a LAST-MINUTE
		// reservation — one made shortly BEFORE the guest's arrival time. ResDiary
		// measures the gap from arrival, not from "now": a booking taken at 18:50 for
		// a 19:00 sitting rings the bell; a booking taken weeks ago does not, even if
		// entered moments ago. So compare (starts_at − created) to the threshold.
		// Still gated on not-yet-acknowledged (seen_by_staff) and an active booking,
		// and only rings while the sitting is still upcoming/just-passed (not once the
		// party has long gone). 0/absent threshold disables it.
		const createdMs = new Date(b.created).getTime();
		const startMsB = new Date(b.starts_at).getTime();
		const leadMs = startMsB - createdMs; // how far ahead it was booked
		const isNew =
			uiConfig.lastMinuteThresholdMins > 0 &&
			b.seen_by_staff !== true &&
			leadMs <= uiConfig.lastMinuteThresholdMins * 60_000 &&
			// don't keep ringing for a sitting that finished hours ago
			startMsB >= nowMs - 2 * 60 * 60_000 &&
			b.status !== 'no_show' &&
			b.status !== 'completed';

		const bar: DiaryBar = {
			bookingId: b.id,
			version: b.updated,
			movable,
			resizable,
			guestName,
			partySize: b.party_size,
			status: b.status,
			arrival,
			channel,
			periodId: b.service_period || '',
			paymentStatus,
			confirmed,
			hasPreorder,
			important,
			isNew,
			startsAt: b.starts_at,
			endsAt: b.ends_at,
			startMin,
			endMin: Math.max(endMin, startMin + 1), // always at least a sliver wide
			// Clipped left: the sitting began before the grid opens — either booked that way,
			// or (with the trim above) sat down before service started, in which case the bar
			// snaps flush to the very left.
			startsBefore: rawStartMin < 0,
			endsAfter: e > endMs,
			risk_score: b.risk_score,
			risk_factors: b.risk_factors,
			special_requests: b.special_requests,
			hasNote: Boolean(b.special_requests || b.note_to_restaurant || cust?.notes),
			hasPromotion: Boolean(b.promotion),
			firstVisit,
			leaveTimeConfirmed: b.leave_time_confirmed ?? false,
			detail
		};
		const tbls = b.tables?.length ? b.tables : ['__unassigned__'];
		for (const tid of tbls) {
			(barsByTable.get(tid) ?? barsByTable.set(tid, []).get(tid)!).push(bar);
		}
	}

	// EARLY-SEAT CLAMP. The trim above is per booking; whether it reaches back INTO the
	// previous party can only be answered per table, once every bar is placed. A seat stamp
	// a minute or two before the outgoing sitting's end (the host seats the next party while
	// the last one is still being cleared) would otherwise split the table's row and flag
	// both parties as double-booked over an artefact. See seatTrimFloors: the floor is never
	// past the booking's own booked start, so a real overbook still overlaps and still ⚠s.
	const clampFloors = new Map<string, number>();
	for (const [tid, bars] of barsByTable) {
		if (tid === '__unassigned__') continue; // no real table → no sequence to clear
		for (const [bookingId, floor] of seatTrimFloors(
			bars.map((bar) => ({
				bookingId: bar.bookingId,
				bookedStartMin: bookedStartByBooking.get(bar.bookingId) ?? bar.startMin,
				endMin: bar.endMin
			}))
		)) {
			const cur = clampFloors.get(bookingId);
			if (cur === undefined || floor > cur) clampFloors.set(bookingId, floor);
		}
	}
	// One DiaryBar object is shared across a booking's tables, so a Set applies each once.
	const uniqueBars = new Set([...barsByTable.values()].flat());
	for (const bar of uniqueBars) {
		const floor = clampFloors.get(bar.bookingId);
		if (floor === undefined || bar.startMin >= floor) continue;
		// Up to the next whole cell (never past the booked start): the snap below floors the
		// left edge, so a mid-cell floor would reach back into the previous party's last cell,
		// split the row into sub-lanes and draw the bar a row down.
		const booked = bookedStartByBooking.get(bar.bookingId) ?? floor;
		const cellFloor = Math.min(Math.ceil(floor / stepMin) * stepMin, Math.max(floor, booked));
		bar.startMin = Math.min(cellFloor, bar.endMin - 1);
		// It no longer runs off the left edge unless it was BOOKED that way.
		bar.startsBefore = (bookedStartByBooking.get(bar.bookingId) ?? 0) < 0;
	}

	// SNAP TO THE CELL GRID. Last, because it quantises whatever the trim and the clamp
	// above settled on: a sitting seated at 16:04 and finished at 16:57 fills the 16:00 and
	// 16:45 cells rather than starting and stopping part-way through them (ResDiary parity —
	// a booking there is always whole cells). Display only; starts_at/ends_at are untouched.
	// See barGrid.ts, and snapEndCaps for the false double-booking it has to avoid inventing.
	const rawSpans = new Map<string, { startMin: number; endMin: number }>();
	for (const bar of uniqueBars) {
		rawSpans.set(bar.bookingId, { startMin: bar.startMin, endMin: bar.endMin });
		const snapped = snapBarToCells(bar, stepMin, totalMin);
		bar.startMin = snapped.startMin;
		bar.endMin = snapped.endMin;
	}
	const endCaps = new Map<string, number>();
	for (const [tid, bars] of barsByTable) {
		if (tid === '__unassigned__') continue; // no real table → no sequence to protect
		for (const [bookingId, cap] of snapEndCaps(
			bars.map((bar) => {
				const raw = rawSpans.get(bar.bookingId) ?? bar;
				return {
					bookingId: bar.bookingId,
					rawStartMin: raw.startMin,
					rawEndMin: raw.endMin,
					snapStartMin: bar.startMin,
					snapEndMin: bar.endMin
				};
			})
		)) {
			const cur = endCaps.get(bookingId);
			if (cur === undefined || cap < cur) endCaps.set(bookingId, cap);
		}
	}
	for (const bar of uniqueBars) {
		const cap = endCaps.get(bar.bookingId);
		if (cap !== undefined && cap < bar.endMin) bar.endMin = cap;
	}

	// --- rows grouped by section ----------------------------------------------
	type SectionedRow = DiaryRow & { section: string };
	// Resolve each table's join set (≥2 members) and a stable group-sort key (the
	// set's lowest table label) so the whole set clusters together in the section.
	const joinKeyByTable = new Map<string, { group: string; members: string[]; sortKey: string }>();
	for (const [root, members] of groupMembers) {
		if (members.size < 2) continue;
		const memberLabels = [...members]
			.map((id) => allTables.find((t) => t.id === id)?.label ?? id)
			.sort(labelCmp);
		const sortKey = memberLabels[0];
		for (const id of members)
			joinKeyByTable.set(id, { group: root, members: [...members], sortKey });
	}
	const rows: SectionedRow[] = tables.map((t) => {
		const jk = joinKeyByTable.get(t.id);
		return {
			tableId: t.id,
			label: t.label,
			seatsMax: t.seats_max,
			section: t.section || '',
			joinGroup: jk?.group ?? null,
			joinedWith: jk
				? jk.members
						.filter((id) => id !== t.id)
						.map((id) => allTables.find((x) => x.id === id)?.label ?? id)
				: [],
			bars: (barsByTable.get(t.id) ?? []).sort((a, b) => a.startMin - b.startMin)
		};
	});

	// Any booking on a table not on this floor (or with no table) lands in a
	// synthetic "Unassigned" row so it's never silently dropped.
	const placedTableIds = new Set(tables.map((t) => t.id));
	const orphanBars: DiaryBar[] = [];
	for (const [tid, bars] of barsByTable) {
		if (tid === '__unassigned__' || !placedTableIds.has(tid)) orphanBars.push(...bars);
	}

	const bySection = new Map<string, DiaryRow[]>();
	for (const r of rows) {
		const key = r.section || '';
		(bySection.get(key) ?? bySection.set(key, []).get(key)!).push(r);
	}
	// Section order: the operator's front-to-back layout flow (DIARY_SECTION_ORDER),
	// then any unlisted sections alphabetically, then the unnamed ('') group last —
	// NOT alphabetical, which scrambled "Back/Counter/Front/Middle". Rows inside a
	// section sort by table label numerically (1,2,…10,11 — not 1,10,11,2).
	const orderIdx = (name: string) => {
		const i = DIARY_SECTION_ORDER.indexOf(name);
		return i === -1 ? DIARY_SECTION_ORDER.length : i;
	};
	const sectionNames = [...bySection.keys()].sort((a, b) => {
		if (a === '') return 1;
		if (b === '') return -1;
		const oa = orderIdx(a);
		const ob = orderIdx(b);
		return oa !== ob ? oa - ob : a.localeCompare(b);
	});
	// Within a section: cluster joined tables together (sorted by the set's lowest
	// label), then plain tables by label. Then tag each joined row's position in its
	// set (first/mid/last) so the page can draw the connector bracket.
	const sortRows = (list: DiaryRow[]): DiaryRow[] => {
		const keyOf = (r: DiaryRow) =>
			r.joinGroup ? (joinKeyByTable.get(r.tableId)?.sortKey ?? r.label) : r.label;
		const sorted = [...list].sort((r1, r2) => {
			const k1 = keyOf(r1);
			const k2 = keyOf(r2);
			if (k1 !== k2) return labelCmp(k1, k2);
			// same join set (or tie) → order by own label
			return labelCmp(r1.label, r2.label);
		});
		// mark join positions across consecutive same-group runs
		for (let i = 0; i < sorted.length; i++) {
			const g = sorted[i].joinGroup;
			if (!g) {
				sorted[i].joinPos = 'solo';
				continue;
			}
			const prevSame = i > 0 && sorted[i - 1].joinGroup === g;
			const nextSame = i < sorted.length - 1 && sorted[i + 1].joinGroup === g;
			sorted[i].joinPos =
				!prevSame && nextSame
					? 'first'
					: prevSame && nextSame
						? 'mid'
						: prevSame && !nextSame
							? 'last'
							: 'solo';
		}
		return sorted;
	};
	const sections: DiarySection[] = sectionNames.map((name) => ({
		name,
		rows: sortRows(bySection.get(name) ?? [])
	}));
	if (orphanBars.length) {
		// de-dup orphan bars (a multi-table booking off-floor would repeat) by bookingId
		const seen = new Set<string>();
		const uniq = orphanBars.filter((b) => (seen.has(b.bookingId) ? false : seen.add(b.bookingId)));
		sections.push({
			name: 'Unassigned',
			rows: [{ tableId: '__unassigned__', label: '—', seatsMax: 0, bars: uniq }]
		});
	}

	// --- "now" line ------------------------------------------------------------
	const nowMin = nowMs >= startMs && nowMs <= endMs ? Math.round((nowMs - startMs) / 60_000) : null;

	// --- lunch↕dinner service divider -----------------------------------------
	// A single vertical rule splitting the day's services. Prefer the manager's
	// explicit ui.serviceDividerTime ('HH:mm'); otherwise AUTO-derive it from the
	// biggest gap between consecutive service-period windows (lunch closes → dinner
	// opens) and draw it at the midpoint of that gap. If neither yields a time inside
	// the window, there's no line (a single continuous service).
	const clampToWindow = (ms: number): number | null => {
		if (ms <= startMs || ms >= endMs) return null;
		return Math.round((ms - startMs) / 60_000);
	};
	let dividerMin: number | null = null;
	const explicitDivider = (uiConfig.serviceDividerTime || '').trim();
	if (/^\d{1,2}:\d{2}$/.test(explicitDivider)) {
		dividerMin = clampToWindow(localTimeToMs(date, explicitDivider, tz));
	} else if (dayPeriods.length >= 2) {
		// AUTO placement between consecutive service-period windows (sorted by open
		// time). Our periods usually BUTT UP against each other — e.g. Daytime closes
		// at 17:00 and Dinner opens at 17:00 — so there's no gap to bisect; the split
		// is simply that shared boundary. So for each adjacent pair we take the
		// boundary between them: the midpoint of [prev.close, next.open] (which equals
		// the shared time when they're contiguous, sits mid-gap when there's a gap, and
		// still gives a sensible point if they slightly overlap). We pick the pair whose
		// boundary lands closest to the middle of the visible window, so with 3+ periods
		// we draw the one dominant lunch↕dinner divide rather than every seam.
		const windows = dayPeriods
			.map((p) => ({
				open: localTimeToMs(date, p.start_time, tz),
				close: localTimeToMs(date, p.end_time, tz)
			}))
			.sort((a, b) => a.open - b.open);
		const windowMidMs = (startMs + endMs) / 2;
		let bestBoundary: number | null = null;
		let bestDist = Infinity;
		for (let i = 1; i < windows.length; i++) {
			const boundary = (windows[i - 1].close + windows[i].open) / 2;
			const dist = Math.abs(boundary - windowMidMs);
			if (dist < bestDist) {
				bestDist = dist;
				bestBoundary = boundary;
			}
		}
		if (bestBoundary !== null) dividerMin = clampToWindow(bestBoundary);
	}

	return {
		sections,
		startMs,
		endMs,
		totalMin,
		stepMin,
		ticks,
		slotCovers,
		periodTotals,
		coversBreakdown,
		floor: activeFloor,
		floors,
		nowMin,
		dividerMin,
		covers,
		bookingCount: live.filter((b) => b.status !== 'no_show').length,
		ui: uiConfig
	};
}
