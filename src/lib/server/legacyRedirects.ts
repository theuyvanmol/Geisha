// 301s from the old WordPress site's URLs to their equivalents here.
//
// WHY
// ---
// geisharestaurants.co.uk ran three WordPress installs — /asia, /fusion and the
// retired /italia — and this rebuild uses different paths for almost everything.
// The moment DNS moves, every old URL that Google has indexed, that's linked
// from social, or that's printed on a table QR code starts 404ing. The menus are
// the sharp end: every one was a PDF on a wp-content upload path, and none of
// those paths exist here.
//
// The map below was built by crawling the live site's own sitemaps
// (/asia/wp-sitemap.xml and /fusion/wp-sitemap.xml, 238 URLs) and then fetching
// every content page to collect the 29 PDFs the sitemaps don't list.
//
// WHAT ISN'T HERE, ON PURPOSE
// ---------------------------
// * Images under wp-content (139 jpg / 47 png). Redirecting a dead image to an
//   HTML page is worse than a 404 — Google wants gone media gone, and a browser
//   asking for a .jpg should not be handed a web page.
// * /wp-admin, /wp-login.php, /xmlrpc.php, /wp-json. Nothing legitimate links to
//   them and 404 is the right answer for automated traffic.
//
// Only add a rule here when a real old URL maps to a real new page. A redirect
// to something merely adjacent is worse than a 404: it wastes the visitor's time
// and tells Google the two pages are equivalent when they aren't.

/** Old path (no trailing slash, lowercase) → new path. */
const EXACT: Record<string, string> = {
	// --- Asia -----------------------------------------------------------------
	'/asia/about-us': '/asia',
	'/asia/contact-us': '/asia/contact',
	'/asia/privacy-policy': '/asia/privacy',
	'/asia/private-dining': '/asia/parties',
	// The "Geisha at Home" WooCommerce shop; collection/delivery now lives on the
	// order page (Uber Eats + Touch Takeaway).
	'/asia/at-home': '/asia/order',
	'/asia/order-now': '/asia/order',
	'/asia/order-holding': '/asia/order',
	'/asia/basket': '/asia/order',
	'/asia/checkout': '/asia/order',
	'/asia/my-account': '/asia/order',
	'/asia/download-geisha-at-home-app': '/asia/order',
	// Leftover scaffolding that nonetheless sits in the live sitemap.
	'/asia/hello-world': '/asia',
	'/asia/richard-test': '/asia',

	// --- Fusion ---------------------------------------------------------------
	'/fusion/contact-us': '/fusion/contact',
	'/fusion/privacy-policy': '/fusion/privacy',
	'/fusion/private-dining': '/fusion/parties',
	'/fusion/parties-and-functions': '/fusion/parties',
	'/fusion/landingpage_f/geisha-italia-party-or-function-booking': '/fusion/parties',
	'/fusion/geisha-fusion-christmas': '/fusion/offers',
	'/fusion/at-home': '/fusion/order',
	'/fusion/order-now': '/fusion/order',
	'/fusion/order-holding': '/fusion/order',
	'/fusion/basket': '/fusion/order',
	'/fusion/checkout': '/fusion/order',
	'/fusion/my-account': '/fusion/order',
	'/fusion/homepage': '/fusion',
	'/fusion/hello-world': '/fusion',
	'/fusion/booking-test': '/fusion/bookings'
};

/**
 * PDFs that aren't menus. Everything else under wp-content ending .pdf is a
 * menu and goes to that brand's menus page.
 */
const PDF_EXCEPTIONS: Record<string, string> = {
	'/fusion/wp-content/uploads/2025/01/geisha_fusion_function_room_a4_folded_jan25-1.pdf':
		'/fusion/parties'
};

const BRANDS = ['asia', 'fusion'] as const;

/**
 * Resolve an incoming path to a legacy redirect target, or null to let normal
 * routing handle it.
 *
 * Trailing slashes are stripped before matching because every old WordPress URL
 * carries one — matching them here sends the visitor straight to the new page
 * instead of bouncing them through SvelteKit's own slash-stripping redirect
 * first.
 */
export function resolveLegacyRedirect(pathname: string): string | null {
	// Decode so an escaped path still matches; a malformed escape is not a legacy
	// URL, so fall back to the raw value rather than throwing.
	let path = pathname;
	try {
		path = decodeURIComponent(pathname);
	} catch {
		// keep the raw path
	}

	path = path.toLowerCase();
	if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');
	if (!path) return null;

	const exact = EXACT[path];
	if (exact) return exact;

	// The retired third brand. Geisha Italia became Fusion, so its menus map to
	// Fusion's menus and everything else to the Fusion home page.
	if (path === '/italia' || path.startsWith('/italia/')) {
		return path.endsWith('.pdf') ? '/fusion/menus' : '/fusion';
	}

	for (const brand of BRANDS) {
		if (!path.startsWith(`/${brand}/`)) continue;

		// Every menu used to be a PDF on an upload path. None of them exist here —
		// the menus are rendered from the database now — so they all land on the
		// brand's menus page rather than 404ing a QR code on a table.
		if (path.startsWith(`/${brand}/wp-content/uploads/`) && path.endsWith('.pdf')) {
			return PDF_EXCEPTIONS[path] ?? `/${brand}/menus`;
		}

		// The old at-home shop: individual dish pages and their categories.
		if (
			path.startsWith(`/${brand}/product/`) ||
			path.startsWith(`/${brand}/product-category/`)
		) {
			return `/${brand}/menus`;
		}

		// WordPress author archives, category archives and RSS feeds.
		if (
			path.startsWith(`/${brand}/author/`) ||
			path.startsWith(`/${brand}/category/`) ||
			path === `/${brand}/feed` ||
			path.endsWith('/comments/feed') ||
			path.endsWith(`/${brand}/feed`)
		) {
			return `/${brand}`;
		}
	}

	return null;
}
