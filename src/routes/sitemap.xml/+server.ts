import { CIRCLE_LIVE, GALLERY_PAGE_LIVE } from '$lib/data/features';
import { getMenus } from '$lib/data/menus';
import { SITE_URL } from '$lib/seo';
import type { RequestHandler } from './$types';

const BRANDS = ['asia', 'fusion'] as const;

// Every indexable public page. Deliberately excludes /privacy and /book/<token>,
// which <Seo /> marks noindex — listing a page here and telling Google not to
// index it is a contradiction that shows up in Search Console as "Excluded by
// noindex tag" against a submitted URL.
const PAGES = [
	'',
	'/menus',
	'/bookings',
	'/order',
	'/offers',
	...(GALLERY_PAGE_LIVE ? ['/gallery'] : []),
	'/parties',
	'/gift-cards',
	'/reviews',
	'/contact'
];

export const GET: RequestHandler = () => {
	const urls: string[] = ['/'];
	for (const b of BRANDS) {
		for (const p of PAGES) urls.push(`/${b}${p}`);
		// The Circle page exists but currently renders "coming soon" — no point
		// asking Google to index a placeholder until it launches.
		if (CIRCLE_LIVE) urls.push(`/${b}/circle`);
		for (const m of getMenus(b)) urls.push(`/${b}/menus/${m.slug}`);
	}

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`).join('\n')}
</urlset>`;

	return new Response(body, {
		headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'max-age=3600' }
	});
};
