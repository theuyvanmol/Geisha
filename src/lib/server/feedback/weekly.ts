// The weekly guest-feedback summary — the PURE parts (no PocketBase, no clock but
// `now`): which week, who gets it, and what the email says. The I/O is in
// weeklySend.ts and the cron route /api/cron/feedback-weekly.
//
// The client asked (1 Oct 2026) for "an email at the end of the week about
// reviews for each restaurant, automatically". Every Monday morning, one email per
// restaurant covering the Monday–Sunday just gone: the average score against the
// week before, how many guests replied, and every comment, lowest score first.
//
// This is NOT the per-reply staff alert the owner turned down on 16 Sep 2026 (see
// rules.ts). Nobody hears about a single bad score as it happens; the owners get
// one round-up a week, to the people who can already read Reports → Feedback.

import { renderEmail, type EmailBlock } from '../email/layout.js';
import type { BrandId, Staff } from '../db/types.js';

/** geisha_settings key holding `{ week, sentAt, sent }` — the "already sent" record. */
export const WEEKLY_SENT_KEY = 'feedback_weekly_sent';

/** More comments than this and the email points at the report for the rest. */
export const MAX_COMMENTS = 40;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Week {
	/** Monday, London 'YYYY-MM-DD'. */
	from: string;
	/** Sunday, London 'YYYY-MM-DD'. */
	to: string;
}

function localDate(instant: Date, timezone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(instant);
}

export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** The Monday–Sunday week containing `date` ('YYYY-MM-DD'). */
export function weekOf(date: string): Week {
	const mondayOffset = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
	const from = addDays(date, -mondayOffset);
	return { from, to: addDays(from, 6) };
}

/** The full Monday–Sunday week BEFORE the one `now` falls in, in London time. */
export function previousWeek(now: Date, timezone = 'Europe/London'): Week {
	return weekOf(addDays(weekOf(localDate(now, timezone)).from, -7));
}

/**
 * Default recipients: every ACTIVE owner or manager who can see this restaurant —
 * an account with no restaurants listed sees them all. Lower-cased and de-duped.
 */
export function staffRecipients(
	staff: Array<Pick<Staff, 'email' | 'role' | 'active' | 'restaurants'>>,
	restaurantId: string
): string[] {
	const out = staff
		.filter((s) => s.active !== false && (s.role === 'owner' || s.role === 'manager'))
		.filter((s) => !s.restaurants?.length || s.restaurants.includes(restaurantId))
		.map((s) => (s.email || '').trim().toLowerCase())
		.filter((e) => EMAIL_RE.test(e));
	return [...new Set(out)];
}

/** One guest's answer, as the report rows carry it. */
export interface WeeklyReply {
	guest: string;
	/** London 'YYYY-MM-DD' of the visit. */
	visitDate: string;
	partySize: number;
	score: number;
	comment: string;
}

/** What one week looks like — a slice of GuestScoresReport. */
export interface WeekScores {
	replies: number;
	/** Feedback emails that went out for visits in the week. */
	sent: number;
	/** Mean score, 0 when nobody replied. */
	average: number;
	/** score -> number of replies (index 0..5). */
	counts: number[];
	rows: WeeklyReply[];
}

export interface WeeklySummaryInput {
	brandId: BrandId;
	restaurantName: string;
	week: Week;
	scores: WeekScores;
	/** The week before, for the comparison. Null when it couldn't be read. */
	prior: WeekScores | null;
	reportUrl: string;
	settingsUrl: string;
}

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

// Spelled out rather than Intl: ICU versions disagree on en-GB ("Sep" vs "Sept"),
// so the same email would read differently on the PC and on Vercel.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parts(date: string) {
	const d = new Date(`${date}T12:00:00Z`);
	return { day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()], weekday: DAYS[d.getUTCDay()] };
}
/** "24 Sep" */
const shortDay = (date: string) => `${parts(date).day} ${parts(date).month.slice(0, 3)}`;
/** "Thu 24 Sep" */
const shortWeekday = (date: string) => `${parts(date).weekday.slice(0, 3)} ${shortDay(date)}`;
/** "Thursday 24 September" */
const longDay = (date: string) => {
	const p = parts(date);
	return `${p.weekday} ${p.day} ${p.month}`;
};

/** "22–28 Sep" or "29 Sep – 5 Oct". */
export function weekLabel(week: Week): string {
	return week.from.slice(0, 7) === week.to.slice(0, 7)
		? `${parts(week.from).day}–${shortDay(week.to)}`
		: `${shortDay(week.from)} – ${shortDay(week.to)}`;
}

/** "4.3 out of 5, up from 4.1 the week before". */
export function averageLine(scores: WeekScores, prior: WeekScores | null): string {
	const now = `${one(scores.average)} out of 5`;
	if (!prior || prior.replies === 0) return `${now} (no replies the week before)`;
	const diff = Math.round((scores.average - prior.average) * 10) / 10;
	if (diff === 0) return `${now}, the same as the week before`;
	return `${now}, ${diff > 0 ? 'up' : 'down'} from ${one(prior.average)} the week before`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Lowest score first, then the earliest visit, so problems read first. */
export function commentsWorstFirst(rows: WeeklyReply[]): WeeklyReply[] {
	return rows
		.filter((r) => r.comment.trim())
		.sort((a, b) => a.score - b.score || a.visitDate.localeCompare(b.visitDate));
}

export function renderWeeklySummary(input: WeeklySummaryInput): {
	subject: string;
	html: string;
	text: string;
} {
	const { scores, prior, week, restaurantName } = input;
	const label = weekLabel(week);
	const blocks: EmailBlock[] = [];

	const longFrom = longDay(week.from);
	const longTo = longDay(week.to);

	let subject: string;
	let preheader: string;

	if (scores.replies === 0) {
		subject = `${restaurantName}: no guest feedback for ${label}`;
		preheader = `No guests replied for visits between ${longFrom} and ${longTo}.`;
		blocks.push(
			{
				type: 'text',
				text: `No guests replied to the "How was your visit?" email for visits to ${restaurantName} between ${longFrom} and ${longTo}.`
			},
			{
				type: 'note',
				text:
					scores.sent > 0
						? `${plural(scores.sent, 'feedback email')} went out for those visits.`
						: 'No feedback emails went out for those visits. Only guests who book online are asked.'
			}
		);
	} else {
		const avg = one(scores.average);
		subject = `${restaurantName}: ${avg} out of 5 from ${plural(scores.replies, 'guest')}, ${label}`;
		preheader = `${averageLine(scores, prior)}. ${plural(scores.replies, 'guest')} replied.`;

		const c = scores.counts;
		const happy = (c[4] ?? 0) + (c[5] ?? 0);
		const middling = c[3] ?? 0;
		const unhappy = (c[0] ?? 0) + (c[1] ?? 0) + (c[2] ?? 0);
		const rate = scores.sent > 0 ? Math.round((Math.min(scores.replies, scores.sent) / scores.sent) * 100) : 0;

		blocks.push(
			{
				type: 'text',
				text: `Here's how guests who booked online scored their visits to ${restaurantName} between ${longFrom} and ${longTo}.`
			},
			{
				type: 'details',
				rows: [
					['Average score', averageLine(scores, prior)],
					[
						'Replies',
						scores.sent > 0
							? `${scores.replies} of ${plural(scores.sent, 'guest')} asked (${rate}%)`
							: String(scores.replies)
					],
					['Scored 4 or 5', String(happy)],
					['Scored 3', String(middling)],
					['Scored 0 to 2', String(unhappy)]
				]
			}
		);

		const comments = commentsWorstFirst(scores.rows);
		if (comments.length) {
			blocks.push({ type: 'divider' }, { type: 'text', text: 'What guests said, lowest scores first:' });
			for (const r of comments.slice(0, MAX_COMMENTS)) {
				const who = [
					r.guest || 'A guest',
					shortWeekday(r.visitDate),
					r.partySize ? `party of ${r.partySize}` : ''
				]
					.filter(Boolean)
					.join(', ');
				blocks.push({ type: 'panel', title: `${r.score}/5 from ${who}`, text: r.comment.trim() });
			}
			if (comments.length > MAX_COMMENTS) {
				blocks.push({
					type: 'note',
					text: `${plural(comments.length - MAX_COMMENTS, 'more comment')} in the report.`
				});
			}
		}
		const silent = scores.replies - comments.length;
		if (silent > 0) {
			blocks.push({
				type: 'note',
				text: `${plural(silent, 'more guest')} scored the visit without leaving a comment.`
			});
		}
	}

	blocks.push({ type: 'button', label: 'Open the feedback report', url: input.reportUrl });

	const { html, text } = renderEmail({
		brandId: input.brandId,
		heading: `Guest feedback for ${label}`,
		preheader,
		blocks,
		footer: {
			text: `You get this as an owner or manager of ${restaurantName}. Change who receives it, or turn it off, in`,
			linkLabel: 'Settings',
			linkUrl: input.settingsUrl
		}
	});
	return { subject, html, text };
}
