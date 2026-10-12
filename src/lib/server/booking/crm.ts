// CRM helpers — phone normalisation + a one-off restaurant backfill.
//
// Kept separate from admin.ts so the CRM/dedupe logic doesn't bloat the admin
// surface (see IMPLEMENTATION_PLAN.md WP-CRM-1, conflict-resolution note 2:
// "S5 moves CRM logic into a new crm.ts and only touches queries.ts
// upsertCustomer"). Server-only (the backfill talks to the superuser client).

import { error } from '@sveltejs/kit';
import { pb } from '../db/pb.js';
import type { AuditActor, Booking, BrandId, Customer, Payment } from '../db/types.js';
import { getRestaurant } from './queries.js';
import { writeAudit } from './audit.js';
import { toCsv } from './reporting.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/**
 * Normalise a phone number to a comparable canonical form so that dedupe by
 * phone is stable regardless of how the guest typed it.
 *
 * Rules (GB-centric, the restaurants' only market):
 *  - strip every character that isn't a digit or a leading "+"
 *  - a GB national number ("0…") becomes "+44…" (drop the trunk 0)
 *  - an already-international "+…" is kept (digits only after the "+")
 *  - anything that ends up empty / has no digits returns "" (not matchable)
 *
 * This is deliberately conservative: it canonicalises the common UK shapes but
 * never throws and never invents a country code for a bare local number that
 * doesn't start with 0 — those are returned digits-only so an exact re-entry
 * still matches itself.
 */
export function normalizePhone(raw: string): string {
	if (!raw) return '';
	const trimmed = raw.trim();
	// Keep a single leading "+", then strip everything that isn't a digit.
	const hasPlus = trimmed.startsWith('+');
	const digits = trimmed.replace(/[^\d]/g, '');
	if (!digits) return '';
	if (hasPlus) {
		// Already international: normalise a "+440…" trunk artefact too.
		if (digits.startsWith('440')) return `+44${digits.slice(3)}`;
		return `+${digits}`;
	}
	// National GB number: trunk 0 -> +44.
	if (digits.startsWith('0')) return `+44${digits.slice(1)}`;
	// Bare local / unknown shape: return digits so an identical re-entry matches.
	return digits;
}

/**
 * One-off maintenance helper (NOT a migration) that stamps a `restaurant` on
 * any legacy customer row that predates per-brand scoping. For each orphan we
 * look at their most recent booking and adopt that booking's restaurant.
 * Customers with no bookings can't be auto-assigned and are returned in
 * `orphaned` for an owner to resolve by hand.
 *
 * Wired to a tiny owner-only `?/backfill` form action on the customers page
 * (see WP-CRM-1 step 6) — it must stay off the droplet's migration path.
 */
export async function backfillCustomerRestaurants(): Promise<{
	updated: number;
	orphaned: string[];
}> {
	const c = await pb();
	// Only rows missing a restaurant; soft-deleted rows are left untouched.
	const customers = await c.collection('geisha_customers').getFullList<Customer>({
		filter: `(restaurant='' || restaurant=null) && deleted_at=''`
	});

	let updated = 0;
	const orphaned: string[] = [];

	for (const cust of customers) {
		let latest: Booking | null = null;
		try {
			latest = await c.collection('geisha_bookings').getFirstListItem<Booking>(
				`customer="${cust.id.replace(/"/g, '\\"')}"`,
				{ sort: '-starts_at' }
			);
		} catch {
			latest = null; // no bookings -> can't infer a brand
		}

		if (latest?.restaurant) {
			await c.collection('geisha_customers').update(cust.id, { restaurant: latest.restaurant });
			updated++;
		} else {
			orphaned.push(cust.id);
		}
	}

	if (orphaned.length) {
		console.warn(
			`[crm] backfillCustomerRestaurants: ${orphaned.length} customer(s) have no bookings and were left unassigned:`,
			orphaned
		);
	}

	return { updated, orphaned };
}

// ===========================================================================
// WP-CRM-2 — guest profile: aggregated history, risk counters, structured
// dietary / allergy / VIP / tags.
// ===========================================================================

/**
 * Structured dietary preferences stored in the `dietary` json field. Distinct
 * from `allergies` (a free-text, safety-critical line shown prominently): these
 * are non-urgent preferences the AI and kitchen use for menu guidance.
 */
export interface DietaryFlags {
	vegetarian?: boolean;
	vegan?: boolean;
	pescatarian?: boolean;
	glutenFree?: boolean;
	dairyFree?: boolean;
	nutAllergy?: boolean;
	halal?: boolean;
	other?: string;
}

/** Editable fields of a customer profile (all optional — a partial patch). */
export interface CustomerPatch {
	name?: string;
	email?: string;
	phone?: string;
	vip?: boolean;
	tags?: string[];
	dietary?: DietaryFlags;
	allergies?: string;
	notes?: string;
}

/** A guest's lifetime aggregate stats. */
export interface CustomerStats {
	totalBookings: number;
	completed: number;
	cancelled: number;
	noShows: number;
	upcoming: number;
	totalCovers: number;
	firstVisit?: string;
	lastVisit?: string;
	favouriteOccasion?: string;
	avgPartySize: number;
}

export type RiskLevel = 'low' | 'watch' | 'high';

export interface CustomerRisk {
	noShowRate: number;
	cancelRate: number;
	level: RiskLevel;
}

/** Everything the profile page (and the AI tool) needs for one guest. */
export interface CustomerProfile {
	customer: Customer;
	bookings: Booking[];
	stats: CustomerStats;
	risk: CustomerRisk;
}

// --- tunable risk thresholds (named so they're adjustable without code-spelunking) ---
/** A no-show count at/above this is always 'high'. */
const RISK_HIGH_NOSHOW_COUNT = 2;
/** A no-show RATE above this (with a minimum sample) is 'high'. */
const RISK_HIGH_NOSHOW_RATE = 0.25;
/** Minimum bookings before a rate (not a raw count) can trip 'high'. */
const RISK_RATE_MIN_BOOKINGS = 4;
/** A cancel RATE above this is at least 'watch'. */
const RISK_WATCH_CANCEL_RATE = 0.3;

/** "Completed/attended" statuses (a guest who actually turned up). */
const ATTENDED_STATUSES = new Set(['seated', 'completed']);
/** Statuses that represent a still-live future visit. */
const UPCOMING_STATUSES = new Set(['pending_payment', 'confirmed']);

/**
 * Compute the lifetime stats + risk aggregate for a flat list of a guest's
 * bookings. Pure (no PB) so the maths is unit-testable in isolation.
 *
 * risk.level rules (see plan WP-CRM-2 step 1):
 *  - high  : noShows >= 2  OR  (noShowRate > 0.25 with >= 4 bookings)
 *  - watch : noShows === 1 OR  cancelRate > 0.3
 *  - low   : otherwise
 */
export function aggregateCustomer(bookings: Booking[]): {
	stats: CustomerStats;
	risk: CustomerRisk;
} {
	const total = bookings.length;
	let completed = 0;
	let cancelled = 0;
	let noShows = 0;
	let upcoming = 0;
	let totalCovers = 0;
	let attendedParties = 0;

	let firstVisit: string | undefined;
	let lastVisit: string | undefined;
	const occasionCounts = new Map<string, number>();

	for (const b of bookings) {
		switch (b.status) {
			case 'completed':
				completed++;
				break;
			case 'cancelled':
				cancelled++;
				break;
			case 'no_show':
				noShows++;
				break;
			default:
				if (UPCOMING_STATUSES.has(b.status)) upcoming++;
		}

		// Covers / party-size average count only genuinely-attended visits.
		if (ATTENDED_STATUSES.has(b.status)) {
			totalCovers += b.party_size || 0;
			attendedParties++;
			const when = b.starts_at;
			if (when) {
				if (!firstVisit || when < firstVisit) firstVisit = when;
				if (!lastVisit || when > lastVisit) lastVisit = when;
			}
			const occ = (b.occasion || '').trim();
			if (occ) occasionCounts.set(occ, (occasionCounts.get(occ) ?? 0) + 1);
		}
	}

	let favouriteOccasion: string | undefined;
	let best = 0;
	for (const [occ, n] of occasionCounts) {
		if (n > best) {
			best = n;
			favouriteOccasion = occ;
		}
	}

	const noShowRate = total > 0 ? noShows / total : 0;
	const cancelRate = total > 0 ? cancelled / total : 0;

	let level: RiskLevel = 'low';
	if (
		noShows >= RISK_HIGH_NOSHOW_COUNT ||
		(total >= RISK_RATE_MIN_BOOKINGS && noShowRate > RISK_HIGH_NOSHOW_RATE)
	) {
		level = 'high';
	} else if (noShows === 1 || cancelRate > RISK_WATCH_CANCEL_RATE) {
		level = 'watch';
	}

	return {
		stats: {
			totalBookings: total,
			completed,
			cancelled,
			noShows,
			upcoming,
			totalCovers,
			firstVisit,
			lastVisit,
			favouriteOccasion,
			avgPartySize: attendedParties > 0 ? totalCovers / attendedParties : 0
		},
		risk: { noShowRate, cancelRate, level }
	};
}

/**
 * Load one guest's full profile for the admin profile page (and the AI tool).
 * 404s a soft-deleted guest (deleted_at != '') so erased data never resurfaces.
 * Brand-scopes: a customer carrying a foreign `restaurant` is treated as
 * not-found for this brand (legacy rows with no restaurant are allowed through).
 */
export async function getCustomerProfile(
	brand: BrandId,
	customerId: string
): Promise<CustomerProfile> {
	const c = await pb();
	let customer: Customer;
	try {
		customer = await c.collection('geisha_customers').getOne<Customer>(customerId);
	} catch {
		throw error(404, 'Guest not found.');
	}
	if (customer.deleted_at) throw error(404, 'Guest not found.');

	// Brand scoping: reject a customer that belongs to the OTHER restaurant. Rows
	// predating per-brand scoping (no restaurant) are allowed through.
	if (customer.restaurant) {
		const restaurant = await getRestaurant(brand);
		if (customer.restaurant !== restaurant.id) throw error(404, 'Guest not found.');
	}

	const bookings = await c
		.collection('geisha_bookings')
		.getFullList<Booking>({ filter: `customer=${q(customerId)}`, sort: '-starts_at' });

	const { stats, risk } = aggregateCustomer(bookings);
	return { customer, bookings, stats, risk };
}

/**
 * Update the editable structured fields of a customer profile. Writes via PB and
 * records an audit row (actor + on_behalf_of so an automated/staff edit is
 * attributable). Only keys present in `patch` are written.
 */
export async function updateCustomerProfile(
	brand: BrandId,
	id: string,
	patch: CustomerPatch,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Customer> {
	const c = await pb();
	const before = await c.collection('geisha_customers').getOne<Customer>(id);
	if (before.deleted_at) throw error(404, 'Guest not found.');

	const data: Record<string, unknown> = {};
	if (patch.name !== undefined) data.name = patch.name;
	if (patch.email !== undefined) data.email = patch.email;
	if (patch.phone !== undefined) data.phone = patch.phone;
	if (patch.vip !== undefined) data.vip = patch.vip;
	if (patch.tags !== undefined) data.tags = patch.tags;
	if (patch.dietary !== undefined) data.dietary = dietaryToArray(patch.dietary);
	if (patch.allergies !== undefined) data.allergies = patch.allergies;
	if (patch.notes !== undefined) data.notes = patch.notes;

	const after = await c.collection('geisha_customers').update<Customer>(id, data);
	await writeAudit(actor, 'update_customer', 'geisha_customers', id, before, after, onBehalfOf);
	return after;
}

/**
 * Recount a guest's no_show_count and cancel_count from their bookings and write
 * them back (denormalised for fast list rendering + the AI). Called from
 * mutate.ts after a no-show / cancel so the counters stay live. Best-effort: a
 * failure here must never block the underlying booking write.
 */
export async function recomputeCustomerCounters(customerId: string): Promise<void> {
	if (!customerId) return;
	try {
		const c = await pb();
		const bookings = await c
			.collection('geisha_bookings')
			.getFullList<Booking>({ filter: `customer=${q(customerId)}` });
		const no_show_count = bookings.filter((b) => b.status === 'no_show').length;
		const cancel_count = bookings.filter((b) => b.status === 'cancelled').length;
		await c.collection('geisha_customers').update(customerId, { no_show_count, cancel_count });
	} catch (err) {
		console.error('[crm] recomputeCustomerCounters failed:', err);
	}
}

// --- DietaryFlags <-> stored array (the `dietary` json field is string[]) ----

/** The stable key order of the boolean dietary flags. */
const DIETARY_KEYS: Array<keyof Omit<DietaryFlags, 'other'>> = [
	'vegetarian',
	'vegan',
	'pescatarian',
	'glutenFree',
	'dairyFree',
	'nutAllergy',
	'halal'
];

/**
 * Serialise DietaryFlags into the string[] stored in `dietary`. Each true flag is
 * stored as its key; a non-empty `other` is stored as 'other:<text>'. This keeps
 * the field a simple json array (back-compat with WP-CRM-1's free-form list) while
 * round-tripping the structured object.
 */
export function dietaryToArray(flags: DietaryFlags): string[] {
	const out: string[] = [];
	for (const k of DIETARY_KEYS) if (flags[k]) out.push(k);
	if (flags.other && flags.other.trim()) out.push(`other:${flags.other.trim()}`);
	return out;
}

/** Parse the stored `dietary` array back into a DietaryFlags object. */
export function arrayToDietary(arr: string[] | undefined): DietaryFlags {
	const flags: DietaryFlags = {};
	if (!Array.isArray(arr)) return flags;
	for (const raw of arr) {
		if (typeof raw !== 'string') continue;
		if (raw.startsWith('other:')) {
			flags.other = raw.slice('other:'.length);
			continue;
		}
		if ((DIETARY_KEYS as string[]).includes(raw)) {
			flags[raw as keyof Omit<DietaryFlags, 'other'>] = true;
		}
	}
	return flags;
}

// ===========================================================================
// Blocked guests — the "No show - Block user" cancellation outcome.
// ===========================================================================

/**
 * The CRM tag that marks a guest as BLOCKED from booking online.
 *
 * Stored as an ordinary tag rather than a new column so it needs NO PocketBase
 * migration and is visible/removable where staff already manage a guest: the tag
 * chips on the profile (plus the explicit Block/Unblock button there). Matched
 * case-insensitively so a hand-typed "Blocked" chip blocks too.
 */
export const BLOCKED_TAG = 'blocked';

/** Is this guest blocked from booking online? */
export function isCustomerBlocked(customer: Pick<Customer, 'tags'> | null | undefined): boolean {
	return (customer?.tags ?? []).some((t) => t.trim().toLowerCase() === BLOCKED_TAG);
}

/**
 * Block / unblock a guest (adds or removes {@link BLOCKED_TAG}), audited.
 *
 * Blocking only stops ONLINE self-service bookings — staff can always still take
 * the party on the phone or as a walk-in (that's a judgement call at the pass, and
 * the diary shows the tag). Returns the updated customer, or null when there is no
 * customer to update (e.g. an anonymous walk-in with no record).
 */
export async function setCustomerBlocked(
	customerId: string,
	blocked: boolean,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Customer | null> {
	if (!customerId) return null;
	const c = await pb();
	const before = await c.collection('geisha_customers').getOne<Customer>(customerId);
	const tags = before.tags ?? [];
	const without = tags.filter((t) => t.trim().toLowerCase() !== BLOCKED_TAG);
	const next = blocked ? [...without, BLOCKED_TAG] : without;
	// Idempotent: nothing to write (and nothing to audit) if the state already matches.
	if (next.length === tags.length && isCustomerBlocked(before) === blocked) return before;

	const after = await c.collection('geisha_customers').update<Customer>(customerId, { tags: next });
	await writeAudit(
		actor,
		blocked ? 'block_customer' : 'unblock_customer',
		'geisha_customers',
		customerId,
		{ tags },
		{ tags: next },
		onBehalfOf
	);
	return after;
}

/**
 * Is the contact behind an incoming ONLINE booking blocked?
 *
 * Mirrors upsertCustomer's identity keys (email first, phone as the secondary
 * key) so the guard catches the same record the booking would have been attached
 * to. Best-effort: any lookup failure returns false — a CRM hiccup must never
 * stop a legitimate booking.
 */
export async function isBlockedContact(email: string, phone?: string): Promise<boolean> {
	const em = (email ?? '').trim();
	const ph = (phone ?? '').trim();
	const clauses: string[] = [];
	if (em) clauses.push(`email=${q(em)}`);
	if (ph) clauses.push(`phone=${q(ph)}`);
	if (!clauses.length) return false;
	try {
		const c = await pb();
		const rows = await c
			.collection('geisha_customers')
			.getFullList<Customer>({ filter: clauses.join(' || ') });
		const phKey = normalizePhone(ph);
		return rows.some(
			(r) =>
				!r.deleted_at &&
				isCustomerBlocked(r) &&
				((!!em && (r.email ?? '').trim().toLowerCase() === em.toLowerCase()) ||
					(!!phKey && normalizePhone(r.phone ?? '') === phKey))
		);
	} catch (err) {
		console.error('[crm] isBlockedContact lookup failed:', err);
		return false;
	}
}

/** Strip HTML tags + collapse whitespace so the AI gets plain notes, not markup. */
export function stripHtml(html: string | undefined): string {
	if (!html) return '';
	return html
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

// ===========================================================================
// WP-CRM-3 — marketing consent + provenance, opt-in segmentation export.
// ===========================================================================

/**
 * Set a guest's marketing consent, stamping WHERE it came from (`source`) and
 * WHEN (marketing_consent_at = now). Audited as 'marketing_consent'. When consent
 * is withdrawn we clear the timestamp (no live consent => no consent date) but
 * keep the source for the audit trail.
 */
export async function setMarketingConsent(
	brand: BrandId,
	customerId: string,
	consent: boolean,
	source: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Customer> {
	const c = await pb();
	const before = await c.collection('geisha_customers').getOne<Customer>(customerId);
	if (before.deleted_at) throw error(404, 'Guest not found.');

	const after = await c.collection('geisha_customers').update<Customer>(customerId, {
		marketing_consent: consent,
		marketing_consent_source: source,
		// Only a live opt-in carries a consent timestamp.
		marketing_consent_at: consent ? new Date().toISOString() : ''
	});
	await writeAudit(
		actor,
		'marketing_consent',
		'geisha_customers',
		customerId,
		{ consent: before.marketing_consent },
		{ consent, source },
		onBehalfOf
	);
	return after;
}

/** One opted-in row in the marketing export. */
export interface MarketingSegmentRow {
	name: string;
	email: string;
	tags: string[];
	vip: boolean;
	consentSource: string;
	consentAt: string;
}

/**
 * Build the opted-in marketing segment for a brand as both structured rows and a
 * ready-to-download CSV. Selects marketing_consent=true, non-deleted, brand-scoped
 * customers. VIP filtering is done in-query; tag filtering is post-fetch (the
 * `tags` json array can't be reliably membership-filtered in PocketBase — fine at
 * two-restaurant scale, documented in the plan).
 */
export async function exportMarketingSegment(
	brand: BrandId,
	filter?: { vipOnly?: boolean; tags?: string[] }
): Promise<{ rows: MarketingSegmentRow[]; csv: string }> {
	const c = await pb();
	const restaurant = await getRestaurant(brand);

	const clauses = [
		`marketing_consent=true`,
		`deleted_at=''`,
		`restaurant=${q(restaurant.id)}`
	];
	if (filter?.vipOnly) clauses.push(`vip=true`);

	const customers = await c
		.collection('geisha_customers')
		.getFullList<Customer>({ filter: clauses.join(' && '), sort: 'name' });

	const wantTags = (filter?.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
	const filtered = wantTags.length
		? customers.filter((cu) => {
				const have = (cu.tags ?? []).map((t) => t.toLowerCase());
				return wantTags.every((t) => have.includes(t));
			})
		: customers;

	const rows: MarketingSegmentRow[] = filtered.map((cu) => ({
		name: cu.name,
		email: cu.email,
		tags: cu.tags ?? [],
		vip: cu.vip ?? false,
		consentSource: cu.marketing_consent_source ?? '',
		consentAt: cu.marketing_consent_at ?? ''
	}));

	const csv = toCsv(
		['Name', 'Email', 'Tags', 'VIP', 'Consent source', 'Consent at'],
		rows.map((r) => [r.name, r.email, r.tags.join('; '), r.vip ? 'yes' : 'no', r.consentSource, r.consentAt])
	);

	return { rows, csv };
}

// ===========================================================================
// WP-CRM-4 — GDPR data export + right-to-erasure.
// ===========================================================================

/**
 * Load one customer, brand-scoped, for a GDPR operation. Unlike
 * getCustomerProfile this does NOT 404 a soft-deleted row (erasure must stay
 * idempotent and an already-erased row is still exportable for the audit trail);
 * the caller decides what to do with `deleted_at`. A foreign-brand customer is
 * 404'd exactly as elsewhere; legacy rows with no restaurant are allowed.
 */
async function loadScopedCustomer(brand: BrandId, customerId: string): Promise<Customer> {
	const c = await pb();
	let customer: Customer;
	try {
		customer = await c.collection('geisha_customers').getOne<Customer>(customerId);
	} catch {
		throw error(404, 'Guest not found.');
	}
	if (customer.restaurant) {
		const restaurant = await getRestaurant(brand);
		if (customer.restaurant !== restaurant.id) throw error(404, 'Guest not found.');
	}
	return customer;
}

/** The full GDPR subject-access bundle for one guest (everything we hold). */
export interface CustomerDataExport {
	exportedAt: string;
	brand: BrandId;
	customer: Customer;
	bookings: Booking[];
	payments: Payment[];
}

/**
 * Build a guest's complete data-export bundle for a GDPR subject-access request:
 * the customer row plus every booking and every payment attached to those
 * bookings. Returned as a structured object (the route serialises to JSON); the
 * export itself is audited as 'gdpr_export' so we can prove the request was
 * fulfilled. Works on an already-erased row too (the scrubbed data is what we
 * still hold). Gated owner/manager at the route via the `crm` capability.
 */
export async function exportCustomerData(
	brand: BrandId,
	customerId: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<CustomerDataExport> {
	const c = await pb();
	const customer = await loadScopedCustomer(brand, customerId);

	const bookings = await c
		.collection('geisha_bookings')
		.getFullList<Booking>({ filter: `customer=${q(customerId)}`, sort: '-starts_at' });

	// Payments are keyed by booking, not customer — gather across this guest's
	// bookings (best-effort per booking so one missing relation can't blank the
	// whole export).
	const payments: Payment[] = [];
	for (const b of bookings) {
		try {
			const ps = await c
				.collection('geisha_payments')
				.getFullList<Payment>({ filter: `booking=${q(b.id)}`, sort: 'created' });
			payments.push(...ps);
		} catch (err) {
			console.error(`[crm] exportCustomerData: payments for booking ${b.id} failed:`, err);
		}
	}

	await writeAudit(
		actor,
		'gdpr_export',
		'geisha_customers',
		customerId,
		null,
		{ brand, bookings: bookings.length, payments: payments.length },
		onBehalfOf
	);

	return {
		exportedAt: new Date().toISOString(),
		brand,
		customer,
		bookings,
		payments
	};
}

/** The redacted placeholder left in scrubbed PII fields. */
const ERASED_PLACEHOLDER = '[erased]';

/**
 * Right-to-erasure: soft-delete a guest (stamp `deleted_at`) and scrub their PII
 * in place, keeping the row so booking/payment financial records and the audit
 * trail stay referentially intact (we retain aggregate, non-identifying history
 * for legitimate accounting — only the personal data is removed).
 *
 * Scrubbed: name, email, phone, notes, allergies, dietary, tags, and the
 * marketing-consent provenance. Counters and risk fields are non-identifying and
 * left as-is. Idempotent — erasing an already-erased guest is a no-op that still
 * returns the row. Audited as 'gdpr_erase' with a redacted before-snapshot (we
 * never copy the cleartext PII into the audit `after`). Gated owner/manager.
 */
export async function eraseCustomer(
	brand: BrandId,
	customerId: string,
	actor: AuditActor = 'staff',
	onBehalfOf?: string
): Promise<Customer> {
	const c = await pb();
	const before = await loadScopedCustomer(brand, customerId);

	// Idempotent: already erased -> return as-is without a second audit row.
	if (before.deleted_at) return before;

	const scrub = {
		name: ERASED_PLACEHOLDER,
		email: '',
		phone: '',
		notes: '',
		allergies: '',
		dietary: [] as string[],
		tags: [] as string[],
		vip: false,
		marketing_consent: false,
		marketing_consent_source: '',
		marketing_consent_at: '',
		deleted_at: new Date().toISOString()
	};

	const after = await c.collection('geisha_customers').update<Customer>(customerId, scrub);

	// Audit WITHOUT the cleartext PII — record only that an erasure happened and
	// which fields were cleared, so the log itself isn't a PII leak.
	await writeAudit(
		actor,
		'gdpr_erase',
		'geisha_customers',
		customerId,
		{ had: { name: !!before.name, email: !!before.email, phone: !!before.phone } },
		{ erased_at: scrub.deleted_at },
		onBehalfOf
	);

	return after;
}
