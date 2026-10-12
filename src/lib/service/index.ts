// Shared service-view modules (Floor ↔ Diary parity). Barrel re-export so hosts can
// import from '$lib/service' consistently. Components are imported directly (Svelte
// files aren't re-exported here); this covers the logic + type surface.

export * from './bookingView';
export * from './postAction';
export * from './printSlip';
export * from './closures';
export { createMagicSearch, type MagicSearch, type MagicSearchOptions } from './useMagicSearch.svelte';
// Re-export the already-shared diary primitives under $lib/service too, so floor code
// reads consistently even though these files still live under $lib/diary.
export {
	barColour,
	schemeLegend,
	SCHEMES,
	SCHEME_LABELS,
	type DiaryColourScheme,
	type ColourableBar,
	type BarColour
} from '$lib/diary/colourScheme';
export {
	rankResults,
	looksLikeRef,
	looksLikePhone,
	looksLikeEmail,
	type SearchResult,
	type SearchResultKind
} from '$lib/diary/magicSearch';
