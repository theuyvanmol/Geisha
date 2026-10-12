// Asia does NOT host parties or functions (owner, Aug 2026). Private hire happens
// downstairs in Fusion's back room, and only there — advertising it on Asia was
// misleading, so the page is gone.
//
// A REDIRECT, not a deletion. This URL is in the footer of every page we've ever
// shipped, in the top nav's More menu, and by now in Google's index; a 404 would
// strand people who are actively trying to book a function. 301 sends them to the
// brand that can actually take the booking.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	redirect(301, '/fusion/parties');
};
