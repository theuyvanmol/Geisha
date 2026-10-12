// Public: /feedback/[token] — where the "How was your visit?" email's 0–5 buttons land.
//
// The token is the ONLY authority. It is a SCOPED token ('feedback'), so it can't
// open /book/[token] (which can cancel a booking) and a booking link can't open
// this page. The booking id is re-derived from it on every load and every action.
//
// A GET NEVER WRITES. Mail scanners (Outlook Safe Links, Mimecast, …) fetch every
// link in a message before the guest sees it; if `?score=3` saved a score, the
// scanner would vote, and whichever link it fetched last would win. So the score
// in the URL only PRESELECTS a button, and the guest's own Send (a POST) saves it.
// The "stop feedback emails" link works the same way.

import { fail } from '@sveltejs/kit';
import { verifyScopedToken } from '$lib/server/booking/selfservice.js';
import { getBrand } from '$lib/data/brand.js';
import { FEEDBACK_SCOPE, parseScore, COMMENT_MAX } from '$lib/server/feedback/rules.js';
import {
	FeedbackInputError,
	loadFeedbackContext,
	optOutOfFeedback,
	submitFeedback
} from '$lib/server/feedback/store.js';
import type { Actions, PageServerLoad } from './$types';

async function contextFor(token: string) {
	const verified = verifyScopedToken(FEEDBACK_SCOPE, token);
	if (!verified) return null;
	try {
		return await loadFeedbackContext(verified.id);
	} catch (err) {
		console.error('[feedback] could not load the booking:', err);
		return null;
	}
}

export const load: PageServerLoad = async ({ params, url }) => {
	const ctx = await contextFor(params.token);
	if (!ctx) return { invalid: true as const };

	const brand = getBrand(ctx.restaurant.brand);
	return {
		invalid: false as const,
		brand: { id: brand.id, name: brand.name, phone: brand.phone },
		// Only what the guest already knows from the email. Nothing about the guest
		// themselves — a forwarded link shouldn't hand anyone their name or email.
		visitAt: ctx.booking.starts_at.replace(' ', 'T'),
		preselect: parseScore(url.searchParams.get('score')) ?? ctx.feedback?.score ?? null,
		comment: ctx.feedback?.comment ?? '',
		answered: Boolean(ctx.feedback),
		stopMode: url.searchParams.get('stop') === '1',
		optedOut: Boolean(ctx.customer?.feedback_opt_out),
		commentMax: COMMENT_MAX
	};
};

export const actions: Actions = {
	submit: async ({ params, request }) => {
		const ctx = await contextFor(params.token);
		if (!ctx) return fail(403, { message: 'This link is no longer valid.' });
		const form = await request.formData();
		try {
			const result = await submitFeedback(ctx, form.get('score'), form.get('comment'));
			return { saved: true as const, ...result };
		} catch (err) {
			if (err instanceof FeedbackInputError) return fail(400, { message: err.message });
			console.error('[feedback] submit failed:', err);
			return fail(500, { message: "Sorry, we couldn't save that. Please try again." });
		}
	},

	stop: async ({ params }) => {
		const ctx = await contextFor(params.token);
		if (!ctx) return fail(403, { message: 'This link is no longer valid.' });
		try {
			await optOutOfFeedback(ctx);
			return { stopped: true as const };
		} catch (err) {
			console.error('[feedback] opt-out failed:', err);
			return fail(500, { message: "Sorry, we couldn't do that. Please try again." });
		}
	}
};
