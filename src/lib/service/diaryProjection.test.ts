import { describe, it, expect } from 'vitest';
import {
	splitScaffold,
	projectRows,
	withoutNoShows,
	UNASSIGNED_TABLE_ID,
	type PositionedBar
} from './diaryProjection';
import type { DiaryTimeline, DiaryBar } from '$lib/server/booking/admin';

// A minimal DiaryBar factory — only the fields the projection touches matter; the rest
// are filled with inert defaults so the type is satisfied.
function bar(bookingId: string, startMin: number, overrides: Partial<DiaryBar> = {}): DiaryBar {
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
			tableIds: [],
			confirmAttempts: 0,
			firstVisit: false,
			vip: false
		},
		...overrides
	};
}

// A tiny timeline: two sections, three tables, a couple of bars.
function makeTimeline(): DiaryTimeline {
	return {
		sections: [
			{
				name: 'Window',
				rows: [
					{ tableId: 't1', label: 'T1', seatsMax: 4, bars: [bar('bA', 60), bar('bB', 300)] },
					{ tableId: 't2', label: 'T2', seatsMax: 2, bars: [] }
				]
			},
			{
				name: 'Bar',
				rows: [{ tableId: 't3', label: 'T3', seatsMax: 6, bars: [bar('bC', 120)] }]
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
		covers: 6,
		bookingCount: 3,
		ui: {} as DiaryTimeline['ui']
	};
}

describe('splitScaffold', () => {
	it('strips bars off rows and stamps each bar with its _tableId', () => {
		const { scaffold, bars } = splitScaffold(makeTimeline());
		// scaffold rows carry no bars
		for (const sec of scaffold.sections) for (const row of sec.rows) expect('bars' in row).toBe(false);
		// axis survives
		expect(scaffold.totalMin).toBe(720);
		expect(scaffold.stepMin).toBe(15);
		// every bar is present and tagged with its origin row
		expect(bars).toHaveLength(3);
		expect(bars.find((b) => b.bookingId === 'bA')?._tableId).toBe('t1');
		expect(bars.find((b) => b.bookingId === 'bC')?._tableId).toBe('t3');
	});
});

describe('projectRows', () => {
	it('round-trips a timeline back to the same section/row/bar shape', () => {
		const { scaffold, bars } = splitScaffold(makeTimeline());
		const sections = projectRows(scaffold, bars);
		expect(sections.map((s) => s.name)).toEqual(['Window', 'Bar']);
		const t1 = sections[0].rows.find((r) => r.tableId === 't1')!;
		expect(t1.bars.map((b) => b.bookingId)).toEqual(['bA', 'bB']); // sorted by startMin
		const t3 = sections[1].rows.find((r) => r.tableId === 't3')!;
		expect(t3.bars.map((b) => b.bookingId)).toEqual(['bC']);
	});

	it('sorts bars within a row by startMin regardless of input order', () => {
		const { scaffold } = splitScaffold(makeTimeline());
		const late = { ...bar('late', 500), _tableId: 't1' } as PositionedBar;
		const early = { ...bar('early', 30), _tableId: 't1' } as PositionedBar;
		const sections = projectRows(scaffold, [late, early]);
		const t1 = sections[0].rows.find((r) => r.tableId === 't1')!;
		expect(t1.bars.map((b) => b.bookingId)).toEqual(['early', 'late']);
	});

	it('re-projects an optimistically-moved bar onto its new row', () => {
		const { scaffold, bars } = splitScaffold(makeTimeline());
		// move bA from t1 to t2
		const moved = bars.map((b) => (b.bookingId === 'bA' ? { ...b, _tableId: 't2' } : b));
		const sections = projectRows(scaffold, moved);
		const t1 = sections[0].rows.find((r) => r.tableId === 't1')!;
		const t2 = sections[0].rows.find((r) => r.tableId === 't2')!;
		expect(t1.bars.map((b) => b.bookingId)).toEqual(['bB']);
		expect(t2.bars.map((b) => b.bookingId)).toEqual(['bA']);
	});

	it('sends a bar on an unknown table to a synthetic Unassigned section', () => {
		const { scaffold, bars } = splitScaffold(makeTimeline());
		const orphaned = bars.map((b) => (b.bookingId === 'bC' ? { ...b, _tableId: 'gone' } : b));
		const sections = projectRows(scaffold, orphaned);
		const unassigned = sections.find((s) => s.name === 'Unassigned')!;
		expect(unassigned).toBeTruthy();
		expect(unassigned.rows[0].tableId).toBe(UNASSIGNED_TABLE_ID);
		expect(unassigned.rows[0].bars.map((b) => b.bookingId)).toEqual(['bC']);
	});

	it('de-dupes two bars with the same bookingId on one row (each-key safety)', () => {
		const { scaffold } = splitScaffold(makeTimeline());
		const dup1 = { ...bar('dup', 60), _tableId: 't1' } as PositionedBar;
		const dup2 = { ...bar('dup', 90), _tableId: 't1' } as PositionedBar;
		const sections = projectRows(scaffold, [dup1, dup2]);
		const t1 = sections[0].rows.find((r) => r.tableId === 't1')!;
		expect(t1.bars.filter((b) => b.bookingId === 'dup')).toHaveLength(1);
	});
});

describe('withoutNoShows', () => {
	it('takes a no-show off the grid and leaves every other bar and row alone', () => {
		const { scaffold, bars } = splitScaffold(makeTimeline());
		const marked = bars.map((b) =>
			b.bookingId === 'bB' ? { ...b, status: 'no_show' as const } : b
		);
		const sections = withoutNoShows(projectRows(scaffold, marked));
		const t1 = sections[0].rows.find((r) => r.tableId === 't1')!;
		expect(t1.bars.map((b) => b.bookingId)).toEqual(['bA']);
		// the table row itself stays — only the booking leaves
		expect(sections[0].rows.map((r) => r.tableId)).toEqual(['t1', 't2']);
		expect(sections[1].rows[0].bars.map((b) => b.bookingId)).toEqual(['bC']);
	});

	it('keeps a table row that only held a no-show, now empty', () => {
		const { scaffold, bars } = splitScaffold(makeTimeline());
		const marked = bars.map((b) =>
			b.bookingId === 'bC' ? { ...b, status: 'no_show' as const } : b
		);
		const sections = withoutNoShows(projectRows(scaffold, marked));
		const barSec = sections.find((s) => s.name === 'Bar')!;
		expect(barSec.rows.map((r) => r.tableId)).toEqual(['t3']);
		expect(barSec.rows[0].bars).toEqual([]);
	});

	it('drops the synthetic Unassigned row when its only bar was a no-show', () => {
		const { scaffold, bars } = splitScaffold(makeTimeline());
		const orphanNoShow = bars.map((b) =>
			b.bookingId === 'bC' ? { ...b, _tableId: 'gone', status: 'no_show' as const } : b
		);
		const sections = withoutNoShows(projectRows(scaffold, orphanNoShow));
		expect(sections.find((s) => s.name === 'Unassigned')).toBeUndefined();
	});

	it('returns the same section objects when there is nothing to hide', () => {
		const { scaffold, bars } = splitScaffold(makeTimeline());
		const projected = projectRows(scaffold, bars);
		const sections = withoutNoShows(projected);
		expect(sections[0]).toBe(projected[0]);
		expect(sections[1]).toBe(projected[1]);
	});
});
