// Curated gallery images per brand, tagged by category for the filter UI.
// The /gallery page renders these in a masonry grid + lightbox, then appends a
// live Instagram strip. `featured` images can seed home-page / parties strips.
// Real photos from static/Content folder/. Categories are best-effort and easy
// to re-tag during content sign-off.

import type { BrandId } from './brand';

export type GalleryCategory = 'food' | 'interior' | 'cocktails' | 'events';

export type GalleryImage = {
	src: string;
	alt: string;
	category: GalleryCategory;
	featured?: boolean;
	/** Optional display title for the detail overlay (falls back to alt). */
	title?: string;
	/** Optional longer caption shown in the detail overlay. */
	caption?: string;
};

const C = (file: string) => `/Content%20folder/${file}`;

export const GALLERY: Record<BrandId, GalleryImage[]> = {
	asia: [
		{ src: C('1c2895f0-71af-4020-a526-dd8ea7a8631d.jpg'), alt: 'Pan-Asian small plate', title: 'Asian Bites', caption: 'Small plates to share, from across Asia.', category: 'food', featured: true },
		{ src: C('2989fb73-df51-41e5-8437-95af438b31df.jpg'), alt: 'Fresh sushi', title: 'Signature Sushi', caption: 'Maki, nigiri and sashimi, rolled fresh to order.', category: 'food', featured: true },
		{ src: C('IMG_5995.JPG'), alt: 'Ramen bowl', title: 'Ramen', caption: 'Homemade broth, noodles and a shoyu egg.', category: 'food' },
		{ src: C('IMG_6059.JPG'), alt: 'Robata-grilled dish', title: 'From the Robata', caption: 'Flame-grilled skewers and sizzling plates.', category: 'food', featured: true },
		{ src: C('IMG_6148.JPG'), alt: 'Dim sum', title: 'Dim Sum', caption: 'Steamed and fried dumplings, freshly made.', category: 'food' },
		{ src: C('IMG_6155.JPG'), alt: 'Sharing platter', title: 'Sharing Platters', caption: 'A spread built for the whole table.', category: 'food' },
		{ src: C('1e039acf-7c43-43b3-bce4-4714aee9db22.jpg'), alt: 'The dining room', title: 'The Dining Room', caption: 'Our Japanese-garden-inspired room.', category: 'interior', featured: true },
		{ src: C('2ce054af-09a3-4c5a-8834-067be6955f49.jpg'), alt: 'Lanterns in the dining room', title: 'Lanterns', caption: 'Warm lanterns over the tables.', category: 'interior' },
		{ src: C('376511c1-1ce3-4861-a506-0150606fe48b.jpg'), alt: 'Bar detail', title: 'At the Bar', caption: 'Where the cocktails are built.', category: 'cocktails' },
		{ src: C('3e32cd77-0358-4f39-b12a-ca244539a578.jpg'), alt: 'Signature cocktail', title: 'Signature Cocktail', caption: 'House pours, shaken to order.', category: 'cocktails', featured: true },
		{ src: C('4359ee0e-7aeb-4dc7-8168-16cd0e7a197c.jpg'), alt: 'Guests dining', title: 'A Night Out', caption: 'The room in full swing.', category: 'events' },
		{ src: C('4ee12706-626b-4eb9-bb67-7f116c0b3be4.jpg'), alt: 'Private celebration', title: 'Celebrations', caption: 'Gather the table for something special.', category: 'events' }
	],
	fusion: [
		{ src: C('IMG_6394.JPG'), alt: 'Stacked burger and fries', title: 'Burgers', caption: 'Stacked, loaded and served with fries.', category: 'food', featured: true },
		{ src: C('IMG_6463.JPG'), alt: 'Loaded fries', title: 'Loaded Fries', caption: 'Piled high — the table favourite.', category: 'food' },
		{ src: C('IMG_6486.JPG'), alt: 'Fresh stone-baked pizza', title: 'Stone-Baked Pizza', caption: 'Hand-stretched dough, blistered in the oven.', category: 'food', featured: true },
		{ src: C('7230dfe3-03b5-485a-beed-edfa18020d16.jpg'), alt: 'Plated main', title: 'From the Kitchen', caption: 'Big plates, made to order.', category: 'food', featured: true },
		{ src: C('743f6854-320f-4bdb-9eb9-d365e26cf1c8.jpg'), alt: 'Bright dining room', title: 'The Dining Room', caption: 'Room for the whole table in Benton.', category: 'interior', featured: true },
		{ src: C('75c3da96-bbba-426b-bd88-b238640990c8.jpg'), alt: 'Family-friendly seating', title: 'Come As You Are', caption: 'Family-friendly seating, all day.', category: 'interior' },
		{ src: C('7de717e2-64bd-4b68-9744-cb989b2439cf.jpg'), alt: 'Cocktail on the bar', title: 'At the Bar', caption: 'Cocktails built to order.', category: 'cocktails', featured: true },
		{ src: C('80ad9732-2961-4786-bad5-6f78d4783331.jpg'), alt: 'Aperol spritz', title: 'Spritz Hour', caption: 'Bright, cold and easy going.', category: 'cocktails' },
		{ src: C('8425e30f-7329-4269-848a-aef0ec766add.jpg'), alt: 'Friends at the table', title: 'Good Times', caption: 'Full tables and long lunches.', category: 'events', featured: true },
		{ src: C('87b8683d-6ba2-4e6d-9e81-da9b9daa0b23.jpg'), alt: 'Celebration spread', title: 'Celebrations', caption: 'Birthdays, parties and big occasions.', category: 'events' },
		{ src: C('931d21b6-eb62-4627-a460-a7d8da06f50d.jpg'), alt: 'Group dining', title: 'Groups', caption: 'Book the area for the whole crowd.', category: 'events' }
	]
};

export const GALLERY_CATEGORIES: { id: GalleryCategory | 'all'; label: string }[] = [
	{ id: 'all', label: 'All' },
	{ id: 'food', label: 'Food' },
	{ id: 'interior', label: 'Interior' },
	{ id: 'cocktails', label: 'Cocktails' },
	{ id: 'events', label: 'Events' }
];
