import { getLoyaltyProgram } from '$lib/server/booking/loyalty.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Admin-editable programme content, merged over the baked-in defaults. Never
	// throws — falls back to defaults if PocketBase is unreachable.
	const program = await getLoyaltyProgram('asia');
	return { program };
};
