// Client-side diary day cache + prefetch (owner: "changing days has UI latency").
//
// THE PROBLEM. A day step was a plain SvelteKit navigation: the board froze on the
// old day until the page loader's cross-region PocketBase round-trips came back
// (~15 reads against the London droplet). Nothing on screen acknowledged the click
// until the whole payload landed, so stepping through a week felt like wading.
//
// THE FIX, in the same optimistic shape the rest of this admin uses: keep the last
// few days in memory, PAINT the target day immediately, and let the navigation land
// underneath as the correcting truth. The neighbouring days are warmed in the
// background through /api/admin/diary-day, which runs the SAME server assembly the
// page loader runs (loadDiaryDay) — so a cached paint can never structurally
// disagree with the truth that follows it.
//
// Staleness is bounded by design: the real navigation is ALWAYS still issued, so a
// cached day is at most one round-trip old on screen and self-corrects. Anything
// that changes bookings (a mutation, a realtime ping) drops the cache outright — see
// dropDays() — because we can't know which day a change touched.
//
// PURE client module: no Svelte runes, no DOM. The page owns the reactive state.

// TYPE-ONLY import of the server assembly's return shape (erased at build, exactly
// like diaryProjection.ts's DiaryTimeline import): the cache holds precisely what
// the loader produces, so the page reads a cached day and a freshly loaded one
// through the same type.
import type { DiaryDayPayload } from '$lib/server/service/diaryDay';
import {
	persistDay,
	loadPersistedDays,
	forgetPersistedDay,
	clearPersistedDays
} from './dayStore.js';

/** The day-scoped slice of the diary page's data — loadDiaryDay's return, verbatim. */
export type DiaryDay = DiaryDayPayload;

/** How long a cached day may be painted before we stop trusting it enough to show.
 *  Beyond this we fall back to the skeleton — the navigation is in flight either
 *  way, so this only decides "stale bars" vs "empty grid" for one round-trip. */
export const FRESH_MS = 90_000;

/** Days kept in memory. A week of stepping either way, and no more — each payload
 *  carries a full day's bookings. */
const MAX_DAYS = 14;

type Entry = { at: number; day: DiaryDay };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<DiaryDay | null>>();

/** brand + date + floor identify a view: the same date on another floor is a
 *  different board (the timeline is built per floor). */
export function dayKey(brand: string, date: string, floor?: string): string {
	return `${brand}|${date}|${floor ?? ''}`;
}

function remember(key: string, day: DiaryDay) {
	// Re-insert so the Map's insertion order doubles as an LRU queue.
	cache.delete(key);
	const at = Date.now();
	cache.set(key, { at, day });
	// Mirror to IndexedDB so the board survives a refresh, a crashed tab, or a till
	// being re-opened while the line is down (dayStore.ts). Write-behind and
	// best-effort: never awaited, never able to fail this function.
	persistDay(key, at, day);
	while (cache.size > MAX_DAYS) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
		forgetPersistedDay(oldest);
	}
}

/** Store a day we already have (the page does this for every loader payload that
 *  lands, so the day you just came from is instant to step back to). */
export function putDay(brand: string, date: string, floor: string | undefined, day: DiaryDay) {
	remember(dayKey(brand, date, floor), day);
}

/** A cached day if we hold one that's fresh enough to paint, else null. */
export function getDay(
	brand: string,
	date: string,
	floor?: string,
	maxAge = FRESH_MS
): DiaryDay | null {
	const hit = cache.get(dayKey(brand, date, floor));
	if (!hit) return null;
	if (Date.now() - hit.at > maxAge) return null;
	return hit.day;
}

/** Fetch a day into the cache. Concurrent calls for the same day share one request,
 *  so a hover-warm and a click-warm never double up. Never throws — a failed warm
 *  just leaves the cache empty and the navigation does the work. */
export async function fetchDay(
	brand: string,
	date: string,
	floor?: string
): Promise<DiaryDay | null> {
	const key = dayKey(brand, date, floor);
	const pending = inflight.get(key);
	if (pending) return pending;

	const p = (async () => {
		try {
			const qs = new URLSearchParams({ brand, date });
			if (floor) qs.set('floor', floor);
			const res = await fetch(`/api/admin/diary-day?${qs.toString()}`);
			if (!res.ok) return null;
			const day = (await res.json()) as DiaryDay;
			remember(key, day);
			return day;
		} catch {
			return null; // offline / aborted — the real navigation still runs
		} finally {
			inflight.delete(key);
		}
	})();
	inflight.set(key, p);
	return p;
}

/** Warm a day in the background unless we already hold it fresh. Fire-and-forget. */
export function warmDay(brand: string, date: string, floor?: string) {
	if (getDay(brand, date, floor)) return;
	if (inflight.has(dayKey(brand, date, floor))) return;
	void fetchDay(brand, date, floor);
}

/** Drop everything. Called on any booking change (local mutation or a realtime ping
 *  from another device): a change can land on ANY day, and a wrong bar on screen is
 *  worse than a day that takes its round-trip.
 *
 *  The PERSISTED copy is deliberately left alone. Its job is different: it is the
 *  last-known-good board for a device that has lost the network, and in that state
 *  a slightly stale board is the only board there is. Dropping it here would mean a
 *  mutation immediately before an outage wiped the very thing the offline run-sheet
 *  exists to show. It is superseded the moment a fresh payload lands, and it carries
 *  its own timestamp so the offline view can say honestly how old it is. */
export function dropDays() {
	cache.clear();
}

/**
 * Re-populate the in-memory cache from IndexedDB. Call once, early, on the client.
 *
 * The read path stays synchronous (`getDay`) because the diary needs an answer
 * during a click handler, so hydration is a one-off catch-up rather than something
 * `getDay` awaits: until it resolves, the cache simply behaves as it always did
 * (a miss, and the navigation does the work). It never overwrites a day already in
 * memory — anything loaded this session is by definition fresher than disk.
 */
export async function hydrateDays(): Promise<number> {
	const rows = await loadPersistedDays<DiaryDay>();
	let added = 0;
	for (const row of rows) {
		if (cache.has(row.key)) continue;
		cache.set(row.key, { at: row.at, day: row.day });
		added++;
	}
	// Honour the LRU bound after a bulk insert; oldest-first, by insertion order.
	while (cache.size > MAX_DAYS) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
	return added;
}

/** Everything we hold, freshest first, with the age of each. Powers the offline
 *  run-sheet, which must show WHEN each board was last true rather than implying
 *  it is live. */
export function cachedDays(): Array<{ key: string; at: number; day: DiaryDay }> {
	return [...cache.entries()]
		.map(([key, e]) => ({ key, at: e.at, day: e.day }))
		.sort((a, b) => b.at - a.at);
}

/** Wipe both tiers. Called on sign-out: a cached board is guest personal data and
 *  must not outlive the session that was entitled to it. */
export async function forgetAllDays(): Promise<void> {
	cache.clear();
	await clearPersistedDays();
}

/** ±1 day around a date, as 'YYYY-MM-DD' (UTC arithmetic on the calendar parts, so
 *  it never drifts across a timezone). */
export function neighbours(date: string): string[] {
	const [y, m, d] = date.split('-').map(Number);
	if (!y || !m || !d) return [];
	const base = Date.UTC(y, m - 1, d);
	return [base - 86_400_000, base + 86_400_000].map((ms) =>
		new Date(ms).toISOString().slice(0, 10)
	);
}

/**
 * A same-shaped, EMPTY day for `date`, built from the day currently on screen: the
 * room's sections/rows/axis are kept (they're the same tables tomorrow) and every
 * booking is dropped. This is what paints when we have no cached day — an honest
 * empty grid for the day you asked for, which fills in when the load lands, instead
 * of the previous day's bookings sitting under the new date.
 */
export function skeletonDay(prev: DiaryDay, date: string): DiaryDay {
	const t = prev.timeline;
	// Shift the axis window by whole days so the live "now" cursor lands correctly:
	// stepping away from today pushes now outside the window (no cursor, right), and
	// stepping onto today brings it back. Whole-day arithmetic can be an hour out
	// across a DST boundary — for the fraction of a second a skeleton is on screen,
	// and only for the cursor, that's immaterial.
	const dayMs = (a: string, b: string) => {
		const [ay, am, ad] = a.split('-').map(Number);
		const [by, bm, bd] = b.split('-').map(Number);
		return Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd);
	};
	const shift = t ? dayMs(date, prev.date) : 0;
	return {
		...prev,
		date,
		bookings: [],
		cancellationMeta: {},
		waitlist: [],
		closeouts: [],
		tableCloseouts: [],
		pacing: [],
		// Keep the service periods (the create/close-out forms read them) but never
		// carry a closed-day banner across — a false "CLOSED" is worse than a late one.
		closure: { ...prev.closure, closedFull: false, fullReason: '', active: [] },
		timeline: t
			? {
					...t,
					startMs: t.startMs + shift,
					endMs: t.endMs + shift,
					sections: t.sections.map((s) => ({
						...s,
						rows: s.rows.map((r) => ({ ...r, bars: [] }))
					})),
					slotCovers: t.slotCovers.map(() => 0),
					periodTotals: t.periodTotals.map((p) => ({ ...p, covers: 0, bookings: 0 })),
					coversBreakdown: { ...t.coversBreakdown, rows: [] },
					covers: 0,
					bookingCount: 0
				}
			: null
	};
}
