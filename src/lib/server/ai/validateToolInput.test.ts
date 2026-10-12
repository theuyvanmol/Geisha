import { describe, it, expect } from 'vitest';
import { validateToolInput } from './validateToolInput.js';

// The exact parameter schemas the live WRITE tools declare (mirrored from
// adminTools.ts / tools.ts) so the validator is tested against real shapes.

const moveBooking = {
	type: 'object',
	properties: {
		bookingId: { type: 'string' },
		tableIds: { type: 'array', items: { type: 'string' } }
	},
	required: ['bookingId', 'tableIds']
};

const joinTables = {
	type: 'object',
	properties: {
		tableIdA: { type: 'string' },
		tableIdB: { type: 'string' }
	},
	required: ['tableIdA', 'tableIdB']
};

const updateSetting = {
	type: 'object',
	properties: {
		key: { type: 'string' },
		value: {} // intentionally untyped (number | string)
	},
	required: ['key', 'value']
};

// Legacy create_booking: nested object + enum, to ensure recursion/enum work.
const createBooking = {
	type: 'object',
	properties: {
		brand: { type: 'string', enum: ['asia', 'fusion'] },
		date: { type: 'string' },
		time: { type: 'string' },
		partySize: { type: 'integer' },
		customer: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				email: { type: 'string' },
				phone: { type: 'string' }
			},
			required: ['name', 'email']
		}
	},
	required: ['brand', 'date', 'time', 'partySize', 'customer']
};

describe('validateToolInput — move_booking', () => {
	it('accepts a well-formed payload', () => {
		const r = validateToolInput(moveBooking, { bookingId: 'x', tableIds: ['a', 'b'] });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ bookingId: 'x', tableIds: ['a', 'b'] });
	});

	it('rejects a missing required tableIds', () => {
		const r = validateToolInput(moveBooking, { bookingId: 'x' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/tableIds/);
	});

	it('rejects tableIds given as a string (not an array)', () => {
		const r = validateToolInput(moveBooking, { bookingId: 'x', tableIds: 'a' });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/expected array/);
	});

	it('rejects an array item of the wrong type', () => {
		const r = validateToolInput(moveBooking, { bookingId: 'x', tableIds: ['a', 2] });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/tableIds\[1\].*expected string/);
	});
});

describe('validateToolInput — update_setting (untyped value)', () => {
	it('accepts a numeric value', () => {
		const r = validateToolInput(updateSetting, { key: 'online_party_max', value: 12 });
		expect(r.ok).toBe(true);
	});

	it('accepts a string value (value is unconstrained)', () => {
		const r = validateToolInput(updateSetting, { key: 'ai_assistant_prompt', value: 'hello' });
		expect(r.ok).toBe(true);
	});

	it('rejects an unexpected extra key', () => {
		const r = validateToolInput(updateSetting, {
			key: 'online_party_max',
			value: 12,
			evil: true
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/unexpected property "evil"/);
	});

	it('rejects a missing required key', () => {
		const r = validateToolInput(updateSetting, { value: 12 });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/missing required property "key"/);
	});
});

describe('validateToolInput — join_tables', () => {
	it('accepts two string ids', () => {
		const r = validateToolInput(joinTables, { tableIdA: 'a', tableIdB: 'b' });
		expect(r.ok).toBe(true);
	});

	it('rejects numbers instead of strings', () => {
		const r = validateToolInput(joinTables, { tableIdA: 1, tableIdB: 2 });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors.join(' ')).toMatch(/tableIdA.*expected string/);
			expect(r.errors.join(' ')).toMatch(/tableIdB.*expected string/);
		}
	});
});

describe('validateToolInput — nested objects, enum, integer', () => {
	it('accepts a well-formed create_booking', () => {
		const r = validateToolInput(createBooking, {
			brand: 'asia',
			date: '2026-06-26',
			time: '19:30',
			partySize: 4,
			customer: { name: 'Ada', email: 'ada@example.com' }
		});
		expect(r.ok).toBe(true);
	});

	it('rejects a brand outside the enum', () => {
		const r = validateToolInput(createBooking, {
			brand: 'pizza',
			date: '2026-06-26',
			time: '19:30',
			partySize: 4,
			customer: { name: 'Ada', email: 'ada@example.com' }
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/brand.*one of/);
	});

	it('rejects a non-integer partySize', () => {
		const r = validateToolInput(createBooking, {
			brand: 'asia',
			date: '2026-06-26',
			time: '19:30',
			partySize: 4.5,
			customer: { name: 'Ada', email: 'ada@example.com' }
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/partySize.*expected integer/);
	});

	it('rejects a nested missing required (customer.email)', () => {
		const r = validateToolInput(createBooking, {
			brand: 'asia',
			date: '2026-06-26',
			time: '19:30',
			partySize: 4,
			customer: { name: 'Ada' }
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/customer: missing required property "email"/);
	});

	it('rejects an unexpected nested key', () => {
		const r = validateToolInput(createBooking, {
			brand: 'asia',
			date: '2026-06-26',
			time: '19:30',
			partySize: 4,
			customer: { name: 'Ada', email: 'ada@example.com', ssn: '123' }
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/customer: unexpected property "ssn"/);
	});
});

describe('validateToolInput — non-object input to an object schema', () => {
	it('rejects an array', () => {
		const r = validateToolInput(moveBooking, ['x']);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join(' ')).toMatch(/expected object/);
	});

	it('rejects null', () => {
		const r = validateToolInput(moveBooking, null);
		expect(r.ok).toBe(false);
	});
});
