// Reports → Feedback → Guest scores. Everything is keyed on the VISIT date (the
// booking's start, London time), so "last week" means scores for last week's
// meals, however late the guest got round to answering.

import { pb } from '../db/pb.js';
import { getRestaurant, toPbDateFilter } from '../booking/queries.js';
import { assertReportRange, localDate } from '../booking/reporting.js';
import { bookingReference } from '$lib/bookings/reference';
import type { Booking, BrandId, Customer, GuestFeedback, Message } from '../db/types.js';
import { FEEDBACK_TEMPLATE, LOW_SCORE_MAX } from './rules.js';
import { summariseScoresByDay, type ScoreSummary } from './summary.js';

const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

export interface GuestScoreRow {
	id: string;
	bookingId: string;
	/** London 'YYYY-MM-DD' of the visit. */
	visitDate: string;
	visitAt: string;
	guest: string;
	phone: string;
	email: string;
	partySize: number;
	reference: string;
	score: number;
	comment: string;
	submittedAt: string;
}

export interface GuestScoresReport {
	summary: ScoreSummary;
	/** Newest visit first. */
	rows: GuestScoreRow[];
	/** Feedback emails that went out for visits in the range. */
	sent: number;
	replies: number;
	/** replies / sent, 0..1 (0 when nothing was sent). */
	replyRate: number;
	lowScores: number;
}

type FeedbackWithBooking = GuestFeedback & {
	expand?: { booking?: Booking & { expand?: { customer?: Customer } } };
};
type MessageWithBooking = Message & { expand?: { booking?: Pick<Booking, 'starts_at'> } };

export async function getGuestScoresReport(
	brand: BrandId,
	from: string,
	to: string
): Promise<GuestScoresReport> {
	assertReportRange(from, to);
	const restaurant = await getRestaurant(brand);
	const tz = restaurant.timezone || 'Europe/London';
	const c = await pb();

	// A day's slack either side of the UTC window, then trimmed to the exact
	// London dates — the same approach as fetchReportBookings.
	const lo = toPbDateFilter(new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString());
	const hi = toPbDateFilter(new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString());
	const inRange = (iso: string | undefined) => {
		const t = Date.parse((iso || '').replace(' ', 'T'));
		if (!Number.isFinite(t)) return false;
		const d = localDate(new Date(t), tz);
		return d >= from && d <= to;
	};

	const [feedback, messages] = await Promise.all([
		c.collection('geisha_feedback').getFullList<FeedbackWithBooking>({
			filter: `restaurant=${q(restaurant.id)} && visit_at>=${q(lo)} && visit_at<${q(hi)}`,
			expand: 'booking.customer',
			sort: '-visit_at'
		}),
		c.collection('geisha_messages').getFullList<MessageWithBooking>({
			filter:
				`template=${q(FEEDBACK_TEMPLATE)} && status="sent" && booking.restaurant=${q(restaurant.id)} && ` +
				`booking.starts_at>=${q(lo)} && booking.starts_at<${q(hi)}`,
			expand: 'booking',
			fields: 'id,booking,expand.booking.starts_at'
		})
	]);

	const replies = feedback.filter((f) => inRange(f.visit_at));
	// One email per booking is the rule, but count bookings, not rows, in case a
	// retry ever logged twice.
	const sentBookings = new Set(
		messages.filter((m) => inRange(m.expand?.booking?.starts_at)).map((m) => m.booking)
	);

	const rows: GuestScoreRow[] = replies.map((f) => {
		const b = f.expand?.booking;
		const cu = b?.expand?.customer;
		return {
			id: f.id,
			bookingId: f.booking,
			visitDate: localDate(new Date(Date.parse(f.visit_at.replace(' ', 'T'))), tz),
			visitAt: f.visit_at,
			guest: b?.guest_name?.trim() || cu?.name?.trim() || '',
			phone: b?.guest_phone || cu?.phone || '',
			email: cu?.email || '',
			partySize: b?.party_size ?? 0,
			reference: bookingReference(f.booking),
			score: f.score,
			comment: f.comment || '',
			submittedAt: f.submitted_at || f.updated
		};
	});

	const sent = sentBookings.size;
	return {
		summary: summariseScoresByDay(replies, tz),
		rows,
		sent,
		replies: replies.length,
		replyRate: sent > 0 ? Math.min(1, replies.length / sent) : 0,
		lowScores: replies.filter((f) => f.score <= LOW_SCORE_MAX).length
	};
}
