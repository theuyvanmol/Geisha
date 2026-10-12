// A walk-in has to STAY seated.
//
// Owner, 10 Sep: "we sat 2 walk-ins (so they went green), went to a different day,
// came back and they were red — the system unseated them." The audit trail showed
// the walk-in seated at create+0.7s, then a write 2–5ms later carrying the fresh
// allergy flags AND status 'confirmed' — no audit row of its own — and the release
// sweep marking the seated table a no-show 30 minutes after its start (5 of that
// day's 19 walk-ins).
//
// The cause is PocketBase's save model: an update loads the record, merges the
// submitted fields onto THAT copy and writes every column back. createBooking's
// deferred allergy write (`{ dietary_flags }` only) started before the caller's
// seat had landed, loaded the pre-seat row, and saved its 'confirmed' back over it.
//
// So this harness's `update` behaves like PocketBase — load, round-trip, save the
// whole row — rather than the field-merge the other booking tests use, which could
// never show the bug.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };

const store: Record<string, Row[]> = {};
let idSeq = 0;
let failFloorCreate = false;

/** AND-of-equality matcher covering the filters the create + seat paths use. */
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

const roundTrip = () => new Promise((r) => setTimeout(r, 5));

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
			if (name === 'geisha_floor_state' && failFloorCreate) throw new Error('droplet hiccup');
			const row: Row = { id: `${name}_${++idSeq}`, created: '', updated: '', ...data };
			rows().push(row);
			return structuredClone(row) as T;
		},
		// PocketBase's update: load the record, (network), merge the submitted fields onto
		// the LOADED copy and save every column — a concurrent write in between is lost.
		async update<T>(id: string, data: Record<string, unknown>): Promise<T> {
			const loaded = rows().find((x) => x.id === id);
			if (!loaded) throw Object.assign(new Error('not found'), { status: 404 });
			const copy = structuredClone(loaded);
			await roundTrip();
			const saved: Row = { ...copy, ...data };
			store[name] = rows().map((x) => (x.id === id ? saved : x));
			return structuredClone(saved) as T;
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
	createDepositIntent: async () => ({ id: 'pi_test', clientSecret: 's', publishableKey: 'pk', configured: true }),
	createGuaranteeIntent: async () => ({ id: 'seti_test', clientSecret: 's', publishableKey: 'pk', configured: true }),
	intentKind: (id: string) => (id.startsWith('pi_') ? 'payment_intent' : 'setup_intent'),
	mapStatus: () => 'Created'
}));

const { createBooking } = await import('./create.js');
const { flushDeferred } = await import('../util/defer.js');

const TZ = 'Europe/London';
const REST = 'rest1';
const STAFF = 'stf_georgia';
const SEAT_AT = '2026-06-25T18:07:23.000Z';

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
	failFloorCreate = false;
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
	store['geisha_floor_state'] = [];
	store['geisha_payments'] = [];
	store['geisha_audit_log'] = [];
}

beforeEach(async () => {
	await flushDeferred();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-22T10:00:00.000Z'));
	seedBase();
});

afterEach(() => {
	vi.useRealTimers();
});

const WALKIN = {
	brand: 'asia' as const,
	date: '2026-06-25',
	time: '19:00',
	partySize: 2,
	// a note, so the deferred allergy write has something to write
	customer: { name: 'Walk In', email: 'walkin@x.com' },
	specialRequests: 'no nuts please',
	source: 'walkin' as const,
	staff: true,
	staffId: STAFF,
	tableIds: ['t2']
};

const stored = (id: string) => store['geisha_bookings'].find((b) => b.id === id)!;

describe('a walk-in seated on create', () => {
	it('is already seated when createBooking returns — nothing left in flight to undo it', async () => {
		const { booking } = await createBooking({ ...WALKIN, seat: { at: SEAT_AT } });
		expect(booking.status).toBe('seated');
		expect(stored(booking.id).status).toBe('seated');
		const floor = store['geisha_floor_state'].filter((f) => f.booking === booking.id);
		expect(floor.map((f) => f.table)).toEqual(['t2']);
		expect(floor[0].seated_at).toBe(SEAT_AT);
	});

	it('stays seated once the deferred allergy write lands (PocketBase whole-row saves)', async () => {
		const { booking } = await createBooking({ ...WALKIN, seat: { at: SEAT_AT } });
		await flushDeferred();
		const row = stored(booking.id);
		expect(row.dietary_flags).toBeTruthy(); // the allergy write DID happen…
		expect(row.status).toBe('seated'); // …and no longer puts 'confirmed' back
	});

	it('still reads Made → Fully Seated in the history, named for the host', async () => {
		const { booking } = await createBooking({ ...WALKIN, seat: { at: SEAT_AT } });
		await flushDeferred();
		const rows = store['geisha_audit_log'].filter((a) => a.entity_id === booking.id);
		const made = rows.find((a) => a.action === 'create_booking') as Row & {
			after: { status: string };
		};
		const seat = rows.find((a) => a.action === 'seat_booking') as Row & {
			before: { status: string };
			after: { status: string };
		};
		expect(made.after.status).toBe('confirmed');
		expect(seat.before.status).toBe('confirmed');
		expect(seat.after.status).toBe('seated');
		expect(seat.on_behalf_of).toBe(STAFF);
	});

	it('never loses the walk-in when the seat itself fails', async () => {
		failFloorCreate = true;
		const { booking } = await createBooking({ ...WALKIN, seat: { at: SEAT_AT } });
		expect(stored(booking.id)).toBeTruthy();
	});
});

// A walk-in is counted in the service it SAT in — see periodFallback.ts. Fusion's
// lunch stops at 16:45 and dinner opens at 17:00, and the diary snaps a walk-in's
// bar back to its 15-minute cell, so a party seated at 16:50 is stored at 16:45 —
// the last minute lunch takes bookings. They belong to dinner.
describe('which service a walk-in is filed under', () => {
	/** Give the restaurant a Fusion-shaped lunch: it ENDS when its last booking goes out. */
	function addLunchEndingAt1645() {
		store['geisha_service_periods'].push({
			id: 'lunch',
			created: '',
			updated: '',
			restaurant: REST,
			name: 'Lunch',
			days_of_week: [0, 1, 2, 3, 4, 5, 6],
			start_time: '12:00',
			end_time: '16:45',
			last_booking_time: '16:45',
			default_turn_minutes: 90,
			active: true
		});
	}

	it('files a walk-in on the 16:45 cell under Dinner, not the lunch that just ended', async () => {
		addLunchEndingAt1645();
		const { booking } = await createBooking({ ...WALKIN, time: '16:45', seat: { at: SEAT_AT } });
		expect(stored(booking.id).service_period).toBe('dinner');
	});

	it('still files a walk-in seated during lunch under Lunch', async () => {
		addLunchEndingAt1645();
		const { booking } = await createBooking({ ...WALKIN, time: '14:00', seat: { at: SEAT_AT } });
		expect(stored(booking.id).service_period).toBe('lunch');
	});

	it('leaves a 16:45 RESERVATION under Lunch — the last lunch sitting is still lunch', async () => {
		addLunchEndingAt1645();
		const { booking } = await createBooking({
			...WALKIN,
			time: '16:45',
			source: 'phone' as const,
			customer: { name: 'Jane Reserved', email: 'jane@x.com' }
		});
		expect(stored(booking.id).service_period).toBe('lunch');
	});
});
