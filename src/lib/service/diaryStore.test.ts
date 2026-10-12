// Store dirty-gate correctness — the heart of the overhaul. These tests encode the exact
// bug scenarios the old referee (7 reappliers + 6 pin stores) was fighting, and prove the
// single dirty-gate rule handles them.
//
// The store uses runes ($state/$derived) which need the Svelte compiler, so we exercise
// the store's LOGIC through its public methods and assert on `bars` (a plain-ish
// SvelteMap) rather than the $derived `rows` (which needs an effect root). Where we need
// the projection we call projectRows directly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { diaryStore } from './diaryStore.svelte';
import { barKey, type PositionedBar } from './diaryProjection';
import type { DiaryTimeline, DiaryBar } from '$lib/server/booking/admin';

function bar(
	bookingId: string,
	tableId: string,
	startMin: number,
	o: Partial<DiaryBar> = {}
): DiaryBar {
	return {
		bookingId,
		version: 'v1',
		movable: true,
		resizable: true,
		guestName: 'Guest',
		partySize: 2,
		status: 'confirmed',
		arrival: 'unarrived',
		channel: 'Online',
		paymentStatus: 'none',
		confirmed: false,
		hasPreorder: false,
		important: false,
		isNew: false,
		startsAt: '2026-07-07T18:00:00Z',
		endsAt: '2026-07-07T19:30:00Z',
		startMin,
		endMin: startMin + 90,
		startsBefore: false,
		endsAfter: false,
		hasNote: false,
		hasPromotion: false,
		firstVisit: false,
		leaveTimeConfirmed: false,
		detail: {
			ref: bookingId.slice(-6).toUpperCase(),
			guestName: 'Guest',
			partySize: 2,
			startsAt: '2026-07-07T18:00:00Z',
			endsAt: '2026-07-07T19:30:00Z',
			leaveTimeConfirmed: false,
			status: 'confirmed',
			channel: 'Online',
			tableLabels: [],
			tableIds: [tableId],
			confirmAttempts: 0,
			firstVisit: false,
			vip: false
		},
		...o
	};
}

// A timeline with the given bars laid out on tables t1/t2/t3.
function timeline(bars: DiaryBar[]): DiaryTimeline {
	const byTable = new Map<string, DiaryBar[]>();
	for (const b of bars) {
		const tid = b.detail.tableIds[0] ?? 't1';
		(byTable.get(tid) ?? byTable.set(tid, []).get(tid)!).push(b);
	}
	return {
		sections: [
			{
				name: 'Main',
				rows: [
					{ tableId: 't1', label: 'T1', seatsMax: 4, bars: byTable.get('t1') ?? [] },
					{ tableId: 't2', label: 'T2', seatsMax: 4, bars: byTable.get('t2') ?? [] },
					{ tableId: 't3', label: 'T3', seatsMax: 4, bars: byTable.get('t3') ?? [] }
				]
			}
		],
		startMs: 0,
		endMs: 1000,
		totalMin: 720,
		stepMin: 15,
		ticks: [],
		slotCovers: [],
		periodTotals: [],
		coversBreakdown: { periods: [], rows: [], subTotal: {}, excluded: {} },
		floors: [],
		nowMin: null,
		dividerMin: null,
		covers: bars.length * 2,
		bookingCount: bars.length,
		ui: {} as DiaryTimeline['ui']
	};
}

const ok = async () => ({ ok: true as const });
const fail = async () => ({ ok: false as const });

beforeEach(() => diaryStore.reset());

describe('reconcile — clean bookings', () => {
	it('loads server bars into the map', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60), bar('b2', 't2', 120)]));
		expect(diaryStore.bar('b1')?.startMin).toBe(60);
		expect(diaryStore.bar('b2')?._tableId).toBe('t2');
	});

	it('a later reconcile updates a clean booking to server truth', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		diaryStore.reconcile(timeline([bar('b1', 't1', 90)]));
		expect(diaryStore.bar('b1')?.startMin).toBe(90);
	});

	it('removes a booking the server no longer has (cross-device cancel)', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60), bar('b2', 't2', 120)]));
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		expect(diaryStore.bar('b2')).toBeNull();
	});
});

describe('the core bug — mid-edit reconcile cannot clobber an in-flight geometry edit', () => {
	it('a reconcile landing during a resize leaves the optimistic length intact', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		// Start a resize but DO NOT let the write resolve yet.
		let resolveWrite!: (v: { ok: boolean; data?: Record<string, unknown> }) => void;
		const writePending = new Promise<{ ok: boolean; data?: Record<string, unknown> }>(
			(r) => (resolveWrite = r)
		);
		const mutation = diaryStore.mutate(
			'b1',
			'geometry',
			(b) => (b.endMin = b.startMin + 150), // resize to 150min
			() => writePending
		);
		expect(diaryStore.bar('b1')?.endMin).toBe(60 + 150); // optimistic applied

		// A background reconcile lands mid-write carrying the OLD (pre-resize) window.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)])); // endMin would be 150 (60+90)
		expect(diaryStore.bar('b1')?.endMin).toBe(60 + 150); // <-- NOT clobbered

		// Now the write resolves with the authoritative new window.
		resolveWrite({
			ok: true,
			data: { version: 'v2', startsAt: '', endsAt: '', tableIds: ['t1'] }
		});
		await mutation;
		expect(diaryStore.bar('b1')?.endMin).toBe(60 + 150); // settled, still correct
	});

	it('two walk-ins then resize one: the resize survives the reconcile (the reported bug)', async () => {
		diaryStore.reconcile(timeline([]));
		// Insert two optimistic walk-ins (temp ids).
		const w1 = { ...bar('temp-1', 't1', 300), _tableId: 't1' } as PositionedBar;
		const w2 = { ...bar('temp-2', 't2', 300), _tableId: 't2' } as PositionedBar;
		diaryStore.insert(w1);
		diaryStore.insert(w2);
		// Resize the second while a reconcile from the first's write lands (server only has
		// the first walk-in so far).
		let resolve2!: (v: { ok: boolean; data?: Record<string, unknown> }) => void;
		const p2 = new Promise<{ ok: boolean; data?: Record<string, unknown> }>((r) => (resolve2 = r));
		const m = diaryStore.mutate(
			'temp-2',
			'geometry',
			(b) => (b.endMin = b.startMin + 150),
			() => p2
		);
		expect(diaryStore.bar('temp-2')?.endMin).toBe(300 + 150);
		// Reconcile carrying only walk-in 1 (real id), NOT temp-2 yet.
		diaryStore.reconcile(timeline([bar('real-1', 't1', 300)]));
		expect(diaryStore.bar('temp-2')?.endMin).toBe(300 + 150); // survives — dirty protects it
		resolve2({ ok: true, data: {} });
		await m;
		expect(diaryStore.bar('temp-2')?.endMin).toBe(300 + 150);
	});
});

describe('mutate — revert on failure', () => {
	it('restores the pre-patch snapshot when the write fails', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		await diaryStore.mutate('b1', 'geometry', (b) => (b.endMin = 999), fail);
		expect(diaryStore.bar('b1')?.endMin).toBe(60 + 90); // reverted
		expect(diaryStore.isDirty('b1')).toBe(false);
	});
});

describe('joined booking (several tables) — a move keeps EVERY table', () => {
	// The owner report: "bookings can stretch between multiple tables — when I move one it
	// shrinks to just one table." Half of that was the store: patching bar-by-bar, each
	// re-key DELETED the bar the previous one had just written when a set SHIFTED onto rows
	// it already occupied (t1→t2, t2→t3), so a joined party collapsed to its last row.
	const joined = () => [bar('b1', 't1', 60), bar('b1', 't2', 60)];

	it('shifting a two-table party one row down keeps both bars', async () => {
		diaryStore.reconcile(timeline(joined()));
		expect(
			diaryStore
				.barsOf('b1')
				.map((b) => b._tableId)
				.sort()
		).toEqual(['t1', 't2']);

		const remap: Record<string, string> = { t1: 't2', t2: 't3' };
		await diaryStore.mutate(
			'b1',
			'geometry',
			(b) => {
				b._tableId = remap[b._tableId] ?? b._tableId;
				b.startMin = 75;
				b.endMin = 165;
			},
			ok
		);
		expect(
			diaryStore
				.barsOf('b1')
				.map((b) => b._tableId)
				.sort()
		).toEqual(['t2', 't3']);
		expect(diaryStore.barsOf('b1').every((b) => b.startMin === 75)).toBe(true);
		expect(diaryStore.bars.has(barKey('b1', 't1'))).toBe(false); // the vacated row is clear
	});

	it('a re-time (same tables) leaves the whole set in place', async () => {
		diaryStore.reconcile(timeline(joined()));
		await diaryStore.mutate('b1', 'geometry', (b) => (b.startMin = 90), ok);
		expect(
			diaryStore
				.barsOf('b1')
				.map((b) => b._tableId)
				.sort()
		).toEqual(['t1', 't2']);
	});

	it('a failed move restores every table of the set', async () => {
		diaryStore.reconcile(timeline(joined()));
		const remap: Record<string, string> = { t1: 't2', t2: 't3' };
		await diaryStore.mutate(
			'b1',
			'geometry',
			(b) => (b._tableId = remap[b._tableId] ?? b._tableId),
			fail
		);
		expect(
			diaryStore
				.barsOf('b1')
				.map((b) => b._tableId)
				.sort()
		).toEqual(['t1', 't2']);
	});
});

describe('remove — tombstone cannot be resurrected by a stale pull', () => {
	it('an optimistic cancel is not re-added by a reconcile that still has the booking', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		await diaryStore.remove('b1', ok);
		expect(diaryStore.bar('b1')).toBeNull();
		// A stale pull whose server read predates the cancel still contains b1.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		expect(diaryStore.bar('b1')).toBeNull(); // <-- tombstone keeps it buried
		// Once the server no longer has it, the tombstone settles.
		diaryStore.reconcile(timeline([]));
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('restores the bar if the cancel write fails', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		await diaryStore.remove('b1', fail);
		expect(diaryStore.bar('b1')?.startMin).toBe(60);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});
});

describe('walk-in create lifecycle (Step 3)', () => {
	it('insert → reconcile predating create keeps the temp bar, promote+settle finalizes it', () => {
		diaryStore.reconcile(timeline([]));
		diaryStore.insert({ ...bar('temp-1', 't1', 300), _tableId: 't1' } as PositionedBar, 'geometry');
		// A reconcile that predates the create (server has nothing yet) must NOT drop it.
		diaryStore.reconcile(timeline([]));
		expect(diaryStore.bar('temp-1')?.startMin).toBe(300);
		// Create response lands → promote temp→real + settle the authoritative window.
		diaryStore.promote('temp-1', 'real-1', 'v2');
		diaryStore.settleWindow(
			'real-1',
			{
				version: 'v2',
				startsAt: '2026-07-07T18:00:00Z',
				endsAt: '2026-07-07T19:00:00Z',
				tableIds: ['t1']
			},
			(iso) => (iso.includes('19:00') ? 360 : 300)
		);
		expect(diaryStore.bar('temp-1')).toBeNull();
		expect(diaryStore.bar('real-1')?.version).toBe('v2');
		expect(diaryStore.isDirty('real-1')).toBe(false);
	});

	it('a resized fresh walk-in survives a reconcile before its window settles (the bug)', () => {
		diaryStore.reconcile(timeline([]));
		diaryStore.insert({ ...bar('temp-1', 't1', 300), _tableId: 't1' } as PositionedBar, 'geometry');
		// Host resizes it optimistically (geometry-dirty already covers it, but re-apply via a
		// direct patch to simulate the resize extending the bar).
		diaryStore.applyOptimisticStatus('temp-1', (b) => (b.endMin = 500), undefined, [
			'endMin',
			'startMin',
			'_tableId',
			'startsAt',
			'endsAt'
		]);
		// Reconcile lands with only OTHER bookings — the resized walk-in must persist.
		diaryStore.reconcile(timeline([bar('other', 't2', 100)]));
		expect(diaryStore.bar('temp-1')?.endMin).toBe(500);
	});

	it('dropOptimistic removes a failed/undone walk-in entirely (bar + dirty)', () => {
		diaryStore.reconcile(timeline([]));
		diaryStore.insert({ ...bar('temp-x', 't1', 300), _tableId: 't1' } as PositionedBar, 'geometry');
		diaryStore.dropOptimistic('temp-x');
		expect(diaryStore.bar('temp-x')).toBeNull();
		expect(diaryStore.isDirty('temp-x')).toBe(false);
		// A later reconcile can't resurrect it (there's no tombstone needed — it never existed).
		diaryStore.reconcile(timeline([]));
		expect(diaryStore.bar('temp-x')).toBeNull();
	});
});

describe('Book-modal create — insertCreated (server wins on arrival)', () => {
	it('keeps the optimistic bar until the reconcile has the real booking, then supersedes', () => {
		diaryStore.reconcile(timeline([]));
		diaryStore.insertCreated({
			...bar('r1', 't1', 120),
			_tableId: 't1',
			guestName: 'Optimistic'
		} as PositionedBar);
		// Stale reconcile predating the create → bar stays.
		diaryStore.reconcile(timeline([]));
		expect(diaryStore.bar('r1')?.guestName).toBe('Optimistic');
		// Reconcile now carries the real booking with server truth → it supersedes + clears dirty.
		diaryStore.reconcile(timeline([bar('r1', 't1', 120, { guestName: 'Server Truth' })]));
		expect(diaryStore.bar('r1')?.guestName).toBe('Server Truth');
		expect(diaryStore.isDirty('r1')).toBe(false);
	});
});

describe('promote — temp→real in one place', () => {
	it('re-keys bars and dirty from a temp id to the real id', () => {
		diaryStore.reconcile(timeline([]));
		diaryStore.insert({ ...bar('temp-x', 't1', 300), _tableId: 't1' } as PositionedBar);
		expect(diaryStore.isDirty('temp-x')).toBe(true);
		diaryStore.promote('temp-x', 'real-x', 'v9');
		expect(diaryStore.bar('temp-x')).toBeNull();
		expect(diaryStore.bar('real-x')?.version).toBe('v9');
		expect(diaryStore.isDirty('real-x')).toBe(true);
		expect(diaryStore.bars.has(barKey('real-x', 't1'))).toBe(true);
	});
});

describe('write-decoupled optimistic ops (migration phase — legacy owns the write)', () => {
	it('applyOptimisticStatus patches + protects arrival; revertOptimistic restores it', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { arrival: 'unarrived' })]));
		diaryStore.applyOptimisticStatus('b1', (b) => (b.arrival = 'arrived'), 'arrived');
		expect(diaryStore.bar('b1')?.arrival).toBe('arrived');
		// a racing reconcile can't flip it back
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { arrival: 'unarrived' })]));
		expect(diaryStore.bar('b1')?.arrival).toBe('arrived');
		// legacy write failed → revert
		diaryStore.revertOptimistic('b1');
		expect(diaryStore.bar('b1')?.arrival).toBe('unarrived');
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('a stale part-seated pull cannot cancel an in-flight "Seat all"', () => {
		// Both states are status='seated' server-side, so the gate must compare arrivals.
		diaryStore.reconcile(
			timeline([bar('b1', 't1', 60, { status: 'seated', arrival: 'partially_seated' })])
		);
		diaryStore.applyOptimisticStatus('b1', (b) => (b.arrival = 'arrived'), 'arrived');
		// A pull taken BEFORE the seat write landed still reads part-seated — hold 'arrived'.
		diaryStore.reconcile(
			timeline([bar('b1', 't1', 60, { status: 'seated', arrival: 'partially_seated' })])
		);
		expect(diaryStore.bar('b1')?.arrival).toBe('arrived');
		expect(diaryStore.isDirty('b1')).toBe(true);
		// The pull that carries the seating clears the gate.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { status: 'seated', arrival: 'arrived' })]));
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('a stale fully-seated pull cannot cancel an in-flight part-seat', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { status: 'seated', arrival: 'arrived' })]));
		diaryStore.applyOptimisticStatus(
			'b1',
			(b) => (b.arrival = 'partially_seated'),
			'partially_seated'
		);
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { status: 'seated', arrival: 'arrived' })]));
		expect(diaryStore.bar('b1')?.arrival).toBe('partially_seated');
		diaryStore.reconcile(
			timeline([bar('b1', 't1', 60, { status: 'seated', arrival: 'partially_seated' })])
		);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('applyOptimisticStatus with a custom field list protects only that field (confirm)', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { confirmed: false })]));
		diaryStore.applyOptimisticStatus('b1', (b) => (b.confirmed = true), undefined, ['confirmed']);
		expect(diaryStore.bar('b1')?.confirmed).toBe(true);
		// a reconcile still carrying confirmed=false must not un-confirm it
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { confirmed: false })]));
		expect(diaryStore.bar('b1')?.confirmed).toBe(true);
		// clears once the server reflects the confirm (no arrival intent → present is enough)
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { confirmed: true })]));
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('applyOptimisticRemove tombstones; revertOptimistic brings the bar back', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		diaryStore.applyOptimisticRemove('b1');
		expect(diaryStore.bar('b1')).toBeNull();
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)])); // stale pull
		expect(diaryStore.bar('b1')).toBeNull(); // stays buried
		diaryStore.revertOptimistic('b1'); // legacy cancel write failed
		expect(diaryStore.bar('b1')?.startMin).toBe(60);
	});

	it('settleWindow merges the response window + clears the dirty (covers)', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		diaryStore.applyOptimisticStatus('b1', (b) => (b.partySize = 4), undefined, ['partySize']);
		expect(diaryStore.isDirty('b1')).toBe(true);
		diaryStore.settleWindow(
			'b1',
			{
				version: 'v2',
				startsAt: '2026-07-07T18:00:00Z',
				endsAt: '2026-07-07T20:00:00Z',
				tableIds: ['t1']
			},
			(iso) => (iso.includes('20:00') ? 200 : 60)
		);
		expect(diaryStore.bar('b1')?.version).toBe('v2');
		expect(diaryStore.bar('b1')?.endMin).toBe(200); // sitting lengthened
		expect(diaryStore.bar('b1')?.partySize).toBe(4); // optimistic party kept
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	// A bar's DRAWN minutes are not its booked window — the server trims the left edge to
	// the seat stamp and snaps the right edge out to its cell. A drag has already put the
	// bar where the host wants it, so settling must not re-derive the position from the
	// booked window and undo that drawing.
	it('settleWindow with reposition:false takes the window but leaves the drawing', () => {
		// Booked 18:00 (minute 60) but SEATED late, so the server drew it at 240.
		diaryStore.reconcile(timeline([bar('b1', 't1', 240)]));
		// The host drags it to another table at minute 300 — the optimistic position.
		diaryStore.stageGeometry('b1', [{ tableId: 't2', startMin: 300, endMin: 390 }]);
		diaryStore.settleWindow(
			'b1',
			{
				version: 'v2',
				startsAt: '2026-07-07T18:00:00Z',
				endsAt: '2026-07-07T19:30:00Z',
				tableIds: ['t2']
			},
			(iso) => (iso.includes('19:30') ? 150 : 60),
			{ reposition: false }
		);
		expect(diaryStore.bar('b1')?.version).toBe('v2'); // token still refreshed
		expect(diaryStore.bar('b1')?.startsAt).toBe('2026-07-07T18:00:00Z'); // window still merged
		expect(diaryStore.bar('b1')?.startMin).toBe(300); // …but NOT dragged back to 60
		expect(diaryStore.bar('b1')?.endMin).toBe(390);
	});

	it('settleWindow still repositions by default (covers lengthening a sitting)', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		diaryStore.settleWindow(
			'b1',
			{ version: 'v2', startsAt: '2026-07-07T18:00:00Z', endsAt: '2026-07-07T20:00:00Z' },
			(iso) => (iso.includes('20:00') ? 200 : 60)
		);
		expect(diaryStore.bar('b1')?.endMin).toBe(200);
	});
});

describe('staged geometry (move/resize/swap) — Step 4', () => {
	it('stageGeometry moves a booking to a new table and protects it from reconcile', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		diaryStore.stageGeometry('b1', [{ tableId: 't2', startMin: 120, endMin: 210 }]);
		expect(diaryStore.bar('b1')?._tableId).toBe('t2');
		expect(diaryStore.bar('b1')?.startMin).toBe(120);
		// a reconcile carrying the OLD position must not snap it back
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		expect(diaryStore.bar('b1')?._tableId).toBe('t2');
		expect(diaryStore.bar('b1')?.startMin).toBe(120);
	});

	it('multiple successive drags accumulate; snapshot stays the TRUE origin for cancel', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		diaryStore.stageGeometry('b1', [{ tableId: 't2', startMin: 120, endMin: 210 }]);
		diaryStore.stageGeometry('b1', [{ tableId: 't3', startMin: 300, endMin: 390 }]);
		expect(diaryStore.bar('b1')?._tableId).toBe('t3');
		// cancel → back to the ORIGINAL t1/60, not the intermediate t2/120
		diaryStore.revertOptimistic('b1');
		expect(diaryStore.bar('b1')?._tableId).toBe('t1');
		expect(diaryStore.bar('b1')?.startMin).toBe(60);
	});

	it('resize-after-swap: the resized length survives a reconcile (the classic bug)', () => {
		diaryStore.reconcile(timeline([bar('a', 't1', 60), bar('b', 't2', 60)]));
		// swap a↔b (positions exchanged)
		diaryStore.stageGeometry('a', [{ tableId: 't2', startMin: 60, endMin: 150 }]);
		diaryStore.stageGeometry('b', [{ tableId: 't1', startMin: 60, endMin: 150 }]);
		// then resize a (now on t2) longer
		diaryStore.stageGeometry('a', [{ tableId: 't2', startMin: 60, endMin: 240 }]);
		// a reconcile carrying pre-swap, pre-resize truth must not clobber either
		diaryStore.reconcile(timeline([bar('a', 't1', 60), bar('b', 't2', 60)]));
		expect(diaryStore.bar('a')?._tableId).toBe('t2');
		expect(diaryStore.bar('a')?.endMin).toBe(240); // resize kept
		expect(diaryStore.bar('b')?._tableId).toBe('t1'); // swap kept
	});

	it('batch commit settles each booking from the response and clears dirty', () => {
		diaryStore.reconcile(timeline([bar('a', 't1', 60), bar('b', 't2', 60)]));
		diaryStore.stageGeometry('a', [{ tableId: 't2', startMin: 60, endMin: 150 }]);
		diaryStore.stageGeometry('b', [{ tableId: 't1', startMin: 60, endMin: 150 }]);
		// applyBatch success → settle both from batched[]
		const minOf = (iso: string) => (iso.includes('19:30') ? 150 : 60);
		diaryStore.settleWindow(
			'a',
			{
				version: 'v2',
				startsAt: '2026-07-07T18:00:00Z',
				endsAt: '2026-07-07T19:30:00Z',
				tableIds: ['t2']
			},
			minOf
		);
		diaryStore.settleWindow(
			'b',
			{
				version: 'v2',
				startsAt: '2026-07-07T18:00:00Z',
				endsAt: '2026-07-07T19:30:00Z',
				tableIds: ['t1']
			},
			minOf
		);
		expect(diaryStore.isDirty('a')).toBe(false);
		expect(diaryStore.isDirty('b')).toBe(false);
		expect(diaryStore.bar('a')?.version).toBe('v2');
	});
});

describe('field (status) dirty — per-field skip + confirming reconcile', () => {
	it('keeps optimistic arrival across a non-confirming reconcile, clears on a confirming one', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { arrival: 'unarrived' })]));
		// Optimistic seat → arrival 'arrived'.
		await diaryStore.mutate('b1', 'field', (b) => (b.arrival = 'arrived'), ok, {
			intendedArrival: 'arrived'
		});
		expect(diaryStore.bar('b1')?.arrival).toBe('arrived');
		expect(diaryStore.isDirty('b1')).toBe(true);
		// A pre-seat pull (booking present but still 'unarrived') must NOT flip it back.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { arrival: 'unarrived' })]));
		expect(diaryStore.bar('b1')?.arrival).toBe('arrived'); // dirty field skipped
		expect(diaryStore.isDirty('b1')).toBe(true); // not yet confirmed
		// A confirming pull (server now shows seated) clears the dirty.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { arrival: 'arrived', status: 'seated' })]));
		expect(diaryStore.bar('b1')?.arrival).toBe('arrived');
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('a status dirty does not block a concurrent geometry reconcile (position updates)', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { arrival: 'unarrived' })]));
		await diaryStore.mutate('b1', 'field', (b) => (b.arrival = 'arrived'), ok, {
			intendedArrival: 'arrived'
		});
		// Server moves the booking's window (another device re-timed it) — geometry is NOT a
		// dirty field for a status op, so it should update.
		diaryStore.reconcile(timeline([bar('b1', 't1', 200, { arrival: 'unarrived' })]));
		expect(diaryStore.bar('b1')?.startMin).toBe(200); // geometry flowed through
		expect(diaryStore.bar('b1')?.arrival).toBe('arrived'); // arrival still protected
	});
});

describe('mutatePair — atomic two-booking swap (instant-commit)', () => {
	// A swap patch: exchange the two bookings' _tableId (positional swap keeps each own window
	// in these tests for simplicity — the real page also swaps start, but table exchange is the
	// atomicity-critical part).
	const swapPatch = (tableA: string, tableB: string) => (barsA: any[], barsB: any[]) => {
		for (const b of barsA) b._tableId = tableB; // A moves to B's table
		for (const b of barsB) b._tableId = tableA; // B moves to A's table
	};

	it('exchanges two bookings’ tables atomically and settles both on success', async () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60), bar('B', 't2', 120)]));
		const okPair = async () => ({
			ok: true as const,
			data: { a: { version: 'vA2', tableIds: ['t2'] }, b: { version: 'vB2', tableIds: ['t1'] } }
		});
		const done = await diaryStore.mutatePair(
			'A',
			'B',
			swapPatch('t1', 't2'),
			okPair,
			(data: any) => {
				diaryStore.settleTables('A', data.a);
				diaryStore.settleTables('B', data.b);
			}
		);
		expect(done).toBe(true);
		expect(diaryStore.bar('A')?._tableId).toBe('t2');
		expect(diaryStore.bar('B')?._tableId).toBe('t1');
		expect(diaryStore.bar('A')?.version).toBe('vA2');
		expect(diaryStore.isDirty('A')).toBe(false);
		expect(diaryStore.isDirty('B')).toBe(false);
		// No stacking: t1 has exactly B, t2 has exactly A.
		const onT1 = [...diaryStore.bars.values()].filter((b) => b._tableId === 't1');
		const onT2 = [...diaryStore.bars.values()].filter((b) => b._tableId === 't2');
		expect(onT1.map((b) => b.bookingId)).toEqual(['B']);
		expect(onT2.map((b) => b.bookingId)).toEqual(['A']);
	});

	it('never transiently stacks: after the optimistic patch, no table holds two bookings', async () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60), bar('B', 't2', 120)]));
		let midState: string[] = [];
		const capturingWrite = async () => {
			// At write time the optimistic exchange has ALREADY been applied — assert no stack.
			const byTable = new Map<string, string[]>();
			for (const b of diaryStore.bars.values())
				(byTable.get(b._tableId) ?? byTable.set(b._tableId, []).get(b._tableId)!).push(b.bookingId);
			midState = [...byTable.entries()].filter(([, ids]) => ids.length > 1).map(([t]) => t);
			return { ok: true as const, data: { a: {}, b: {} } };
		};
		await diaryStore.mutatePair('A', 'B', swapPatch('t1', 't2'), capturingWrite, () => {});
		expect(midState).toEqual([]); // no table had 2 bookings mid-swap
	});

	it('reverts BOTH bookings on write failure', async () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60), bar('B', 't2', 120)]));
		const done = await diaryStore.mutatePair('A', 'B', swapPatch('t1', 't2'), fail, () => {
			throw new Error('settle must not run on failure');
		});
		expect(done).toBe(false);
		expect(diaryStore.bar('A')?._tableId).toBe('t1'); // back to origin
		expect(diaryStore.bar('B')?._tableId).toBe('t2');
		expect(diaryStore.isDirty('A')).toBe(false);
		expect(diaryStore.isDirty('B')).toBe(false);
	});

	it('a mid-swap reconcile cannot clobber the optimistic exchange (dirty-gated)', async () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60), bar('B', 't2', 120)]));
		let resolveWrite!: (v: any) => void;
		const pending = new Promise<any>((r) => (resolveWrite = r));
		const m = diaryStore.mutatePair(
			'A',
			'B',
			swapPatch('t1', 't2'),
			() => pending,
			(data: any) => {
				diaryStore.settleTables('A', data.a);
				diaryStore.settleTables('B', data.b);
			}
		);
		// Optimistic swap applied; now a reconcile lands carrying the OLD (pre-swap) positions.
		diaryStore.reconcile(timeline([bar('A', 't1', 60), bar('B', 't2', 120)]));
		expect(diaryStore.bar('A')?._tableId).toBe('t2'); // NOT clobbered
		expect(diaryStore.bar('B')?._tableId).toBe('t1');
		resolveWrite({
			ok: true,
			data: { a: { version: 'vA2', tableIds: ['t2'] }, b: { version: 'vB2', tableIds: ['t1'] } }
		});
		await m;
		expect(diaryStore.bar('A')?._tableId).toBe('t2');
	});
});

describe('settleTables — swap response (version + tableIds, no window)', () => {
	it('re-homes a booking onto the returned table and refreshes version', () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60)]));
		diaryStore.settleTables('A', { version: 'v9', tableIds: ['t3'] });
		expect(diaryStore.bar('A')?._tableId).toBe('t3');
		expect(diaryStore.bar('A')?.version).toBe('v9');
	});

	it('with no tableIds, just refreshes version', () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60)]));
		diaryStore.settleTables('A', { version: 'v9' });
		expect(diaryStore.bar('A')?._tableId).toBe('t1');
		expect(diaryStore.bar('A')?.version).toBe('v9');
	});
});

// A deferred write whose resolution the test controls, tracking whether it was invoked
// (i.e. dequeued from the booking's write chain).
function deferred() {
	let resolve!: (v: { ok: boolean; data?: Record<string, unknown> }) => void;
	let invoked = false;
	const p = new Promise<{ ok: boolean; data?: Record<string, unknown> }>((r) => (resolve = r));
	return { write: () => ((invoked = true), p), resolve, invoked: () => invoked };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('per-booking write serialization — rapid overlapping edits on ONE booking', () => {
	it('overlapping mutates on one booking serialise the writes in gesture order', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		const w1 = deferred();
		const w2 = deferred();
		const m1 = diaryStore.mutate('b1', 'geometry', (b) => (b._tableId = 't2'), w1.write);
		const m2 = diaryStore.mutate('b1', 'geometry', (b) => (b.endMin = 60 + 120), w2.write);
		await tick();
		expect(w1.invoked()).toBe(true);
		expect(w2.invoked()).toBe(false); // queued behind w1
		// Board shows BOTH optimistic patches already (applied synchronously, in order).
		expect(diaryStore.bar('b1')?._tableId).toBe('t2');
		expect(diaryStore.bar('b1')?.endMin).toBe(180);
		w1.resolve({ ok: true, data: { version: 'v2' } });
		await m1;
		await tick();
		expect(w2.invoked()).toBe(true); // dequeued only after w1 finished
		w2.resolve({ ok: true, data: { version: 'v3' } });
		await m2;
	});

	it('writes on different bookings do not serialise', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60), bar('b2', 't2', 120)]));
		const w1 = deferred();
		const w2 = deferred();
		void diaryStore.mutate('b1', 'geometry', (b) => (b.endMin += 15), w1.write);
		void diaryStore.mutate('b2', 'geometry', (b) => (b.endMin += 15), w2.write);
		await tick();
		expect(w1.invoked()).toBe(true);
		expect(w2.invoked()).toBe(true); // independent chains
		w1.resolve({ ok: true });
		w2.resolve({ ok: true });
	});

	it('a burst that FULLY fails restores the true pre-burst origin (keep-snapshot)', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		const w1 = deferred();
		const w2 = deferred();
		const m1 = diaryStore.mutate('b1', 'geometry', (b) => (b._tableId = 't2'), w1.write);
		const m2 = diaryStore.mutate('b1', 'geometry', (b) => (b.endMin = 60 + 120), w2.write);
		w1.resolve({ ok: false });
		expect(await m1).toBe(false);
		// Superseded failure: no restore — op2's optimistic state still stands.
		expect(diaryStore.bar('b1')?._tableId).toBe('t2');
		expect(diaryStore.isDirty('b1')).toBe(true);
		w2.resolve({ ok: false });
		expect(await m2).toBe(false);
		// Final failure with nothing succeeded → restore the ORIGINAL snapshot, not the
		// post-move intermediate.
		expect(diaryStore.bar('b1')?._tableId).toBe('t1');
		expect(diaryStore.bar('b1')?.startMin).toBe(60);
		expect(diaryStore.bar('b1')?.endMin).toBe(150);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('a superseded success skips its settle, keeps the dirty, and only refreshes version', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		const w1 = deferred();
		const w2 = deferred();
		let settled1 = 0;
		let settled2 = 0;
		const m1 = diaryStore.mutate('b1', 'geometry', (b) => (b._tableId = 't2'), w1.write, {
			settle: () => settled1++
		});
		const m2 = diaryStore.mutate('b1', 'geometry', (b) => (b.endMin = 60 + 120), w2.write, {
			settle: () => settled2++
		});
		w1.resolve({ ok: true, data: { version: 'v9', startsAt: '2026-07-07T10:00:00Z' } });
		expect(await m1).toBe(true);
		expect(settled1).toBe(0); // superseded: settle skipped
		expect(diaryStore.isDirty('b1')).toBe(true); // op2 still protected
		expect(diaryStore.bar('b1')?.endMin).toBe(180); // op2's optimistic geometry stands
		expect(diaryStore.bar('b1')?.version).toBe('v9'); // version-only refresh
		// A stale reconcile mid-gap still can't clobber op2's patch.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		expect(diaryStore.bar('b1')?._tableId).toBe('t2');
		expect(diaryStore.bar('b1')?.endMin).toBe(180);
		// The final op settles from ITS response and clears the dirty.
		w2.resolve({ ok: true, data: { version: 'v10' } });
		expect(await m2).toBe(true);
		expect(settled2).toBe(1);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('op1 failure with op2 queued does not restore or unprotect', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		const w1 = deferred();
		const w2 = deferred();
		let settled2 = 0;
		const m1 = diaryStore.mutate('b1', 'geometry', (b) => (b._tableId = 't2'), w1.write);
		const m2 = diaryStore.mutate('b1', 'geometry', (b) => (b.endMin = 60 + 120), w2.write, {
			settle: () => settled2++
		});
		w1.resolve({ ok: false });
		expect(await m1).toBe(false);
		expect(diaryStore.bar('b1')?._tableId).toBe('t2'); // op2's optimistic state intact
		expect(diaryStore.isDirty('b1')).toBe(true);
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)])); // stale pull mid-gap
		expect(diaryStore.bar('b1')?.endMin).toBe(180); // still protected
		w2.resolve({ ok: true, data: { version: 'v3' } });
		expect(await m2).toBe(true);
		expect(settled2).toBe(1);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('final failure AFTER an earlier success does not restore the stale origin (succeededAny)', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		const w1 = deferred();
		const w2 = deferred();
		const m1 = diaryStore.mutate('b1', 'geometry', (b) => (b._tableId = 't2'), w1.write);
		const m2 = diaryStore.mutate('b1', 'geometry', (b) => (b.endMin = 60 + 120), w2.write);
		w1.resolve({ ok: true, data: { version: 'v2' } }); // DB moved to t2
		expect(await m1).toBe(true);
		w2.resolve({ ok: false });
		expect(await m2).toBe(false);
		// Restoring the pre-burst snapshot (t1) would match neither DB (t2, old length) nor
		// intent — the optimistic state stays; the caller's drained reconcile repaints truth.
		expect(diaryStore.bar('b1')?._tableId).toBe('t2');
		expect(diaryStore.isDirty('b1')).toBe(false); // unprotected, so that reconcile lands
	});

	it('a three-op burst settles exactly once, from the last op', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		const w1 = deferred();
		const w2 = deferred();
		const w3 = deferred();
		const settles: string[] = [];
		const m1 = diaryStore.mutate('b1', 'geometry', (b) => (b._tableId = 't2'), w1.write, {
			settle: () => settles.push('1')
		});
		const m2 = diaryStore.mutate('b1', 'geometry', (b) => (b.endMin = 60 + 120), w2.write, {
			settle: () => settles.push('2')
		});
		const m3 = diaryStore.mutate('b1', 'geometry', (b) => (b._tableId = 't3'), w3.write, {
			settle: () => settles.push('3')
		});
		w1.resolve({ ok: true, data: {} });
		await m1;
		w2.resolve({ ok: true, data: {} });
		await m2;
		expect(diaryStore.isDirty('b1')).toBe(true); // still owned by op3
		w3.resolve({ ok: true, data: { version: 'v4' } });
		await m3;
		expect(settles).toEqual(['3']);
		expect(diaryStore.isDirty('b1')).toBe(false);
		expect(diaryStore.bar('b1')?._tableId).toBe('t3');
	});

	it('a reconcile during an in-flight move does not resurrect the old-table bar (ghost fix)', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		const w1 = deferred();
		const m1 = diaryStore.mutate('b1', 'geometry', (b) => (b._tableId = 't2'), w1.write);
		// The pull still has b1 on t1 — it must NOT materialise a duplicate bar there.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		expect(diaryStore.barsOf('b1').length).toBe(1);
		expect(diaryStore.bar('b1')?._tableId).toBe('t2');
		w1.resolve({ ok: true, data: {} });
		await m1;
	});

	it('mutatePair chains behind an in-flight mutate on a participant', async () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60), bar('B', 't2', 120)]));
		const w1 = deferred();
		const wp = deferred();
		const m1 = diaryStore.mutate('A', 'geometry', (b) => (b.startMin = 90), w1.write);
		const swap = (barsA: any[], barsB: any[]) => {
			for (const x of barsA) x._tableId = 't2';
			for (const x of barsB) x._tableId = 't1';
		};
		let settled = 0;
		const mp = diaryStore.mutatePair('A', 'B', swap, wp.write, () => settled++);
		await tick();
		expect(wp.invoked()).toBe(false); // queued behind A's move
		expect(diaryStore.bar('B')?._tableId).toBe('t1'); // but patched instantly
		w1.resolve({ ok: true, data: {} });
		await m1;
		await tick();
		expect(wp.invoked()).toBe(true);
		wp.resolve({ ok: true, data: { a: {}, b: {} } });
		expect(await mp).toBe(true);
		expect(settled).toBe(1);
		expect(diaryStore.isDirty('A')).toBe(false);
		expect(diaryStore.isDirty('B')).toBe(false);
	});

	it('pair completion with a newer op on one side: settle skipped, only the other clears', async () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60), bar('B', 't2', 120)]));
		const wp = deferred();
		const w2 = deferred();
		const swap = (barsA: any[], barsB: any[]) => {
			for (const x of barsA) x._tableId = 't2';
			for (const x of barsB) x._tableId = 't1';
		};
		let pairSettled = 0;
		let s2 = 0;
		const mp = diaryStore.mutatePair('A', 'B', swap, wp.write, () => pairSettled++);
		// A newer op on A lands while the pair write is in flight (its write queues).
		const m2 = diaryStore.mutate('A', 'geometry', (b) => (b.endMin = 60 + 180), w2.write, {
			settle: () => s2++
		});
		wp.resolve({ ok: true, data: { a: {}, b: {} } });
		expect(await mp).toBe(true);
		expect(pairSettled).toBe(0); // settle touches both — skipped when one is superseded
		expect(diaryStore.isDirty('B')).toBe(false); // current side clears
		expect(diaryStore.isDirty('A')).toBe(true); // superseded side stays with its newer op
		expect(diaryStore.bar('A')?.endMin).toBe(240); // op2's optimistic patch intact
		w2.resolve({ ok: true, data: {} });
		expect(await m2).toBe(true);
		expect(s2).toBe(1);
		expect(diaryStore.isDirty('A')).toBe(false);
	});

	it('pair failure restores only current, un-succeeded participants', async () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60), bar('B', 't2', 120)]));
		const wp = deferred();
		const w2 = deferred();
		const swap = (barsA: any[], barsB: any[]) => {
			for (const x of barsA) x._tableId = 't2';
			for (const x of barsB) x._tableId = 't1';
		};
		const mp = diaryStore.mutatePair('A', 'B', swap, wp.write, () => {});
		const m2 = diaryStore.mutate('A', 'geometry', (b) => (b.endMin = 60 + 180), w2.write);
		wp.resolve({ ok: false });
		expect(await mp).toBe(false);
		// B (current, nothing succeeded) reverts to its origin; A belongs to the newer op.
		expect(diaryStore.bar('B')?._tableId).toBe('t2');
		expect(diaryStore.isDirty('B')).toBe(false);
		expect(diaryStore.bar('A')?._tableId).toBe('t2'); // still optimistically swapped
		expect(diaryStore.bar('A')?.endMin).toBe(240); // + op2's resize
		expect(diaryStore.isDirty('A')).toBe(true);
		w2.resolve({ ok: true, data: {} });
		await m2;
	});

	it('promote mid-burst re-keys the chain and the ownership check', async () => {
		diaryStore.reconcile(timeline([]));
		diaryStore.insert({ ...bar('temp-1', 't1', 60), _tableId: 't1' } as any, 'geometry');
		const p1 = deferred();
		let s1 = 0;
		// The first write promotes temp→real mid-flight (like a walk-in create landing),
		// then stays pending.
		const m1 = diaryStore.mutate(
			'temp-1',
			'geometry',
			(b) => (b.endMin = 60 + 120),
			() => {
				diaryStore.promote('temp-1', 'real-1', 'v1');
				return p1.write();
			},
			{ settle: () => s1++ }
		);
		await tick(); // write1 invoked → promote has run, p1 still pending
		const w2 = deferred();
		let s2 = 0;
		const m2 = diaryStore.mutate('real-1', 'geometry', (b) => (b._tableId = 't2'), w2.write, {
			settle: () => s2++
		});
		await tick();
		expect(w2.invoked()).toBe(false); // chained behind the promoted temp's write
		p1.resolve({ ok: true, data: {} });
		expect(await m1).toBe(true);
		expect(s1).toBe(0); // superseded by m2
		await tick();
		expect(w2.invoked()).toBe(true);
		w2.resolve({ ok: true, data: { version: 'v2' } });
		expect(await m2).toBe(true);
		expect(s2).toBe(1);
		expect(diaryStore.isDirty('temp-1')).toBe(false);
		expect(diaryStore.isDirty('real-1')).toBe(false);
		expect(diaryStore.bar('real-1')?._tableId).toBe('t2');
		expect(diaryStore.bar('temp-1')).toBeNull();
	});

	it('markSeated holds arrived over a reconcile that reads the walk-in back unarrived (blue-flash fix)', () => {
		// The server seats a walk-in on create but writes floor_state async, so a reconcile
		// in the next few seconds reads it 'unarrived' — even as a FRESH insert under the
		// promoted real id (no local bar/dirty to compare). markSeated time-gates that.
		diaryStore.reconcile(timeline([]));
		diaryStore.markSeated('w1');
		// A reconcile brings the booking in for the FIRST time, unarrived (deferred seat).
		diaryStore.reconcile(
			timeline([bar('w1', 't1', 60, { arrival: 'unarrived', status: 'seated' })])
		);
		expect(diaryStore.bar('w1')?.arrival).toBe('arrived'); // grace held it green — no blue flash
		// A terminal state is NOT masked (a genuine un-seat / completion shows through).
		diaryStore.reconcile(timeline([bar('w1', 't1', 60, { arrival: 'left', status: 'completed' })]));
		expect(diaryStore.bar('w1')?.arrival).toBe('left');
	});

	it('markSeated is alias-aware and does not mask an unrelated booking', () => {
		diaryStore.reconcile(timeline([]));
		// mark a temp id, then promote — the grace must follow to the real id.
		diaryStore.insert({ ...bar('temp-s', 't1', 60), _tableId: 't1' } as any, 'geometry');
		diaryStore.markSeated('temp-s');
		diaryStore.promote('temp-s', 'real-s', 'v1');
		diaryStore.clearDirty('real-s'); // simulate the geometry settle clearing the dirty
		diaryStore.reconcile(
			timeline([bar('real-s', 't1', 60, { arrival: 'unarrived', status: 'seated' })])
		);
		expect(diaryStore.bar('real-s')?.arrival).toBe('arrived'); // grace followed the alias
		// an unrelated unseated booking is untouched
		diaryStore.reconcile(
			timeline([
				bar('real-s', 't1', 60, { arrival: 'unarrived', status: 'seated' }),
				bar('other', 't2', 120, { arrival: 'unarrived' })
			])
		);
		expect(diaryStore.bar('other')?.arrival).toBe('unarrived');
	});

	it('protectAndPatch widens an in-flight geometry dirty to also guard arrival (blue-flash fix)', async () => {
		// A fresh walk-in resized while its create is in flight: geometry dirty protects
		// size/table, but the deferred seat means a reconcile can flash arrival to
		// 'unarrived' (blue). protectAndPatch stamps 'arrived' + adds arrival to the SAME
		// geometry dirty so the pre-seat pull can't clobber the colour.
		diaryStore.reconcile(timeline([]));
		diaryStore.insert(
			{ ...bar('temp-b', 't1', 60, { arrival: 'unarrived' }), _tableId: 't1' } as any,
			'geometry'
		);
		const w = deferred();
		const m = diaryStore.mutate('temp-b', 'geometry', (b) => (b.endMin = 60 + 60), w.write);
		diaryStore.promote('temp-b', 'real-b', 'v1');
		// Create-success stamps 'arrived' + widens the geometry dirty (does NOT settle geometry).
		diaryStore.protectAndPatch('real-b', (b) => (b.arrival = 'arrived'), ['arrival', 'status']);
		expect(diaryStore.bar('real-b')?.arrival).toBe('arrived');
		expect(diaryStore.isDirtyKind('real-b', 'geometry')).toBe(true); // still geometry, not replaced
		// A reconcile carrying the booking PRE-SEAT (arrival unarrived, full 90-min window) must
		// NOT flash the colour OR the resized length.
		diaryStore.reconcile(timeline([bar('real-b', 't1', 60, { arrival: 'unarrived' })]));
		expect(diaryStore.bar('real-b')?.arrival).toBe('arrived'); // colour protected
		expect(diaryStore.bar('real-b')?.endMin).toBe(120); // resized length protected
		w.resolve({ ok: true, data: {} });
		await m;
	});

	it('protectAndPatch is a no-op when nothing is in flight', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { arrival: 'unarrived' })]));
		diaryStore.protectAndPatch('b1', (b) => (b.arrival = 'arrived'), ['arrival']);
		expect(diaryStore.bar('b1')?.arrival).toBe('unarrived'); // untouched — no dirty to widen
	});

	it('isDirtyKind is alias-aware: a geometry edit on a temp id shows through its real id', async () => {
		// The "resize a fresh walk-in → it reverts for a second" fix: the walk-in create's
		// success handler checks isDirtyKind(tempId, 'geometry') to know it must NOT settle
		// geometry over an in-flight resize. That check must see the edit even though the
		// create is about to promote temp→real.
		diaryStore.reconcile(timeline([]));
		diaryStore.insert({ ...bar('temp-9', 't1', 60), _tableId: 't1' } as any, 'geometry');
		const w = deferred();
		// A resize is in flight on the still-temp bar (write pending).
		const m = diaryStore.mutate('temp-9', 'geometry', (b) => (b.endMin = 60 + 60), w.write);
		expect(diaryStore.isDirtyKind('temp-9', 'geometry')).toBe(true);
		// The create resolves and promotes; a check on the REAL id must still report the
		// in-flight geometry edit (via the alias), so the create skips its settle.
		diaryStore.promote('temp-9', 'real-9', 'v1');
		expect(diaryStore.isDirtyKind('real-9', 'geometry')).toBe(true);
		expect(diaryStore.isDirtyKind('temp-9', 'geometry')).toBe(true); // temp id still resolves
		expect(diaryStore.isDirtyKind('real-9', 'field')).toBe(false);
		w.resolve({ ok: true, data: {} });
		await m;
		expect(diaryStore.isDirtyKind('real-9', 'geometry')).toBe(false); // settled + cleared
	});

	it('whenIdle resolves only after the booking’s chain drains', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		const w1 = deferred();
		const w2 = deferred();
		const m1 = diaryStore.mutate('b1', 'geometry', (b) => (b.endMin += 15), w1.write);
		const m2 = diaryStore.mutate('b1', 'geometry', (b) => (b.endMin += 15), w2.write);
		let idle = false;
		const p = diaryStore.whenIdle('b1').then(() => (idle = true));
		await tick();
		expect(idle).toBe(false);
		w1.resolve({ ok: true, data: {} });
		await m1;
		expect(idle).toBe(false); // op2 still in flight
		w2.resolve({ ok: true, data: {} });
		await m2;
		await p;
		expect(idle).toBe(true);
		// An idle booking resolves immediately.
		let idle2 = false;
		await diaryStore.whenIdle('never-touched').then(() => (idle2 = true));
		expect(idle2).toBe(true);
	});
});

describe('oversize-drop party shrink — partySize is geometry-protected (Step 1)', () => {
	it('a geometry-dirty booking keeps its patched partySize across a reconcile', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 6 })]));
		let resolveWrite!: (v: any) => void;
		const pending = new Promise<any>((r) => (resolveWrite = r));
		const m = diaryStore.mutate(
			'b1',
			'geometry',
			(b) => {
				b._tableId = 't2';
				b.partySize = 2; // oversize drop onto a 2-top → shrink
			},
			() => pending,
			{ settle: (_bars, resp) => diaryStore.settleTables('b1', resp as any) }
		);
		// A reconcile lands mid-write still carrying the pre-shrink party.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 6 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(2); // NOT flashed back to 6
		expect(diaryStore.bar('b1')?._tableId).toBe('t2');
		resolveWrite({ ok: true, data: { version: 'v2', tableIds: ['t2'] } });
		await m;
		expect(diaryStore.bar('b1')?.partySize).toBe(2); // settle doesn't undo the shrink
	});

	it('a mutatePair shrink survives settleTables (swap onto a smaller table)', async () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60, { partySize: 6 }), bar('B', 't2', 120)]));
		const patch = (barsA: any[], barsB: any[]) => {
			for (const b of barsA) {
				b._tableId = 't2';
				b.partySize = 2; // A (party 6) lands on the 2-top
			}
			for (const b of barsB) b._tableId = 't1';
		};
		const okPair = async () => ({
			ok: true as const,
			data: { a: { version: 'vA2', tableIds: ['t2'] }, b: { version: 'vB2', tableIds: ['t1'] } }
		});
		const done = await diaryStore.mutatePair('A', 'B', patch, okPair, (data: any) => {
			diaryStore.settleTables('A', data.a);
			diaryStore.settleTables('B', data.b);
		});
		expect(done).toBe(true);
		expect(diaryStore.bar('A')?.partySize).toBe(2); // shrink stands after settle
		expect(diaryStore.bar('A')?._tableId).toBe('t2');
	});

	it('a failed shrink-swap restores the original partySize with the geometry', async () => {
		diaryStore.reconcile(timeline([bar('A', 't1', 60, { partySize: 6 }), bar('B', 't2', 120)]));
		const patch = (barsA: any[], barsB: any[]) => {
			for (const b of barsA) {
				b._tableId = 't2';
				b.partySize = 2;
			}
			for (const b of barsB) b._tableId = 't1';
		};
		const done = await diaryStore.mutatePair('A', 'B', patch, fail, () => {});
		expect(done).toBe(false);
		expect(diaryStore.bar('A')?.partySize).toBe(6); // party restored with the revert
		expect(diaryStore.bar('A')?._tableId).toBe('t1');
	});
});

describe('temp→promote→settle for a walk-in swap (the reported bug, store level)', () => {
	it('a swap staged on a temp id survives promote and settles onto the real id', async () => {
		diaryStore.reconcile(timeline([]));
		// Two optimistic walk-ins (temp ids) on t1 and t2.
		diaryStore.insert({ ...bar('temp-A', 't1', 60), _tableId: 't1' } as any, 'geometry');
		diaryStore.insert({ ...bar('temp-B', 't2', 60), _tableId: 't2' } as any, 'geometry');
		// Swap them optimistically while still temp; the write promotes then settles real ids.
		const swapPatch2 = (barsA: any[], barsB: any[]) => {
			for (const b of barsA) b._tableId = 't2';
			for (const b of barsB) b._tableId = 't1';
		};
		const write = async () => {
			// simulate the creates resolving + promotion happening inside the write closure
			diaryStore.promote('temp-A', 'realA', 'vA');
			diaryStore.promote('temp-B', 'realB', 'vB');
			return {
				ok: true as const,
				data: { a: { version: 'vA', tableIds: ['t2'] }, b: { version: 'vB', tableIds: ['t1'] } }
			};
		};
		const done = await diaryStore.mutatePair('temp-A', 'temp-B', swapPatch2, write, (data: any) => {
			diaryStore.settleTables('realA', data.a);
			diaryStore.settleTables('realB', data.b);
		});
		expect(done).toBe(true);
		expect(diaryStore.bar('temp-A')).toBeNull();
		expect(diaryStore.bar('realA')?._tableId).toBe('t2');
		expect(diaryStore.bar('realB')?._tableId).toBe('t1');
		expect(diaryStore.isDirty('realA')).toBe(false);
		expect(diaryStore.isDirty('realB')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// A MOVE THAT UN-MOVED ITSELF. Reported: a walk-in on table 13 dragged to table 12
// showed on 12, then ~10-20s later jumped back to 13 — on the host's screen only.
// The owner watched the same booking on another machine and it was correct
// throughout, and the database had the move. So the write worked; the acting
// client undid it on screen.
//
// The dirty gate is what stops a pull that predates the write repainting the old
// position, and mutate() refreshes its TTL once, when the write STARTS. It never
// asked whether the write had come back. The move write runs ~3s against the
// droplet, and this host's tab could not provision realtime at all (it was on the
// 20s fallback poll — a tell for a slow link), so the write outlived the 10s TTL:
// the sweep dropped the gate mid-flight and the next pull, still carrying table 13,
// won.
//
// #sweepExpired already refuses to expire a gate with a write in flight — but only
// value-intent gates (covers, comments) ever set `pending`. A geometry move never
// did, so the protection did not reach the very path that drags bars around.
describe('a geometry write in flight keeps its gate however slow the server is', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('a stale pull cannot un-move a booking whose move is still being written', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		let resolveWrite!: (v: { ok: boolean; data?: Record<string, unknown> }) => void;
		const writePending = new Promise<{ ok: boolean; data?: Record<string, unknown> }>(
			(r) => (resolveWrite = r)
		);
		const mutation = diaryStore.mutate(
			'b1',
			'geometry',
			(b) => (b._tableId = 't2'),
			() => writePending
		);
		expect(diaryStore.bar('b1')?._tableId).toBe('t2'); // optimistic move applied

		// The write is slow. Past the TTL, a pull that predates it lands, still on t1.
		await vi.advanceTimersByTimeAsync(11_000);
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		expect(diaryStore.bar('b1')?._tableId).toBe('t2'); // jumped back to t1 before the fix

		// The write finally lands; the server agrees with the host.
		resolveWrite({ ok: true });
		await mutation;
		diaryStore.reconcile(timeline([bar('b1', 't2', 60)]));
		expect(diaryStore.bar('b1')?._tableId).toBe('t2');
	});

	it('a genuinely failed move still reverts', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		const moved = await diaryStore.mutate('b1', 'geometry', (b) => (b._tableId = 't2'), fail);
		expect(moved).toBe(false);
		expect(diaryStore.bar('b1')?._tableId).toBe('t1'); // put back where it was
	});

	it('still releases a gate whose move write never returns at all', async () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		void diaryStore.mutate(
			'b1',
			'geometry',
			(b) => (b._tableId = 't2'),
			() => new Promise(() => {})
		);
		await vi.advanceTimersByTimeAsync(70_000); // past the in-flight ceiling
		diaryStore.reconcile(timeline([bar('b1', 't1', 60)]));
		expect(diaryStore.bar('b1')?._tableId).toBe('t1'); // the board takes server truth again
	});
});
