// Where the embedded widget lands a guest once the booking is taken.
//
// WHY THIS EXISTS ALONGSIDE /{brand}/booking-confirmation
// ------------------------------------------------------
// That page was written for ResDiary and describes itself as bare — but it sits
// under the brand layout, so it renders with the site nav, the guest-assistant
// button and the cookie banner. Full-page that's right. Inside a 440px frame it
// is three pieces of furniture stacked on top of a five-line message, with a
// consent banner the host page has already asked about.
//
// So the embed gets its own confirmation, under the chromeless /embed layout,
// reusing the same component and the same ResDiary query-string contract. The
// original page is untouched and still serves ResDiary's own redirect.

import { error } from '@sveltejs/kit';
import { getBrand } from '$lib/data/brand.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (params.brand !== 'asia' && params.brand !== 'fusion') {
		throw error(404, 'Unknown restaurant.');
	}
	const brand = getBrand(params.brand);
	return { brand };
};
