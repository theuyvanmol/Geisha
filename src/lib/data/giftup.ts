// Gift Up! hosted gift-voucher checkout.
//
// We keep our own on-brand denomination picker (GiftCardPanel) and hand off to
// Gift Up's HOSTED checkout with a specific voucher pre-selected — Gift Up then
// takes the card payment, issues the voucher, emails it and handles redemption
// entirely on their side (nothing sensitive touches this site).
//
// The account sells FIXED-value vouchers (£25/£50/£100) as separate products per
// brand, so we hand off with `?productid=…` to land the buyer directly on the
// right brand+amount voucher. (There's no custom-amount product, so a custom £
// value / £75 can't be fulfilled — add a flexible-value item in Gift Up if you
// want that.)
//
// The site-id is a PUBLIC identifier (it ships in the browser inside the
// checkout URL); it can be overridden per brand in admin → Settings →
// Integrations (`giftup_site_id`) without a deploy.

import type { BrandId } from './brand';

/** Geisha Restaurants' Gift Up account site-id (public). */
export const DEFAULT_GIFTUP_SITE_ID = 'a4a60d5e-b1cb-4a01-8175-08daceea1aee';

/**
 * The fixed voucher amounts (£) sold by the Gift Up account → the Gift Up
 * "item for sale" product id for each brand.
 *
 * Source of truth is the account's public checkout manifest:
 *   https://cdn.giftup.app/assets/<siteId>/checkout.manifest.json
 * If you add, remove or re-price vouchers in Gift Up, update this map to match.
 */
export const GIFTUP_PRODUCTS: Record<BrandId, Record<number, string>> = {
	asia: {
		25: 'f2a39c89-4f65-4fbf-6757-08dacee95e95',
		50: '6bcb055a-e68e-48c9-e712-08daceeb19d1',
		100: '7670479e-7459-4548-77cc-08dad8436e2c'
	},
	fusion: {
		25: '4a7b5b23-d7d8-4fb1-71b5-08db6b2f177a',
		50: '6dab4da5-cfba-4343-71b6-08db6b2f177a',
		100: '9ff33e75-e48b-4fb3-85fb-08db6b2b55e6'
	}
};

/** The amounts we offer on the picker, in order (same set for both brands). */
export function giftUpAmounts(brand: BrandId): number[] {
	return Object.keys(GIFTUP_PRODUCTS[brand])
		.map(Number)
		.sort((a, b) => a - b);
}

/** The Gift Up product id for a brand+amount, or '' if that amount isn't sold. */
export function giftUpProductId(brand: BrandId, amount: number): string {
	return GIFTUP_PRODUCTS[brand]?.[amount] ?? '';
}

/**
 * Build the Gift Up hosted-checkout URL. With a `productId` the buyer lands
 * directly on that voucher; otherwise they get the account's full item list.
 */
export function giftUpCheckoutUrl(siteId: string, productId?: string): string {
	const params = new URLSearchParams({ platform: 'hosted' });
	if (productId) params.set('productid', productId);
	return `https://giftup.app/place-order/${siteId}?${params}`;
}
