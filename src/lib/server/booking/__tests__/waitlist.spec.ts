// Unit coverage for waitlist capture (WP-AVAIL-5). PocketBase is mocked with a
// tiny in-memory store; the REAL joinWaitlist / listWaitlist logic runs, plus
// the real queries.upsertCustomer / getRestaurant against the fake store.

import { describe, it, expect, beforeEach, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };

const store: Record<string, Row[]> = {};
let idSeq = 0;

/** AND matcher covering the equality + date-range filters waitlist.ts uses.
 *  listWaitlist filters a DATE field as a day range (date>="… 00:00:00" &&
 *  date<"… 23:59:59") because PB stores it as a datetime — so the mock honours
 *  >= / < lexically (the stored 'YYYY-MM-DD' compares correctly against the
 *  'YYYY-MM-DD HH:mm:ss' bounds). */
function matches(row: Row, filter?: string): boolean {
	if (!filter) return true;
	for (const clause of filter.split('&&')) {
		const t = clause.trim();
		if (!t) continue;
		let m = t.match(/^([\w.]+)\s*=\s*"([^"]*)"$/);
		if (m) {
			if (String(row[m[1]] ?? '') !== m[2]) return false;
			continue;
		}
		m = t.match(/^([\w.]+)\s*>=\s*"([^"]*)"$/);
		if (m) {
			if (String(row[m[1]] ?? '') < m[2]) return false;
			continue;
		}
		m = t.match(/^([\w.]+)\s*<\s*"([^"]*)"$/);
		if (m) {
			if (String(row[m[1]] ?? '') >= m[2]) return false;
			continue;
		}
		// unrecognised clause -> be permissive
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
		async getFullList<T>(opts?: { filter?: string; sort?: string }): Promise<T[]> {
			let out = rows().filter((x) => matches(x, opts?.filter));
			if (opts?.sort === 'created') out = [...out].sort((a, b) => a.id.localeCompare(b.id));
			return out.map((x) => structuredClone(x)) as T[];
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

// Mock paths are relative to THIS test file (in __tests__/), so reach up twice.
vi.mock('../../db/pb.js', () => ({
	pb: async () => fakePb,
	coll: async (n: string) => fakePb.collection(n)
}));

const { joinWaitlist, listWaitlist, cancelWaitlistEntry, WaitlistError } = await import(
	'../waitlist.js'
);

const REST = 'rest1';

function seed() {
	for (const k of Object.keys(store)) delete store[k];
	idSeq = 0;
	store['geisha_restaurants'] = [
		{ id: REST, created: '', updated: '', brand: 'asia', display_name: 'Geisha', timezone: 'Europe/London' }
	];
	store['geisha_customers'] = [];
	store['geisha_waitlist'] = [];
	store['geisha_audit_log'] = [];
}

const baseInput = {
	brand: 'asia' as const,
	date: '2026-07-04',
	partySize: 2,
	windowFrom: '19:00',
	windowTo: '21:00',
	customer: { name: 'Ada', email: 'ada@example.com' }
};

describe('joinWaitlist', () => {
	beforeEach(seed);

	it('creates a waiting row with the requested window + party', async () => {
		const { id } = await joinWaitlist(baseInput);
		const row = store['geisha_waitlist'].find((r) => r.id === id);
		expect(row).toBeDefined();
		expect(row?.status).toBe('waiting');
		expect(row?.party_size).toBe(2);
		expect(row?.window_from).toBe('19:00');
		expect(row?.window_to).toBe('21:00');
		expect(row?.date).toBe('2026-07-04');
	});

	it('upserts the customer (no duplicate row for a repeat email)', async () => {
		await joinWaitlist(baseInput);
		await joinWaitlist({ ...baseInput, date: '2026-07-05' }); // same email, different date
		expect(store['geisha_customers']).toHaveLength(1);
	});

	it('writes a customer-actor join_waitlist audit row', async () => {
		await joinWaitlist(baseInput);
		const audit = store['geisha_audit_log'].find((a) => a.action === 'join_waitlist');
		expect(audit).toBeDefined();
		expect(audit?.actor).toBe('customer');
		expect(audit?.entity).toBe('geisha_waitlist');
	});

	it('rejects a window where from is after to', async () => {
		await expect(
			joinWaitlist({ ...baseInput, windowFrom: '21:00', windowTo: '19:00' })
		).rejects.toBeInstanceOf(WaitlistError);
	});

	it('rejects a malformed time window', async () => {
		await expect(joinWaitlist({ ...baseInput, windowFrom: '7pm' })).rejects.toBeInstanceOf(
			WaitlistError
		);
	});

	it('refuses an identical waiting entry (soft anti-spam)', async () => {
		await joinWaitlist(baseInput);
		await expect(joinWaitlist(baseInput)).rejects.toMatchObject({ code: 'duplicate' });
		expect(store['geisha_waitlist']).toHaveLength(1);
	});
});

describe('listWaitlist / cancelWaitlistEntry', () => {
	beforeEach(seed);

	it('lists waiting entries for a date', async () => {
		await joinWaitlist(baseInput);
		await joinWaitlist({ ...baseInput, customer: { name: 'Bo', email: 'bo@example.com' } });
		const list = await listWaitlist('asia', '2026-07-04');
		expect(list).toHaveLength(2);
	});

	it('filters by date when provided', async () => {
		await joinWaitlist(baseInput);
		await joinWaitlist({ ...baseInput, date: '2026-07-05' });
		expect(await listWaitlist('asia', '2026-07-04')).toHaveLength(1);
		expect(await listWaitlist('asia')).toHaveLength(2);
	});

	it('cancel flips status to cancelled', async () => {
		const { id } = await joinWaitlist(baseInput);
		await cancelWaitlistEntry(id);
		const row = store['geisha_waitlist'].find((r) => r.id === id);
		expect(row?.status).toBe('cancelled');
	});
});
