// Range algebra for the Close-Outs CALENDAR (ResDiary "Close-Outs" year grid).
//
// The calendar lets a manager click DATES closed or open. The database, though, stores
// closures as inclusive [date_from, date_to] RANGES — so "reopen the 25th" is not a
// delete: it can shrink a range, or split one range into two, or delete it outright.
// Getting that wrong silently reopens a fortnight, so the whole decision is computed
// here as a PURE plan (no DB, no I/O) that the caller then executes, and it is unit
// tested against the awkward cases (interior split, both edges, whole-row).
//
// Two hard rules, both deliberate:
//   • Only NON-PERIODIC rows that EXACTLY match the edited target (whole day, or one
//     service) are ever rewritten. A recurring "every Sunday" close-out is shown on the
//     grid but never silently edited by a click — reopening one Sunday would otherwise
//     have to fork the rule, and the manager would not see that happen.
//   • Nothing is created for a date that is already closed for that target, so
//     drag-painting across a part-closed week can't stack duplicate rows.

import { isPeriodic, eachDate, toRanges, closureSpansDate } from '../../service/closureCalendar.js';

/** An existing closure row, as the planner needs it. */
export interface DateClosureRow {
	id: string;
	dateFrom: string;
	dateTo: string;
	scope: 'full' | 'period' | 'section';
	servicePeriodId?: string;
	daysOfWeek?: number[];
	name?: string;
}

/** What the manager painted: close these dates, open those, for this target. */
export interface DateEditRequest {
	/** 'full' closes the whole day; 'period' closes one service. */
	scope: 'full' | 'period';
	/** Required when scope === 'period'. */
	servicePeriodId?: string;
	close: string[];
	open: string[];
}

/** The executable plan. Every field is safe to apply in any order. */
export interface DateEditPlan {
	/** One new row per contiguous run of newly-closed dates. */
	create: { dateFrom: string; dateTo: string }[];
	/** Rows whose range shrinks — same id, new bounds. */
	shrink: { id: string; dateFrom: string; dateTo: string }[];
	/** Rows to delete outright (every date they covered was reopened). */
	remove: string[];
	/** Tail rows created when reopening a date split a range in two; `from` is the row
	 *  whose name/description/colour the new row should inherit. */
	split: { from: string; dateFrom: string; dateTo: string }[];
	/** Close-requests that were already closed for this target (no row created). */
	redundant: string[];
	/** Open-requests this plan could NOT honour, each with a reason for the manager. */
	blocked: { date: string; reason: string }[];
	/** Dates this plan actually shuts (the ones `create` covers) — for the result message. */
	closed: string[];
	/** Dates this plan actually reopens — for the result message. */
	opened: string[];
}

/** Does `row` close the edited target on the dates it spans? */
function coversTarget(row: DateClosureRow, req: DateEditRequest): boolean {
	// A whole-day closure closes everything, including any single service.
	if (row.scope === 'full') return true;
	if (req.scope === 'full') return false; // a service-only closure doesn't close the day
	return row.scope === 'period' && row.servicePeriodId === req.servicePeriodId;
}

/** Is `row` one the calendar owns — same target exactly, and not a recurring rule? */
function isEditable(row: DateClosureRow, req: DateEditRequest): boolean {
	if (isPeriodic(row)) return false;
	if (req.scope === 'full') return row.scope === 'full';
	return row.scope === 'period' && row.servicePeriodId === req.servicePeriodId;
}

const label = (row: DateClosureRow) => (row.name || '').trim() || 'unnamed';

/**
 * Work out the minimum set of writes that makes the painted dates true, leaving every
 * other date — and every recurring rule — exactly as it was.
 */
export function planDateEdits(rows: DateClosureRow[], req: DateEditRequest): DateEditPlan {
	const plan: DateEditPlan = {
		create: [],
		shrink: [],
		remove: [],
		split: [],
		redundant: [],
		blocked: [],
		closed: [],
		opened: []
	};
	const openSet = new Set(req.open);
	// A date can't be both closed and opened; an explicit close wins (the UI never sends
	// both, but a hand-rolled API call could).
	const closeList = [...new Set(req.close)].filter((d) => !openSet.has(d)).sort();

	const editable = rows.filter((r) => isEditable(r, req));
	const others = rows.filter((r) => !isEditable(r, req) && coversTarget(r, req));

	// --- opens: shrink / split / delete the rows we own -----------------------
	// `stillClosed` accumulates what remains shut for this target after the opens, so the
	// close pass below can't create a row for a date that is already covered.
	const stillClosed = new Set<string>();
	const reopened = new Set<string>();

	for (const row of editable) {
		const dates = eachDate(row.dateFrom, row.dateTo);
		const kept = dates.filter((d) => !openSet.has(d));
		for (const d of dates) if (openSet.has(d)) reopened.add(d);
		for (const d of kept) stillClosed.add(d);
		if (kept.length === dates.length) continue; // untouched
		if (kept.length === 0) {
			plan.remove.push(row.id);
			continue;
		}
		const runs = toRanges(kept);
		plan.shrink.push({ id: row.id, dateFrom: runs[0].from, dateTo: runs[0].to });
		for (const r of runs.slice(1)) {
			plan.split.push({ from: row.id, dateFrom: r.from, dateTo: r.to });
		}
	}

	// Anything the calendar does not own still shuts these dates — say so rather than
	// reporting a silent success the grid would then contradict on reload.
	for (const date of req.open) {
		if (reopened.has(date)) continue;
		const blocker = others.find((r) => spansRow(r, date)) ?? periodicOwner(rows, req, date);
		if (!blocker) continue; // it simply wasn't closed — nothing to report
		plan.blocked.push({ date, reason: blockReason(blocker, req) });
	}

	// --- closes: create one row per run of genuinely-open dates ---------------
	// `others` already holds every non-owned row that shuts this target — periodic rules
	// included (a periodic row is never editable), so one pass covers both.
	for (const r of others) {
		for (const d of closeList) if (spansRow(r, d)) stillClosed.add(d);
	}
	const fresh: string[] = [];
	for (const d of closeList) {
		if (stillClosed.has(d)) plan.redundant.push(d);
		else fresh.push(d);
	}
	for (const r of toRanges(fresh)) plan.create.push({ dateFrom: r.from, dateTo: r.to });
	plan.closed = fresh;
	plan.opened = [...reopened].sort();

	return plan;
}

/** Does a row bite on a date? The same predicate the availability engine uses. */
const spansRow = (row: DateClosureRow, date: string): boolean => closureSpansDate(row, date);

/** The recurring rule (if any) keeping `date` shut for this target. */
function periodicOwner(
	rows: DateClosureRow[],
	req: DateEditRequest,
	date: string
): DateClosureRow | undefined {
	return rows.find((r) => isPeriodic(r) && coversTarget(r, req) && spansRow(r, date));
}

function blockReason(row: DateClosureRow, req: DateEditRequest): string {
	if (isPeriodic(row)) {
		return `kept closed by the recurring close-out “${label(row)}” — edit that period in the list below`;
	}
	if (row.scope === 'full' && req.scope === 'period') {
		return `the whole day is closed by “${label(row)}” — reopen the day itself first`;
	}
	return `kept closed by “${label(row)}”`;
}
