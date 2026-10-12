// What a slot's booking will ask the guest to pay, known BEFORE they type their
// details — so the booking widget can say "£80 deposit" on the options step instead
// of springing it on the card screen.
//
// The same inputs createBooking uses (settings, the slot's service period, the
// deposit rules, and whether a card can actually be collected), so the figure shown
// is the figure charged. createBooking remains the authority: this is display only.

import { fromZonedTime } from 'date-fns-tz';
import type { BrandId, ServicePeriod } from '../db/types.js';
import { getActivePeriods, getDepositRules, getSettings } from './queries.js';
import { paymentRequirementFor, type PaymentRequirement } from './policy.js';
import { requirementIfCollectable } from './payments.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The service period whose day and booking window contain `date` `time` — the same
 * test createBooking applies (start inside [start_time, last_booking_time]).
 */
export function periodForSlot(
	periods: ServicePeriod[],
	date: string,
	time: string,
	timezone: string
): ServicePeriod | undefined {
	const startsAt = fromZonedTime(`${date}T${time}:00`, timezone);
	const dow = DOW.indexOf(
		new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(startsAt)
	);
	const startMs = startsAt.getTime();
	return periods.find((p) => {
		if (!p.days_of_week?.includes(dow)) return false;
		const openMs = fromZonedTime(`${date}T${p.start_time}:00`, timezone).getTime();
		const lastMs = fromZonedTime(`${date}T${p.last_booking_time}:00`, timezone).getTime();
		return startMs >= openMs && startMs <= lastMs;
	});
}

/** What the deposit rules will take for this slot and party, as createBooking would. */
export async function slotRequirement(
	brand: BrandId,
	restaurantId: string,
	date: string,
	time: string,
	startsAt: Date,
	timezone: string,
	partySize: number
): Promise<PaymentRequirement> {
	const [settings, periods, rules] = await Promise.all([
		getSettings(restaurantId),
		getActivePeriods(restaurantId),
		getDepositRules(restaurantId)
	]);
	const period = periodForSlot(periods, date, time, timezone);
	const base = paymentRequirementFor(partySize, startsAt, timezone, settings, rules, period?.id);
	return requirementIfCollectable(base, brand);
}
