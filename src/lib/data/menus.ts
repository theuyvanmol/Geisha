// Menu lookup by brand. Keeps route pages free of brand-specific imports.
import type { BrandId } from './brand';
import type { Menu } from './menu-types';
import { ASIA_MENUS } from './menus.asia';
import { FUSION_MENUS } from './menus.fusion';

const BY_BRAND: Record<BrandId, Menu[]> = {
	asia: ASIA_MENUS,
	fusion: FUSION_MENUS
};

export function getMenus(brand: BrandId): Menu[] {
	return BY_BRAND[brand];
}

export function getMenu(brand: BrandId, slug: string): Menu | undefined {
	return BY_BRAND[brand].find((m) => m.slug === slug);
}

export function getMenuIndex(
	brand: BrandId
): { slug: string; title: string; subtitle?: string; pdf?: string; img?: string }[] {
	return BY_BRAND[brand].map((m) => ({
		slug: m.slug,
		title: m.title,
		subtitle: m.subtitle,
		pdf: m.pdf,
		img: m.img
	}));
}
