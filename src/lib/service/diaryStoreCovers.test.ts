// Covers (party size) races on the diary board.
//
// Reported: "if I quickly change the party size it really freaks out — it sets the UI
// back to the original amount and counts it back up to what I changed it to. It does
// even weirder things if I go up and down quickly."
//
// Three separate defects fed that:
//
//   1. #pullConfirmsIntent cleared a 'field' dirty as soon as the booking was PRESENT on
//      the server — and a booking is always present. So the partySize gate died on the
//      very next pull whether or not the server had taken the write, and that same pull
//      then repainted the bar with pre-write truth. This alone made a SINGLE click flicker:
//      click 6 -> pull carrying 2 clears the gate and paints 2 -> write lands -> next pull
//      paints 6. Hence "snaps back, then counts up".
//
//   2. settleWindow deleted the dirty unconditionally and had no generation check, so an
//      older click's response could unprotect (and settle over) a newer click's value.
//
//   3. #markDirty only coalesced GEOMETRY bursts. A rapid covers burst is a 'field' burst,
//      so each click REPLACED the dirty entry — resetting `snapshot` to an optimistic
//      intermediate (a revert would restore 3, never the true original 2) and clearing
//      `succeededAny` (a late failure would restore a snapshot the DB had moved past).
//
// The fixes: an `intendedFields` value-intent the server must actually confirm, generation
// guards on settleWindow/revertOptimistic, and same-kind burst coalescing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { diaryStore } from './diaryStore.svelte';
import type { DiaryTimeline, DiaryBar } from '$lib/server/booking/admin';

function bar(bookingId: string, tableId: string, startMin: number, o: Partial<DiaryBar> = {}): DiaryBar {
	const party = o.partySize ?? 2;
	return {
		bookingId,
		version: 'v1',
		movable: true,
		resizable: true,
		guestName: 'Guest',
		partySize: party,
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
			partySize: party,
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
					{ tableId: 't1', label: 'T1', seatsMax: 8, bars: byTable.get('t1') ?? [] },
					{ tableId: 't2', label: 'T2', seatsMax: 8, bars: byTable.get('t2') ?? [] }
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
		covers: 0,
		bookingCount: bars.length,
		ui: {} as DiaryTimeline['ui']
	};
}

/** Mirror of the page's covers call: optimistic patch + value-intent + protected field. */
const bumpCovers = (id: string, to: number) =>
	diaryStore.applyOptimisticStatus(
		id,
		(b) => {
			b.partySize = to;
			b.detail = { ...b.detail, partySize: to };
		},
		undefined,
		['partySize'],
		{ partySize: to }
	);

const minOf = () => null; // covers responses in these tests carry no window

beforeEach(() => diaryStore.reset());

describe('covers — the optimistic party size survives an in-flight pull', () => {
	it('a pull that PREDATES the write cannot repaint the old party size', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));

		const gen = bumpCovers('b1', 6); // host clicks 2 -> 6; write in flight
		expect(diaryStore.bar('b1')?.partySize).toBe(6);

		// A poll issued BEFORE the write lands, still carrying party=2.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(6); // was 2 — the "snaps back" bug
		expect(diaryStore.bar('b1')?.detail.partySize).toBe(6);
		expect(diaryStore.isDirty('b1')).toBe(true); // gate must survive an unconfirming pull

		// The write returns. The gate STAYS: a pull issued before this can still be in
		// flight carrying the old party, and dropping the gate now would let it win.
		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen, clearDirty: false });
		expect(diaryStore.isDirty('b1')).toBe(true);

		// A late pre-write pull lands anyway. Still gated.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(6);

		// The confirming pull (burst drained AND server really has 6) clears the gate.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 6 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(6);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});
});

describe('covers — rapid clicks', () => {
	it('an OLDER click settling does not drag a newer click backwards', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));

		const gen3 = bumpCovers('b1', 3);
		const gen4 = bumpCovers('b1', 4); // clicked again before the first write returned
		expect(diaryStore.bar('b1')?.partySize).toBe(4);

		// The FIRST write's response lands. It is stale: settle nothing, clear nothing.
		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen: gen3, clearDirty: false });
		expect(diaryStore.bar('b1')?.partySize).toBe(4);
		expect(diaryStore.isDirty('b1')).toBe(true);
		expect(diaryStore.bar('b1')?.version).toBe('v2'); // version token still refreshed

		// The current write lands; gate holds until a pull confirms 4.
		diaryStore.settleWindow('b1', { version: 'v3' }, minOf, { gen: gen4, clearDirty: false });
		expect(diaryStore.isDirty('b1')).toBe(true);

		// A pull carrying the intermediate 3 must not stick.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 3 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(4);

		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 4 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(4);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('up-then-down quickly lands on the LAST click, never an intermediate', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 4 })]));

		const up = bumpCovers('b1', 5);
		const down = bumpCovers('b1', 3);
		expect(diaryStore.bar('b1')?.partySize).toBe(3);

		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen: up, clearDirty: false });
		expect(diaryStore.bar('b1')?.partySize).toBe(3);
		diaryStore.settleWindow('b1', { version: 'v3' }, minOf, { gen: down, clearDirty: false });
		expect(diaryStore.bar('b1')?.partySize).toBe(3);

		// The up-write committed first, so a pull can carry 5. It must not stick.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 5 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(3);

		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 3 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(3);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});
});

describe('covers — a draining burst holds the gate', () => {
	// Observed in the browser after the intent gate alone was added: jabbing +,+,-,+,-,-,+
	// landed on the right number but the control visibly bounced 7 → 8 → 7 → 6 → 7 first.
	//
	// The writes commit SERIALLY, so the server passes THROUGH the intended value on an
	// early write while later ones are still queued. A pull landing in that window matched
	// `intendedFields`, "confirmed" the intent, and dropped the gate — after which the board
	// chased the server through every intermediate the queue was still writing.
	it('a pull matching the intent mid-burst does NOT clear the gate', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 6 })]));

		// Host jabs: 7, 8, then back to 7. Three writes queued, none returned yet.
		bumpCovers('b1', 7);
		bumpCovers('b1', 8);
		const last = bumpCovers('b1', 7);
		expect(diaryStore.bar('b1')?.partySize).toBe(7);

		// The FIRST write commits (server = 7) — which happens to equal the final intent.
		// A pull lands. It must NOT clear the gate: two writes are still in flight.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 7 })]));
		expect(diaryStore.isDirty('b1')).toBe(true);

		// The second write commits (server = 8). Without the gate the board would jump to 8.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 8 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(7); // the flicker

		// Drain the three writes.
		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen: last - 2, clearDirty: false });
		diaryStore.settleWindow('b1', { version: 'v3' }, minOf, { gen: last - 1, clearDirty: false });
		expect(diaryStore.isDirty('b1')).toBe(true); // still one in flight
		diaryStore.settleWindow('b1', { version: 'v4' }, minOf, { gen: last, clearDirty: false });

		// Burst drained AND the server now agrees → the gate may finally clear.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 7 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(7);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('a failed write still drains the burst (the gate cannot wedge open)', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));

		const g1 = bumpCovers('b1', 3);
		const g2 = bumpCovers('b1', 4);

		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen: g1, clearDirty: false });
		diaryStore.revertOptimistic('b1', g2); // second write FAILED — must still drain

		// Gate is gone (revert cleared it); a later pull must not find a stuck dirty.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 3 })]));
		expect(diaryStore.isDirty('b1')).toBe(false);
		expect(diaryStore.bar('b1')?.partySize).toBe(3); // server truth flows again
	});
});

describe('covers — failures', () => {
	it('a failed burst reverts to the PRE-BURST party, not an optimistic intermediate', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));

		bumpCovers('b1', 3);
		const gen4 = bumpCovers('b1', 4);
		expect(diaryStore.bar('b1')?.partySize).toBe(4);

		// Nothing committed. We must land back on 2 — the truth we started from, not 3.
		diaryStore.revertOptimistic('b1', gen4);
		expect(diaryStore.bar('b1')?.partySize).toBe(2);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('a SUPERSEDED failure leaves the newer click alone', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));

		const gen3 = bumpCovers('b1', 3);
		bumpCovers('b1', 7); // newer click owns the board now

		diaryStore.revertOptimistic('b1', gen3); // the older write failed — not its call
		expect(diaryStore.bar('b1')?.partySize).toBe(7);
		expect(diaryStore.isDirty('b1')).toBe(true);
	});

	it('after a mid-burst success, a later failure does not restore stale truth', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));

		const gen3 = bumpCovers('b1', 3);
		const gen4 = bumpCovers('b1', 4);

		// The 3-write SUCCEEDED (the DB is at 3), then the 4-write failed.
		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen: gen3, clearDirty: false });
		diaryStore.revertOptimistic('b1', gen4);

		// Restoring the pre-burst snapshot (2) would be a lie — the DB is at 3. Leave it for
		// the drained reconcile to repaint truth.
		expect(diaryStore.bar('b1')?.partySize).not.toBe(2);
	});
});

// ---------------------------------------------------------------------------
// THE LATE REVERT. Owner: "I keep changing a booking (FAZ) and it was 2 and then I set
// to 4 and then when I came back to it later it was 2 again."
//
// The gate above is what stops a pre-write pull repainting the old party — but it is
// swept on a TTL, and the sweep ran on `expires` alone, without asking whether the write
// it was protecting had actually come back yet. Measured on production, the `covers`
// action answers in ~3.2s (≈10 sequential PocketBase round trips to the droplet) and the
// board reconciles every ~1.5s, so with a couple of clicks queued behind each other the
// 10s TTL lapses while the write is still out. The gate goes, the next pull lands
// carrying pre-write truth, and the number the host set an hour ago quietly reverts.
//
// The TTL is a leak-stopper for a gate nobody will ever settle. It was never meant to be
// a deadline for the server.
describe('covers — a slow write must not lose its gate', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('the gate survives past the TTL while the write is still in flight', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		const gen = bumpCovers('b1', 4); // host sets 4; the write is slow
		expect(diaryStore.bar('b1')?.partySize).toBe(4);

		vi.advanceTimersByTime(11_000); // longer than DIRTY_TTL_MS, write still out

		// A pull issued before the write lands, still carrying party=2.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(4); // reverted to 2 before the fix
		expect(diaryStore.isDirty('b1')).toBe(true);

		// The write finally returns, and the confirming pull settles it.
		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen, clearDirty: false });
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 4 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(4);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('the confirmation window is measured from the response, not the click', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		const gen = bumpCovers('b1', 4);

		vi.advanceTimersByTime(9_000); // a slow write, just inside the original TTL
		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen, clearDirty: false });

		// settleWindow deliberately keeps the gate until a pull CONFIRMS 4. That pull is a
		// whole reconcile away (~1.5s, and the day read alone measures ~1.9s), which the
		// original TTL — started at the click — no longer covers.
		vi.advanceTimersByTime(4_000);
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(4);
	});

	it('still expires a gate nobody will ever settle', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		const gen = bumpCovers('b1', 4);
		// The write comes back (drains `pending`) but no pull ever confirms it — a lost
		// write, a tab left open. The gate must not wedge the board open forever.
		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen, clearDirty: false });

		vi.advanceTimersByTime(11_000);
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		expect(diaryStore.isDirty('b1')).toBe(false);
		expect(diaryStore.bar('b1')?.partySize).toBe(2);
	});
});

describe('covers — the in-flight grace has a ceiling', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('releases a gate whose write never returns at all', () => {
		// Every write path drains the count on both outcomes, so this should not happen —
		// but a fetch that neither resolves nor rejects (a suspended tab, a killed service
		// worker) must not wedge this booking out of server truth for the life of the tab.
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		bumpCovers('b1', 4); // write issued, never settled, never reverted

		vi.advanceTimersByTime(30_000); // still inside the grace — the gate holds
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		expect(diaryStore.bar('b1')?.partySize).toBe(4);

		vi.advanceTimersByTime(45_000); // past the ceiling — the board takes server truth
		diaryStore.reconcile(timeline([bar('b1', 't1', 60, { partySize: 2 })]));
		expect(diaryStore.isDirty('b1')).toBe(false);
		expect(diaryStore.bar('b1')?.partySize).toBe(2);
	});
});
