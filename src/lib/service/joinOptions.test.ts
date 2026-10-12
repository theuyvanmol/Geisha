import { describe, it, expect } from 'vitest';
import {
	buildJoinOptions,
	groupPickableTables,
	type JoinTable,
	type JoinChain
} from './joinOptions.js';

/**
 * A small stand-in for Asia's Back left + Middle sections, which is where the
 * owner's party of 12 actually lands:
 *
 *   Back left   30(6) 31(2) 32(2) 33(4) 34(4) 35(4)
 *   Middle      10(4) 11(4) 12(4) 13(6) 14(2)
 *
 * Saved chains on that floor: 33+34 (8), 34+35 (8), 33+34+35 (12), 10+11 (8).
 */
const t = (label: string, seatsMax: number, section: string, free = true): JoinTable => ({
	id: `t${label}`,
	label,
	seatsMax,
	section,
	free
});

const BACK_LEFT = [
	t('30', 6, 'Back left'),
	t('31', 2, 'Back left'),
	t('32', 2, 'Back left'),
	t('33', 4, 'Back left'),
	t('34', 4, 'Back left'),
	t('35', 4, 'Back left')
];
const MIDDLE = [
	t('10', 4, 'Middle'),
	t('11', 4, 'Middle'),
	t('12', 4, 'Middle'),
	t('13', 6, 'Middle'),
	t('14', 2, 'Middle')
];
const TABLES = [...BACK_LEFT, ...MIDDLE];

const chain = (labels: string[], capacity: number): JoinChain => ({
	tableIds: labels.map((l) => `t${l}`),
	capacity
});
const CHAINS = [
	chain(['33', '34'], 8),
	chain(['34', '35'], 8),
	chain(['33', '34', '35'], 12),
	chain(['10', '11'], 8)
];

/** '33 + 34 + 35' — reads like the UI, so a failure names real tables. */
const shown = (o: { ids: string[] }) => o.ids.map((id) => id.slice(1)).join(' + ');

describe('buildJoinOptions', () => {
	it('offers nothing when one free table already seats the party', () => {
		const options = buildJoinOptions({ tables: TABLES, chains: CHAINS, party: 6 });
		expect(options).toEqual([]);
	});

	it('puts a saved chain first, with the capacity the chain states', () => {
		const options = buildJoinOptions({ tables: TABLES, chains: CHAINS, party: 12 });
		expect(options[0]).toMatchObject({ tier: 'saved', seats: 12 });
		expect(shown(options[0])).toBe('33 + 34 + 35');
	});

	it('drops a saved chain whose table is already booked', () => {
		const tables = TABLES.map((x) => (x.label === '34' ? { ...x, free: false } : x));
		const options = buildJoinOptions({ tables, chains: CHAINS, party: 12 });
		expect(options.filter((o) => o.tier === 'saved')).toEqual([]);
		expect(options.every((o) => !o.ids.includes('t34'))).toBe(true);
	});

	it('offers consecutively-numbered tables in one section as a "run"', () => {
		const options = buildJoinOptions({ tables: TABLES, chains: CHAINS, party: 12 });
		const runs = options.filter((o) => o.tier === 'run').map(shown);
		expect(runs).toContain('10 + 11 + 12');
		expect(runs).toContain('12 + 13 + 14');
	});

	it('ranks a non-consecutive same-section combination as "loose"', () => {
		// 30(6) + 32(2) + 35(4) = 12, but 31/33/34 sit between them.
		const options = buildJoinOptions({ tables: TABLES, chains: CHAINS, party: 12 });
		const found = options.find((o) => shown(o) === '30 + 32 + 35');
		expect(found?.tier).toBe('loose');
	});

	it('orders the tiers saved → known → run → loose', () => {
		const options = buildJoinOptions({ tables: TABLES, chains: CHAINS, party: 12 });
		const rank = { saved: 0, known: 1, run: 2, loose: 3 } as const;
		const seen = options.map((o) => rank[o.tier]);
		expect(seen).toEqual([...seen].sort((a, b) => a - b));
	});

	it('never mixes two sections in a generated combination', () => {
		const options = buildJoinOptions({ tables: TABLES, chains: CHAINS, party: 12 });
		for (const o of options.filter((x) => x.tier !== 'saved')) {
			expect(o.section).not.toBe('');
		}
	});

	it('honours the area filter', () => {
		const options = buildJoinOptions({
			tables: TABLES,
			chains: CHAINS,
			party: 12,
			area: 'Middle'
		});
		expect(options.length).toBeGreaterThan(0);
		expect(options.every((o) => o.section === 'Middle')).toBe(true);
	});

	it('never offers a combination that seats fewer than the party', () => {
		const options = buildJoinOptions({ tables: TABLES, chains: CHAINS, party: 12 });
		expect(options.every((o) => o.seats >= 12)).toBe(true);
	});

	it('returns no duplicate combinations', () => {
		const options = buildJoinOptions({ tables: TABLES, chains: CHAINS, party: 12 });
		const keys = options.map((o) => [...o.ids].sort().join('|'));
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe('groupPickableTables', () => {
	/** ['Middle', '10, 11, 12'] — a compact shape to assert the whole list against. */
	const summarise = (groups: { label: string; tables: JoinTable[] }[]) =>
		groups.map((g) => [g.label, g.tables.map((t) => t.label).join(', ')]);

	it('groups by section when nothing is picked yet', () => {
		const groups = groupPickableTables({ tables: TABLES, chains: CHAINS, selectedIds: [] });
		expect(summarise(groups)).toEqual([
			['Back left', '30, 31, 32, 33, 34, 35'],
			['Middle', '10, 11, 12, 13, 14']
		]);
	});

	it('offers the picked table\u2019s chain partners first, named after it', () => {
		const groups = groupPickableTables({
			tables: TABLES,
			chains: CHAINS,
			selectedIds: ['t33']
		});
		// 33 shares the 33+34 chain with 34 and the 33+34+35 chain with 35, so both.
		expect(groups[0].label).toBe('Joins with 33');
		expect(groups[0].tables.map((t) => t.label)).toEqual(['34', '35']);
	});

	it('puts the rest of the picked section next, then everything else', () => {
		const groups = groupPickableTables({
			tables: TABLES,
			chains: CHAINS,
			selectedIds: ['t33']
		});
		expect(summarise(groups)).toEqual([
			['Joins with 33', '34, 35'],
			['Back left', '30, 31, 32'],
			['Other tables', '10, 11, 12, 13, 14']
		]);
	});

	it('never offers a table that is already picked', () => {
		const groups = groupPickableTables({
			tables: TABLES,
			chains: CHAINS,
			selectedIds: ['t33', 't34']
		});
		const offered = groups.flatMap((g) => g.tables.map((t) => t.id));
		expect(offered).not.toContain('t33');
		expect(offered).not.toContain('t34');
	});

	it('widens the partner group as more tables are picked', () => {
		const groups = groupPickableTables({
			tables: TABLES,
			chains: CHAINS,
			selectedIds: ['t33', 't34']
		});
		expect(groups[0].label).toBe('Joins with 33 + 34');
		expect(groups[0].tables.map((t) => t.label)).toEqual(['35']);
	});

	it('still lists a taken table, so staff can see it and the UI can disable it', () => {
		const tables = TABLES.map((x) => (x.label === '34' ? { ...x, free: false } : x));
		const groups = groupPickableTables({ tables, chains: CHAINS, selectedIds: ['t33'] });
		const offered = groups.flatMap((g) => g.tables.map((t) => t.label));
		expect(offered).toContain('34');
	});

	it('offers every table somewhere \u2014 the picker never hard-blocks a choice', () => {
		const groups = groupPickableTables({
			tables: TABLES,
			chains: CHAINS,
			selectedIds: ['t33']
		});
		const offered = new Set(groups.flatMap((g) => g.tables.map((t) => t.id)));
		expect(offered.size).toBe(TABLES.length - 1);
	});
});
