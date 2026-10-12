// "Keep it Social" stand-in feed.
//
// The live strip reads /api/instagram, which needs INSTAGRAM_ACCESS_TOKEN (see
// src/routes/api/instagram/+server.ts). Until that token exists the endpoint
// returns no posts, and the section would be a heading over nothing. These five
// stand in: real posts from @geisharestaurants, picked by hand on 11 Oct 2026,
// each linking to the post itself. The moment the live feed returns anything,
// InstagramWall shows that instead and this list is ignored — nothing to switch.
//
// They are the five most recent posts at the time that were not about Restaurant
// Week, which ended on 10 Oct and would have dated the strip from day one. All
// five are reels; `image` is the reel's cover frame, saved to
// static/images/social/<shortcode>.webp because Instagram's own image URLs are
// signed and expire. To refresh by hand: replace the entries and the files.
import type { InstagramPost } from '../../routes/api/instagram/+server';

export const INSTAGRAM_STANDIN: (InstagramPost & { alt: string })[] = [
	{
		id: 'DeO5IH7jqHJ',
		kind: 'video',
		image: '/images/social/DeO5IH7jqHJ.webp',
		href: 'https://www.instagram.com/reel/DeO5IH7jqHJ/',
		alt: 'A stone-baked nduja pizza with red onion and basil, carried to the table'
	},
	{
		id: 'DeJvQv6Fdec',
		kind: 'video',
		image: '/images/social/DeJvQv6Fdec.webp',
		href: 'https://www.instagram.com/reel/DeJvQv6Fdec/',
		alt: 'A plate of rigatoni in tomato sauce from the new Geisha Fusion menu'
	},
	{
		id: 'DeElbCfFcor',
		kind: 'video',
		image: '/images/social/DeElbCfFcor.webp',
		href: 'https://www.instagram.com/reel/DeElbCfFcor/',
		alt: 'A table of dishes from Geisha Fusion’s new menu: paella, duck, a burger and salad'
	},
	{
		id: 'DeCA0HGnThS',
		kind: 'video',
		image: '/images/social/DeCA0HGnThS.webp',
		href: 'https://www.instagram.com/reel/DeCA0HGnThS/',
		alt: 'A guest at the table with two sushi rolls and a grilled dish in front of him'
	},
	{
		id: 'Dd_b-f3FR5l',
		kind: 'video',
		image: '/images/social/Dd_b-f3FR5l.webp',
		href: 'https://www.instagram.com/reel/Dd_b-f3FR5l/',
		alt: 'The words “New menu just dropped” written across a cloudy sky'
	}
];
