// Content-banner tools for the admin assistant: read and control the sitewide
// announcement banner (admin → Content → Banner) — the promo strip pinned across
// the top of every public page for a brand, plus its optional home-page hero.
// This lets the operator say "put a banner up saying we've been nominated for the
// Uber Eats award, link it to the voting page" and have the assistant stage it.
//
// All wrap the SAME content layer the Banner editor uses (getContent / the
// `banner` key validated by BannerSchema), so the AI can never write a malformed
// banner and every change goes through the same fallback/validation path.
//
// Registered in the composer (./index.ts).

import { getContent, upsertContent } from '$lib/server/content/content.js';
import { getBannerDefault } from '$lib/data/banner';
import { BannerSchema, type BannerContent } from '$lib/content/schema';
import type { GeminiTool, ToolContext } from './types.js';

const STYLES = ['accent', 'gold', 'dark', 'light'] as const;

/** Content-banner tools for a brand. */
export function bannerContentTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;

	const read = () => getContent<BannerContent>(brand, 'banner', getBannerDefault(brand));

	return [
		// --- READ ---------------------------------------------------------------
		{
			name: 'get_banner',
			kind: 'read',
			description:
				"The site's announcement BANNER for this brand — the promo strip pinned to the top of every public page (plus an optional bigger version on the home page). Returns whether it's live, its heading/body text, image, the call-to-action button (label + link), style and whether the home hero is on. Use before changing it, or to answer 'what does our banner say?' / 'is a banner up?'.",
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const b = await read();
				return {
					enabled: b.enabled,
					live: b.enabled && b.heading.trim().length > 0,
					heading: b.heading,
					body: b.body,
					image: b.image || undefined,
					ctaLabel: b.ctaLabel || undefined,
					ctaHref: b.ctaHref || undefined,
					ctaNewTab: b.ctaNewTab,
					style: b.style,
					showHero: b.showHero
				};
			}
		},

		// --- WRITE (confirm-gated) ---------------------------------------------
		{
			name: 'set_banner',
			kind: 'write',
			description:
				"Create or update the site announcement banner for this brand (e.g. 'We've been nominated for Uber Eats Restaurant of the Year — vote now'). Set the heading, optional supporting text, an optional image URL, an optional call-to-action button (label + link — an external https URL or an internal path like /offers), a style, and whether to also show the big home-page hero. Pass enabled:true to publish it. Only the fields you provide change; the rest keep their current values, so you can tweak just the wording. A banner needs a heading AND enabled:true to actually show. WRITE action — must be confirmed before it runs.",
			parameters: {
				type: 'object',
				properties: {
					enabled: { type: 'boolean', description: 'Master on/off — true publishes the banner, false hides it everywhere.' },
					heading: { type: 'string', description: 'The bold headline (required for the banner to appear).' },
					body: { type: 'string', description: 'Optional supporting sentence under the heading.' },
					image: { type: 'string', description: 'Optional image/logo/badge URL (e.g. an award badge). Pass an empty string to remove it.' },
					ctaLabel: { type: 'string', description: "Button text, e.g. 'Vote now'. Needs ctaHref too." },
					ctaHref: { type: 'string', description: "Where the button links — a full https URL or an internal path like /offers. Pass an empty string to remove the button." },
					ctaNewTab: { type: 'boolean', description: 'Open the button link in a new tab (recommended for external links).' },
					style: { type: 'string', enum: [...STYLES], description: "Visual preset: 'accent' (brand colour), 'gold' (award look), 'dark', or 'light'." },
					showHero: { type: 'boolean', description: 'Also show the larger banner on the home page (the top strip shows regardless).' }
				}
			},
			run: async (args: Partial<BannerContent>) => {
				const current = await read();
				// Merge: only provided fields override the current banner.
				const merged: BannerContent = {
					enabled: args.enabled ?? current.enabled,
					heading: args.heading ?? current.heading,
					body: args.body ?? current.body,
					image: args.image ?? current.image,
					ctaLabel: args.ctaLabel ?? current.ctaLabel,
					ctaHref: args.ctaHref ?? current.ctaHref,
					ctaNewTab: args.ctaNewTab ?? current.ctaNewTab,
					style: args.style ?? current.style,
					showHero: args.showHero ?? current.showHero
				};
				const parsed = BannerSchema.safeParse(merged);
				if (!parsed.success) {
					const first = parsed.error.issues[0];
					return { ok: false, error: `Invalid banner: ${first?.path.join('.') || '(root)'} — ${first?.message ?? 'invalid'}` };
				}
				await upsertContent(brand, 'banner', parsed.data);
				const live = parsed.data.enabled && parsed.data.heading.trim().length > 0;
				return {
					ok: true,
					live,
					enabled: parsed.data.enabled,
					heading: parsed.data.heading,
					note: live
						? 'Banner is now live on the site.'
						: parsed.data.enabled
							? 'Saved, but it needs a heading to show.'
							: 'Saved as OFF — set enabled:true to publish it.'
				};
			}
		},
		{
			name: 'hide_banner',
			kind: 'write',
			description:
				'Take the announcement banner down (sets it to off) without deleting its text — so you can bring the same banner back later. WRITE action — must be confirmed before it runs.',
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const current = await read();
				await upsertContent(brand, 'banner', { ...current, enabled: false });
				return { ok: true, enabled: false, note: 'Banner is now hidden.' };
			}
		}
	];
}
