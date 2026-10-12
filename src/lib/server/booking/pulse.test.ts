// Coverage for the realtime doorbell (pulse.ts) — the server half of cross-device live
// sync. PocketBase, deferWork and the request-actor context are mocked; the real
// detection / scoping / coalescing / attribution logic runs.
//
// These pin down the two properties the whole mechanism rests on:
//   1. A change ALWAYS rings the bell (or the other device never hears about it).
//   2. The bell is attributed to a tab ONLY when that tab is provably its sole author —
//      because a board ignores its own pulses, so a MIS-attributed pulse is a change that
//      device silently never sees. That is the exact bug this replaced.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- mocks ------------------------------------------------------------------

type Row = Record<string, unknown> & { id: string };
const rows: Row[] = []; // geisha_pulse rows
const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
const creates: Array<Record<string, unknown>> = [];

/** The floor plan, as the lazy table load sees it. */
const TABLES = [
	{ id: 't1', restaurant: 'rest_asia' },
	{ id: 't7', restaurant: 'rest_fusion' }
];
let tableLoads = 0; // how many times the table map was fetched (must be at most once)

const collection = (name: string) => ({
	getFirstListItem: async (filter: string) => {
		if (name !== 'geisha_pulse') throw new Error('unexpected collection ' + name);
		const want = /restaurant="([^"]+)"/.exec(filter)?.[1];
		const hit = rows.find((r) => r.restaurant === want);
		if (!hit) throw new Error('not found');
		return hit;
	},
	update: async (id: string, data: Record<string, unknown>) => {
		updates.push({ id, data });
		const row = rows.find((r) => r.id === id);
		if (row) Object.assign(row, data);
		return row;
	},
	create: async (data: Record<string, unknown>) => {
		creates.push(data);
		const row = { id: 'pulse' + (rows.length + 1), ...data } as Row;
		rows.push(row);
		return row;
	},
	getFullList: async () => {
		if (name === 'geisha_tables') {
			tableLoads++;
			return TABLES;
		}
		return [{ id: 'rest_asia' }, { id: 'rest_fusion' }]; // geisha_restaurants
	}
});

vi.mock('../db/pb.js', () => ({ pb: async () => ({ collection }) }));
// deferWork just runs the task (production hands it to waitUntil).
vi.mock('../util/defer.js', () => ({ deferWork: (fn: () => Promise<unknown>) => void fn() }));

let actor = '';
vi.mock('../util/actor.js', () => ({ currentActor: () => actor }));

// pulse.ts holds process-lifetime caches (the table map, the seen-row map). Re-import it per
// test so one test's warm cache can't mask another's cold-start behaviour — the cold start is
// exactly what the floor_state scoping has to get right.
let notifyWrite: typeof import('./pulse.js').notifyWrite;
let notifyResponse: typeof import('./pulse.js').notifyResponse;

/** Let the 200ms coalescing window close and the bump write settle. */
const settle = async () => {
	await vi.advanceTimersByTimeAsync(250);
	await vi.advanceTimersByTimeAsync(0);
};

const bookingWrite = (restaurant: string, id = 'b1') => ({ id, restaurant });

beforeEach(async () => {
	rows.length = 0;
	updates.length = 0;
	creates.length = 0;
	actor = '';
	tableLoads = 0;
	vi.useFakeTimers();
	rows.push({ id: 'p_asia', restaurant: 'rest_asia', rev: 4 });
	rows.push({ id: 'p_fusion', restaurant: 'rest_fusion', rev: 9 });
	vi.resetModules();
	({ notifyWrite, notifyResponse } = await import('./pulse.js'));
});

// --- the bell rings ---------------------------------------------------------

describe('notifyWrite', () => {
	it('rings the bell for the changed restaurant, and bumps rev so PocketBase emits an event', async () => {
		actor = 'tab-A';
		notifyWrite('geisha_bookings', bookingWrite('rest_asia'));
		await settle();

		expect(updates).toHaveLength(1);
		expect(updates[0].id).toBe('p_asia');
		expect(updates[0].data.rev).toBe(5); // a no-op save would emit NO realtime event
		expect(updates[0].data.actor).toBe('tab-A');
	});

	it('does not ring the OTHER restaurant (an Asia change must not churn Fusion boards)', async () => {
		notifyWrite('geisha_bookings', bookingWrite('rest_asia'));
		await settle();
		expect(updates.map((u) => u.id)).toEqual(['p_asia']);
	});

	it('ignores collections that do not affect the board — including geisha_pulse itself', async () => {
		notifyWrite('geisha_pulse', { id: 'p_asia', restaurant: 'rest_asia' }); // no ring-loop
		notifyWrite('geisha_audit_log', { id: 'a1', restaurant: 'rest_asia' });
		await settle();
		expect(updates).toHaveLength(0);
		expect(creates).toHaveLength(0);
	});

	it('creates the row on first use when a restaurant has no pulse row yet', async () => {
		rows.length = 0;
		notifyWrite('geisha_bookings', bookingWrite('rest_asia'));
		await settle();
		expect(creates).toHaveLength(1);
		expect(creates[0]).toMatchObject({ restaurant: 'rest_asia', rev: 1 });
	});

	it('scopes a floor_state write (which carries no restaurant) via the table it seats', async () => {
		// Every seat/clear is a floor_state write, and tables are almost never WRITTEN during
		// service — so this must resolve by loading the table map, not by hoping the cache was
		// warmed. Getting this wrong rings both brands on every seat, all night.
		notifyWrite('geisha_floor_state', { id: 'fs1', table: 't7', booking: 'b1' });
		await settle();
		expect(updates).toHaveLength(1);
		expect(updates[0].id).toBe('p_fusion');
	});

	it('loads the table map only ONCE, however many seats/clears follow', async () => {
		for (let i = 0; i < 5; i++) {
			notifyWrite('geisha_floor_state', { id: 'fs' + i, table: 't1', booking: 'b' + i });
			await settle();
		}
		expect(updates.map((u) => u.id)).toEqual(Array(5).fill('p_asia'));
		expect(tableLoads).toBe(1);
	});

	it('scopes a DELETE of a row it saw written earlier (no body to read)', async () => {
		notifyWrite('geisha_floor_state', { id: 'fs9', table: 't7', booking: 'b1' });
		await settle();
		updates.length = 0;

		notifyWrite('geisha_floor_state', null, 'fs9'); // the vacate delete
		await settle();
		expect(updates).toHaveLength(1);
		expect(updates[0].id).toBe('p_fusion'); // NOT both — we remembered the row
	});

	it('rings BOTH restaurants when a write truly cannot be scoped', async () => {
		notifyWrite('geisha_bookings', null, 'never-seen');
		await settle();
		expect(updates.map((u) => u.id).sort()).toEqual(['p_asia', 'p_fusion']);
	});
});

// --- coalescing + attribution ----------------------------------------------

describe('coalescing', () => {
	it('rings ONCE for a batch commit that writes many rows', async () => {
		actor = 'tab-A';
		for (let i = 0; i < 10; i++) notifyWrite('geisha_bookings', bookingWrite('rest_asia', 'b' + i));
		await settle();
		expect(updates).toHaveLength(1);
	});

	it('attributes the pulse to the sole authoring tab, so that tab ignores its own echo', async () => {
		actor = 'tab-A';
		notifyWrite('geisha_bookings', bookingWrite('rest_asia', 'b1'));
		notifyWrite('geisha_floor_state', { id: 'fs1', table: 't1', booking: 'b1' });
		await settle();
		expect(updates).toHaveLength(1);
		expect(updates[0].data.actor).toBe('tab-A');
	});

	it('leaves a pulse UNATTRIBUTED when two tabs write inside the same window, so BOTH re-pull', async () => {
		// The dangerous case: fold tab-B's change into a pulse stamped 'tab-A' and tab-A would
		// dismiss it as its own echo — and never see what tab-B did.
		actor = 'tab-A';
		notifyWrite('geisha_bookings', bookingWrite('rest_asia', 'b1'));
		actor = 'tab-B';
		notifyWrite('geisha_bookings', bookingWrite('rest_asia', 'b2'));
		await settle();

		expect(updates).toHaveLength(1);
		expect(updates[0].data.actor).toBe(''); // nobody owns it → nobody ignores it
	});

	it('leaves a pulse unattributed for a write with no acting tab (cron, webhook, guest booking)', async () => {
		actor = '';
		notifyWrite('geisha_bookings', bookingWrite('rest_asia'));
		await settle();
		expect(updates[0].data.actor).toBe('');
	});

	it('rings AGAIN for a change arriving after the window closed (not swallowed by the last bump)', async () => {
		actor = 'tab-A';
		notifyWrite('geisha_bookings', bookingWrite('rest_asia', 'b1'));
		await settle();
		notifyWrite('geisha_bookings', bookingWrite('rest_asia', 'b2'));
		await settle();
		expect(updates).toHaveLength(2);
		expect(updates[1].data.rev).toBe(6);
	});
});

// --- the afterSend hook -----------------------------------------------------

describe('notifyResponse (the PocketBase afterSend hook)', () => {
	const url = (c: string, id = '') =>
		`https://pb.example/api/collections/${c}/records${id ? '/' + id : ''}`;

	it('rings on every write verb', async () => {
		for (const method of ['POST', 'PATCH', 'PUT']) {
			updates.length = 0;
			notifyResponse(url('geisha_bookings', 'b1'), method, true, bookingWrite('rest_asia'));
			await settle();
			expect(updates, method).toHaveLength(1);
		}
	});

	it('does NOT ring on reads — the loader must not ring the bell it is answering', async () => {
		notifyResponse(url('geisha_bookings') + '?perPage=200', 'GET', true, { items: [] });
		await settle();
		expect(updates).toHaveLength(0);
	});

	it('does NOT ring on a failed write (nothing changed)', async () => {
		notifyResponse(url('geisha_bookings', 'b1'), 'PATCH', false, { code: 400 });
		await settle();
		expect(updates).toHaveLength(0);
	});

	it('rings unattributed on a DELETE, which returns 204 with no body', async () => {
		notifyResponse(url('geisha_bookings', 'b1'), 'DELETE', true, null);
		await settle();
		expect(updates.map((u) => u.id).sort()).toEqual(['p_asia', 'p_fusion']);
	});

	it('ignores non-record endpoints (auth, health, collection admin)', async () => {
		notifyResponse('https://pb.example/api/collections/_superusers/auth-with-password', 'POST', true, { token: 'x' });
		notifyResponse('https://pb.example/api/collections', 'POST', true, { id: 'c1' });
		await settle();
		expect(updates).toHaveLength(0);
	});
});
