// A guest's name on an ONLINE booking must carry a surname.
//
// The owner, Sept 2026: "multiple times we have a table for 5 different 'Paul'" —
// a first name alone doesn't tell the host which Paul is at the door. The booking
// forms ask for First name + Surname in two boxes and join them into the one name
// the diary, emails and search already use; the server re-checks the joined name
// so an old copy of a form (or a direct POST) can't slip a lone "Paul" through.
//
// Shared by the guest forms and the API routes, so it stays free of server code.

export const SURNAME_REQUIRED = 'Please enter your first name and surname.';

// Chinese, Japanese and Korean surnames are routinely ONE character (李, 王, 김) —
// one of those is a whole surname, not an initial.
const CJK = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LETTER = /\p{L}/gu;

/**
 * True when `name` is at least two words and the last one is a real surname: two
 * or more letters (or a CJK character), so "Paul S." or "Paul ." don't count.
 */
export function hasSurname(name: string): boolean {
	const words = name.trim().split(/\s+/);
	if (words.length < 2) return false;
	const surname = words[words.length - 1];
	return CJK.test(surname) || (surname.match(LETTER)?.length ?? 0) >= 2;
}

/** Join the First name / Surname boxes into the single stored name. */
export function joinGuestName(first: string, last: string): string {
	return `${first} ${last}`.trim().replace(/\s+/g, ' ');
}
