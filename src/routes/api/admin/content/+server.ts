// POST /api/admin/content — save a content blob from the assistant's inline
// ContentWidget (the AI opens the editor pre-filled; the admin reviews and clicks
// Save, which lands here). Mirrors /api/admin/setting: a human clicked Save, so it
// audits as actor='staff'. The value is validated against the SAME Zod schema the
// /admin/content editor pages use (SCHEMA_BY_KEY), so a malformed blob can never
// reach the public renderer.
//
// Body: { brand: 'asia'|'fusion', key: ContentKey, value: unknown, both?: boolean }
//   both=true writes the same blob to Asia and Fusion (the editors' "Apply to
//   both" option).

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { upsertContent } from '$lib/server/content/content.js';
import { SCHEMA_BY_KEY, type ContentKey } from '$lib/content/schema';
import { requireRole } from '$lib/server/auth/rbac.js';
import type { BrandId } from '$lib/server/db/types.js';
import type { RequestHandler } from './$types';

const CONTENT_KEYS = Object.keys(SCHEMA_BY_KEY) as [ContentKey, ...ContentKey[]];

const Body = z.object({
	brand: z.enum(['asia', 'fusion']),
	key: z.enum(CONTENT_KEYS),
	value: z.unknown(),
	both: z.boolean().optional()
});

export const POST: RequestHandler = async ({ request, locals }) => {
	// Content edits change the PUBLIC website, so they're manager+ (matching the
	// /admin/content pages and the access map in $lib/admin/access.ts). 401 if not
	// signed in, 403 if too junior.
	const staff = requireRole(locals.staff, 'manager');

	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide { brand, key, value }.');
	const { brand, key, value, both } = parsed.data;

	// Validate against the key's schema — the same net the editor pages use.
	const result = SCHEMA_BY_KEY[key].safeParse(value);
	if (!result.success) {
		const first = result.error.issues[0];
		const where = first?.path.join('.') || '(root)';
		throw error(400, `Validation failed at ${where}: ${first?.message ?? 'invalid'}`);
	}

	const targets: BrandId[] = both ? ['asia', 'fusion'] : [brand];
	for (const t of targets) {
		// A human clicked Save → actor 'staff', on behalf of their own id.
		await upsertContent(t, key, result.data, 'staff', staff.id);
	}

	return json({ ok: true, appliedToBoth: Boolean(both) });
};
