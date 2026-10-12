// GET /api/admin/search?brand=&q= — magic search for the diary (ResDiary parity).
// Returns merged customer + booking hits for the query; the client ranks/caps them
// via $lib/diary/magicSearch (pure). Server-only PocketBase reads; gated to staff
// because it surfaces guest PII (names, emails, phones).
//
// Response: { hits: DiarySearchHit[] }

import { json, error } from '@sveltejs/kit';
import { searchDiary } from '$lib/server/booking/admin.js';
import { requireRole } from '$lib/server/auth/rbac.js';
import type { BrandId } from '$lib/server/db/types.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	requireRole(locals.staff, 'server');
	const brand = (url.searchParams.get('brand') as BrandId) || 'asia';
	const q = url.searchParams.get('q') ?? '';
	if (q.trim().length < 2) return json({ hits: [] });
	try {
		const hits = await searchDiary(brand, q);
		return json({ hits });
	} catch {
		throw error(500, 'Search failed.');
	}
};
