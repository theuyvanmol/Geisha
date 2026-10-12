// GET /api/admin/diagnostics?brand=fusion&days=14
//
// The same data as /admin/diagnostics, as JSON — so a developer can curl it,
// diff it between deploys, or pipe it through jq without scraping HTML. Owner-
// only, enforced both here and by the route map in $lib/admin/access.ts.
//
//   curl -s -b "$COOKIE" 'https://…/api/admin/diagnostics?days=2' | jq '.summary'

import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/auth/rbac.js';
import { getBookingDiagnostics } from '$lib/server/booking/diagnostics.js';
import type { BrandId } from '$lib/server/db/types.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireRole(locals.staff, 'owner');

	const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 14) || 14));
	const brandParam = url.searchParams.get('brand');
	const brands: BrandId[] =
		brandParam === 'asia' || brandParam === 'fusion' ? [brandParam] : ['asia', 'fusion'];

	const reports = await Promise.all(
		brands.map(async (brand) => ({ brand, ...(await getBookingDiagnostics(brand, days)) }))
	);

	// Single-brand requests return the report itself; the two-brand default nests,
	// so `jq '.summary'` works on the shape you asked for either way.
	return json(reports.length === 1 ? reports[0] : { days, reports });
};
