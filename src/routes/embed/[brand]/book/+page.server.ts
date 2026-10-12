// The embeddable booking widget: /embed/{asia|fusion}/book
//
// This is the page that goes inside the <iframe> on the restaurant's existing
// site, replacing the ResDiary widget. It is deliberately its own route rather
// than a query flag on /{brand}/bookings, because the two have opposite needs:
// that page is an art-directed marketing page with nav and footer; this one is a
// bare form that must render correctly in a 320px box on a site we don't control.
//
// POST-BOOKING REDIRECT
// ---------------------
// ResDiary redirects the frame to a URL configured in its account, passing the
// booking in the query string. We match that contract exactly (see
// $lib/bookings/confirmation.ts for the format) so the existing
// /{brand}/booking-confirmation page — written for ResDiary's parameters — works
// unchanged, and so the client can point us at their OWN thank-you page during
// the trial. The target is validated in ./redirect.ts.

import { error } from '@sveltejs/kit';
import { getBrand } from '$lib/data/brand.js';
import { safeRedirect } from './redirect.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	if (params.brand !== 'asia' && params.brand !== 'fusion') {
		throw error(404, 'Unknown restaurant.');
	}
	const brand = getBrand(params.brand);

	return {
		brand: {
			id: brand.id,
			name: brand.name,
			phone: brand.phone,
			email: brand.email
		},
		/** Validated post-booking target; '' = use our own confirmation page. */
		redirectTo: safeRedirect(url.searchParams.get('redirect'), url.origin),
		/**
		 * `?theme=dark` lets the host page match the widget to a dark section.
		 * Cosmetic only — the default light card is what the current WordPress
		 * booking page needs.
		 */
		theme: (url.searchParams.get('theme') === 'dark' ? 'dark' : 'light') as 'dark' | 'light'
	};
};
