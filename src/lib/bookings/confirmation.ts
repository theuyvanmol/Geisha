// Formatting for the values ResDiary hands back on its post-booking redirect:
//
//   ?bookingReference=B26AMTW9&date=2026-08-04T00:00:00&time=12:00:00&partySize=1
//
// Pure and separate from the component so the parsing can be tested directly —
// this is date handling, which has already bitten this project once (the booking
// form briefly offered *yesterday* because a UTC read named the wrong day).
//
// Everything here is untrusted query-string input a guest could edit by hand, so
// each function returns '' rather than throwing or guessing on anything it
// doesn't recognise. The caller drops the row instead of printing "Invalid Date".

const MONTHS = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Days in a given month, accounting for leap years. */
function daysInMonth(year: number, month1: number): number {
	return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * "2026-08-04T00:00:00" → "Tuesday 4 August 2026".
 *
 * Matches the leading date fields off the string rather than constructing a Date
 * from the whole value: the timestamp carries no timezone, so round-tripping it
 * through a Date risks shifting across midnight and naming the wrong day.
 * Date.UTC appears only to derive the weekday, where an offset can't reach it.
 */
export function formatBookingDate(raw: string | null | undefined): string {
	const m = raw?.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return '';

	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);

	if (month < 1 || month > 12) return '';
	if (day < 1 || day > daysInMonth(year, month)) return '';

	const weekday = DAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
	return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`;
}

/** "12:00:00" → "12:00pm". Midnight reads as 12:00am, noon as 12:00pm. */
export function formatBookingTime(raw: string | null | undefined): string {
	const m = raw?.trim().match(/^(\d{1,2}):(\d{2})/);
	if (!m) return '';

	const hours = Number(m[1]);
	const minutes = Number(m[2]);
	if (hours > 23 || minutes > 59) return '';

	const suffix = hours < 12 ? 'am' : 'pm';
	const hour12 = hours % 12 === 0 ? 12 : hours % 12;
	return `${hour12}:${m[2]}${suffix}`;
}
