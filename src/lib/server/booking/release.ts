// Unpaid-hold sweep (§S1-4). A `pending_payment` booking is a hold on a table while
// the guest finishes the card step online; one whose card step was abandoned is
// expired (cancelled, no email, hold released) once it's older than
// `unpaid_hold_minutes`, so it stops blocking the table.
//
// It used to do a second job too — the GEISHA_WEBSITE_SPEC.md §6 "20-minute rule",
// marking every confirmed booking still unseated `release_after_minutes` past its
// start as a no-show. Removed at the owner's request (2026-09-19), for ResDiary
// parity: ResDiary never no-shows a booking by itself — a no-show is a cancellation
// reason a host chooses. The auto no-show pinned a late party the host was about to
// move (a no-show can't be dragged), and staff then cancelled those rows by hand to
// clear them, so real no-shows were being recorded as late cancellations. A late
// booking now stays on the diary, painted red (isLateNow), until a host seats it,
// moves it or marks it a no-show.
//
// Run periodically by a cron hitting POST /api/cron/release (see that route).
// The decision logic is split out as a pure function for unit testing.

import { pb } from '../db/pb.js';
import type { Booking } from '../db/types.js';
import { getSettings, toPbDateFilter } from './queries.js';
import { expireUnpaidHold } from './mutate.js';
import { getRestaurant } from './queries.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/**
 * How far back (by start time) the sweep looks for an abandoned hold. The auto no-show
 * used to clear an unpaid hold whose start had passed; with that gone, the expiry covers
 * it instead — but only for a sitting that started recently, so the first run can't
 * reach back and cancel an old row nobody has looked at in months.
 */
const RECENT_START_MS = 24 * 60 * 60 * 1000;

/**
 * Pure predicate (§S1-4): should this booking be expired as an abandoned unpaid hold
 * as of `now`? Only a `pending_payment` booking whose card step was created more than
 * `holdMinutes` ago qualifies — before its start or after it. (After it used to be left
 * to the auto no-show; an unpaid hold was never a real booking, so it is expired, not
 * no-showed.)
 */
export function shouldExpireUnpaid(
	booking: Pick<Booking, 'status' | 'created'>,
	now: Date,
	holdMinutes: number
): boolean {
	if (booking.status !== 'pending_payment') return false;
	const cutoff = new Date(booking.created).getTime() + holdMinutes * 60 * 1000;
	return now.getTime() > cutoff;
}

export interface ReleaseResult {
	checked: number;
	expired: string[];
}

/** Sweep one brand: expire its abandoned unpaid holds. Returns the ids expired. */
export async function runReleaseSweep(
	brand: 'asia' | 'fusion',
	now = new Date()
): Promise<ReleaseResult> {
	const restaurant = await getRestaurant(brand);
	const settings = await getSettings(restaurant.id);
	const hold = settings.unpaid_hold_minutes;

	const c = await pb();
	// pending_payment holds created more than `hold` minutes ago, for a sitting that
	// hasn't started yet or started within RECENT_START_MS. Both bounds are computed in
	// JS and normalised to PB filter bounds.
	const expired: string[] = [];
	const cutoffFilter = toPbDateFilter(new Date(now.getTime() - hold * 60 * 1000).toISOString());
	const recentFilter = toPbDateFilter(new Date(now.getTime() - RECENT_START_MS).toISOString());
	const unpaid = await c.collection('geisha_bookings').getFullList<Booking>({
		filter:
			`restaurant=${q(restaurant.id)} && status=${q('pending_payment')} && ` +
			`starts_at>=${q(recentFilter)} && created<=${q(cutoffFilter)}`
	});
	for (const b of unpaid) {
		if (shouldExpireUnpaid(b, now, hold)) {
			// TOCTOU re-read happens inside expireUnpaidHold; it no-ops if the
			// webhook confirmed the booking the instant before we got here.
			const after = await expireUnpaidHold(b.id, 'system');
			if (after.status === 'cancelled') expired.push(b.id);
		}
	}

	return { checked: unpaid.length, expired };
}

/** Sweep both brands. */
export async function runReleaseSweepAll(now = new Date()): Promise<Record<string, ReleaseResult>> {
	const [asia, fusion] = await Promise.all([
		runReleaseSweep('asia', now),
		runReleaseSweep('fusion', now)
	]);
	return { asia, fusion };
}
