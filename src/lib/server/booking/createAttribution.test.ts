// Who took this booking? — attribution coverage for createBooking's audit row.
//
// The booking history's first line is ResDiary's "Made" event. For an ONLINE
// booking that is the guest, and we already record it as such. For a PHONE or
// WALK-IN booking a host took, it should name the host — and it used to say a
// flat "staff", because create.ts logged actor='staff' with no id.
//
// PocketBase, the advisory lock, the emailer and the payment provider are faked
// (the same in-memory harness amend.test.ts uses); the REAL create path, the
// real availability allocation and the REAL writeAudit run, so these assert on
// the audit row that actually gets stored.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// --- in-memory PocketBase fake ----------------------------------------------

type Row = Record<string, unknown> & { id: string };

const store: Record<string, Row[]> = {};
let idSeq = 0;

/** AND-of-equality matcher covering the handful of filters the create path uses. */
function matches(row: Row, filter?: string): boolean {
	if (!filter) return true;
	let f = filter;
	const orGroup = f.match(/\(([^)]*\|\|[^)]*)\)/);
	if (orGroup) {
		const statuses = [...orGroup[1].matchAll(/status="([^"]+)"/g)].map((m) => m[1]);
		if (statuses.length && !statuses.includes(String(row.status))) return false;
		f = f.replace(orGroup[0], '').trim();
	}
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

vi.mock('../db/lock.js', () => ({
	acquireLock: async () => ({ id: 'lock', key: 'k', holder: 'h' }),
	releaseLock: async () => {}
}));

vi.mock('../email/confirmations.js', () => ({
	sendBookingConfirmation: async () => ({ sent: true }),
	sendCancellation: async () => ({ sent: true }),
	confirmationExtras: async () => ({})
}));

vi.mock('../payments/stripe.js', () => ({
	isConfiguredAsync: async () => true,
	isConfigured: () => true,
	ensureCustomer: async () => 'cus_test',
	createDepositIntent: async () => ({
		id: 'pi_test',
		clientSecret: 's',
		publishableKey: 'pk',
		configured: true
	}),
	createGuaranteeIntent: async () => ({
		id: 'seti_test',
		clientSecret: 's',
		publishableKey: 'pk',
		configured: true
	}),
	intentKind: (id: string) => (id.startsWith('pi_') ? 'payment_intent' : 'setup_intent'),
	mapStatus: () => 'Created'
}));

const { createBooking } = await import('./create.js');
const { flushDeferred } = await import('../util/defer.js');

// --- fixtures ---------------------------------------------------------------

const TZ = 'Europe/London';
const REST = 'rest1';
const STAFF = 'stf_georgia';

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

const setting = (key: string, value: unknown): Row => ({
	id: `set_${key}`,
	created: '',
	updated: '',
	restaurant: REST,
	key,
	value
});

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
	store['geisha_tables'] = [mkTable('t2', 1, 2), mkTable('t4', 2, 4), mkTable('t6', 4, 6)];
	store['geisha_table_joins'] = [];
	store['geisha_closures'] = [];
	store['geisha_settings'] = [
		setting('online_party_max', 8),
		setting('booking_window_days', 60),
		setting('slot_interval_minutes', 15),
		setting('unpaid_hold_minutes', 15),
		setting('lead_time_minutes', 0)
	];
	store['geisha_customers'] = [];
	store['geisha_bookings'] = [];
	store['geisha_payments'] = [];
	store['geisha_audit_log'] = [];
}

beforeEach(async () => {
	await flushDeferred();
	// Only Date is faked — deferWork resolves through real timers, and faking
	// those would hang flushDeferred().
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-22T10:00:00.000Z'));
	seedBase();
});

afterEach(() => {
	vi.useRealTimers();
});

/** The stored create_booking audit row. */
const createAudit = () => store['geisha_audit_log'].find((a) => a.action === 'create_booking');

const PHONE_BOOKING = {
	brand: 'asia' as const,
	date: '2026-06-25',
	time: '19:00',
	partySize: 2,
	customer: { name: 'A', email: 'a@x.com' },
	source: 'phone' as const,
	staff: true
};

describe('createBooking records who took the booking', () => {
	it('names the staff member who took a phone booking', async () => {
		await createBooking({ ...PHONE_BOOKING, staffId: STAFF });
		await flushDeferred();
		expect(createAudit()?.on_behalf_of).toBe(STAFF);
	});

	it('audits a staff booking as a staff action', async () => {
		await createBooking({ ...PHONE_BOOKING, staffId: STAFF });
		await flushDeferred();
		expect(createAudit()?.actor).toBe('staff');
	});

	it('still records a staff booking taken without a signed-in staff id', async () => {
		await createBooking(PHONE_BOOKING);
		await flushDeferred();
		expect(createAudit()).toBeTruthy();
		expect(createAudit()?.on_behalf_of).toBeFalsy();
	});
});
