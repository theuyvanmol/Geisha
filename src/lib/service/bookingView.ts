// Shared service-view booking model (Floor ↔ Diary parity).
//
// The Diary and the Floor Plan render the SAME booking from two different server
// shapes: the diary builds a rich `DiaryBooking` (already popover-ready), while the
// floor carries the raw `BookingWithRefs` (PocketBase columns + expanded customer).
// The shared `BookingCard` / modals / status-action helpers must not care which view
// they're embedded in, so they consume ONE normalized shape — `BookingView` — and
// each host maps its own data into it via the two adapters below.
//
// PURE + framework-free so it's unit-testable without a browser or a DB. `BookingView`
// is deliberately a superset of what any single surface shows; absent fields are
// `undefined` and the card renders them as "—"/hidden (matching the diary popover's
// existing back-compat behaviour).

import type {
	DiaryBooking,
	BookingWithRefs,
	DiaryPaymentStatus
} from '$lib/server/booking/admin';
import type { BookingStatus, PaymentKind } from '$lib/server/db/types';
import { bookingReference } from '$lib/bookings/reference';

/** The view-agnostic booking the shared card + modals + status helpers consume. */
export interface BookingView {
	bookingId: string;
	/** booking.updated — optimistic-version token the mutate actions check (409 on stale). */
	version: string;
	/** The guest-facing booking reference — the SAME code their confirmation email
	 *  quotes, so a guest reading it down the phone can be found in search. */
	ref: string;
	guestName: string;
	email?: string;
	phone?: string;
	bookedOn?: string; // ISO — booking.created
	partySize: number;
	startsAt: string;
	endsAt: string;
	leaveTimeConfirmed: boolean;
	status: BookingStatus;
	/** transient pre-seating holding state ('' | 'waiting_bar' | 'table_ready'). */
	floorStatus: '' | 'waiting_bar' | 'table_ready';
	channel: string;
	tableLabels: string[];
	tableIds: string[];
	customerId?: string;
	customerComments?: string; // customer.notes (CRM history)
	noteToRestaurant?: string;
	bookingComments?: string; // special_requests
	promotion?: string;
	menu?: string; // preorder name
	occasion?: string;
	confirmAttempts: number;
	confirmed: boolean;
	firstVisit: boolean;
	vip: boolean;
	allergies?: string;
	// colour-scheme dimensions (so a normalized view can drive `barColour` too)
	paymentStatus: DiaryPaymentStatus;
	/**
	 * WHICH money, not just how much of it — the cancel dialog has to tell the two
	 * apart and `paymentStatus` can't. A `deposit` has already been PAID (a late
	 * cancel keeps it), while a `noshow_hold` is only a card on file that nothing
	 * automatic ever charges. Saying "forfeited" about a card nobody billed is how
	 * staff end up telling a guest they were charged when they weren't.
	 */
	paymentKind?: PaymentKind | '';
	/** Pence on that payment row, so the dialog can name the amount. */
	paymentAmount?: number;
	hasPreorder: boolean;
	important: boolean;
	risk_score?: number;
	risk_factors?: unknown;
}

const refOf = (id: string) => bookingReference(id);

/** Best-effort human channel label from a raw booking's `channel`/`source`. */
function channelLabel(b: { channel?: string; source?: string }): string {
	if (b.channel) return b.channel;
	switch (b.source) {
		case 'walkin':
			return 'Walk-in';
		// staff-entered, however it reached them — phone, pass, or the assistant
		case 'phone':
		case 'ai':
		case 'internal':
			return 'Internal';
		case 'online':
			return 'Online';
		default:
			return b.source || 'Online';
	}
}

/**
 * Adapt the diary's already-rich `DiaryBooking` (from `DiaryBar.detail`) into the
 * shared `BookingView`. The diary bar carries the extra colour-scheme + version bits
 * the DiaryBooking itself doesn't, so they're threaded in via `extra`.
 */
export function fromDiaryBooking(
	d: DiaryBooking,
	extra: {
		bookingId: string;
		version: string;
		floorStatus?: '' | 'waiting_bar' | 'table_ready';
		paymentStatus?: DiaryPaymentStatus;
		paymentKind?: PaymentKind | '';
		paymentAmount?: number;
		hasPreorder?: boolean;
		important?: boolean;
		confirmed?: boolean;
		risk_score?: number;
		risk_factors?: unknown;
	}
): BookingView {
	return {
		bookingId: extra.bookingId,
		version: extra.version,
		ref: d.ref,
		guestName: d.guestName,
		email: d.email,
		phone: d.phone,
		bookedOn: d.bookedOn,
		partySize: d.partySize,
		startsAt: d.startsAt,
		endsAt: d.endsAt,
		leaveTimeConfirmed: d.leaveTimeConfirmed,
		status: d.status,
		floorStatus: extra.floorStatus ?? '',
		channel: d.channel,
		tableLabels: d.tableLabels,
		tableIds: d.tableIds,
		customerId: d.customerId,
		customerComments: d.customerComments,
		noteToRestaurant: d.noteToRestaurant,
		bookingComments: d.bookingComments,
		promotion: d.promotion,
		menu: d.menu,
		occasion: d.occasion,
		confirmAttempts: d.confirmAttempts,
		confirmed: extra.confirmed ?? false,
		firstVisit: d.firstVisit,
		vip: d.vip,
		allergies: d.allergies,
		paymentStatus: extra.paymentStatus ?? 'none',
		paymentKind: extra.paymentKind ?? d.payment?.kind,
		paymentAmount: extra.paymentAmount ?? d.payment?.amount,
		hasPreorder: extra.hasPreorder ?? false,
		important: extra.important ?? false,
		risk_score: extra.risk_score,
		risk_factors: extra.risk_factors
	};
}

/**
 * Adapt the floor's raw `BookingWithRefs` (PocketBase columns + expanded customer)
 * into the shared `BookingView`. `tableLabels` needs the floor's id→label lookup
 * (the raw booking only stores table ids), so the caller supplies `labelOf`.
 */
export function fromFloorBooking(
	b: BookingWithRefs,
	opts?: { labelOf?: (id: string) => string }
): BookingView {
	const labelOf = opts?.labelOf ?? ((id: string) => id);
	const tableIds = (b.tables ?? []).filter((t) => t && t !== '__unassigned__');
	const preorder = b.preorder as { name?: string; items?: unknown[] } | undefined;
	return {
		bookingId: b.id,
		version: b.updated,
		ref: refOf(b.id),
		guestName: b.expand?.customer?.name ?? 'Guest',
		email: b.expand?.customer?.email || undefined,
		phone: b.expand?.customer?.phone || undefined,
		bookedOn: b.created,
		partySize: b.party_size,
		startsAt: b.starts_at,
		endsAt: b.ends_at,
		leaveTimeConfirmed: !!b.leave_time_confirmed,
		status: b.status,
		floorStatus: b.floor_status ?? '',
		channel: channelLabel(b),
		tableLabels: tableIds.map(labelOf),
		tableIds,
		customerId: b.customer || undefined,
		customerComments: b.expand?.customer?.notes || undefined,
		noteToRestaurant: b.note_to_restaurant || undefined,
		bookingComments: b.special_requests || undefined,
		promotion: b.promotion || undefined,
		menu: preorder?.name || undefined,
		occasion: b.occasion || undefined,
		confirmAttempts: b.confirm_attempts ?? 0,
		confirmed: !!b.confirmed,
		firstVisit: false, // floor loader doesn't compute visit history; card hides the flag
		vip: /\bvip\b/i.test(b.occasion || ''),
		allergies: undefined, // floor surfaces allergy via the tile badge; card reads comments
		paymentStatus: 'none', // floor loader doesn't join payments; scheme falls back
		hasPreorder: !!preorder,
		important: !!(b.special_requests || b.note_to_restaurant),
		risk_score: b.risk_score,
		risk_factors: b.risk_factors
	};
}
