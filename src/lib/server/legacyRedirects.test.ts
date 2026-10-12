import { describe, it, expect } from 'vitest';
import { resolveLegacyRedirect } from './legacyRedirects';

describe('resolveLegacyRedirect', () => {
	it('maps renamed pages', () => {
		expect(resolveLegacyRedirect('/asia/contact-us')).toBe('/asia/contact');
		expect(resolveLegacyRedirect('/fusion/privacy-policy')).toBe('/fusion/privacy');
		expect(resolveLegacyRedirect('/fusion/parties-and-functions')).toBe('/fusion/parties');
		expect(resolveLegacyRedirect('/asia/private-dining')).toBe('/asia/parties');
	});

	// Every old WordPress URL carries a trailing slash, so this is the common case
	// rather than an edge case.
	it('matches with the trailing slash the old site actually used', () => {
		expect(resolveLegacyRedirect('/asia/contact-us/')).toBe('/asia/contact');
		expect(resolveLegacyRedirect('/fusion/parties-and-functions/')).toBe('/fusion/parties');
	});

	it('sends the retired at-home shop to the order page', () => {
		for (const p of [
			'/asia/at-home',
			'/asia/order-now',
			'/asia/basket',
			'/asia/checkout',
			'/asia/my-account',
			'/asia/download-geisha-at-home-app'
		]) {
			expect(resolveLegacyRedirect(p)).toBe('/asia/order');
		}
		expect(resolveLegacyRedirect('/fusion/checkout')).toBe('/fusion/order');
	});

	it('sends old dish and category pages to the menus page', () => {
		expect(resolveLegacyRedirect('/asia/product/asian-pork-ribs-2')).toBe('/asia/menus');
		expect(resolveLegacyRedirect('/asia/product/avocado-nigiri-2-pieces/')).toBe('/asia/menus');
		expect(resolveLegacyRedirect('/fusion/product-category/desserts')).toBe('/fusion/menus');
	});

	// The reason this file exists: these URLs are on table QR codes and in Google.
	it('sends every menu PDF to that brand’s menus page', () => {
		expect(
			resolveLegacyRedirect('/asia/wp-content/uploads/2026/02/geisha_asia_menu_a3_jan26_web.pdf')
		).toBe('/asia/menus');
		expect(
			resolveLegacyRedirect('/asia/wp-content/uploads/2026/06/geisha_asia_kids_menu_jun26.pdf')
		).toBe('/asia/menus');
		expect(
			resolveLegacyRedirect('/fusion/wp-content/uploads/2026/02/g_fusion_main_menu_jan26_web.pdf')
		).toBe('/fusion/menus');
		expect(
			resolveLegacyRedirect('/fusion/wp-content/uploads/2026/04/geisha_fusion_drinks_mar26_web.pdf')
		).toBe('/fusion/menus');
	});

	it('sends the function-room PDF to parties, not menus', () => {
		expect(
			resolveLegacyRedirect(
				'/fusion/wp-content/uploads/2025/01/geisha_fusion_function_room_a4_folded_jan25-1.pdf'
			)
		).toBe('/fusion/parties');
	});

	it('folds the retired Italia brand into Fusion', () => {
		expect(resolveLegacyRedirect('/italia')).toBe('/fusion');
		expect(resolveLegacyRedirect('/italia/')).toBe('/fusion');
		expect(resolveLegacyRedirect('/italia/menus')).toBe('/fusion');
		expect(
			resolveLegacyRedirect('/italia/wp-content/uploads/2023/03/geisha_italia_kids_menu_mar23_web.pdf')
		).toBe('/fusion/menus');
	});

	it('collapses WordPress archives and feeds onto the brand home', () => {
		expect(resolveLegacyRedirect('/asia/category/uncategorised')).toBe('/asia');
		expect(resolveLegacyRedirect('/fusion/author/admin')).toBe('/fusion');
		expect(resolveLegacyRedirect('/asia/feed')).toBe('/asia');
		expect(resolveLegacyRedirect('/asia/comments/feed')).toBe('/asia');
	});

	// A rule that swallowed a live route would take down a real page, so this is
	// the most important assertion in the file.
	it('leaves every current route alone', () => {
		for (const p of [
			'/',
			'/asia',
			'/fusion',
			'/asia/menus',
			'/asia/menus/main',
			'/asia/bookings',
			'/asia/booking-confirmation',
			'/fusion/booking-confirmation',
			'/fusion/bookings',
			'/fusion/gift-cards',
			'/asia/order',
			'/asia/contact',
			'/asia/privacy',
			'/fusion/parties',
			'/admin',
			'/admin/diary',
			'/api/availability',
			'/book/abc123',
			'/sitemap.xml',
			'/robots.txt'
		]) {
			expect(resolveLegacyRedirect(p)).toBeNull();
		}
	});

	it('does not redirect images, only PDFs', () => {
		expect(
			resolveLegacyRedirect('/asia/wp-content/uploads/2023/03/cropped-geisha_icon-32x32.jpg')
		).toBeNull();
		expect(resolveLegacyRedirect('/fusion/wp-content/themes/twentytwenty-child/assets/css/local.css'))
			.toBeNull();
	});

	it('survives odd input without throwing', () => {
		expect(resolveLegacyRedirect('/asia/CONTACT-US/')).toBe('/asia/contact');
		expect(resolveLegacyRedirect('/%E0%A4%A')).toBeNull();
		expect(resolveLegacyRedirect('/nope')).toBeNull();
	});
});
