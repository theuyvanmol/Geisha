// Loads the (editable) Asia gallery from PocketBase, falling back to the
// hardcoded GALLERY.asia defaults when no override exists.
import { redirect } from '@sveltejs/kit';
import { getContent } from '$lib/server/content/content';
import { GALLERY } from '$lib/data/gallery';
import { GALLERY_PAGE_LIVE } from '$lib/data/features';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Hidden for now: a temporary redirect, so old links and Google's copy of the
	// URL land on the home page and come back to the gallery when it reopens.
	if (!GALLERY_PAGE_LIVE) redirect(307, '/asia');
	const gallery = await getContent('asia', 'gallery', GALLERY.asia);
	return { gallery };
};
