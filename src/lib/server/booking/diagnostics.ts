// Guest-booking diagnostics — "did a customer do this, or did we?", and "is the
// card step actually working?".
//
// Both questions used to be answerable only by reading source and hand-querying
// PocketBase. Everything below is assembled from rows the system now writes as it
// runs (see origin.ts, /api/bookings, /api/bookings/[id]/payment-issue and the
// Stripe webhook); this module only joins and counts them.
//
// THE EVIDENCE, WEAKEST TO STRONGEST — worth knowing which claim rests on what:
//
//   booking.source==='online'   Only POST /api/bookings writes it. Every admin and
//                               AI path passes 'phone'/'walkin' + staff:true. So it
//                               cannot have been typed into the back office.
//   audit actor==='system'      Written by createBooking on the non-staff branch,
//                               independently of `source`. A staff-made booking
//                               logs 'staff'. Two fields would have to agree to lie.
//   booking_origin row          The request headers at the moment of booking —
//                               names the page the widget was framed in.
//   actor==='customer' actions  A self-service amend/cancel needs the signed token
//                               emailed to the guest. Nothing in the admin can
//                               produce one. This is proof the guest, personally,
//                               operated their own booking.

import { pb } from '../db/pb.js';
import type { AuditLog, Booking, Customer, Payment, BrandId } from '../db/types.js';
import { getRestaurant } from './queries.js';
import { bookingReference } from '../../bookings/reference.js';
import { originLabel, type BookingOrigin } from './origin.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** A guest-side failure at the card step, from either the widget or Stripe. */
export interface PaymentIssue {
	at: string;
	/** 'widget' = the guest's browser told us; 'stripe_webhook' = Stripe did. */
	from: string;
	/** load | mount | confirm | reconcile, or '' for a Stripe-reported decline. */
	stage: string;
	code: string;
	declineCode: string;
	message: string;
	bookingId: string;
	guestName: string;
	amount: number;
	kind: string;
}

export interface GuestBookingRow {
	bookingId: string;
	reference: string;
	created: string;
	brand: string;
	guestName: string;
	email: string;
	partySize: number;
	startsAt: string;
	status: string;
	/** How createBooking recorded the maker — 'system' (guest) vs 'staff'. */
	auditActor: string;
	origin: BookingOrigin | null;
	originText: string;
	/** Self-service actions the GUEST performed on their own booking. */
	guestActions: Array<{ at: string; action: string }>;
	payment: { status: string; kind: string; amount: number; intent: string } | null;
	issues: PaymentIssue[];
}

export interface BookingDiagnostics {
	sinceISO: string;
	days: number;
	bookings: GuestBookingRow[];
	issues: PaymentIssue[];
	summary: {
		guestBookings: number;
		fromIframe: number;
		direct: number;
		unclassified: number;
		/** Pre-dates origin capture — no booking_origin row was ever written. */
		beforeTracking: number;
		guestOperated: number;
		staffLabelled: number;
		paymentRequired: number;
		paymentSettled: number;
		paymentFailed: number;
		paymentAbandoned: number;
	};
}

const isoDaysAgo = (days: number): string =>
	new Date(Date.now() - days * 86_400_000).toISOString();

/** PocketBase compares datetimes as strings with a SPACE separator. */
const pbDate = (iso: string) => iso.replace('T', ' ').slice(0, 19);

/**
 * Everything the diagnostics page shows, for one brand over the last `days`.
 *
 * Scoped to guest bookings on purpose: a staff booking has a named human behind
 * it in the audit trail already, and mixing 400 walk-ins into this view would
 * bury the 30 rows the question is actually about.
 */
export async function getBookingDiagnostics(
	brand: BrandId,
	days = 14
): Promise<BookingDiagnostics> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const sinceISO = isoDaysAgo(days);
	const since = pbDate(sinceISO);

	const bookings = await c.collection('geisha_bookings').getFullList<
		Booking & { expand?: { customer?: Customer } }
	>({
		filter: `restaurant=${q(restaurant.id)} && source=${q('online')} && created>=${q(since)}`,
		sort: '-created',
		expand: 'customer'
	});

	if (!bookings.length) {
		return {
			sinceISO,
			days,
			bookings: [],
			issues: [],
			summary: {
				guestBookings: 0,
				fromIframe: 0,
				direct: 0,
				unclassified: 0,
				beforeTracking: 0,
				guestOperated: 0,
				staffLabelled: 0,
				paymentRequired: 0,
				paymentSettled: 0,
				paymentFailed: 0,
				paymentAbandoned: 0
			}
		};
	}

	const ids = new Set(bookings.map((b) => b.id));
	const idFilter = bookings.map((b) => `entity_id=${q(b.id)}`).join(' || ');

	// One audit read for the window, then bucket in memory: the log is written by
	// several unrelated paths (create, origin, self-service, payment issues) and
	// four filtered round-trips to a cross-region droplet is the slow way to ask.
	const [audits, payments] = await Promise.all([
		c
			.collection('geisha_audit_log')
			.getFullList<AuditLog>({ filter: `created>=${q(since)} && (${idFilter})`, sort: 'created' })
			.catch(() => [] as AuditLog[]),
		c
			.collection('geisha_payments')
			.getFullList<Payment>({
				filter: bookings.map((b) => `booking=${q(b.id)}`).join(' || ')
			})
			.catch(() => [] as Payment[])
	]);

	// payment_failed rows are logged against the PAYMENT, not the booking, so they
	// arrive under a different entity_id — fetch them by payment id and map back.
	const payById = new Map(payments.map((p) => [p.id, p]));
	const failAudits = payments.length
		? await c
				.collection('geisha_audit_log')
				.getFullList<AuditLog>({
					filter: `action=${q('payment_failed')} && (${payments
						.map((p) => `entity_id=${q(p.id)}`)
						.join(' || ')})`,
					sort: 'created'
				})
				.catch(() => [] as AuditLog[])
		: [];

	const createActor = new Map<string, string>();
	const originByBooking = new Map<string, BookingOrigin>();
	const guestActions = new Map<string, Array<{ at: string; action: string }>>();
	const issuesByBooking = new Map<string, PaymentIssue[]>();
	const payByBooking = new Map<string, Payment>();
	for (const p of payments) payByBooking.set(p.booking, p);

	const nameOf = new Map(
		bookings.map((b) => [b.id, b.expand?.customer?.name || b.guest_name || '—'])
	);

	for (const a of audits) {
		if (!ids.has(a.entity_id)) continue;
		const after = (a.after ?? {}) as Record<string, unknown>;
		switch (a.action) {
			case 'create_booking':
				createActor.set(a.entity_id, a.actor || '');
				break;
			case 'booking_origin':
				originByBooking.set(a.entity_id, after as unknown as BookingOrigin);
				break;
			case 'payment_issue': {
				const list = issuesByBooking.get(a.entity_id) ?? [];
				list.push({
					at: a.created,
					from: String(after.source ?? 'widget'),
					stage: String(after.stage ?? ''),
					code: String(after.code ?? ''),
					declineCode: '',
					message: String(after.message ?? ''),
					bookingId: a.entity_id,
					guestName: nameOf.get(a.entity_id) ?? '—',
					amount: Number(after.amount ?? 0),
					kind: String(after.kind ?? '')
				});
				issuesByBooking.set(a.entity_id, list);
				break;
			}
			default:
				// A guest can only reach amend/cancel through the emailed token, so any
				// customer-actor row is the guest acting on their own booking.
				if (a.actor === 'customer') {
					const list = guestActions.get(a.entity_id) ?? [];
					list.push({ at: a.created, action: a.action });
					guestActions.set(a.entity_id, list);
				}
		}
	}

	for (const a of failAudits) {
		const p = payById.get(a.entity_id);
		if (!p) continue;
		const after = (a.after ?? {}) as Record<string, unknown>;
		const list = issuesByBooking.get(p.booking) ?? [];
		list.push({
			at: a.created,
			from: String(after.source ?? 'stripe_webhook'),
			stage: '',
			code: String(after.code ?? ''),
			declineCode: String(after.decline_code ?? ''),
			message: String(after.message ?? ''),
			bookingId: p.booking,
			guestName: nameOf.get(p.booking) ?? '—',
			amount: Number(after.amount ?? p.amount ?? 0),
			kind: String(after.kind ?? p.kind ?? '')
		});
		issuesByBooking.set(p.booking, list);
	}

	const rows: GuestBookingRow[] = bookings.map((b) => {
		const origin = originByBooking.get(b.id) ?? null;
		const pay = payByBooking.get(b.id) ?? null;
		return {
			bookingId: b.id,
			reference: bookingReference(b.id),
			created: b.created,
			brand,
			guestName: b.expand?.customer?.name || b.guest_name || '—',
			email: b.expand?.customer?.email || '',
			partySize: b.party_size,
			startsAt: b.starts_at,
			status: b.status,
			auditActor: createActor.get(b.id) ?? '',
			origin,
			originText: origin ? originLabel(origin) : 'not recorded',
			guestActions: guestActions.get(b.id) ?? [],
			payment: pay
				? {
						status: pay.status || '',
						kind: pay.kind || '',
						amount: pay.amount ?? 0,
						intent: pay.dojo_payment_intent_id || ''
					}
				: null,
			issues: issuesByBooking.get(b.id) ?? []
		};
	});

	const settled = (s: string) => s === 'Captured' || s === 'Authorized';
	const issues = rows.flatMap((r) => r.issues).sort((a, b) => (a.at < b.at ? 1 : -1));

	return {
		sinceISO,
		days,
		bookings: rows,
		issues,
		summary: {
			guestBookings: rows.length,
			fromIframe: rows.filter((r) => r.origin?.kind === 'iframe').length,
			direct: rows.filter((r) => r.origin?.kind === 'direct').length,
			unclassified: rows.filter((r) => r.origin?.kind === 'unknown').length,
			beforeTracking: rows.filter((r) => !r.origin).length,
			guestOperated: rows.filter((r) => r.guestActions.length > 0).length,
			// A booking labelled 'online' whose create was logged by staff would mean
			// the two independent fields disagree — it should always be 0, and it is
			// shown so that stops being an assumption.
			staffLabelled: rows.filter((r) => r.auditActor === 'staff').length,
			paymentRequired: rows.filter((r) => r.payment).length,
			paymentSettled: rows.filter((r) => r.payment && settled(r.payment.status)).length,
			paymentFailed: rows.filter((r) => r.issues.length > 0).length,
			// Money was asked for, nothing settled, and nobody reported an error —
			// the guest simply left the card form.
			paymentAbandoned: rows.filter(
				(r) => r.payment && !settled(r.payment.status) && r.issues.length === 0
			).length
		}
	};
}
