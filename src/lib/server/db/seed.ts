// Seed script for the Geisha booking system (PLACEHOLDER data).
//
// Run with:  npm run seed   (uses vite-node so .ts runs on any Node version)
//
// It is IDEMPOTENT: it upserts the two restaurants, their service periods,
// default settings, and a placeholder set of tables per brand. Running it again
// updates rather than duplicates. Safe to re-run after you replace the
// placeholder table inventory with the real one.
//
// ⚠️ PLACEHOLDER TABLES: the table counts/sizes below are invented so the
// availability engine and floor plan have something to work against. Replace
// with the real inventory (BOOKING_SYSTEM_PLAN.md §13 Q2) and re-run.

import PocketBase from 'pocketbase';
import { readFileSync } from 'node:fs';

// Minimal .env loader (no dependency) — populates process.env from ./.env
try {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
} catch {
	// no .env file — rely on real environment
}

const URL = process.env.POCKETBASE_URL;
const EMAIL = process.env.POCKETBASE_ADMIN_EMAIL;
const PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD;

if (!URL || !EMAIL || !PASSWORD) {
	console.error('Missing POCKETBASE_URL / POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD.');
	console.error('Run with: node --env-file=.env src/lib/server/db/seed.ts');
	process.exit(1);
}

const pb = new PocketBase(URL);
pb.autoCancellation(false);

/** Find one record by filter, or null. */
async function findOne(collection: string, filter: string) {
	try {
		return await pb.collection(collection).getFirstListItem(filter);
	} catch {
		return null;
	}
}

/** Upsert: update if a record matching `filter` exists, else create. */
async function upsert(collection: string, filter: string, data: Record<string, unknown>) {
	const existing = await findOne(collection, filter);
	if (existing) return pb.collection(collection).update(existing.id, data);
	return pb.collection(collection).create(data);
}

// PocketBase filter-escape for string literals
const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

type SeedTable = {
	label: string;
	seats_min: number;
	seats_max: number;
	section: string;
	bookable: boolean;
	x: number;
	y: number;
};

// Placeholder layouts. x/y are a rough grid for the floor-plan editor to refine.
const ASIA_TABLES: SeedTable[] = [
	{ label: 'A1', seats_min: 1, seats_max: 2, section: 'Window', bookable: true, x: 40, y: 40 },
	{ label: 'A2', seats_min: 1, seats_max: 2, section: 'Window', bookable: true, x: 160, y: 40 },
	{ label: 'A3', seats_min: 2, seats_max: 4, section: 'Main', bookable: true, x: 280, y: 40 },
	{ label: 'A4', seats_min: 2, seats_max: 4, section: 'Main', bookable: true, x: 400, y: 40 },
	{ label: 'A5', seats_min: 2, seats_max: 4, section: 'Main', bookable: true, x: 40, y: 180 },
	{ label: 'A6', seats_min: 2, seats_max: 4, section: 'Main', bookable: true, x: 160, y: 180 },
	{ label: 'A7', seats_min: 4, seats_max: 6, section: 'Main', bookable: true, x: 280, y: 180 },
	{ label: 'A8', seats_min: 4, seats_max: 6, section: 'Main', bookable: true, x: 400, y: 180 },
	{ label: 'A9', seats_min: 6, seats_max: 8, section: 'VIP', bookable: true, x: 40, y: 320 },
	{ label: 'A10', seats_min: 1, seats_max: 2, section: 'Bar', bookable: false, x: 200, y: 320 }
];

const FUSION_TABLES: SeedTable[] = [
	{ label: 'F1', seats_min: 1, seats_max: 2, section: 'Window', bookable: true, x: 40, y: 40 },
	{ label: 'F2', seats_min: 2, seats_max: 4, section: 'Main', bookable: true, x: 160, y: 40 },
	{ label: 'F3', seats_min: 2, seats_max: 4, section: 'Main', bookable: true, x: 280, y: 40 },
	{ label: 'F4', seats_min: 2, seats_max: 4, section: 'Main', bookable: true, x: 400, y: 40 },
	{ label: 'F5', seats_min: 4, seats_max: 6, section: 'Main', bookable: true, x: 40, y: 180 },
	{ label: 'F6', seats_min: 4, seats_max: 6, section: 'Main', bookable: true, x: 160, y: 180 },
	{ label: 'F7', seats_min: 4, seats_max: 8, section: 'Main', bookable: true, x: 280, y: 180 },
	{ label: 'F8', seats_min: 8, seats_max: 12, section: 'VIP', bookable: true, x: 40, y: 320 },
	{ label: 'F9', seats_min: 1, seats_max: 3, section: 'Outdoor', bookable: false, x: 220, y: 320 }
];

// Default guest-assistant system prompt per brand. This grounds the public
// "Ask Geisha" chat. Staff edit it in admin → Settings → Guest assistant; the
// seed only sets a starting point and (see seedBrand) WON'T clobber an edited
// value on re-run. Facts mirror src/lib/data/brand.ts.
const ASIA_ASSISTANT_PROMPT = `You are the friendly guest assistant for Geisha Asia, a modern Japanese-inspired, pan-Asian restaurant.

ABOUT
- Geisha Asia serves sushi, dim sum and pan-Asian dishes in a Japanese-garden-inspired room. Great for romantic dinners, family meals and nights out.
- It shares a building with its sister restaurant, Geisha Fusion (global family fusion — burgers, curry, pizza, Sunday roast). If a guest wants those, point them to Geisha Fusion.

LOCATION
- Front Street, Benton, Newcastle Upon Tyne, NE12 8AE.
- Nearest Metro: Four Lane Ends (about 0.4 miles / a short walk).

USE YOUR TOOLS — DON'T GUESS
You have live tools; prefer them over reciting facts from memory (staff may have edited hours, menus or offers):
- get_info — opening hours, phone, email and address. Use this for any "when are you open / how do I contact you" question.
- lookup_menu — list the menus, or fetch one menu's dishes (name, description, price, dietary labels, allergens). Call with no slug first to see what menus exist.
- search_dishes — find dishes across all menus by keyword, dietary need (vegetarian/vegan/gluten-free/spicy) or an allergen to avoid.
- list_offers — current offers / specials / brunch / set menus.
- check_availability — whether a date + party size has free tables.

MENUS & ALLERGENS
- We offer sushi, sashimi, dim sum, robata/charcoal dishes, pan-Asian mains, drinks and desserts. Use lookup_menu / search_dishes to answer specifics — don't recite dishes or prices from memory.
- For dietary or allergy questions, use search_dishes (with dietTag or allergenFree) and report what it returns.
- ALLERGENS: many dishes contain or may contain fish, shellfish, soy, sesame, gluten, eggs, dairy and nuts, and allergen data may be incomplete. NEVER guarantee a dish is free of an allergen — even if the tool doesn't list it. Always tell guests with allergies or intolerances to inform a member of staff when booking and on arrival so the kitchen can advise — their safety comes first.

BOOKING
- Bookings are made on the website's booking page. For parties of 6+, a deposit may apply.
- Delivery is via Uber Eats; collection via Touch Takeaway.

HOW TO BEHAVE
- Be warm, concise and helpful, like a knowledgeable host.
- Only answer about Geisha; if asked something unrelated, gently steer back.
- If a tool has no answer (a specific dish, today's special, availability), say so honestly and suggest calling or using the booking page rather than guessing.
- Never invent menu items, prices, offers or availability — if it's not in a tool result, you don't know it.`;

const FUSION_ASSISTANT_PROMPT = `You are the friendly guest assistant for Geisha Fusion, a relaxed global-fusion family restaurant.

ABOUT
- Geisha Fusion serves global comfort food — burgers, curries, pizza, and a Sunday roast — perfect for families and groups.
- It shares a building with its sister restaurant, Geisha Asia (modern Japanese / pan-Asian — sushi, dim sum). If a guest wants those, point them to Geisha Asia.

LOCATION
- Front Street, Benton, Newcastle Upon Tyne, NE12 8AE.
- Nearest Metro: Four Lane Ends (about 0.4 miles / a short walk).

USE YOUR TOOLS — DON'T GUESS
You have live tools; prefer them over reciting facts from memory (staff may have edited hours, menus or offers):
- get_info — opening hours, phone, email and address. Use this for any "when are you open / how do I contact you" question.
- lookup_menu — list the menus, or fetch one menu's dishes (name, description, price, dietary labels, allergens). Call with no slug first to see what menus exist.
- search_dishes — find dishes across all menus by keyword, dietary need (vegetarian/vegan/gluten-free/spicy) or an allergen to avoid.
- list_offers — current offers / specials / Sunday roast / brunch / lunch deals.
- check_availability — whether a date + party size has free tables.

MENUS & ALLERGENS
- We offer burgers, curries, a Sunday roast, pizza, pasta, grills, global mains, drinks and desserts. Gluten-free pizza & pasta bases are available. Use lookup_menu / search_dishes to answer specifics — don't recite dishes or prices from memory.
- For dietary or allergy questions, use search_dishes (with dietTag or allergenFree) and report what it returns.
- ALLERGENS: many dishes contain or may contain gluten, dairy, eggs, soy, nuts, fish and shellfish, and allergen data may be incomplete. NEVER guarantee a dish is free of an allergen — even if the tool doesn't list it. Always tell guests with allergies or intolerances to inform a member of staff when booking and on arrival so the kitchen can advise — their safety comes first.

BOOKING
- Bookings are made on the website's booking page. For parties of 6+, a deposit may apply.
- Delivery is via Uber Eats; collection via Touch Takeaway.

HOW TO BEHAVE
- Be warm, concise and helpful, like a knowledgeable host.
- Only answer about Geisha; if asked something unrelated, gently steer back.
- If a tool has no answer (a specific dish, today's special, availability), say so honestly and suggest calling or using the booking page rather than guessing.
- Never invent menu items, prices, offers or availability — if it's not in a tool result, you don't know it.`;

// Default settings per brand — booking policy from GEISHA_WEBSITE_SPEC.md §6.
function defaultSettings(brand: 'asia' | 'fusion') {
	return {
		online_party_max: 8,
		deposit_per_person_6plus_pence: 1000, // £10pp for 6+
		noshow_fee_per_person_fri_sat_pence: 500, // £5pp Fri/Sat 3–5
		release_after_minutes: 20,
		booking_window_days: 60,
		slot_interval_minutes: 15,
		// Public guest-assistant system prompt (editable in admin).
		ai_assistant_prompt: brand === 'asia' ? ASIA_ASSISTANT_PROMPT : FUSION_ASSISTANT_PROMPT
	};
}

// Settings the seed should only create (never overwrite) so staff edits in the
// admin survive a re-run of the seed.
const SEED_ONCE_KEYS = new Set(['ai_assistant_prompt']);

async function seedBrand(
	brand: 'asia' | 'fusion',
	displayName: string,
	periods: Array<Record<string, unknown>>,
	tables: SeedTable[]
) {
	console.log(`\n=== Seeding ${brand} ===`);

	const restaurant = await upsert('geisha_restaurants', `brand=${q(brand)}`, {
		brand,
		display_name: displayName,
		timezone: 'Europe/London'
	});
	console.log(`  restaurant: ${restaurant.id}`);

	for (const p of periods) {
		await upsert(
			'geisha_service_periods',
			`restaurant=${q(restaurant.id)} && name=${q(p.name as string)}`,
			{ ...p, restaurant: restaurant.id }
		);
	}
	console.log(`  service periods: ${periods.length}`);

	const settings = defaultSettings(brand);
	for (const [key, value] of Object.entries(settings)) {
		const filter = `restaurant=${q(restaurant.id)} && key=${q(key)}`;
		// "Seed once" keys (e.g. the editable assistant prompt): only create them
		// if absent, so a re-run never clobbers a staff edit.
		if (SEED_ONCE_KEYS.has(key) && (await findOne('geisha_settings', filter))) continue;
		await upsert('geisha_settings', filter, { restaurant: restaurant.id, key, value });
	}
	console.log(`  settings: ${Object.keys(settings).length}`);

	// Default floor for the floor-planner (idempotent). cm sizes below derive
	// from the px size at this scale so the editor's ruler is meaningful.
	const PX_PER_CM = 0.5;
	const floor = await upsert(
		'geisha_floors',
		`restaurant=${q(restaurant.id)} && name=${q('Ground floor')}`,
		{
			restaurant: restaurant.id,
			name: 'Ground floor',
			sort_order: 0,
			width_cm: 1000,
			height_cm: 800,
			px_per_cm: PX_PER_CM
		}
	);
	console.log(`  floor: ${floor.id}`);

	for (const t of tables) {
		await upsert('geisha_tables', `restaurant=${q(restaurant.id)} && label=${q(t.label)}`, {
			restaurant: restaurant.id,
			label: t.label,
			seats_min: t.seats_min,
			seats_max: t.seats_max,
			section: t.section,
			bookable: t.bookable,
			x: t.x,
			y: t.y,
			width: 90,
			height: 90,
			shape: t.seats_max <= 2 ? 'round' : 'rect',
			floor: floor.id,
			rotation: 0,
			width_cm: Math.round(90 / PX_PER_CM),
			height_cm: Math.round(90 / PX_PER_CM)
		});
	}
	console.log(`  tables: ${tables.length} (PLACEHOLDER — replace with real inventory)`);
}

async function main() {
	await pb.collection('_superusers').authWithPassword(EMAIL!, PASSWORD!);
	console.log('Authenticated as superuser.');

	// Asia: open 12–11 daily; daytime menu Mon–Fri to 5pm; last orders ~9:15pm.
	await seedBrand(
		'asia',
		'Geisha Asia',
		[
			{
				name: 'Daytime',
				days_of_week: [1, 2, 3, 4, 5],
				start_time: '12:00',
				end_time: '17:00',
				last_booking_time: '16:30',
				default_turn_minutes: 90,
				active: true
			},
			{
				name: 'Dinner',
				days_of_week: [0, 1, 2, 3, 4, 5, 6],
				start_time: '17:00',
				end_time: '23:00',
				last_booking_time: '21:15',
				default_turn_minutes: 120,
				active: true
			}
		],
		ASIA_TABLES
	);

	// Fusion: Mon–Thu 12–10, Fri–Sat 12–11, Sun 12–7:30 (last booking 6pm).
	await seedBrand(
		'fusion',
		'Geisha Fusion',
		[
			{
				name: 'Lunch',
				days_of_week: [1, 2, 3, 4, 5],
				start_time: '12:00',
				end_time: '17:30',
				last_booking_time: '17:00',
				default_turn_minutes: 90,
				active: true
			},
			{
				name: 'Dinner',
				days_of_week: [1, 2, 3, 4, 5, 6],
				start_time: '17:30',
				end_time: '23:00',
				last_booking_time: '21:30',
				default_turn_minutes: 120,
				active: true
			},
			{
				name: 'Sunday',
				days_of_week: [0],
				start_time: '12:00',
				end_time: '19:30',
				last_booking_time: '18:00',
				default_turn_minutes: 120,
				active: true
			}
		],
		FUSION_TABLES
	);

	console.log('\nSeed complete.');
}

main().catch((err) => {
	console.error('Seed failed:', err);
	process.exit(1);
});
