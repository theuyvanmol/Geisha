// Content-domain tools for the admin assistant: READ the editable site content
// (the CMS keys — home copy, offers, reviews, media, menus, gallery, brand info)
// and OPEN an editable widget beside the chat pre-filled with the current blob OR
// the assistant's proposed rewrite (a UI directive — no data change). Mirrors the
// settings domain (toolsSettings.ts) one layer up:
//   list_settings  → list_content
//   open_settings  → open_content   (ui: bring the controls to them)
//   update_setting → (none — the human clicks Save on the widget, which POSTs to
//                     /api/admin/content; a blind model write would be worse
//                     parity and would muddy the 'staff' audit)
//
// This module also owns the content metadata the assistant shares — CONTENT_META
// (friendly label + surface hint + which widget editor renders each key) and
// contentCatalogue() for the system prompt. The widget descriptor `open_content`
// returns is validated leniently against the SAME Zod schema the save endpoint
// enforces, so we never open the editor on a blob the server would reject.

import { getContent, listContent, type ContentKey } from '$lib/server/content/content.js';
import { SCHEMA_BY_KEY } from '$lib/content/schema';
import { mediaSlotsFor, getMediaDefaults, type MediaSlot } from '$lib/data/media';
import { getPagesDefaults } from '$lib/data/pages';
import { getHomeDefaults } from '$lib/data/home';
import { getHomeExtraDefaults } from '$lib/data/home-extra';
import { getOffersDefaults } from '$lib/data/offers';
import { getReviewsDefaults } from '$lib/data/reviews';
import { getBrandInfoDefaults } from '$lib/data/brand';
import { getMenus } from '$lib/data/menus';
import { GALLERY } from '$lib/data/gallery';
import type { BrandId } from '$lib/server/db/types.js';
import type { GeminiTool, ToolContext } from './types.js';

/** Which inline widget renders a key, plus a friendly label + a one-line hint of
 *  what public surface it drives (so the system prompt reads naturally). Kept in
 *  sync with the /admin/content editors. */
export type ContentEditor = 'fields' | 'list' | 'media' | 'raw';

/** The content keys THIS domain's inline editor handles. Excludes `banner`, which
 *  has its own confirm-gated tools (toolsContentBanner.ts) — the assistant edits
 *  the banner via set_banner/hide_banner, not the open_content widget. */
export type ContentEditorKey = Exclude<ContentKey, 'banner'>;

export const CONTENT_META: Record<
	ContentEditorKey,
	{ label: string; surface: string; editor: ContentEditor }
> = {
	home: {
		label: 'Home page copy',
		surface: 'the hero eyebrow/title/lede and the statement + band copy on the home page',
		editor: 'fields'
	},
	home_extra: {
		label: 'Home editorial',
		surface:
			'the marquee words, the Asia walk-ins note, and the Fusion intro / featured-dishes / story bands',
		editor: 'fields'
	},
	brand_info: {
		label: 'Contact & about',
		surface: 'the tagline, about text, phone, email, address and opening hours',
		editor: 'fields'
	},
	offers: {
		label: 'Offers',
		surface: 'the offers strip on the home page and the /offers page (each offer has an image)',
		editor: 'list'
	},
	reviews: {
		label: 'Reviews',
		surface: 'the guest reviews strip, the /reviews page and the star-rating structured data',
		editor: 'list'
	},
	media: {
		label: 'Videos & hero images',
		surface: 'the landing tile videos, the hero video/image and the home feature images',
		editor: 'media'
	},
	menus: {
		label: 'Menus',
		surface: 'the menu sections, dishes, prices and dish photos',
		editor: 'raw'
	},
	gallery: {
		label: 'Gallery',
		surface: 'the photo gallery images',
		editor: 'raw'
	},
	pages: {
		label: 'Interior page copy',
		surface:
			'the wording on the Parties, Order Online, Privacy and Contact pages (supports {phone}/{email}/{postcode} placeholders that fill themselves in from Contact & about)',
		editor: 'raw'
	}
};

/** A widget descriptor the client turns into an editable ContentWidget. `value` is
 *  the whole blob to edit (seeded from the proposal or the live content); the
 *  client edits an in-place clone so untouched fields survive verbatim. */
export interface ContentWidgetDescriptor {
	/** Stable id (the key) — the store dedupes open widgets by it. */
	id: string;
	key: ContentEditorKey;
	label: string;
	surface: string;
	editor: ContentEditor;
	brand: BrandId;
	/** For the media editor: the labelled slots (label/kind/hint) for this brand. */
	mediaSlots?: MediaSlot[];
	/** The blob to edit — proposal (if the model passed one and it validates) else
	 *  the current live content merged over its hardcoded default. */
	value: unknown;
}

/** The live merged blob for a key: staff override (geisha_content) over the
 *  hardcoded data-file default, so the model always sees real current copy. */
async function currentContent(brand: BrandId, key: ContentEditorKey): Promise<unknown> {
	switch (key) {
		case 'home':
			return getContent(brand, 'home', getHomeDefaults(brand));
		case 'home_extra':
			return getContent(brand, 'home_extra', getHomeExtraDefaults(brand));
		case 'brand_info':
			return getContent(brand, 'brand_info', getBrandInfoDefaults(brand));
		case 'offers':
			return getContent(brand, 'offers', getOffersDefaults(brand));
		case 'reviews':
			return getContent(brand, 'reviews', getReviewsDefaults(brand));
		case 'media':
			return getContent(brand, 'media', getMediaDefaults(brand));
		case 'menus':
			return getContent(brand, 'menus', getMenus(brand));
		case 'gallery':
			return getContent(brand, 'gallery', GALLERY[brand]);
		case 'pages':
			return getContent(brand, 'pages', getPagesDefaults(brand));
	}
}

const KEYS = Object.keys(CONTENT_META) as ContentEditorKey[];
const isContentKey = (v: unknown): v is ContentEditorKey =>
	KEYS.includes(v as ContentEditorKey);

/** A plain-text catalogue of the editable content keys, for the system prompt so
 *  the model knows every key it can read/open and which surface each drives. */
export function contentCatalogue(): string {
	return KEYS.map((k) => `- ${k} — ${CONTENT_META[k].label}: ${CONTENT_META[k].surface}`).join('\n');
}

/** Content-domain tools for a brand. Read + one UI tool; no blind write. */
export function contentTools(ctx: ToolContext): GeminiTool[] {
	const { brand } = ctx;
	return [
		// --- READ ---------------------------------------------------------------
		{
			name: 'list_content',
			kind: 'read',
			description:
				'List the editable site-content areas (copy, offers, reviews, videos/images, menus, gallery) for this brand, with a friendly label and which are currently overridden vs the built-in default. Use to see what content you can change.',
			parameters: { type: 'object', properties: {} },
			run: async () => {
				const overridden = new Set((await listContent(brand)).map((r) => r.key));
				return KEYS.map((k) => ({
					key: k,
					label: CONTENT_META[k].label,
					surface: CONTENT_META[k].surface,
					overridden: overridden.has(k)
				}));
			}
		},
		{
			name: 'get_content',
			kind: 'read',
			description:
				'Read the CURRENT content blob for one key (e.g. "brand_info", "home", "offers") so you can see the existing copy before rewriting it. Always call this before proposing new copy so your rewrite is grounded in what is actually there. Returns the live merged value (staff override over the default).',
			parameters: {
				type: 'object',
				properties: {
					key: {
						type: 'string',
						description: `The content key. One of: ${KEYS.join(', ')}.`
					}
				},
				required: ['key']
			},
			run: async ({ key }: { key: string }) => {
				if (!isContentKey(key)) throw new Error(`Unknown content key: ${key}`);
				return { key, label: CONTENT_META[key].label, value: await currentContent(brand, key) };
			}
		},

		// --- UI (no data change) — bring the editor to them --------------------
		{
			name: 'open_content',
			kind: 'ui',
			description:
				'Open an editable content editor beside the chat, pre-filled so the admin can review and Save. Use this whenever the admin wants to change any site copy, offers, reviews, videos/images, menus or the gallery. To CHANGE COPY: first get_content, then write the improved copy YOURSELF and pass the FULL updated blob as `value` (keep every field you are not changing exactly as-is) — the admin sees your version pre-filled, tweaks it and clicks Save. For images/videos (key "media"), omit `value`: the editor opens with the current media and the admin picks/uploads a file. Nothing is saved until the admin clicks Save.',
			parameters: {
				type: 'object',
				properties: {
					key: {
						type: 'string',
						description: `The content key to open. One of: ${KEYS.join(', ')}.`
					},
					value: {
						description:
							'Optional — the FULL proposed content blob to pre-fill (the whole object/array for the key, with your edits applied and all other fields unchanged). Omit to open the current content unchanged (e.g. for picking a new image/video).'
					}
				},
				required: ['key']
			},
			run: async ({ key, value }: { key: string; value?: unknown }) => {
				if (!isContentKey(key)) return { opened: null, unknown: [key] };
				const current = await currentContent(brand, key);
				// Seed with the proposal if it passes the SAME schema the save endpoint
				// enforces; otherwise fall back to the live content so the editor never
				// opens on a blob the server would reject.
				let seed: unknown = current;
				if (value !== undefined) {
					const check = SCHEMA_BY_KEY[key].safeParse(value);
					seed = check.success ? check.data : current;
				}
				const meta = CONTENT_META[key];
				const widget: ContentWidgetDescriptor = {
					id: key,
					key,
					label: meta.label,
					surface: meta.surface,
					editor: meta.editor,
					brand,
					mediaSlots: key === 'media' ? mediaSlotsFor(brand) : undefined,
					value: seed
				};
				return { opened: key, widget, unknown: [] as string[] };
			}
		}
	];
}
