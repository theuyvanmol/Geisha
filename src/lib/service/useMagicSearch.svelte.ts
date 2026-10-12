// Magic universal search hook (Floor ↔ Diary parity).
//
// ResDiary's search box finds customers (name/email/phone) and bookings (ref) from
// one field. The pure ranking + query classification already lives in
// `$lib/diary/magicSearch`; the DB reads are a standalone brand-scoped endpoint at
// `/api/admin/search`. This hook is the small stateful glue both service views need:
// debounce the keystrokes, fetch, rank, and expose the dropdown state — so the floor
// gets the exact same search the diary has without copying the wiring.
//
// Svelte 5 runes module (`.svelte.ts`) so `$state` works; construct it in a component
// with `const search = createMagicSearch({ brand, onPick })`.

import { rankResults, type SearchResult } from '$lib/diary/magicSearch';

export interface MagicSearchOptions {
	/** current brand — re-read via a getter so it tracks a brand switch. */
	brand: () => string;
	/** the host picked a result: navigate / scroll-to-bar / open the customer. */
	onPick: (r: SearchResult) => void;
	/** debounce window in ms (default 180). */
	debounceMs?: number;
}

export interface MagicSearch {
	readonly query: string;
	readonly results: SearchResult[];
	readonly loading: boolean;
	readonly open: boolean;
	/** bind to the input; drives the debounced fetch. */
	setQuery: (q: string) => void;
	/** call from the input's on:input (value already applied) — convenience. */
	onInput: (e: Event) => void;
	pick: (r: SearchResult) => void;
	close: () => void;
	clear: () => void;
}

export function createMagicSearch(opts: MagicSearchOptions): MagicSearch {
	const debounceMs = opts.debounceMs ?? 180;
	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let open = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;
	// Guard against out-of-order responses: only the latest issued query may write.
	let seq = 0;

	async function run(q: string) {
		const trimmed = q.trim();
		if (trimmed.length < 2) {
			results = [];
			open = false;
			loading = false;
			return;
		}
		const mine = ++seq;
		loading = true;
		open = true;
		try {
			const res = await fetch(
				`/api/admin/search?brand=${opts.brand()}&q=${encodeURIComponent(trimmed)}`
			);
			if (mine !== seq) return; // a newer query superseded this one
			if (!res.ok) {
				results = [];
				return;
			}
			// The endpoint returns { hits: DiarySearchHit[] }; each hit lacks a score,
			// so seed it to 0 for rankResults (which adds the query-relevance score).
			const body = (await res.json()) as { hits?: Array<Omit<SearchResult, 'score'>> };
			if (mine !== seq) return;
			const hits = Array.isArray(body.hits) ? body.hits : [];
			results = rankResults(
				trimmed,
				hits.map((h) => ({ ...h, score: 0 }))
			);
		} catch {
			if (mine === seq) results = [];
		} finally {
			if (mine === seq) loading = false;
		}
	}

	function setQuery(q: string) {
		query = q;
		if (timer) clearTimeout(timer);
		if (!q.trim()) {
			results = [];
			open = false;
			loading = false;
			return;
		}
		timer = setTimeout(() => run(q), debounceMs);
	}

	return {
		get query() {
			return query;
		},
		get results() {
			return results;
		},
		get loading() {
			return loading;
		},
		get open() {
			return open;
		},
		setQuery,
		onInput(e: Event) {
			setQuery((e.currentTarget as HTMLInputElement).value);
		},
		pick(r: SearchResult) {
			opts.onPick(r);
			query = '';
			results = [];
			open = false;
		},
		close() {
			open = false;
		},
		clear() {
			query = '';
			results = [];
			open = false;
			loading = false;
			if (timer) clearTimeout(timer);
		}
	};
}
