import { describe, it, expect } from 'vitest';
import { hasSurname, joinGuestName, SURNAME_REQUIRED } from './guestName.js';

describe('hasSurname', () => {
	it('accepts a first name and surname', () => {
		expect(hasSurname('Paul Smith')).toBe(true);
		expect(hasSurname('  Mary Ann   Lee ')).toBe(true);
		expect(hasSurname("Siobhan O'Neil")).toBe(true);
		expect(hasSurname('José Núñez')).toBe(true);
		expect(hasSurname('Paul Smith-Jones')).toBe(true);
		expect(hasSurname('Wei Li')).toBe(true);
	});

	it('refuses a first name on its own — the five-Pauls problem', () => {
		expect(hasSurname('Paul')).toBe(false);
		expect(hasSurname('  Paul  ')).toBe(false);
		expect(hasSurname('')).toBe(false);
	});

	it('refuses an initial or punctuation in place of a surname', () => {
		expect(hasSurname('Paul S')).toBe(false);
		expect(hasSurname('Paul S.')).toBe(false);
		expect(hasSurname('Paul .')).toBe(false);
		expect(hasSurname('Paul -')).toBe(false);
	});

	it('accepts a one-character Chinese, Japanese or Korean surname', () => {
		expect(hasSurname('小龙 李')).toBe(true);
		expect(hasSurname('Hana 王')).toBe(true);
		expect(hasSurname('민수 김')).toBe(true);
	});
});

describe('joinGuestName', () => {
	it('joins the two boxes into the one name the diary shows', () => {
		expect(joinGuestName('Paul', 'Smith')).toBe('Paul Smith');
	});

	it('trims each part and collapses stray spaces', () => {
		expect(joinGuestName('  Mary   Ann ', '  Lee ')).toBe('Mary Ann Lee');
	});

	it('an empty surname leaves just the first name (which the server then refuses)', () => {
		expect(joinGuestName('Paul', '   ')).toBe('Paul');
		expect(hasSurname(joinGuestName('Paul', '   '))).toBe(false);
	});
});

it('has a message a guest can act on', () => {
	expect(SURNAME_REQUIRED).toMatch(/surname/i);
});
