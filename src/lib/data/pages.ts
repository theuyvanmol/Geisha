// Editable copy for the interior pages that had none: Parties, Order, Privacy
// and Contact. Extracted verbatim out of the four panel components, so a brand
// with no saved override renders exactly what it rendered before the CMS.
//
// PLACEHOLDERS. The originals interpolated brand details straight into the copy
// ({brand.name}, {brand.email} …). Staff need to be able to rewrite the wording
// without hardcoding a phone number that then goes stale when it changes on the
// Text tab, so the copy keeps those values as `{token}` placeholders which
// fillTokens() substitutes at render time. Unknown tokens are left alone (they
// show as typed) rather than blanking out — a typo shouldn't silently delete
// text.
//
// EMPHASIS. Bodies go through <RichText>, so *stars* italicise and _underscores_
// underline. Privacy bodies additionally split on a blank line into separate
// paragraphs, and autolink email addresses (that's how the mailto: links in the
// original markup survive being turned into editable plain text).

import type { BrandId } from './brand';
import type { PagesContent } from '$lib/content/schema';

/** The brand fields available as `{token}` placeholders in page copy. */
export interface TokenSource {
	name: string;
	short: string;
	phone: string;
	email: string;
	address: { line1: string; city: string; postcode: string; metro: string };
	/** Brand id — not a placeholder itself, but builds the internal link tokens. */
	id?: string;
}

/**
 * Substitute `{token}` placeholders with this brand's live details.
 *
 * Reads the same brand_info the Text tab edits, so changing the phone number in
 * one place updates every page that mentions it. An unrecognised token is left
 * verbatim so a typo is visible instead of silently eating the text.
 */
export function fillTokens(text: string, brand: TokenSource): string {
	const base = brand.id ? `/${brand.id}` : '';
	const map: Record<string, string> = {
		name: brand.name,
		short: brand.short,
		phone: brand.phone,
		email: brand.email,
		line1: brand.address.line1,
		city: brand.address.city,
		postcode: brand.address.postcode,
		metro: brand.address.metro,
		// Ready-made hrefs, so copy can link the phone/email without the editor
		// having to know that a tel: URL must have the spaces stripped out.
		telHref: `tel:${(brand.phone ?? '').replace(/\s/g, '')}`,
		mailtoHref: `mailto:${brand.email}`,
		// Internal link targets, so brand-relative hrefs in copy stay correct.
		bookingsHref: `${base}/bookings`,
		menusHref: `${base}/menus`,
		offersHref: `${base}/offers`,
		contactHref: `${base}/contact`
	};
	return (text ?? '').replace(/\{(\w+)\}/g, (whole, key) => map[key] ?? whole);
}

/**
 * Build the placeholder source for a brand.
 *
 * `brandInfo` is the editable override (from the Text tab) and wins where it has
 * a value; `name`/`short` aren't editable so they always come from the Brand.
 * Blank override fields fall through to the Brand so a half-filled save can't
 * wipe the phone number out of every page that mentions it.
 */
export function tokenSource(
	brand: TokenSource,
	brandInfo?: Partial<TokenSource> | null
): TokenSource {
	const pick = (a: string | undefined, b: string) => (a && a.trim() ? a : b);
	return {
		id: brand.id,
		name: brand.name,
		short: brand.short,
		phone: pick(brandInfo?.phone, brand.phone),
		email: pick(brandInfo?.email, brand.email),
		address: {
			line1: pick(brandInfo?.address?.line1, brand.address.line1),
			city: pick(brandInfo?.address?.city, brand.address.city),
			postcode: pick(brandInfo?.address?.postcode, brand.address.postcode),
			metro: pick(brandInfo?.address?.metro, brand.address.metro)
		}
	};
}

/** Split a body field into paragraphs on blank lines. */
export function paragraphs(text: string): string[] {
	return (text ?? '')
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
}

const PARTIES_OCCASIONS = [
	'Birthday',
	'Engagement',
	'Anniversary',
	'Hen party',
	'Bottomless brunch',
	'Baby shower',
	'Christening',
	'Graduation',
	'Private dining',
	'Business / networking',
	'Office party',
	'Leaving party',
	'Wake',
	'Other'
];

/** The defaults, identical for both brands (they differ only via placeholders). */
function defaults(): PagesContent {
	return {
		parties: {
			title: 'Parties & Functions',
			lead: 'Our space, your occasion.',
			intro:
				'Planning a special occasion often means finding the right room. Our function space is built for celebrations of every kind — from birthdays and engagements to baby showers, office parties and wakes. Stylish decor, a proper sound system and versatile lighting, with our team on hand to help with everything from decorations to entertainment.',
			occasions: PARTIES_OCCASIONS,
			enquiryHeading: 'Make an enquiry',
			thanks:
				'Thank you — your enquiry is in. Our functions team will be in touch shortly. For anything urgent, call [{phone}]({telHref}).',
			altLine: 'Or call us directly on [{phone}]({telHref}).',
			// The private-hire leaflet. Empty until the artwork is dropped into
			// /static and this is pointed at it (Content → Pages → Parties), at which
			// point the download button appears on the page by itself.
			leafletUrl: '',
			leafletLabel: 'Download our private hire leaflet'
		},
		order: {
			eyebrow: 'At home',
			title: 'Order Online',
			lead: 'Geisha, at home. Delivery, takeaway or collection.',
			deliveryProvider: 'via Uber Eats',
			deliveryHeading: 'Get it delivered',
			deliveryBody: 'Our full at-home menu, brought to your door by Uber~Eats.',
			deliveryFine: 'Delivery times and area set by Uber Eats.',
			takeawayProvider: 'straight from {short}',
			takeawayHeading: 'Takeaway & collection',
			takeawayBody: 'Order ahead for takeaway and pick up fresh from the restaurant.',
			takeawayCtaLabel: 'Order for Takeaway',
			takeawayFine: 'Collection from {line1}, {postcode}.'
		},
		privacy: {
			title: 'Privacy & Cookie Policy',
			subtitle: '{name} · Front Street, Benton, Newcastle Upon Tyne, {postcode}',
			sections: [
				{
					heading: 'Who we are',
					body: 'This policy applies to {name}. If you have any questions, contact us at {email} or {phone}.'
				},
				{
					heading: 'What we collect',
					body: 'When you book a table, make an enquiry, buy a gift voucher or join our mailing list, we collect the details you provide (such as your name, email, phone number and booking preferences). We use these only to provide the service you asked for and, where you’ve agreed, to send you news and offers. You can unsubscribe from marketing at any time.'
				},
				{
					heading: 'Payments',
					body: 'Card payments (deposits and gift vouchers) are processed securely by our payment provider. We do not store your full card details on our servers.'
				},
				{
					heading: 'Cookies',
					body: 'The site sets no cookies of its own. If you accept on our cookie banner, we load two things that can set cookies of theirs: Google Analytics (through Google Tag Manager), which tells us how the site is used; and the Meta pixel, which tells us whether our Facebook and Instagram ads brought you here. If you decline, neither loads. If a booking needs a card, the secure card form is loaded from our payment provider, Stripe, which sets the cookies it needs to take the payment and prevent fraud. You can change your mind at any time from the Cookies link in the footer, and you can also control cookies through your browser settings.'
				},
				{
					heading: 'Your rights',
					body: 'You can ask us for a copy of the data we hold about you, ask us to correct it, or ask us to delete it. To do so, contact {email}.'
				},
				{
					// WORD FOR WORD AS THE OWNER SUPPLIED IT (2026-08-06). This is a
					// licensing statement, so it is not ours to tidy — don't reword it,
					// don't re-add anything below, and change it only on their say-so.
					//
					// It replaced "Sale of Alcohol Policy" outright, and with it the two
					// things that policy used to say: an explicit "we do not serve alcohol
					// to anyone under the age of 18", and a closing "any breach of these
					// rules may result in management asking you to leave". The owner was
					// told both were going. (The 16–17 exception had already been cut on
					// 2026-08-03 — "this doesn't apply here".)
					//
					// Both brands run this now. Asia carries a `pages` override row in
					// geisha_content, so editing this default alone only reaches Fusion —
					// the DB row has to be edited to match, or Asia keeps the old text.
					heading: 'Challenge 25',
					body: 'We operate a Challenge 25 policy. If you are lucky enough to look under 25, you may be asked to provide valid photographic ID when purchasing or consuming alcohol.\n\nAccepted ID must be valid and show your photograph and date of birth.'
				}
			]
		},
		contact: {
			title: 'Contact',
			lead: '{name} · {line1}, {postcode}',
			thanks: 'Thanks — your message is on its way. We’ll reply by email soon.',
			formNote: 'For table reservations, please use the [bookings page]({bookingsHref}).',
			// Google Maps embed on the restaurant itself. Editable (Content → Pages) so
			// a move or a second site needs no code change.
			//
			// This is the classic `maps.google.com/maps?...&output=embed` iframe, NOT
			// the Maps Embed API — it needs no API key, no Cloud Console project and no
			// billing account. `q=lat,lng (Label)` pins the exact coordinates instead of
			// trusting Google to geocode the address string.
			//
			// THE COORDINATES ARE THE FIDDLY BIT — this marker has been wrong twice:
			//   55.0175 , -1.5725    ~730m north, out by Quorum Business Park.
			//   55.01095, -1.57133   ~25m east — in the middle of Front Street.
			// These are Google's own for the Geisha listing, read off the place URL
			// (the `!3d…!4d…` pair that follows the place id, which is the building —
			// NOT the `@lat,lng` right after /place/, which is only where the map
			// viewport happened to be centred). Don't "tidy" them by rounding.
			mapEmbedUrl:
				'https://maps.google.com/maps?q=55.0108685,-1.5716901+(Geisha)&z=17&hl=en&output=embed',
			mapLinkUrl: 'https://www.google.com/maps/search/?api=1&query=55.0108685%2C-1.5716901'
		}
	};
}

/** Default page copy for a brand — the fallback when no override is saved. */
export function getPagesDefaults(_brand: BrandId): PagesContent {
	// Both brands start from the same copy; the placeholders localise it. Built
	// fresh each call so a caller mutating the result can't poison the defaults.
	return defaults();
}
