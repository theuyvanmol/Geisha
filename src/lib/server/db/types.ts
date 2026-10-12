// TypeScript shapes for the geisha_* PocketBase collections (see
// BOOKING_SYSTEM_PLAN.md §3). PocketBase adds `id`, `created`, `updated` to
// every record automatically; `BaseRecord` captures those. Relation fields hold
// the related record id(s); multi-relations are string[].
//
// These are hand-maintained (PocketBase has no codegen in this setup). Keep in
// sync with the migration at pb_migrations/1772700000_created_geisha_collections.js.

export type BrandId = 'asia' | 'fusion';

export interface BaseRecord {
	id: string;
	created: string; // ISO datetime
	updated: string;
}

export type Collection =
	| 'geisha_restaurants'
	| 'geisha_service_periods'
	| 'geisha_settings'
	| 'geisha_content'
	| 'geisha_media'
	| 'geisha_tables'
	| 'geisha_table_joins'
	| 'geisha_floors'
	| 'geisha_floor_shapes'
	| 'geisha_customers'
	| 'geisha_bookings'
	| 'geisha_payments'
	| 'geisha_floor_state'
	| 'geisha_audit_log'
	// Plan foundation (F2), see 1772700600_geisha_plan_collections.js
	| 'geisha_staff'
	| 'geisha_closures'
	| 'geisha_pacing_rules'
	| 'geisha_deposit_rules'
	| 'geisha_waitlist'
	| 'geisha_messages'
	| 'geisha_ai_insights'
	| 'geisha_alerts'
	| 'geisha_reviews'
	| 'geisha_locks'
	// Contact-form inbox, see 1786100000_geisha_enquiries.js
	| 'geisha_enquiries'
	// Post-visit 0–5 scores, see 1786200000_geisha_guest_feedback.js
	| 'geisha_feedback';

export interface Restaurant extends BaseRecord {
	brand: BrandId;
	display_name: string;
	timezone: string; // 'Europe/London'
}

export interface ServicePeriod extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	name: string; // 'Lunch' | 'Dinner' | 'Sunday'
	days_of_week: number[]; // 0=Sun .. 6=Sat
	start_time: string; // 'HH:mm'
	end_time: string; // 'HH:mm'
	last_booking_time: string; // 'HH:mm'
	default_turn_minutes: number;
	active: boolean;
}

export interface Setting extends BaseRecord {
	restaurant: string;
	key: string;
	value: unknown; // json
}

/**
 * A block of editable public content (gallery / menus / home text / brand info),
 * one row per (restaurant, key). Public pages read these and fall back to the
 * hardcoded src/lib/data/* defaults when a row is absent. See content.ts.
 */
export interface ContentRecord extends BaseRecord {
	restaurant: string;
	key: string;
	value: unknown; // json — shape depends on `key` (see lib/content/schema)
}

/** An image uploaded via the admin picker. `file` is a PocketBase file field. */
export interface MediaRecord extends BaseRecord {
	restaurant?: string;
	/**
	 * Legacy: a PocketBase attachment on the droplet's local disk (public URL via
	 * pb.files.getURL). Uploads go to R2 now, so this is empty on new rows and
	 * only set on rows predating migration 1782950000. Readers prefer `url`.
	 */
	file?: string;
	/** Public CDN URL of the object on R2. Set on every row created since the R2 switch. */
	url?: string;
	/** The AVIF/WebP responsive ladder generated at upload. Empty for video. */
	variants?: { w: number; fmt: 'avif' | 'webp'; url: string }[];
	alt: string;
	label: string;
}

// Room area name, ResDiary-style ("Front right section", "Middle", …); the diary
// timeline groups table rows by whatever's set. NOTE: in PocketBase `section` is a
// `select` field, so only values present in its allowed list can be saved — it is
// NOT free text despite the type below. The current allowed values are the generic
// presets plus the real Asia/Fusion sections (see the floor-editor's per-brand
// SECTION_PRESETS); add a new name to the geisha_tables.section select before
// assigning a table to it. The floor-editor's brand presets are the live source
// of suggested sections; this const is a generic fallback only.
export type TableSection = string;
export const SECTION_PRESETS = ['Main', 'Window', 'VIP', 'Bar', 'Outdoor'] as const;
export type TableShape = 'rect' | 'round' | 'square';

export interface DiningTable extends BaseRecord {
	restaurant: string;
	label: string; // 'T12'
	seats_min: number;
	seats_max: number;
	section: string; // free-text area name; '' = ungrouped
	bookable: boolean; // false = walk-in only
	x: number;
	y: number;
	width: number; // rendered px size (derived: width_cm * floor.px_per_cm)
	height: number;
	shape: TableShape | '';
	// Floor-planner geometry (added 1772700200). Optional for back-compat; the
	// booking engine ignores all of these.
	floor?: string; // -> Floor.id
	rotation?: number; // degrees, clockwise
	width_cm?: number; // canonical real-world size
	height_cm?: number;
}

export interface TableJoin extends BaseRecord {
	restaurant: string;
	table_a: string; // -> DiningTable.id
	table_b: string;
}

/** A physical floor of a restaurant; carries the drawing scale + room size. */
export interface Floor extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	name: string; // 'Ground floor'
	sort_order: number;
	width_cm: number; // room dimensions in cm
	height_cm: number;
	px_per_cm: number; // drawing scale (e.g. 0.5 => 1cm = 0.5px)
}

export type ShapeKind = 'wall' | 'zone' | 'label' | 'pillar' | 'bar' | 'blocked' | 'door';

/** A non-table element drawn on a floor: a wall, a zone, or a text label. */
export interface FloorShape extends BaseRecord {
	floor: string; // -> Floor.id
	kind: ShapeKind | '';
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number; // degrees
	label: string;
	color: string;
	// Added 1772700600 — polyline points for multi-segment walls: [[x,y],...].
	points?: unknown; // json
}

export interface Customer extends BaseRecord {
	name: string;
	email: string;
	phone: string;
	notes: string; // editor/html — AI/RAG reads this
	marketing_consent: boolean;
	// CRM fields added 1772700600. All optional / back-compat.
	restaurant?: string; // -> Restaurant.id (home brand)
	tags?: string[]; // json — free-form CRM tags
	vip?: boolean;
	dietary?: string[]; // json — structured dietary preferences
	allergies?: string;
	no_show_count?: number;
	cancel_count?: number;
	marketing_consent_source?: string;
	marketing_consent_at?: string; // ISO datetime of the last consent change (1772700700)
	deleted_at?: string; // ISO datetime; soft-delete / GDPR erasure marker
	/** The guest used "Stop feedback emails" (1786200000). Absent reads as false. */
	feedback_opt_out?: boolean;
}

export type BookingStatus =
	| 'pending_payment'
	| 'confirmed'
	| 'seated'
	| 'completed'
	| 'cancelled'
	| 'no_show';

export type BookingSource = 'online' | 'phone' | 'walkin' | 'ai';

/**
 * A bookable set menu in the catalogue stored in the geisha_settings row
 * `set_menus` (json array, one per brand — see /admin/settings/menus-preorder).
 * NOT the public content/menus CMS: this is the short list of pre-orderable set
 * menus offered at booking time. `pricePence` is per guest.
 */
export interface SetMenu {
	id: string;
	name: string;
	pricePence: number;
	courses?: string; // free-text summary, e.g. '5 courses · chef's selection'
}

/**
 * The pre-order snapshot persisted on a booking's optional `preorder` json field
 * (migration 1772700700). A snapshot (not just an id) so the run-sheet/kitchen
 * still shows the menu name + price even if the catalogue later changes. Absent /
 * empty means "no pre-order" — every reader MUST treat undefined as none, and the
 * whole feature degrades gracefully when the column hasn't been migrated yet.
 */
export interface BookingPreorder {
	id: string;
	name: string;
	pricePence: number;
	courses?: string;
}

export interface Booking extends BaseRecord {
	restaurant: string;
	customer: string; // -> Customer.id
	// Who THIS booking was made under (migration 1785500000). The customer record is
	// shared by every booking on the same email, so before these existed a repeat email
	// retroactively renamed the guest's earlier bookings. Optional/back-compat: absent
	// (pre-migration, or a legacy row) falls back to the customer record everywhere.
	guest_name?: string;
	guest_phone?: string;
	party_size: number;
	starts_at: string; // ISO datetime
	ends_at: string;
	tables: string[]; // multi-rel -> DiningTable.id[]
	service_period: string; // -> ServicePeriod.id
	status: BookingStatus;
	source: BookingSource | '';
	special_requests: string;
	occasion: string;
	// Amendment / risk / dietary fields added 1772700600. All optional.
	amended_from?: string; // -> Booking.id (this booking superseded that one)
	waitlist_origin?: string; // -> Waitlist.id (booking born from a waitlist offer)
	risk_score?: number; // float, 0..1 no-show risk
	risk_factors?: unknown; // json — explainability for risk_score
	dietary_flags?: unknown; // json — denormalised dietary/allergy summary
	// Set-menu pre-order snapshot added 1772700700. Optional/back-compat: absent
	// (column unmigrated, or no choice made) = no pre-order. See BookingPreorder.
	preorder?: BookingPreorder;
	// Diary-popover fields (ResDiary parity, MF-DIARY-TIMELINE). All optional &
	// back-compat — absent columns simply render as "—"/hidden in the popover.
	note_to_restaurant?: string; // guest's note shown to FOH (≠ customer.notes CRM history)
	promotion?: string; // promotion / booking-code label, e.g. 'Standard Booking'
	channel?: string; // booking channel label (Online, Internal, Walk-in) for the colour square
	confirm_attempts?: number; // how many times staff tried to confirm (0 = none)
	leave_time_confirmed?: boolean; // true once the leave time is agreed with the guest
	// ResDiary parity (diary phase 1). Both optional/back-compat — absent columns
	// (pre-migration 1772701400) read as false everywhere.
	confirmed?: boolean; // staff/guest explicitly confirmed the booking (Confirmation colour scheme)
	seen_by_staff?: boolean; // the "new booking" bell has been acknowledged for this booking
	// ResDiary parity (diary phase 4, migration 1772701500). A transient PRE-seating
	// holding state set from the diary popover's left status menu; '' = normal. Cleared
	// when the party is seated/cleared/no-show. Absent column reads as '' everywhere.
	// NOTE: floor_status is a plain TEXT column, so seatBooking's partial path also writes
	// a POST-seating marker value 'partially_seated' (kept out of this union so the
	// narrower BookingView.floorStatus consumer still type-checks; read via a string
	// compare in arrivalStatusOf). It lets a SINGLE-table booking read as "Partially
	// Seated" in the diary, which has no seatedCount<tableCount signal of its own.
	floor_status?: '' | 'waiting_bar' | 'table_ready';
}

export type PaymentKind = 'deposit' | 'noshow_hold';
export type PaymentStatus =
	| 'Created'
	| 'Authorized'
	| 'Captured'
	| 'Reversed'
	| 'Refunded'
	| 'Canceled';

export interface Payment extends BaseRecord {
	booking: string; // -> Booking.id
	dojo_payment_intent_id: string;
	kind: PaymentKind | '';
	amount: number; // pence
	status: PaymentStatus | '';
	captured_at: string;
	reversed_at: string;
}

export interface FloorState extends BaseRecord {
	booking: string; // -> Booking.id
	table: string; // -> DiningTable.id
	seated_at: string;
	cleared_at: string;
}

export type AuditActor = 'staff' | 'ai' | 'system' | 'customer';

export interface AuditLog extends BaseRecord {
	actor: AuditActor | '';
	action: string;
	entity: string;
	entity_id: string;
	before: unknown;
	after: unknown;
	// Added 1772700600 — staff id an AI/system action was performed on behalf of.
	on_behalf_of?: string;
}

// ============================================================================
// Plan foundation (F2) — collections added in 1772700600.
// ============================================================================

export type StaffRole = 'owner' | 'manager' | 'host' | 'server';

/**
 * A staff account. Base collection (NOT a PocketBase auth collection); the F1
 * auth layer owns password hashing/verification and session issuance, reading
 * `password_hash` here. `restaurants` scopes which brands a member can act on.
 */
export interface Staff extends BaseRecord {
	email: string;
	name: string;
	role: StaffRole | '';
	restaurants: string[]; // multi-rel -> Restaurant.id[]
	active: boolean;
	password_hash: string;
}

export type ClosureScope = 'full' | 'period' | 'section';
export type ClosureKind = 'holiday' | 'private_hire' | 'maintenance';
/** ResDiary "Type": which booking channel a close-out blocks. */
export type ClosureChannel = 'common' | 'internal' | 'online';

/** A full-day, per-period or per-section closure across a (single-day) date range. */
export interface Closure extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	date_from: string; // ISO date
	date_to: string; // ISO date (blank = single day)
	scope: ClosureScope | '';
	service_period?: string; // -> ServicePeriod.id (when scope = 'period' | 'section')
	section?: string; // floor-section name (section-scope, whole-section close-out)
	table?: string; // -> DiningTable.id (section-scope, single-table close-out)
	time_from?: string; // 'HH:mm' sub-window start (section-scope, optional)
	time_to?: string; // 'HH:mm' sub-window end (section-scope, optional)
	reason: string; // ResDiary "Description"
	kind: ClosureKind | '';
	// ResDiary "Add New Period" parity fields (migration 1785400000):
	name?: string; // ResDiary "Name" — short label
	days_of_week?: number[]; // json [0..6] (0=Sun); empty = every day in range (one-off)
	channel_type?: ClosureChannel; // ResDiary "Type"; default 'common'
	colour?: string; // hex colour for the diary block (ResDiary "Colour")
}

/** Pacing controls: covers caps, lead time and booking window per period/dow. */
export interface PacingRule extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	service_period?: string; // -> ServicePeriod.id (blank = restaurant-wide)
	dow: number[]; // json [0..6]; empty = all days
	max_covers_per_slot: number;
	max_covers_per_period: number;
	lead_time_minutes: number;
	booking_window_days: number;
}

/**
 * Alias used by the admin CRUD layer (WP-AVAIL-4) for a persisted pacing-rule
 * row. Same shape as {@link PacingRule}; the distinct name keeps admin code
 * readable alongside the engine's pure `PacingRule` (pacing.ts) type.
 */
export type PacingRuleRow = PacingRule;

export type DepositKind = 'deposit' | 'noshow_hold' | 'none';
export type DepositCapture = 'auto' | 'manual';

/**
 * A priority-ordered deposit / no-show-hold policy rule. Lowest `priority`
 * matching the (party size, dow, date, period) wins. date_from/date_to optional
 * for seasonal overrides; party_max 0 = no upper bound.
 */
export interface DepositRule extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	priority: number;
	service_period?: string; // -> ServicePeriod.id (blank = any period)
	party_min: number;
	party_max: number; // 0 = unbounded
	dow: number[]; // json [0..6]; empty = all days
	date_from?: string; // ISO date
	date_to?: string; // ISO date
	kind: DepositKind | '';
	per_person_pence: number;
	capture: DepositCapture | '';
	/** Optional promotion this rule belongs to (id in $lib/data/promotions). When
	 *  set, a matched booking is stamped with the promotion and its T&C wording is
	 *  shown to the guest before they pay. Blank = a bare deposit rule. */
	promotion?: string;
}

export type WaitlistStatus = 'waiting' | 'offered' | 'claimed' | 'expired' | 'cancelled';

/** A waitlist entry and its offer lifecycle. */
export interface Waitlist extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	customer: string; // -> Customer.id
	date: string; // ISO date the guest wants
	party_size: number;
	window_from: string; // ISO datetime — earliest acceptable
	window_to: string; // ISO datetime — latest acceptable
	status: WaitlistStatus | '';
	notified_at?: string; // ISO datetime an offer was sent
}

export type MessageChannel = 'email' | 'sms';
export type MessageStatus =
	| 'draft' // mf-guest-comms: AI-drafted, awaiting staff review
	| 'approved' // mf-guest-comms: reviewed, cleared to send on the next sweep
	| 'queued'
	| 'sent'
	| 'failed'
	| 'skipped'
	| 'delivered'
	| 'bounced';

/** An outbound guest message (email/SMS) and its delivery state. */
export interface Message extends BaseRecord {
	booking?: string; // -> Booking.id (optional; some messages are customer-level)
	customer: string; // -> Customer.id
	channel: MessageChannel | '';
	template: string;
	status: MessageStatus | '';
	subject: string;
	body: string; // editor/html
	scheduled_for?: string; // ISO datetime
	sent_at?: string; // ISO datetime
}

/** An AI-derived score/payload keyed to an arbitrary subject (e.g. a customer). */
export interface AiInsight extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	kind: string; // e.g. 'churn_risk' | 'upsell' | 'segment'
	subject_id: string; // id of the subject the insight is about
	score: number; // float
	payload: unknown; // json
}

/** An operational alert raised when a metric crosses a threshold. */
export interface Alert extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	kind: string;
	metric: string;
	severity: string;
	window: string;
	message: string;
	acknowledged: boolean;
}

/** An aggregated review with sentiment/themes (sourced or first-party). */
/** How far along a contact-form enquiry is. */
export type EnquiryStatus = 'new' | 'replied' | 'closed';

/**
 * One message from the public Contact page. Guest-supplied and unverified —
 * `name`/`email`/`subject`/`message` are whatever was typed into the form, so
 * every reader must treat them as untrusted text (never as HTML).
 */
export interface Enquiry extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	name: string;
	email: string;
	subject?: string;
	message?: string;
	status?: EnquiryStatus | '';
	handled_by?: string; // -> Staff.id
	handled_at?: string; // ISO datetime
	source?: string; // 'contact_form'
}

export interface Review extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	source: string; // e.g. 'google' | 'tripadvisor' | 'first_party'
	rating: number; // float (e.g. 4.5)
	text: string; // editor/html
	author: string;
	posted_at: string; // ISO datetime
	customer?: string; // -> Customer.id (when matched)
	sentiment: string;
	themes: unknown; // json
	/** mf-review-sentiment additive fields (migration 1772701200): */
	reply?: string; // editor — confirmed/published reply text
	reply_status?: string; // '' | 'draft' | 'published'
	analyzed_at?: string; // ISO datetime — when sentiment/themes last computed
}

/**
 * A guest's 0–5 answer to the post-visit email (1786200000). One row per booking;
 * a re-submit from the same link updates it.
 */
export interface GuestFeedback extends BaseRecord {
	restaurant: string; // -> Restaurant.id
	booking: string; // -> Booking.id (unique)
	score: number; // 0..5 — 0 is a real answer, never "blank"
	comment: string;
	visit_at: string; // ISO datetime — the booking's starts_at
	submitted_at: string; // ISO datetime
	/** Unused: staff low-score alerts were removed. The column is left in place. */
	alerted_at?: string;
	source: string; // 'email'
}

/**
 * An advisory lock row backing the multi-instance booking lock (replacing the
 * in-process Map in create.ts). `key` is unique; holders renew/expire via
 * `expires_at`.
 */
export interface Lock extends BaseRecord {
	key: string;
	holder: string;
	expires_at: string; // ISO datetime
}
