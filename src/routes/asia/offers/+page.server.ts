import { loadOffers } from '$lib/server/content/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ offers: await loadOffers('asia') });
