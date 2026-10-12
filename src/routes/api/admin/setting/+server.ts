// POST /api/admin/setting — save a single setting from the assistant's inline
// widgets. Audited as actor='staff' (a human clicked Save, vs the AI's
// update_setting which audits as 'ai'). Admin-only (auth deferred §11).
//
// Body: { id: string, value: unknown }

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { updateSetting } from '$lib/server/booking/admin.js';
import { requireRole } from '$lib/server/auth/rbac.js';
import type { RequestHandler } from './$types';

const Body = z.object({ id: z.string().min(1), value: z.unknown() });

export const POST: RequestHandler = async ({ request, locals }) => {
	// House configuration — manager+ (same bar as the /admin/settings pages).
	requireRole(locals.staff, 'manager');
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide { id, value }.');
	const row = await updateSetting(parsed.data.id, parsed.data.value);
	return json({ ok: true, value: row.value });
};
