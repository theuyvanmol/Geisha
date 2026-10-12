import { describe, it, expect } from 'vitest';
import {
	normaliseBookingOptions,
	requirementForOption,
	resolveBookingOption,
	toPublicOption,
	termsFor,
	contextFor
} from './options.js';
import {
	optionAvailable,
	availableOptions,
	type BookingOption
} from '../../data/bookingOptions.js';

const base: BookingOption = { id: 'x', title: 'X' };
const ctx = {
	dow: 3, // Wednesday
	date: '2026-08-05',
	time: '19:00',
	partySize: 4,
	hoursUntil: 72
};

describe('optionAvailable', () => {
	it('offers an unconstrained option always', () => {
		expect(optionAvailable(base, ctx)).toBe(true);
	});

	it('always offers the default, even outside its own constraints', () => {
		// A guest must always have something to select, or the step is a dead end
		// and they cannot book at all.
		const impossible = { ...base, isDefault: true, days: [0], partyMin: 99 };
		expect(optionAvailable(impossible, ctx)).toBe(true);
	});

	it('filters by day of week', () => {
		expect(optionAvailable({ ...base, days: [0] }, ctx)).toBe(false);
		expect(optionAvailable({ ...base, days: [3] }, ctx)).toBe(true);
	});

	it('treats the time window as inclusive start, exclusive end', () => {
		// A lunch option ending at 17:00 must not be offered for a 17:00 booking.
		expect(optionAvailable({ ...base, from: '12:00', to: '17:00' }, ctx)).toBe(false);
		expect(optionAvailable({ ...base, from: '19:00', to: '22:00' }, ctx)).toBe(true);
		expect(
			optionAvailable({ ...base, from: '12:00', to: '17:00' }, { ...ctx, time: '17:00' })
		).toBe(false);
		expect(
			optionAvailable({ ...base, from: '12:00', to: '17:00' }, { ...ctx, time: '12:00' })
		).toBe(true);
	});

	it('filters by party bounds, treating partyMax 0 as unbounded', () => {
		expect(optionAvailable({ ...base, partyMin: 6 }, ctx)).toBe(false);
		expect(optionAvailable({ ...base, partyMin: 2, partyMax: 4 }, ctx)).toBe(true);
		expect(optionAvailable({ ...base, partyMin: 2, partyMax: 3 }, ctx)).toBe(false);
		expect(optionAvailable({ ...base, partyMin: 2, partyMax: 0 }, ctx)).toBe(true);
	});

	it('enforces minimum notice', () => {
		const brunch = { ...base, noticeHours: 48 };
		expect(optionAvailable(brunch, ctx)).toBe(true);
		expect(optionAvailable(brunch, { ...ctx, hoursUntil: 12 })).toBe(false);
	});

	it('filters by seasonal date range', () => {
		expect(optionAvailable({ ...base, dateFrom: '2026-09-01' }, ctx)).toBe(false);
		expect(optionAvailable({ ...base, dateTo: '2026-07-31' }, ctx)).toBe(false);
		expect(optionAvailable({ ...base, dateFrom: '2026-08-01', dateTo: '2026-08-31' }, ctx)).toBe(
			true
		);
	});
});

describe('availableOptions', () => {
	it('puts the default first so it is the preselected card', () => {
		const list: BookingOption[] = [
			{ id: 'brunch', title: 'Brunch' },
			{ id: 'standard', title: 'Standard', isDefault: true }
		];
		expect(availableOptions(list, ctx).map((o) => o.id)).toEqual(['standard', 'brunch']);
	});

	it('drops options that do not match the slot', () => {
		const list: BookingOption[] = [
			{ id: 'standard', title: 'Standard', isDefault: true },
			{ id: 'lunch', title: 'Lunch', from: '12:00', to: '17:00' }
		];
		expect(availableOptions(list, ctx).map((o) => o.id)).toEqual(['standard']);
	});
});

describe('normaliseBookingOptions', () => {
	it('returns [] for anything that is not an array', () => {
		expect(normaliseBookingOptions(null)).toEqual([]);
		expect(normaliseBookingOptions('nope')).toEqual([]);
		expect(normaliseBookingOptions({ id: 'x' })).toEqual([]);
	});

	it('drops entries missing an id or a title rather than half-rendering them', () => {
		expect(normaliseBookingOptions([{ id: 'a' }, { title: 'B' }, {}, 7])).toEqual([]);
	});

	it('keeps a well-formed entry and coerces its fields', () => {
		const [opt] = normaliseBookingOptions([
			{
				id: ' brunch ',
				title: ' Brunch ',
				days: [0, 1, 99, 'x'],
				from: '12:00',
				to: 'not-a-time',
				dateFrom: '2026-08-01',
				dateTo: 'nope',
				partyMin: 2,
				partyMax: -1,
				noticeHours: 48,
				deposit: { kind: 'deposit', perPersonPence: 1000, capture: 'auto' },
				isDefault: true
			}
		]);
		expect(opt.id).toBe('brunch');
		expect(opt.title).toBe('Brunch');
		expect(opt.days).toEqual([0, 1]);
		expect(opt.from).toBe('12:00');
		expect(opt.to).toBeUndefined();
		expect(opt.dateFrom).toBe('2026-08-01');
		expect(opt.dateTo).toBeUndefined();
		expect(opt.partyMax).toBeUndefined(); // negative is not a bound
		expect(opt.deposit).toEqual({ kind: 'deposit', perPersonPence: 1000, capture: 'auto' });
		expect(opt.isDefault).toBe(true);
	});

	it('drops a deposit with an unrecognised kind', () => {
		const [opt] = normaliseBookingOptions([
			{ id: 'a', title: 'A', deposit: { kind: 'freebie', perPersonPence: 500 } }
		]);
		expect(opt.deposit).toBeUndefined();
	});
});

describe('requirementForOption', () => {
	it('returns null when the option imposes no deposit of its own', () => {
		// The rules engine then decides — Standard Booking must not override it.
		expect(requirementForOption({ id: 's', title: 'Standard' }, 4)).toBeNull();
	});

	it('multiplies a per-person deposit by the party size', () => {
		const req = requirementForOption(
			{ id: 'b', title: 'Brunch', deposit: { kind: 'deposit', perPersonPence: 1000 } },
			3
		);
		expect(req?.kind).toBe('deposit');
		expect(req?.perPersonPence).toBe(1000);
		expect(req?.amountPence).toBe(3000);
		expect(req?.capture).toBe('auto');
		expect(req?.promotionName).toBe('Brunch');
	});

	it('defaults a no-show hold to manual capture', () => {
		const req = requirementForOption(
			{ id: 'g', title: 'Guarantee', deposit: { kind: 'noshow_hold', perPersonPence: 500 } },
			2
		);
		expect(req?.kind).toBe('noshow_hold');
		expect(req?.capture).toBe('manual');
		expect(req?.amountPence).toBe(1000);
	});

	it('treats a zero per-person amount as no payment', () => {
		const req = requirementForOption(
			{ id: 'z', title: 'Zero', deposit: { kind: 'deposit', perPersonPence: 0 } },
			4
		);
		expect(req?.kind).toBe('none');
		expect(req?.amountPence).toBe(0);
		// The promotion still names itself, so the diary shows what was booked.
		expect(req?.promotionName).toBe('Zero');
	});

	it("uses the option's own terms as the guest-facing reason", () => {
		const req = requirementForOption(
			{
				id: 'b',
				title: 'Brunch',
				terms: 'Deposits are non-refundable under 12 hours notice.',
				deposit: { kind: 'deposit', perPersonPence: 1000 }
			},
			2
		);
		expect(req?.reason).toBe('Deposits are non-refundable under 12 hours notice.');
		expect(req?.promotionTerms).toBe('Deposits are non-refundable under 12 hours notice.');
	});
});

describe('termsFor', () => {
	it("falls back to the linked promotion's wording", () => {
		expect(termsFor({ id: 'b', title: 'B', promotionId: 'bottomless-brunch' })).toContain(
			'48 hours notice'
		);
	});

	it('prefers the option’s own terms over the promotion’s', () => {
		expect(
			termsFor({ id: 'b', title: 'B', promotionId: 'bottomless-brunch', terms: 'Ours.' })
		).toBe('Ours.');
	});

	it('is undefined when neither exists', () => {
		expect(termsFor({ id: 'x', title: 'X' })).toBeUndefined();
	});
});

describe('toPublicOption', () => {
	it('resolves the deposit for the actual party size', () => {
		const pub = toPublicOption(
			{ id: 'b', title: 'Brunch', deposit: { kind: 'deposit', perPersonPence: 1000 } },
			5
		);
		expect(pub.depositPence).toBe(5000);
		expect(pub.depositKind).toBe('deposit');
	});

	it('reports no deposit when the option inherits the standard rules', () => {
		const pub = toPublicOption({ id: 's', title: 'Standard' }, 5);
		expect(pub.depositPence).toBe(0);
		expect(pub.depositKind).toBe('none');
	});

	// 2026-09-11: the options step said nothing for an ordinary large table, because
	// the rules deposit only ran at creation — so a party of 8 first saw "£80" on the
	// card screen, after typing their details. Given what the rules will take, an
	// option that inherits them must say so, in the same precedence creation uses.
	describe('given what the deposit rules will take for this slot', () => {
		const rules = { kind: 'deposit' as const, amountPence: 8000 };

		it('an option that inherits the rules shows the rules deposit', () => {
			const pub = toPublicOption({ id: 's', title: 'Standard' }, 8, rules);
			expect(pub.depositPence).toBe(8000);
			expect(pub.depositKind).toBe('deposit');
		});

		it('an option with a deposit of its own keeps it — the option wins, as at creation', () => {
			const pub = toPublicOption(
				{ id: 'b', title: 'Brunch', deposit: { kind: 'deposit', perPersonPence: 1000 } },
				2,
				rules
			);
			expect(pub.depositPence).toBe(2000);
		});

		it('an option that explicitly waives the deposit shows none, even when the rules would charge', () => {
			const pub = toPublicOption(
				{ id: 'w', title: 'Waived', deposit: { kind: 'none', perPersonPence: 0 } },
				8,
				rules
			);
			expect(pub.depositPence).toBe(0);
			expect(pub.depositKind).toBe('none');
		});
	});
});

describe('contextFor', () => {
	it('reads the day and time in the restaurant’s timezone, not UTC', () => {
		// 23:30 UTC on 4 Aug is 00:30 on 5 Aug in London — a UTC read would name
		// the wrong day AND the wrong service.
		const c = contextFor(new Date('2026-08-04T23:30:00Z'), 'Europe/London', 2);
		expect(c.date).toBe('2026-08-05');
		expect(c.time).toBe('00:30');
		expect(c.dow).toBe(3); // Wednesday
	});

	it('measures notice from now to the booking', () => {
		const c = contextFor(
			new Date('2026-08-05T18:00:00Z'),
			'Europe/London',
			2,
			new Date('2026-08-05T12:00:00Z')
		);
		expect(c.hoursUntil).toBeCloseTo(6, 5);
	});
});

// --- the promotion a HOST puts on a booking ---------------------------------
//
// Staff pick from the same catalogue the guest does, but they are not held to its
// windows: a brunch gets taken by phone inside the 48-hour notice, or for the
// private room on a Thursday, because the restaurant decided to. These run against
// the DEFAULT catalogue — getBookingOptions falls back to it when there is no
// database, which is exactly the case here.

describe('resolveBookingOption — staff bypass', () => {
	// 2026-08-04 is a Tuesday; Bottomless Brunch runs Fri & Sat 12:00–15:00.
	const tuesday = new Date('2026-08-04T13:00:00Z');
	const saturday = new Date('2026-08-08T13:00:00Z');
	const TZ = 'Europe/London';
	// Pinned, so the 48-hour notice rule is measured against a fixed clock rather
	// than the day the suite happens to run — both slots are a week out from here.
	const NOW = new Date('2026-08-01T09:00:00Z');

	it('refuses an out-of-window option for a guest', async () => {
		expect(await resolveBookingOption('fusion', 'brunch', tuesday, TZ, 4, NOW)).toBeNull();
	});

	it('allows the same option for staff', async () => {
		const opt = await resolveBookingOption('fusion', 'brunch', tuesday, TZ, 4, NOW, {
			ignoreAvailability: true
		});
		expect(opt?.title).toBe('Bottomless Brunch');
	});

	it('is unchanged inside the window', async () => {
		expect((await resolveBookingOption('fusion', 'brunch', saturday, TZ, 4, NOW))?.id).toBe(
			'brunch'
		);
	});

	it('never invents an option the catalogue does not have', async () => {
		expect(
			await resolveBookingOption('fusion', 'nonsense', saturday, TZ, 4, NOW, {
				ignoreAvailability: true
			})
		).toBeNull();
		expect(
			await resolveBookingOption('fusion', '', saturday, TZ, 4, NOW, {
				ignoreAvailability: true
			})
		).toBeNull();
	});
});

describe('promotion colour', () => {
	it('Bottomless Brunch carries a colour and Standard Booking does not', async () => {
		// The diary paints a booking's name in its promotion's colour, matching by the
		// TITLE stamped on the booking — so both halves of this are a contract.
		const at = new Date('2026-08-08T13:00:00Z');
		const now = new Date('2026-08-01T09:00:00Z');
		const brunch = await resolveBookingOption('fusion', 'brunch', at, 'Europe/London', 4, now);
		expect(brunch?.title).toBe('Bottomless Brunch');
		expect(brunch?.colour).toBeTruthy();
		const standard = await resolveBookingOption('fusion', 'standard', at, 'Europe/London', 4, now);
		expect(standard?.title).toBe('Standard Booking');
		expect(standard?.colour).toBeFalsy();
	});

	it('survives a stored settings override', () => {
		// normaliseBookingOptions drops every key it does not name. Without colour on
		// that list, the first manager to save an override would have quietly turned
		// the red off with no way to tell why.
		const [opt] = normaliseBookingOptions([
			{ id: 'brunch', title: 'Bottomless Brunch', colour: '#c0121b' }
		]);
		expect(opt.colour).toBe('#c0121b');
	});
});
