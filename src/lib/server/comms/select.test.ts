import { describe, it, expect } from 'vitest';
import {
	selectThankYou,
	selectWinBack,
	selectOccasion,
	selectReminder,
	isContactable,
	normaliseOccasion
} from './select.js';
import { selectCandidates } from './engine.js';
import { sanitiseModelBody } from './draft.js';
import { DEFAULT_COMMS_CONFIG, MARKETING_KINDS, type CommsConfig } from './types.js';
import type { BookingWithCustomer } from './types.js';
import type { BookingStatus, Customer } from '../db/types.js';

// --- fixtures ---------------------------------------------------------------

let seq = 0;
function customer(over: Partial<Customer> = {}): Customer {
	seq += 1;
	return {
		id: over.id ?? `c${seq}`,
		created: '',
		updated: '',
		name: 'Test Guest',
		email: 'guest@example.com',
		phone: '',
		notes: '',
		marketing_consent: false,
		...over
	};
}

function booking(
	status: BookingStatus,
	startsAt: string,
	cust: Customer,
	over: Partial<BookingWithCustomer> = {}
): BookingWithCustomer {
	seq += 1;
	return {
		id: over.id ?? `b${seq}`,
		created: '',
		updated: '',
		restaurant: 'r1',
		customer: cust.id,
		party_size: 2,
		starts_at: startsAt,
		ends_at: over.ends_at ?? startsAt,
		tables: [],
		service_period: 'dinner',
		status,
		source: 'online',
		special_requests: '',
		occasion: '',
		expand: { customer: cust },
		...over
	};
}

const NOW = new Date('2026-06-25T22:00:00.000Z');
const ms = (n: number) => n;
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000 * ms(1)).toISOString();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();

// --- isContactable ----------------------------------------------------------

describe('isContactable', () => {
	it('requires an email and not-erased', () => {
		expect(isContactable(customer({ email: 'a@b.com' }))).toBe(true);
		expect(isContactable(customer({ email: '' }))).toBe(false);
		expect(isContactable(customer({ email: 'a@b.com', deleted_at: daysAgo(1) }))).toBe(false);
		expect(isContactable(undefined)).toBe(false);
		expect(isContactable(null)).toBe(false);
	});
});

// --- normaliseOccasion ------------------------------------------------------

describe('normaliseOccasion', () => {
	it('lowercases real occasions and rejects placeholders', () => {
		expect(normaliseOccasion('Birthday')).toBe('birthday');
		expect(normaliseOccasion('  Anniversary ')).toBe('anniversary');
		expect(normaliseOccasion('none')).toBe('');
		expect(normaliseOccasion('N/A')).toBe('');
		expect(normaliseOccasion('')).toBe('');
		expect(normaliseOccasion(undefined)).toBe('');
		expect(normaliseOccasion('business')).toBe('');
	});
});

// --- selectThankYou ---------------------------------------------------------

describe('selectThankYou', () => {
	it('selects completed bookings within the lookback window', () => {
		const cu = customer();
		const list = [
			booking('completed', hoursAgo(3), cu), // in window
			booking('completed', hoursAgo(40), cu), // too old (default 18h)
			booking('confirmed', hoursAgo(2), cu), // not completed
			booking('no_show', hoursAgo(2), cu) // not completed
		];
		const got = selectThankYou(list, NOW);
		expect(got).toHaveLength(1);
		expect(got[0].kind).toBe('thank_you');
		expect(got[0].booking?.id).toBe(list[0].id);
	});

	it('skips a completed booking whose guest has no email', () => {
		const cu = customer({ email: '' });
		const got = selectThankYou([booking('completed', hoursAgo(2), cu)], NOW);
		expect(got).toHaveLength(0);
	});

	it('uses ends_at when present, else starts_at', () => {
		const cu = customer();
		const b = booking('completed', hoursAgo(30), cu, { ends_at: hoursAgo(2) });
		expect(selectThankYou([b], NOW)).toHaveLength(1);
	});
});

// --- selectWinBack ----------------------------------------------------------

describe('selectWinBack', () => {
	it('selects a guest whose last completed visit is older than the lapsed window with nothing upcoming', () => {
		const cu = customer({ id: 'lapsed' });
		const got = selectWinBack([booking('completed', daysAgo(200), cu)], NOW, 120);
		expect(got).toHaveLength(1);
		expect(got[0].kind).toBe('win_back');
		expect(got[0].customer.id).toBe('lapsed');
		expect(got[0].booking).toBeUndefined(); // customer-level
	});

	it('does NOT win-back a guest with an upcoming booking', () => {
		const cu = customer({ id: 'returning' });
		const got = selectWinBack(
			[booking('completed', daysAgo(200), cu), booking('confirmed', daysAhead(3), cu)],
			NOW,
			120
		);
		expect(got).toHaveLength(0);
	});

	it('does NOT win-back a guest who visited recently', () => {
		const cu = customer();
		expect(selectWinBack([booking('completed', daysAgo(10), cu)], NOW, 120)).toHaveLength(0);
	});

	it('does NOT win-back a guest who never completed a visit', () => {
		const cu = customer();
		expect(selectWinBack([booking('cancelled', daysAgo(300), cu)], NOW, 120)).toHaveLength(0);
	});

	it('de-dupes to one candidate per customer using the most recent completed visit', () => {
		const cu = customer({ id: 'multi' });
		const got = selectWinBack(
			[booking('completed', daysAgo(300), cu), booking('completed', daysAgo(150), cu)],
			NOW,
			120
		);
		expect(got).toHaveLength(1);
		// reason reflects the MOST RECENT visit (150d), so days-since ~150 not 300.
		expect(got[0].reason).toMatch(/150 days/);
	});
});

// --- selectOccasion ---------------------------------------------------------

describe('selectOccasion', () => {
	it('selects an upcoming live booking with a real occasion', () => {
		const cu = customer();
		const got = selectOccasion(
			[booking('confirmed', daysAhead(3), cu, { occasion: 'Birthday' })],
			NOW
		);
		expect(got).toHaveLength(1);
		expect(got[0].kind).toBe('occasion');
		expect(got[0].occasion).toBe('birthday');
	});

	it('ignores placeholder occasions and past/cancelled bookings', () => {
		const cu = customer();
		expect(
			selectOccasion([booking('confirmed', daysAhead(3), cu, { occasion: 'none' })], NOW)
		).toHaveLength(0);
		expect(
			selectOccasion([booking('confirmed', daysAgo(3), cu, { occasion: 'birthday' })], NOW)
		).toHaveLength(0);
		expect(
			selectOccasion([booking('cancelled', daysAhead(3), cu, { occasion: 'birthday' })], NOW)
		).toHaveLength(0);
	});
});

// --- selectReminder ---------------------------------------------------------

describe('selectReminder', () => {
	it('selects confirmed bookings ~24h out', () => {
		const cu = customer();
		const got = selectReminder([booking('confirmed', hoursAhead(24), cu)], NOW);
		expect(got).toHaveLength(1);
		expect(got[0].kind).toBe('reminder');
	});

	it('ignores bookings outside the 24h window', () => {
		const cu = customer();
		expect(selectReminder([booking('confirmed', hoursAhead(2), cu)], NOW)).toHaveLength(0);
		expect(selectReminder([booking('confirmed', hoursAhead(48), cu)], NOW)).toHaveLength(0);
	});
});

// --- selectCandidates (engine, pure path) -----------------------------------

describe('selectCandidates', () => {
	it('only runs the enabled selectors', () => {
		const cu = customer();
		const list = [
			booking('completed', hoursAgo(2), cu), // thank-you
			booking('confirmed', hoursAhead(24), cu) // reminder
		];
		const onlyThankYou: CommsConfig = {
			...DEFAULT_COMMS_CONFIG,
			reminder: { enabled: false, autoSend: false },
			thank_you: { enabled: true, autoSend: false },
			win_back: { enabled: false, autoSend: false },
			occasion: { enabled: false, autoSend: false }
		};
		const got = selectCandidates(list, onlyThankYou, NOW);
		expect(got.map((c) => c.kind)).toEqual(['thank_you']);
	});

	it('returns nothing when all kinds are disabled', () => {
		const cu = customer();
		const allOff: CommsConfig = {
			reminder: { enabled: false, autoSend: false },
			thank_you: { enabled: false, autoSend: false },
			win_back: { enabled: false, autoSend: false },
			occasion: { enabled: false, autoSend: false }
		};
		expect(selectCandidates([booking('completed', hoursAgo(2), cu)], allOff, NOW)).toEqual([]);
	});
});

// --- marketing-consent gating is a documented set ----------------------------

describe('MARKETING_KINDS', () => {
	it('marks win_back and occasion as marketing (consent-gated), not reminder/thank_you', () => {
		expect(MARKETING_KINDS.has('win_back')).toBe(true);
		expect(MARKETING_KINDS.has('occasion')).toBe(true);
		expect(MARKETING_KINDS.has('reminder')).toBe(false);
		expect(MARKETING_KINDS.has('thank_you')).toBe(false);
	});
});

// --- draft sanitiser --------------------------------------------------------

describe('sanitiseModelBody', () => {
	it('splits paragraphs and strips fences/HTML/leaked greeting', () => {
		const out = sanitiseModelBody(
			'Hello there,\n\nThank you for visiting us.\n\nWe hope to see you again soon.'
		);
		// greeting line removed; two body paragraphs kept
		expect(out).toEqual(['Thank you for visiting us.', 'We hope to see you again soon.']);
	});

	it('strips HTML tags and code fences', () => {
		const out = sanitiseModelBody('```\ncode\n```\n<p>Warm welcome</p>');
		expect(out.join(' ')).not.toMatch(/[<>`]/);
		expect(out.join(' ')).toContain('Warm welcome');
	});

	it('returns an empty array for empty/whitespace input', () => {
		expect(sanitiseModelBody('')).toEqual([]);
		expect(sanitiseModelBody('   \n  ')).toEqual([]);
	});

	it('caps to at most three paragraphs', () => {
		const out = sanitiseModelBody('one\n\ntwo\n\nthree\n\nfour\n\nfive');
		expect(out.length).toBeLessThanOrEqual(3);
	});
});
