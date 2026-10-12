// Who did it? — attribution coverage for the floor mutations in mutate.ts.
//
// The booking history's User column is only as good as what the mutation
// recorded. cancel / seat / clear / no-show / confirm / reset / reinstate /
// set-status all used to log a bare actor='staff' with no id, so every one of
// them showed as an anonymous "staff" next to a named guest — the exact thing
// the owner's ResDiary screenshot does NOT do.
//
// These tests pin the contract: given a staff id, the audit row carries it in
// on_behalf_of, which is what history.ts resolves into "Georgia Fox".
//
// PocketBase, the payment provider, the emailer and the CRM counters are mocked;
// the real mutation code — and the real deferWork queue — runs.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- mocks ------------------------------------------------------------------

type Row = Record<string, unknown> & { id: string };

const bookings: Record<string, Row> = {};
let floorState: Row[] = [];

const collection = (name: string) => ({
	getOne: async (id: string) => {
		if (name === 'geisha_bookings') {
			if (!bookings[id]) throw new Error('not found: ' + id);
			return { ...bookings[id] };
		}
		return { id, name: 'Test', email: 'x@example.com', timezone: 'Europe/London' };
	},
	update: async (id: string, data: Record<string, unknown>) => {
		if (name === 'geisha_bookings') {
			bookings[id] = { ...bookings[id], ...data };
			return { ...bookings[id] };
		}
		const row = floorState.find((r) => r.id === id);
		if (row) Object.assign(row, data);
		return row ?? { id, ...data };
	},
	create: async (data: Record<string, unknown>) => {
		const row = { id: 'fs' + (floorState.length + 1), ...data } as Row;
		if (name === 'geisha_floor_state') floorState.push(row);
		return row;
	},
	delete: async (id: string) => {
		floorState = floorState.filter((r) => r.id !== id);
		return true;
	},
	getFullList: async () => (name === 'geisha_floor_state' ? floorState.map((r) => ({ ...r })) : []),
	getFirstListItem: async () => {
		throw new Error('not found');
	}
});

vi.mock('../db/pb.js', () => ({ pb: async () => ({ collection }) }));

// The audit row is written INSIDE deferWork, which production deliberately does
// NOT await (it lands just after the response). The REAL deferWork is left in
// place and flushDeferred() drains it, so these assertions exercise the actual
// deferred path rather than a stand-in for it — and never race the write.
//
// vi.hoisted because vi.mock factories are hoisted above the imports, so they
// cannot close over ordinary top-level consts.
const h = vi.hoisted(() => ({
	audits: [] as Array<{ actor: string; action: string; entityId: string; onBehalfOf?: string }>
}));

vi.mock('./audit.js', () => ({
	writeAudit: async (
		actor: string,
		action: string,
		_entity: string,
		entityId: string,
		_before: unknown,
		_after: unknown,
		onBehalfOf?: string
	) => {
		h.audits.push({ actor, action, entityId, onBehalfOf });
	}
}));

const audits = h.audits;

/** Drains the real deferWork queue so the deferred audit write has landed. */
const { flushDeferred } = await import('../util/defer.js');

vi.mock('./payments.js', () => ({
	settleNoShowMoney: async () => ({ outcome: 'skipped' }),
	releaseHold: async () => 0,
	refundDeposit: async () => 0
}));

vi.mock('../email/confirmations.js', () => ({ sendCancellation: async () => undefined }));

vi.mock('./crm.js', () => ({
	recomputeCustomerCounters: async () => undefined,
	setCustomerBlocked: async () => undefined
}));

import {
	cancelBooking,
	markNoShow,
	seatBooking,
	clearBooking,
	setFloorStatus,
	resetArrival,
	confirmBooking,
	reinstateBooking
} from './mutate.js';

const STAFF = 'stf_georgia';
const NOW = '2026-09-06T16:32:00Z';

/** Seed one booking, far enough ahead that cancelling it is not "late". */
function seed(over: Record<string, unknown> = {}) {
	bookings.bk1 = {
		id: 'bk1',
		restaurant: 'rst_asia',
		customer: 'cus_1',
		party_size: 4,
		starts_at: '2027-09-06T17:00:00Z',
		ends_at: '2027-09-06T18:30:00Z',
		tables: ['tbl_27'],
		status: 'confirmed',
		floor_status: '',
		...over
	};
}

/** The on_behalf_of recorded by the (single) audit row for `action`. */
const attributionFor = (action: string) => audits.find((a) => a.action === action)?.onBehalfOf;

beforeEach(() => {
	audits.length = 0;
	floorState = [];
	seed();
});

describe('floor mutations record which staff member acted', () => {
	it('attributes a cancellation', async () => {
		await cancelBooking('bk1', 'staff', { notify: false, staffId: STAFF });
		await flushDeferred();
		expect(attributionFor('cancel_booking')).toBe(STAFF);
	});

	it('attributes a no-show', async () => {
		await markNoShow('bk1', 'staff', { staffId: STAFF });
		await flushDeferred();
		expect(attributionFor('no_show')).toBe(STAFF);
	});

	it('attributes a seating', async () => {
		await seatBooking('bk1', NOW, 'staff', undefined, STAFF);
		await flushDeferred();
		expect(attributionFor('seat_booking')).toBe(STAFF);
	});

	it('attributes clearing a table', async () => {
		seed({ status: 'seated' });
		await clearBooking('bk1', NOW, 'staff', STAFF);
		await flushDeferred();
		expect(attributionFor('clear_booking')).toBe(STAFF);
	});

	it('attributes a holding-status change', async () => {
		await setFloorStatus('bk1', 'waiting_bar', 'staff', STAFF);
		await flushDeferred();
		expect(attributionFor('set_floor_status')).toBe(STAFF);
	});

	it('attributes resetting an arrival', async () => {
		seed({ status: 'seated' });
		await resetArrival('bk1', 'staff', STAFF);
		await flushDeferred();
		expect(attributionFor('reset_arrival')).toBe(STAFF);
	});

	it('attributes a confirmation', async () => {
		seed({ status: 'pending_payment' });
		await confirmBooking('bk1', 'staff', STAFF);
		await flushDeferred();
		expect(attributionFor('confirm_booking')).toBe(STAFF);
	});

	it('attributes a reinstatement', async () => {
		seed({ status: 'cancelled' });
		await reinstateBooking('bk1', 'staff', { staffId: STAFF });
		await flushDeferred();
		expect(attributionFor('reinstate_booking')).toBe(STAFF);
	});

	it('still works when no staff id is supplied (system and AI callers)', async () => {
		await cancelBooking('bk1', 'system', { notify: false });
		await flushDeferred();
		expect(audits.find((a) => a.action === 'cancel_booking')?.actor).toBe('system');
		expect(attributionFor('cancel_booking')).toBeFalsy();
	});
});
