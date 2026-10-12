// The gallery's categories — the "which gallery is this picture in?" list.
//
// These are the tabs a guest filters the public gallery by, and (since staff now
// choose one when they upload) the way the whole picture library is organised in
// the admin: the Gallery editor groups by them and the image picker filters by
// them, so placing a photo on the site means browsing "Interior", not scrolling a
// thousand-thumbnail wall of filenames.
//
// Kept in its own module because both server code (the upload endpoint) and
// client code (the picker, the gallery editor) need the list, and the Zod schema
// in $lib/content/schema can't be the source without dragging Zod into both.
// The enum in GalleryImageSchema must stay in step with this list.

export const GALLERY_CATEGORIES = ['food', 'interior', 'cocktails', 'events'] as const;

export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

/** Sentence-case label for the admin UI ('food' reads as a typo in a heading). */
export const CATEGORY_LABELS: Record<GalleryCategory, string> = {
	food: 'Food',
	interior: 'Interior',
	cocktails: 'Cocktails',
	events: 'Events'
};

export const categoryLabel = (c: string): string =>
	CATEGORY_LABELS[c as GalleryCategory] ?? 'Uncategorised';
