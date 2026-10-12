import type { Menu } from './menu-types';

// Geisha Asia — real menus transcribed from the current printed menus.
//
// The main menu is the AUGUST 2026 reprint. It came off the client's own site
// (geisharestaurants.co.uk, uploaded as IMG_9611.jpeg in 2026/08) because there
// is no PDF of it — that JPEG is the only published copy. It supersedes
// geisha_asia_menu_jul26.pdf, which we shipped until 2026-08-06 and which the
// owner spotted was not the menu their restaurant is handing out.
//
// August vs July is a small reprint, not a new menu: same dishes and prices, but
// the Geisha Sharing Platter lost "honey BBQ Asian ribs" and "satay chicken
// skewers", and Karaage Chicken / Chicken Satay Skewers swapped places.
// July vs the January A3 was the bigger jump — July added Hong Kong mussels,
// Pattaya prawn skewers, robata ribeye, seafood crispy noodles and the Ocean
// Sake Flower, and dropped Beef Fillet Yao, Tonkatsu Don Rice and both gunkan.
//
// DESCRIPTIONS ARE VERBATIM. They used to be condensed rewrites ("Chicken in
// satay sauce" for the printed "Chicken thighs in satay sauce", openers like
// "Served with" / "Choose from" dropped throughout), which is what the owner
// meant by the descriptions not matching. If you edit one, copy the printed
// wording exactly — the sheet is on the page right next to it.
//
// Check the reprint date before editing prices here.
// Prices in £. Diet tags: v=vegetarian, vg=vegan, gf=gluten-free, spicy.
// Multi-protein dishes list price options in the description (e.g. veg/chicken/
// beef/prawn) to keep the renderer simple. Always confirm allergens in venue.

export const ASIA_MENUS: Menu[] = [
	{
		slug: 'main',
		title: 'Main Menu',
		subtitle: 'Asian bites, dim sum, robata, ramen, sushi & more',
		pdf: '/geisha_asia_menu_aug26.jpeg',
		sections: [
			{
				title: 'Asian Bites',
				items: [
					{
						name: 'Thai Prawn Cracker',
						desc: 'Served with sweet chilli sauce.',
						price: '£5',
						allergens: ['shellfish', 'gluten']
					},
					{
						name: 'Crispy Aromatic Duck',
						desc: 'Served with pancakes, hoisin sauce, leek & cucumber. Choose from quarter OR half duck.',
						price: '£13 / £19.50',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Wakame Salad',
						desc: 'Seasoned seaweed salad with sesame.',
						price: '£6',
						tags: ['vg', 'gf'],
						allergens: ['sesame', 'soy']
					},
					{
						name: 'Edamame Beans',
						desc: 'Salt & chilli.',
						price: '£6',
						tags: ['vg', 'gf'],
						allergens: ['soy']
					},
					{
						name: 'Katsu Prawns',
						desc: 'Ebi prawns in panko breadcrumbs coating with katsu sauce.',
						price: '£12',
						allergens: ['shellfish', 'gluten', 'eggs', 'soy']
					},
					{
						name: 'Hong Kong Style Mussels',
						desc: 'In black bean sauce.',
						price: '£11',
						tags: ['new'],
						allergens: ['shellfish', 'soy', 'gluten']
					},
					{
						name: 'Chicken Satay Skewers',
						desc: 'Chicken thighs in satay sauce.',
						price: '£12',
						allergens: ['nuts', 'soy']
					},
					{
						name: 'Karaage Chicken',
						desc: 'Drizzled with Japanese mayo and topped with nori seasoning.',
						price: '£11',
						allergens: ['gluten', 'eggs', 'soy']
					},
					{
						name: 'BBQ Pork Ribs',
						desc: 'With honey BBQ.',
						price: '£12.50',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Salt & Chilli Pork Ribs',
						desc: 'With chilli, garlic, onion & peppers.',
						price: '£12.50',
						tags: ['spicy'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Salt & Chilli Chicken',
						desc: 'Chilli, garlic, onion & peppers with crispy chicken.',
						price: '£12.50',
						tags: ['spicy'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Salt & Chilli Squid',
						desc: 'Chilli, garlic, onion & peppers with crispy squid.',
						price: '£13.50',
						tags: ['spicy'],
						allergens: ['shellfish', 'gluten', 'soy']
					},
					{
						name: 'Salt & Chilli Tofu',
						desc: 'Chilli, garlic, onion & peppers with crispy tofu.',
						price: '£11',
						tags: ['vg', 'spicy'],
						allergens: ['soy', 'gluten']
					},
					{
						name: 'Salt & Chilli King Prawns',
						desc: 'Battered deep fried king prawns with chilli, garlic, onion & peppers.',
						price: '£14',
						tags: ['spicy'],
						allergens: ['shellfish', 'gluten', 'eggs', 'soy']
					},
					{
						name: 'Wasabi King Prawns',
						desc: 'Battered deep fried king prawns with wasabi.',
						price: '£14',
						allergens: ['shellfish', 'gluten', 'eggs', 'mustard']
					},
					{
						name: 'Geisha Wings',
						desc: 'Deep fried buffalo chicken wings. Choice of spicy gochujang sauce OR chilli, garlic, onion & peppers.',
						price: '£11',
						tags: ['spicy'],
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Pork Belly',
						desc: 'Served with hoisin sauce.',
						price: '£13',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Sweet Potato Croquettes',
						desc: 'Served with truffle mayo.',
						price: '£8.50',
						tags: ['vg'],
						allergens: ['gluten', 'soy']
					}
				]
			},
			{
				title: 'Delicious Dim Sum',
				items: [
					{
						name: 'Wonton',
						desc: 'Deep fried pork dumpling [5 pieces].',
						price: '£8',
						allergens: ['gluten', 'soy', 'sesame', 'eggs']
					},
					{
						name: 'Wor Tip',
						desc: 'Pan seared pork dumplings [4 pieces].',
						price: '£9',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Xiaolongbao',
						desc: 'Steamed dumplings with pork and shrimp filling [4 pieces].',
						price: '£9',
						allergens: ['gluten', 'shellfish', 'soy', 'sesame']
					},
					{
						name: 'Hagow',
						desc: 'Steamed prawn dumplings [4 pieces].',
						price: '£9',
						allergens: ['shellfish', 'gluten', 'soy', 'sesame']
					},
					{
						name: 'Japanese Fried Sumai',
						desc: 'Deep fried prawn & pork dumplings topped with fish roe & Japanese mayo [5 pieces].',
						price: '£8',
						allergens: ['shellfish', 'fish', 'gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Chicken & Vegetable Gyoza',
						desc: 'Deep fried chicken & vegetable dumplings [5 pieces].',
						price: '£8',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Vegetable Spring Rolls',
						desc: 'Deep fried vegetable rolls, served with sweet chilli sauce [3 pieces].',
						price: '£8',
						tags: ['v'],
						allergens: ['gluten', 'soy']
					}
				]
			},
			{
				title: 'Robata Grill & Sizzling',
				note: 'Served with steamed rice unless stated, ask server for available upgrades.',
				items: [
					// NOT gluten-free in any form (owner, Aug 2026) — the miso marinade and
					// the teriyaki glaze both carry it. Do not re-add a 'gf' tag here.
					{
						name: 'Black Miso Salmon Skewers',
						desc: 'Skin-on salmon fillet marinated in miso sauce, flame grilled and coated in a teriyaki glaze.',
						price: '£18.50',
						allergens: ['fish', 'soy', 'sesame', 'gluten']
					},
					{
						name: 'Sirloin Beef Kushiyaki',
						desc: 'Marinated strips of sirloin beef skewers, flame grilled and coated in a teriyaki glaze.',
						price: '£16.50',
						allergens: ['soy', 'gluten', 'sesame']
					},
					{
						name: 'Pattaya Prawn Skewers',
						desc: 'Coated in homemade Thai green sauce, served with fries & Asian slaw.',
						price: '£21.50',
						tags: ['new'],
						allergens: ['shellfish', 'gluten', 'eggs', 'soy', 'mustard']
					},
					{
						name: 'Geisha Signature Scallops',
						desc: 'Whole scallops with prawns and crab meat topped with cheese & nori seasoning, served with fries.',
						price: '£19.50',
						allergens: ['shellfish', 'dairy', 'soy', 'sesame']
					},
					{
						name: 'Japanese Robata Ribeye — 10oz',
						desc: 'In a teriyaki glaze, served with Asian slaw & fries.',
						price: '£23',
						tags: ['new'],
						allergens: ['soy', 'gluten', 'sesame', 'eggs', 'mustard']
					}
				]
			},
			{
				// The teppan is one dish with four proteins, priced separately on the
				// PDF — listing them as items keeps every price searchable instead of
				// hiding three of them inside a description.
				title: 'The Sizzling Teppan',
				note: 'Our iconic sizzling dish served on a scorching iron plate alongside vegetables and your choice of black pepper sauce or honey BBQ.',
				items: [
					{ name: 'Chicken (Skin On)', price: '£16.50', allergens: ['soy', 'gluten', 'sesame'] },
					{ name: 'Salmon', price: '£16.50', allergens: ['fish', 'soy', 'gluten', 'sesame'] },
					{
						name: 'King Prawn',
						price: '£19.50',
						allergens: ['shellfish', 'soy', 'gluten', 'sesame']
					},
					{ name: '10oz Ribeye Steak', price: '£24', allergens: ['soy', 'gluten', 'sesame'] }
				]
			},
			{
				title: 'Ramen & Noodle Dishes',
				items: [
					{
						name: 'Chilli Beef Ramen',
						desc: 'Robata chilli Sirloin steak in homemade broth with vegetables, seaweed, noodles & Shoyu egg.',
						price: '£17.50',
						tags: ['spicy'],
						allergens: ['gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Miso Gyoza Ramen',
						desc: 'Miso, tofu, vegetable dumplings in homemade broth with vegetables, seaweed, noodles & Shoyu egg.',
						price: '£16.50',
						tags: ['v'],
						allergens: ['gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Tomyum Ramen',
						desc: 'Fresh seafood, chilli, ginger, lemongrass in homemade broth with vegetable, seaweed, noodles & Shoyu egg.',
						price: '£18.50',
						tags: ['spicy'],
						allergens: ['shellfish', 'fish', 'gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Sriracha Chicken Ramen',
						desc: 'Robata grilled chicken (skin-on) in homemade broth with vegetables, seaweed, noodles & Shoyu egg.',
						price: '£17.50',
						tags: ['spicy'],
						allergens: ['gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Singapore Vermicelli',
						desc: 'With prawns, char siu pork, vegetable & egg or vegan.',
						price: '£16 / £14',
						tags: ['spicy'],
						allergens: ['shellfish', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Pad Thai Noodles',
						desc: 'Choice of chicken, prawn or vegan.',
						price: '£15 / £16 / £15',
						allergens: ['nuts', 'shellfish', 'eggs', 'soy', 'fish']
					},
					{
						name: 'Geisha Crispy Noodles',
						desc: 'With prawns, char siu pork & pork belly or vegetarian.',
						price: '£18.50 / £14.50',
						allergens: ['gluten', 'shellfish', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Seafood Crispy Noodles',
						desc: 'In black bean sauce.',
						price: '£19.50',
						tags: ['new'],
						allergens: ['gluten', 'shellfish', 'fish', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Chow Mein',
						desc: 'Choose from vegetables, chicken, beef or prawn.',
						price: '£13 / £14 / £16 / £16',
						allergens: ['gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Katsu Fried Noodles',
						desc: 'With yakisoba sauce, chicken katsu, vegetables & seaweed.',
						price: '£16.50',
						allergens: ['gluten', 'eggs', 'soy', 'sesame']
					}
				]
			},
			{
				title: 'Curry & Rice Dishes',
				note: 'Served with steamed rice, ask your server for available upgrades. Rice upgrades are available at £1.50 extra.',
				items: [
					{
						name: 'Thai Green / Red Curry',
						desc: 'Thai curry served with rice. Choose from vegetables, chicken or seafood.',
						price: '£13.50 / £15 / £17.50',
						tags: ['spicy'],
						allergens: ['fish', 'shellfish', 'soy']
					},
					{
						name: 'Massaman Curry',
						desc: 'Choose from vegetables, chicken or seafood. With sweet potatoes, mixed vegetables cashew nuts & rice.',
						price: '£14 / £16 / £18',
						tags: ['gf'],
						allergens: ['nuts', 'fish', 'shellfish', 'soy']
					},
					{
						name: 'Rendang Malaysian Curry',
						desc: 'Choose from vegetables, chicken, beef or prawn. Add naan bread + £1.50.',
						price: '£13.50 / £14.50 / £15.50 / £17.50',
						allergens: ['nuts', 'shellfish', 'soy', 'gluten']
					},
					{
						name: 'Sri Lanka Kothu Curry',
						desc: 'Choose from vegetables, chicken, beef or seafood. Add naan bread + £1.50.',
						price: '£14 / £16 / £17 / £18',
						tags: ['spicy'],
						allergens: ['gluten', 'eggs', 'shellfish', 'soy']
					},
					{
						name: 'Japanese Chicken Katsu',
						desc: 'Breaded chicken breast served with Japanese curry sauce & rice.',
						price: '£16.50',
						allergens: ['gluten', 'eggs', 'soy']
					},
					{
						name: 'Geisha KFC',
						desc: 'Korean fried boneless chicken thighs in sticky gochujang sauce with rice.',
						price: '£16.50',
						tags: ['spicy'],
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Chinese Black Bean',
						desc: 'Choose from vegetables, chicken, beef or prawn in a bold black bean sauce with rice.',
						price: '£13 / £14 / £15 / £16',
						allergens: ['soy', 'gluten', 'shellfish']
					},
					{
						name: 'Spicy Szechuan',
						desc: 'Crispy chicken OR crisp strips of beef in szechuan sauce with rice.',
						price: '£16 / £17',
						tags: ['spicy'],
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Far East Sweet & Sour',
						desc: 'Crispy chicken strips OR battered king prawns in sweet & sour sauce with rice.',
						price: '£15.50 / £17.50',
						allergens: ['gluten', 'eggs', 'shellfish', 'soy']
					},
					{
						name: 'Kung Po',
						desc: 'Crispy chicken strips OR battered king prawns in kung po sauce.',
						price: '£16 / £17.50',
						tags: ['spicy'],
						allergens: ['nuts', 'gluten', 'eggs', 'shellfish', 'soy']
					},
					{
						name: 'Three Meats Charcoal',
						desc: 'Selection of roasted duck, pork belly and char siu pork with Asian BBQ sauce & rice.',
						price: '£18.50',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Geisha Fried Rice',
						desc: 'Egg fried rice with char siu pork, chicken, prawn & duck.',
						price: '£15',
						allergens: ['eggs', 'shellfish', 'soy', 'sesame']
					}
				]
			},
			{
				title: 'Poke Bowl',
				note: 'Served with shelled edamame beans, avocado, sweetcorn, wakame salad, tamago omelette, fish roe, pickled radish, wasabi & Japanese soy sauce. Your choice of steamed rice OR sushi rice. Choose one extra dressing: Sesame / Ponzu / Teriyaki.',
				items: [
					{
						name: 'Teriyaki-Mayo Chicken Poke Bowl',
						price: '£14',
						allergens: ['fish', 'eggs', 'soy', 'sesame', 'gluten']
					},
					{
						name: 'Raw Salmon Poke Bowl',
						price: '£15',
						allergens: ['fish', 'eggs', 'soy', 'sesame', 'gluten']
					},
					{
						name: 'Raw Tuna Poke Bowl',
						price: '£15',
						allergens: ['fish', 'eggs', 'soy', 'sesame', 'gluten']
					},
					{
						name: 'Steamed Prawns Poke Bowl',
						price: '£15',
						allergens: ['shellfish', 'fish', 'eggs', 'soy', 'sesame', 'gluten']
					},
					{
						name: 'Original Poke Bowl',
						desc: 'Raw salmon, raw tuna & steamed prawns.',
						price: '£16.50',
						allergens: ['fish', 'shellfish', 'eggs', 'soy', 'sesame', 'gluten']
					},
					{
						name: 'Vegan Poke Bowl',
						desc: 'Tofu skin, pickled radish, avocado, sweetcorn, wakame salad, edamame beans, fresh seaweed, wasabi & Japanese soy sauce.',
						price: '£13',
						tags: ['vg'],
						allergens: ['soy', 'sesame']
					}
				]
			},
			{
				title: 'Burgers',
				items: [
					{
						name: 'Japanese Wagyu Burger',
						desc: 'Wagyu Beef Pattie, steamed seeded bun, cheese, wasabi ketchup, Asian slaw, crispy lettuce & spicy mayo with fries.',
						price: '£18',
						allergens: ['gluten', 'dairy', 'eggs', 'soy', 'sesame', 'mustard']
					},
					{
						name: 'Chicken Katsu Burger',
						desc: 'Panko breaded crispy chicken breast, steamed seeded bun, katsu sauce, Asian slaw, crispy lettuce & spicy mayo with fries.',
						price: '£17',
						allergens: ['gluten', 'eggs', 'soy', 'sesame', 'mustard']
					}
				]
			},
			{
				title: 'Sides',
				items: [
					{
						name: 'Stir Fry Vegetables',
						desc: 'Seasonal selection of vegetables, with garlic & ginger or oyster sauce (items subject to availability).',
						price: '£7.50',
						tags: ['vg'],
						allergens: ['shellfish', 'soy', 'gluten']
					},
					{
						name: 'Fries',
						desc: 'Choose from plain fries or upgrade to truffle mayo fries, wasabi fries or salt & chilli fries.',
						price: '£4.50 / £5.50',
						tags: ['vg'],
						allergens: ['gluten', 'eggs', 'mustard']
					},
					{
						name: 'Rice',
						desc: 'Choose from egg fried or coconut.',
						price: '£4.50',
						tags: ['vg'],
						allergens: ['eggs', 'soy']
					},
					{
						name: 'Soft Noodles',
						desc: 'With beansprouts and spring onions.',
						price: '£6',
						tags: ['vg'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Sauces',
						desc: 'Katsu curry, Thai curry, Satay, Szechuan, Sweet & Sour.',
						price: '£4.50',
						allergens: ['nuts', 'soy', 'gluten', 'shellfish']
					}
				]
			},
			{
				title: 'Sharing Platters',
				items: [
					{
						name: 'Geisha Sharing Platter',
						desc: 'Salt & chilli chicken, honey BBQ, spring rolls, Geisha KFC, edamame beans.',
						price: '£33.50',
						tags: ['spicy'],
						allergens: ['nuts', 'gluten', 'soy', 'sesame']
					},
					{
						name: 'Deluxe Sharing Platter',
						desc: 'Korean BBQ ribs, kung po prawns, szechuan chicken, peking duck, edamame beans & spicy fried noodles.',
						price: '£37',
						tags: ['spicy', 'new'],
						allergens: ['nuts', 'gluten', 'eggs', 'shellfish', 'soy', 'sesame']
					}
				]
			},
			{
				title: 'Signature Sushi — Maki',
				note: 'Mat-rolled sushi, filled and topped with delicious fresh ingredients [4 pieces].',
				items: [
					{
						name: 'Ocean Sake Flower',
						desc: 'With smoked salmon, filled with mango, kiwi, strawberries, salad dressing & sushi rice, topped with prawn, scallop & black caviar lumpfish roe [1 piece].',
						price: '£14.50',
						tags: ['new'],
						allergens: ['fish', 'shellfish', 'soy', 'sesame', 'eggs']
					},
					{
						name: 'Ocean Maki',
						desc: 'Filled with salmon, yellowtail, tuna, rolled with steamed prawn & topped with diced fresh fish, kimchi sauce & fish roe.',
						price: '£12',
						allergens: ['fish', 'shellfish', 'soy', 'sesame']
					},
					{
						name: 'Wasabi Prawn Maki',
						desc: 'Filled with tempura king prawn, cucumber & wasabi mayo, topped with wasabi peas.',
						price: '£11',
						allergens: ['shellfish', 'gluten', 'eggs', 'soy', 'sesame', 'mustard']
					},
					{
						name: 'Karaage Maki',
						desc: 'Filled with fresh salad, karaage chicken & Japanese mayo rolled in crispy panko bread crumbed nori and topped with tonkatsu mayo & chilli threads.',
						price: '£10',
						allergens: ['gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Beef Maki',
						desc: 'Filled with fillet beef, cucumber & melted cheese, rolled in crispy tempura fried nori & topped with sriracha mayo & chilli threads.',
						price: '£12.50',
						allergens: ['gluten', 'dairy', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Rainbow Maki',
						desc: 'Filled with crab meat, cucumber, tamago omelette and Japanese mayo, topped with salmon, yellowtail, tuna, avocado & wasabi fish roe.',
						price: '£12',
						allergens: ['fish', 'shellfish', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Garden Maki',
						desc: 'Filled with wakame salad, cucumber, pickled radish & tofu skin, topped with avocado, vegan mayo & strawberry.',
						price: '£10',
						tags: ['vg'],
						allergens: ['soy', 'sesame']
					},
					{
						name: 'Futomaki',
						desc: 'Filled with crab meat, steamed prawn, cucumber, tamago omelette, wakame salad & pickled radish, rolled in nori & topped with sriracha mayo, crispy onions & chilli threads.',
						price: '£10',
						allergens: ['shellfish', 'eggs', 'soy', 'sesame', 'gluten']
					},
					{
						name: 'Prawn Maki',
						desc: 'Filled with crispy prawn, cucumber, pickled radish, topped with melted cheese, wasabi fish roe & chilli threads.',
						price: '£10.50',
						allergens: ['shellfish', 'fish', 'dairy', 'gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Smoked Salmon Maki',
						desc: 'Filled with crab meat, tamago omelette, asparagus & melted cheese, topped with smoked salmon & asparagus.',
						price: '£11',
						allergens: ['fish', 'shellfish', 'dairy', 'eggs', 'soy', 'sesame']
					}
				]
			},
			{
				// Gunkan came off the menu with the July reprint — it survives only as a
				// component of the Winter/Spring platters below.
				title: 'Signature Sushi — Nigiri & Sashimi',
				note: 'Hand-moulded bites of sushi rice, topped with a fresh slice of fish or veg.',
				items: [
					{
						name: 'Salmon / Tuna / Yellowtail Nigiri',
						desc: 'Choice of raw or grilled [4 pieces].',
						price: '£8 / £9 / £10',
						allergens: ['fish', 'soy']
					},
					{
						name: 'Steamed Prawn Nigiri',
						desc: '[4 pieces].',
						price: '£8',
						allergens: ['shellfish', 'soy']
					},
					{
						name: 'Tofu Skin Nigiri',
						desc: 'With sweetcorn, avocado, crispy onion & vegan mayo [4 pieces].',
						price: '£7',
						tags: ['vg'],
						allergens: ['soy', 'gluten']
					},
					{
						name: 'Asparagus Nigiri',
						desc: '[4 pieces].',
						price: '£7',
						tags: ['vg'],
						allergens: ['soy']
					},
					{
						name: 'Salmon / Tuna / Yellowtail Sashimi',
						desc: 'Fresh slices of fish, served raw [5 pieces].',
						price: '£9 / £10 / £10',
						tags: ['gf'],
						allergens: ['fish']
					}
				]
			},
			{
				title: 'Sushi Platters',
				items: [
					{
						name: 'Spring Platter',
						desc: '4 x Garden Maki, 4 x Veg Futomaki, 6 x Pickle Radish Hosomaki, 2 x Vegan Gunkan, 2 x Asparagus Nigiri, 2 x Tofu Skin Nigiri. 20 pieces.',
						price: '£27.50',
						tags: ['vg'],
						allergens: ['soy', 'sesame', 'gluten']
					},
					{
						name: 'Summer Platter',
						desc: '6 x Smoked Salmon Hosomaki, 4 x Beef Maki, 4 x Karaage Maki, 4 x Prawn Maki, 2 x Grilled Tuna Nigiri. 20 pieces.',
						price: '£35.50',
						allergens: ['fish', 'shellfish', 'dairy', 'gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Winter Platter',
						desc: '4 x Rainbow Maki, 4 x Smoked Salmon Maki, 2 x Salmon Sashimi, 2 x Tuna Sashimi, 2 x Yellowtail Sashimi, 2 x Fishroe Gunkan, 2 Geisha Gunkan, 2 x Crab Meat Nigiri. 20 pieces.',
						price: '£33.50',
						allergens: ['fish', 'shellfish', 'dairy', 'eggs', 'soy', 'sesame']
					}
				]
			}
		]
	},
	// Restaurant Week, 5–11 Oct 2026 — word for word from
	// geisha_asia_restaurant_week_oct26.pdf (Drive: geisha_asia_restaurant_week_WithBG).
	// TIME-LIMITED: remove this entry (and run sync-menus-to-db.ts) once it ends.
	// The sheet's "VGO"/"VO" (vegan/vegetarian option) icons map to 'v'. Allergens
	// are copied from the same dish on the Main menu; the desserts and naan appear
	// on no other Asia menu, so they carry none — confirm in venue.
	{
		slug: 'restaurant-week',
		title: 'Restaurant Week',
		subtitle: 'Starter & main for £20 · 5th–11th October 2026',
		pdf: '/geisha_asia_restaurant_week_oct26.pdf',
		sections: [
			{
				title: 'Starters',
				note: 'Available Monday to Thursday all day, Friday and Saturday until 4pm & Sunday all day. 5th to 11th October 2026.',
				items: [
					{
						name: 'Edamame Beans',
						desc: 'Salt & chilli.',
						tags: ['vg', 'gf'],
						allergens: ['soy']
					},
					{
						name: 'Chicken & Vegetable Gyoza [5 pieces]',
						desc: 'Deep fried chicken & vegetable dumplings.',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: '1/4 Crispy Aromatic Duck',
						desc: 'Served with pancakes, hoisin sauce, leek & cucumber.',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Asian Pork Ribs',
						desc: 'Choice of honey BBQ or salt & chilli.',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Salt & Chilli Chicken',
						desc: 'Crispy chicken with chilli, garlic, salt & pepper.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Salt & Chilli Tofu',
						desc: 'Crispy tofu with chilli, garlic, salt & pepper.',
						tags: ['vg', 'spicy'],
						allergens: ['soy', 'gluten']
					},
					{
						name: 'Sweet Potato Croquettes',
						desc: 'Served with truffle mayo.',
						tags: ['v'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Sushi Maki',
						desc: 'Mat-rolled sushi, filled with delicious fresh ingredients. Choice of salmon, tuna, yellow tail or cucumber (vegan).',
						tags: ['v'],
						allergens: ['fish', 'soy', 'sesame']
					}
				]
			},
			{
				title: 'Mains',
				items: [
					{
						name: 'Chicken Katsu Burger',
						desc: 'Panko breaded crispy chicken breast, steam seeded bun, katsu sauce, Asian slaw, crispy lettuce & spicy mayo with fries.',
						allergens: ['gluten', 'eggs', 'soy', 'sesame', 'mustard']
					},
					{
						name: 'Chinese Black Bean',
						desc: 'Choose from vegetables, chicken, beef or prawn (+ £2) in a bold black bean sauce with rice.',
						tags: ['v'],
						allergens: ['soy', 'gluten', 'shellfish']
					},
					{
						name: 'Japanese Chicken Katsu',
						desc: 'Breaded chicken breast served with Japanese curry sauce and rice.',
						allergens: ['gluten', 'eggs', 'soy']
					},
					{
						name: 'Far East Sweet & Sour',
						desc: 'Crispy chicken strips or battered king prawns (+ £2) in sweet & sour sauce with rice.',
						allergens: ['gluten', 'eggs', 'shellfish', 'soy']
					},
					{
						name: 'Chow Mein',
						desc: 'Choose from vegetables, chicken, beef or prawn (+ £2).',
						tags: ['v'],
						allergens: ['gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Spicy Szechuan',
						desc: 'Crispy strips of sirloin beef or chicken meat in szechuan sauce with rice.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Thai Green / Red Curry',
						desc: 'Served with rice. Choose from vegetables, chicken or prawns (+ £2).',
						tags: ['v', 'spicy'],
						allergens: ['fish', 'shellfish', 'soy']
					},
					{
						name: 'Salmon Poke Bowl',
						desc: 'Served with shelled edamame beans, avocado, sweetcorn, wakame salad, tamago omelette, fish roe, pickled radish, wasabi & Japanese soy sauce. Your choice of steamed rice or sushi rice.',
						allergens: ['fish', 'eggs', 'soy', 'sesame']
					}
				]
			},
			{
				title: 'Sides',
				items: [
					{
						name: 'Stir Fry Vegetables',
						desc: 'Seasonal selection of vegetables, with garlic & ginger or oyster sauce (items subject to availability).',
						price: '£7.50',
						tags: ['v'],
						allergens: ['shellfish', 'soy', 'gluten']
					},
					{
						name: 'Rice',
						desc: 'Choose from egg fried or coconut.',
						price: '£4.50',
						tags: ['v'],
						allergens: ['eggs', 'soy']
					},
					{
						name: 'Soft Noodles',
						desc: 'With beansprouts and spring onions.',
						price: '£6',
						tags: ['v'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Fries',
						desc: 'Choose from plain fries or upgrade to truffle mayo fries, wasabi fries or salt & chilli fries.',
						price: '£4.50 / £5.50',
						tags: ['v'],
						allergens: ['gluten', 'eggs', 'mustard']
					},
					{
						name: 'Naan Bread',
						price: '£3',
						tags: ['vg']
					},
					{
						name: 'Sauces',
						desc: 'Katsu curry, Thai curry, Satay, Szechuan, Sweet & Sour.',
						price: '£4.50',
						allergens: ['nuts', 'soy', 'gluten', 'shellfish']
					}
				]
			},
			{
				title: 'Desserts',
				items: [
					{
						name: 'Mochi',
						desc: 'Perfect glutinous balls with an ice cream core. Ask your server for flavour selection.',
						price: '£7.50',
						tags: ['v']
					},
					{
						name: 'Black Profiterol',
						desc: 'Soft choux pastry filled with cream and coated in chocolate with white chocolate sauce & raspberry flakes.',
						price: '£7.50',
						tags: ['v']
					},
					{
						name: 'Cheesecake of the Day',
						desc: 'Ask your server for today’s selection.',
						price: '£7.50'
					},
					{
						name: 'Dorayaki',
						desc: 'Soft Japanese pancake with a smooth & creamy filling, served with whipped cream & icing sugar. Custard or Strawberry or Chocolate.',
						price: '£4.50',
						tags: ['v']
					},
					{
						name: 'Korean Ice Cream Sandwich',
						desc: 'A crisp fish-shaped wafer filled with vanilla ice cream & traditional sweet red bean paste, served with pistachio sauce, Lotus biscuit crumbs & whipped cream.',
						tags: ['v']
					}
				]
			}
		]
	},
	{
		slug: 'evening-special',
		title: 'Evening Special',
		subtitle: 'Starter & main — £23.50',
		pdf: '/geisha_asia_evening_special_mar26.pdf',
		sections: [
			{
				title: 'Starters',
				note: 'Available Mon - Thu from 5pm & all day Sunday. Excludes bank holidays and the festive season. Management reserves the right to change the menu and prices or withdraw the offer without prior notice. All dishes are subject to availability.',
				items: [
					{ name: 'Edamame Beans', desc: 'Salt & chilli.', tags: ['vg', 'gf'], allergens: ['soy'] },
					{
						name: 'Karaage Chicken',
						desc: 'Drizzled with japanese mayo and topped with nori seasoning.',
						allergens: ['gluten', 'eggs', 'soy']
					},
					{
						name: 'Asian Pork Ribs',
						desc: 'Choice of honey BBQ OR chilli, garlic, onion & peppers.',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Geisha Salt & Chilli',
						desc: 'Chilli, garlic, onion & peppers with your choice of crispy chicken, crispy squid OR crispy tofu.',
						tags: ['spicy'],
						allergens: ['gluten', 'shellfish', 'soy']
					},
					{
						name: 'Katsu Prawns',
						desc: 'Ebi prawns in panko breadcrumbs coating with katsu sauce.',
						allergens: ['shellfish', 'gluten', 'eggs', 'soy']
					},
					{
						name: 'Geisha Wings',
						desc: 'Deep fried buffalo chicken wings. Choice of spicy gochujang sauce OR chilli, garlic, onion & peppers.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Garden Maki [4 pieces]',
						desc: 'Filled with wakame salad, cucumber, pickled radish & tofu skin, topped with avocado, vegan mayo & strawberry.',
						tags: ['vg'],
						allergens: ['soy', 'sesame']
					},
					{
						name: 'Smoked Salmon Maki [4 pieces]',
						desc: 'Filled with crab meat, tamago omelette, asparagus & melted cheese, topped with smoked salmon & asparagus.',
						allergens: ['fish', 'shellfish', 'dairy', 'eggs', 'soy', 'sesame']
					}
				]
			},
			{
				title: 'Mains',
				note: 'Rice upgrades are available at £1.50 extra.',
				items: [
					{
						name: 'Chow Mein',
						desc: 'Choose from vegetables, chicken, beef or prawn (+£1.50).',
						allergens: ['gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Thai Green / Red Curry',
						desc: 'Served with rice. Choose from vegetables, chicken or prawns (+£1.50).',
						tags: ['spicy'],
						allergens: ['fish', 'shellfish', 'soy']
					},
					{
						name: 'Massaman Curry',
						desc: 'Choose from vegetables, chicken or prawn (+£1.50). With sweet potatoes, mixed vegetables, cashew nuts & rice.',
						tags: ['gf'],
						allergens: ['nuts', 'shellfish', 'soy']
					},
					{
						name: 'Japanese Chicken Katsu',
						desc: 'Breaded chicken breast served with Japanese curry sauce and rice.',
						allergens: ['gluten', 'eggs', 'soy']
					},
					{
						name: 'Geisha KFC',
						desc: 'Korean fried boneless chicken thighs in sticky gochujang sauce with rice.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Far East Sweet & Sour',
						desc: 'Crispy chicken strips or battered king prawns (+£1.50) in sweet & sour sauce with rice.',
						allergens: ['gluten', 'eggs', 'shellfish', 'soy']
					},
					{
						name: 'Spicy Szechuan',
						desc: 'Crispy strips of sirloin beef or chicken meat in szechuan sauce with rice.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Japanese Wagyu Burger',
						desc: 'A5 Wagyu Beef Pattie, steamed seeded bun, cheese, wasabi ketchup, Asian slaw, crispy lettuce & spicy mayo with fries.',
						allergens: ['gluten', 'dairy', 'eggs', 'soy', 'sesame', 'mustard']
					},
					{
						name: 'Vegan Poke Bowl',
						desc: 'Tofu skin, pickled radish, avocado, sweetcorn, wakame salad, edamame beans, fresh seaweed, wasabi & Japanese soy sauce.',
						tags: ['vg'],
						allergens: ['soy', 'sesame']
					},
					{
						name: 'Raw Salmon Poke Bowl',
						desc: 'Served with shelled edamame beans, avocado, sweetcorn, wakame salad, tamago omelette, fish roe, pickled radish, wasabi & Japanese soy sauce.',
						allergens: ['fish', 'eggs', 'soy', 'sesame']
					}
				]
			},
			{
				title: 'Sides',
				items: [
					{
						name: 'Stir Fry Vegetables',
						desc: 'Seasonal selection of vegetables, with garlic & ginger or oyster sauce (items subject to availability).',
						price: '£7.50',
						tags: ['vg'],
						allergens: ['shellfish', 'soy', 'gluten']
					},
					{
						name: 'Fries',
						desc: 'Choose from plain fries or upgrade to truffle mayo fries, wasabi fries or salt & chilli fries.',
						price: '£4.50 / £5.50',
						tags: ['vg'],
						allergens: ['gluten', 'eggs', 'mustard']
					},
					{
						name: 'Soft Noodles',
						desc: 'Egg noodles with beansprouts and spring onions.',
						price: '£6',
						tags: ['vg'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Rice',
						desc: 'Choose from egg fried or coconut.',
						price: '£4.50',
						tags: ['vg'],
						allergens: ['eggs', 'soy']
					},
					{
						name: 'Sauces',
						desc: 'Katsu curry, Thai curry, Satay, Szechuan, Sweet & Sour.',
						price: '£4.50',
						allergens: ['nuts', 'soy', 'gluten', 'shellfish']
					}
				]
			}
		]
	},
	{
		slug: 'daytime-special',
		title: 'Daytime Special',
		subtitle: 'Mix & match any two dishes — £15',
		pdf: '/geisha_daytime_special_mar26.pdf',
		sections: [
			{
				title: 'Mix & Match (any two — £15)',
				note: 'Available Mon - Fri 12 to 5pm. Excludes bank holidays and the festive season. Management reserves the right to change the menu and prices or withdraw the offer without prior notice. All dishes are subject to availability.',
				items: [
					{
						name: 'Edamame Beans',
						desc: 'Served in shell with salt & chilli seasoning.',
						tags: ['vg'],
						allergens: ['soy']
					},
					{
						name: 'Salt & Chilli Chicken',
						desc: 'Crispy chicken with chilli, garlic, onion & peppers.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Salt & Chilli Tofu',
						desc: 'Crispy tofu with chilli, garlic, onion & peppers.',
						tags: ['vg', 'spicy'],
						allergens: ['soy', 'gluten']
					},
					{
						name: 'Asian Pork Ribs',
						desc: 'Choice of honey BBQ OR chilli, garlic, onion & peppers.',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Geisha Wings',
						desc: 'Deep fried buffalo chicken wings. Choice of spicy gochujang sauce OR chilli, garlic, onion & peppers.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Chicken Satay Skewers',
						desc: 'Chicken in satay sauce.',
						allergens: ['nuts', 'soy']
					},
					{
						name: 'Hagow Dim Sum',
						desc: 'Steamed prawn dumplings [3 pieces].',
						allergens: ['shellfish', 'gluten', 'soy', 'sesame']
					},
					{
						name: 'Vegetables Spring Rolls',
						desc: 'Deep fried vegetables rolls [3 pieces].',
						tags: ['v'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Chicken & Vegetable Gyoza',
						desc: 'Deep fried chicken & vegetable dumplings [4 pieces].',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Sushi Maki',
						desc: 'Mat-rolled sushi, filled with delicious fresh ingredients. Choice of salmon, tuna, yellow tail or cucumber (vegan).',
						tags: ['vg'],
						allergens: ['fish', 'soy', 'sesame']
					}
				]
			},
			{
				title: 'Extras / Sides',
				items: [
					{
						name: 'Rice',
						desc: 'Choose from egg fried or coconut rice.',
						price: '£4.50',
						allergens: ['eggs', 'soy']
					},
					{
						name: 'Soft Noodles',
						desc: 'Egg noodles with beansprouts and spring onions.',
						price: '£6',
						tags: ['vg'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Salt & Chilli Fries',
						price: '£5.50',
						tags: ['vg', 'spicy'],
						allergens: ['gluten']
					},
					{
						name: 'Sauces',
						desc: 'Katsu curry, Thai curry, Satay, Szechuan, Sweet & sour.',
						price: '£4.50',
						allergens: ['nuts', 'soy', 'gluten', 'shellfish']
					}
				]
			}
		]
	},
	{
		slug: 'cocktails',
		title: '2 for £14 Cocktails',
		subtitle: 'Two of the same, ordered together — £14',
		pdf: '/geisha_asia_2for14_mar26.pdf',
		sections: [
			{
				title: 'Cocktails',
				note: 'Available all day Sun - Thu / Fri until 5pm. Two of the same cocktails, ordered at the same time. Exclude bank holidays and the festive season. Management reserves the right to change the menu and prices or withdraw the offer without prior notice.',
				items: [
					{
						name: 'Raspberry Cosmo',
						desc: 'The sweet and sour classic. Absolut Raspberry shaken with triple sec, cranberry juice and fresh lime.',
						allergens: ['sulphites']
					},
					{
						name: 'Aperol Spritz',
						desc: 'The classic combination of Aperol, prosecco and soda. Served with a slice of fresh orange and strawberries.',
						allergens: ['sulphites']
					},
					{
						name: 'Geisha Mojito',
						desc: 'Bacardi white rum, muddled lime, sugar and mint topped with soda and a choice of our freshly made fruit purees to finish; (+£0.75) strawberry, raspberry, mango, blueberry, mixed berries.',
						allergens: ['sulphites']
					},
					{
						name: 'Geisha Margarita',
						desc: 'Cazadores tequila, Triple sec, lime, sugar syrup and a choice of our freshly made fruit puree to finish (+£0.75): Strawberry, raspberry, mango, blueberry, mixed berries.',
						allergens: ['sulphites']
					},
					{
						name: 'Rising Sun',
						desc: 'Tropical fruit punch: Eristoff vodka, orange & pineapple juice, fresh lemon, peach puree, ginger ale and topped with a drizzle of grenadine.',
						allergens: ['sulphites']
					},
					{
						name: 'Geisha Daiquiri',
						desc: 'The classic mix of Bacardi white rum, lime, sugar syrup and a choice of our fresh purees to finish; Strawberry, raspberry, mango, blueberry, mixed berries.',
						allergens: ['sulphites']
					}
				]
			}
		]
	},
	{
		slug: 'bottomless-brunch',
		title: 'Bottomless Brunch',
		subtitle: '£40 per person · 90 minutes',
		pdf: '/geisha_asia_bottomless_brunch.pdf',
		sections: [
			{
				title: 'What’s included',
				note: 'Available All Day Sun - Thu / Fri & Sat 12 - 4.30pm (Last Booking 3pm). Brunch Includes: 90mins unlimited prosecco or large house wine (175ml), or pints of house beer/cider, or bottled beers. 3 dishes for each guest. Exclusions at managers discretion & the festive season. Management reserves the right to change the menu, prices or withdraw without prior notice. Dishes are subject to availability.',
				items: []
			},
			{
				title: 'Feeling Fancy? Cocktail Upgrade',
				note: 'Upgrade to cocktails for extra £7.50pp. If you upgrade you’ll still be able to get the drinks from the bottomless menu. Choose from...',
				items: [
					{
						name: 'Aperol Spritz',
						desc: 'The classic combination of Aperol, prosecco and soda. Served with a slice of fresh orange.'
					},
					{
						name: 'Margarita',
						desc: 'Tequila, triple sec, sugar syrup, lime juice & salt.'
					},
					{
						name: 'Pornstar Martini',
						desc: 'Absolut vanilla, passion fruit liqueur, pineapple juice and lime.'
					},
					{
						name: 'Strawberry Daiquiri',
						desc: 'Bacardi Blanco rum, fresh lime, sugar and homemade strawberry puree.'
					},
					{
						name: 'Cosmopolitan',
						desc: 'Absolut citron, triple sec, cranberry juice, gomme and fresh lime.'
					}
				]
			},
			{
				title: 'Asian Bites (choose your dishes)',
				items: [
					{ name: 'Edamame Beans', desc: 'Salt & chilli.', tags: ['vg', 'gf'], allergens: ['soy'] },
					{
						name: 'XL King Prawn Toast',
						desc: 'Sweet chilli sauce.',
						allergens: ['shellfish', 'gluten', 'sesame', 'eggs']
					},
					{
						name: 'Chicken Satay Skewers',
						desc: 'Chicken in satay sauce.',
						allergens: ['nuts', 'soy']
					},
					{
						name: 'Salt & Chilli Squid',
						desc: 'Crispy squid with chilli, garlic, salt & pepper.',
						tags: ['spicy'],
						allergens: ['shellfish', 'gluten', 'soy']
					},
					{
						name: 'Salt & Chilli Chicken',
						desc: 'Crispy chicken with chilli, garlic, salt & pepper.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Salt & Chilli King Prawns',
						desc: 'Crispy prawns with chilli, garlic, salt & pepper.',
						tags: ['spicy'],
						allergens: ['shellfish', 'gluten', 'eggs', 'soy']
					},
					{
						name: 'Salt & Chilli Tofu',
						desc: 'Crispy tofu with chilli, garlic, salt & pepper.',
						tags: ['vg', 'spicy'],
						allergens: ['soy', 'gluten']
					},
					{
						name: 'Asian Pork Ribs',
						desc: 'Choice of Honey BBQ or chilli, garlic, salt.',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Geisha Wings',
						desc: 'Deep fried buffalo chicken wings. Choice of spicy gochujang sauce or chilli, garlic, salt & pepper.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy', 'sesame']
					}
				]
			},
			{
				title: 'Dim Sum',
				items: [
					{
						name: 'Hagow',
						desc: 'Steamed prawn dumplings.',
						allergens: ['shellfish', 'gluten', 'soy', 'sesame']
					},
					{
						name: 'Chicken & Vegetable Gyoza',
						desc: 'Deep fried chicken & vegetable dumplings.',
						allergens: ['gluten', 'soy', 'sesame']
					},
					{
						name: 'Vegetable Spring Rolls',
						desc: 'Deep fried vegetable rolls.',
						tags: ['v'],
						allergens: ['gluten', 'soy']
					}
				]
			},
			{
				title: 'Sushi — Maki',
				note: 'Mat-rolled sushi, filled and topped with delicious fresh ingredients.',
				items: [
					{
						name: 'Karaage Maki [4 pieces]',
						desc: 'Filled with fresh salad, karaage chicken & Japanese mayo rolled in crispy panko bread crumbed nori and topped with tonkatsu mayo & chilli threads.',
						allergens: ['gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Smoked Salmon Maki [4 pieces]',
						desc: 'Filled with crab meat, tamago omelette, asparagus & melted cheese, topped with smoked salmon & asparagus.',
						allergens: ['fish', 'shellfish', 'dairy', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Futomaki [4 pieces]',
						desc: 'Filled with crab meat, steamed prawn, cucumber, tamago omelette, wakame salad & pickled radish, rolled in nori & topped with sriracha mayo, crispy onions & chilli threads.',
						allergens: ['shellfish', 'eggs', 'soy', 'sesame', 'gluten']
					},
					{
						name: 'Prawn Maki [4 pieces]',
						desc: 'Filled with crispy prawn, cucumber, pickled radish, topped with melted cheese, wasabi fish roe & chilli threads.',
						allergens: ['shellfish', 'fish', 'dairy', 'gluten', 'eggs', 'soy', 'sesame']
					},
					{
						name: 'Garden Maki [4 pieces]',
						desc: 'Filled with wakame salad, cucumber, pickled radish & tofu skin, topped with avocado, vegan mayo & strawberry.',
						tags: ['vg'],
						allergens: ['soy', 'sesame']
					}
				]
			},
			{
				// Allergens per nigiri copied from the same pieces on the main menu.
				title: 'Sushi — Nigiri',
				note: 'Hand-moulded bites of sushi rice, topped with a fresh slice of fish or meat.',
				items: [
					{ name: 'Salmon', desc: 'Choice of raw or grilled.', allergens: ['fish', 'soy'] },
					{ name: 'Tuna', desc: 'Choice of raw or grilled.', allergens: ['fish', 'soy'] },
					{ name: 'Yellow Tail', allergens: ['fish', 'soy'] },
					{ name: 'Steamed Prawn', allergens: ['shellfish', 'soy'] },
					{ name: 'Tofu Skin', tags: ['vg'], allergens: ['soy', 'gluten'] },
					{ name: 'Asparagus', tags: ['vg'], allergens: ['soy'] }
				]
			},
			{
				title: 'Sushi — Sashimi',
				note: 'Fresh slices of fish, served raw.',
				items: [
					{ name: 'Salmon', tags: ['gf'], allergens: ['fish'] },
					{ name: 'Tuna', tags: ['gf'], allergens: ['fish'] },
					{ name: 'Yellow Tail', tags: ['gf'], allergens: ['fish'] }
				]
			}
		]
	},
	{
		slug: 'kids',
		title: 'Kids Menu',
		subtitle: 'Kids combo plate — £8.50',
		pdf: '/geisha_asia_kids_menu_jun26.pdf',
		sections: [
			{
				title: 'Kids Combo Plate — £8.50',
				note: 'The PDF doubles as an activity sheet (maze, word search & dot-to-dot).',
				items: [
					{
						name: 'Kids Combo Plate',
						desc: 'Choose between; chicken katsu, fried chicken or karaage mayo chicken. Served with fries, soft noodles, cucumber hosomaki and dorayaki dessert.',
						price: '£8.50',
						allergens: ['gluten', 'eggs', 'dairy', 'soy', 'sesame', 'mustard']
					}
				]
			}
		]
	},
	{
		slug: 'drinks',
		title: 'Drinks',
		subtitle: 'Cocktails, sake, wine, beer & more',
		pdf: '/asia_drinks_menu_mar26.pdf',
		sections: [
			{
				title: 'Cocktails',
				items: [
					{
						name: 'Rouge Royale',
						desc: 'The perfect French Martini, a luscious mix of vanilla vodka and Chambord, shaken with homemade mixed berry purée and fresh juices.',
						price: '£9',
						allergens: ['sulphites']
					},
					{
						name: 'Bamboo Breeze',
						desc: 'A light serve of Grey Goose Watermelon & Basil, St Germain elderflower, fresh cucumber, and lime, finished with sparkling ginger beer.',
						price: '£10',
						allergens: ['sulphites']
					},
					{
						name: 'Daydream in Blue (Frozen)',
						desc: 'Bacardi Blanca rum, blue curacao, pineapple juice, yuzu puree and lime blended until smooth. Topped with blueberry bubbles.',
						price: '£12',
						allergens: ['sulphites']
					},
					{
						name: 'Gooseberry Garden',
						desc: 'Grey Goose, St Germain elderflower liqueur, and ginger ale with fresh berries and cucumber. Light, crisp, and floral - perfect for any occasion.',
						price: '£11',
						allergens: ['sulphites']
					},
					{
						name: 'Samurai Smash',
						desc: 'Pink Strawberry Gin, Kwai Feh lychee liqueur, muddled with lemon, lychee juice and fresh blackberries to make a fruity smash.',
						price: '£9',
						allergens: ['sulphites']
					},
					{
						name: 'Yuzu & Rose Amaretto Sour',
						desc: 'Disaronno, lemon juice, yuzu sake and rose. The beloved classic with a floral twist.',
						price: '£9',
						allergens: ['nuts', 'sulphites', 'eggs']
					},
					{
						name: 'Tropical Daiquiri (Frozen)',
						desc: 'Bacardi Caribbean Spiced rum, overproof rum and fresh lime blended with guava, passion fruit and coconut. Served with a mini bottle of pineapple and a flaming fruit.',
						price: '£11',
						allergens: ['sulphites']
					},
					{
						name: 'Raspberry Ripple Pina Colada',
						desc: 'Bacardi Coconut rum, cream, fresh pineapple and coconut blended with ice and finished with a swirl of raspberry puree.',
						price: '£9.50',
						allergens: ['dairy', 'sulphites']
					},
					{
						name: 'Aperol Spritz',
						desc: 'The classic combination of Aperol, prosecco and soda. Served with a slice of fresh orange and strawberries.',
						price: '£9.50',
						allergens: ['sulphites']
					},
					{
						name: 'Lucky Geisha (Frozen)',
						desc: 'A frozen passionfruit and mango margarita perfect for summer! Cazadores tequila, lime with pineapple; homemade mango puree, and passionfruit puree, topped with strawberry bubbles.',
						price: '£12',
						allergens: ['sulphites']
					},
					{
						name: 'Geisha Margarita',
						desc: 'Cazadores tequila, triple sec, lime and sugar with a half-salted rim. Served up in a classic martini or on the rocks, ask server for fruity and spicy options with our homemade purees and inhouse infused tequila (+£0.75). Upgrade to Patron Silver + £2.50.',
						price: '£9',
						allergens: ['sulphites']
					},
					{
						name: 'Lychee Martini',
						desc: 'Eristoff vodka, Kwai Feh lychee liqueur, St Germain liqueur, lychee juice and lime juice served straight up with a crushed raspberry rim.',
						price: '£9',
						allergens: ['sulphites']
					},
					{
						name: 'Espresso Martini',
						desc: 'A pick me up with class. Eristoff vodka, Kahlua, fresh espresso and gomme expertly finished with chocolate sauce. Add a choice of flavours (+60p); Caramel, vanilla, hazelnut.',
						price: '£9',
						allergens: ['dairy', 'soy', 'sulphites']
					},
					{
						name: 'Kyoto Spritz',
						desc: 'A fruity twist on the classic summer spritz! Bombay Sapphire Gin mixed with the sweet dragon fruit, mango and fresh lemons, topped with prosecco and soda.',
						price: '£9',
						allergens: ['sulphites']
					},
					{
						name: 'Mango Mai Tai',
						desc: 'Let’s keep it short and sweet. Bacardi spiced rum, triple sec mixed with pineapple, lime, orgeat and our homemade mango puree, under a layer of cream and lime zest. (contains nuts).',
						price: '£9.50',
						allergens: ['nuts', 'sulphites']
					},
					{
						name: 'Pornstar Martini',
						desc: 'A true modern classic, Absolut vanilla, passion fruit liqueur, pineapple juice and lime. Served with a shot of prosecco.',
						price: '£10',
						allergens: ['sulphites']
					},
					{
						name: 'Geisha Daiquiri',
						desc: 'The classic mix of Bacardi Blanca rum, lime and sugar. Add one of our freshly made fruit puree to finish (+£0.75) strawberry, raspberry, mango, blueberry, mixed berries.',
						price: '£8.50',
						allergens: ['sulphites']
					},
					{
						name: 'Geisha Mojito',
						desc: 'Bacardi Blanca rum, muddled lime, sugar and mint topped with soda, and a choice of a our freshly made fruit puree to finish (+£0.75) strawberry, raspberry, mango, blueberry, mixed berries, passion fruit.',
						price: '£9',
						allergens: ['sulphites']
					}
				]
			},
			{
				title: 'Sharing Cocktails',
				items: [
					{
						name: 'Temple Tea',
						desc: 'Sweet and refreshing mix of Cazcabel coconut tequila, passion fruit liqueur, jasmine, fresh lime, and pineapple juice, served in a stylish cast iron teapot. Perfect for 3-4 people. Ask server for availability.',
						price: '£37.50',
						allergens: ['sulphites']
					}
				]
			},
			{
				title: 'Sake',
				note: 'Sake is a traditional Japanese rice wine with a smooth, delicate flavour that ranges from sweet to dry, often with subtle fruity, floral or umami notes. It can be served chilled or warm and pairs beautifully with sushi, seafood and grilled meats. It is also a perfect choice to enjoy on its own. Per 50ml / bottle.',
				items: [
					{
						name: 'Ume No Yado ‘Yuzu’',
						desc: 'Yuzu-infused sake, expertly captures the perfect balance of sweet and tangy flavours from the aromatic Japanese citrus fruit.',
						price: '£6 / £45',
						allergens: ['sulphites']
					},
					{
						name: 'Ume No Yado ‘Plum’',
						desc: 'Ume sake liqueur crafted from the sweet, green ume fruit, a Japanese plum renowned for its vibrant, fruity flavour.',
						price: '£6 / £45',
						allergens: ['sulphites']
					},
					{
						name: 'Akitabare ‘Shunsetsu’',
						desc: 'Our house sake is a light, subtly sweet pour with a clean, pleasantly dry finish.',
						price: '£6 / £50',
						allergens: ['sulphites']
					},
					{
						name: 'Masumi ‘Okuden Kantsukuri’',
						desc: 'A comforting, familiar sake with smooth, subtle organic flavours and a gentle, natural sweetness.',
						price: '£6.50 / £55',
						allergens: ['sulphites']
					},
					{
						name: 'Dewazakura ‘Oka’',
						desc: 'Velvety smooth on the palate, this sake offers a delicate floral bouquet, complemented by fruity notes of pear and melon.',
						price: '£6.50 / £60',
						allergens: ['sulphites']
					},
					{ name: 'Sampler', desc: '3x50ml.', price: '£16.50', allergens: ['sulphites'] }
				]
			},
			{
				title: 'Shots',
				note: '1 shot £4.50 / 6 shots £23.50.',
				items: [
					{ name: 'Baby Guinness', desc: 'Baileys, kahlua.' },
					{ name: 'Sweet and Sour', desc: 'Vodka, lemon juice, limoncello, sugar rim.' },
					{ name: 'Jam and Cream', desc: 'Baileys, Chambord, cream.' },
					{ name: 'Squashed Frog', desc: 'Midori, triple sec, Baileys, grenadine.' },
					{ name: 'Mango Inferno', desc: 'Chilli infused tequila, mango bubbles.', tags: ['spicy'] },
					{ name: 'Woo Woo', desc: 'Vodka, peach, cranberry, lime.' }
				]
			},
			{
				title: 'Mocktails',
				items: [
					{
						name: 'Virgin Pina Colada',
						desc: 'Our time tested pina colada recipe of fresh pineapple, cream, coconut puree and orange juice.',
						price: '£5.50',
						tags: ['v'],
						allergens: ['dairy']
					},
					{
						name: 'Strawberry Lychee Sling',
						desc: 'Strawberry puree, lime juice and lychee juice topped with lemonade.',
						price: '£5.50',
						tags: ['vg']
					},
					{
						name: 'Virgin Mojito',
						desc: 'Mint, lime, apple juice, sugar and soda water stirred through crushed ice. Add a fruity twist with our homemade purée (+£0.75).',
						price: '£5.50',
						tags: ['vg']
					},
					{
						name: 'Geisha Milkshake',
						desc: 'Choose from vanilla, chocolate, caramel, strawberry, raspberry, blueberry, mixed berry, or mango, served blended with cream.',
						price: '£5.50',
						tags: ['v'],
						allergens: ['dairy']
					},
					{
						name: 'Geisha Bubble Iced Tea',
						desc: 'Make it your own with 20 flavour combinations. Choose your syrup from: watermelon, passion fruit, green apple or raspberry flavour teas. Then choose your bubble flavour; mango, strawberry, blueberry or lychee.',
						price: '£5.50',
						tags: ['vg']
					}
				]
			},
			{
				title: 'Wine — White',
				note: 'Per 125ml / 175ml / bottle.',
				items: [
					{ name: 'Geisha House Wine', price: '£5.50 / £7 / £23.95', allergens: ['sulphites'] },
					{
						name: 'Pinot Grigio 11%',
						desc: 'Primi Soli - Italy. Dry, crisp and fruity with a wonderful hint of lemon.',
						price: '£6.25 / £7.25 / £28.95',
						allergens: ['sulphites']
					},
					{
						name: 'Sauvignon Blanc 12.5%',
						desc: 'Luna Azul – Chile. Expect a burst of passion fruit and guava. A simple lifted floral finish that is clean on the palate.',
						price: '£6 / £7.25 / £26.95',
						allergens: ['sulphites']
					},
					{
						name: 'Pecorino 12.5%',
						desc: 'Dega Vignamade – Italy. Floral notes with scents of lemon zest, pear and freshly cut grass. On the palate it is fresh and savoury with a slight buttery note. Expressive and well balanced.',
						price: '£6.75 / £8.50 / £29.95',
						allergens: ['sulphites']
					},
					{
						name: 'Sauvignon Blanc 12%',
						desc: 'Waddling Duck – New Zealand. Youthful and very approachable with a nose of intense, fresh gooseberry fruit. The palate is dry and full of white peach and passion fruit flavour.',
						price: '£7 / £9.50 / £33.50',
						allergens: ['sulphites']
					}
				]
			},
			{
				title: 'Wine — Red',
				note: 'Per 125ml / 175ml / bottle. Wine ABVs may change with vintage.',
				items: [
					{ name: 'Geisha House Wine', price: '£5.50 / £7 / £23.95', allergens: ['sulphites'] },
					{
						name: 'Merlot 12.5%',
						desc: 'Luna Azul – Chile. Rounded, soft and full bodied with flavours of plum and sweet spices. This typical Chilean merlot is a great all rounder, capable of pairing with many different foods.',
						price: '£6 / £7.25 / £26.95',
						allergens: ['sulphites']
					},
					{
						name: 'Montepulciano 13%',
						desc: 'Dega Vignamade - Italy. Ruby red in colour, with red fruits such as cherry, blueberry, blackcurrant and plum on the nose. On the palate it is dry and refreshing with soft tannins.',
						price: '£6.75 / £9.25 / £30.50',
						allergens: ['sulphites']
					},
					{
						name: 'Malbec 12.5%',
						desc: 'La Grupa – Argentina. An up - front ripe red fruit nose with sweet spice hints, that lead into a voluminous structure of cherries and plum, followed by a warming pleasant finish.',
						price: '£7 / £9.50 / £33.50',
						allergens: ['sulphites']
					}
				]
			},
			{
				title: 'Wine — Rosé, Sparkling & Champagne',
				note: 'Rose wine per 125ml / 175ml / bottle. Sparkling per 125ml / bottle.',
				items: [
					{
						name: 'Pinot Grigio Blush 11%',
						desc: 'Primi Soli – Italy. A light, delicate style of rose wine with a soft, refreshing burst of summer red fruits.',
						price: '£5.50 / £7 / £23.95',
						allergens: ['sulphites']
					},
					{
						name: 'White Zinfandel 10.5%',
						desc: 'Charlie Zin – California. Fruity and fresh with with flavours of red fruit and hints of spices. Rich in flavour, this wine has a rounded mouthfeel and a long finish.',
						price: '£5.50 / £7 / £23.95',
						allergens: ['sulphites']
					},
					{
						name: 'Sauvignon Blanc Rose 13%',
						desc: 'Writer’s Block – South Africa. A refreshing wine bursting with a bouquet of pineapple and tropical fruit salad flavours. Subtle hints of freshly picked strawberries takes you on an interesting tasting journey whilst the typical finish of gooseberry and lime zest lingers on your palate to remind you of your favourite Sauvignon Blanc.',
						price: '£6.75 / £8.50 / £29.95',
						allergens: ['sulphites']
					},
					{
						name: 'Prosecco DOC 10%',
						desc: 'Famiglia Botter - Italy. Pale light yellow colour with delicate bubbles. An aromatic nose of wild apple with hints of honey and floral notes. Light bodied and well balanced, this is a perfect apertif.',
						price: '£7 / £30.95',
						allergens: ['sulphites']
					},
					{
						name: 'Cava Rose 12%',
						desc: 'Vilarnau - Spain. Aromas that are typical of a delicate rose cava: the subtleties of violets and roses in combination with ripe red berries: strawberries, raspberries and blueberries. On the palate it is smooth, very creamy, fresh and elegant.',
						price: '£39.50',
						allergens: ['sulphites']
					},
					{
						name: 'Champagne — Taittinger 12%',
						desc: 'Brut Réserve NV - France. The Brut Reserve is renowned for its golden yellow colour with a consistent, fine, lingering mousse. The nose is light and delicate with hints of fruits and brioche. The palate is lean, but has considerable depth and elegance with a long fresh finish.',
						price: '£76.50',
						allergens: ['sulphites']
					}
				]
			},
			{
				title: 'Gin',
				note: 'Per single / double.',
				items: [
					{ name: 'Beefeater', price: '£4.25 / £6.25' },
					{ name: 'Bombay Sapphire', price: '£4.50 / £6.75' },
					{ name: 'Bombay Citron Presse', price: '£4.50 / £6.75' },
					{ name: 'Bombay Bramble', price: '£4.50 / £6.75' },
					{ name: 'Beefeater Blood Orange', price: '£4.50 / £6.75' },
					{ name: 'Beefeater Pink', price: '£4.50 / £6.75' },
					{ name: 'Slingsby Rhubarb', price: '£4.75 / £7' },
					{ name: 'Hendricks', price: '£4.75 / £7' },
					{ name: 'Roku', price: '£4.75 / £7' },
					{ name: 'Whitley Neill Rhubarb and Ginger 0%', price: '£3.50 / £5.50' }
				]
			},
			{
				title: 'Rum',
				note: 'Per single / double.',
				items: [
					{ name: 'Bacardi Blanca', price: '£4.25 / £6.25' },
					{ name: 'Bacardi Spiced', price: '£4.25 / £6.25' },
					{ name: 'Bacardi Caribbean Spiced', price: '£4.50 / £6.75' },
					{ name: 'Bacardi Coconut', price: '£4.25 / £6.25' },
					{ name: 'Old J Cherry', price: '£4.25 / £6.25' },
					{ name: 'Old J Dark Spiced', price: '£4.25 / £6.25' }
				]
			},
			{
				title: 'Vodka',
				note: 'Per single / double.',
				items: [
					{ name: 'Eristoff', price: '£4.25 / £6.25' },
					{ name: 'Absolut Vanilla', price: '£4.50 / £6.75' },
					{ name: 'Absolut Citron', price: '£4.50 / £6.75' },
					{ name: 'Absolut Raspberry', price: '£4.50 / £6.75' },
					{ name: 'Grey Goose', price: '£5.25 / £8.25' },
					{ name: 'Grey Goose Strawberry & Lemongrass', price: '£5.25 / £8.25' },
					{ name: 'Grey Goose White Peach & Rosemary', price: '£5.25 / £8.25' },
					{ name: 'Grey Goose Watermelon & Basil', price: '£5.25 / £8.25' }
				]
			},
			{
				title: 'Tequila',
				note: 'Per single / double.',
				items: [
					{ name: 'Cazadores Blanco', price: '£4.50 / £6.75' },
					{ name: 'Cazcabel Coconut', price: '£4.50 / £6.75' },
					{ name: 'Patron Silver', price: '£5.50 / £8.75' },
					{ name: 'Patron XO Cafe', price: '£5.75 / £9.25' },
					{ name: 'Patron Reposado', price: '£6.50 / £9.75' },
					{ name: 'Patron Anejo', price: '£6.50 / £9.75' },
					{ name: 'Tequila Rose', price: '£4.25 / £6.25' }
				]
			},
			{
				title: 'Whisky',
				note: 'Per single / double.',
				items: [
					{ name: 'Maker’s Mark Bourbon', price: '£4.50 / £6.75' },
					{ name: 'Toki Blended Japanese Whisky', price: '£4.50 / £6.75' },
					{ name: 'Jack Daniels', price: '£4.50 / £6.75' },
					{ name: 'Jack Daniels Honey', price: '£4.50 / £6.75' },
					{ name: 'Hibiki Harmony', price: '£8.75 / £16' },
					{ name: 'Teeling Irish Whiskey', price: '£6 / £9' }
				]
			},
			{
				title: 'Liqueurs',
				note: 'Per single / double.',
				items: [
					{ name: 'Sambuca', price: '£3.50 / £5' },
					{ name: 'Limoncello', price: '£3.50 / £5' },
					{ name: 'Kahlua', price: '£3.50 / £5' },
					{ name: 'Chambord', price: '£3.50 / £5' },
					{ name: 'Disaronno Amaretto', price: '£3.50 / £5' },
					{ name: 'St Germain', price: '£3.50 / £5' },
					{ name: 'Aperol', price: '£3.50 / £5' },
					{ name: 'Kwai Feh', price: '£3.50 / £5' },
					{ name: 'Baileys (50ml)', price: '£4' },
					{ name: 'Martini Bianco (50ml)', price: '£4' },
					{ name: 'Martini Extra Dry (50ml)', price: '£4' },
					{ name: 'Martini Rosso (50ml)', price: '£4' }
				]
			},
			{
				title: 'Brandy',
				note: 'Per single / double.',
				items: [{ name: 'Hennessy VS Cognac', price: '£5 / £8' }]
			},
			{
				title: 'Beer & Cider — Draught',
				note: 'Half / pint.',
				items: [
					{
						name: 'Asahi Superdry 5%',
						desc: 'Clean, sophisticated, refreshingly crisp.',
						price: '£3.50 / £6.70',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Lucky Buddha 4.8%',
						desc: 'A true Asian style lager with lots of flavour and a crisp, clean finish.',
						price: '£3.50 / £6.70',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Geisha Export Lager 4%',
						desc: 'Light, crisp and refreshing with punchy notes of citrus peel and light pine.',
						price: '£3.20 / £5.75',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Meantime IPA 4.7%',
						desc: 'Anytime American IPA, tropical refreshment from the heart of London.',
						price: '£3.50 / £6.70',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Geisha Cider 4.5%',
						desc: 'Refreshingly different, expertly crafted. Add a flavour to your cider: watermelon, raspberry, passion fruit, strawberry, peach and more.',
						price: '£3.20 / £5.75',
						allergens: ['sulphites']
					}
				]
			},
			{
				title: 'Beer & Cider — Bottled',
				items: [
					{
						name: 'Blue Moon 5.4% (330ml)',
						desc: 'Belgian style wheat beer, brewed with orange peel and coriander for a subtle sweetness.',
						price: '£5.50',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Desperados 5.9% (330ml)',
						desc: 'A distinctive combination of full bodied lager with a boost of Tequila flavour. A light and refreshing with spicy and lemony notes for sweetness.',
						price: '£5.25',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Rekorderlig Cider 3.4% (500ml)',
						desc: 'Made in Sweden with pure spring water, our beautifully refreshing cider embodies the spirit of Sweden: a modern, forward thinking nation with innovation and balance at it’s core - ask server for current flavours.',
						price: '£6',
						allergens: ['sulphites']
					},
					{
						name: 'Tiger 4.8% (330ml)',
						desc: 'First brewed in Singapore, refreshing full bodied lager with a hint of tropical fruit.',
						price: '£5',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Peroni (Gluten Free) 5% (330ml)',
						desc: 'Peroni’s brew masters have perfected a new gluten-free recipe for Italy’s most iconic beer without compromising on taste.',
						price: '£5',
						tags: ['gf'],
						allergens: ['sulphites']
					},
					{
						name: 'Asahi Super Dry Zero 0% (330ml)',
						desc: 'The same signature crisp, refreshing, super dry taste without the alcohol.',
						price: '£4.25',
						allergens: ['gluten', 'sulphites']
					}
				]
			},
			{
				title: 'Soft Drinks',
				note: 'Dash / reg / pint. Dash of draught soft drinks and fruit juices all £1.20.',
				items: [
					{
						name: 'Pepsi / Pepsi Max / Lemonade',
						price: '£1.20 / £3.25 / £4'
					},
					{
						name: 'Eager & Rubicon Juices',
						desc: 'Orange, Apple, Pineapple, Cranberry, Lychee, Guava.',
						price: '£1.20 / £3.25 / £4'
					},
					{ name: 'J2O (275ml)', desc: 'Ask server for flavours.', price: '£4', allergens: ['sulphites'] },
					{ name: 'Aloe Vera Juice', desc: '(natural aloe vera, mango).', price: '£3.50 / £4.50' },
					{ name: 'Bottled Coke / Diet (200ml)', price: '£3' },
					{ name: 'Bottled Fanta [330ml]', price: '£3.50' },
					{ name: 'Belu Bottled Water (750ml)', price: '£4' },
					{
						name: 'Fevertree Mixer (200ml)',
						desc: 'Perfectly complement your premium spirits or enjoy on its own. Tonic, light tonic, ginger ale, ginger beer.',
						price: '£2.75'
					}
				]
			},
			{
				title: 'Hot Drinks — Coffee',
				note: 'Oat milk available. Decaf available.',
				items: [
					{ name: 'Single Espresso', price: '£2.50' },
					{ name: 'Double Espresso', price: '£3.50' },
					{ name: 'Americano', price: '£3.50' },
					{ name: 'Latte', price: '£3.75', allergens: ['dairy'] },
					{ name: 'Cappuccino', price: '£3.75', allergens: ['dairy'] },
					{ name: 'Flat White', price: '£3.75', allergens: ['dairy'] },
					{
						name: 'Irish Coffee',
						desc: 'Teeling Whisky, Kahlua, Baileys, Hennessy.',
						price: '£7',
						allergens: ['dairy', 'sulphites']
					},
					{
						name: 'Syrups',
						desc: 'Vanilla, caramel, hazelnut, chai, chocolate.',
						price: '£0.50'
					}
				]
			},
			{
				title: 'Speciality Coffee',
				items: [
					{
						name: 'Chai Latte',
						desc: 'Steamed milk, chai syrup, topped with chocolate powder. Add shot of espresso.',
						price: '£4.50',
						allergens: ['dairy']
					},
					{
						name: 'Nutella Hot Chocolate',
						desc: 'A generous amount of Nutella© mixed with steamed milk and finished with cream and caramel sprinkles.',
						price: '£4.50',
						allergens: ['dairy', 'nuts', 'soy']
					},
					{
						name: 'Matcha Latte',
						desc: 'Premium Japanese matcha, vanilla syrup and steamed milk.',
						price: '£4.50',
						allergens: ['dairy']
					}
				]
			},
			{
				title: 'Tea',
				items: [
					{ name: 'English Breakfast Tea', price: '£3' },
					{
						name: 'Herbal Teas - Teapigs',
						desc: 'Lemongrass, Jasmine, Earl Grey, Peppermint and Green Tea.',
						price: '£4'
					}
				]
			}
		]
	},
	{
		slug: 'allergens',
		title: 'Allergens & Dietary',
		subtitle: 'Full allergen matrix — download the PDF',
		pdf: '/geisha_allergy_menu_feb26.pdf',
		sections: [
			{
				title: 'About our allergen information',
				note: 'The PDF above lists every dish against all 14 major allergens — it is the full picture, and individual dishes are deliberately not labelled on the website, because many can be adapted on request and a fixed label cannot say so. Recipes are updated often, so please check on each visit and always inform your server of any allergy or intolerance before ordering.',
				items: []
			},
			{
				title: 'What we cannot guarantee',
				note: 'All food is prepared in kitchens where nuts, gluten and other allergens are present, so we cannot guarantee a 100% allergen-free environment, nor the processes used by our suppliers.',
				items: []
			}
		]
	}
];
