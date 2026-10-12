// Tools for the PUBLIC guest assistant. Every tool here is READ-ONLY and
// BRAND-LOCKED: the guest can only ask about the brand whose site they're on,
// and nothing here writes or reaches into the other brand's data. That makes
// the whole set safe to expose on the public "Ask Geisha" chat with no auth.
//
// The tools all wrap the SAME pure/server data functions the public site
// renders from (getAvailability, getMenu(s), getOffersDefaults, getContent +
// getBrandInfoDefaults) so the assistant can never drift from what a guest
// sees on the page.
//
// TWO KINDS here:
//   · READ tools (check_availability, lookup_menu, search_dishes, list_offers,
//     get_info) — the agent auto-runs them and feeds the JSON back into the
//     model, which then answers in prose.
//   · UI tools (show_availability, show_dishes, show_offers) — mirror the admin
//     `open_settings` pattern: they don't write anything, but the agent loop
//     pushes their result onto `directives[]` so the guest chat can render
//     tappable cards (time chips → the booking page, dish rows, offer rows)
//     BELOW the model's short spoken answer. Their result is also fed back to
//     the model like a read, so it stays aware of what it surfaced. The seed
//     prompt tells the model to call the matching show_* alongside the spoken
//     reply and keep the words brief.
//
// ALLERGEN SAFETY: search_dishes treats "unknown allergen data" as NOT safe —
// a dish with no/empty allergens[] is EXCLUDED from an allergen-free search
// rather than assumed clean, and every allergen-shaped result carries a note
// reminding the guest to confirm with staff. The seed prompt additionally
// forbids the model from ever guaranteeing a dish is allergen-free.

import { getAvailability } from '$lib/server/booking/index.js';
import { getPublicHours } from '$lib/server/booking/hours.js';
import { getMenu, getMenus, getMenuIndex } from '$lib/data/menus';
import { DIET_LABELS } from '$lib/data/menu-types';
import type { DietTag, MenuItem } from '$lib/data/menu-types';
import { getOffersDefaults } from '$lib/data/offers';
import { getBrandInfoDefaults } from '$lib/data/brand';
import { getContent } from '$lib/server/content/content.js';
import type { BrandId } from '$lib/server/db/types.js';
import type { GeminiTool } from './geminiAgent.js';

const dateStr = {
	type: 'string',
	description:
		"Date to check, as 'YYYY-MM-DD'. Resolve relative dates (e.g. 'this Saturday') first."
};

/** Reminder attached to every allergen-shaped result — data may be incomplete. */
const ALLERGEN_NOTE =
	'Allergen data may be incomplete and dishes are prepared in kitchens handling all 14 major allergens. Never treat this as a guarantee — always confirm with staff when booking and on arrival.';

/** Parse a loose time ('6:15pm','18:15','6pm') to canonical 24h 'HH:MM', or '' if
 *  unreadable. Lets the availability card focus on the time a guest actually asked for. */
function normaliseTime(input?: string): string {
	if (!input) return '';
	const m = input.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
	if (!m) return '';
	let h = Number(m[1]);
	const min = m[2] ? Number(m[2]) : 0;
	const mer = m[3];
	if (mer === 'pm' && h < 12) h += 12;
	if (mer === 'am' && h === 12) h = 0;
	if (h > 23 || min > 59) return '';
	return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** The `n` available times closest (by minutes) to `want`, chronologically ordered.
 *  Used when the exact requested slot isn't free but we still want a compact card. */
function nearestTimes(times: string[], want: string, n: number): string[] {
	const mins = (x: string) => {
		const [h, mm] = x.split(':').map(Number);
		return h * 60 + mm;
	};
	const target = mins(want);
	return [...times]
		.sort((a, b) => Math.abs(mins(a) - target) - Math.abs(mins(b) - target))
		.slice(0, n)
		.sort((a, b) => mins(a) - mins(b));
}

/** Expand DietTag codes to their human labels for the model. */
function labelTags(tags?: DietTag[]): string[] {
	return (tags ?? []).map((t) => DIET_LABELS[t]);
}

/** Shape a MenuItem into a flat, model-friendly object (labels, not codes). */
function shapeItem(item: MenuItem) {
	return {
		name: item.name,
		desc: item.desc,
		price: item.price,
		tags: labelTags(item.tags),
		allergens: item.allergens ?? []
	};
}

/** A shaped dish plus the menu it came from — the row shape used by search. */
type DishHit = ReturnType<typeof shapeItem> & { menuSlug: string; menuTitle: string };

/**
 * Shared dish-search core used by BOTH the read tool (search_dishes) and the UI
 * tool (show_dishes) so their filtering can never diverge. Same rules as before:
 *   · query — case-insensitive substring on name OR description.
 *   · dietTag — dish must carry the tag.
 *   · allergenFree — EXCLUDES dishes containing the allergen AND dishes whose
 *     allergen data is unknown/empty (unknown is never treated as safe).
 * Capped at 25 hits. Returns the rows plus a `capped` flag.
 */
function findDishes(
	brand: BrandId,
	{ query, dietTag, allergenFree }: { query?: string; dietTag?: DietTag; allergenFree?: string }
): { results: DishHit[]; capped: boolean } {
	const q = query?.trim().toLowerCase();
	const avoid = allergenFree?.trim().toLowerCase();
	const cap = 25;
	const results: DishHit[] = [];

	outer: for (const menu of getMenus(brand)) {
		for (const sec of menu.sections) {
			for (const item of sec.items) {
				// text query — name or description substring
				if (q) {
					const hay = `${item.name} ${item.desc ?? ''}`.toLowerCase();
					if (!hay.includes(q)) continue;
				}
				// dietary tag filter
				if (dietTag && !(item.tags ?? []).includes(dietTag)) continue;
				// allergen-free filter: unknown data is NOT safe
				if (avoid) {
					const allergens = item.allergens ?? [];
					if (allergens.length === 0) continue; // unknown ≠ safe → exclude
					if (allergens.some((a) => a.toLowerCase() === avoid)) continue; // contains it → exclude
				}
				results.push({ menuSlug: menu.slug, menuTitle: menu.title, ...shapeItem(item) });
				if (results.length >= cap) break outer;
			}
		}
	}

	return { results, capped: results.length >= cap };
}

/** Build the guest tool set, locked to a single brand. */
export function guestTools(brand: BrandId): GeminiTool[] {
	return [
		{
			name: 'check_availability',
			kind: 'read',
			description:
				'Check which times have a free table on a given date for a party size. Returns available time slots (or that none are free / a phone booking is needed for large parties).',
			parameters: {
				type: 'object',
				properties: {
					date: dateStr,
					partySize: { type: 'integer', description: 'Number of guests' }
				},
				required: ['date', 'partySize']
			},
			run: async ({ date, partySize }: { date: string; partySize: number }) => {
				const result = await getAvailability(brand, date, partySize);
				const times = result.slots.filter((s) => s.available).map((s) => s.time);
				return {
					date,
					partySize,
					requiresPhone: result.requiresPhone,
					availableTimes: times,
					anyAvailable: times.length > 0
				};
			}
		},
		{
			name: 'lookup_menu',
			kind: 'read',
			description:
				"Look up this restaurant's menus. With no slug, returns the list of menus (slug + title + subtitle). With a slug, returns that menu's sections and dishes (name, description, price, dietary labels, allergens). Use this instead of reciting menu facts from memory.",
			parameters: {
				type: 'object',
				properties: {
					slug: {
						type: 'string',
						description:
							"Optional menu slug (e.g. 'main', 'drinks', 'evening-special'). Omit to list all menus first."
					}
				},
				required: []
			},
			run: async ({ slug }: { slug?: string } = {}) => {
				if (!slug) {
					return { menus: getMenuIndex(brand) };
				}
				const menu = getMenu(brand, slug);
				if (!menu) {
					return {
						error: `No menu with slug '${slug}'.`,
						menus: getMenuIndex(brand)
					};
				}
				return {
					slug: menu.slug,
					title: menu.title,
					subtitle: menu.subtitle,
					sections: menu.sections.map((sec) => ({
						title: sec.title,
						note: sec.note,
						items: sec.items.map(shapeItem)
					})),
					note: ALLERGEN_NOTE
				};
			}
		},
		{
			name: 'search_dishes',
			kind: 'read',
			description:
				"Search this restaurant's dishes across all menus. Filter by a text query (matches name/description), a dietary tag, and/or an allergen to avoid. When allergenFree is given, dishes are EXCLUDED both when they contain that allergen AND when their allergen data is unknown/empty — unknown is never treated as safe. Prefer this for 'do you have anything vegan / nut-free / ...' questions.",
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Optional text to match in a dish name or description (case-insensitive).'
					},
					dietTag: {
						type: 'string',
						description: "Optional dietary tag to require: 'v', 'vg', 'gf', 'spicy' or 'new'.",
						enum: ['v', 'vg', 'gf', 'spicy', 'new']
					},
					allergenFree: {
						type: 'string',
						description:
							"Optional allergen to avoid, e.g. 'nuts', 'gluten', 'dairy', 'shellfish', 'fish', 'eggs', 'soy', 'sesame'. Dishes containing it OR with unknown allergen data are excluded."
					}
				},
				required: []
			},
			run: async ({
				query,
				dietTag,
				allergenFree
			}: { query?: string; dietTag?: DietTag; allergenFree?: string } = {}) => {
				const { results, capped } = findDishes(brand, { query, dietTag, allergenFree });
				return {
					count: results.length,
					capped,
					results,
					note: ALLERGEN_NOTE
				};
			}
		},
		{
			name: 'list_offers',
			kind: 'read',
			description:
				"List this restaurant's current offers / what's on (title, blurb, when it runs, headline price). Use this for questions about deals, specials, brunch or set menus.",
			parameters: { type: 'object', properties: {}, required: [] },
			run: async () => {
				return {
					offers: getOffersDefaults(brand).map((o) => ({
						title: o.title,
						blurb: o.blurb,
						when: o.when,
						price: o.price
					}))
				};
			}
		},
		{
			name: 'get_info',
			kind: 'read',
			description:
				"Get this restaurant's practical details: opening hours, phone, email, address and tagline. Use this instead of reciting hours/contact from memory (staff may have edited them).",
			parameters: { type: 'object', properties: {}, required: [] },
			run: async () => {
				// Contact details come from the editable brand_info blob; the HOURS come
				// from the live service periods (same rows as the diary), so the bot can't
				// quote a window we won't seat.
				const [info, hours] = await Promise.all([
					getContent(brand, 'brand_info', getBrandInfoDefaults(brand)),
					getPublicHours(brand)
				]);
				return {
					tagline: info.tagline,
					hours: hours.summary,
					lastBookings: hours.lastBookingNote,
					hoursNote: hours.note,
					phone: info.phone,
					email: info.email,
					address: info.address
				};
			}
		},

		// --- UI tools -----------------------------------------------------------
		// These don't write; their result is pushed to directives[] so the guest
		// chat renders a tappable card AND fed back to the model like a read. Call
		// the matching show_* alongside a short spoken answer (see the seed prompt).

		{
			name: 'show_availability',
			kind: 'ui',
			description:
				"Render a tappable card of available booking times for a date + party size (each time links straight to the booking page). Call this WHENEVER you tell a guest about availability, alongside a short spoken summary. Same data as check_availability — you don't also need to call that.",
			parameters: {
				type: 'object',
				properties: {
					date: dateStr,
					partySize: { type: 'integer', description: 'Number of guests' },
					preferredTime: {
						type: 'string',
						description:
							"Optional 24h 'HH:MM' the guest asked for (e.g. '18:15' for 6:15pm). When given, the card focuses on that slot plus a few either side and pre-selects it on the booking page. Omit only if the guest gave no time."
					}
				},
				required: ['date', 'partySize']
			},
			run: async ({
				date,
				partySize,
				preferredTime
			}: {
				date: string;
				partySize: number;
				preferredTime?: string;
			}) => {
				const result = await getAvailability(brand, date, partySize);
				const allTimes = result.slots.filter((s) => s.available).map((s) => s.time);

				// If the guest named a time, focus the card on it + a small window either
				// side rather than dumping every slot (buries the time they wanted, forces a
				// scroll). Fall back to the full list when no time was given.
				const want = normaliseTime(preferredTime);
				let times = allTimes;
				let focusedOn: string | undefined;
				if (want) {
					const idx = allTimes.indexOf(want);
					if (idx !== -1) {
						focusedOn = want;
						const WINDOW = 3; // up to 3 slots either side of the requested time
						times = allTimes.slice(Math.max(0, idx - WINDOW), idx + WINDOW + 1);
					} else if (allTimes.length > 8) {
						// Requested time not bookable — keep it compact: nearest slots.
						const near = nearestTimes(allTimes, want, 7);
						if (near.length) times = near;
					}
				}

				const params = new URLSearchParams({ date, party: String(partySize) });
				if (focusedOn) params.set('time', focusedOn);
				const bookHref = `/${brand}/bookings?${params.toString()}`;
				return {
					kind: 'availability' as const,
					date,
					partySize,
					times,
					truncated: times.length < allTimes.length,
					focusedOn,
					requestedUnavailable: !!want && !focusedOn,
					requiresPhone: result.requiresPhone,
					bookHref
				};
			}
		},
		{
			name: 'show_dishes',
			kind: 'ui',
			description:
				"Render a tappable card of dishes matching a text query, dietary tag and/or an allergen to avoid (same filtering as search_dishes — allergen-unknown dishes are excluded from allergenFree). Call this WHENEVER you list or recommend dishes, alongside a short spoken summary.",
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Optional text to match in a dish name or description (case-insensitive).'
					},
					dietTag: {
						type: 'string',
						description: "Optional dietary tag to require: 'v', 'vg', 'gf', 'spicy' or 'new'.",
						enum: ['v', 'vg', 'gf', 'spicy', 'new']
					},
					allergenFree: {
						type: 'string',
						description:
							"Optional allergen to avoid, e.g. 'nuts', 'gluten', 'dairy'. Dishes containing it OR with unknown allergen data are excluded."
					}
				},
				required: []
			},
			run: async ({
				query,
				dietTag,
				allergenFree
			}: { query?: string; dietTag?: DietTag; allergenFree?: string } = {}) => {
				const { results, capped } = findDishes(brand, { query, dietTag, allergenFree });
				return {
					kind: 'dishes' as const,
					capped,
					items: results.map((r) => ({
						name: r.name,
						desc: r.desc,
						price: r.price,
						tags: r.tags,
						allergens: r.allergens,
						menuSlug: r.menuSlug
					})),
					note: ALLERGEN_NOTE
				};
			}
		},
		{
			name: 'show_offers',
			kind: 'ui',
			description:
				"Render a tappable card of the current offers / what's on (each links to its menu). Call this WHENEVER you mention offers, deals, brunch or set menus, alongside a short spoken summary.",
			parameters: { type: 'object', properties: {}, required: [] },
			run: async () => {
				return {
					kind: 'offers' as const,
					items: getOffersDefaults(brand).map((o) => ({
						title: o.title,
						blurb: o.blurb,
						when: o.when,
						price: o.price,
						href: o.href ?? `/${brand}/offers`
					}))
				};
			}
		}
	];
}
