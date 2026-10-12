import { loadReviews } from '$lib/server/content/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ reviews: await loadReviews('fusion') });
