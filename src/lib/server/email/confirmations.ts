// Guest booking emails (BOOKING_SYSTEM_PLAN.md §5).
//
// Every template is built from the shared block tree in layout.ts, so each one
// ships an html AND a text/plain part that cannot disagree with each other.
//
// THE SET, and why each exists:
//   confirmation   — the booking is on. Carries the reference, the manage link,
//                    and what happened with money.
//   amended        — the booking CHANGED. Previously this reused the confirmation
//                    template, so a guest who moved their table got an email
//                    saying "Your table is booked" with no hint anything had
//                    changed, and no way to tell it from the original.
//   cancelled      — the booking is off, and what happened to the deposit.
//   reminder       — the pre-service nudge (the no-show reducer).
//   noShowFee      — we charged the card AFTER the event. A £20 debit with no
//                    explanation is a chargeback and an angry phone call; this is
//                    the email that prevents both.
//   refundIssued   — money went back. Guests do not reliably notice a refund on a
//                    statement for days, and chase in the meantime.
//
// All are best-effort: send() never throws, and no booking outcome depends on
// an email landing.

import { send, sendAndLog } from './send.js';
import { renderEmail, type EmailBlock, type DetailRow } from './layout.js';
import type { Booking, BrandId, Customer, Restaurant } from '../db/types.js';

const LONDON = 'Europe/London';

/** geisha_messages template id for the pre-service reminder (no-show reducer). */
export const REMINDER_TEMPLATE = 'reminder';

/** geisha_settings key (json bool) gating the OPTIONAL reminder SMS. Default off. */
export const SMS_REMINDERS_FLAG = 'sms_reminders_enabled';

/**
 * Read the per-brand 'sms_reminders_enabled' flag from geisha_settings. Defaults
 * to false and DEGRADES GRACEFULLY — a missing setting, missing restaurant, or
 * unreachable PB all read as "off" so reminders never break on the SMS path.
 */
async function smsRemindersEnabled(brand: BrandId): Promise<boolean> {
	try {
		const { getRestaurant } = await import('../booking/queries.js');
		const { pb } = await import('../db/pb.js');
		const restaurant = await getRestaurant(brand);
		const c = await pb();
		const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
		const row = await c
			.collection('geisha_settings')
			.getFirstListItem<{ value: unknown }>(
				`restaurant=${q(restaurant.id)} && key=${q(SMS_REMINDERS_FLAG)}`
			)
			.catch(() => null);
		const v = row?.value;
		return v === true || v === 'true' || v === 1 || v === '1';
	} catch {
		return false;
	}
}

/** Compact plain-text reminder body for SMS (no HTML, fits a single segment). */
function renderReminderSms(booking: Booking, restaurant: Restaurant): string {
	return `Reminder: your table at ${restaurant.display_name} on ${fmtDate(booking.starts_at)} at ${fmtTime(booking.starts_at)} for ${booking.party_size} ${booking.party_size === 1 ? 'guest' : 'guests'}. Reply or call us if plans change.`;
}

/**
 * Best-effort reminder SMS, gated on the per-brand 'sms_reminders_enabled' flag
 * AND the customer having a phone number. ADDITIVE to the reminder email and
 * NEVER throws — a failed/unconfigured SMS must not affect the email outcome or
 * the cron sweep. No-ops silently when disabled or there's no phone.
 */
async function maybeSendReminderSms(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant
): Promise<void> {
	try {
		if (!customer.phone) return;
		if (!(await smsRemindersEnabled(restaurant.brand))) return;
		const { sendAndLogSms } = await import('../sms/send.js');
		await sendAndLogSms(
			{ to: customer.phone, body: renderReminderSms(booking, restaurant) },
			{ customer: customer.id, booking: booking.id, template: REMINDER_TEMPLATE }
		);
	} catch (err) {
		console.error('[confirmations] reminder SMS failed (non-fatal):', err);
	}
}

function fmtDate(iso: string): string {
	return new Date(iso).toLocaleDateString('en-GB', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: LONDON
	});
}
function fmtTime(iso: string): string {
	return new Date(iso).toLocaleTimeString('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		timeZone: LONDON
	});
}
const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;

/**
 * Who to greet.
 *
 * The name on THIS booking first, the customer record only as a fallback. The
 * customer row is keyed on email and keeps whatever name was used the very first
 * time that address booked — so a guest who books again under a different name
 * (for a colleague, for a family party, or simply having given their full name
 * the second time) was being greeted by their oldest one. The diary card has
 * always shown the per-booking name; the email now agrees with it.
 */
export function greetingName(booking: { guest_name?: string }, customer: { name?: string }): string {
	return booking.guest_name?.trim() || customer.name?.trim() || 'there';
}

/**
 * Extra rows the confirmation carries beyond date/time/party.
 *
 * `reference` and `manageUrl` are derived per-caller rather than computed here:
 * the reference lives with the API route that defines it, and the manage URL
 * needs an origin only the caller knows (a request's origin, or the configured
 * site origin for a webhook).
 */
export interface ConfirmationExtras {
	/** Quotable booking reference, e.g. 'BQZYZ9Q'. */
	reference?: string;
	/** Tokenised self-service link (/book/[token]). '' when unconfigured. */
	manageUrl?: string;
	/** The option the guest chose, e.g. 'Bottomless Brunch'. */
	optionName?: string;
}

function detailRows(b: Booking, extras: ConfirmationExtras = {}): DetailRow[] {
	const rows: DetailRow[] = [
		['Date', fmtDate(b.starts_at)],
		['Time', fmtTime(b.starts_at)],
		['Party', guests(b.party_size)]
	];
	if (extras.optionName) rows.push(['Booking', extras.optionName]);
	if (extras.reference) rows.push(['Reference', extras.reference]);
	return rows;
}

/**
 * The "change or cancel" block. Prefers the self-service link — a guest who can
 * cancel in two taps at 5pm frees a table that a guest who has to phone during
 * service simply doesn't.
 */
function manageBlocks(manageUrl: string | undefined, phone: string): EmailBlock[] {
	if (!manageUrl) {
		return [
			{ type: 'note', text: `Need to change or cancel? Reply to this email or call us on ${phone}.` }
		];
	}
	return [
		{ type: 'button', label: 'Change or cancel', url: manageUrl },
		{
			type: 'note',
			text: `This link is personal to your booking, so please don't forward it. You can also call us on ${phone}.`
		}
	];
}

/** Dispatch a rendered email, with the brand's tag for the provider dashboard. */
async function dispatch(
	to: string,
	subject: string,
	content: Parameters<typeof renderEmail>[0],
	tag: string
): Promise<{ sent: boolean }> {
	const { html, text } = renderEmail(content);
	const { from, replyTo } = await brandSender(content.brandId);
	return send({ to, subject, html, text, from, replyTo, tags: [tag, content.brandId] });
}

/**
 * The From and Reply-To a GUEST email should carry.
 *
 * Both are derived per brand rather than read from one account-wide setting,
 * because both differ per restaurant and getting either wrong is visible to the
 * guest:
 *
 *   FROM — the ADDRESS must stay on the domain authenticated at the provider
 *   (send from anything else and the message is accepted and then dropped), but
 *   the DISPLAY NAME should say which restaurant is writing. So we keep the
 *   configured address and substitute the brand's name: a guest who booked
 *   Fusion sees "Geisha Fusion", not a generic group name.
 *
 *   REPLY-TO — must be a mailbox the restaurant actually reads, and Asia and
 *   Fusion read different ones. This previously came from the account-wide
 *   `email_reply_to` lookup, which returns whichever brand's value it finds
 *   first — so one restaurant's guests would have had their replies sent to the
 *   other's inbox. The brands already publish their own addresses in
 *   $lib/data/brand.ts, and those are the same addresses printed on the site, so
 *   they are used directly and need no configuration to stay correct.
 */
export async function brandSender(brandId: BrandId): Promise<{ from?: string; replyTo?: string }> {
	try {
		const [{ getBrand }, { configuredFrom }, { parseAddress }] = await Promise.all([
			import('../../data/brand.js'),
			import('./send.js'),
			import('./brevo.js')
		]);
		const brand = getBrand(brandId);
		const address = parseAddress(await configuredFrom()).email;
		return {
			from: address ? `${brand.name} <${address}>` : undefined,
			replyTo: brand.email || undefined
		};
	} catch (err) {
		// Fall back to the configured defaults rather than failing the send.
		console.error('[confirmations] sender resolution failed (non-fatal):', err);
		return {};
	}
}

// --- confirmation ------------------------------------------------------------

export async function sendBookingConfirmation(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant,
	paymentNote?: string,
	extras: ConfirmationExtras = {}
): Promise<{ sent: boolean }> {
	if (!customer.email) return { sent: false };
	const brand = restaurant.brand as BrandId;
	const { getBrand } = await import('../../data/brand.js');
	const phone = getBrand(brand).phone;

	const blocks: EmailBlock[] = [
		{ type: 'text', text: `Hello ${greetingName(booking, customer)},` },
		{
			type: 'text',
			text: `Your table at ${restaurant.display_name} is booked. We look forward to seeing you.`
		},
		{ type: 'details', rows: detailRows(booking, extras) }
	];
	if (paymentNote) blocks.push({ type: 'panel', title: 'Payment', text: paymentNote });
	blocks.push(...manageBlocks(extras.manageUrl, phone));

	return dispatch(
		customer.email,
		`Your booking at ${restaurant.display_name} — ${fmtDate(booking.starts_at)}`,
		{
			brandId: brand,
			heading: 'Your table is booked',
			preheader: `${fmtDate(booking.starts_at)} at ${fmtTime(booking.starts_at)} for ${guests(booking.party_size)}${extras.reference ? ` · ref ${extras.reference}` : ''}`,
			blocks
		},
		'booking-confirmation'
	);
}

// --- amended -----------------------------------------------------------------

/**
 * The booking CHANGED. Deliberately its own template: reusing the confirmation
 * meant a guest who moved their table got "Your table is booked" and had no way
 * to tell the new email from the original — or to check the change actually took.
 */
export async function sendBookingAmended(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant,
	extras: ConfirmationExtras = {},
	/** What it WAS. `venueName` is set only when the booking moved to this venue. */
	previous?: { startsAt?: string; partySize?: number; venueName?: string }
): Promise<{ sent: boolean }> {
	if (!customer.email) return { sent: false };
	const brand = restaurant.brand as BrandId;
	const { getBrand } = await import('../../data/brand.js');
	const phone = getBrand(brand).phone;

	// Say what it WAS as well as what it is. "Your booking has been updated" with
	// only the new values leaves the guest unsure whether the bit they cared about
	// is the bit that moved.
	const changed: string[] = [];
	// Venue first: a guest who reads only one line must not go to the wrong building.
	const moved = !!previous?.venueName && previous.venueName !== restaurant.display_name;
	if (moved) changed.push(`was at ${previous!.venueName}`);
	if (previous?.startsAt && previous.startsAt !== booking.starts_at) {
		changed.push(`was ${fmtDate(previous.startsAt)} at ${fmtTime(previous.startsAt)}`);
	}
	if (previous?.partySize && previous.partySize !== booking.party_size) {
		changed.push(`was ${guests(previous.partySize)}`);
	}

	const blocks: EmailBlock[] = [
		{ type: 'text', text: `Hello ${greetingName(booking, customer)},` },
		{
			type: 'text',
			text: moved
				? `Your booking has moved to ${restaurant.display_name}. Here are the new details.`
				: `Your booking at ${restaurant.display_name} has been updated. Here are the new details.`
		},
		{ type: 'details', rows: detailRows(booking, extras) }
	];
	if (changed.length) {
		blocks.push({ type: 'note', text: `Previously: ${changed.join(', ')}.` });
	}
	blocks.push(...manageBlocks(extras.manageUrl, phone));

	return dispatch(
		customer.email,
		`Your booking has changed — ${restaurant.display_name}, ${fmtDate(booking.starts_at)}`,
		{
			brandId: brand,
			heading: 'Your booking has been updated',
			preheader: `Now ${fmtDate(booking.starts_at)} at ${fmtTime(booking.starts_at)} for ${guests(booking.party_size)}`,
			blocks
		},
		'booking-amended'
	);
}

// --- cancellation ------------------------------------------------------------

export async function sendCancellation(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant,
	/** What happened to any money — refunded, forfeited, or nothing taken. */
	moneyNote?: string
): Promise<{ sent: boolean }> {
	if (!customer.email) return { sent: false };
	const brand = restaurant.brand as BrandId;

	const blocks: EmailBlock[] = [
		{ type: 'text', text: `Hello ${greetingName(booking, customer)},` },
		{
			type: 'text',
			text: `Your booking at ${restaurant.display_name} on ${fmtDate(booking.starts_at)} at ${fmtTime(booking.starts_at)} has been cancelled.`
		}
	];
	if (moneyNote) blocks.push({ type: 'panel', title: 'Your deposit', text: moneyNote });
	blocks.push({
		type: 'note',
		text: "If this was a mistake, please contact us and we'll do our best to help."
	});

	return dispatch(
		customer.email,
		`Booking cancelled — ${restaurant.display_name}`,
		{
			brandId: brand,
			heading: 'Your booking is cancelled',
			preheader: `${fmtDate(booking.starts_at)} at ${fmtTime(booking.starts_at)} — cancelled`,
			blocks
		},
		'booking-cancelled'
	);
}

// --- reminder ----------------------------------------------------------------

/**
 * Render the pre-service reminder (subject + html + text) without sending it, so
 * the cron can dispatch via sendAndLog and store exactly what it sent.
 */
export function renderReminder(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant,
	extras: ConfirmationExtras = {}
): { subject: string; html: string; text: string } {
	const brand = restaurant.brand as BrandId;
	const blocks: EmailBlock[] = [
		{ type: 'text', text: `Hello ${greetingName(booking, customer)},` },
		{
			type: 'text',
			text: `A friendly reminder of your table at ${restaurant.display_name} tomorrow. We can't wait to welcome you.`
		},
		{ type: 'details', rows: detailRows(booking, extras) },
		{
			type: 'note',
			text: 'Plans changed? Please let us know so we can offer the table to someone else.'
		}
	];
	if (extras.manageUrl) {
		blocks.push({ type: 'button', label: 'Change or cancel', url: extras.manageUrl });
	}

	const { html, text } = renderEmail({
		brandId: brand,
		heading: 'See you tomorrow',
		preheader: `${fmtTime(booking.starts_at)} tomorrow for ${guests(booking.party_size)}`,
		blocks
	});
	return {
		subject: `Reminder: your table at ${restaurant.display_name} — ${fmtDate(booking.starts_at)}`,
		html,
		text
	};
}

/**
 * Send the pre-service reminder, recording the outcome to geisha_messages
 * (template 'reminder'). No-ops to { sent: false } if the customer has no email.
 *
 * OPTIONAL SMS (additive): when the customer has a phone AND the per-brand
 * 'sms_reminders_enabled' flag is on (default off), an SMS reminder is ALSO sent
 * best-effort. The email outcome is unaffected by the SMS path.
 */
export async function sendReminder(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant
): Promise<{ sent: boolean }> {
	if (!customer.email) {
		// No email, but an SMS reminder may still be wanted (and is independent).
		await maybeSendReminderSms(booking, customer, restaurant);
		return { sent: false };
	}
	const { subject, html, text } = renderReminder(
		booking,
		customer,
		restaurant,
		await confirmationExtras(booking)
	);
	const { from, replyTo } = await brandSender(restaurant.brand as BrandId);
	const result = await sendAndLog(
		{
			to: customer.email,
			subject,
			html,
			text,
			from,
			replyTo,
			tags: ['reminder', restaurant.brand]
		},
		{ customer: customer.id, booking: booking.id, template: REMINDER_TEMPLATE }
	);
	await maybeSendReminderSms(booking, customer, restaurant);
	return result;
}

// --- money-after-the-fact ----------------------------------------------------

/**
 * We charged the guest's stored card because they didn't turn up.
 *
 * This email is the difference between a fee and a dispute. The charge lands on
 * a statement days later with a merchant name attached and no context; without
 * this, the guest's first move is their bank, not the restaurant. It states the
 * amount, the booking it relates to, and how to challenge it — which is also the
 * evidence the restaurant wants on file if they do dispute it.
 */
export async function sendNoShowFeeCharged(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant,
	amountPence: number,
	extras: ConfirmationExtras = {}
): Promise<{ sent: boolean }> {
	if (!customer.email) return { sent: false };
	const brand = restaurant.brand as BrandId;
	const { getBrand } = await import('../../data/brand.js');
	const b = getBrand(brand);

	return dispatch(
		customer.email,
		`Charge for your missed booking — ${restaurant.display_name}`,
		{
			brandId: brand,
			heading: 'About your missed booking',
			preheader: `${money(amountPence)} charged for ${fmtDate(booking.starts_at)}`,
			blocks: [
				{ type: 'text', text: `Hello ${greetingName(booking, customer)},` },
				{
					type: 'text',
					text: `We held a table for you at ${restaurant.display_name} and weren't able to seat anyone else. As set out when you booked, we've charged the card you provided.`
				},
				{ type: 'details', rows: detailRows(booking, extras) },
				{
					type: 'panel',
					title: `${money(amountPence)} charged`,
					text: `This will appear on your statement from ${restaurant.display_name}. It may take a few days to show.`
				},
				{
					type: 'note',
					text: `If you think this is a mistake — or something happened that we should know about — please call us on ${b.phone} or reply to this email. We'd much rather hear from you than have you dispute it with your bank.`
				}
			]
		},
		'noshow-fee'
	);
}

/**
 * Money has gone back to the guest's card. Sent because a refund is invisible
 * for several days on most statements, and the guest chases in the meantime —
 * usually by phone, during service.
 */
export async function sendRefundIssued(
	booking: Booking,
	customer: Customer,
	restaurant: Restaurant,
	amountPence: number,
	reason?: string
): Promise<{ sent: boolean }> {
	if (!customer.email) return { sent: false };
	const brand = restaurant.brand as BrandId;

	const blocks: EmailBlock[] = [
		{ type: 'text', text: `Hello ${greetingName(booking, customer)},` },
		{
			type: 'text',
			text: `We've refunded ${money(amountPence)} to the card you used for your booking at ${restaurant.display_name} on ${fmtDate(booking.starts_at)}.`
		},
		{
			type: 'panel',
			title: `${money(amountPence)} refunded`,
			text: 'Refunds usually reach your account within 5–10 working days, depending on your bank.'
		}
	];
	if (reason) blocks.push({ type: 'note', text: reason });
	blocks.push({ type: 'note', text: 'Nothing else is needed from you.' });

	return dispatch(
		customer.email,
		`Refund issued — ${restaurant.display_name}`,
		{
			brandId: brand,
			heading: 'Your refund is on its way',
			preheader: `${money(amountPence)} refunded to your card`,
			blocks
		},
		'refund-issued'
	);
}

// --- helpers -----------------------------------------------------------------

/**
 * Re-send a booking's confirmation by id — ResDiary's "Resend Confirmation"
 * button. Returns { sent:false } rather than throwing when the guest has no
 * email on file, so the caller can show a friendly message.
 */
export async function resendConfirmation(bookingId: string): Promise<{ sent: boolean }> {
	const { pb } = await import('../db/pb.js');
	const c = await pb();
	const booking = await c.collection('geisha_bookings').getOne<Booking>(bookingId);
	const [customer, restaurant] = await Promise.all([
		c.collection('geisha_customers').getOne<Customer>(booking.customer),
		c.collection('geisha_restaurants').getOne<Restaurant>(booking.restaurant)
	]);
	return sendBookingConfirmation(
		booking,
		customer,
		restaurant,
		undefined,
		await confirmationExtras(booking)
	);
}

/**
 * The reference / manage-link / option rows for a booking, resolved from the
 * booking alone. Every caller that has a Booking but no request context (the
 * deferred send on the write path, the webhook, "Resend confirmation", the
 * reminder cron) uses this, so the guest gets the same email whichever path
 * produced it.
 *
 * Best-effort: a failure degrades the email to date/time/party rather than
 * failing the send.
 */
export async function confirmationExtras(booking: Booking): Promise<ConfirmationExtras> {
	try {
		const [{ bookingReference }, { buildManagementUrl }, { siteOrigin }] = await Promise.all([
			import('../../../routes/api/bookings/reference.js'),
			import('../booking/selfservice.js'),
			import('../util/siteUrl.js')
		]);
		return {
			reference: bookingReference(booking.id),
			// Pass ends_at so the link expires a fortnight after the meal rather than
			// sitting valid for six months in a forwardable inbox.
			manageUrl: buildManagementUrl(booking.id, siteOrigin(), booking.ends_at),
			optionName: booking.promotion || undefined
		};
	} catch (err) {
		console.error('[confirmations] extras failed (non-fatal):', err);
		return {};
	}
}
