// Editorial copy for the brand home pages, extracted out of the route .svelte
// files so it can be (a) the rendered default and (b) the fallback for the
// editable `home` content key (see src/lib/content/schema.ts → HomeContent).
//
// Emphasis convention (parsed by RichText.svelte, never raw HTML):
//   *word* -> italic,  _word_ -> underline,  ~ -> non-breaking space.

import type { BrandId } from './brand';
import type { HomeContent } from '$lib/content/schema';

export const HOME_DEFAULTS: Record<BrandId, HomeContent> = {
	asia: {
		heroEyebrow: 'Modern Pan-Asian Cuisine',
		// The second line is the accent line — *…* renders it in sakura pink in the hero.
		heroTitleLines: ['Discover', '*Asia*'],
		heroLine:
			'Sushi, sashimi and dim sum served in a Japanese garden-inspired dining room in the heart of Benton, Newcastle.',
		aboutEyebrow: 'Our Story',
		aboutTitle: 'Rooted in tradition, crafted for today',
		aboutTag: 'Japanese garden-inspired dining room',
		statementLead:
			'Geisha Asia is a modern, Japanese-inspired restaurant offering an exquisite dining experience — delicious sushi, dim sum and a variety of other mouth-watering pan-Asian dishes.',
		statementColLeft:
			'Our unique setting, with its Japanese-garden-inspired design, is the perfect place to enjoy a meal with family and friends — whether a romantic dinner for two or a fun night out.',
		statementColRight:
			"We're open all day, every day, from midday until late. Drop in for a daytime special and cocktails, or settle in for sushi, robata and sake as the lanterns come on.",
		bandEyebrow: 'From the robata grill',
		bandLine: 'Flame-grilled, sizzling~&~smoky',
		roomLine: '*Japanese-garden design. A room to linger in.*'
	},
	// Fusion now runs the same redesigned home page as Asia, so it needs the same
	// slots filled. These six were left empty by the old Gucci-Osteria layout,
	// which had no hero eyebrow, no story block and no caption plaque — the new
	// page renders all of them, and blanks would have shipped as empty headings.
	fusion: {
		heroEyebrow: 'Global Flavours · Family Table',
		// The second line is the accent line — *…* renders it in sakura pink in the hero.
		heroTitleLines: ['Flavours from', '*every corner*'],
		heroLine:
			'Burgers, curry, stone-baked pizza and a proper Sunday roast — the world’s favourite dishes, all under one roof in Benton, Newcastle.',
		aboutEyebrow: 'Our Story',
		aboutTitle: 'One kitchen, every craving',
		aboutTag: 'A family table where the world’s dishes meet',
		statementLead:
			'Embark on a delightful culinary journey at Geisha Fusion — a vibrant array of dishes from across the globe, blending classic favourites with modern twists.',
		statementColLeft:
			"A family-friendly dining room where the world's favourite dishes meet — burgers, curry, fresh pizza and a proper Sunday roast.",
		statementColRight:
			"Open all day in Benton, seven days a week. Bring the family, book the big table, or order in — there's a seat here for everyone.",
		bandEyebrow: 'Street art & open kitchen',
		bandLine: 'Bold plates, brighter~room',
		roomLine: '*Colour on every wall. A room with the volume up.*'
	}
};

export function getHomeDefaults(brand: BrandId): HomeContent {
	return HOME_DEFAULTS[brand];
}
