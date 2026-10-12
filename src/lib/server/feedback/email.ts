// The feedback REQUEST email — to a guest the morning after, "How was your visit?"
// with a row of 0–5 buttons. Logged to geisha_messages (template
// `feedback_request`), which is also what stops a second one going out. Rendered
// through email/layout.ts, so it has a text/plain part and the restaurant's own
// name and colours.
//
// There is deliberately no staff email about low scores (the owner's call,
// 16 Sep 2026) — they are read in Reports → Feedback.

import { sendAndLog } from '../email/send.js';
import { renderEmail, type EmailBlock } from '../email/layout.js';
import { brandSender, greetingName } from '../email/confirmations.js';
import { signScopedToken } from '../booking/selfservice.js';
import { siteOrigin } from '../util/siteUrl.js';
import type { Booking, BrandId, Customer, Restaurant } from '../db/types.js';
import { FEEDBACK_SCOPE, FEEDBACK_TEMPLATE, LINK_TTL_DAYS } from './rules.js';

const LONDON = 'Europe/London';

const fmtDay = (iso: string) =>
	new Date((iso || '').replace(' ', 'T')).toLocaleDateString('en-GB', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		timeZone: LONDON
	});

export interface FeedbackLinks {
	/** The page with nothing preselected (the text part's single link). */
	page: string;
	/** `scores[n]` opens the page with n preselected. */
	scores: string[];
	/** Opens the "stop feedback emails" confirm. */
	stop: string;
}

/** Signed links for one booking, valid {@link LINK_TTL_DAYS} from `now`. Null without a secret. */
export function feedbackLinks(bookingId: string, now: Date, origin = siteOrigin()): FeedbackLinks | null {
	const exp = Math.floor(now.getTime() / 1000) + LINK_TTL_DAYS * 86_400;
	const token = signScopedToken(FEEDBACK_SCOPE, bookingId, exp);
	if (!token) return null;
	const page = `${origin.replace(/\/$/, '')}/feedback/${token}`;
	return {
		page,
		scores: [0, 1, 2, 3, 4, 5].map((s) => `${page}?score=${s}`),
		stop: `${page}?stop=1`
	};
}

export function renderFeedbackRequest(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant,
	links: FeedbackLinks
): { subject: string; html: string; text: string } {
	const brand = restaurant.brand as BrandId;
	const blocks: EmailBlock[] = [
		{ type: 'text', text: `Hello ${greetingName(booking, customer)},` },
		{
			type: 'text',
			text: `Thank you for dining with us at ${restaurant.display_name} on ${fmtDay(booking.starts_at)}. We'd love to know how it went.`
		},
		{ type: 'text', text: 'How would you score your visit?' },
		{
			type: 'scores',
			urls: links.scores,
			lowLabel: '0 = poor',
			highLabel: '5 = excellent',
			textUrl: links.page
		},
		{
			type: 'note',
			text: 'Tap a number and you can add a comment before you send it. It only takes a moment.'
		}
	];

	const { html, text } = renderEmail({
		brandId: brand,
		heading: 'How was your visit?',
		preheader: `Score your visit to ${restaurant.display_name} from 0 to 5 — it takes a few seconds.`,
		blocks,
		footer: {
			text: "You're receiving this because you booked a table with us online.",
			linkLabel: 'Stop feedback emails',
			linkUrl: links.stop
		}
	});
	return { subject: `How was your visit to ${restaurant.display_name}?`, html, text };
}

/**
 * Send the request and log it. `{ sent: false, reason: 'no_link' }` when links
 * can't be signed (no secret) — nothing is sent OR logged, so the booking is
 * picked up again once the secret exists.
 */
export async function sendFeedbackRequest(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant,
	now: Date
): Promise<{ sent: boolean; reason?: 'no_link' }> {
	const links = feedbackLinks(booking.id, now);
	if (!links) return { sent: false, reason: 'no_link' };
	const { subject, html, text } = renderFeedbackRequest(booking, customer, restaurant, links);
	const { from, replyTo } = await brandSender(restaurant.brand as BrandId);
	return sendAndLog(
		{
			to: customer.email,
			subject,
			html,
			text,
			from,
			replyTo,
			tags: [FEEDBACK_TEMPLATE, restaurant.brand]
		},
		{ customer: customer.id, booking: booking.id, template: FEEDBACK_TEMPLATE }
	);
}
