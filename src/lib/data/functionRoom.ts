// The VIP Function Room menu (Geisha Fusion): the buffet packages from the
// printed leaflet (static/geisha_fusion_function_room.pdf, Oct 2026), shown on
// the Parties & Functions page, plus the entry that puts the leaflet in the
// home page's menu carousel.
//
// Fusion's live menu list is the staff-edited `menus` content in the admin, so a
// menu added only to menus.fusion.ts would never appear. The home page loader
// therefore adds FUNCTION_ROOM_MENU itself, unless staff have already added a
// menu with the same slug in the admin (theirs wins).

export const FUNCTION_ROOM_PDF = '/geisha_fusion_function_room.pdf';
export const FUNCTION_ROOM_COVER = '/images/menus/function-room.webp';

export const FUNCTION_ROOM_MENU = {
	slug: 'function-room',
	title: 'VIP Function Room',
	subtitle: 'Party buffets from £15.50pp · 20–60 guests',
	pdf: FUNCTION_ROOM_PDF,
	img: FUNCTION_ROOM_COVER
};

export type BuffetTier = {
	name: string;
	price: string;
	pick: string;
	/** "Same as Basic, plus a choice from…" — the Premium tiers build on Basic */
	extends?: string;
	columns: { title?: string; items: string[] }[];
	included: string[];
};

export type BuffetGroup = { id: string; label: string; blurb: string; tiers: BuffetTier[] };

export const BUFFET_RULES = 'Minimum 20, maximum 60 guests (standing).';

export const FUNCTION_ROOM_SIZES = [
	{ n: 'Up to 40', what: 'seated guests can order from the regular Geisha Fusion menu, or from the buffets for parties over 20, seated or standing.' },
	{ n: '40 – 60', what: 'guests can take the buffet options for a standing event.' }
];

export const BUFFETS: BuffetGroup[] = [
	{
		id: 'fusion',
		label: 'Fusion buffet',
		blurb: 'Stone-baked pizza, pasta and sharing plates from the Fusion kitchen.',
		tiers: [
			{
				name: 'Basic',
				price: '£15.50',
				pick: 'Choose 6',
				columns: [
					{
						items: [
							'Pizza — Margherita, Vegetarian, Garlic & Cheese Bread, Tomato Garlic Bread, Garlic Bread',
							'Pasta — Arrabbiata, Bolognese, Vegetarian',
							'Bruschetta — tomato, garlic, red onion, basil & parmesan shavings',
							'House Potato Skins',
							'Chicken Wings',
							'Mediterranean Dips'
						]
					}
				],
				included: ['Fries included']
			},
			{
				name: 'Premium',
				price: '£18',
				pick: 'Choose 8',
				extends: 'Everything in Basic, plus',
				columns: [
					{
						items: [
							'Pizza — Pepperoni, Bolognese, Sausage & Pancetta, Chicken & Mushroom',
							'Pasta — Carbonara, Puttanesca, Sausage & Pancetta',
							'Mussels',
							'Pork Belly',
							'BBQ Spare Ribs'
						]
					}
				],
				included: ['Fries included']
			}
		]
	},
	{
		id: 'asia',
		label: 'Asia buffet',
		blurb: 'Gyoza, satay, salt & chilli and wok dishes from Geisha Asia.',
		tiers: [
			{
				name: 'Basic',
				price: '£18',
				pick: 'Choose 6',
				columns: [
					{
						items: [
							'Edamame Beans',
							'Chicken Satay Skewers',
							'Salt & Chilli Chicken',
							'Salt & Chilli Tofu',
							'Wings — Gochujang or Salt & Chilli',
							'Chicken & Vegetable Fried Rice',
							'Chicken & Vegetable Gyoza',
							'Spring Rolls',
							'Chow Mein — Veg or Chicken',
							'Sweet & Sour Chicken',
							'Fries — any option',
							'Katsu Prawns',
							'Geisha Fried Rice'
						]
					}
				],
				included: ['Any rice included']
			},
			{
				name: 'Premium',
				price: '£21',
				pick: 'Choose 8',
				extends: 'Everything in Basic, plus',
				columns: [
					{
						items: [
							'Salt & Chilli Squid',
							'Chow Mein — any',
							'Singapore Vermicelli',
							'Geisha KFC',
							'Sweet & Sour Prawn',
							'Any mix of Maki Sushi',
							'Szechuan Beef or Chicken'
						]
					}
				],
				included: ['Any rice included']
			}
		]
	},
	{
		id: 'mixed',
		label: 'Mixed buffet',
		blurb: 'The best of both kitchens on one table.',
		tiers: [
			{
				name: 'Basic',
				price: '£23',
				pick: 'Choose 10',
				columns: [
					{
						title: 'Geisha Fusion',
						items: [
							'Pizza — any',
							'Pasta — any',
							'Bruschetta — any',
							'House Potato Skins',
							'Chicken Wings',
							'Mediterranean Dips',
							'Pork Belly',
							'Mussels',
							'BBQ Spare Ribs'
						]
					},
					{
						title: 'Geisha Asia',
						items: [
							'Edamame Beans',
							'Chicken Satay Skewers',
							'Salt & Chilli Chicken',
							'Salt & Chilli Tofu',
							'Salt & Chilli Squid',
							'Wings — Gochujang or Salt & Chilli',
							'Chicken & Vegetable Fried Rice',
							'Spring Rolls',
							'Chow Mein — any',
							'Sweet & Sour Dishes',
							'Fries — Truffle, Salt & Chilli or Wasabi',
							'Geisha KFC',
							'Singapore Vermicelli',
							'Katsu Prawns',
							'Geisha Fried Rice',
							'Chicken & Vegetable Gyoza'
						]
					}
				],
				included: ['Any Fusion fries included', 'Any rice included']
			}
		]
	}
];
