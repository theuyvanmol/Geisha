// Sending the weekly guest-feedback summary (the I/O half of weekly.ts).
//
// IDEMPOTENT: once a restaurant's summary for a week has gone to at least one
// recipient, `feedback_weekly_sent` records that week and a re-run (a repeated
// cron delivery, a manual call) sends nothing. `force` overrides it, for a resend.
// A run where every send failed records nothing, so the next call retries.

import { pb } from '../db/pb.js';
import { getRestaurant } from '../booking/queries.js';
import { getSettingValue, setSettingByKey } from '../booking/admin.js';
import { acquireLock, releaseLock, type LockHandle } from '../db/lock.js';
import { send } from '../email/send.js';
import { brandSender } from '../email/confirmations.js';
import { siteOrigin } from '../util/siteUrl.js';
import { getBrand } from '../../data/brand.js';
import type { BrandId, Restaurant, Staff } from '../db/types.js';
import { getGuestFeedbackConfigForSend } from './config.js';
import { getGuestScoresReport, type GuestScoresReport } from './report.js';
import {
	WEEKLY_SENT_KEY,
	addDays,
	previousWeek,
	renderWeeklySummary,
	staffRecipients,
	weekOf,
	type Week,
	type WeekScores
} from './weekly.js';

const LOCK_TTL_MS = 5 * 60_000;

/** Active owners and managers who can see this brand's restaurant. */
export async function loadStaffRecipients(brand: BrandId): Promise<string[]> {
	const restaurant = await getRestaurant(brand);
	const c = await pb();
	const staff = await c.collection('geisha_staff').getFullList<Staff>({
		filter: `active=true && (role="owner" || role="manager")`,
		fields: 'email,role,active,restaurants'
	});
	return staffRecipients(staff, restaurant.id);
}

function toWeekScores(r: GuestScoresReport): WeekScores {
	return {
		replies: r.replies,
		sent: r.sent,
		average: r.summary.totals.average,
		counts: [...r.summary.totals.counts],
		rows: r.rows.map((x) => ({
			guest: x.guest,
			visitDate: x.visitDate,
			partySize: x.partySize,
			score: x.score,
			comment: x.comment
		}))
	};
}

export interface WeeklySendResult {
	week: Week;
	/** False when the restaurant has the weekly summary switched off. */
	enabled: boolean;
	replies: number;
	recipients: number;
	/** Recipients the email actually went to (or, on a dry run, would). */
	sent: number;
	subject?: string;
	/** Why nothing was sent, when nothing was. */
	skipped?: string;
	/** Dry runs with `preview` only: the rendered HTML. */
	html?: string;
}

/** Mask an address for the JSON response: j***@example.com. */
const mask = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');

export async function sendWeeklySummary(
	brand: BrandId,
	now: Date,
	opts: { dry?: boolean; force?: boolean; week?: string; preview?: boolean } = {}
): Promise<WeeklySendResult & { to?: string[] }> {
	const restaurant: Restaurant = await getRestaurant(brand);
	const tz = restaurant.timezone || 'Europe/London';
	const week =
		opts.week && /^\d{4}-\d{2}-\d{2}$/.test(opts.week) ? weekOf(opts.week) : previousWeek(now, tz);
	const base: WeeklySendResult = { week, enabled: true, replies: 0, recipients: 0, sent: 0 };

	// Throws on a database error rather than reading "off" as the default "on".
	const config = await getGuestFeedbackConfigForSend(restaurant.id);
	if (!config.weeklySummary) return { ...base, enabled: false, skipped: 'switched off in Settings' };

	const to = config.weeklyRecipients.length
		? config.weeklyRecipients
		: await loadStaffRecipients(brand);
	base.recipients = to.length;
	if (!to.length) return { ...base, skipped: 'no recipients (no active owner or manager)' };

	const already = async () =>
		(await getSettingValue<{ week?: string }>(brand, WEEKLY_SENT_KEY).catch(() => undefined))?.week ===
		week.from;
	if (!opts.force && !opts.dry && (await already())) {
		return { ...base, skipped: 'already sent for this week' };
	}

	const before = { from: addDays(week.from, -7), to: addDays(week.from, -1) };
	const [current, prior] = await Promise.all([
		getGuestScoresReport(brand, week.from, week.to),
		getGuestScoresReport(brand, before.from, before.to).catch(() => null)
	]);
	const scores = toWeekScores(current);
	base.replies = scores.replies;

	const origin = siteOrigin().replace(/\/$/, '');
	const { subject, html, text } = renderWeeklySummary({
		brandId: brand,
		restaurantName: restaurant.display_name || getBrand(brand).name,
		week,
		scores,
		prior: prior ? toWeekScores(prior) : null,
		reportUrl: `${origin}/admin/reports?brand=${brand}&tab=feedback&from=${week.from}&to=${week.to}`,
		settingsUrl: `${origin}/admin/settings?brand=${brand}`
	});

	if (opts.dry) {
		return {
			...base,
			sent: to.length,
			subject,
			to: to.map(mask),
			...(opts.preview ? { html } : {})
		};
	}

	// Two overlapping runs would both read "not sent" and email everyone twice.
	let lock: LockHandle;
	try {
		lock = await acquireLock(`feedback-weekly:${restaurant.id}`, LOCK_TTL_MS, 1_000);
	} catch {
		return { ...base, subject, skipped: 'another run is already sending' };
	}
	try {
		if (!opts.force && (await already())) {
			return { ...base, subject, skipped: 'already sent for this week' };
		}
		const { from, replyTo } = await brandSender(brand);
		let sent = 0;
		for (const addr of to) {
			const res = await send({
				to: addr,
				subject,
				html,
				text,
				from,
				replyTo,
				tags: ['feedback_weekly', brand]
			});
			if (res.sent) sent++;
		}
		if (sent > 0) {
			await setSettingByKey(
				brand,
				WEEKLY_SENT_KEY,
				{ week: week.from, sentAt: now.toISOString(), sent },
				'system'
			);
		}
		return { ...base, subject, sent, ...(sent ? {} : { skipped: 'every send failed' }) };
	} finally {
		await releaseLock(lock);
	}
}
