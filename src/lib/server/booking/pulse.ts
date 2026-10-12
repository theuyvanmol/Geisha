// PULSE — the server half of cross-device live sync.
//
// The browser's realtime store (src/lib/admin/realtime.svelte.ts) can't subscribe to
// geisha_bookings / geisha_floor_state / geisha_tables: they're superuser-only, and
// PocketBase authorises realtime at DELIVERY time against the List rule, so an anonymous
// browser client is subscribed to silence (the subscribe() handshake still succeeds —
// which is why this looked "live" for so long while delivering nothing).
//
// So instead of loosening those rules and streaming guest PII to the public internet, the
// server rings a DOORBELL: geisha_pulse (migration 1783886500) holds one row per
// restaurant carrying nothing but a counter, a timestamp and the tab that caused the
// change. It's public-read, so the anonymous browser client IS delivered its events; on
// each one the client re-pulls the authoritative board through the staff-gated SvelteKit
// loader — exactly the "we do NOT trust the record body, treat every event as a bare
// 'something changed' signal" contract the store already documents.
//
// This module is wired into the PocketBase client itself (src/lib/server/db/pb.ts,
// `afterSend`), NOT into the individual mutation helpers — so it is impossible to forget.
// It fires for every write to the watched collections whatever the source: the diary, the
// floor plan, an online guest booking, the AI assistant, the Stripe webhook, a cron sweep.
//
// Contract:
//   • Best-effort. A pulse failure NEVER surfaces — the mutation has already committed,
//     and a missed pulse degrades to the store's 60s heartbeat, not to data loss.
//   • Off the critical path. The bump runs through deferWork (waitUntil), so it adds ZERO
//     latency to the mutation's response — which matters on the Vercel→London hop.
//   • Coalesced. A batch commit writing 10 rows must not ring the bell 10 times; writes
//     arriving within COALESCE_MS of the first are collapsed into one bump.
//   • Attributed only when certain. See `inflight` below — a mis-attributed pulse is a
//     change the wrongly-credited device silently never sees.

import { pb } from '../db/pb.js';
import { deferWork } from '../util/defer.js';
import { currentActor } from '../util/actor.js';

/** Collections whose writes mean "the service board changed". */
const WATCHED = new Set(['geisha_bookings', 'geisha_floor_state', 'geisha_tables']);

/** Matches a record write: /api/collections/<name>/records[/<id>]. */
const RECORDS_RE = /\/api\/collections\/([^/?]+)\/records(?:\/([^/?]+))?/;
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Window over which writes collapse into a single bump. Long enough to swallow a batch
 *  commit's serial row-writes, short enough to stay well inside the ~1s live-sync target
 *  (the actor never waits on it — it's deferred). */
const COALESCE_MS = 200;

/** restaurantId -> the bump already on its way, and every tab folded into it. Presence means
 *  writes landing in the same burst don't schedule their own. Cleared BEFORE the write runs,
 *  so a change arriving mid-bump still gets its own event.
 *
 *  `actors` is the crux of the coalescing: a bump is only ATTRIBUTED to a tab when that tab
 *  is the sole author of everything folded into it. If two devices write inside the same
 *  window, the pulse goes out unattributed ('') so BOTH re-pull — attributing it to one of
 *  them would make the other's board silently miss the change, which is the very bug this
 *  whole mechanism exists to fix. */
const inflight = new Map<string, { actors: Set<string>; run: Promise<void> }>();

/** `${collection}:${recordId}` -> restaurantId, for every watched row we've been able to
 *  scope. Two jobs:
 *    • geisha_floor_state rows carry no `restaurant` (only `booking` and `table`), so a
 *      seat/clear is scoped through its table.
 *    • a DELETE returns no body at all, so the only way to scope one is to remember the row
 *      from when we last saw it written.
 *  Bounded by the number of tables/bookings actually touched in a process's lifetime. */
const recordRestaurant = new Map<string, string>();

/** All restaurant ids, for a write we genuinely cannot scope. Cached — there are two. */
let allRestaurants: string[] | null = null;

/** The table→restaurant map, loaded once on the first floor_state write we can't already
 *  scope. Without this the cache would only ever warm from geisha_tables WRITES — which
 *  essentially never happen during service — so every seat and clear would fall back to
 *  ringing both brands and churn the other brand's boards all night. */
let tablesLoaded: Promise<void> | null = null;

/** Log a pulse failure at most once per process, so a missing collection (migration not yet
 *  applied) can't spam the function logs on every mutation. */
let warned = false;
function warnOnce(err: unknown): void {
	if (warned) return;
	warned = true;
	console.error('[pulse] bump failed — live sync will fall back to the heartbeat:', err);
}

/**
 * The PocketBase client's `afterSend` hook (src/lib/server/db/pb.ts) hands every response
 * here. We ring the doorbell for successful writes to a watched collection and ignore
 * everything else (reads, failures, other collections — including geisha_pulse itself,
 * which is what stops the bump from ringing itself in a loop).
 *
 * Never throws: a doorbell must never break the door. The mutation has already committed
 * by the time we see it.
 */
export function notifyResponse(
	url: string,
	method: string | undefined,
	ok: boolean,
	data: unknown
): void {
	try {
		if (!ok) return;
		if (!WRITE_METHODS.has((method ?? 'GET').toUpperCase())) return;
		const m = RECORDS_RE.exec(url);
		if (!m) return;
		// A DELETE returns 204 with no body — its id is only in the URL.
		const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
		const id = record ? str(record.id) : decodeURIComponent(m[2] ?? '');
		notifyWrite(decodeURIComponent(m[1]), record, id);
	} catch (err) {
		warnOnce(err);
	}
}

/**
 * A watched collection was written. `record` is the response body (absent on DELETE);
 * `recordId` is the row's id, which we have even for a DELETE.
 *
 * Never throws, never awaits: it schedules and returns.
 */
export function notifyWrite(
	collection: string,
	record: Record<string, unknown> | null,
	recordId = ''
): void {
	if (!WATCHED.has(collection)) return;
	// Read the acting tab NOW, synchronously, while we're still inside the request's async
	// context (see util/actor.ts).
	const actor = currentActor();
	try {
		const known = scopeFromRecord(collection, record, recordId);
		if (known) {
			schedule(known, actor);
			return;
		}
		// Couldn't scope it from what's in hand — a floor_state row for a table we haven't
		// seen, or a DELETE of a row we don't remember. Resolve asynchronously, and only if
		// that also fails ring every restaurant (correct, but it costs the other brand's
		// boards a redundant re-pull, so it's the last resort).
		const run = (async () => {
			const id = (await scopeAsync(collection, record, recordId)) || '';
			if (id) schedule(id, actor);
			else for (const r of await restaurantIds()) schedule(r, actor);
		})().catch(warnOnce);
		deferWork(() => run);
	} catch (err) {
		warnOnce(err);
	}
}

/** Scope a write from the record in hand (and remember it, so a later DELETE of the same row
 *  is still scopeable). Returns '' when it can't be known without a lookup. */
function scopeFromRecord(
	collection: string,
	record: Record<string, unknown> | null,
	recordId: string
): string {
	if (!record) {
		// DELETE — all we have is the id. Did we see this row written earlier?
		return (recordId && recordRestaurant.get(`${collection}:${recordId}`)) || '';
	}

	let restaurant = '';
	if (collection === 'geisha_bookings' || collection === 'geisha_tables') {
		restaurant = str(record.restaurant);
	} else if (collection === 'geisha_floor_state') {
		const table = str(record.table);
		restaurant = (table && recordRestaurant.get(`geisha_tables:${table}`)) || '';
	}

	const id = str(record.id) || recordId;
	if (restaurant && id) recordRestaurant.set(`${collection}:${id}`, restaurant);
	return restaurant;
}

/** Second attempt, allowing a lookup: load the table→restaurant map once, then re-scope. */
async function scopeAsync(
	collection: string,
	record: Record<string, unknown> | null,
	recordId: string
): Promise<string> {
	if (collection !== 'geisha_floor_state' || !record) return '';
	await loadTables();
	return scopeFromRecord(collection, record, recordId);
}

/** Load every table's restaurant, once per process. Tables change rarely, and any that DO
 *  change re-warm their own entry from the write we see. */
function loadTables(): Promise<void> {
	if (!tablesLoaded) {
		tablesLoaded = (async () => {
			const c = await pb();
			const rows = await c
				.collection('geisha_tables')
				.getFullList<{ id: string; restaurant: string }>({ fields: 'id,restaurant' });
			for (const t of rows) {
				if (t.id && t.restaurant) recordRestaurant.set(`geisha_tables:${t.id}`, t.restaurant);
			}
		})().catch((err) => {
			tablesLoaded = null; // let a later write retry
			warnOnce(err);
		});
	}
	return tablesLoaded;
}

/** Schedule a coalesced bump for one restaurant, crediting the tab behind this write. */
function schedule(restaurantId: string, actor: string): void {
	const pending = inflight.get(restaurantId);
	if (pending) {
		pending.actors.add(actor); // fold in — a second author makes the bump unattributed
		return;
	}

	const actors = new Set<string>([actor]);
	const run = (async () => {
		// Let the rest of this request's writes land, so a batch commit rings once.
		await sleep(COALESCE_MS);
		// Release the slot BEFORE writing: a change arriving from here on is NOT covered by
		// this bump and must be free to schedule its own.
		inflight.delete(restaurantId);
		// Attribute only when a single tab authored everything in this window.
		const sole = actors.size === 1 ? [...actors][0] : '';
		await bump(restaurantId, sole);
	})().catch(warnOnce);

	inflight.set(restaurantId, { actors, run });
	// waitUntil: keep the serverless invocation alive until the bump settles, without
	// blocking the response. Outside a request context deferWork just runs it un-awaited.
	deferWork(() => run);
}

/** The actual write: increment the restaurant's pulse row. `rev` is what guarantees the row
 *  genuinely CHANGES on every bump — PocketBase emits no realtime event for a no-op save.
 *  `actor` is the sole tab behind this bump, or '' when it can't be pinned on one (several
 *  tabs, or a write with no client id — a cron sweep, the Stripe webhook). Every board that
 *  isn't `actor` re-pulls. */
async function bump(restaurantId: string, actor: string): Promise<void> {
	try {
		const c = await pb();
		const at = new Date().toISOString();
		try {
			const row = await c
				.collection('geisha_pulse')
				.getFirstListItem<{ id: string; rev?: number }>(`restaurant="${restaurantId}"`);
			await c.collection('geisha_pulse').update(row.id, { rev: (row.rev ?? 0) + 1, at, actor });
		} catch {
			// No row yet (a restaurant added after the collection was created) — create it. A
			// race between two instances is harmless: the unique index makes the loser throw,
			// and the winner's write is the event everyone wanted anyway.
			await c.collection('geisha_pulse').create({ restaurant: restaurantId, rev: 1, at, actor });
		}
	} catch (err) {
		warnOnce(err);
	}
}

async function restaurantIds(): Promise<string[]> {
	if (allRestaurants) return allRestaurants;
	const c = await pb();
	const rows = await c.collection('geisha_restaurants').getFullList<{ id: string }>();
	allRestaurants = rows.map((r) => r.id);
	return allRestaurants;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
