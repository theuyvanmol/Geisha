// GET /api/admin/evening-plan?brand=asia|fusion&date=YYYY-MM-DD
//   (mf-autonomous-copilot — the "Plan tonight" capstone)
//
// Returns ONE structured evening plan (headline + narration + a CHECKLIST of
// discrete, individually-confirm-gated actions) assembled by the deterministic
// engines (assembleEveningPlan, ai/copilot.ts). The plan WRITES nothing — each
// firable checklist item carries an `action` whose tool name + input shape match
// an existing confirm-gated admin tool, which the AssistantDock fires one-by-one
// through /api/admin-chat (every apply is its own audited confirm). 'Approve all'
// is therefore N individually-audited confirm-gated calls, never a bulk commit.
//
// RBAC: owner/manager only — planning the room is a manager capability (it
// proposes reseats + guest comms). hooks.server.ts already 401s an unauthenticated
// /api/admin/* call; we re-assert the role here so the endpoint is safe on its own.

import { json, error } from '@sveltejs/kit';
import { requireRole } from '$lib/server/auth/rbac.js';
import { assembleEveningPlan } from '$lib/server/ai/copilot.js';
import type { BrandId } from '$lib/server/db/types.js';
import type { RequestHandler } from './$types';

const brandOf = (url: URL): BrandId =>
	(url.searchParams.get('brand') as BrandId) === 'fusion' ? 'fusion' : 'asia';

export const GET: RequestHandler = async ({ url, locals }) => {
	// Planning tonight reshuffles the room + drafts guest comms — manager+ only.
	requireRole(locals.staff, 'manager');
	const brand = brandOf(url);
	const date = url.searchParams.get('date') || new Date().toLocaleDateString('en-CA', {
		timeZone: 'Europe/London'
	});
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw error(400, "Provide date as 'YYYY-MM-DD'.");
	}
	try {
		const plan = await assembleEveningPlan(brand, date);
		return json({ ok: true, plan });
	} catch (e) {
		console.error('[evening-plan] assemble failed', e);
		// Never 500 the dock — return a graceful JSON it can show.
		return json({ ok: false, error: 'Could not assemble a plan for that date.' }, { status: 200 });
	}
};
