// Diary board projection (Floor ↔ Diary state overhaul).
//
// The diary's single client-owned store (diaryStore.svelte.ts) keeps the board as a
// FLAT map of already-positioned bars (`Map<bookingId, DiaryBar>`) plus the server's
// structural *scaffold* (the sections→rows skeleton + axis). The grid, however, renders
// a nested `sections → rows → bars` timeline. This module is the PURE, framework-free
// projection between the two:
//
//   splitScaffold(serverTimeline)  →  { scaffold (rows with NO bars), bars: Map<id, DiaryBar> }
//   projectRows(scaffold, bars)    →  DiarySection[]  (bars bucketed back onto their rows)
//
// Why keep the server as the positioner: `startMin/endMin` come from a service-period
// axis, `arrival` from a floor_state join, `firstVisit`/`isNew`/join-groups from
// whole-day + config data — all derived in getDiaryTimeline (admin.ts) against data the
// browser never receives raw. So the store holds the bars the server already positioned
// and only re-buckets them onto rows; an optimistic move just changes a bar's tableId(s)
// and it re-projects onto a different existing row. This mirrors patchBarMove /
// moveBarsToTable / placeBarAt in the old page, now expressed as one pure function.
//
// PURE (no $state, no DOM) so it's unit-testable exactly like colourScheme.ts /
// magicSearch.ts.

import type { DiaryTimeline, DiarySection, DiaryRow, DiaryBar } from '$lib/server/booking/admin';

/** A bar carries the id(s) of the table row(s) it belongs on. The server places a
 *  booking as one bar per table it occupies (admin.ts:2230-2233), so a multi-table
 *  booking yields several bars that SHARE a bookingId but sit on different rows. To
 *  round-trip that through a `Map<bookingId, DiaryBar>` we must remember which row each
 *  bar came from. We stamp `_tableId` onto the bar at split time (a private field the
 *  render ignores); optimistic moves update it. */
export type PositionedBar = DiaryBar & { _tableId: string };

/** The row skeleton with its bars stripped out — the immutable structural scaffold the
 *  store replaces wholesale on every reconcile (axis/rows/joins never conflict with a
 *  local edit). */
export type ScaffoldRow = Omit<DiaryRow, 'bars'>;
export type ScaffoldSection = { name: string; rows: ScaffoldRow[] };

/** Everything in a DiaryTimeline EXCEPT the bars — axis, ticks, periods, floors, the
 *  row skeleton. Stored as-is and swapped in on each reconcile. */
export type Scaffold = Omit<DiaryTimeline, 'sections'> & { sections: ScaffoldSection[] };

/** The synthetic row a bar lands on when its table isn't on the current floor scaffold
 *  (moved to a table created on another device, or genuinely tableless). Mirrors the
 *  server's "__unassigned__" placement (admin.ts:2266-2272). */
export const UNASSIGNED_TABLE_ID = '__unassigned__';

/**
 * Split a server timeline into the structural scaffold (rows with no bars) and a flat
 * map of positioned bars keyed by bookingId. A booking occupying N tables produces N
 * PositionedBars that share `bookingId` but differ in `_tableId`; we therefore key the
 * map by a composite `bookingId@tableId` internally and expose helpers to regroup.
 *
 * Returns bars as an ARRAY (order-preserving); the store builds its reactive Map from it.
 */
export function splitScaffold(t: DiaryTimeline): { scaffold: Scaffold; bars: PositionedBar[] } {
	const bars: PositionedBar[] = [];
	const sections: ScaffoldSection[] = t.sections.map((sec) => ({
		name: sec.name,
		rows: sec.rows.map((row) => {
			const { bars: rowBars, ...rest } = row;
			for (const b of rowBars) bars.push({ ...b, _tableId: row.tableId });
			return rest;
		})
	}));
	const { sections: _drop, ...axis } = t;
	void _drop;
	return { scaffold: { ...axis, sections }, bars };
}

/** Stable composite key for a positioned bar (a booking can have several across rows). */
export const barKey = (bookingId: string, tableId: string): string => `${bookingId}@${tableId}`;

/**
 * Re-bucket a flat set of positioned bars back onto the scaffold's rows, producing the
 * nested `DiarySection[]` the grid renders. Bars whose `_tableId` isn't on the scaffold
 * fall into a synthetic "Unassigned" section (never silently dropped — matches the
 * server). Within a row, bars sort by startMin (matches admin.ts:2262). De-dupes by
 * bookingId per row so a keyed {#each row.bars (b.bookingId)} can never crash.
 */
export function projectRows(scaffold: Scaffold, bars: Iterable<PositionedBar>): DiarySection[] {
	// Index scaffold rows by tableId for O(1) placement.
	const rowByTable = new Map<string, { section: ScaffoldSection; row: ScaffoldRow }>();
	for (const section of scaffold.sections)
		for (const row of section.rows) rowByTable.set(row.tableId, { section, row });

	// Collect bars per tableId (preserving a de-dupe by bookingId within each row).
	const barsByTable = new Map<string, PositionedBar[]>();
	const seenPerTable = new Map<string, Set<string>>();
	const orphans: PositionedBar[] = [];
	for (const b of bars) {
		const tid = b._tableId;
		const target = rowByTable.has(tid) ? tid : UNASSIGNED_TABLE_ID;
		if (target === UNASSIGNED_TABLE_ID && !rowByTable.has(UNASSIGNED_TABLE_ID)) {
			orphans.push(b);
			continue;
		}
		let seen = seenPerTable.get(target);
		if (!seen) seenPerTable.set(target, (seen = new Set()));
		if (seen.has(b.bookingId)) continue; // dedupe by bookingId within the row
		seen.add(b.bookingId);
		(barsByTable.get(target) ?? barsByTable.set(target, []).get(target)!).push(b);
	}

	const sortBars = (arr: PositionedBar[]) => arr.sort((a, b) => a.startMin - b.startMin);

	const sections: DiarySection[] = scaffold.sections.map((sec) => ({
		name: sec.name,
		rows: sec.rows.map((row) => ({
			...row,
			bars: sortBars(barsByTable.get(row.tableId) ?? [])
		}))
	}));

	// Any orphan bars (table not on this floor) → a synthetic Unassigned section/row, so
	// they're always visible and editable (mirrors admin.ts:2266-2272).
	if (orphans.length) {
		const unassignedRow: DiaryRow = {
			tableId: UNASSIGNED_TABLE_ID,
			label: 'Unassigned',
			seatsMax: 0,
			joinGroup: null,
			joinedWith: [],
			bars: sortBars(dedupeByBooking(orphans))
		};
		// Merge into an existing '' / Unassigned section if the scaffold already has one.
		const existing = sections.find((s) => s.name === '' || s.name === 'Unassigned');
		if (existing) existing.rows.push(unassignedRow);
		else sections.push({ name: 'Unassigned', rows: [unassignedRow] });
	}

	return sections;
}

/**
 * The board the grid DRAWS: every section and row, minus the no-shows.
 *
 * A no-show leaves the diary the moment it's marked, exactly as a cancellation does
 * (ResDiary: "No show" is a cancellation reason, and a cancelled booking lives on the
 * Cancellation list, not the grid). It stays in the store — the covers header still
 * tallies it under "Excluded", and the Cancellations list is where it's restored from.
 * The owner's complaint was the grey no-show bar sitting on a table the host had
 * already given away, so staff were cancelling real no-shows just to clear them.
 *
 * The synthetic Unassigned row only exists to hold tableless bars; if the only ones it
 * held were no-shows it goes too, rather than drawing an empty row.
 */
export function withoutNoShows(sections: DiarySection[]): DiarySection[] {
	const out: DiarySection[] = [];
	for (const sec of sections) {
		const rows: DiaryRow[] = [];
		for (const row of sec.rows) {
			const bars = row.bars.filter((b) => b.status !== 'no_show');
			if (row.tableId === UNASSIGNED_TABLE_ID && bars.length === 0) continue;
			rows.push(bars.length === row.bars.length ? row : { ...row, bars });
		}
		if (rows.length === 0 && sec.rows.length > 0) continue;
		out.push(
			rows.length === sec.rows.length && rows.every((r, i) => r === sec.rows[i])
				? sec
				: { ...sec, rows }
		);
	}
	return out;
}

/** De-dupe positioned bars by bookingId, keeping the first occurrence. */
function dedupeByBooking(arr: PositionedBar[]): PositionedBar[] {
	const seen = new Set<string>();
	const out: PositionedBar[] = [];
	for (const b of arr) {
		if (seen.has(b.bookingId)) continue;
		seen.add(b.bookingId);
		out.push(b);
	}
	return out;
}
