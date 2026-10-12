// POST /api/admin/prefs — save the signed-in staff member's own UI preferences.
//
// A tiny fire-and-forget endpoint behind the diary's "hide the header" toggle. It
// writes ONLY to the caller's own prefs row (the staff id comes from the session
// cookie, never from the body), so there is nothing to authorise beyond "you are
// signed in" — every role gets to set up their own screen.
//
// Body: { diaryChromeCollapsed?: boolean, brand?: 'asia' | 'fusion' }

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { setStaffUiPrefs } from '$lib/server/auth/prefs.js';
import type { RequestHandler } from './$types';

const Body = z.object({
	diaryChromeCollapsed: z.boolean().optional(),
	brand: z.enum(['asia', 'fusion']).optional()
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.staff) throw error(401, 'Sign in required.');
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide a known preference.');
	const prefs = await setStaffUiPrefs(locals.staff.id, parsed.data);
	return json({ ok: true, prefs });
};
