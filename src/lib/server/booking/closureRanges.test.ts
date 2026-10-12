import { describe, it, expect } from 'vitest';
import { planDateEdits, type DateClosureRow, type DateEditRequest } from './closureRanges.js';

const row = (over: Partial<DateClosureRow> & { id: string }): DateClosureRow => ({
	dateFrom: '2026-12-24',
	dateTo: '2026-12-24',
	scope: 'full',
	...over
});

const req = (over: Partial<DateEditRequest>): DateEditRequest => ({
	scope: 'full',
	close: [],
	open: [],
	...over
});

describe('planDateEdits — closing dates', () => {
	it('merges a run of newly-closed dates into ONE range row', () => {
		const plan = planDateEdits([], req({ close: ['2027-01-04', '2027-01-05', '2027-01-06'] }));
		expect(plan.create).toEqual([{ dateFrom: '2027-01-04', dateTo: '2027-01-06' }]);
	});

	it('splits non-contiguous dates into separate rows', () => {
		const plan = planDateEdits([], req({ close: ['2027-01-04', '2027-01-06'] }));
		expect(plan.create).toEqual([
			{ dateFrom: '2027-01-04', dateTo: '2027-01-04' },
			{ dateFrom: '2027-01-06', dateTo: '2027-01-06' }
		]);
	});

	it('bridges a month boundary as one contiguous run', () => {
		const plan = planDateEdits([], req({ close: ['2027-01-31', '2027-02-01'] }));
		expect(plan.create).toEqual([{ dateFrom: '2027-01-31', dateTo: '2027-02-01' }]);
	});

	it('creates nothing for a date an existing row already closes', () => {
		const rows = [row({ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-26' })];
		const plan = planDateEdits(rows, req({ close: ['2026-12-25'] }));
		expect(plan.create).toEqual([]);
		expect(plan.redundant).toEqual(['2026-12-25']);
	});

	it('creates nothing for a date a PERIODIC rule already closes', () => {
		// Every Sunday from Jul onwards. 2027-01-03 is a Sunday.
		const rows = [
			row({
				id: 's',
				dateFrom: '2026-07-01',
				dateTo: '2027-06-30',
				daysOfWeek: [0],
				name: 'Sunday'
			})
		];
		const plan = planDateEdits(rows, req({ close: ['2027-01-03'] }));
		expect(plan.create).toEqual([]);
		expect(plan.redundant).toEqual(['2027-01-03']);
	});

	it('still closes a weekday the periodic rule skips, and only that weekday', () => {
		const rows = [
			row({
				id: 's',
				dateFrom: '2026-07-01',
				dateTo: '2027-06-30',
				daysOfWeek: [0],
				name: 'Sunday'
			})
		];
		// Sun 3rd (covered) + Mon 4th (not) → one row for the 4th alone.
		const plan = planDateEdits(rows, req({ close: ['2027-01-03', '2027-01-04'] }));
		expect(plan.create).toEqual([{ dateFrom: '2027-01-04', dateTo: '2027-01-04' }]);
	});

	it('a whole-day closure makes closing a single SERVICE redundant', () => {
		const rows = [row({ id: 'f', dateFrom: '2026-12-25', dateTo: '2026-12-25' })];
		const plan = planDateEdits(
			rows,
			req({ scope: 'period', servicePeriodId: 'lunch', close: ['2026-12-25'] })
		);
		expect(plan.create).toEqual([]);
		expect(plan.redundant).toEqual(['2026-12-25']);
	});

	it('a closed SERVICE does not make closing the whole day redundant', () => {
		const rows = [
			row({
				id: 'p',
				scope: 'period',
				servicePeriodId: 'lunch',
				dateFrom: '2026-12-25',
				dateTo: '2026-12-25'
			})
		];
		const plan = planDateEdits(rows, req({ close: ['2026-12-25'] }));
		expect(plan.create).toEqual([{ dateFrom: '2026-12-25', dateTo: '2026-12-25' }]);
	});

	it('keeps different services independent', () => {
		const rows = [
			row({
				id: 'p',
				scope: 'period',
				servicePeriodId: 'lunch',
				dateFrom: '2026-12-25',
				dateTo: '2026-12-25'
			})
		];
		const plan = planDateEdits(
			rows,
			req({ scope: 'period', servicePeriodId: 'dinner', close: ['2026-12-25'] })
		);
		expect(plan.create).toEqual([{ dateFrom: '2026-12-25', dateTo: '2026-12-25' }]);
	});
});

describe('planDateEdits — reopening dates', () => {
	it('deletes a single-day row outright', () => {
		const rows = [row({ id: 'a' })];
		const plan = planDateEdits(rows, req({ open: ['2026-12-24'] }));
		expect(plan.remove).toEqual(['a']);
		expect(plan.shrink).toEqual([]);
		expect(plan.split).toEqual([]);
	});

	it('deletes a multi-day row when every one of its days is reopened', () => {
		const rows = [row({ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-26' })];
		const plan = planDateEdits(rows, req({ open: ['2026-12-24', '2026-12-25', '2026-12-26'] }));
		expect(plan.remove).toEqual(['a']);
	});

	it('shrinks from the FRONT edge', () => {
		const rows = [row({ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-26' })];
		const plan = planDateEdits(rows, req({ open: ['2026-12-24'] }));
		expect(plan.shrink).toEqual([{ id: 'a', dateFrom: '2026-12-25', dateTo: '2026-12-26' }]);
		expect(plan.split).toEqual([]);
		expect(plan.remove).toEqual([]);
	});

	it('shrinks from the BACK edge', () => {
		const rows = [row({ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-26' })];
		const plan = planDateEdits(rows, req({ open: ['2026-12-26'] }));
		expect(plan.shrink).toEqual([{ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-25' }]);
		expect(plan.split).toEqual([]);
	});

	it('SPLITS a range when an interior date is reopened', () => {
		const rows = [row({ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-28' })];
		const plan = planDateEdits(rows, req({ open: ['2026-12-26'] }));
		// Head keeps the row id; the tail becomes a clone that inherits its fields.
		expect(plan.shrink).toEqual([{ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-25' }]);
		expect(plan.split).toEqual([{ from: 'a', dateFrom: '2026-12-27', dateTo: '2026-12-28' }]);
		expect(plan.remove).toEqual([]);
	});

	it('handles two interior holes (one shrink + two clones)', () => {
		const rows = [row({ id: 'a', dateFrom: '2027-01-01', dateTo: '2027-01-10' })];
		const plan = planDateEdits(rows, req({ open: ['2027-01-03', '2027-01-07'] }));
		expect(plan.shrink).toEqual([{ id: 'a', dateFrom: '2027-01-01', dateTo: '2027-01-02' }]);
		expect(plan.split).toEqual([
			{ from: 'a', dateFrom: '2027-01-04', dateTo: '2027-01-06' },
			{ from: 'a', dateFrom: '2027-01-08', dateTo: '2027-01-10' }
		]);
	});

	it('leaves rows for OTHER targets completely alone', () => {
		const rows = [
			row({
				id: 'lunch',
				scope: 'period',
				servicePeriodId: 'lunch',
				dateFrom: '2026-12-24',
				dateTo: '2026-12-26'
			})
		];
		const plan = planDateEdits(rows, req({ open: ['2026-12-25'] })); // editing the whole day
		expect(plan).toMatchObject({ remove: [], shrink: [], split: [], create: [] });
	});

	it('never edits a PERIODIC rule — it reports it as blocked instead', () => {
		const rows = [
			row({
				id: 's',
				dateFrom: '2026-07-01',
				dateTo: '2027-06-30',
				daysOfWeek: [0],
				name: 'Sunday'
			})
		];
		const plan = planDateEdits(rows, req({ open: ['2027-01-03'] })); // a Sunday
		expect(plan.remove).toEqual([]);
		expect(plan.shrink).toEqual([]);
		expect(plan.blocked).toHaveLength(1);
		expect(plan.blocked[0].date).toBe('2027-01-03');
		expect(plan.blocked[0].reason).toContain('Sunday');
	});

	it('reports a whole-day closure blocking a per-service reopen', () => {
		const rows = [
			row({ id: 'f', dateFrom: '2026-12-25', dateTo: '2026-12-25', name: 'Christmas' })
		];
		const plan = planDateEdits(
			rows,
			req({ scope: 'period', servicePeriodId: 'lunch', open: ['2026-12-25'] })
		);
		expect(plan.blocked[0].reason).toContain('Christmas');
	});

	it('says nothing about reopening a date that was never closed', () => {
		const plan = planDateEdits([], req({ open: ['2026-12-25'] }));
		expect(plan.blocked).toEqual([]);
		expect(plan.remove).toEqual([]);
	});

	it('opening a date wins over closing the same date in one submission', () => {
		const rows = [row({ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-24' })];
		const plan = planDateEdits(rows, req({ close: ['2026-12-24'], open: ['2026-12-24'] }));
		expect(plan.remove).toEqual(['a']);
		expect(plan.create).toEqual([]);
	});

	it('reopens across a leap-day boundary correctly', () => {
		const rows = [row({ id: 'a', dateFrom: '2028-02-27', dateTo: '2028-03-01' })];
		const plan = planDateEdits(rows, req({ open: ['2028-02-29'] }));
		expect(plan.shrink).toEqual([{ id: 'a', dateFrom: '2028-02-27', dateTo: '2028-02-28' }]);
		expect(plan.split).toEqual([{ from: 'a', dateFrom: '2028-03-01', dateTo: '2028-03-01' }]);
	});
});

describe('planDateEdits — mixed edits in one Save', () => {
	it('applies opens before working out what still needs closing', () => {
		// Reopen the 25th out of 24–26, then close the 28th: the 25th must NOT come back.
		const rows = [row({ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-26' })];
		const plan = planDateEdits(rows, req({ open: ['2026-12-25'], close: ['2026-12-28'] }));
		expect(plan.shrink).toEqual([{ id: 'a', dateFrom: '2026-12-24', dateTo: '2026-12-24' }]);
		expect(plan.split).toEqual([{ from: 'a', dateFrom: '2026-12-26', dateTo: '2026-12-26' }]);
		expect(plan.create).toEqual([{ dateFrom: '2026-12-28', dateTo: '2026-12-28' }]);
	});
});
