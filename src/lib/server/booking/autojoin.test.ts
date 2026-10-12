import { describe, it, expect } from 'vitest';
import { normaliseAutoJoin, policyFor, toStoredAutoJoin, DEFAULT_AUTOJOIN } from './autojoin.js';

describe('normaliseAutoJoin', () => {
	it('an absent row is the old behaviour: everything joins, nothing staff-only', () => {
		expect(normaliseAutoJoin(null)).toEqual(DEFAULT_AUTOJOIN);
		expect(DEFAULT_AUTOJOIN.staffOnly).toEqual([]);
	});

	it('reads a row written before staff-only existed', () => {
		expect(normaliseAutoJoin({ allowAdHoc: false, excluded: ['a'] })).toEqual({
			allowAdHoc: false,
			excluded: ['a'],
			staffOnly: []
		});
	});

	it('a table stored in BOTH lists is staff-only (the backward-compatible encoding)', () => {
		const cfg = normaliseAutoJoin({ excluded: ['never', 's1', 's2'], staffOnly: ['s1', 's2'] });
		expect(cfg.excluded).toEqual(['never']);
		expect(cfg.staffOnly).toEqual(['s1', 's2']);
	});

	it('drops junk ids and duplicates', () => {
		const cfg = normaliseAutoJoin({ excluded: ['a', 'a', 3, ''], staffOnly: ['b', null, 'b'] });
		expect(cfg).toEqual({ allowAdHoc: true, excluded: ['a'], staffOnly: ['b'] });
	});
});

describe('toStoredAutoJoin', () => {
	it('also writes staff-only tables into `excluded`, so an older build never joins them', () => {
		expect(toStoredAutoJoin({ allowAdHoc: true, excluded: ['never'], staffOnly: ['s1'] })).toEqual({
			allowAdHoc: true,
			excluded: ['never', 's1'],
			staffOnly: ['s1']
		});
	});

	it('round-trips through normaliseAutoJoin', () => {
		const cfg = { allowAdHoc: false, excluded: ['never'], staffOnly: ['s1', 's2'] };
		expect(normaliseAutoJoin(toStoredAutoJoin(cfg))).toEqual(cfg);
	});
});

describe('policyFor', () => {
	const cfg = { allowAdHoc: true, excluded: ['never'], staffOnly: ['s1', 's2'] };

	/**
	 * A staff-only table used to be sold to guests ON ITS OWN — only its JOINS were
	 * held back. That left Asia's counter (50-54) bookable online as five 2-tops,
	 * which is not what "staff only" meant to the owner: "when booking through
	 * online on Asia it won't assign people to 50s tables but admins can still make
	 * bookings on them as normal".
	 */
	it('ONLINE: a staff-only table is not offered at all, alone or joined', () => {
		expect(policyFor(cfg, 'online')).toEqual({
			allowAdHoc: true,
			excluded: ['never', 's1', 's2'],
			chainOnly: [],
			notOffered: ['s1', 's2']
		});
	});

	it('STAFF: a staff-only table joins, but only through the registered chains', () => {
		expect(policyFor(cfg, 'staff')).toEqual({
			allowAdHoc: true,
			excluded: ['never'],
			chainOnly: ['s1', 's2'],
			notOffered: []
		});
	});

	it('STAFF: nothing is ever withheld from a host — the counter allocates normally', () => {
		expect(policyFor(cfg, 'staff').notOffered).toEqual([]);
	});

	it('carries allowAdHoc through on both channels', () => {
		const off = { ...cfg, allowAdHoc: false };
		expect(policyFor(off, 'online').allowAdHoc).toBe(false);
		expect(policyFor(off, 'staff').allowAdHoc).toBe(false);
	});
});
