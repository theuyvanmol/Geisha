// Post-visit feedback email — the PURE rules (no PocketBase, no clock but `now`).
//
// ResDiary parity: the morning after a visit, a guest who booked online is asked
// to score it 0–5. Everything that decides WHO is asked, WHAT counts as an
// answer, and who is offered a Google review lives here so it is unit-tested
// without a database. The I/O is in config.ts, store.ts and the cron route.
//
// Staff are deliberately NOT emailed about low scores (the owner's call, 16 Sep
// 2026): they read them in Reports → Feedback.

/** Token scope for the /feedback/[token] link (see signScopedToken). */
export const FEEDBACK_SCOPE = 'feedback';

/** geisha_messages template for the request email — the send log and dedupe key. */
export const FEEDBACK_TEMPLATE = 'feedback_request';

/** geisha_settings key (json) holding a brand's {@link GuestFeedbackConfig}. */
export const GUEST_FEEDBACK_KEY = 'guest_feedback';

/** A score at or below this counts as "low" in the report. */
export const LOW_SCORE_MAX = 2;

/** A score at or above this is offered the Google review button. */
export const HAPPY_SCORE_MIN = 4;

/** How long the emailed link keeps working. */
export const LINK_TTL_DAYS = 30;

/** The oldest visit a run will still ask about — lets one missed run catch up. */
export const LOOKBACK_HOURS = 48;

export const COMMENT_MAX = 2000;

const ATTENDED = new Set(['completed', 'seated']);

export type SkipReason =
	| 'not_online'
	| 'not_attended'
	| 'too_recent'
	| 'too_old'
	| 'no_email'
	| 'erased'
	| 'opted_out'
	| 'blocked';

/** PocketBase writes datetimes with a space; Date.parse wants the T. */
function parseInstant(iso: string): number {
	return Date.parse((iso || '').replace(' ', 'T'));
}

function londonDay(ms: number, timezone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(ms));
}

/**
 * Should this booking's guest be sent the feedback email on a run at `now`?
 *
 * - Booked ONLINE (`source === 'online'`, which only the public booking API writes).
 * - Actually came: `completed`, or still `seated` — nothing auto-finishes a table
 *   staff forgot to clear, and those guests ate too.
 * - The visit was on an EARLIER London day than today (so a morning run asks about
 *   last night, never about lunch still in progress) and no more than
 *   {@link LOOKBACK_HOURS} ago (one missed run catches up; stale visits don't).
 * - The guest has an email, isn't erased, blocked, or opted out.
 *
 * "Already sent" is not decided here — that needs the message log (the cron).
 */
export function feedbackEligibility(
	booking: { source?: string; status: string; starts_at: string },
	customer:
		| { email?: string; deleted_at?: string; feedback_opt_out?: boolean }
		| null
		| undefined,
	now: Date,
	opts: { blocked?: boolean; timezone?: string } = {}
): { ok: true } | { ok: false; reason: SkipReason } {
	const tz = opts.timezone || 'Europe/London';
	if (booking.source !== 'online') return { ok: false, reason: 'not_online' };
	if (!ATTENDED.has(booking.status)) return { ok: false, reason: 'not_attended' };

	const starts = parseInstant(booking.starts_at);
	if (!Number.isFinite(starts) || starts < now.getTime() - LOOKBACK_HOURS * 3_600_000) {
		return { ok: false, reason: 'too_old' };
	}
	if (londonDay(starts, tz) >= londonDay(now.getTime(), tz)) {
		return { ok: false, reason: 'too_recent' };
	}

	if (!customer?.email?.trim()) return { ok: false, reason: 'no_email' };
	if (customer.deleted_at) return { ok: false, reason: 'erased' };
	if (customer.feedback_opt_out) return { ok: false, reason: 'opted_out' };
	if (opts.blocked) return { ok: false, reason: 'blocked' };
	return { ok: true };
}

/** A submitted score, or null. Whole numbers 0..5 only — and 0 is a real answer. */
export function parseScore(raw: unknown): number | null {
	if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 && raw <= 5 ? raw : null;
	if (typeof raw !== 'string' || !/^[0-5]$/.test(raw.trim())) return null;
	return Number(raw.trim());
}

export function cleanComment(raw: unknown): string {
	return typeof raw === 'string' ? raw.trim().slice(0, COMMENT_MAX) : '';
}

/** Show the "Leave us a Google review" button after this answer? */
export function offersGoogleReview(score: number, googleReviewUrl: string): boolean {
	return score >= HAPPY_SCORE_MIN && Boolean(googleReviewUrl);
}

// --- per-brand settings -------------------------------------------------------

export interface GuestFeedbackConfig {
	/** Send the email at all. On unless someone turns it off. */
	enabled: boolean;
	/** The restaurant's Google "write a review" link. '' = no button. */
	googleReviewUrl: string;
	/** Email last week's scores to the owners every Monday (weekly.ts). On by default. */
	weeklySummary: boolean;
	/**
	 * Who gets the weekly summary. Empty = every active owner and manager account
	 * for this restaurant — the people who can already read Reports → Feedback.
	 */
	weeklyRecipients: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a typed recipient list (commas, semicolons, spaces or new lines). */
export function parseRecipients(raw: unknown): string[] {
	const list = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[,;\s]+/);
	return [...new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/** Settings-form check for the recipients box. Null when fine. Blank is allowed. */
export function recipientsError(raw: string): string | null {
	const bad = parseRecipients(raw).filter((e) => !EMAIL_RE.test(e));
	return bad.length ? `Not an email address: ${bad.join(', ')}` : null;
}

/** Settings-form check. Null when fine. Blank is allowed (no button). */
export function googleReviewUrlError(value: string): string | null {
	const v = value.trim();
	if (!v) return null;
	try {
		if (new URL(v).protocol === 'https:') return null;
	} catch {
		// fall through
	}
	return 'Paste the full Google review link, starting with https://';
}

/**
 * Whatever is stored, read it back as a safe, complete config. Unknown keys are
 * dropped — including `alertEmail` on rows saved while staff alerts existed.
 */
export function normaliseGuestFeedbackConfig(raw: unknown): GuestFeedbackConfig {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const googleReviewUrl = typeof r.googleReviewUrl === 'string' ? r.googleReviewUrl.trim() : '';
	return {
		enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
		googleReviewUrl: googleReviewUrl && !googleReviewUrlError(googleReviewUrl) ? googleReviewUrl : '',
		weeklySummary: typeof r.weeklySummary === 'boolean' ? r.weeklySummary : true,
		weeklyRecipients: parseRecipients(r.weeklyRecipients).filter((e) => EMAIL_RE.test(e))
	};
}
