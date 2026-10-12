// POST /api/contact — a message from the public Contact page, and (with
// kind: 'parties') a private-hire enquiry from the Parties page.
// Body: { brand, name, email, subject?, message?, kind?, phone?, date?,
//         partySize?, occasion?, website? }
//
// Stores a geisha_enquiries row. That row IS the delivery: staff read it in
// Admin → Guests → Enquiries and reply with the card's mailto: link, from their
// own mail client. NO EMAIL IS SENT FROM HERE — the owner isn't using Resend
// (Aug 2026), and a notification path that silently no-ops when unconfigured is
// exactly the kind of thing that makes a form look like it works when it
// doesn't. If they adopt Resend later, send() already takes a `replyTo`.
//
// THE RULE HERE IS "NEVER LIE ABOUT DELIVERY". The form this replaces reported
// success unconditionally while sending nothing, so a guest's enquiry vanished
// and they believed it had arrived. Storing the row is now the ONLY path, so if
// the write fails this returns an error and the panel tells the guest to phone
// instead — a visible failure beats a silent one.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { pb } from '$lib/server/db/pb.js';
import { getRestaurant } from '$lib/server/booking/queries.js';
import { BRANDS } from '$lib/data/brand.js';
import { rateLimit, clientKey, CONTACT_SEND } from '$lib/server/util/rateLimit.js';
import type { RequestHandler } from './$types';

const Body = z.object({
	brand: z.enum(['asia', 'fusion']),
	name: z.string().trim().min(1).max(120),
	email: z.string().trim().email().max(200),
	subject: z.string().trim().max(200).optional(),
	// Optional for a function enquiry, where the details below ARE the message and
	// the free-text box is a genuine "anything else?".
	message: z.string().trim().max(5000).default(''),
	/** Which form this came from. Only changes how the ticket is titled and
	 *  summarised — both land in the same Enquiries inbox. */
	kind: z.enum(['contact', 'parties']).default('contact'),
	// --- function-enquiry extras (PartiesPanel) -----------------------------
	phone: z.string().trim().max(40).optional(),
	date: z.string().trim().max(40).optional(),
	partySize: z.string().trim().max(20).optional(),
	occasion: z.string().trim().max(120).optional(),
	// Honeypot: a real guest never sees this field, so anything in it is a bot.
	// Named `website` because that's the label form-filling scripts go for.
	website: z.string().max(200).optional()
});

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const burst = rateLimit(`contact:${clientKey(request, getClientAddress)}`, CONTACT_SEND);
	if (!burst.ok) {
		throw error(429, 'Please wait a few minutes before sending another message.');
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	const parsed = Body.safeParse(raw);
	if (!parsed.success) {
		throw error(
			400,
			parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
		);
	}
	const data = parsed.data;

	// Honeypot tripped — accept silently. Telling a bot it failed just teaches it
	// to try again without the field.
	if (data.website && data.website.trim()) return json({ ok: true }, { status: 201 });

	// A contact message with nothing in it is nothing. A function enquiry with the
	// details filled in and the "tell us more" box empty is a real enquiry.
	const details: Array<[string, string]> = [
		['Phone', data.phone ?? ''],
		['Preferred date', data.date ?? ''],
		['Party size', data.partySize ?? ''],
		['Occasion', data.occasion ?? '']
	].filter(([, v]) => v.trim()) as Array<[string, string]>;

	if (!data.message.trim() && details.length === 0) {
		throw error(400, 'Please tell us a little about your enquiry.');
	}

	// Everything the guest gave us, flattened into the stored message. The extra
	// fields live here rather than as their own columns so a function enquiry needs
	// no second migration — and so the admin card shows the whole thing as one read.
	const body = [
		...details.map(([k, v]) => `${k}: ${v}`),
		...(details.length && data.message.trim() ? [''] : []),
		data.message.trim()
	]
		.join('\n')
		.trim();

	let restaurantId: string;
	try {
		restaurantId = (await getRestaurant(data.brand)).id;
	} catch (err) {
		console.error('[api/contact] restaurant lookup failed:', err);
		throw error(500, 'Could not send your message. Please call us instead.');
	}

	const isParties = data.kind === 'parties';
	// Falls back to something descriptive so a ticket is never titled "(none)".
	const subjectLine =
		data.subject?.trim() ||
		(isParties
			? `Function enquiry${data.occasion ? ` — ${data.occasion}` : ''}`
			: '');

	let enquiryId = '';
	try {
		const c = await pb();
		const row = await c.collection('geisha_enquiries').create({
			restaurant: restaurantId,
			name: data.name,
			email: data.email,
			subject: subjectLine,
			message: body,
			status: 'new',
			source: isParties ? 'parties_form' : 'contact_form'
		});
		enquiryId = row.id;
	} catch (err) {
		// The write is the whole delivery mechanism now, so a failure here is a
		// failure full stop — tell the guest rather than showing a thank-you for a
		// message that went nowhere. Most likely cause is the geisha_enquiries
		// collection missing on this PocketBase (see pb_migrations/1786100000).
		console.error('[api/contact] could not store enquiry:', err);
		throw error(
			503,
			`Sorry — we could not send your message just now. Please call us on ${BRANDS[data.brand].phone}.`
		);
	}

	return json({ ok: true, id: enquiryId }, { status: 201 });
};
