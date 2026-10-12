// Shared menu types. HTML menus render from this data; the PDF stays as a
// downloadable fallback. `tags`/`allergens` power the dietary filter on the
// menu pages (replaces the separate allergen PDF with interactive data).

export type DietTag = 'v' | 'vg' | 'gf' | 'spicy' | 'new';

export const DIET_LABELS: Record<DietTag, string> = {
	v: 'Vegetarian',
	vg: 'Vegan',
	gf: 'Gluten-free',
	spicy: 'Spicy',
	new: 'New'
};

export type MenuItem = {
	name: string;
	jp?: string;
	desc?: string;
	price?: string;
	/** optional dish photo (set in the admin Menus editor) */
	img?: string;
	tags?: DietTag[];
	allergens?: string[];
};

export type MenuSection = {
	title: string;
	note?: string;
	items: MenuItem[];
};

export type Menu = {
	slug: string;
	title: string;
	subtitle?: string;
	/** downloadable PDF in /static, if one exists */
	pdf?: string;
	/** cover photo for this menu's panel on the /menus selector (admin-chosen) */
	img?: string;
	sections: MenuSection[];
};

/**
 * "PDF" or "Image", from the file's own extension.
 *
 * Every menu used to be a PDF, so the download links said "(PDF)" in hardcoded
 * text. Asia's main menu is now a JPEG — the August 2026 reprint is published
 * only as an image, and there is no PDF of it — so a fixed label would have lied
 * on the one menu people open most. Derive it instead.
 */
export const menuFileKind = (url?: string): 'PDF' | 'Image' =>
	url && /\.pdf(\?|#|$)/i.test(url) ? 'PDF' : 'Image';
