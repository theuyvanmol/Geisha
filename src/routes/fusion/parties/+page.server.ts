// Editable copy for the Parties page (admin → Content → Pages), the brand_info
// its {token} placeholders resolve against, and the editable gallery that feeds
// the room strip (which used to read the static GALLERY and ignore edits).
import { getContent } from '$lib/server/content/content';
import { loadPageCopy } from '$lib/server/content/public';
import { GALLERY } from '$lib/data/gallery';
import type { GalleryImage } from '$lib/data/gallery';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [copy, gallery] = await Promise.all([
		loadPageCopy('fusion'),
		getContent<GalleryImage[]>('fusion', 'gallery', GALLERY.fusion)
	]);
	return { ...copy, gallery };
};
