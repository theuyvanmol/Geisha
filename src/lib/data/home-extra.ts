// The rest of the editable home-page editorial that the `home` key doesn't cover:
// each brand's marquee words, plus Fusion's intro/marks, featured "Today's menu"
// dishes, the menu-band copy, and the story band. Extracted out of the route
// .svelte files so each block is (a) the rendered default and (b) the fallback for
// the editable `home_extra` content key (see schema.ts → HomeExtraContent).
//
// Asia uses only marqueeWords + walkinsNote; the Fusion-specific blocks are empty
// for Asia (its hero/story are bespoke markup and edited via the `home` key).

import type { BrandId } from './brand';
import type { HomeExtraContent } from '$lib/content/schema';

export const HOME_EXTRA_DEFAULTS: Record<BrandId, HomeExtraContent> = {
	asia: {
		marqueeWords: ['sushi', 'dim sum', 'robata', 'ramen', 'curry', 'cocktails', 'sake', 'bottomless brunch'],
		walkinsNote:
			"Walk-ins welcome — we'll seat you on a non-reservable table when we can.",
		introKicker: '',
		introHeading: '',
		introBody: '',
		marks: [],
		menuKicker: '',
		menuHeading: '',
		menuSub: '',
		dishes: [],
		storyHeading: '',
		storyBody1: '',
		storyBody2: ''
	},
	fusion: {
		marqueeWords: [
			'burgers',
			'curry',
			'pizza',
			'sunday roast',
			'kids menu',
			'cocktails',
			'bottomless brunch'
		],
		walkinsNote: '',
		introKicker: 'A family-friendly restaurant',
		introHeading: 'Something for <em>everyone</em>',
		introBody:
			"Geisha Fusion brings the world's favourite dishes under one roof. Classic favourites with a modern twist — burgers, curries, fresh pizza and a proper Sunday roast — served in a lively, welcoming dining room in Benton.",
		marks: [
			{ n: '01', l: 'All day', p: 'open from midday, seven days a week — mains, bottomless brunch and Sunday roast.' },
			{ n: '02', l: 'For everyone', p: 'family-friendly tables, a proper kids menu, and an allergy menu on hand.' },
			{ n: '03', l: 'Global menu', p: 'American burgers, mouth-watering curries and stone-baked pizza.' }
		],
		menuKicker: 'The menu',
		menuHeading: "What we're known for",
		menuSub:
			'A taste of the kitchen. See the full lists — plus the special menu, kids menu, drinks and allergy guide — on the menus page.',
		dishes: [
			{
				img: '/Content%20folder/IMG_6394.JPG',
				name: 'the geisha burger',
				desc: 'American-style stacked burger, fries and all the trimmings.',
				tag: 'burgers'
			},
			{
				img: '/Content%20folder/IMG_6463.JPG',
				name: 'curry, your way',
				desc: 'mouth-watering curries from mild to fiery, with rice or naan.',
				tag: 'curry'
			},
			{
				img: '/Content%20folder/IMG_6486.JPG',
				name: 'fresh stone-baked pizza',
				desc: 'hand-finished bases — classics and house specials.',
				tag: 'pizza'
			},
			{
				img: '/Content%20folder/IMG_6500.JPG',
				name: 'sunday roast',
				desc: 'roast meats, Yorkshires and all the sides — every Sunday.',
				tag: 'sundays'
			},
			{
				img: '/Content%20folder/IMG_6394.JPG',
				name: 'bottomless brunch',
				desc: 'great food and free-flowing drinks — book the big table.',
				tag: 'brunch'
			}
		],
		storyHeading: 'A place for <em>everyone</em>',
		storyBody1:
			'Geisha Fusion is the family-friendly side of Geisha. The idea was simple: bring the dishes people actually love most — wherever in the world they come from — together under one roof, and serve them in a warm, lively room you can walk into any day of the week.',
		storyBody2:
			"From a quick bite to a bottomless brunch, a Sunday roast with the family or a birthday in our VIP function room, there's a table here for the occasion."
	}
};

export function getHomeExtraDefaults(brand: BrandId): HomeExtraContent {
	return HOME_EXTRA_DEFAULTS[brand];
}
