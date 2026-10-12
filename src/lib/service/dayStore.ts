// Durable backing store for the diary day cache (dayCache.ts).
//
// WHY
// ───
// dayCache holds the last few days' boards in a Map, which makes stepping between
// days instant — but it dies with the tab. That is exactly the wrong lifetime for
// the case that matters: the restaurant's internet drops mid-service, someone
// refreshes or re-opens the till, and the board comes back completely empty. The
// data the floor needs to run the night — who is coming, at what time, on which
// table, on whose phone number, with which allergy — was in memory a second ago and
// is now gone.
//
// So the same payloads are mirrored into IndexedDB. Nothing else about the cache's
// behaviour changes: memory is still the read path (synchronous, which is what the
// diary's `getDay` needs), and IndexedDB is a write-behind mirror that gets read
// back exactly once, at startup.
//
// WHY IndexedDB AND NOT localStorage
// ──────────────────────────────────
// A day payload is a substantial object (every booking on the board, with its
// tables, guest details and comments). localStorage is synchronous — it blocks the
// main thread on every write, which on the diary would be visible jank — capped
// around 5MB, and stores strings only. IndexedDB is async, roughly two orders of
// magnitude larger, and stores structured clones directly.
//
// PRIVACY
// ───────
// These payloads contain guest personal data, so this is a real decision, not a
// free win: it puts names, emails and phone numbers on the device's disk rather
// than only in volatile memory. It is justified because the device is the
// restaurant's own till, the data is already on its screen all service, and being
// blind to your own book mid-service is a worse outcome. Two mitigations follow
// from that reasoning and are implemented here:
//   • an age cap (MAX_AGE_MS) — the store is a service-time buffer, not an archive.
//   • clearPersistedDays(), called on sign-out, so the data does not outlive the
//     session that was entitled to see it.
//
// PURE module: no Svelte runes, no DOM beyond IndexedDB itself. Every operation is
// best-effort and swallows its errors — a browser in private mode, out of quota, or
// with storage disabled must degrade to today's in-memory-only behaviour, never
// break the diary.

const DB_NAME = 'geisha-service';
const DB_VERSION = 1;
const STORE = 'days';

/** Days older than this are dropped on load and never served. The board is a
 *  service-time aid; a three-day-old cached board is not something anyone should
 *  be shown, and it is guest data we have no reason to keep. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** What we persist: the cache key, the payload, and when it was true. */
export interface PersistedDay<T = unknown> {
	key: string;
	at: number;
	day: T;
}

function available(): boolean {
	try {
		return typeof indexedDB !== 'undefined';
	} catch {
		return false; // some embedded webviews throw on the mere property access
	}
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
	if (!available()) return Promise.resolve(null);
	if (dbPromise) return dbPromise;

	dbPromise = new Promise<IDBDatabase | null>((resolve) => {
		let req: IDBOpenDBRequest;
		try {
			req = indexedDB.open(DB_NAME, DB_VERSION);
		} catch {
			resolve(null);
			return;
		}
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => resolve(null);
		// A blocked upgrade (another tab holding the old version) must not hang the
		// caller forever — the diary would sit there waiting on us.
		req.onblocked = () => resolve(null);
	});
	return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore | null {
	try {
		return db.transaction(STORE, mode).objectStore(STORE);
	} catch {
		return null;
	}
}

/** Mirror one day to disk. Fire-and-forget by contract: callers must not await it,
 *  and a failure is silent. */
export function persistDay<T>(key: string, at: number, day: T): void {
	void (async () => {
		try {
			const db = await open();
			if (!db) return;
			const store = tx(db, 'readwrite');
			store?.put({ key, at, day } satisfies PersistedDay<T>);
		} catch {
			/* storage full, private mode, disabled — the memory cache still works */
		}
	})();
}

/** Read every persisted day that is still young enough to be worth having.
 *  Resolves to [] on any failure, so the caller needs no error path. */
export async function loadPersistedDays<T>(now = Date.now()): Promise<PersistedDay<T>[]> {
	try {
		const db = await open();
		if (!db) return [];
		const store = tx(db, 'readonly');
		if (!store) return [];
		const rows = await new Promise<PersistedDay<T>[]>((resolve) => {
			const req = store.getAll();
			req.onsuccess = () => resolve((req.result ?? []) as PersistedDay<T>[]);
			req.onerror = () => resolve([]);
		});
		const live = rows.filter((r) => r && typeof r.at === 'number' && now - r.at < MAX_AGE_MS);
		// Opportunistically bin what we just decided was too old, so the store
		// doesn't accumulate stale guest data on a till that is rarely closed.
		if (live.length !== rows.length) {
			const write = tx(db, 'readwrite');
			for (const r of rows) if (!live.includes(r)) write?.delete(r.key);
		}
		return live;
	} catch {
		return [];
	}
}

/** Forget everything. Called on sign-out — the cached board is guest data and has
 *  no business outliving the session that was allowed to see it. */
export async function clearPersistedDays(): Promise<void> {
	try {
		const db = await open();
		if (!db) return;
		await new Promise<void>((resolve) => {
			const store = tx(db, 'readwrite');
			if (!store) return resolve();
			const req = store.clear();
			req.onsuccess = () => resolve();
			req.onerror = () => resolve();
		});
	} catch {
		/* nothing we can do, and nothing worth reporting */
	}
}

/** Drop one day (used when the in-memory cache evicts or invalidates it). */
export function forgetPersistedDay(key: string): void {
	void (async () => {
		try {
			const db = await open();
			const store = db ? tx(db, 'readwrite') : null;
			store?.delete(key);
		} catch {
			/* best effort */
		}
	})();
}
