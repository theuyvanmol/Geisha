// Booking promotions / T&C messages (ResDiary "Promotions"). These are the
// deposit + terms notices tied to a booking type, shown to staff on the diary
// so they can quote the exact policy when a guest asks. Each has a validity
// window and the days of the week it applies to. Edit here to change the
// wording — no markup edits.

export type BookingPromotion = {
	id: string;
	/** short label shown in bold, e.g. "Standard Booking" */
	title: string;
	/** the full T&C / deposit wording (optional for a bare label row) */
	message?: string;
	/** ISO-ish display range, e.g. "03/11/2023 – 02/11/2030" */
	validFrom: string;
	validTo: string;
	/** days it applies to; empty array = every day */
	days: number[]; // 0=Sun … 6=Sat
	/** optional time window within the day, e.g. "12:00–20:00" */
	timeWindow?: string;
};

// 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** "(Su, Mo, Tu, We, Th)" or "(All Days)" for the VALID column. */
export function daysLabel(days: number[]): string {
	if (!days.length || days.length === 7) return 'All Days';
	return days.map((d) => DAY_ABBR[d]).join(', ');
}

/** Look a promotion up by id — used server-side to attach a deposit rule's
 *  T&C wording to the booking + the guest payment prompt. Blank/unknown → undefined. */
export function getPromotion(id: string | undefined | null): BookingPromotion | undefined {
	if (!id) return undefined;
	return PROMOTIONS.find((p) => p.id === id);
}

// TRANSCRIBED FROM THE LIVE RESDIARY PROMOTIONS TABLE (owner screenshot, Aug 2026).
// These four rows are what the restaurant's current system actually holds, days
// and time windows included. Earlier values here were guesses and were wrong in
// two ways that mattered: Bottomless Brunch was listed as Sun–Thu 12:00–20:00
// when it in fact runs Fri & Sat 12:00–15:00, and the £5pp weekend card rule had
// no promotion row at all.
//
// The 12-HOUR window below is now what the engine enforces too (owner, Aug 2026):
// policy.ts LATE_CANCELLATION_HOURS = 12. It previously used EIGHT, so a guest
// cancelling 10 hours out was told they forfeited and was in fact refunded.
//
// The old WordPress page still says "8 hours" in its own terms copy. That text has
// to change to 12 as part of the changeover, or it contradicts the terms the guest
// agrees to in the widget. See CHANGEOVER_TRIAL.md.
export const PROMOTIONS: BookingPromotion[] = [
	{
		id: 'standard',
		title: 'Standard Booking',
		// Covers BOTH money rules that can attach to a standard booking, because
		// this is the text sitting above the "I've read and accept these terms"
		// checkbox and a guest can only meaningfully accept what it mentions. It
		// used to describe the 6+ deposit only, so a Friday table for four ticked
		// the box against terms that said nothing about the £5-per-head card
		// guarantee they were asked for on the very next screen.
		//
		// The weekend clause deliberately does not restate a party-size band: the
		// bands live in geisha_deposit_rules and managers edit them in
		// /admin/settings/deposits, so pinning numbers here is how the two drift.
		// The exact amount is always shown in full on the payment step before the
		// guest commits to anything.
		message:
			'Ts&Cs: Bookings for 6 or more people require a deposit of £10 per head, fully redeemable against your final bill. Friday and Saturday bookings may require card details to hold the table, charged at £5 per head only in the event of a no show or late cancellation. Whatever applies to your booking is shown in full before you pay. Deposits are not refundable, and card fees are charged, in case of no show or late cancellation (under 12 hours notice).',
		validFrom: '03/11/2023',
		validTo: '02/11/2030',
		days: []
	},
	{
		// The £5pp weekend card guarantee. POLICY, not a guest choice — ResDiary
		// attaches it automatically to a qualifying booking, and it is deliberately
		// absent from the selectable options in bookingOptions.ts.
		id: 'weekend',
		title: 'Weekend Bookings',
		message:
			'Ts&Cs: All weekend bookings between 3 and 5 people require card details to be made - the restaurant will charge the card holder £5 per person in case of no show or late cancellation (under 12 hours notice).',
		validFrom: '15/05/2023',
		validTo: '19/05/2030',
		days: [5, 6]
	},
	{
		// A second, wording-less "Weekend Bookings" row sits in their ResDiary. Kept
		// so the admin promotions table matches what staff see in ResDiary; it
		// carries no message and drives nothing.
		id: 'weekend-legacy',
		title: 'Weekend Bookings',
		validFrom: '03/11/2023',
		validTo: '03/11/2030',
		days: [5, 6]
	},
	{
		id: 'bottomless-brunch',
		title: 'x Bottomless Brunch x',
		message:
			'Ts&Cs: All bookings for Bottomless Brunch require a minimum of 48 hours notice. A deposit of £10 per head is mandatory, said deposit is fully redeemable against the final bill. Deposits are not refundable in case of no show or late cancellation (under 12 hours notice). -Please refer to our website for full Terms & Conditions-',
		validFrom: '03/11/2023',
		validTo: '03/11/2030',
		days: [5, 6],
		timeWindow: '12:00–15:00'
	}
];
