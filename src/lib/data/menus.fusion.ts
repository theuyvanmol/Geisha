import type { Menu } from './menu-types';

// Geisha Fusion — real menus transcribed from the current PDFs (Jan–Feb 2026).
// Prices in £. Diet tags: v=vegetarian, vg=vegan, gf=gluten-free, spicy.
// A discretionary 10% service charge is added in venue. Always confirm
// allergens with staff; gluten-free pizza/pasta bases are available.

export const FUSION_MENUS: Menu[] = [
	// Main menu — transcribed word for word from the client's October 2026 print
	// file (g_fusion_main_menu_oct26.pdf, Drive: g_fusion_main_menu_update_PRINTFILE).
	// 'new' tags = the PDF's "New" badges. The PDF's "VGO"/"VO" (vegan/vegetarian
	// option) icons map to 'v' — the data model has no "option" tag.
	{
		slug: 'main',
		title: 'Main Menu',
		subtitle: 'A global fusion of flavours — starters, grills, pizza, pasta & more',
		pdf: '/g_fusion_main_menu_oct26.pdf',
		sections: [
			{
				title: 'Starters & Light Bites',
				note: 'Enjoy as a pre-main or satisfying light meal.',
				items: [
					{
						name: 'Mediterranean Dips',
						desc: 'Smooth hummus, tzatziki & mixed olives served with flatbread.',
						price: '£7.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'sesame']
					},
					{
						name: 'Geisha Bruschetta',
						desc: 'Choose from: Tomato, garlic, basil, red onion & parmesan shavings OR Creamy garlic mushrooms & truffle oil.',
						price: '£7.50 / £8',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Garlic Bread Pizza',
						desc: 'Choice of plain, tomato or cheese.',
						price: '£7.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					// Gluten-free on EVERY menu (owner, Aug 2026). The owner flagged only the
					// Special Menu, but confirmed the dish is the same one throughout — this
					// entry was the odd one out, claiming gluten while Sunday and Special
					// both said gluten-free. NB this is the roasted 'Jumbo Chicken Wings';
					// the brunch menu's 'Jumbo Buffalo Wings' has a southern-fried option and
					// is a different dish, so it keeps its gluten.
					{
						name: 'Jumbo Chicken Wings',
						desc: 'Marinated & roasted in our homemade seasoning.',
						price: '£7.50',
						tags: ['gf'],
						allergens: ['soy']
					},
					{
						name: 'Arancino',
						desc: 'Golden breaded rice ball filled with Ragu (coated in parmesan) OR Spinach and mozzarella, both served in tomato sauce.',
						price: '£8',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Caesar Salad',
						desc: 'A classic crispy salad of baby gem lettuce, grilled chicken breast, caesar dressing, bacon, red onion, croutons, anchovies & parmesan shaving.',
						price: '£8.50',
						tags: ['new']
					},
					{
						name: 'Spare Ribs',
						desc: 'Pork ribs in BBQ sauce with sesame seeds & spring onion.',
						price: '£9.50',
						tags: ['gf'],
						allergens: ['soy', 'sesame']
					},
					{
						name: 'Prawn Cocktail',
						desc: 'Baby gem lettuce, baby prawns, marie rose sauce, diced tomatoes, cucumbers & paprika.',
						price: '£10',
						tags: ['gf'],
						allergens: ['shellfish', 'eggs', 'mustard']
					},
					{
						name: 'Garlic King Prawns',
						desc: 'Pan fried king prawns with garlic, white wine, capers, onions & samphire, served with toasted bread.',
						price: '£10.50',
						allergens: ['shellfish', 'gluten', 'dairy', 'sulphites']
					},
					{
						name: 'Crispy King Prawns',
						desc: 'In a light tempura batter & coated with panko breadcrumb, served with sweet chilli sauce.',
						price: '£10.50',
						allergens: ['shellfish', 'gluten', 'eggs']
					},
					{
						name: 'North Sea Mussels',
						desc: 'Served with toasted bread. Choice of tomato, garlic & chilli OR White wine, garlic, cream & dill.',
						price: '£9',
						allergens: ['shellfish', 'gluten', 'dairy', 'sulphites']
					},
					{
						name: 'Thai Crispy Squid',
						desc: 'Fresh deep fried squid in salt & chilli spice served with sweet chilli sauce.',
						price: '£9',
						tags: ['spicy'],
						allergens: ['shellfish', 'gluten']
					},
					{
						name: 'Mozzarella Bites',
						desc: 'Crispy sticks of creamy mozzarella served with cranberry sauce.',
						price: '£8',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'House Potato Skins',
						desc: 'Homemade crispy potato skins served with garlic mayo.',
						price: '£6',
						tags: ['v', 'gf'],
						allergens: ['mustard', 'soy']
					}
				]
			},
			{
				title: 'Fusion Favourites',
				note: 'Our Fusion twist on flavourful dishes from around the World.',
				items: [
					{
						name: 'Sizzling Fajitas',
						desc: 'Warm tortillas, guacamole, salsa, tzatziki and cheese, served with fries. Choice of vegetables, chicken or prawns.',
						price: '£13.50 / £14.50 / £16.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'shellfish']
					},
					{
						name: 'Chicken Souvlaki',
						desc: 'Marinated grilled chicken skewers served on a flatbread with tzatziki dressing, pickled cabbage, fresh Greek salad, ranch drizzle & fries.',
						price: '£18.50',
						allergens: ['gluten', 'dairy', 'eggs', 'mustard']
					},
					{
						name: 'Lamb Kofta',
						desc: 'Lamb kofta served on a flatbread with tzatziki dressing, pickled cabbage, fresh Greek salad & fries.',
						price: '£18.50',
						tags: ['spicy'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Geisha Curry',
						desc: 'A mild curry bursting with coconut & ginger flavours, served with rice. Choice of vegetables, chicken or prawns. Add flatbread + £2.',
						price: '£14 / £15 / £16.50',
						tags: ['gf', 'new']
					},
					{
						name: 'Geordie Bangers & Mash',
						desc: 'Geordie bangers Cumberland sausage, caramelised onions & homemade gravy.',
						price: '£16.50',
						tags: ['new']
					},
					{
						name: 'Cherry & Port Duck',
						desc: 'Served with creamy mash potato & kale with homemade port & cherry sauce.',
						price: '£17.50',
						tags: ['new']
					},
					{
						name: 'Seabass',
						desc: 'Choose from Lemon and thyme butter sauce OR Tomato dressing. Served with dill & garlic crushed potatoes. Add king prawns + £3.',
						price: '£16.50',
						tags: ['gf'],
						allergens: ['fish', 'dairy', 'shellfish']
					},
					{
						name: 'Traditional Fish & Chips',
						desc: 'Light and crispy battered cod with chips & tartar sauce.',
						price: '£15',
						allergens: ['fish', 'gluten', 'eggs', 'mustard', 'sulphites']
					},
					{
						name: 'New York Chicken Alfredo',
						desc: 'Chicken breast, pancetta, mushrooms & cream served with dill crushed potatoes.',
						price: '£17.50',
						tags: ['gf'],
						allergens: ['dairy']
					},
					{
						name: 'Geisha Parmo',
						desc: 'Breaded chicken breast, Parmesan cheese, bechamel sauce, garlic, mozzarella & cheddar cheese, served with fries. Choose from: Pepperoni OR Ham & mushroom.',
						price: '£17.50',
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Pork Belly',
						desc: 'Rolled crispy pork belly, served with black pudding mash, seasonal vegetables, mustard cream sauce & pork crackling.',
						price: '£18.50',
						allergens: ['dairy', 'mustard', 'gluten', 'sulphites']
					},
					{
						name: 'Spanish Chicken & Seafood Paella',
						desc: 'With prawns, mussels, squid, saffron, garden peas & chicken (good to share for 2 people).',
						price: '£21.50',
						tags: ['new']
					}
				]
			},
			{
				title: 'Pizza',
				note: 'Handmade pizza & garlic bread. Gluten-free base available. Extra toppings from + £1.50.',
				items: [
					{
						name: 'Margherita',
						desc: 'Red base, mozzarella cheese, fresh basil & extra virgin olive oil.',
						price: '£11.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Vegetarian',
						desc: 'Red base, mozzarella cheese, grilled vegetables, red onion & olives.',
						price: '£13.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Bolognese',
						desc: 'Red base, mozzarella cheese, bolognese sauce and basil.',
						price: '£13.50',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Sausage & Pancetta',
						desc: 'Red base, mozzarella cheese, cherry tomatoes, minced tuscan sausage, crispy pancetta & thyme.',
						price: '£15',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Pepperoni',
						desc: 'Red base, mozzarella cheese, pepperoni.',
						price: '£14.50',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Meat Feast',
						desc: 'Red base, mozzarella cheese, pepperoni, ham, tuscan sausage.',
						price: '£15',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Classic Calzone (folded pizza)',
						desc: 'Red base, mozzarella cheese, ham & mushroom. Served with bolognese sauce on the side.',
						price: '£16',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Nduja',
						desc: 'Red base, mozzarella cheese, red onion, basil & spicy Nduja.',
						price: '£14.50',
						tags: ['new']
					}
				]
			},
			{
				title: 'Pasta',
				note: 'Choose between penne, rigatoni, linguine or gluten free pasta.',
				items: [
					{
						name: 'Arrabbiata',
						desc: 'Tomatoes, garlic, chilli & fresh herbs. Add chicken or sausage + £3.',
						price: '£11.50',
						tags: ['vg', 'spicy'],
						allergens: ['gluten']
					},
					{
						name: 'Vegetarian',
						desc: 'Aubergines, courgettes, peppers, mushrooms, onions, tomato, basil & fresh herbs.',
						price: '£12.50',
						tags: ['vg'],
						allergens: ['gluten']
					},
					{
						name: 'Carbonara',
						desc: 'Egg yolk, pancetta, black pepper, cream, parmesan & parsley.',
						price: '£14',
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Puttanesca',
						desc: 'Chilli & garlic tomato sauce, with onions, olives, capers, anchovies & fresh herbs.',
						price: '£14',
						tags: ['new']
					},
					{
						name: 'Bolognese',
						desc: 'Beef, tomato sauce & parmesan cheese.',
						price: '£13.50',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Sausage & Pancetta',
						desc: 'Tuscan sausage, pancetta, tomato sauce, garlic, onion & fresh herbs.',
						price: '£13.50',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Lasagne',
						desc: 'Oven baked traditional home-made beef lasagne & fresh herbs.',
						price: '£14.50',
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Seafood Pasta',
						desc: 'Mussels, prawns, squid, tomato sauce, dill, onion, garlic & white wine.',
						price: '£18',
						allergens: ['gluten', 'shellfish', 'fish', 'sulphites']
					},
					{
						name: 'Lobster Ravioli',
						desc: 'With samphire, cherry tomatoes, dill, mussels & prawns.',
						price: '£18',
						allergens: ['gluten', 'shellfish', 'dairy', 'eggs']
					}
				]
			},
			{
				title: 'Grill',
				note: 'All dishes served with tomato, onion ring and kale & cabbage slaw.',
				items: [
					{
						name: 'Fusion Meat Platter',
						desc: "A carnivore's dream! Chicken wings, Geordie banger Cumberland sausages, rump steak, chicken souvlaki, lamb kofta served with onion rings, house fries and choice of two sauces included (see sauces for options).",
						price: '£36',
						tags: ['spicy'],
						allergens: ['gluten', 'dairy', 'eggs', 'soy', 'sesame', 'mustard']
					},
					{ name: '8oz Rump Steak', price: '£19', tags: ['gf'] },
					{ name: '8oz Fillet Steak', price: '£31.50', tags: ['gf'] },
					{
						name: 'Fillet Surf & Turf',
						desc: 'Tender 8oz fillet steak with king prawns, cooked in garlic butter sauce.',
						price: '£36',
						tags: ['gf'],
						allergens: ['shellfish', 'dairy']
					},
					{
						name: 'Chicken Breast',
						desc: 'Chargrilled chicken breast.',
						price: '£15',
						tags: ['gf']
					},
					{
						name: "Sauce 'Em Up",
						desc: 'Peppercorn, Blue cheese, Chimichurri, Garlic butter or Creamy spinach sauce. Add Onion Rings + £2.',
						price: '+£2.50'
					}
				]
			},
			{
				title: 'Burgers',
				items: [
					{
						name: 'Build Your Own Burger',
						desc: 'Start with our juicy burger, choose between beef or crispy chicken. Served with cheddar cheese or blue cheese, lettuce, tomato and fries. Burgers price starts at 10.50 before any additional toppings.',
						price: '£10.50',
						tags: ['new']
					},
					{
						name: 'Add Your Toppings',
						desc: 'Gherkins £1 · Caramelised onion £1.50 · Bacon £1.50 · Fried Egg £1 · Extra Beef Patty £3 · Extra cheese £1.50 · Kale cabbage coleslaw £1.50 · Ranch sauce £0.50 · Bbq sauce £0.50 · Mustard sauce £0.50 · Onion ring £1.50 · Jalapenos £0.50 · Crispy Jalapeno cheese £2'
					},
					{
						name: 'Vegan Burger',
						desc: 'Luxury veggie patty, with tomato, salad, tomato chutney, crispy onion, vegan mayo & vegan cheese.',
						price: '£13',
						tags: ['vg'],
						allergens: ['gluten', 'soy', 'mustard']
					}
				]
			},
			{
				title: 'Sides',
				items: [
					{ name: 'House Fries', price: '£4.50', tags: ['vg', 'gf'] },
					{ name: 'Cajun Fries', price: '£4.50', tags: ['vg', 'gf'] },
					{ name: 'Twice Cooked Chips', price: '£4.50', tags: ['vg', 'gf'] },
					{ name: 'Truffle Parmesan Chips', price: '£5.50', tags: ['v'], allergens: ['dairy'] },
					{ name: 'Onion Rings', price: '£4', tags: ['vg'], allergens: ['gluten'] },
					{ name: 'Rice', price: '£4', tags: ['vg', 'gf'] },
					{ name: 'Mixed Salad', price: '£4.50', tags: ['vg', 'gf'], allergens: ['mustard'] }
				]
			}
		]
	},
	// Christmas Day — transcribed from geisha_fusion_christmas_day_menu.pdf.
	{
		slug: 'christmas-day',
		title: 'Christmas Day Menu',
		subtitle: 'Three courses · Adults £99 · Kids £47.50',
		pdf: '/geisha_fusion_christmas_day_menu.pdf',
		sections: [
			{
				title: 'Starters',
				note: 'Enjoy our house nibbles & glass of prosecco (or zero alcohol prosecco) on arrival.',
				items: [
					{
						name: 'Classic Prawn Cocktail',
						desc: 'Served with lettuce, diced tomatoes, cucumber and croutons.'
					},
					{
						name: 'Christmas Soup',
						desc: 'Roasted butternut squash, parmesan cheese, cream, mushrooms & chive oil.'
					},
					{
						name: 'Luxury Salmon Crostini',
						desc: 'Served with cream cheese, smoked salmon, dill, lime, oil and pomegranate.'
					},
					{
						name: 'Chicken Pate',
						desc: 'Served on toast with orange, mixed salad & cranberry sauce.'
					}
				]
			},
			{
				title: 'Mains',
				items: [
					{
						name: 'Christmas Roast',
						desc: 'With roasted potatoes, pigs in blankets, mash potatoes, roasted carrots, parsnip, brussels sprouts, braised red cabbage & yorkshire pudding. Choose from: Turkey, beef brisket, pork belly, gammon, nut roast or butternut squash and lentil wellington or trio of meats (choose any three meats).'
					},
					{
						name: 'Lamb Shank',
						desc: 'Served with homemade gravy, mash potatoes, asparagus & tenderstem broccoli.'
					},
					{
						name: 'Festive Seabass',
						desc: 'Pan fried fillet of seabass served on crushed dill potatoes, with asparagus, tenderstem broccoli, pomegranate, cherry tomatoes and lemon & thyme butter sauce.'
					}
				]
			},
			{
				title: 'Desserts',
				items: [
					{ name: 'Salted Caramel and Chocolate Profiterole', desc: 'Served with berries.' },
					{ name: 'Festive Cheesecake', desc: 'Served with mixed berry puree.' },
					{ name: 'Chocolate Brownie', desc: 'Served with ice cream.' }
				]
			},
			{
				title: 'Kids Starters',
				items: [{ name: 'Christmas Soup' }, { name: 'Chicken Goujons' }, { name: 'Potato Skins' }]
			},
			{
				title: 'Kids Main',
				items: [
					{
						name: 'Christmas Roast',
						desc: 'Turkey, beef brisket, pork belly, gammon, nut roast or butternut squash and lentil wellington.'
					},
					{ name: 'Bolognese Pasta', desc: 'Beef, tomato sauce & parmesan cheese.' }
				]
			},
			{
				title: 'Kids Desserts',
				note: 'Vegan ice cream also available.',
				items: [
					{ name: 'Salted Caramel and Chocolate Profiterole', desc: 'Served with berries.' },
					{ name: 'Festive Cheesecake', desc: 'Served with mixed berry puree.' },
					{ name: 'Chocolate Brownie' }
				]
			}
		]
	},
	// Special Menu — word for word from the October 2026 print file
	// (g_fusion_special_menu_oct26.pdf, Drive: g_fusion_special_menu_PRINTFILES).
	// It dropped the February sheet's "Healthy Mains" (Superfood Salad, Geisha
	// Couscous) and the O.G. Burger; added Caesar Salad, Geisha Curry and Geordie
	// Bangers & Mash.
	{
		slug: 'special',
		title: 'Special Menu',
		subtitle: '1 course £12.95 · 2 courses £17.95 · 3 courses £20.95',
		pdf: '/g_fusion_special_menu_oct26.pdf',
		sections: [
			{
				title: 'Starters',
				items: [
					{
						name: 'Spare Ribs',
						desc: 'Pork ribs in BBQ sauce with sesame seeds & spring onion.',
						tags: ['gf'],
						allergens: ['soy', 'sesame']
					},
					{
						name: 'House Potato Skins',
						desc: 'Homemade crispy potato skins served with garlic mayo.',
						tags: ['v', 'gf'],
						allergens: ['mustard', 'soy']
					},
					{
						name: 'Jumbo Chicken Wings',
						desc: 'Marinated & roasted in our homemade seasoning.',
						tags: ['gf'],
						allergens: ['soy']
					},
					{
						name: 'Caesar Salad',
						desc: 'A classic crispy salad of baby gem lettuce, grilled chicken breast, caesar dressing, bacon, red onion, croutons, anchovies & parmesan shaving.',
						tags: ['new']
					},
					{
						name: 'Hummus',
						desc: 'Served with flatbread.',
						tags: ['vg'],
						allergens: ['gluten', 'sesame']
					},
					{
						name: 'Tomato Bruschetta',
						desc: 'Tomato, garlic, basil, red onion & parmesan shavings.',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Prawn Cocktail',
						desc: 'Baby gem lettuce, baby prawns, marie rose sauce, diced tomatoes, cucumbers & paprika.',
						price: '+£2',
						tags: ['gf'],
						allergens: ['shellfish', 'eggs', 'mustard']
					},
					{
						name: 'North Sea Mussels',
						desc: 'Tomato, garlic & chilli mussels served with toasted bread.',
						price: '+£1.50',
						allergens: ['shellfish', 'gluten', 'sulphites']
					},
					{
						name: 'Thai Crispy Squid',
						desc: 'Fresh deep fried squid in salt & chilli spice served with sweet chilli sauce.',
						price: '+£1.50',
						tags: ['spicy'],
						allergens: ['shellfish', 'gluten']
					},
					{
						name: 'Arancino',
						desc: 'Golden breaded rice ball filled with Ragu (coated in parmesan) OR Spinach and mozzarella, both served in tomato sauce.',
						price: '+£1.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					}
				]
			},
			{
				title: 'Mains',
				note: 'Extra toppings from + £1.50 | Gluten free pizza base available. Excludes bank holidays and the festive season. Management reserves the right to change the menu and prices or withdraw the offer without prior notice. All dishes are subject to availability.',
				items: [
					{
						name: 'Seabass',
						desc: 'Choose from Lemon and thyme butter sauce OR tomato dressing. Served with dill & garlic crushed potatoes. Add lemon & thyme butter + £1.50.',
						tags: ['gf'],
						allergens: ['fish', 'dairy']
					},
					{
						name: 'Geisha Curry',
						desc: 'A mild curry bursting with coconut & ginger flavours, served with rice. Choice of vegetables, chicken or prawns + £2.',
						tags: ['v', 'new']
					},
					{
						name: '8oz Rump Steak',
						desc: 'Served with tomato, onion ring and kale & cabbage slaw.',
						price: '+£2.50',
						tags: ['gf']
					},
					{
						name: 'Pork Belly',
						desc: 'Served with black pudding mash, seasonal vegetables & mustard cream sauce.',
						price: '+£1.50',
						allergens: ['gluten', 'dairy', 'mustard', 'sulphites']
					},
					{
						name: 'Lamb Kofta',
						desc: 'Lamb kofta served on a flatbread with tzatziki dressing, pickled cabbage, fresh Greek salad & fries.',
						price: '+£2.50',
						tags: ['spicy'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Geordie Bangers & Mash',
						desc: 'Geordie banger Cumberland sausage and mash, caramelised onions & homemade gravy.',
						price: '+£1.50',
						tags: ['new']
					},
					{
						name: 'Traditional Fish and Chips',
						desc: 'Light and crispy battered cod with chips & tartar sauce.',
						allergens: ['fish', 'gluten', 'eggs', 'mustard', 'sulphites']
					},
					{
						name: 'New York Chicken Alfredo',
						desc: 'Chicken breast, pancetta, mushrooms & cream served with dill crushed potatoes.',
						tags: ['gf'],
						allergens: ['dairy']
					},
					{
						name: 'Chicken Breast',
						desc: 'Chargrilled chicken breast served with rice and broccoli.',
						tags: ['gf']
					},
					{
						name: 'Carbonara Pasta',
						desc: 'Egg yolk, pancetta, black pepper, cream & parmesan.',
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Vegetarian Pasta',
						desc: 'Aubergines, courgettes, peppers, mushrooms, onions, tomato, basil & fresh herbs.',
						tags: ['vg'],
						allergens: ['gluten']
					},
					{
						name: 'Bolognese Pasta',
						desc: 'Beef, tomato sauce & parmesan cheese.',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Arrabbiata Pasta',
						desc: 'Tomatoes, garlic & chilli sauce. Add chicken or sausage + £3.',
						tags: ['vg', 'spicy'],
						allergens: ['gluten']
					},
					{
						name: 'Margherita Pizza',
						desc: 'Red base, mozzarella cheese, fresh basil & extra virgin olive oil.',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Vegetarian Pizza',
						desc: 'Red base, mozzarella cheese, grilled vegetables, caramelised onion & olives.',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Pepperoni Pizza',
						desc: 'Red base, mozzarella cheese, pepperoni.',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Bolognese Pizza',
						desc: 'Red base, mozzarella cheese, bolognese sauce and basil.',
						allergens: ['gluten', 'dairy']
					}
				]
			},
			{
				title: 'Desserts',
				note: 'A discretionary 10% service charge will be added to all bills. All tips & service charges go directly to our hard working team.',
				items: [
					{
						name: 'Cheesecake of the Day',
						desc: 'Ask server for details.',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Ice Cream',
						desc: 'Choice of vanilla, chocolate or strawberry.',
						tags: ['v', 'gf'],
						allergens: ['dairy']
					},
					{
						name: 'Chocolate Fudge Cake',
						desc: 'Served with cream or ice cream.',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs', 'soy']
					}
				]
			}
		]
	},
	// Sunday Menu — word for word from the October 2026 print file
	// (fusion_sunday_menu_oct26.pdf, Drive: "Geisha Sunday Menu_PRINTFILE_USETHISFILE").
	// Page 2's à la carte dropped Geisha Couscous, both old burgers, Smoked Salmon
	// Pasta and Linguine Meatballs; added Puttanesca, Sausage & Pancetta, Geordie
	// Bangers & Mash and Build Your Own Burger. Allergens are copied from the same
	// dish on the Main menu.
	{
		slug: 'sunday-roast',
		title: 'Sunday Menu',
		subtitle: 'Roasts from £11.95 · 2 courses +£5 · 3 courses +£8',
		pdf: '/fusion_sunday_menu_oct26.pdf',
		sections: [
			{
				title: 'Roast',
				note: 'All roasts served with homemade gravy, Yorkshire pudding, mash potatoes, roasted potatoes & vegetables. Roasted cauliflower cheese baked in rich, cheese sauce + £3. Make a meal of it by adding a starter, a dessert or both! 2 courses + £5 · 3 courses + £8.',
				items: [
					{
						name: 'Roast Chicken',
						price: '£14.95',
						allergens: ['gluten', 'eggs', 'dairy', 'sulphites']
					},
					{
						name: 'Belly Pork',
						price: '£15.95',
						allergens: ['gluten', 'eggs', 'dairy', 'sulphites']
					},
					{
						name: 'Beef Brisket',
						price: '£16.95',
						allergens: ['gluten', 'eggs', 'dairy', 'sulphites']
					},
					{
						name: 'Lamb Shank',
						price: '£18.95',
						allergens: ['gluten', 'eggs', 'dairy', 'sulphites']
					},
					{
						name: 'Roasted Lamb',
						price: '£17.95',
						allergens: ['gluten', 'eggs', 'dairy', 'sulphites']
					},
					{
						name: 'Luxury Nut Roast',
						price: '£11.95',
						tags: ['v'],
						allergens: ['nuts', 'gluten', 'eggs', 'dairy']
					},
					{
						name: 'The Geisha Trio',
						desc: 'Choose any three meats (excludes lamb shank).',
						price: '£19.95',
						allergens: ['gluten', 'eggs', 'dairy', 'sulphites']
					}
				]
			},
			{
				title: 'Starters',
				note: 'Prices shown are from the Sunday à la carte — or add a starter to a roast: 2 courses + £5 · 3 courses + £8.',
				items: [
					{
						name: 'Bruschetta',
						desc: 'Tomato, garlic, basil, red onion & parmesan shavings.',
						price: '£7.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Prawn Cocktail',
						desc: 'Baby gem lettuce, baby prawns, marie rose sauce, diced tomatoes, cucumbers & paprika.',
						price: '£10',
						tags: ['gf'],
						allergens: ['shellfish', 'eggs', 'mustard']
					},
					{
						name: 'Arancino',
						desc: 'Golden breaded rice ball filled with Ragu (coated in parmesan) OR Spinach and mozzarella, both served in tomato sauce.',
						price: '£8',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Thai Crispy Squid',
						desc: 'Fresh deep fried squid in salt & chilli spice served with sweet chilli sauce.',
						price: '£9',
						tags: ['spicy'],
						allergens: ['shellfish', 'gluten']
					},
					{
						name: 'Garlic Bread Pizza',
						desc: 'Choice of plain, tomato or cheese.',
						price: '£7.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'House Potato Skins',
						desc: 'Homemade crispy potato skins with garlic mayo.',
						price: '£6',
						tags: ['v', 'gf'],
						allergens: ['mustard', 'soy']
					},
					{
						name: 'Jumbo Chicken Wings',
						desc: 'Marinated & roasted in our homemade seasoning.',
						price: '£7.50',
						tags: ['gf'],
						allergens: ['soy']
					},
					{
						name: 'Crispy King Prawns',
						desc: 'In a light tempura batter & coated with panko breadcrumb, served with sweet chilli sauce.',
						price: '£10.50',
						allergens: ['shellfish', 'gluten', 'eggs']
					},
					{
						name: 'Mozzarella Bites',
						desc: 'Crispy sticks of creamy mozzarella served with cranberry sauce.',
						price: '£8',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					}
				]
			},
			{
				title: 'Desserts',
				items: [
					{
						name: 'Cheesecake of the Day',
						desc: 'Ask server for details.',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Chocolate Brownie',
						desc: 'Served with ice cream.',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs', 'soy']
					},
					{
						name: 'Sticky Toffee Pudding',
						desc: 'Soft sponge cake topped with toffee sauce served with ice cream.',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Ice Cream',
						desc: 'Choice of vanilla, chocolate or strawberry.',
						tags: ['v', 'gf'],
						allergens: ['dairy']
					}
				]
			},
			{
				title: 'Sunday à la carte — Fusion Favourites',
				note: 'Gluten free pasta and pizza base available.',
				items: [
					{
						name: 'Traditional Fish & Chips',
						desc: 'Light and crispy battered cod with chips & tartar sauce.',
						price: '£15',
						allergens: ['fish', 'gluten', 'eggs', 'mustard', 'sulphites']
					},
					{
						name: 'Seabass',
						desc: 'Choose from Lemon and thyme butter sauce OR Tomato dressing. Served with dill & garlic crushed potatoes. Add king prawns + £3.',
						price: '£16.50',
						tags: ['gf'],
						allergens: ['fish', 'dairy', 'shellfish']
					},
					{
						name: 'Geisha Parmo',
						desc: 'Breaded chicken breast, Parmesan cheese, bechamel sauce, garlic, mozzarella & cheddar cheese, served with fries. Choose from: Pepperoni OR Ham & mushroom.',
						price: '£17.50',
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Puttanesca',
						desc: 'Chilli & garlic tomato sauce, with onions, olives, capers, anchovies & fresh herbs.',
						price: '£14',
						tags: ['new']
					},
					{
						name: 'Sausage & Pancetta',
						desc: 'Tuscan sausage, pancetta, tomato sauce, garlic, onion & fresh herbs.',
						price: '£13.50',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Geordie Bangers & Mash',
						desc: 'Geordie bangers Cumberland sausage and mash, caramelised onions & homemade gravy.',
						price: '£16.50',
						tags: ['new']
					},
					{
						name: 'Carbonara Pasta',
						desc: 'Egg yolk, pancetta, black pepper & cream, parmesan.',
						price: '£14',
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Arrabbiata Pasta',
						desc: 'Tomatoes, garlic & chilli sauce. Add chicken or sausage + £3.',
						price: '£11.50',
						tags: ['vg'],
						allergens: ['gluten']
					},
					{
						name: 'Lasagne',
						desc: 'Oven baked home-made beef lasagne.',
						price: '£14.50',
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Lobster Ravioli',
						desc: 'With samphire, cherry tomatoes, dill, mussels & prawns.',
						price: '£18',
						allergens: ['gluten', 'shellfish', 'dairy', 'eggs']
					},
					{
						name: 'Bolognese Pasta',
						desc: 'Beef, tomato sauce & parmesan cheese.',
						price: '£13.50',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Margherita Pizza',
						desc: 'Red base, mozzarella cheese, fresh basil & extra virgin olive oil.',
						price: '£11.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Meat Feast Pizza',
						desc: 'Red base, mozzarella cheese, pepperoni, ham, tuscan sausage.',
						price: '£15',
						allergens: ['gluten', 'dairy']
					},
					// The print file reads "pepperon" — a typo on the sheet, not a new dish.
					{
						name: 'Pepperoni Pizza',
						desc: 'Red base, mozzarella cheese, pepperoni.',
						price: '£14.50',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Bolognese Pizza',
						desc: 'Red base, mozzarella cheese, bolognese sauce and basil.',
						price: '£13.50',
						allergens: ['gluten', 'dairy']
					}
				]
			},
			{
				title: 'Sunday à la carte — Burgers',
				items: [
					{
						name: 'Build Your Own Burger',
						desc: 'Start with our juicy burger, choose between beef or crispy chicken. Served with cheddar cheese or blue cheese, lettuce, tomato and fries. Burgers price starts at 10.50 before any additional toppings.',
						price: '£10.50',
						tags: ['new']
					},
					{
						name: 'Add Your Toppings',
						desc: 'Gherkins £1 · Caramelised onion £1.50 · Bacon £1.50 · Fried Egg £1 · Extra Beef Patty £3 · Extra cheese £1.50 · Kale cabbage coleslaw £1.50 · Ranch sauce £0.50 · Bbq sauce £0.50 · Mustard sauce £0.50 · Onion ring £1.50 · Jalapenos £0.50 · Crispy Jalapeno cheese £2'
					}
				]
			},
			{
				title: 'Sunday à la carte — Sides',
				note: 'Please inform your server if you have an allergy or intolerance. A discretionary 10% service charge will be added to all bills. All tips & service charges go directly to our hard working team.',
				items: [
					{ name: 'House Fries', price: '£4.50', tags: ['vg', 'gf'] },
					{ name: 'Cajun Fries', price: '£4.50', tags: ['vg', 'gf'] },
					{ name: 'Twice Cooked Chips', price: '£4.50', tags: ['vg', 'gf'] },
					{ name: 'Truffle & Parmesan Chips', price: '£5.50', tags: ['v'], allergens: ['dairy'] },
					{ name: 'Rice', price: '£4', tags: ['vg', 'gf'] },
					{ name: 'Mixed Salad', price: '£4.50', tags: ['vg', 'gf'], allergens: ['mustard'] }
				]
			}
		]
	},
	{
		slug: 'kids',
		title: 'Kids Menu',
		subtitle: 'Any main & dessert for £6.50',
		pdf: '/fusion_kids_menu_mar26.pdf',
		sections: [
			{
				title: 'Mains',
				note: 'Kids menu available for all kids up to 12 years old.',
				items: [
					{
						name: 'Hummus',
						desc: 'Served with carrots and cucumber sticks.',
						tags: ['vg'],
						allergens: ['sesame']
					},
					{
						name: 'Chicken Goujons',
						desc: 'Served with fries OR corn on the cob OR carrots sticks.',
						allergens: ['gluten', 'eggs']
					},
					{
						name: 'Fish Fingers',
						desc: 'Served with fries OR corn on the cob OR carrots sticks.',
						allergens: ['fish', 'gluten', 'eggs']
					},
					{ name: 'House Potato Skins', desc: 'Served with ketchup.' },
					{
						name: 'Napoli Pasta',
						desc: 'Tomato, basil, parmesan.',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Bolognese Pasta',
						desc: 'Beef, tomato sauce & parmesan cheese.',
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Carbonara Pasta',
						desc: 'Egg yolk, pancetta, black pepper, cream & parmesan.',
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Margherita Pizza',
						desc: 'Red base, mozzarella cheese, fresh basil & extra virgin olive oil.',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Bolognese Pizza',
						desc: 'Red base, mozzarella cheese, bolognese sauce and basil.',
						allergens: ['gluten', 'dairy']
					}
				]
			},
			{
				title: 'Sunday Roast',
				note: 'Only available on Sunday.',
				items: [
					{
						name: 'Sunday Roast + Free Dessert',
						desc: 'Served with gravy, Yorkshire pudding, mash potato, roasted potatoes & vegetables. Choice of chicken, pork or brisket.',
						price: '£8.50',
						allergens: ['gluten', 'eggs', 'dairy', 'sulphites']
					}
				]
			},
			{
				title: 'Desserts',
				items: [
					{
						name: 'Ice Cream',
						desc: 'Choice of vanilla, chocolate or strawberry.',
						tags: ['v', 'gf'],
						allergens: ['dairy']
					},
					{
						name: 'Chocolate Brownie',
						desc: 'Served with ice cream.',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs', 'soy']
					}
				]
			}
		]
	},
	{
		slug: 'desserts',
		title: 'Desserts',
		subtitle: 'A sweet finish',
		pdf: '/geisha_fusion_dessert_menu_oct26.pdf',
		sections: [
			{
				title: 'Desserts',
				note: 'Please inform your server if you have an allergy or intolerance.',
				items: [
					{
						name: 'Cheesecake of the Day',
						desc: 'Ask server for details.',
						price: '£7.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Homemade Chocolate Brownie',
						desc: 'Served with ice cream.',
						price: '£7.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs', 'soy']
					},
					{
						name: 'Sticky Toffee Pudding',
						desc: 'Soft sponge cake topped with toffee sauce served with ice cream.',
						price: '£7.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Chocolate Fudge Cake',
						desc: 'Served with cream or ice cream.',
						price: '£7.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs', 'soy']
					},
					// New in the Oct 2026 reprint. Allergens are this dish's obvious ones
					// (choux = gluten + eggs; cream and chocolate = dairy, soy) — the
					// allergen menu predates it, so confirm in venue.
					{
						name: 'Chocolate Profiterole',
						desc: 'Soft choux pastry filled with cream and coated in chocolate with white chocolate sauce.',
						price: '£7.50',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs', 'soy']
					},
					{
						name: 'Ice Cream',
						desc: 'Choice of vanilla, chocolate or strawberry.',
						price: '£6',
						tags: ['v', 'gf'],
						allergens: ['dairy']
					}
				]
			}
		]
	},
	{
		slug: 'bottomless-brunch',
		title: 'Bottomless Brunch',
		subtitle: '£35 per person · 90 minutes',
		pdf: '/geisha_fusion_bottomless_brunch.pdf',
		sections: [
			{
				title: 'What’s included',
				note: 'Available All Day Mon-Thu | Fri & Sat 12 - 5.30pm (Last Booking 4pm). Brunch includes: 90mins unlimited prosecco or house wine (250ml), or pints of house beer/cider, or bottled beers. Three dishes for each guest.',
				items: []
			},
			{
				title: 'Feeling Fancy?',
				note: "Upgrade to cocktails for extra £7.50pp. If you upgrade you'll still be able to get the drinks from the bottomless menu. Choose from:",
				items: [
					{
						name: 'Aperol Spritz',
						desc: 'The classic combination of Aperol, prosecco and soda.'
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
				title: 'Choose three dishes',
				items: [
					{
						name: 'Nachos',
						desc: 'Tortilla chips, topped with mozzarella and nacho cheese, guacamole, salsa, sour cream, pico de gallo.',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Mediterranean Dips',
						desc: 'Smooth hummus, tzatziki & mixed olives served with flatbread.',
						tags: ['vg'],
						allergens: ['gluten', 'sesame']
					},
					{
						name: 'Spare Ribs',
						desc: 'Pork ribs in BBQ sauce with sesame seeds & spring onion.',
						tags: ['gf'],
						allergens: ['soy', 'sesame']
					},
					{
						name: 'Geisha Bruschetta',
						desc: 'Tomato, garlic, basil, red onion & parmesan shavings.',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					},
					{
						name: 'Arancino',
						desc: 'Golden breaded rice ball filled with Ragu (coated in parmesan) OR Spinach and mozzarella, both served in tomato sauce.',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Jumbo Buffalo Wings',
						desc: 'Simply oven roasted OR Crispy southern fried served with sweet chilli dip.',
						tags: ['spicy'],
						allergens: ['gluten', 'soy']
					},
					{
						name: 'Prawn Cocktail',
						desc: 'Baby gem lettuce, baby prawns, marie rose sauce, diced tomatoes, cucumbers & paprika.',
						tags: ['gf'],
						allergens: ['shellfish', 'eggs', 'mustard']
					},
					{
						name: 'North Sea Mussels',
						desc: 'Served with toasted bread. Choice of tomato, garlic & chilli or white wine, garlic, cream & dill.',
						allergens: ['shellfish', 'gluten', 'dairy', 'sulphites']
					},
					{
						name: 'Thai Crispy Squid',
						desc: 'Fresh deep fried squid in salt & chilli spice served with sweet chilli sauce.',
						tags: ['spicy'],
						allergens: ['shellfish', 'gluten']
					},
					{
						name: 'House Potato Skins',
						desc: 'Homemade crispy potato skins served with garlic mayo.',
						allergens: ['mustard', 'soy']
					},
					{
						name: 'Mozzarella Bites',
						desc: 'Crispy sticks of creamy mozzarella served with cranberry sauce.',
						tags: ['v'],
						allergens: ['gluten', 'dairy']
					}
				]
			},
			{
				title: 'Desserts',
				note: 'Please inform your server if you have an allergy or intolerance.',
				items: [
					{
						name: 'Cheesecake of the Day',
						desc: 'Ask server for details.',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs']
					},
					{
						name: 'Chocolate Brownie',
						desc: 'Served with ice cream.',
						tags: ['v'],
						allergens: ['gluten', 'dairy', 'eggs', 'soy']
					},
					{
						name: 'Ice Cream',
						desc: 'Choice of vanilla, chocolate or strawberry.',
						tags: ['v', 'gf'],
						allergens: ['dairy']
					}
				]
			}
		]
	},
	{
		slug: 'drinks',
		title: 'Drinks',
		subtitle: 'Cocktails, wine, beer & more',
		pdf: '/geisha_fusion_drinks_mar26.pdf',
		sections: [
			{
				title: 'Cocktails',
				items: [
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
						desc: 'Bacardi Blanca, muddled with lime, sugar, and mint topped with soda and a choice of our freshly made fruit puree (+£0.75). Try a spiced twist with Bacardi Spiced rum, or level up to a tropical kick with Bacardi Caribbean Spiced (+£1.50).',
						price: '£9',
						allergens: ['sulphites']
					},
					{
						name: 'Geisha Margarita',
						desc: 'Cazadores tequila, Triple sec, lime, sugar syrup and a choice of our freshly made fruit puree to (+£0.75) strawberry, raspberry, mango, blueberry, mixed berries. Upgrade to Patron Silver (+£2.50).',
						price: '£9',
						allergens: ['sulphites']
					},
					{
						name: 'Hugo Spritz',
						desc: 'St. Germain elderflower liqueur stirred with mint and lime then topped with prosecco and soda.',
						price: '£9',
						allergens: ['sulphites']
					},
					{
						name: 'Aperol Spritz',
						desc: 'The classic combination of Aperol, prosecco and soda. Served with a slice of fresh orange.',
						price: '£9.50',
						allergens: ['sulphites']
					},
					{
						name: 'Cosmopolitan',
						desc: 'The sweet and sour classic. Absolut Citron shaken with triple sec, cranberry, gomme and fresh lime.',
						price: '£9',
						allergens: ['sulphites']
					},
					{
						name: 'Gooseberry Garden',
						desc: 'Grey Goose, St Germain elderflower liqueur, and ginger ale with fresh berries and cucumber. Light, crisp, and floral - perfect for any occasion.',
						price: '£11',
						allergens: ['sulphites']
					},
					{
						name: 'Raspberry Limoncello Spritz',
						desc: 'A fruity, refreshing spritz with Bombay Sapphire, limoncello, raspberry, and fresh lemon, topped with prosecco and soda.',
						price: '£9.50',
						allergens: ['sulphites']
					},
					{
						name: 'Espresso Martini',
						desc: 'Eristoff vodka, Kahlua and sugar syrup shaken with freshly pulled espresso. Add a choice of flavours (+60p); vanilla, hazlenut, caramel.',
						price: '£9',
						allergens: ['dairy', 'sulphites']
					},
					{
						name: 'Amaretto Sour',
						desc: 'Amaretto sour combines Disaronno amaretto with lemon juice, Angostura bitters, gomme and vegan foamer.',
						price: '£9',
						allergens: ['nuts', 'sulphites']
					}
				]
			},
			{
				title: 'Mocktails',
				items: [
					{
						name: 'Strawberry Watermelon Cooler',
						desc: 'Strawberry puree, lime, cranberry juice and watermelon. Topped with lemonade.',
						price: '£5.50',
						tags: ['vg']
					},
					{
						name: 'Virgin Mojito',
						desc: 'Mint, lime, sugar, apple juice and soda stirred through crushed ice. Add a fruity twist with a choice of our homemade fruit purees; strawberry, raspberry, mango, blueberry, mixed berries, passion fruit.',
						price: '£5.50',
						tags: ['vg']
					},
					{
						name: 'Geisha Iced Tea',
						desc: 'Watermelon, passion fruit, raspberry, strawberry, peach, blueberry, mango.',
						price: '£5.50',
						tags: ['vg']
					}
				]
			},
			{
				title: 'White Wine',
				note: 'Per 125ml / 175ml / bottle.',
				items: [
					{ name: 'Geisha House Wine', price: '£5.50 / £7 / £23.95', allergens: ['sulphites'] },
					{
						name: 'Pinot Grigio 11%',
						desc: 'Primi Soli – Italy. Dry, crisp and fruity with a wonderful hint of lemon.',
						price: '£6.25 / £7.25 / £28.95',
						allergens: ['sulphites']
					},
					{
						name: 'Sauvignon Blanc 12.5%',
						desc: 'Luna Azul – Chile. A burst of passion fruit and guava from this delightful Sauvignon Blanc. A simple lifted floral finish that is clean on the palate.',
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
						name: 'Sauvignon Blanc 12.5%',
						desc: 'Waddling Duck – New Zealand. Youthful and very approachable with a nose of intense, fresh gooseberry fruit. The palate is dry and full of white peach and passion fruit flavour.',
						price: '£7 / £9.50 / £33.50',
						allergens: ['sulphites']
					}
				]
			},
			{
				title: 'Red Wine',
				note: 'Per 125ml / 175ml / bottle.',
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
				title: 'Rose Wine',
				note: 'Per 125ml / 175ml / bottle.',
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
						price: '£29.95',
						allergens: ['sulphites']
					}
				]
			},
			{
				title: 'Sparkling',
				note: 'Per 125ml / bottle.',
				items: [
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
					}
				]
			},
			{
				title: 'Champagne',
				note: 'Per bottle.',
				items: [
					{
						name: 'Taittinger 12%',
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
					{ name: 'Malfy Blood Orange', price: '£4.50 / £6.75' },
					{ name: 'Malfy Rosa', price: '£4.50 / £6.75' },
					{ name: 'Beefeater Pink', price: '£4.50 / £6.75' },
					{ name: 'Hendricks', price: '£4.75 / £7' },
					{ name: 'Slingsby Rhubarb', price: '£4.75 / £7' },
					{ name: 'Whitley Neil Rhubarb & Ginger 0%', price: '£3.50 / £5.50' }
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
				title: 'Rum',
				note: 'Per single / double.',
				items: [
					{ name: 'Bacardi White Rum', price: '£4.25 / £6.25' },
					{ name: 'Bacardi Spiced', price: '£4.25 / £6.25' },
					{ name: 'Bacardi Coconut', price: '£4.25 / £6.25' },
					{ name: 'Bacardi Caribbean Spiced', price: '£4.50 / £6.75' }
				]
			},
			{
				title: 'Whisky',
				note: 'Per single / double.',
				items: [
					{ name: 'Maker’s Mark', price: '£4.50 / £6.75' },
					{ name: 'Jack Daniels', price: '£4.50 / £6.75' },
					{ name: 'Jack Daniels Honey', price: '£4.50 / £6.75' },
					{ name: 'Teeling', price: '£6 / £9' }
				]
			},
			{
				title: 'Tequila',
				note: 'Per single / double.',
				items: [
					{ name: 'Cazcadores Blanco', price: '£4.50 / £6.75' },
					{ name: 'Patron Silver', price: '£5.50 / £8.75' },
					{ name: 'Patron Reposado', price: '£6.50 / £9.75' },
					{ name: 'Patron Anejo', price: '£6.50 / £9.75' },
					{ name: 'Patron XO Cafe', price: '£5.75 / £9.25' },
					{ name: 'Tequila Rose', price: '£4.25 / £6.25' }
				]
			},
			{
				title: 'Liqueurs',
				note: 'Per single / double.',
				items: [
					{ name: 'Kahlua', price: '£3.50 / £5' },
					{ name: 'Sambuca', price: '£3.50 / £5' },
					{ name: 'Limoncello', price: '£3.50 / £5' },
					{ name: 'Disaronno Amaretto', price: '£3.50 / £5' },
					{ name: 'St Germain', price: '£3.50 / £5' },
					{ name: 'Aperol', price: '£3.50 / £5' },
					{ name: 'Baileys (50ml)', price: '£4' },
					{ name: 'Martini Bianco (50ml)', price: '£4' },
					{ name: 'Martini Extra Dry (50ml)', price: '£4' },
					{ name: 'Martini Rosso (50ml)', price: '£4' }
				]
			},
			{
				title: 'Brandy / Cognac',
				note: 'Per single / double.',
				items: [
					{ name: 'Hennessy VS Cognac', price: '£5.25 / £8.25' },
					{ name: 'Vecchia Romagna', price: '£4.50 / £7.25' }
				]
			},
			{
				title: 'Draught Beer',
				note: 'Per half / pint.',
				items: [
					{
						name: 'Peroni - 5%',
						desc: 'Italian lager, crisp and refreshing with a subtle citrus aroma.',
						price: '£3.50 / £6.70',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Meantime IPA - 4.7%',
						desc: 'Anytime American IPA, tropical refreshment from the heart of London.',
						price: '£3.50 / £6.70',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Lucky Buddha - 4.8%',
						desc: 'A true Asian style lager with lots of flavour and a crisp, clean finish.',
						price: '£3.50 / £6.70',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Geisha Cider - 4.5%',
						desc: 'Refreshingly different, expertly crafted. Add a flavour to your cider, choose from watermelon, raspberry, passion fruit, strawberry, peach, mango, blueberry.',
						price: '£3.20 / £5.75',
						allergens: ['sulphites']
					},
					{
						name: 'Geisha Export Lager - 4%',
						desc: 'Light, crisp and refreshing with punchy notes of citrus peel and light pine.',
						price: '£3.20 / £5.75',
						allergens: ['gluten', 'sulphites']
					}
				]
			},
			{
				title: 'Bottled Beer',
				items: [
					{
						name: 'Madri Excepcional - 4.6% [330ml]',
						desc: 'Madri has all the taste characteristics of a Modern European Lager, full of flavour & aroma at 4.6% ABV with a light golden colour. Crisp, clean & refreshing, Madrí Excepcional has a smooth, well-rounded taste profile with a short, bitter finish.',
						price: '£4.50',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Birra Moretti L’Autentica - 4.6% [330ml]',
						desc: 'An authentically Italian lager, well balanced with some hoppy and fruity notes.',
						price: '£4.75',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Blue Moon- 5.4% [330ml]',
						desc: 'Belgian style wheat beer, brewed with orange peel and coriander for a subtle sweetness.',
						price: '£5.50',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Peroni Gluten Free - 5% [330ml]',
						desc: 'Peroni’s Italian brew masters have perfected a new gluten-free recipe for Italy most iconic beer without compromising on taste.',
						price: '£5',
						tags: ['gf'],
						allergens: ['sulphites']
					},
					{
						name: 'Desperados - 5.9% [330ml]',
						desc: 'A distinctive combination of full bodied lager with a boost of Tequila flavour. A light and refreshing taste profile balanced with spicy and lemony notes for sweetness.',
						price: '£5.25',
						allergens: ['gluten', 'sulphites']
					},
					{
						name: 'Rekorderlig - 3.4% [500ml]',
						desc: 'Made in Sweden with pure spring water, our beautifully refreshing cider embodies the spirit of Sweden: a modern, forward thinking nation with innovation and balance at its core - ask server for current flavours.',
						price: '£6',
						allergens: ['sulphites']
					},
					{
						name: 'Peroni - 0.0% [330ml]',
						desc: 'The same uplifting taste that’s full of life, crisp and refreshing zero alcohol Italian lager.',
						price: '£4.25',
						allergens: ['gluten', 'sulphites']
					}
				]
			},
			{
				title: 'Soft Drinks',
				items: [
					{
						name: 'Pepsi/Pepsi Max/Lemonade',
						desc: 'Dash / reg / pint.',
						price: '£1.20 / £3.25 / £4'
					},
					{ name: 'Bottled Coke/Diet (200ml)', price: '£3' },
					{ name: 'Bottled Fanta [330ml]', price: '£3.50' },
					{
						name: 'Fruit Juices',
						desc: 'Orange, apple, pineapple, cranberry. Dash / reg / pint.',
						price: '£1.20 / £3.25 / £4'
					},
					{ name: 'J2O', desc: 'Ask server for flavour.', price: '£4' },
					{
						name: 'Fevertree Mixer (200ml)',
						desc: 'Tonic, light tonic, ginger ale, ginger beer.',
						price: '£2.75'
					},
					{ name: 'San Pellegrino Blood Orange', price: '£3.50' },
					{ name: 'San Pellegrino Lemon', price: '£3.50' },
					{ name: 'Belu Bottled Water (750ml)', price: '£4' },
					{
						name: 'Geisha Iced Coffee',
						desc: 'Served on ice, with a shot of espresso, milk and sugar.',
						price: '£4.50',
						allergens: ['dairy']
					}
				]
			},
			{
				title: 'Hot Drinks',
				note: 'Decaf available.',
				items: [
					{ name: 'Single Espresso', price: '£2.50' },
					{ name: 'Double Espresso', price: '£3.50' },
					{ name: 'Americano', price: '£3.50' },
					{ name: 'Latte', price: '£3.75', allergens: ['dairy'] },
					{ name: 'Cappuccino', price: '£3.75', allergens: ['dairy'] },
					{ name: 'Flat White', price: '£3.75', allergens: ['dairy'] },
					{ name: 'Macchiato', price: '£3.75', allergens: ['dairy'] },
					{
						name: 'Irish Coffee',
						desc: 'Kahlua, Baileys, Hennessy, Makers Mark, Teeling Whisky.',
						price: '£7',
						allergens: ['dairy', 'sulphites']
					},
					{ name: 'English Breakfast Tea', price: '£3' },
					{
						name: 'Herbal Teas - Teapigs',
						desc: 'Jasmine, Earl Grey, peppermint and green tea.',
						price: '£4'
					},
					{ name: 'Hot Chocolate', price: '£3.50', allergens: ['dairy', 'soy'] },
					{
						name: 'Luxury Hot Chocolate',
						desc: 'With cream and marshmallows.',
						price: '£4.50',
						allergens: ['dairy', 'soy']
					},
					{
						name: 'Syrups',
						desc: 'Vanilla, caramel, hazelnut, chocolate and oat milk available on request.',
						price: '£0.50'
					}
				]
			}
		]
	},
	{
		slug: 'allergens',
		title: 'Allergens & Dietary',
		subtitle: 'Full allergen matrix — download the PDF',
		pdf: '/geisha_fusion_allergy_menu_feb26_web.pdf',
		sections: [
			{
				title: 'About our allergen information',
				note: 'This guide lists what allergenic ingredients are contained in each of our dishes. The guide also shows whether or not each dish is suitable for vegetarian or vegan customers. We work closely with our suppliers and chefs to ensure that our information is correct. Therefore we ask that you inform your waiter before ordering if you have any specific dietary requirements. Our recipe information is frequently updated so please check each time you visit to ensure you have the most up to date information on our dishes.',
				items: []
			},
			{
				title: 'What we cannot guarantee',
				note: 'Whilst we take every care with your meal we cannot guarantee a 100% allergen free environment nor can we guarantee against the processes used by our suppliers or products as our dishes are prepared in areas where other allergens are present. All food is prepared in kitchens where nuts, gluten and other allergens could be present. We cannot include all ingredients in our menu descriptions, so we have produced the table above to help you identify the allergens present in each dish. If you have a food allergy please let us know before ordering.',
				items: []
			}
		]
	}
];

export const FUSION_MENU_INDEX = FUSION_MENUS.map((m) => ({ slug: m.slug, title: m.title }));
