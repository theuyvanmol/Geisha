// Unit coverage for amendBooking (WP-S9-1). PocketBase, the advisory lock and
// the email sender are mocked; the REAL availability allocation + policy logic
// runs, so these tests exercise the actual re-validation path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Booking } from '../db/types.js';

// --- in-memory PocketBase fake ---------------------------------------------
// A tiny store keyed by collection name. getFullList returns the whole
// collection (queries.ts seeds only the one restaurant's rows in these tests),
// with enough filter awareness for the few filters amend.ts/queries.ts use.

type Row = Record<string, unknown> & { id: string };

const store: Record<string, Row[]> = {};
let idSeq = 0;

/** A simplistic AND-of-equality matcher for the handful of filters we use. */
function matches(row: Row, filter?: string): boolean {
	if (!filter) return true;
	// getOccupyingBookings ORs statuses inside (...). Pull those out and require
	// the row's status to be one of them; then check the remaining equalities.
	let f = filter;
	const orGroup = f.match(/\(([^)]*\|\|[^)]*)\)/);
	if (orGroup) {
		const statuses = [...orGroup[1].matchAll(/status="([^"]+)"/g)].map((m) => m[1]);
		if (statuses.length && !statuses.includes(String(row.status))) return false;
		f = f.replace(orGroup[0], '').trim();
	}
	// remaining `field="value"` / `field=true` equality clauses joined by &&
	for (const clause of f.split('&&')) {
		const t = clause.trim();
		if (!t) continue;
		let m = t.match(/^([\w.]+)\s*=\s*"([^"]*)"$/);
		if (m) {
			if (String(row[m[1]] ?? '') !== m[2]) return false;
			continue;
		}
		m = t.match(/^([\w.]+)\s*=\s*(true|false)$/);
		if (m) {
			if (Boolean(row[m[1]]) !== (m[2] === 'true')) return false;
			continue;
		}
		// >= / <= bounds (starts_at window). Compare as absolute instants so the
		// "T" vs " " separator (PB stores a space; toPbDateFilter normalises the
		// bound to a space too) doesn't skew a lexical comparison.
		const asMs = (s: string) => new Date(s.replace(' ', 'T')).getTime();
		m = t.match(/^([\w.]+)\s*>=\s*"([^"]*)"$/);
		if (m) {
			if (asMs(String(row[m[1]] ?? '')) < asMs(m[2])) return false;
			continue;
		}
		m = t.match(/^([\w.]+)\s*<=\s*"([^"]*)"$/);
		if (m) {
			if (asMs(String(row[m[1]] ?? '')) > asMs(m[2])) return false;
			continue;
		}
		// unrecognised clause -> ignore (be permissive)
	}
	return true;
}

function collection(name: string) {
	store[name] ??= [];
	const rows = () => store[name];
	return {
		async getOne<T>(id: string): Promise<T> {
			const r = rows().find((x) => x.id === id);
			if (!r) throw Object.assign(new Error('not found'), { status: 404 });
			return structuredClone(r) as T;
		},
		async getFirstListItem<T>(filter: string): Promise<T> {
			const r = rows().find((x) => matches(x, filter));
			if (!r) throw Object.assign(new Error('not found'), { status: 404 });
			return structuredClone(r) as T;
		},
		async getFullList<T>(opts?: { filter?: string }): Promise<T[]> {
			return rows()
				.filter((x) => matches(x, opts?.filter))
				.map((x) => structuredClone(x)) as T[];
		},
		async create<T>(data: Record<string, unknown>): Promise<T> {
			const row: Row = { id: `${name}_${++idSeq}`, created: '', updated: '', ...data };
			rows().push(row);
			return structuredClone(row) as T;
		},
		async update<T>(id: string, data: Record<string, unknown>): Promise<T> {
			const r = rows().find((x) => x.id === id);
			if (!r) throw Object.assign(new Error('not found'), { status: 404 });
			Object.assign(r, data);
			return structuredClone(r) as T;
		},
		async delete(id: string): Promise<void> {
			store[name] = rows().filter((x) => x.id !== id);
		}
	};
}

const fakePb = { collection };

vi.mock('../db/pb.js', () => ({
	pb: async () => fakePb,
	coll: async (n: string) => fakePb.collection(n)
}));

// Lock is a no-op in tests (single-process); we assert single-winner separately
// via the real allocate logic, not the distributed lock.
//
// `onAcquireLock` is the seam for the one race that matters here: amendBooking reads
// its `before` snapshot long before it takes this lock, so a write that lands in that
// gap leaves `before` describing a window the row no longer has. Firing the hook here
// reproduces that deterministically.
let onAcquireLock: (() => void) | null = null;
vi.mock('../db/lock.js', () => ({
	acquireLock: async () => {
		onAcquireLock?.();
		return { id: 'lock', key: 'k', holder: 'h' };
	},
	releaseLock: async () => {}
}));

// Email is best-effort and irrelevant to the logic under test.
vi.mock('../email/confirmations.js', () => ({
	sendBookingConfirmation: async () => ({ sent: true }),
	sendCancellation: async () => ({ sent: true })
}));

// Payment provider presence is now a BEHAVIOURAL INPUT, not an ambient env fact.
// Deposits and card guarantees are gated on a connected provider (ResDiary parity:
// no provider means no deposit feature at all, rather than a deposit the guest has
// no way to pay). Flip `stripeConfigured` per test to exercise both sides of the gate.
let stripeConfigured = true;
vi.mock('../payments/stripe.js', () => ({
	isConfiguredAsync: async () => stripeConfigured,
	isConfigured: () => stripeConfigured,
	ensureCustomer: async () => 'cus_test',
	createDepositIntent: async () => ({
		id: 'pi_test',
		clientSecret: 'pi_test_secret',
		publishableKey: 'pk_test',
		configured: true
	}),
	createGuaranteeIntent: async () => ({
		id: 'seti_test',
		clientSecret: 'seti_test_secret',
		publishableKey: 'pk_test',
		configured: true
	}),
	chargeGuarantee: async () => ({ id: 'pi_fee', status: 'succeeded' }),
	releaseGuarantee: async () => ({ id: 'seti_test', status: 'canceled' }),
	refundPaymentIntent: async () => ({ id: 're_1', status: 'succeeded' }),
	intentKind: (id: string) =>
		id.startsWith('pi_') ? 'payment_intent' : id.startsWith('seti_') ? 'setup_intent' : 'unknown',
	mapStatus: (object: string, status: string) =>
		status === 'canceled'
			? 'Canceled'
			: object === 'setup_intent'
				? status === 'succeeded'
					? 'Authorized'
					: 'Created'
				: status === 'succeeded'
					? 'Captured'
					: 'Created'
}));

// Import AFTER the mocks are registered.
const { amendBooking, swapBookingTables, applyBookingBatch } = await import('./amend.js');
const { BookingError } = await import('./create.js');
// Side-effects (audit + email) are deferred off the response via deferWork; in tests
// there's no waitUntil context so they run un-awaited. flushDeferred() awaits them so
// assertions on the audit rows they write are deterministic (no race/flake).
const { flushDeferred } = await import('../util/defer.js');

// --- fixtures ---------------------------------------------------------------

const TZ = 'Europe/London';
const REST = 'rest1';

// 2026-06-25 is a Thursday (no Fri/Sat hold band). 19:00 local = 18:00Z (BST).
const THU_1900_Z = '2026-06-25T18:00:00.000Z';
const THU_2100_Z = '2026-06-25T20:00:00.000Z';

function seedBase() {
	for (const k of Object.keys(store)) delete store[k];
	idSeq = 0;

	store['geisha_restaurants'] = [
		{ id: REST, created: '', updated: '', brand: 'asia', display_name: 'Geisha', timezone: TZ }
	];

	store['geisha_service_periods'] = [
		{
			id: 'dinner',
			created: '',
			updated: '',
			restaurant: REST,
			name: 'Dinner',
			days_of_week: [0, 1, 2, 3, 4, 5, 6],
			start_time: '17:00',
			end_time: '23:00',
			last_booking_time: '21:30',
			default_turn_minutes: 120,
			active: true
		}
	];

	// t2 (1-2), t4 (2-4), t6 (4-6); t6 is the largest single. Joins below add 8-cap.
	store['geisha_tables'] = [mkTable('t2', 1, 2), mkTable('t4', 2, 4), mkTable('t6', 4, 6)];
	store['geisha_table_joins'] = [
		{ id: 'j1', created: '', updated: '', restaurant: REST, table_a: 't4', table_b: 't6' }
	];

	store['geisha_closures'] = [];
	store['geisha_settings'] = [
		setting('online_party_max', 8),
		setting('deposit_per_person_6plus_pence', 1000),
		setting('noshow_fee_per_person_fri_sat_pence', 500),
		setting('release_after_minutes', 20),
		setting('booking_window_days', 60),
		setting('slot_interval_minutes', 15),
		setting('unpaid_hold_minutes', 15),
		setting('lead_time_minutes', 0)
	];

	store['geisha_customers'] = [
		{
			id: 'cust1',
			created: '',
			updated: '',
			name: 'A',
			email: 'a@x.com',
			phone: '',
			notes: '',
			marketing_consent: false
		}
	];
	store['geisha_bookings'] = [];
	store['geisha_payments'] = [];
	store['geisha_audit_log'] = [];
}

function mkTable(id: string, min: number, max: number): Row {
	return {
		id,
		created: '',
		updated: '',
		restaurant: REST,
		label: id,
		seats_min: min,
		seats_max: max,
		section: 'Main',
		bookable: true,
		x: 0,
		y: 0,
		width: 90,
		height: 90,
		shape: 'rect'
	};
}

function setting(key: string, value: unknown): Row {
	return { id: `set_${key}`, created: '', updated: '', restaurant: REST, key, value };
}

function seedBooking(over: Partial<Booking> & { id: string }): Booking {
	const row: Row = {
		created: '',
		updated: '',
		restaurant: REST,
		customer: 'cust1',
		party_size: 2,
		starts_at: THU_1900_Z,
		ends_at: THU_2100_Z,
		tables: ['t2'],
		service_period: 'dinner',
		status: 'confirmed',
		source: 'online',
		special_requests: '',
		occasion: '',
		...over
	};
	store['geisha_bookings'].push(row);
	return row as unknown as Booking;
}

// Flush any deferred side-effects still in flight from the previous test BEFORE
// resetting the store, so a late deferred audit can't bleed into the next test's
// freshly-cleared log. Then re-seed.
beforeEach(async () => {
	await flushDeferred();
	// PIN THE CLOCK. Every fixture is a FORWARD reservation (Thu 25 Jun 2026), and
	// amendBooking now refuses a guest amend of a booking that has already started
	// — so once real time drifted past the fixture date, three customer-actor tests
	// started failing for a reason unrelated to what they assert. Sit a few days
	// before the fixtures so "upcoming" means what the tests assume.
	//
	// Only `Date` is faked: deferWork resolves through real microtasks/timers, and
	// faking those would hang flushDeferred().
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-22T10:00:00.000Z'));
	seedBase();
});

afterEach(() => {
	vi.useRealTimers();
	onAcquireLock = null;
});

// --- tests ------------------------------------------------------------------

describe('amendBooking', () => {
	it('keeps the same table on a no-op same-time amend (excludes self)', async () => {
		const b = seedBooking({ id: 'b1', party_size: 2, tables: ['t2'] });
		const res = await amendBooking({ bookingId: b.id, partySize: 2 });
		// Smallest fit for 2 is t2 — and it must NOT see itself as occupied.
		expect(res.booking.tables).toEqual(['t2']);
		expect(res.booking.amended_from).toBe('b1');
	});

	it('re-allocates to a bigger join when the party grows past every single', async () => {
		// Party of 7 fits no single (max single is t6=6) but fits the t4+t6 join (=10).
		const b = seedBooking({ id: 'b2', party_size: 4, tables: ['t4'] });
		const res = await amendBooking({ bookingId: b.id, partySize: 7 });
		expect([...res.booking.tables].sort()).toEqual(['t4', 't6']);
		expect(res.booking.party_size).toBe(7);
	});

	it('shrinking re-allocates down to the smallest fitting single', async () => {
		const b = seedBooking({ id: 'b3', party_size: 6, tables: ['t6'] });
		const res = await amendBooking({ bookingId: b.id, partySize: 2 });
		expect(res.booking.tables).toEqual(['t2']);
	});

	it("does NOT report the booking's own table as taken (regression guard)", async () => {
		// Booking sits on t6 for 7pm. Another, unrelated booking holds t2+t4 at 7pm,
		// so the ONLY way a party of 2 can be re-seated is by reusing the freed self
		// table family. A party-only amend at the same time must succeed onto t6 or a
		// smaller free single without self-conflict.
		const self = seedBooking({ id: 'b4', party_size: 4, tables: ['t4'] });
		seedBooking({ id: 'other', party_size: 2, tables: ['t2'] });
		// keep party=4, same time: must keep t4 (its own table), not see it as busy.
		const res = await amendBooking({ bookingId: self.id, partySize: 4 });
		expect(res.booking.tables).toEqual(['t4']);
	});

	it('throws no_availability when nothing fits the new window', async () => {
		// Occupy every table at 7pm with other bookings, then try to grow self to 6.
		seedBooking({ id: 'oA', party_size: 2, tables: ['t2'] });
		seedBooking({ id: 'oB', party_size: 4, tables: ['t4'] });
		seedBooking({ id: 'oC', party_size: 6, tables: ['t6'] });
		const self = seedBooking({
			id: 'b5',
			party_size: 1,
			tables: [],
			starts_at: THU_1900_Z,
			ends_at: THU_2100_Z
		});
		await expect(amendBooking({ bookingId: self.id, partySize: 6 })).rejects.toMatchObject({
			code: 'no_availability'
		});
	});

	it('throws no_period for a GUEST amend outside any active service period', async () => {
		// Guest self-service amends stay strict — those are forward reservations.
		const b = seedBooking({ id: 'b6' });
		await expect(
			amendBooking({ bookingId: b.id, time: '02:00', actor: 'customer' })
		).rejects.toMatchObject({ code: 'no_period' });
	});

	it('a STAFF amend outside every service window falls back to the nearest period', async () => {
		// Manual-seat leniency (nearestPeriodFallback): a host must be able to re-time
		// or resize an off-window walk-in without a bogus "no service at that time".
		const b = seedBooking({ id: 'b6b' });
		const res = await amendBooking({ bookingId: b.id, time: '02:00' });
		expect(res.booking.service_period).toBe('dinner');
	});

	it('rejects amending a cancelled booking', async () => {
		const b = seedBooking({ id: 'b7', status: 'cancelled' });
		await expect(amendBooking({ bookingId: b.id, partySize: 3 })).rejects.toBeInstanceOf(
			BookingError
		);
	});

	it('crossing the 6+ deposit threshold returns paymentChanged + deposit', async () => {
		// Starts with no payment (party 4). Grow to 6 -> £10pp deposit band.
		stripeConfigured = true;
		const b = seedBooking({ id: 'b8', party_size: 4, tables: ['t4'] });
		const res = await amendBooking({ bookingId: b.id, partySize: 6 });
		expect(res.paymentChanged).toBe(true);
		expect(res.payment.kind).toBe('deposit');
		expect(res.payment.amountPence).toBe(6 * 1000);
	});

	it('with NO payment provider connected, crossing the 6+ threshold demands nothing', async () => {
		// ResDiary parity, and the fix for the worst defect in the July QA sweep: with
		// no provider there is no deposit feature, so growing a party must NOT strand
		// the booking in a payment state that nobody can ever clear. Before this gate,
		// the live rules (deposit 6+ any day, no-show hold party 1+ every Fri/Sat)
		// silently made every such booking permanently unconfirmable.
		stripeConfigured = false;
		try {
			const b = seedBooking({ id: 'b8b', party_size: 4, tables: ['t4'] });
			const res = await amendBooking({ bookingId: b.id, partySize: 6 });
			expect(res.payment.kind).toBe('none');
			expect(res.payment.amountPence).toBe(0);
			expect(res.paymentChanged).toBe(false);
		} finally {
			stripeConfigured = true;
		}
	});

	it('staying within the same (none) band returns paymentChanged=false', async () => {
		const b = seedBooking({ id: 'b9', party_size: 2, tables: ['t2'] });
		const res = await amendBooking({ bookingId: b.id, partySize: 4 });
		expect(res.paymentChanged).toBe(false);
		expect(res.payment.kind).toBe('none');
	});

	it('enforces the online cap only for customer-actor amends', async () => {
		const b = seedBooking({ id: 'b10', party_size: 2, tables: ['t2'] });
		// online_party_max is 8 -> 9 must be phone-only for a guest.
		await expect(
			amendBooking({ bookingId: b.id, partySize: 9, actor: 'customer' })
		).rejects.toMatchObject({ code: 'phone_required' });
		// staff/AI bypass the cap (availability still applies; 9 fits the join max 10).
		const res = await amendBooking({ bookingId: b.id, partySize: 9, actor: 'staff' });
		expect([...res.booking.tables].sort()).toEqual(['t4', 't6']);
	});

	// ---- guest self-service guards -----------------------------------------
	//
	// /book/[token] has no payment step and no staff in the loop, so amendBooking
	// is the ONLY thing standing between a valid link and a free upgrade. These
	// cover the four ways that used to be open.

	describe('guest self-service (actor: customer)', () => {
		function paymentRow(over: Record<string, unknown>): void {
			store['geisha_payments'].push({
				id: `pay_${++idSeq}`,
				created: '',
				updated: '',
				kind: 'deposit',
				status: 'Captured',
				amount: 0,
				dojo_payment_intent_id: 'pi_x',
				captured_at: '',
				reversed_at: '',
				...over
			} as Row);
		}

		it('refuses an amend that would newly demand a deposit, and writes NOTHING', async () => {
			// The headline bypass: a party of 2 needs no deposit, a party of 6 needs
			// £10pp. The amend used to be written first and the deposit merely
			// ANNOUNCED, leaving a 6-cover table confirmed for £0.
			const b = seedBooking({ id: 'g1', party_size: 2, tables: ['t2'] });
			await expect(
				amendBooking({ bookingId: b.id, partySize: 6, actor: 'customer' })
			).rejects.toMatchObject({ code: 'phone_required' });

			const row = store['geisha_bookings'].find((r) => r.id === 'g1');
			expect(row?.party_size).toBe(2); // unchanged
			expect(row?.tables).toEqual(['t2']);
		});

		it('allows a DOWNGRADE that releases money rather than demanding it', async () => {
			const b = seedBooking({ id: 'g2', party_size: 6, tables: ['t6'] });
			paymentRow({ booking: 'g2', kind: 'deposit', status: 'Captured', amount: 6000 });
			const res = await amendBooking({ bookingId: b.id, partySize: 2, actor: 'customer' });
			expect(res.booking.party_size).toBe(2);
			expect(res.payment.kind).toBe('none');
		});

		it('allows a plain time change when the figure is unchanged', async () => {
			const b = seedBooking({ id: 'g3', party_size: 6, tables: ['t6'] });
			paymentRow({ booking: 'g3', kind: 'deposit', status: 'Captured', amount: 6000 });
			const res = await amendBooking({ bookingId: b.id, time: '19:30', actor: 'customer' });
			expect(res.booking.starts_at).toBe('2026-06-25T18:30:00.000Z');
		});

		it('refuses to touch a SEATED or COMPLETED booking (staff still may)', async () => {
			// A guest rescheduling a party that is physically at a table mid-service
			// used to drag the live floor plan with it via syncFloorStateTables.
			for (const status of ['seated', 'completed'] as const) {
				const b = seedBooking({ id: `g4_${status}`, status, party_size: 2, tables: ['t2'] });
				await expect(
					amendBooking({ bookingId: b.id, time: '19:30', actor: 'customer' })
				).rejects.toBeInstanceOf(BookingError);
				// the diary must keep working on exactly the same row
				const ok = await amendBooking({ bookingId: b.id, time: '19:30', actor: 'staff' });
				expect(ok.booking.starts_at).toBe('2026-06-25T18:30:00.000Z');
			}
		});

		it('refuses a booking whose sitting has already begun', async () => {
			vi.setSystemTime(new Date('2026-06-25T18:30:00.000Z')); // half an hour in
			const b = seedBooking({ id: 'g5', party_size: 2, tables: ['t2'] });
			await expect(
				amendBooking({ bookingId: b.id, time: '20:00', actor: 'customer' })
			).rejects.toMatchObject({ code: 'invalid' });
		});

		it('refuses a move beyond the booking window (staff may still)', async () => {
			// booking_window_days is 60; 2026-10-01 is ~101 days out from the pinned now.
			const b = seedBooking({ id: 'g6', party_size: 2, tables: ['t2'] });
			await expect(
				amendBooking({ bookingId: b.id, date: '2026-10-01', time: '19:00', actor: 'customer' })
			).rejects.toMatchObject({ code: 'invalid' });
			const ok = await amendBooking({
				bookingId: b.id,
				date: '2026-10-01',
				time: '19:00',
				actor: 'staff'
			});
			expect(ok.booking.starts_at).toBe('2026-10-01T18:00:00.000Z');
		});

		it('does NOT refuse a band crossing when no payment provider is connected', async () => {
			// The refusal is gated on requirementIfCollectable, so a venue with no
			// Stripe — or one whose live key is still behind STRIPE_ALLOW_LIVE, which
			// is production's state today — has no deposit to collect, and must not
			// have guest amends blocked by a guard protecting money that was never
			// going to be taken. This is the ResDiary-parity posture from
			// requirementIfCollectable(), and the reason the fix arms itself at the
			// same moment deposits do rather than needing a second switch.
			stripeConfigured = false;
			try {
				const b = seedBooking({ id: 'g8', party_size: 2, tables: ['t2'] });
				const res = await amendBooking({ bookingId: b.id, partySize: 6, actor: 'customer' });
				expect(res.booking.party_size).toBe(6);
				expect(res.payment.kind).toBe('none');
			} finally {
				stripeConfigured = true;
			}
		});

		it('refuses a guest who has been blocked after a no-show', async () => {
			// "blocked" is a TAG on the customer, not a column (see crm.isCustomerBlocked).
			store['geisha_customers'][0].tags = ['blocked'];
			const b = seedBooking({ id: 'g7', party_size: 2, tables: ['t2'] });
			await expect(
				amendBooking({ bookingId: b.id, time: '19:30', actor: 'customer' })
			).rejects.toMatchObject({ code: 'blocked' });
		});
	});

	it('writes an audit row with action=amend_booking, actor + on_behalf_of', async () => {
		const b = seedBooking({ id: 'b11', party_size: 2, tables: ['t2'] });
		await amendBooking({ bookingId: b.id, partySize: 2, actor: 'ai', onBehalfOf: 'staff42' });
		await flushDeferred(); // audit is written off the response path
		const log = store['geisha_audit_log'].find((r) => r.action === 'amend_booking');
		expect(log).toBeTruthy();
		expect(log?.actor).toBe('ai');
		expect(log?.entity_id).toBe('b11');
		expect(log?.on_behalf_of).toBe('staff42');
	});

	// --- pinned tableIds (diary drag-to-move) -------------------------------
	describe('pinned tableIds (drag-to-move)', () => {
		it('moves the booking onto the dropped table when it is free + fits', async () => {
			const b = seedBooking({ id: 'p1', party_size: 2, tables: ['t2'] });
			// Drag a 2-top onto t6 (free, fits) — must pin to t6, not auto-allocate t2.
			const res = await amendBooking({ bookingId: b.id, tableIds: ['t6'] });
			expect(res.booking.tables).toEqual(['t6']);
		});

		it('rejects a drop onto a table that is already occupied', async () => {
			seedBooking({ id: 'occ', party_size: 4, tables: ['t4'] }); // t4 busy at 19:00
			const b = seedBooking({ id: 'p2', party_size: 2, tables: ['t2'] });
			await expect(amendBooking({ bookingId: b.id, tableIds: ['t4'] })).rejects.toMatchObject({
				code: 'no_availability'
			});
		});

		it('rejects a drop onto a table too small for the party', async () => {
			const b = seedBooking({ id: 'p3', party_size: 6, tables: ['t6'] });
			// t2 (max 2) can't hold 6 — pinned set must be rejected, not silently shrunk.
			await expect(amendBooking({ bookingId: b.id, tableIds: ['t2'] })).rejects.toMatchObject({
				code: 'no_availability'
			});
		});

		it('allowOverfill keeps the table even when the bigger party exceeds its seats (ResDiary change-covers)', async () => {
			// A 2-top on t2 (max 2). Grow to 5 KEEPING t2 — allowed with allowOverfill,
			// mirroring ResDiary "increase covers without table reassignment".
			const b = seedBooking({ id: 'p5', party_size: 2, tables: ['t2'] });
			const res = await amendBooking({
				bookingId: b.id,
				partySize: 5,
				tableIds: ['t2'],
				allowOverfill: true
			});
			expect(res.booking.tables).toEqual(['t2']);
			expect(res.booking.party_size).toBe(5);
		});

		// The diary's change-covers write says `keepTables` rather than naming the tables,
		// so it no longer has to read the booking first purely to look them up — one fewer
		// sequential round trip on a write that measures ~3.2s against the droplet.
		it('keepTables pins the booking\x27s own tables without the caller naming them', async () => {
			const b = seedBooking({ id: 'kt1', party_size: 2, tables: ['t2'] });
			const res = await amendBooking({ bookingId: b.id, partySize: 5, keepTables: true, allowOverfill: true });
			expect(res.booking.tables).toEqual(['t2']);
			expect(res.booking.party_size).toBe(5);
		});

		it('keepTables is ignored when explicit tableIds are given', async () => {
			const b = seedBooking({ id: 'kt2', party_size: 2, tables: ['t2'] });
			const res = await amendBooking({ bookingId: b.id, tableIds: ['t4'], keepTables: true });
			expect(res.booking.tables).toEqual(['t4']);
		});

		it('allowOverfill still refuses to overlap another booking on the pinned table', async () => {
			// t4 is held by another booking for the same window — even with allowOverfill,
			// we never double-book it.
			seedBooking({ id: 'occ2', party_size: 4, tables: ['t4'] });
			const b = seedBooking({ id: 'p6', party_size: 2, tables: ['t2'] });
			await expect(
				amendBooking({ bookingId: b.id, partySize: 8, tableIds: ['t4'], allowOverfill: true })
			).rejects.toMatchObject({ code: 'no_availability' });
		});

		it('lets a booking drop back onto its own table (excludes self)', async () => {
			const b = seedBooking({ id: 'p4', party_size: 4, tables: ['t4'] });
			// Re-pin to its current table + a small time nudge: must not self-block.
			const res = await amendBooking({ bookingId: b.id, tableIds: ['t4'], time: '19:15' });
			expect(res.booking.tables).toEqual(['t4']);
		});

		// Owner: a party of 15 on counter tables 50–54 (10 seats) could not be moved 17:30 →
		// 17:45, even through "Seat anyway" — the override is manager-only, so a host's
		// re-time on the party's OWN tables was refused as a capacity squeeze it wasn't making.
		it('re-times a party already over capacity on its OWN tables without allowOverfill', async () => {
			const b = seedBooking({ id: 'oc1', party_size: 9, tables: ['t2', 't4'] }); // 6 seats
			const res = await amendBooking({ bookingId: b.id, tableIds: ['t4', 't2'], time: '19:15' });
			expect([...(res.booking.tables ?? [])].sort()).toEqual(['t2', 't4']);
			expect(res.booking.party_size).toBe(9);
			expect(res.booking.starts_at).toBe('2026-06-25T18:15:00.000Z'); // 19:15 BST
		});

		it('still refuses to GROW an over-capacity party on its own tables without allowOverfill', async () => {
			const b = seedBooking({ id: 'oc2', party_size: 9, tables: ['t2', 't4'] });
			await expect(
				amendBooking({ bookingId: b.id, tableIds: ['t2', 't4'], partySize: 10 })
			).rejects.toMatchObject({ code: 'no_availability' });
		});

		it('still refuses to move an over-capacity party onto OTHER tables without allowOverfill', async () => {
			const b = seedBooking({ id: 'oc3', party_size: 9, tables: ['t2', 't4'] });
			await expect(amendBooking({ bookingId: b.id, tableIds: ['t6'] })).rejects.toMatchObject({
				code: 'no_availability'
			});
		});
	});

	describe('duration handling', () => {
		const durMin = (b: { starts_at: string; ends_at: string }) =>
			(new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000;

		it('a move (time change, same party) PRESERVES a custom duration', async () => {
			// seed a deliberately-short 90-min sitting (a prior resize)
			const b = seedBooking({
				id: 'dur1',
				party_size: 2,
				tables: ['t2'],
				starts_at: THU_1900_Z,
				ends_at: '2026-06-25T19:30:00.000Z' // 90 min
			});
			const res = await amendBooking({ bookingId: b.id, time: '19:30' });
			expect(durMin(res.booking)).toBe(90); // NOT snapped back to the 90/party default
		});

		it('an explicit durationMinutes override wins', async () => {
			const b = seedBooking({ id: 'dur2', party_size: 2, tables: ['t2'] });
			const res = await amendBooking({ bookingId: b.id, durationMinutes: 75 });
			expect(durMin(res.booking)).toBe(75);
		});

		it('a party-size change recomputes the turn (no stale custom length)', async () => {
			// start at a custom 90-min length, then grow to 6 → should become 150 (ladder)
			const b = seedBooking({
				id: 'dur3',
				party_size: 2,
				tables: ['t2'],
				starts_at: THU_1900_Z,
				ends_at: '2026-06-25T19:30:00.000Z'
			});
			const res = await amendBooking({ bookingId: b.id, partySize: 6 });
			expect(durMin(res.booking)).toBe(150);
		});
	});
});

// ---- moving a booking to the OTHER venue (ResDiary "change venue") ----------
//
// The client's ask, Oct 2026: ResDiary let staff switch a booking between Asia and
// Fusion, but couldn't carry an online deposit across (its move was a cancel +
// re-book, and a cancel refunds). Here the SAME row changes venue, so the payment —
// which hangs off the booking id — simply stays attached.
describe('amendBooking — move to the other venue', () => {
	const FUSION = 'rest2';

	function seedFusion() {
		store['geisha_restaurants'].push({
			id: FUSION,
			created: '',
			updated: '',
			brand: 'fusion',
			display_name: 'Geisha Fusion',
			timezone: TZ
		});
		store['geisha_service_periods'].push({
			id: 'f_dinner',
			created: '',
			updated: '',
			restaurant: FUSION,
			name: 'Dinner',
			days_of_week: [0, 1, 2, 3, 4, 5, 6],
			start_time: '17:00',
			end_time: '23:00',
			last_booking_time: '21:30',
			default_turn_minutes: 120,
			active: true
		});
		store['geisha_tables'].push(
			{ ...mkTable('f2', 1, 2), restaurant: FUSION },
			{ ...mkTable('f4', 2, 4), restaurant: FUSION }
		);
	}

	beforeEach(() => seedFusion());

	it("re-homes the booking on the target venue's tables and service", async () => {
		const b = seedBooking({ id: 'mv1', party_size: 4, tables: ['t4'] });
		const res = await amendBooking({ bookingId: b.id, restaurantId: FUSION, actor: 'staff' });
		expect(res.booking.restaurant).toBe(FUSION);
		expect(res.booking.tables).toEqual(['f4']);
		expect(res.booking.service_period).toBe('f_dinner');
		expect(res.booking.starts_at).toBe(THU_1900_Z); // same date and time
	});

	it('keeps a paid deposit attached, untouched, with no refund', async () => {
		const b = seedBooking({ id: 'mv2', party_size: 2, tables: ['t2'] });
		store['geisha_payments'].push({
			id: 'pay_mv2',
			created: '',
			updated: '',
			booking: 'mv2',
			kind: 'deposit',
			status: 'Captured',
			amount: 2000,
			dojo_payment_intent_id: 'pi_paid',
			captured_at: '2026-06-20 12:00:00.000Z',
			reversed_at: ''
		} as Row);
		const stripe = await import('../payments/stripe.js');
		const refund = vi.spyOn(stripe, 'refundPaymentIntent');

		await amendBooking({ bookingId: b.id, restaurantId: FUSION, actor: 'staff' });

		const pay = store['geisha_payments'].find((p) => p.id === 'pay_mv2');
		expect(pay).toMatchObject({ booking: 'mv2', status: 'Captured', amount: 2000, reversed_at: '' });
		expect(refund).not.toHaveBeenCalled();
	});

	it("does not carry the old venue's tables across, even when asked to keep tables", async () => {
		const b = seedBooking({ id: 'mv3', party_size: 2, tables: ['t2'] });
		const res = await amendBooking({
			bookingId: b.id,
			restaurantId: FUSION,
			keepTables: true,
			actor: 'staff'
		});
		expect(res.booking.tables).toEqual(['f2']);
	});

	it('pins the tables the host picked at the target venue', async () => {
		const b = seedBooking({ id: 'mv4', party_size: 2, tables: ['t2'] });
		const res = await amendBooking({
			bookingId: b.id,
			restaurantId: FUSION,
			tableIds: ['f4'],
			actor: 'staff'
		});
		expect(res.booking.tables).toEqual(['f4']);
	});

	it('refuses a party that is already seated, and writes nothing', async () => {
		const b = seedBooking({ id: 'mv5', status: 'seated' });
		await expect(
			amendBooking({ bookingId: b.id, restaurantId: FUSION, actor: 'staff' })
		).rejects.toMatchObject({ code: 'invalid' });
		expect(store['geisha_bookings'].find((r) => r.id === 'mv5')?.restaurant).toBe(REST);
	});

	it('refuses a guest or the AI moving venue', async () => {
		const b = seedBooking({ id: 'mv6' });
		for (const actor of ['customer', 'ai'] as const) {
			await expect(
				amendBooking({ bookingId: b.id, restaurantId: FUSION, actor })
			).rejects.toMatchObject({ code: 'invalid' });
		}
		expect(store['geisha_bookings'].find((r) => r.id === 'mv6')?.restaurant).toBe(REST);
	});

	it('refuses when the target venue has no free table, and writes nothing', async () => {
		const b = seedBooking({ id: 'mv7', party_size: 8, tables: ['t4', 't6'] });
		await expect(
			amendBooking({ bookingId: b.id, restaurantId: FUSION, actor: 'staff' })
		).rejects.toMatchObject({ code: 'no_availability' });
		expect(store['geisha_bookings'].find((r) => r.id === 'mv7')?.restaurant).toBe(REST);
	});

	it('treats naming the current venue as an ordinary amend', async () => {
		const b = seedBooking({ id: 'mv8', party_size: 2, tables: ['t2'] });
		const res = await amendBooking({ bookingId: b.id, restaurantId: REST, actor: 'staff' });
		expect(res.booking.restaurant).toBe(REST);
		expect(res.booking.tables).toEqual(['t2']);
	});
});

describe('swapBookingTables', () => {
	const tablesOf = (id: string) => store['geisha_bookings'].find((r) => r.id === id)?.tables;

	it('exchanges the two bookings tables (same time → time unchanged)', async () => {
		// A (2-top) on t4, B (4-top) on t6 at the SAME time — both fit both tables. A
		// positional swap trades tables; times are identical so starts_at is unchanged.
		const a = seedBooking({ id: 's1', party_size: 2, tables: ['t4'] });
		const b = seedBooking({ id: 's2', party_size: 4, tables: ['t6'] });
		const res = await swapBookingTables(a.id, b.id);
		expect(res.a.tables).toEqual(['t6']);
		expect(res.b.tables).toEqual(['t4']);
		expect(res.a.starts_at).toBe(THU_1900_Z);
		expect(res.b.starts_at).toBe(THU_1900_Z);
		expect(tablesOf('s1')).toEqual(['t6']);
		expect(tablesOf('s2')).toEqual(['t4']);
	});

	it('POSITIONAL swap trades table AND time, each keeping its own length', async () => {
		// A: t4, 19:00–21:00 (2h). B: t6, 20:00–22:00 (2h). After the swap A takes B's
		// slot (t6, 20:00) and B takes A's (t4, 19:00); each keeps its own 2h length.
		const B_START = '2026-06-25T19:00:00.000Z'; // 20:00 local
		const B_END = '2026-06-25T21:00:00.000Z'; // 22:00 local
		const a = seedBooking({
			id: 's3',
			party_size: 2,
			tables: ['t4'],
			starts_at: THU_1900_Z,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 's4',
			party_size: 4,
			tables: ['t6'],
			starts_at: B_START,
			ends_at: B_END
		});
		const res = await swapBookingTables(a.id, b.id);
		expect(res.a.tables).toEqual(['t6']);
		expect(res.a.starts_at).toBe(B_START); // A took B's start
		expect(res.b.tables).toEqual(['t4']);
		expect(res.b.starts_at).toBe(THU_1900_Z); // B took A's start
	});

	it('HONOR-DROP: A lands at the dropped time on B’s table; B keeps its OWN time', async () => {
		// The diary drag: A (t4, 19:00) is dropped at 15:00 onto B (t6, 20:00). A must land at
		// 15:00 on t6 (NOT snap to B's 20:00), and B must keep its own 20:00, only moving to t4.
		const DROP_START_Z = '2026-06-25T14:00:00.000Z'; // 15:00 local
		const DROP_END_Z = '2026-06-25T16:00:00.000Z'; // +2h (A's length)
		const B_START = '2026-06-25T19:00:00.000Z'; // 20:00 local
		const B_END = '2026-06-25T21:00:00.000Z';
		const a = seedBooking({
			id: 'hd1',
			party_size: 2,
			tables: ['t4'],
			starts_at: THU_1900_Z,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'hd2',
			party_size: 4,
			tables: ['t6'],
			starts_at: B_START,
			ends_at: B_END
		});
		const res = await swapBookingTables(a.id, b.id, { newStartA: DROP_START_Z });
		expect(res.a.tables).toEqual(['t6']); // A → B's table
		expect(res.a.starts_at).toBe(DROP_START_Z); // …at the DROPPED time, not B's start
		expect(res.a.ends_at).toBe(DROP_END_Z); // …keeping A's 2h length
		expect(res.b.tables).toEqual(['t4']); // B → A's table
		expect(res.b.starts_at).toBe(B_START); // …keeping its OWN time
		expect(res.b.ends_at).toBe(B_END);
	});

	it('HONOR-DROP still refuses a THIRD booking clash at the dropped window', async () => {
		// A dropped at 20:00 onto B's table t6, but a third booking already holds t6 at 20:00.
		const DROP_START_Z = '2026-06-25T19:00:00.000Z'; // 20:00 local
		const a = seedBooking({
			id: 'hd3',
			party_size: 2,
			tables: ['t4'],
			starts_at: THU_1900_Z,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'hd4',
			party_size: 4,
			tables: ['t6'],
			starts_at: THU_1900_Z,
			ends_at: THU_2100_Z
		});
		seedBooking({
			id: 'hd5',
			party_size: 4,
			tables: ['t6'],
			starts_at: '2026-06-25T19:00:00.000Z', // 20:00 local — overlaps A's dropped window
			ends_at: '2026-06-25T21:00:00.000Z'
		});
		await expect(swapBookingTables(a.id, b.id, { newStartA: DROP_START_Z })).rejects.toMatchObject({
			code: 'no_availability'
		});
	});

	it('swaps two bookings on the SAME table at different times (trades slots)', async () => {
		// Both on t4 — one at 19:00, one at 20:00. A positional swap trades their times
		// while both stay on t4. This is the "same table, different times" case.
		const T2000 = '2026-06-25T19:00:00.000Z'; // 20:00 local
		const T2200 = '2026-06-25T21:00:00.000Z';
		const a = seedBooking({
			id: 's3b',
			party_size: 2,
			tables: ['t4'],
			starts_at: THU_1900_Z,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 's4b',
			party_size: 2,
			tables: ['t4'],
			starts_at: T2000,
			ends_at: T2200
		});
		const res = await swapBookingTables(a.id, b.id);
		expect(res.a.tables).toEqual(['t4']);
		expect(res.b.tables).toEqual(['t4']);
		expect(res.a.starts_at).toBe(T2000); // A took B's time
		expect(res.b.starts_at).toBe(THU_1900_Z); // B took A's time
	});

	// 2026-09-11, Asia: a 14 joined across two tables and an 8 on one. Exchanging the sets put
	// the 14 on the single 8-top; the diary now sends where EACH lands (each party keeping its
	// own table count — joinMove.swapTableSets) and the server writes exactly that.
	describe('with explicit destinations from the diary', () => {
		it('writes each booking to the tables sent — each party keeps its own table count', async () => {
			const a = seedBooking({ id: 'j1', party_size: 2, tables: ['t2'] });
			const b = seedBooking({ id: 'j2', party_size: 6, tables: ['t4', 't6'] });
			const res = await swapBookingTables(a.id, b.id, {
				targetTablesA: ['t6'],
				targetTablesB: ['t2', 't4']
			});
			expect(res.a.tables).toEqual(['t6']);
			expect(res.b.tables).toEqual(['t2', 't4']);
			expect(res.b.party_size).toBe(6);
		});

		// The same evening: a second owner swapped the pair 22s after the first, from a screen
		// that hadn't caught up — and because the server exchanged whatever the tables were by
		// then, it REVERSED the first swap. Explicit destinations mean a swap does what the
		// screen it came from showed.
		it('does what the sending screen showed, never reversing a swap it had not seen', async () => {
			// Already swapped by someone else: A on t6, B on t2.
			const a = seedBooking({ id: 'j3', party_size: 2, tables: ['t6'] });
			const b = seedBooking({ id: 'j4', party_size: 2, tables: ['t2'] });
			const res = await swapBookingTables(a.id, b.id, {
				targetTablesA: ['t6'],
				targetTablesB: ['t2'],
				newStartA: THU_1900_Z
			});
			expect(res.a.tables).toEqual(['t6']);
			expect(res.b.tables).toEqual(['t2']);
		});

		it('refuses destinations that put the two bookings on one table at the same time', async () => {
			const a = seedBooking({ id: 'j5', party_size: 2, tables: ['t2'] });
			const b = seedBooking({ id: 'j6', party_size: 2, tables: ['t6'] });
			await expect(
				swapBookingTables(a.id, b.id, { targetTablesA: ['t4'], targetTablesB: ['t4'] })
			).rejects.toMatchObject({ code: 'no_availability' });
			expect(tablesOf('j5')).toEqual(['t2']);
			expect(tablesOf('j6')).toEqual(['t6']);
		});

		it('refuses a destination for only one of the two', async () => {
			const a = seedBooking({ id: 'j7', party_size: 2, tables: ['t2'] });
			const b = seedBooking({ id: 'j8', party_size: 2, tables: ['t6'] });
			await expect(swapBookingTables(a.id, b.id, { targetTablesA: ['t6'] })).rejects.toMatchObject({
				code: 'invalid'
			});
		});
	});

	it('rejects when a booking is too big for the other table (no shrink override)', async () => {
		// B is a 6-top on t6; swapping onto t2 (max 2) can't fit and NO override → reject.
		const a = seedBooking({ id: 's5', party_size: 2, tables: ['t2'] });
		const b = seedBooking({ id: 's6', party_size: 6, tables: ['t6'] });
		await expect(swapBookingTables(a.id, b.id)).rejects.toMatchObject({ code: 'no_availability' });
		// nothing written on the failed swap
		expect(tablesOf('s5')).toEqual(['t2']);
		expect(tablesOf('s6')).toEqual(['t6']);
	});

	it('allowOverfill swaps an oversize party onto the small table WITHOUT shrinking it', async () => {
		// B (6-top on t6) swaps onto t2 (max 2). The diary allows it and flags the booking
		// over-capacity — the covers must NOT be reduced to 2.
		const a = seedBooking({ id: 's5b', party_size: 2, tables: ['t2'] });
		const b = seedBooking({ id: 's6b', party_size: 6, tables: ['t6'] });
		const res = await swapBookingTables(a.id, b.id, { allowOverfill: true });
		expect(res.a.tables).toEqual(['t6']);
		expect(res.b.tables).toEqual(['t2']);
		expect(res.b.party_size).toBe(6); // party KEPT, not shrunk to t2's 2 seats
		expect(res.a.party_size).toBe(2);
	});

	it('allowOverfill still refuses to overlap a THIRD booking on a destination table', async () => {
		// Waiving the seats-fit ceiling must never waive the free-for-the-window check.
		const a = seedBooking({ id: 's5c', party_size: 2, tables: ['t2'] });
		const b = seedBooking({ id: 's6c', party_size: 6, tables: ['t6'] });
		// a THIRD booking holds t2 20:00–22:00 local, overlapping B's new 19:00–21:00 window there
		seedBooking({
			id: 's6d',
			party_size: 2,
			tables: ['t2'],
			starts_at: '2026-06-25T19:00:00.000Z',
			ends_at: '2026-06-25T21:00:00.000Z'
		});
		await expect(swapBookingTables(a.id, b.id, { allowOverfill: true })).rejects.toMatchObject({
			code: 'no_availability'
		});
	});

	it('rejects when a THIRD booking already occupies a destination table', async () => {
		// A (2-top) on t4, B (2-top) on t6 — a clean pair. A THIRD booking sits on t4 at a
		// PARTIALLY-OVERLAPPING later window (so it's a distinct footprint, not confused
		// with A), so B (moving to t4) would clash with it → no_availability.
		const a = seedBooking({
			id: 's7',
			party_size: 2,
			tables: ['t4'],
			starts_at: THU_1900_Z,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 's8',
			party_size: 2,
			tables: ['t6'],
			starts_at: THU_1900_Z,
			ends_at: THU_2100_Z
		});
		// t4 held 20:00–22:00 by a third party — overlaps B's 19:00–21:00, distinct window.
		seedBooking({
			id: 's9',
			party_size: 2,
			tables: ['t4'],
			starts_at: '2026-06-25T19:00:00.000Z', // 20:00 local
			ends_at: '2026-06-25T21:00:00.000Z' // 22:00 local
		});
		await expect(swapBookingTables(a.id, b.id)).rejects.toMatchObject({ code: 'no_availability' });
	});

	it('refuses to swap a booking with itself', async () => {
		const a = seedBooking({ id: 's10', party_size: 2, tables: ['t2'] });
		await expect(swapBookingTables(a.id, a.id)).rejects.toBeInstanceOf(BookingError);
	});

	it('refuses when a booking is not seated at a table', async () => {
		const a = seedBooking({ id: 's11', party_size: 2, tables: ['t2'] });
		const b = seedBooking({ id: 's12', party_size: 2, tables: [] }); // unseated
		await expect(swapBookingTables(a.id, b.id)).rejects.toBeInstanceOf(BookingError);
	});

	it('refuses to swap a cancelled booking', async () => {
		const a = seedBooking({ id: 's13', party_size: 2, tables: ['t2'] });
		const b = seedBooking({ id: 's14', party_size: 2, tables: ['t4'], status: 'cancelled' });
		await expect(swapBookingTables(a.id, b.id)).rejects.toBeInstanceOf(BookingError);
	});

	it('writes an audit row for BOTH legs of the swap', async () => {
		const a = seedBooking({ id: 's15', party_size: 2, tables: ['t4'] });
		const b = seedBooking({ id: 's16', party_size: 4, tables: ['t6'] });
		await swapBookingTables(a.id, b.id, { actor: 'staff', onBehalfOf: 'staff7' });
		await flushDeferred(); // audit is written off the response path
		const logs = store['geisha_audit_log'].filter((r) => r.action === 'amend_booking');
		const ids = logs.map((l) => l.entity_id);
		expect(ids).toContain('s15');
		expect(ids).toContain('s16');
		expect(logs.every((l) => l.on_behalf_of === 'staff7')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// applyBookingBatch — the all-or-nothing diary "Confirm changes" commit. These
// tests exercise the exact scenarios that broke the old fan-out commit: swaps,
// 3-way rotations, cross-time chains, vacate-and-fill (no false "already booked"),
// boundary-touch, intra-batch collisions, and third-booking clashes.
// Local time note: THU_1900_Z (18:00Z) == 19:00 local BST; entry `time` is local HH:mm.
// ---------------------------------------------------------------------------
describe('applyBookingBatch', () => {
	const tablesOf = (id: string) => store['geisha_bookings'].find((r) => r.id === id)?.tables;
	const startOf = (id: string) => store['geisha_bookings'].find((r) => r.id === id)?.starts_at;
	const partyOf = (id: string) => store['geisha_bookings'].find((r) => r.id === id)?.party_size;
	// local wall-clock helpers for the fixtures' service window (BST = Z+1h)
	const T1900 = THU_1900_Z; // 19:00 local
	const T2000_Z = '2026-06-25T19:00:00.000Z'; // 20:00 local
	const T2200_Z = '2026-06-25T21:00:00.000Z'; // 22:00 local

	it('commits a 2-way swap as one batch (each takes the other table + time)', async () => {
		// A on t4 @19:00 (2h), B on t6 @20:00 (2h). Batch sends each booking's FINAL slot.
		const a = seedBooking({
			id: 'ba1',
			party_size: 2,
			tables: ['t4'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'ba2',
			party_size: 4,
			tables: ['t6'],
			starts_at: T2000_Z,
			ends_at: T2200_Z
		});
		const res = await applyBookingBatch([
			{ bookingId: a.id, tableIds: ['t6'], time: '20:00', durationMinutes: 120 },
			{ bookingId: b.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 }
		]);
		expect(res.bookings).toHaveLength(2);
		expect(tablesOf('ba1')).toEqual(['t6']);
		expect(startOf('ba1')).toBe(T2000_Z); // A took B's slot
		expect(tablesOf('ba2')).toEqual(['t4']);
		expect(startOf('ba2')).toBe(T1900); // B took A's slot
	});

	it('re-times a party already over capacity on its OWN tables (reshuffle / confirm path)', async () => {
		const b = seedBooking({ id: 'boc1', party_size: 9, tables: ['t2', 't4'] }); // 6 seats
		await applyBookingBatch([
			{ bookingId: b.id, tableIds: ['t2', 't4'], time: '19:15', durationMinutes: 120 }
		]);
		expect(startOf('boc1')).toBe('2026-06-25T18:15:00.000Z');
		expect(partyOf('boc1')).toBe(9);
	});

	it('still refuses to put an over-capacity party on OTHER tables in a batch', async () => {
		const b = seedBooking({ id: 'boc2', party_size: 9, tables: ['t2', 't4'] });
		await expect(
			applyBookingBatch([{ bookingId: b.id, tableIds: ['t6'], time: '19:00', durationMinutes: 120 }])
		).rejects.toMatchObject({ code: 'no_availability' });
	});

	it('commits a 3-WAY ROTATION atomically (the case that used to degrade to lone moves)', async () => {
		// A→t4, B→t6, C→t2, all @19:00. Each lands on the next booking's table. The old
		// per-leg commit clashed because each leg saw the others still on the target table.
		const a = seedBooking({ id: 'r1', party_size: 2, tables: ['t2'] });
		const b = seedBooking({ id: 'r2', party_size: 2, tables: ['t4'] });
		const c = seedBooking({ id: 'r3', party_size: 2, tables: ['t6'] });
		await applyBookingBatch([
			{ bookingId: a.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 },
			{ bookingId: b.id, tableIds: ['t6'], time: '19:00', durationMinutes: 120 },
			{ bookingId: c.id, tableIds: ['t2'], time: '19:00', durationMinutes: 120 }
		]);
		expect(tablesOf('r1')).toEqual(['t4']);
		expect(tablesOf('r2')).toEqual(['t6']);
		expect(tablesOf('r3')).toEqual(['t2']);
	});

	it('commits two bookings moving to DIFFERENT tables at different times', async () => {
		// A: t2 @19:00 → t4 @19:00. B: t6 @20:00 → t2 @20:00. Independent, non-clashing.
		const a = seedBooking({
			id: 'x1',
			party_size: 2,
			tables: ['t2'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'x2',
			party_size: 2,
			tables: ['t6'],
			starts_at: T2000_Z,
			ends_at: T2200_Z
		});
		await applyBookingBatch([
			{ bookingId: a.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 },
			{ bookingId: b.id, tableIds: ['t2'], time: '20:00', durationMinutes: 120 }
		]);
		expect(tablesOf('x1')).toEqual(['t4']);
		expect(tablesOf('x2')).toEqual(['t2']);
		expect(startOf('x2')).toBe(T2000_Z);
	});

	it('VACATE-AND-FILL: A leaves table 4 as B moves onto it — no false "already booked"', async () => {
		// The classic bug: B → t4 @19:00 while A (on t4 @19:00) moves off to t6. Because
		// BOTH are batch participants, B must not see A's vacated old footprint.
		const a = seedBooking({
			id: 'v1',
			party_size: 2,
			tables: ['t4'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'v2',
			party_size: 2,
			tables: ['t2'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		await applyBookingBatch([
			{ bookingId: a.id, tableIds: ['t6'], time: '19:00', durationMinutes: 120 },
			{ bookingId: b.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 }
		]);
		expect(tablesOf('v1')).toEqual(['t6']);
		expect(tablesOf('v2')).toEqual(['t4']);
	});

	it('BOUNDARY-TOUCH: two entries on the same table where one ends exactly as the other starts is NOT a clash', async () => {
		// A → t4 @19:00–20:00 (60m), B → t4 @20:00–21:00 (60m). Half-open [start,end): the
		// 20:00 boundary touch must NOT be treated as an overlap.
		const a = seedBooking({
			id: 'bt1',
			party_size: 2,
			tables: ['t2'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'bt2',
			party_size: 2,
			tables: ['t6'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		await applyBookingBatch([
			{ bookingId: a.id, tableIds: ['t4'], time: '19:00', durationMinutes: 60 },
			{ bookingId: b.id, tableIds: ['t4'], time: '20:00', durationMinutes: 60 }
		]);
		expect(tablesOf('bt1')).toEqual(['t4']);
		expect(tablesOf('bt2')).toEqual(['t4']);
		expect(startOf('bt1')).toBe(T1900);
		expect(startOf('bt2')).toBe(T2000_Z);
	});

	it('REJECTS an intra-batch collision (two entries want the same table + overlapping time) — nothing written', async () => {
		const a = seedBooking({
			id: 'ib1',
			party_size: 2,
			tables: ['t2'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'ib2',
			party_size: 2,
			tables: ['t6'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		await expect(
			applyBookingBatch([
				{ bookingId: a.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 },
				{ bookingId: b.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 }
			])
		).rejects.toMatchObject({ code: 'no_availability' });
		// all-or-nothing: neither booking moved
		expect(tablesOf('ib1')).toEqual(['t2']);
		expect(tablesOf('ib2')).toEqual(['t6']);
	});

	it('REJECTS when a THIRD (non-batch) booking already holds a target table — nothing written', async () => {
		const a = seedBooking({
			id: 'tb1',
			party_size: 2,
			tables: ['t2'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'tb2',
			party_size: 2,
			tables: ['t6'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		// A third booking sits on t4 across 19:00–21:00 — not part of the batch.
		seedBooking({
			id: 'tb3',
			party_size: 2,
			tables: ['t4'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		await expect(
			applyBookingBatch([
				{ bookingId: a.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 },
				{ bookingId: b.id, tableIds: ['t6'], time: '19:00', durationMinutes: 120 }
			])
		).rejects.toMatchObject({ code: 'no_availability' });
		expect(tablesOf('tb1')).toEqual(['t2']);
		expect(tablesOf('tb2')).toEqual(['t6']);
	});

	it('SHRINK on swap PRESERVES the leg length (explicit durationMinutes wins over the party-turn)', async () => {
		// A (6-top, t6, 19:00–21:00 = 120m) swaps onto t2 (max 2), shrunk to party 2. Without
		// an explicit duration the smaller party would recompute a shorter turn; the client
		// always sends the leg's current length, so 120m must be preserved.
		const a = seedBooking({
			id: 'sh1',
			party_size: 6,
			tables: ['t6'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'sh2',
			party_size: 2,
			tables: ['t2'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		await applyBookingBatch([
			{ bookingId: a.id, tableIds: ['t2'], time: '19:00', durationMinutes: 120, partySize: 2 },
			{ bookingId: b.id, tableIds: ['t6'], time: '19:00', durationMinutes: 120 }
		]);
		expect(tablesOf('sh1')).toEqual(['t2']);
		expect(partyOf('sh1')).toBe(2); // shrunk to fit t2
		// length preserved: 19:00 local + 120m = 21:00 local = THU_2100_Z
		expect(store['geisha_bookings'].find((r) => r.id === 'sh1')?.ends_at).toBe(THU_2100_Z);
	});

	it('is ALL-OR-NOTHING: one bad entry rejects the whole batch, leaving every booking untouched', async () => {
		const a = seedBooking({
			id: 'ao1',
			party_size: 2,
			tables: ['t2'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'ao2',
			party_size: 6,
			tables: ['t6'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		// A is a valid move; B is pinned to t2 (max 2) with NO shrink → fails seats-fit.
		await expect(
			applyBookingBatch([
				{ bookingId: a.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 },
				{ bookingId: b.id, tableIds: ['t2'], time: '19:00', durationMinutes: 120 }
			])
		).rejects.toMatchObject({ code: 'no_availability' });
		// A must NOT have been written even though its own entry was valid.
		expect(tablesOf('ao1')).toEqual(['t2']);
		expect(startOf('ao1')).toBe(T1900);
	});

	it('rejects a batch that names the same booking twice', async () => {
		const a = seedBooking({ id: 'dup1', party_size: 2, tables: ['t2'] });
		await expect(
			applyBookingBatch([
				{ bookingId: a.id, tableIds: ['t4'], time: '19:00' },
				{ bookingId: a.id, tableIds: ['t6'], time: '19:00' }
			])
		).rejects.toBeInstanceOf(BookingError);
	});

	it('rejects a batch containing a cancelled booking (whole batch fails)', async () => {
		const a = seedBooking({ id: 'cn1', party_size: 2, tables: ['t2'] });
		seedBooking({ id: 'cn2', party_size: 2, tables: ['t4'], status: 'cancelled' });
		await expect(
			applyBookingBatch([
				{ bookingId: a.id, tableIds: ['t4'], time: '19:00' },
				{ bookingId: 'cn2', tableIds: ['t2'], time: '19:00' }
			])
		).rejects.toBeInstanceOf(BookingError);
		expect(tablesOf('cn1')).toEqual(['t2']); // untouched
	});

	it('preserves a booking length on a plain move when no duration is sent and party is unchanged', async () => {
		// A resized sitting (150m) that is only MOVED (no durationMinutes, same party) keeps
		// its 150m rather than snapping to the party-size turn.
		const a = seedBooking({
			id: 'pl1',
			party_size: 2,
			tables: ['t2'],
			starts_at: T1900,
			ends_at: '2026-06-25T20:30:00.000Z' // 21:30 local = 150m
		});
		await applyBookingBatch([{ bookingId: a.id, tableIds: ['t4'], time: '19:00' }]);
		expect(tablesOf('pl1')).toEqual(['t4']);
		expect(store['geisha_bookings'].find((r) => r.id === 'pl1')?.ends_at).toBe(
			'2026-06-25T20:30:00.000Z'
		);
	});

	it('writes an audit row for EVERY booking in the batch', async () => {
		const a = seedBooking({
			id: 'au1',
			party_size: 2,
			tables: ['t2'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		const b = seedBooking({
			id: 'au2',
			party_size: 2,
			tables: ['t6'],
			starts_at: T1900,
			ends_at: THU_2100_Z
		});
		await applyBookingBatch(
			[
				{ bookingId: a.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 },
				{ bookingId: b.id, tableIds: ['t2'], time: '19:00', durationMinutes: 120 }
			],
			{ actor: 'staff', onBehalfOf: 'staff9' }
		);
		await flushDeferred(); // audit is written off the response path
		const logs = store['geisha_audit_log'].filter((r) => r.action === 'amend_booking');
		const ids = logs.map((l) => l.entity_id);
		expect(ids).toContain('au1');
		expect(ids).toContain('au2');
		expect(logs.every((l) => l.on_behalf_of === 'staff9')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// FINISHED ("closed") sittings stay editable from the diary. The owner's report:
// a table is closed at the end of service and turns its finished colour, but the
// host then needs to correct which table that party was on — and the bar refused
// to move. ResDiary allows it, so `completed` is amendable/swappable/batchable on
// the staff path. Truly-gone states (cancelled / no-show) stay pinned.
// ---------------------------------------------------------------------------
describe('finished sittings are still movable', () => {
	const tablesOf = (id: string) => store['geisha_bookings'].find((r) => r.id === id)?.tables;

	it('amends (re-tables) a completed booking', async () => {
		const b = seedBooking({ id: 'fin1', status: 'completed', tables: ['t2'] });
		const res = await amendBooking({ bookingId: b.id, tableIds: ['t4'], actor: 'staff' });
		expect(res.booking.tables).toEqual(['t4']);
	});

	it('moves a completed booking in a batch commit (the diary Confirm-changes path)', async () => {
		const b = seedBooking({ id: 'fin2', status: 'completed', tables: ['t2'] });
		await applyBookingBatch([
			{ bookingId: b.id, tableIds: ['t4'], time: '19:00', durationMinutes: 120 }
		]);
		expect(tablesOf('fin2')).toEqual(['t4']);
	});

	it('swaps a completed booking with a live one', async () => {
		const a = seedBooking({ id: 'fin3', status: 'completed', tables: ['t4'] });
		const b = seedBooking({ id: 'fin4', party_size: 2, tables: ['t2'] });
		await swapBookingTables(a.id, b.id, { actor: 'staff' });
		expect(tablesOf('fin3')).toEqual(['t2']);
		expect(tablesOf('fin4')).toEqual(['t4']);
	});

	it('still refuses a cancelled booking', async () => {
		const b = seedBooking({ id: 'fin5', status: 'cancelled', tables: ['t2'] });
		await expect(
			applyBookingBatch([{ bookingId: b.id, tableIds: ['t4'], time: '19:00' }])
		).rejects.toMatchObject({ code: 'invalid' });
	});

	it('still refuses a no-show booking', async () => {
		const b = seedBooking({ id: 'fin6', status: 'no_show', tables: ['t2'] });
		await expect(
			amendBooking({ bookingId: b.id, tableIds: ['t4'], actor: 'staff' })
		).rejects.toMatchObject({ code: 'invalid' });
	});
});

// ---------------------------------------------------------------------------
// RE-TIMING A SEATED PARTY (owner: "I move a booking earlier and after a refresh
// it's back where it was / it shrinks to nothing").
//
// The diary draws a SEATED bar from its real seat time, not its booked time (the
// ResDiary late-arrival trim in getDiaryTimeline). So a re-time that left the seat
// stamp behind was invisible: the next load pulled the bar straight back to the seat
// time — and if the new window ended BEFORE that stamp, the bar clamped to a
// 1-minute sliver. amendBooking/batch/swap now re-anchor the stamp whenever the
// START moves; a table-only change must NOT (a genuinely late sit-down is real
// history the trim should keep showing).
// ---------------------------------------------------------------------------
describe('a re-timed seated booking re-anchors its floor_state seat stamp', () => {
	const SEATED_LATE_Z = '2026-06-25T18:40:00.000Z'; // sat 19:40 local, booked 19:00
	const seatRowsFor = (bookingId: string) =>
		(store['geisha_floor_state'] ?? []).filter((r) => r.booking === bookingId);

	function seedSeated(id: string, tables: string[] = ['t2'], seatedAt = SEATED_LATE_Z) {
		const b = seedBooking({ id, status: 'seated', tables });
		store['geisha_floor_state'] ??= [];
		for (const t of tables) {
			store['geisha_floor_state'].push({
				id: `fs_${id}_${t}`,
				created: '',
				updated: '',
				booking: id,
				table: t,
				seated_at: seatedAt,
				cleared_at: ''
			});
		}
		return b;
	}

	it('follows the booking when the time moves EARLIER', async () => {
		const b = seedSeated('st1');
		await amendBooking({ bookingId: b.id, time: '17:30', actor: 'staff' });
		await flushDeferred();
		const rows = seatRowsFor('st1');
		expect(rows).toHaveLength(1);
		// 17:30 local (BST) = 16:30Z — the new booked start, not the 18:40Z seat time.
		expect(new Date(String(rows[0].seated_at)).toISOString()).toBe('2026-06-25T16:30:00.000Z');
	});

	it('does NOT touch the stamp on a table-only move (the late-arrival trim is real)', async () => {
		const b = seedSeated('st2');
		await amendBooking({ bookingId: b.id, tableIds: ['t4'], actor: 'staff' });
		await flushDeferred();
		const rows = seatRowsFor('st2');
		expect(rows).toHaveLength(1);
		expect(rows[0].table).toBe('t4'); // the row followed the table…
		expect(rows[0].seated_at).toBe(SEATED_LATE_Z); // …but they still sat when they sat
	});

	it('re-anchors every table of a joined party', async () => {
		const b = seedSeated('st3', ['t4', 't6']);
		await amendBooking({ bookingId: b.id, time: '17:30', tableIds: ['t4', 't6'], actor: 'staff' });
		await flushDeferred();
		const rows = seatRowsFor('st3');
		expect(rows).toHaveLength(2);
		for (const r of rows) {
			expect(new Date(String(r.seated_at)).toISOString()).toBe('2026-06-25T16:30:00.000Z');
		}
	});

	it('re-anchors through a batch commit', async () => {
		const b = seedSeated('st4');
		await applyBookingBatch([{ bookingId: b.id, time: '17:30', durationMinutes: 120 }]);
		await flushDeferred();
		expect(new Date(String(seatRowsFor('st4')[0].seated_at)).toISOString()).toBe(
			'2026-06-25T16:30:00.000Z'
		);
	});

	it('re-anchors the dragged leg of a swap and leaves the bumped leg alone', async () => {
		const a = seedSeated('st5', ['t2']); // dragged — lands at a new time
		const b = seedSeated('st6', ['t4']); // bumped — keeps its own time
		await swapBookingTables(a.id, b.id, {
			actor: 'staff',
			newStartA: '2026-06-25T17:30:00.000Z' // 18:30 local
		});
		await flushDeferred();
		expect(new Date(String(seatRowsFor('st5')[0].seated_at)).toISOString()).toBe(
			'2026-06-25T17:30:00.000Z'
		);
		expect(seatRowsFor('st6')[0].seated_at).toBe(SEATED_LATE_Z);
	});

	it('refuses a re-anchor that would land at/after a finished sitting\u2019s clear time', async () => {
		// A negative-length sitting would poison the turn-time medians (cleared - seated).
		const b = seedBooking({ id: 'st7', status: 'completed', tables: ['t2'] });
		store['geisha_floor_state'] ??= [];
		store['geisha_floor_state'].push({
			id: 'fs_st7',
			created: '',
			updated: '',
			booking: 'st7',
			table: 't2',
			seated_at: '2026-06-25T18:00:00.000Z',
			cleared_at: '2026-06-25T19:00:00.000Z'
		});
		await amendBooking({ bookingId: b.id, time: '21:00', actor: 'staff' }); // 20:00Z > cleared
		await flushDeferred();
		expect(seatRowsFor('st7')[0].seated_at).toBe('2026-06-25T18:00:00.000Z'); // untouched
	});
});

// ---------------------------------------------------------------------------
// BOOKING ON A CLOSED DAY (owner: "like for Christmas we block the system and we add
// reservations manually").
//
// A closure exists to stop the PUBLIC booking a date. It was never meant to stop the
// restaurant taking a reservation it has decided to take, nor to freeze the ones it
// already took — which is what happened: every staff edit of a booking on a closed day
// came back "That date/service is closed for bookings". Staff paths now pass
// `allowClosed`; guest self-service (actor 'customer') never gets it.
// ---------------------------------------------------------------------------
describe('closed dates: staff may still work the day, guests may not', () => {
	function closeTheDay() {
		store['geisha_closures'] = [
			{
				id: 'clo1',
				created: '',
				updated: '',
				restaurant: REST,
				scope: 'full',
				date_from: '2026-06-25',
				date_to: '2026-06-25',
				service_period: '',
				section: '',
				table: '',
				time_from: '',
				time_to: '',
				kind: 'holiday',
				reason: 'Christmas',
				channel_type: 'common'
			}
		];
	}

	it('refuses an amend on a closed date by default', async () => {
		const b = seedBooking({ id: 'cl1' });
		closeTheDay();
		await expect(amendBooking({ bookingId: b.id, time: '19:30' })).rejects.toMatchObject({
			code: 'no_period'
		});
	});

	it('allows a STAFF amend with allowClosed', async () => {
		const b = seedBooking({ id: 'cl2' });
		closeTheDay();
		const res = await amendBooking({
			bookingId: b.id,
			time: '19:30',
			actor: 'staff',
			allowClosed: true
		});
		expect(new Date(res.booking.starts_at).toISOString()).toBe('2026-06-25T18:30:00.000Z');
	});

	it('never honours allowClosed for a GUEST self-service amend', async () => {
		const b = seedBooking({ id: 'cl3' });
		closeTheDay();
		await expect(
			amendBooking({ bookingId: b.id, time: '19:30', actor: 'customer', allowClosed: true })
		).rejects.toMatchObject({ code: 'no_period' });
	});

	it('refuses a batch commit on a closed date by default', async () => {
		const b = seedBooking({ id: 'cl4' });
		closeTheDay();
		await expect(applyBookingBatch([{ bookingId: b.id, time: '19:30' }])).rejects.toMatchObject({
			code: 'no_period'
		});
	});

	it('allows a STAFF batch commit with allowClosed (the diary always sends it)', async () => {
		const b = seedBooking({ id: 'cl5' });
		closeTheDay();
		const res = await applyBookingBatch([{ bookingId: b.id, time: '19:30' }], {
			actor: 'staff',
			allowClosed: true
		});
		expect(new Date(res.bookings[0].starts_at).toISOString()).toBe('2026-06-25T18:30:00.000Z');
	});
});

// ---------------------------------------------------------------------------
// THE MONEY ON A BOOKING IS VISIBLE FROM THE DIARY (owner: "the table of 6 today
// paid a booking fee — I can see it in Stripe but not on the diary").
//
// The board already computed a coarse `paymentStatus` for the Payment colour
// scheme, which repaints the WHOLE grid and still can't say how much. The card
// now carries the payment row itself, so a single bar can be read on its own.
// ---------------------------------------------------------------------------
const { getDiaryTimeline } = await import('./admin.js');

describe('the diary board carries each booking’s payment', () => {
	const NOW = '2026-06-25T17:30:00.000Z'; // during the fixture day's dinner service

	function payment(over: Record<string, unknown>): void {
		store['geisha_payments'].push({
			id: `pay_${++idSeq}`,
			created: '',
			updated: '',
			kind: 'deposit',
			status: 'Captured',
			amount: 6000,
			dojo_payment_intent_id: 'pi_x',
			captured_at: '2026-06-20T09:00:00.000Z',
			reversed_at: '',
			...over
		} as Row);
	}

	const barFor = async (id: string) => {
		const board = await getDiaryTimeline('asia', '2026-06-25', NOW);
		return board.sections
			.flatMap((s) => s.rows)
			.flatMap((r) => r.bars)
			.find((b) => b.bookingId === id);
	};

	it('exposes a captured deposit — amount, kind and when it was taken', async () => {
		seedBooking({ id: 'pay1', party_size: 6, tables: ['t6'] });
		payment({ booking: 'pay1' });
		const bar = await barFor('pay1');
		expect(bar?.paymentStatus).toBe('paid');
		expect(bar?.detail.payment).toMatchObject({
			state: 'paid',
			status: 'Captured',
			kind: 'deposit',
			amount: 6000,
			capturedAt: '2026-06-20T09:00:00.000Z'
		});
	});

	it('leaves `payment` undefined when no money was ever taken', async () => {
		seedBooking({ id: 'pay2', party_size: 2, tables: ['t2'] });
		const bar = await barFor('pay2');
		expect(bar?.paymentStatus).toBe('none');
		expect(bar?.detail.payment).toBeUndefined();
	});

	it('keeps a refund visible instead of reading as "never paid"', async () => {
		// The bucket deliberately drops a refund to 'none' (no live money held), so
		// without the row the card would say nothing at all about £60 that moved.
		seedBooking({ id: 'pay3', party_size: 6, tables: ['t6'] });
		payment({ booking: 'pay3', status: 'Refunded' });
		const bar = await barFor('pay3');
		expect(bar?.paymentStatus).toBe('none');
		expect(bar?.detail.payment).toMatchObject({ status: 'Refunded', amount: 6000 });
	});

	it('shows the live row when a released hold is followed by a real deposit', async () => {
		seedBooking({ id: 'pay4', party_size: 6, tables: ['t6'] });
		payment({ booking: 'pay4', kind: 'noshow_hold', status: 'Reversed', amount: 3000 });
		payment({ booking: 'pay4', kind: 'deposit', status: 'Captured', amount: 6000 });
		const bar = await barFor('pay4');
		expect(bar?.detail.payment).toMatchObject({ kind: 'deposit', status: 'Captured', amount: 6000 });
	});
});

// A booking must never appear in its OWN occupancy set. It used to be excluded by
// matching window+tables against the `before` snapshot — read well before the lock —
// so anything that wrote the row in between made the match fail and the booking block
// itself. The owner hit it on a walk-in: lengthening it toward the next party was
// refused with "Table 4 is already booked during that time", naming the table it was
// already sitting on, and the bar snapped back a second later.
describe('amendBooking self-exclusion is by identity, not window shape', () => {
	it('lengthens a sitting even when the row changed after `before` was read', async () => {
		seedBooking({ id: 'selfb', party_size: 2, tables: ['t2'] });
		// A concurrent write lands while we wait for the lock: the sitting was trimmed by
		// 15 minutes (a Finish, an earlier drag in the same burst — the cause does not
		// matter, only that `before` now describes a window the row no longer has).
		onAcquireLock = () => {
			const row = store['geisha_bookings'].find((r) => r.id === 'selfb');
			if (row) row.ends_at = '2026-06-25T19:45:00.000Z';
		};
		const res = await amendBooking({
			bookingId: 'selfb',
			keepTables: true,
			durationMinutes: 180,
			actor: 'staff',
			allowClosed: true
		});
		expect(new Date(res.booking.ends_at).toISOString()).toBe('2026-06-25T21:00:00.000Z');
	});

	it('still refuses a window that genuinely overlaps ANOTHER booking on the table', async () => {
		seedBooking({ id: 'keep1', party_size: 2, tables: ['t2'] });
		seedBooking({
			id: 'other1',
			party_size: 2,
			tables: ['t2'],
			starts_at: '2026-06-25T20:30:00.000Z',
			ends_at: '2026-06-25T22:00:00.000Z'
		});
		await expect(
			amendBooking({
				bookingId: 'keep1',
				keepTables: true,
				durationMinutes: 180,
				actor: 'staff',
				allowClosed: true
			})
		).rejects.toThrow(/already booked/i);
	});

	// The shape match failed the other way too: two bookings sharing a table set AND a
	// window excluded each other, so a real double-book could slip through.
	it('does not excuse another booking that shares this one’s window and table', async () => {
		seedBooking({ id: 'twinA', party_size: 2, tables: ['t2'] });
		seedBooking({ id: 'twinB', party_size: 2, tables: ['t2'] });
		await expect(
			amendBooking({
				bookingId: 'twinA',
				keepTables: true,
				durationMinutes: 150,
				actor: 'staff',
				allowClosed: true
			})
		).rejects.toThrow(/already booked/i);
	});
});
