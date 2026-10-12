// Unit coverage for the booking-history differ (ResDiary's "Booking History"
// window). These tests exercise the PURE half of history.ts — no PocketBase —
// because the whole point of splitting describeAuditRow/buildBookingHistory out
// of getBookingHistory is that the interesting logic (what changed, how do we
// word it, who did it) is a plain function of an audit row.

import { describe, it, expect } from 'vitest';
import { describeAuditRow, buildBookingHistory, type HistoryLookups } from './history.js';
import type { AuditLog, Booking } from '../db/types.js';

// --- fixtures ---------------------------------------------------------------

const LOOKUPS: HistoryLookups = {
	staffNames: new Map([
		['stf_georgia', 'Georgia Fox'],
		['stf_sam', 'Sam Patel']
	]),
	tableLabels: new Map([
		['tbl_27', '27'],
		['tbl_3', '3'],
		['tbl_10', '10']
	])
};

/** A minimally-populated booking snapshot; override just the fields under test. */
function booking(over: Partial<Booking> = {}): Partial<Booking> {
	return {
		id: 'bk_1',
		restaurant: 'rst_asia',
		customer: 'cus_1',
		party_size: 4,
		starts_at: '2026-09-06T17:00:00Z', // 18:00 London
		ends_at: '2026-09-06T18:30:00Z',
		tables: ['tbl_27'],
		service_period: 'per_dinner',
		status: 'confirmed',
		source: 'online',
		special_requests: '',
		occasion: '',
		...over
	};
}

function row(over: Partial<AuditLog> = {}): AuditLog {
	return {
		id: 'aud_1',
		created: '2026-09-06T16:33:00Z',
		updated: '2026-09-06T16:33:00Z',
		actor: 'staff',
		action: 'amend_booking',
		entity: 'geisha_bookings',
		entity_id: 'bk_1',
		before: booking(),
		after: booking(),
		...over
	} as AuditLog;
}

// --- events -----------------------------------------------------------------

describe('describeAuditRow — event kind', () => {
	it('reports a created booking as "Made" with no description', () => {
		const ev = describeAuditRow(
			row({ action: 'create_booking', actor: 'customer', before: null, after: booking() }),
			LOOKUPS
		);
		expect(ev?.event).toBe('Made');
		expect(ev?.descriptions).toEqual([]);
	});

	it('reports a cancellation as "Cancelled" and names the reason', () => {
		const ev = describeAuditRow(
			row({
				action: 'cancel_booking',
				before: booking({ status: 'confirmed' }),
				after: {
					...booking({ status: 'cancelled' }),
					_cancellation: { reason: 'guest_request', reasonLabel: 'Guest called to cancel' }
				}
			}),
			LOOKUPS
		);
		expect(ev?.event).toBe('Cancelled');
		expect(ev?.descriptions).toContain('Reason: Guest called to cancel.');
	});

	it('reports a no-show as "No Show"', () => {
		const ev = describeAuditRow(
			row({
				action: 'no_show',
				before: booking({ status: 'confirmed' }),
				after: booking({ status: 'no_show' })
			}),
			LOOKUPS
		);
		expect(ev?.event).toBe('No Show');
	});

	it('reports any other change as "Modified"', () => {
		const ev = describeAuditRow(
			row({
				before: booking({ party_size: 4 }),
				after: booking({ party_size: 6 })
			}),
			LOOKUPS
		);
		expect(ev?.event).toBe('Modified');
	});

	it('keeps a resent confirmation (only confirm_attempts moved) and says so', () => {
		const ev = describeAuditRow(
			row({
				action: 'resend_confirmation',
				before: { ...booking(), confirm_attempts: 0 },
				after: { ...booking(), confirm_attempts: 1 }
			}),
			LOOKUPS
		);
		expect(ev?.event).toBe('Modified');
		expect(ev?.descriptions).toEqual(['Confirmation email sent.']);
	});
});

// --- field diffs (the ResDiary wording) -------------------------------------

describe('describeAuditRow — field descriptions', () => {
	it('names both venues when a booking moved between them', () => {
		const ev = describeAuditRow(
			row({
				before: booking({ restaurant: 'rst_asia', tables: ['tbl_27'] }),
				after: booking({ restaurant: 'rst_fusion', tables: ['tbl_3'] })
			}),
			{
				...LOOKUPS,
				venueNames: new Map([
					['rst_asia', 'Geisha Asia'],
					['rst_fusion', 'Geisha Fusion']
				])
			}
		);
		expect(ev?.descriptions).toEqual([
			'Venue changed From Geisha Asia to Geisha Fusion.',
			'Tables changed From 27 to 3.'
		]);
	});

	it('describes a table change using table labels, not record ids', () => {
		const ev = describeAuditRow(
			row({ before: booking({ tables: ['tbl_27'] }), after: booking({ tables: ['tbl_3'] }) }),
			LOOKUPS
		);
		expect(ev?.descriptions).toEqual(['Tables changed From 27 to 3.']);
	});

	it('joins multiple tables in a change description', () => {
		const ev = describeAuditRow(
			row({
				before: booking({ tables: ['tbl_10'] }),
				after: booking({ tables: ['tbl_27', 'tbl_3'] })
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toEqual(['Tables changed From 10 to 27, 3.']);
	});

	it('describes an unallocated booking as "none" rather than an empty gap', () => {
		const ev = describeAuditRow(
			row({ before: booking({ tables: ['tbl_27'] }), after: booking({ tables: [] }) }),
			LOOKUPS
		);
		expect(ev?.descriptions).toEqual(['Tables changed From 27 to none.']);
	});

	it('describes a time change as a full London-local visit date', () => {
		const ev = describeAuditRow(
			row({
				before: booking({ starts_at: '2026-09-06T17:00:00Z' }), // 18:00 London
				after: booking({ starts_at: '2026-09-06T16:30:00Z' }) // 17:30 London
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toEqual([
			'Visit Date changed From Sunday, 06 September 2026 18:00 to Sunday, 06 September 2026 17:30.'
		]);
	});

	it('describes a party-size change as covers', () => {
		const ev = describeAuditRow(
			row({ before: booking({ party_size: 4 }), after: booking({ party_size: 6 }) }),
			LOOKUPS
		);
		expect(ev?.descriptions).toEqual(['Covers changed From 4 to 6.']);
	});

	it('describes a status change in ResDiary words, not our column values', () => {
		const ev = describeAuditRow(
			row({
				action: 'confirm_booking',
				before: booking({ status: 'pending_payment' }),
				after: booking({ status: 'confirmed' })
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toEqual(['Status changed From Table Hold to Booked.']);
	});

	it('lists every changed field on a single audit row', () => {
		const ev = describeAuditRow(
			row({
				before: booking({ party_size: 4, tables: ['tbl_27'] }),
				after: booking({ party_size: 6, tables: ['tbl_3'] })
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toHaveLength(2);
		expect(ev?.descriptions).toContain('Covers changed From 4 to 6.');
		expect(ev?.descriptions).toContain('Tables changed From 27 to 3.');
	});

	it('describes a special request being added', () => {
		const ev = describeAuditRow(
			row({
				before: booking({ special_requests: '' }),
				after: booking({ special_requests: 'Window table please' })
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toEqual([
			'Special Requests changed From none to "Window table please".'
		]);
	});
});

// --- arrival status ---------------------------------------------------------

describe('describeAuditRow — arrival status', () => {
	it('describes seating as an arrival-status change', () => {
		const ev = describeAuditRow(
			row({
				action: 'seat_booking',
				before: booking({ status: 'confirmed' }),
				after: booking({ status: 'seated' })
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toContain('Arrival Status changed From Not Arrived to Fully Seated.');
	});

	it('distinguishes a partial seating', () => {
		const ev = describeAuditRow(
			row({
				action: 'seat_booking',
				before: booking({ status: 'confirmed' }),
				after: { ...booking({ status: 'seated' }), floor_status: 'partially_seated' }
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toContain(
			'Arrival Status changed From Not Arrived to Partially Seated.'
		);
	});

	it('describes the bar-wait holding state', () => {
		const ev = describeAuditRow(
			row({
				action: 'set_floor_status',
				before: booking({ floor_status: '' }),
				after: booking({ floor_status: 'waiting_bar' })
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toEqual([
			'Arrival Status changed From Not Arrived to Waiting in Bar.'
		]);
	});

	it('describes clearing a table as finished', () => {
		const ev = describeAuditRow(
			row({
				action: 'clear_booking',
				before: booking({ status: 'seated' }),
				after: booking({ status: 'completed' })
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toContain('Arrival Status changed From Fully Seated to Finished.');
	});

	it('does not report a status change twice when the arrival status covers it', () => {
		const ev = describeAuditRow(
			row({
				action: 'seat_booking',
				before: booking({ status: 'confirmed' }),
				after: booking({ status: 'seated' })
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toHaveLength(1);
	});
});

// --- the user column --------------------------------------------------------

describe('describeAuditRow — user', () => {
	it('names the staff member who made the change', () => {
		const ev = describeAuditRow(
			row({
				actor: 'staff',
				on_behalf_of: 'stf_georgia',
				before: booking({ party_size: 4 }),
				after: booking({ party_size: 6 })
			}),
			LOOKUPS
		);
		expect(ev?.user).toBe('Georgia Fox');
	});

	it('attributes a guest self-service change to the guest', () => {
		const ev = describeAuditRow(
			row({
				actor: 'customer',
				before: booking({ party_size: 4 }),
				after: booking({ party_size: 6 })
			}),
			LOOKUPS
		);
		expect(ev?.user).toBe('guest');
	});

	it('falls back to a generic staff label when no staff id was recorded', () => {
		const ev = describeAuditRow(
			row({
				actor: 'staff',
				before: booking({ party_size: 4 }),
				after: booking({ party_size: 6 })
			}),
			LOOKUPS
		);
		expect(ev?.user).toBe('staff');
	});

	it('credits the authorising staff member for an assistant action', () => {
		const ev = describeAuditRow(
			row({
				actor: 'ai',
				on_behalf_of: 'stf_sam',
				before: booking({ tables: ['tbl_27'] }),
				after: booking({ tables: ['tbl_3'] })
			}),
			LOOKUPS
		);
		expect(ev?.user).toBe('Sam Patel (assistant)');
	});

	it('attributes an automated change to the system', () => {
		const ev = describeAuditRow(
			row({
				actor: 'system',
				action: 'expire_unpaid',
				before: booking({ status: 'pending_payment' }),
				after: booking({ status: 'cancelled' })
			}),
			LOOKUPS
		);
		expect(ev?.user).toBe('system');
	});
});

// --- PocketBase's datetime format -------------------------------------------
//
// PB returns datetimes space-separated ("2026-09-06 16:33:00.123Z"), not as ISO
// with a "T". Chrome and Node parse that anyway; Safari returns Invalid Date —
// and the Date column is rendered client-side, on the hosts' iPads. So the
// timestamps must leave this module as real ISO strings.

describe('describeAuditRow — PocketBase datetimes', () => {
	it('normalises the audit timestamp to ISO so the browser can parse it', () => {
		const ev = describeAuditRow(
			row({
				created: '2026-09-06 16:33:00.123Z',
				before: booking({ party_size: 4 }),
				after: booking({ party_size: 6 })
			}),
			LOOKUPS
		);
		expect(new Date(ev!.at).toISOString()).toBe('2026-09-06T16:33:00.123Z');
		expect(ev!.at).not.toContain(' ');
	});

	it('reads a space-separated visit date rather than echoing it raw', () => {
		const ev = describeAuditRow(
			row({
				before: booking({ starts_at: '2026-09-06 17:00:00.000Z' }),
				after: booking({ starts_at: '2026-09-06 16:30:00.000Z' })
			}),
			LOOKUPS
		);
		expect(ev?.descriptions).toEqual([
			'Visit Date changed From Sunday, 06 September 2026 18:00 to Sunday, 06 September 2026 17:30.'
		]);
	});
});

// --- real audit actions found in the live log -------------------------------
//
// These three actions all land on geisha_bookings and were found on real
// bookings, so the differ has to handle them deliberately rather than by luck.

describe('describeAuditRow — the payment-confirmation row', () => {
	it('credits the guest, not the system, when their payment confirms the booking', () => {
		// The webhook writes this with actor='system', but it is the GUEST paying that
		// turned Table Hold into Booked — which is exactly how ResDiary shows it.
		const ev = describeAuditRow(
			row({
				action: 'confirm_on_payment',
				actor: 'system',
				before: booking({ status: 'pending_payment' }),
				after: booking({ status: 'confirmed' })
			}),
			LOOKUPS
		);
		expect(ev?.user).toBe('guest');
		expect(ev?.descriptions).toEqual(['Status changed From Table Hold to Booked.']);
	});
});

describe('describeAuditRow — who made the booking', () => {
	it('credits the guest for an online booking', () => {
		// The online create path audits as actor='system' (create.ts), but the guest
		// is the one who made it — which is what ResDiary's "Made" row shows.
		const ev = describeAuditRow(
			row({ action: 'create_booking', actor: 'system', before: null, after: booking() }),
			LOOKUPS
		);
		expect(ev?.event).toBe('Made');
		expect(ev?.user).toBe('guest');
	});

	it('credits the host who took a phone booking', () => {
		const ev = describeAuditRow(
			row({
				action: 'create_booking',
				actor: 'staff',
				on_behalf_of: 'stf_georgia',
				before: null,
				after: booking()
			}),
			LOOKUPS
		);
		expect(ev?.user).toBe('Georgia Fox');
	});
});

describe('describeAuditRow — non-booking rows on the booking', () => {
	it('drops the referrer-tracking row', () => {
		const ev = describeAuditRow(
			row({
				action: 'booking_origin',
				actor: 'customer',
				before: null,
				after: { dest: 'empty', kind: 'direct', referer: 'https://example.com', ua: 'Mozilla/5.0' }
			}),
			LOOKUPS
		);
		expect(ev).toBeNull();
	});

	it('drops a card-failure row (it belongs on the payments panel)', () => {
		const ev = describeAuditRow(
			row({
				action: 'payment_issue',
				actor: 'customer',
				before: null,
				after: { amount: 6000, code: 'card_confirm_failed', message: 'Your card has expired.' }
			}),
			LOOKUPS
		);
		expect(ev).toBeNull();
	});
});

// --- noise suppression ------------------------------------------------------

describe('describeAuditRow — rows worth showing', () => {
	it('drops a modification that changed nothing the restaurant can see', () => {
		const ev = describeAuditRow(
			row({
				before: booking({ risk_score: 0.2 }),
				after: booking({ risk_score: 0.9 })
			}),
			LOOKUPS
		);
		expect(ev).toBeNull();
	});

	it('keeps a cancellation even though no visible field diff is produced', () => {
		const ev = describeAuditRow(
			row({ action: 'cancel_booking', before: booking(), after: booking() }),
			LOOKUPS
		);
		expect(ev).not.toBeNull();
		expect(ev?.event).toBe('Cancelled');
	});
});

// --- the assembled list -----------------------------------------------------

describe('buildBookingHistory', () => {
	it('returns the newest change first, as ResDiary does', () => {
		const events = buildBookingHistory(
			[
				row({ id: 'a', created: '2026-09-03T20:24:00Z', action: 'create_booking', before: null }),
				row({
					id: 'b',
					created: '2026-09-06T14:30:00Z',
					before: booking({ tables: ['tbl_10'] }),
					after: booking({ tables: ['tbl_27'] })
				})
			],
			LOOKUPS
		);
		expect(events.map((e) => e.event)).toEqual(['Modified', 'Made']);
	});

	it('leaves out rows with nothing to report', () => {
		const events = buildBookingHistory(
			[
				row({ id: 'a', action: 'create_booking', before: null }),
				row({ id: 'b', before: booking({ risk_score: 0.2 }), after: booking({ risk_score: 0.9 }) })
			],
			LOOKUPS
		);
		expect(events).toHaveLength(1);
		expect(events[0].event).toBe('Made');
	});
});
