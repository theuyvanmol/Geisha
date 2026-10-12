// Booking history — ResDiary's "Booking History" window, rebuilt on our own
// audit trail.
//
// The owner's ask: "we want to see all steps, including the customer's changes,
// just like ResDiary". ResDiary shows a newest-first table of
// Date · User · Event · Description, where Description is a field-level diff
// ("Tables changed From 27 to 3.", "Arrival Status changed From Not Arrived to
// Fully Seated.") and a guest's own self-service edits appear under the user
// `guest`.
//
// We already record everything needed: geisha_audit_log stores the full before/
// after booking snapshot on every write, and the actor ('staff' / 'ai' /
// 'system' / 'customer'). What was missing was the READ side. This module is it.
//
// Split deliberately in two:
//   - describeAuditRow / buildBookingHistory — PURE. All the interesting logic
//     (what changed, how it is worded, who did it) is a plain function of an
//     audit row plus two lookup maps, so it is unit-testable without a database.
//   - getBookingHistory — the thin PocketBase shell that fetches the rows and
//     builds those maps.
//
// Scope is deliberately ResDiary's: booking-field changes only. Money lives on
// the deposits panel and emails on the comms surface; duplicating them here
// would make the timeline longer without making it clearer.

import { pb } from '../db/pb.js';
import type { AuditLog, DiningTable, Restaurant, Staff } from '../db/types.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

const LONDON = 'Europe/London';

export type HistoryEventKind =
	| 'Made'
	| 'Modified'
	| 'Cancelled'
	| 'No Show'
	| 'Reinstated'
	| 'Expired';

export interface HistoryEvent {
	/** ISO timestamp of the audit row (the moment the change landed). */
	at: string;
	/** Who did it: a staff name, 'guest', 'system', 'assistant', or 'staff'. */
	user: string;
	event: HistoryEventKind;
	/** One sentence per changed field, ResDiary's wording. May be empty. */
	descriptions: string[];
}

export interface HistoryLookups {
	/** geisha_staff id -> display name, for the User column. */
	staffNames: Map<string, string>;
	/** geisha_tables id -> label ('27'), so a diff never shows raw record ids. */
	tableLabels: Map<string, string>;
	/** geisha_restaurants id -> display name, for a booking moved between venues. */
	venueNames?: Map<string, string>;
}

// --- wording ----------------------------------------------------------------

/**
 * Our status column in ResDiary's words. `pending_payment` is its "Table Hold"
 * — a booking held while the card step completes — and `confirmed` its "Booked",
 * which is exactly the transition the owner's screenshot shows a guest making.
 */
const STATUS_LABEL: Record<string, string> = {
	pending_payment: 'Table Hold',
	confirmed: 'Booked',
	seated: 'Seated',
	completed: 'Finished',
	cancelled: 'Cancelled',
	no_show: 'No Show'
};

/** The left status menu's arrival states, worded as in BookingCard.svelte. */
const ARRIVAL_NOT_ARRIVED = 'Not Arrived';

/**
 * Derive ResDiary's "Arrival Status" from a booking snapshot. It is not a column
 * of its own: it falls out of the status plus the transient floor_status holding
 * state, so both sides of a diff can be computed from the audited snapshots
 * without consulting geisha_floor_state.
 */
function arrivalStatus(snap: Record<string, unknown>): string {
	const status = String(snap.status ?? '');
	const floor = String(snap.floor_status ?? '');
	if (status === 'seated') {
		return floor === 'partially_seated' ? 'Partially Seated' : 'Fully Seated';
	}
	if (status === 'completed') return 'Finished';
	if (status === 'no_show') return 'No Show';
	if (floor === 'waiting_bar') return 'Waiting in Bar';
	if (floor === 'table_ready') return 'Table Ready';
	return ARRIVAL_NOT_ARRIVED;
}

/**
 * PocketBase returns datetimes space-separated ("2026-09-06 16:33:00.123Z"),
 * not ISO. Node and Chrome parse that anyway; SAFARI RETURNS Invalid Date — and
 * the history's Date column is formatted in the browser, on the hosts' iPads. So
 * every timestamp leaving this module is normalised to real ISO first.
 */
function isoOf(value: string): string {
	const d = new Date(String(value ?? '').replace(' ', 'T'));
	return Number.isNaN(d.getTime()) ? String(value ?? '') : d.toISOString();
}

/** "Sunday, 06 September 2026 18:00" — ResDiary's visit-date wording, London. */
function visitDate(raw: string): string {
	const iso = isoOf(raw);
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return String(raw);
	// formatToParts rather than a format string: en-GB's joined output has moved
	// between ICU versions ("at 18:00" vs " 18:00"), and this wording is asserted.
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: LONDON,
		weekday: 'long',
		day: '2-digit',
		month: 'long',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(d);
	const g = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${g('weekday')}, ${g('day')} ${g('month')} ${g('year')} ${g('hour')}:${g('minute')}`;
}

/** Free text in a description: quoted, or "none" when blank. */
const text = (v: unknown) => {
	const s = String(v ?? '').trim();
	return s ? `"${s}"` : 'none';
};

const yesNo = (v: unknown) => (v ? 'Yes' : 'No');

// --- the differ -------------------------------------------------------------

const EVENT_BY_ACTION: Record<string, HistoryEventKind> = {
	create_booking: 'Made',
	cancel_booking: 'Cancelled',
	cancel_late: 'Cancelled',
	no_show: 'No Show',
	reinstate_booking: 'Reinstated',
	expire_unpaid: 'Expired'
};

/**
 * The booking fields worth a line in the history, in the order ResDiary lists
 * them. Anything not here — risk scores, allergy denormalisation, seen-by-staff
 * flags — is machinery the restaurant never asked to see, and including it would
 * bury the three changes that matter under a dozen that don't.
 *
 * `status` is special-cased in {@link describeAuditRow}: when a change also moved
 * the arrival status, only the arrival line is emitted, because "Status changed
 * From Booked to Seated" and "Arrival Status changed From Not Arrived to Fully
 * Seated" are the same event said twice.
 */
const FIELDS: Array<{
	key: string;
	label: string;
	format: (v: unknown, look: HistoryLookups) => string;
}> = [
	{
		key: 'restaurant',
		label: 'Venue',
		format: (v, look) => look.venueNames?.get(String(v ?? '')) ?? String(v ?? '')
	},
	{ key: 'starts_at', label: 'Visit Date', format: (v) => visitDate(String(v ?? '')) },
	{ key: 'party_size', label: 'Covers', format: (v) => String(v ?? '') },
	{
		key: 'tables',
		label: 'Tables',
		format: (v, look) => {
			const ids = Array.isArray(v) ? (v as string[]) : [];
			if (!ids.length) return 'none';
			return ids.map((id) => look.tableLabels.get(id) ?? id).join(', ');
		}
	},
	{
		key: 'status',
		label: 'Status',
		format: (v) => STATUS_LABEL[String(v ?? '')] ?? String(v ?? '')
	},
	{ key: 'guest_name', label: 'Name', format: text },
	{ key: 'guest_phone', label: 'Phone', format: text },
	{ key: 'special_requests', label: 'Special Requests', format: text },
	{ key: 'note_to_restaurant', label: 'Note', format: text },
	{ key: 'occasion', label: 'Occasion', format: text },
	{ key: 'promotion', label: 'Promotion', format: text },
	{ key: 'confirmed', label: 'Confirmed', format: yesNo }
];

/** Order-insensitive for arrays (a re-ordered table list is not a change). */
function same(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) || Array.isArray(b)) {
		const x = (Array.isArray(a) ? a : []).map(String).slice().sort();
		const y = (Array.isArray(b) ? b : []).map(String).slice().sort();
		return x.length === y.length && x.every((v, i) => v === y[i]);
	}
	// Treat undefined / null / '' alike: an unmigrated column arriving as
	// undefined must not read as "changed from none to none".
	if (a == null || a === '') return b == null || b === '';
	return a === b;
}

/**
 * Actions our server performs but the GUEST actually caused. The payment webhook
 * writes confirm_on_payment as actor='system', yet what happened is the guest
 * paying and their Table Hold becoming a Booking — which is how ResDiary shows
 * it, and how the restaurant thinks about it. Attributing it to 'system' would
 * hide the guest's own step, the very thing the owner asked to see.
 */
const GUEST_CAUSED = new Set(['confirm_on_payment']);

function userFor(
	rowActor: string,
	onBehalfOf: string,
	action: string,
	look: HistoryLookups
): string {
	if (GUEST_CAUSED.has(action)) return 'guest';
	// An ONLINE booking is audited as actor='system' (create.ts takes the guest's
	// submission and writes the row itself), but the guest is who made it — and
	// "Made / guest" is exactly what ResDiary's history shows. A staff-taken phone
	// or walk-in booking audits as actor='staff' and falls through to their name.
	if (action === 'create_booking' && rowActor === 'system') return 'guest';
	const name = onBehalfOf ? look.staffNames.get(onBehalfOf) : undefined;
	switch (rowActor) {
		case 'customer':
			return 'guest';
		case 'system':
			return 'system';
		case 'ai':
			// A human authorised it, so name them — but say the assistant acted, or
			// the trail reads as though the manager typed every one of these.
			return name ? `${name} (assistant)` : 'assistant';
		default:
			return name ?? 'staff';
	}
}

/**
 * Turn one audit row into a history line, or `null` when it changed nothing the
 * restaurant would recognise as a step (a risk rescore, an allergy denorm).
 * Rows whose EVENT is itself the news — Made, Cancelled, No Show — are always
 * kept, even when the field diff is empty.
 */
export function describeAuditRow(row: AuditLog, look: HistoryLookups): HistoryEvent | null {
	const event = EVENT_BY_ACTION[row.action] ?? 'Modified';
	const before = (row.before ?? {}) as Record<string, unknown>;
	const after = (row.after ?? {}) as Record<string, unknown>;
	const descriptions: string[] = [];

	if (event !== 'Made') {
		const arrivalBefore = arrivalStatus(before);
		const arrivalAfter = arrivalStatus(after);
		const arrivalMoved = row.before != null && arrivalBefore !== arrivalAfter;

		for (const f of FIELDS) {
			if (f.key === 'status' && arrivalMoved) continue; // said by the arrival line
			if (!(f.key in before) && !(f.key in after)) continue;
			if (same(before[f.key], after[f.key])) continue;
			descriptions.push(
				`${f.label} changed From ${f.format(before[f.key], look)} to ${f.format(after[f.key], look)}.`
			);
		}

		if (arrivalMoved) {
			descriptions.push(`Arrival Status changed From ${arrivalBefore} to ${arrivalAfter}.`);
		}

		// cancelBooking / markNoShow fold the picked reason into the audited `after`
		// as a `_cancellation` meta block (no schema migration) — surface its label
		// so the history says WHY, which is the first thing anyone asks.
		const meta = after._cancellation as { reasonLabel?: string } | undefined;
		const reason = meta?.reasonLabel?.trim();
		if (reason) descriptions.push(`Reason: ${reason}.`);

		// recordConfirmAttempt only moves confirm_attempts (not a listed field), so
		// say what the host did or the row would be dropped as noise.
		if (row.action === 'resend_confirmation') descriptions.push('Confirmation email sent.');
	}

	if (event === 'Modified' && descriptions.length === 0) return null;

	return {
		at: isoOf(row.created),
		user: userFor(String(row.actor ?? ''), String(row.on_behalf_of ?? ''), row.action, look),
		event,
		descriptions
	};
}

/** Every audit row for one booking as a newest-first history, noise removed. */
export function buildBookingHistory(rows: AuditLog[], look: HistoryLookups): HistoryEvent[] {
	return rows
		.map((r) => describeAuditRow(r, look))
		.filter((e): e is HistoryEvent => e !== null)
		.sort((a, b) => b.at.localeCompare(a.at));
}

// --- the PocketBase shell ---------------------------------------------------

/**
 * The booking's history for /admin/bookings/[id]#history. Best-effort: a booking
 * page must still render if the audit read fails, so this resolves to [] rather
 * than throwing — an empty history is a far better failure than a 500 on the
 * page a host opened to check a guest's details.
 */
export async function getBookingHistory(bookingId: string): Promise<HistoryEvent[]> {
	try {
		const c = await pb();
		const rows = await c.collection('geisha_audit_log').getFullList<AuditLog>({
			filter: `entity=${q('geisha_bookings')} && entity_id=${q(bookingId)}`,
			sort: '-created'
		});
		if (!rows.length) return [];

		// Only the ids this booking's rows actually mention — no point listing every
		// table in the restaurant to label two of them.
		const staffIds = new Set<string>();
		const tableIds = new Set<string>();
		for (const r of rows) {
			if (r.on_behalf_of) staffIds.add(r.on_behalf_of);
			for (const side of [r.before, r.after]) {
				const t = (side as Record<string, unknown> | null)?.tables;
				if (Array.isArray(t)) for (const id of t) tableIds.add(String(id));
			}
		}

		const [staff, tables, venues] = await Promise.all([
			staffIds.size
				? c
						.collection('geisha_staff')
						.getFullList<Staff>({
							filter: [...staffIds].map((id) => `id=${q(id)}`).join(' || ')
						})
						.catch(() => [] as Staff[])
				: Promise.resolve([] as Staff[]),
			tableIds.size
				? c
						.collection('geisha_tables')
						.getFullList<DiningTable>({
							filter: [...tableIds].map((id) => `id=${q(id)}`).join(' || ')
						})
						.catch(() => [] as DiningTable[])
				: Promise.resolve([] as DiningTable[]),
			// Two rows in total; only read when a row actually changed venue.
			rows.some((r) => {
				const was = (r.before as Record<string, unknown> | null)?.restaurant;
				const now = (r.after as Record<string, unknown> | null)?.restaurant;
				return !!was && !!now && was !== now;
			})
				? c
						.collection('geisha_restaurants')
						.getFullList<Restaurant>()
						.catch(() => [] as Restaurant[])
				: Promise.resolve([] as Restaurant[])
		]);

		return buildBookingHistory(rows, {
			staffNames: new Map(staff.map((s) => [s.id, s.name || s.email || 'staff'])),
			tableLabels: new Map(tables.map((t) => [t.id, t.label])),
			venueNames: new Map(venues.map((v) => [v.id, v.display_name]))
		});
	} catch (err) {
		console.error('[history] failed to read booking history:', err);
		return [];
	}
}
