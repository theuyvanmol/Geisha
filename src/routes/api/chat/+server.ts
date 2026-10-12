// POST /api/chat — public guest assistant for the brand websites.
// Body: { brand: 'asia'|'fusion', message: string, history?: [{role,content}],
//         bookingToken?: string }
// Returns: { configured: boolean, answer: string, directives: UiDirective[] }
//
// Grounded in the brand's editable system prompt (geisha_settings key
// `ai_assistant_prompt`) and given the read-only guest tools plus a set of UI
// tools (show_availability / show_dishes / show_offers). The read tools let the
// model answer factually; the UI tools return `directives` the chat renders as
// tappable cards (time chips → booking page, dish rows, offer rows). No writes,
// no other-brand data — safe to expose publicly.
//
// BOOKING LOOKUP (token-gated): if a VALID self-service `bookingToken` is sent
// (the same HMAC link from the confirmation email that /book/[token] uses), we
// verify it, load the public-safe self-service view, and inject a compact
// factual summary of THAT booking into the system prompt so the guest can ask
// "what time is my table?" etc. There are NO guest write tools — for amend /
// cancel we point the guest at the on-page controls. Guarded so it only ever
// happens with a valid token; a bare booking id is never trusted.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { runAgent } from '$lib/server/ai/geminiAgent.js';
import { guestTools } from '$lib/server/ai/guestTools.js';
import { getSettingValue } from '$lib/server/booking/admin.js';
import { verifyBookingToken, getSelfServiceView } from '$lib/server/booking/selfservice.js';
import type { RequestHandler } from './$types';

const Body = z.object({
	brand: z.enum(['asia', 'fusion']),
	message: z.string().min(1).max(1000),
	history: z
		.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
		.max(20)
		.optional(),
	// Optional self-service link token (from /book/[token]). Only a valid,
	// signature-checked token unlocks the per-booking summary below.
	bookingToken: z.string().max(1000).optional()
});

const FALLBACK_PROMPT = `You are the friendly guest assistant for Geisha Restaurants in Benton, Newcastle (Front Street, NE12 8AE). Be warm and concise, only answer questions about Geisha, and never invent menu items, prices, offers or availability. For allergies, always tell the guest to inform a member of staff so the kitchen can advise — never guarantee a dish is free of an allergen. If unsure, suggest calling or using the booking page.`;

/**
 * Build the compact, factual summary of the guest's OWN booking to inject into
 * the system prompt. London-local date/time, only public-safe fields, and a
 * clear instruction to point at the on-page controls for changes (no write
 * tools exist here). Returns '' if the view can't be loaded.
 */
async function bookingContext(bookingId: string): Promise<string> {
	try {
		const view = await getSelfServiceView(bookingId);
		const tz = view.restaurant.timezone || 'Europe/London';
		const start = new Date(view.booking.starts_at);
		const date = start.toLocaleDateString('en-GB', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: tz
		});
		const time = start.toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: tz
		});
		const status = view.booking.status.replace(/_/g, ' ');
		const changeable = view.canAmend || view.canCancel;
		return [
			`\n\nTHE GUEST'S OWN BOOKING (they opened their management link — you may answer about THIS booking factually):`,
			`- Name: ${view.customer.name || 'guest'}`,
			`- Date: ${date}`,
			`- Time: ${time}`,
			`- Party size: ${view.booking.party_size}`,
			`- Status: ${status}`,
			view.booking.occasion ? `- Occasion: ${view.booking.occasion}` : null,
			`- Can change online: ${view.canAmend ? 'yes' : 'no'}; can cancel online: ${
				view.canCancel ? 'yes' : 'no'
			}`,
			view.policyNote ? `- Cancellation policy: ${view.policyNote}` : null,
			changeable
				? `To change or cancel, tell the guest to use the "Change booking" / "Cancel booking" buttons on this page — you cannot make the change yourself.`
				: `This booking can no longer be changed online; if they need help, point them to calling the restaurant.`,
			`Never reveal any other booking or guest's details.`
		]
			.filter(Boolean)
			.join('\n');
	} catch {
		return '';
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide { brand, message }.');

	const { brand, message, history, bookingToken } = parsed.data;
	const base = (await getSettingValue<string>(brand, 'ai_assistant_prompt')) || FALLBACK_PROMPT;

	// Give the model today's date so it can resolve "this Saturday" etc. before
	// calling check_availability (which needs a concrete YYYY-MM-DD).
	const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); // YYYY-MM-DD

	// Token-gated per-booking context. GUARD: only ever with a valid, signed
	// token — a bare booking id is never accepted (verifyBookingToken returns null
	// for anything forged / expired / malformed, so bookingCtx stays '').
	let bookingCtx = '';
	if (bookingToken) {
		const verified = verifyBookingToken(bookingToken);
		if (verified) bookingCtx = await bookingContext(verified.bookingId);
	}

	// This chat renders as plain text bubbles (Markdown shows literally), but it
	// ALSO renders tappable cards from the show_* UI tools. So: keep the SPOKEN
	// answer short and plain, and lean on the cards for detail.
	const style = `Reply in plain conversational text only. Do NOT use Markdown: no headings (#), no bold/italics (** or *), no bullet lists, no horizontal rules (---), no emoji. Keep answers short — usually 1–2 sentences. When you show a card (availability, dishes or offers), the card carries the detail, so keep the words to a brief lead-in like "Here's what we've got" rather than repeating every item.`;

	const cards = `When you tell a guest about table availability, ALSO call show_availability so they get tappable time chips that link straight to booking. When you list or recommend dishes, ALSO call show_dishes. When you mention offers, deals, brunch or set menus, ALSO call show_offers. Call the matching show_* tool in the SAME reply as your spoken answer, then keep the answer short.`;

	// The model is unreliable at date arithmetic (it kept resolving "tomorrow" to
	// today). So we DON'T ask it to compute — we hand it a small lookup table of the
	// next 14 days (weekday + ISO), pre-resolved server-side in Europe/London. It
	// must map any relative phrase to a row in this table, never calculate itself.
	const fmt = (iso: string) =>
		new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			timeZone: 'Europe/London'
		});
	const upcoming: string[] = [];
	for (let i = 0; i < 14; i++) {
		const d = new Date(`${today}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() + i);
		const iso = d.toISOString().slice(0, 10);
		const rel = i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : '';
		upcoming.push(`  ${fmt(iso)} = ${iso}${rel}`);
	}
	const dates = `DATE TABLE (Europe/London) — resolve every relative date by looking it up here; NEVER compute a date or weekday yourself:\n${upcoming.join(
		'\n'
	)}\nToday is the first row. "Tomorrow" is the second row. "This Saturday"/"next Friday" = the matching weekday row. Always pass the concrete YYYY-MM-DD from this table to the tools, and state the weekday exactly as written here. If a guest named a time, pass it to show_availability as preferredTime (24h HH:MM) so the card focuses on that time instead of the whole day.`;

	// If the guest asks about an existing booking but we have NO verified token in
	// context, we cannot look it up — say so warmly and point them at their emailed
	// management link (that opens this chat WITH the booking loaded), not "no access".
	const noBookingCtx = bookingCtx
		? ''
		: `\n\nIf a guest asks about an existing reservation (their time, changing or cancelling it) and you have no booking details in this conversation, explain that you can only see a booking when they open the "Manage booking" link from their confirmation email — from there you can answer about it. Offer the phone number as a fallback. Never claim to have looked it up.`;

	const system = `${base}\n\n${dates}\n\n${cards}${bookingCtx}${noBookingCtx}\n\n${style}`;

	const friendly =
		'Sorry — I’m having a little trouble right now. Please try again in a moment, or give us a call.';
	try {
		const result = await runAgent(system, message, history ?? [], guestTools(brand));
		// Guests get a friendly line on any technical failure (no techy detail).
		// Directives (the show_* card payloads) pass straight through so the chat
		// can render them below the bubble.
		return json({
			configured: result.configured,
			answer: result.errored ? friendly : result.answer,
			directives: result.directives
		});
	} catch (e) {
		console.error('[chat] agent failed', e);
		return json({ configured: true, answer: friendly, directives: [] });
	}
};
