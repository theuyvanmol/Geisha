// Booking comments races on the diary board.
//
// Reported: booking comments were "faulty and disappearing and not saving correctly".
//
// The load-bearing cause was a missing PocketBase column (`note_to_restaurant` was never
// in the geisha_bookings schema, and PB silently DROPS keys it has no field for, so the
// FOH note 200'd and was never stored) — fixed by migration 1783900000. But the board had
// a second, independent defect that made even the column-backed half flicker:
//
//   saveComments marked the booking 'field'-dirty with NO value intent. #pullConfirmsIntent
//   then fell back to "clear once the booking is PRESENT" — and a booking is always present
//   — so the gate died on the very next pull whether or not the server had taken the write,
//   and that same pull repainted the bar with pre-write truth. The note appeared, then
//   vanished a beat later.
//
// The fix: state the intent as a DOTTED PATH into the bar's nested detail
// ({'detail.bookingComments': …}), so the gate only clears once a pull actually carries
// the saved text — the same rule covers already used for partySize.

import { describe, it, expect, beforeEach } from 'vitest';
import { diaryStore } from './diaryStore.svelte';
import type { DiaryTimeline, DiaryBar } from '$lib/server/booking/admin';

function bar(
	bookingId: string,
	tableId: string,
	o: { comments?: string; note?: string; hasNote?: boolean } = {}
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
		startMin: 60,
		endMin: 150,
		startsBefore: false,
		endsAfter: false,
		hasNote: o.hasNote ?? false,
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
			vip: false,
			// The loader maps an empty column to undefined (`b.special_requests || undefined`),
			// so absent notes must be undefined here, not ''.
			bookingComments: o.comments || undefined,
			noteToRestaurant: o.note || undefined
		}
	};
}

function timeline(bars: DiaryBar[]): DiaryTimeline {
	return {
		sections: [
			{
				name: 'Main',
				rows: [{ tableId: 't1', label: 'T1', seatsMax: 8, bars }]
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

/** Mirror of the page's saveComments call. */
const saveComments = (id: string, comments: string, note: string) =>
	diaryStore.applyOptimisticStatus(
		id,
		(b) => {
			b.detail = { ...b.detail, bookingComments: comments, noteToRestaurant: note };
			b.hasNote = !!(comments.trim() || note.trim());
		},
		undefined,
		['detail', 'hasNote'],
		{ 'detail.bookingComments': comments, 'detail.noteToRestaurant': note }
	);

const minOf = () => null; // a comments response carries no window

beforeEach(() => diaryStore.reset());

describe('comments — the optimistic note survives an in-flight pull', () => {
	it('a pull that PREDATES the write cannot wipe the comments', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1')]));

		const gen = saveComments('b1', 'Window table please', 'Regular — knows the chef');
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Window table please');
		expect(diaryStore.bar('b1')?.hasNote).toBe(true);

		// A poll issued BEFORE the write lands, still carrying no comments at all.
		diaryStore.reconcile(timeline([bar('b1', 't1')]));
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Window table please');
		expect(diaryStore.bar('b1')?.detail.noteToRestaurant).toBe('Regular — knows the chef');
		expect(diaryStore.bar('b1')?.hasNote).toBe(true);
		expect(diaryStore.isDirty('b1')).toBe(true); // gate survives an unconfirming pull

		// The write returns. The gate STAYS — a pull issued before it can still be in flight.
		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen, clearDirty: false });
		expect(diaryStore.isDirty('b1')).toBe(true);
		expect(diaryStore.bar('b1')?.version).toBe('v2');

		// A late pre-write pull lands anyway. Still gated.
		diaryStore.reconcile(timeline([bar('b1', 't1')]));
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Window table please');

		// The confirming pull (server really has both notes) clears the gate.
		diaryStore.reconcile(
			timeline([
				bar('b1', 't1', {
					comments: 'Window table please',
					note: 'Regular — knows the chef',
					hasNote: true
				})
			])
		);
		expect(diaryStore.isDirty('b1')).toBe(false);
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Window table please');
	});

	it('CLEARING the comments confirms against a server bar that reads them back undefined', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', { comments: 'Old note', hasNote: true })]));

		const gen = saveComments('b1', '', '');
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('');
		expect(diaryStore.bar('b1')?.hasNote).toBe(false);

		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen, clearDirty: false });

		// The server took the clear — and the loader maps the now-empty column to undefined.
		// Strict equality ('' !== undefined) would never confirm, wedging the gate until the
		// 10s TTL sweep; the nullish comparison settles it here.
		diaryStore.reconcile(timeline([bar('b1', 't1')]));
		expect(diaryStore.isDirty('b1')).toBe(false);
		// That pull still merged under the (about-to-clear) gate, so the local '' stands;
		// '' and undefined render identically. The next clean pull takes server truth.
		expect(diaryStore.bar('b1')?.detail.bookingComments || undefined).toBeUndefined();
		expect(diaryStore.bar('b1')?.hasNote).toBe(false);

		diaryStore.reconcile(timeline([bar('b1', 't1')]));
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBeUndefined();
	});

	it('a failed save reverts to the pre-edit comments', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1', { comments: 'Old note', hasNote: true })]));

		const gen = saveComments('b1', 'Typed but never saved', '');
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Typed but never saved');

		diaryStore.revertOptimistic('b1', gen);
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Old note');
		expect(diaryStore.bar('b1')?.hasNote).toBe(true);
		expect(diaryStore.isDirty('b1')).toBe(false);
	});

	it('a second save supersedes the first — the first response cannot repaint stale text', () => {
		diaryStore.reconcile(timeline([bar('b1', 't1')]));

		const gen1 = saveComments('b1', 'First', '');
		const gen2 = saveComments('b1', 'Second', '');
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Second');

		// The FIRST write's response lands late. It is superseded, so it must not settle or
		// unprotect the newer text.
		diaryStore.settleWindow('b1', { version: 'v2' }, minOf, { gen: gen1, clearDirty: false });
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Second');
		expect(diaryStore.isDirty('b1')).toBe(true);

		// A pull carrying only the FIRST save's text does not confirm the second.
		diaryStore.reconcile(timeline([bar('b1', 't1', { comments: 'First', hasNote: true })]));
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Second');

		diaryStore.settleWindow('b1', { version: 'v3' }, minOf, { gen: gen2, clearDirty: false });
		diaryStore.reconcile(timeline([bar('b1', 't1', { comments: 'Second', hasNote: true })]));
		expect(diaryStore.isDirty('b1')).toBe(false);
		expect(diaryStore.bar('b1')?.detail.bookingComments).toBe('Second');
	});
});
