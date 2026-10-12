// Where a guest booking actually came from.
//
// WHY THIS EXISTS (Aug 2026, during the iframe changeover trial). Asked "have any
// real customers booked through the widget yet?", the honest answer was an
// inference: `source='online'` is written by exactly one code path (the public
// POST /api/bookings), and every admin/AI path writes 'phone'/'walkin' with
// staff:true — so an 'online' row cannot have been typed by staff in the back
// office. True, but it still couldn't tell an iframe on the client's WordPress
// page from someone opening the widget URL directly, and it required reading the
// source of five files to believe. This records the answer at the moment of the
// booking instead of reconstructing it afterwards.
//
// Nothing here is trusted for any DECISION — headers are guest-controlled and a
// spoofed Referer would only mislabel a row in a report. It is evidence for a
// human reading the trail, never an input to pricing, availability or access.

/** How the request reached us, as recorded against a booking. */
export interface BookingOrigin {
	/** Coarse bucket, the thing you actually scan a list for. */
	kind: 'iframe' | 'direct' | 'admin' | 'unknown';
	/** Host of the page the widget was embedded in / navigated from ('' if none). */
	site: string;
	/** Full referer, kept for the awkward cases (query strings, deep paths). */
	referer: string;
	/** Sec-Fetch-Dest: 'iframe' is the browser telling us it is framed. */
	dest: string;
	/** Sec-Fetch-Site: 'cross-site' + dest 'iframe' is the embed on another domain. */
	site_rel: string;
	/** Truncated UA — enough to tell a phone from a desktop, not a fingerprint. */
	ua: string;
}

const hostOf = (url: string): string => {
	try {
		return new URL(url).host;
	} catch {
		return '';
	}
};

/**
 * Read the origin off a request.
 *
 * `Sec-Fetch-Dest: iframe` is the strongest signal available: it is set by the
 * browser, not by our page, and it says the document issuing this fetch is itself
 * framed. Safari didn't ship Sec-Fetch-* until 16.4, so a missing header falls
 * back to the Referer host — an embed on geisharestaurants.co.uk still refers
 * from there, while a direct visit to the widget refers from our own host or
 * nowhere at all.
 */
export function describeOrigin(request: Request, selfHost = ''): BookingOrigin {
	const h = request.headers;
	const referer = h.get('referer') ?? '';
	const dest = h.get('sec-fetch-dest') ?? '';
	const siteRel = h.get('sec-fetch-site') ?? '';
	const site = hostOf(referer) || hostOf(h.get('origin') ?? '');

	// The fetch that creates a booking is issued BY the widget script, so its own
	// dest is 'empty' — what matters is which document it runs in, which the
	// Referer names. Treat "referred by a host that isn't us" as framed, and let
	// an explicit Sec-Fetch-Dest override either way.
	const framedByHeader = dest === 'iframe';
	const framedByReferer = Boolean(site) && Boolean(selfHost) && site !== selfHost;
	const kind: BookingOrigin['kind'] =
		framedByHeader || framedByReferer
			? 'iframe'
			: site && site === selfHost
				? 'direct'
				: 'unknown';

	return {
		kind,
		site,
		referer: referer.slice(0, 300),
		dest,
		site_rel: siteRel,
		ua: (h.get('user-agent') ?? '').slice(0, 160)
	};
}

/** One-line label for a diagnostics table. */
export function originLabel(o: Partial<BookingOrigin> | null | undefined): string {
	if (!o?.kind) return 'unknown';
	if (o.kind === 'iframe') return o.site ? `iframe on ${o.site}` : 'iframe';
	if (o.kind === 'direct') return o.site ? `direct (${o.site})` : 'direct';
	return o.kind;
}
