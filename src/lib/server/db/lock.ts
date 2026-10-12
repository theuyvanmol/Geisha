// Multi-instance advisory lock backed by the geisha_locks collection.
//
// The booking write path needs a mutex so two concurrent requests can't allocate
// the same table (BOOKING_SYSTEM_PLAN.md §4). The original in-process Map mutex
// only serialised requests within ONE Node process — on Vercel/serverless or any
// multi-instance deploy that guarantee evaporates. This replaces it with a
// PocketBase row whose `key` carries a UNIQUE index: only one creator can hold a
// given key at a time. Contenders catch the unique-violation and retry with
// backoff; expired holders (crashed/timed-out) are stolen so a dead instance can
// never wedge the lock forever.
//
// Server-only (lives under src/lib/server). PocketBase has no native advisory
// locks, so this is the portable equivalent for our volume.

import { pb } from './pb.js';

const COLLECTION = 'geisha_locks';

/** A unique-key acquirer id for THIS process+attempt, for the `holder` column. */
function holderId(): string {
	return `${process.pid ?? 0}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True for a PocketBase "value must be unique" create failure (lock is held). */
function isUniqueViolation(err: unknown): boolean {
	const e = err as { status?: number; response?: { data?: Record<string, { code?: string }> } };
	if (e?.status !== 400) return false;
	const data = e.response?.data ?? {};
	// PocketBase reports unique constraint failures as code 'validation_not_unique'
	// on the offending field ('key' here). Match defensively on any field.
	return Object.values(data).some((d) => d?.code === 'validation_not_unique');
}

export interface LockHandle {
	id: string;
	key: string;
	holder: string;
}

/**
 * Try to acquire the advisory lock for `key`, blocking (with backoff) up to
 * `timeoutMs`. The lock auto-expires after `ttlMs` so a crashed holder can't
 * wedge it. Returns a {@link LockHandle} to pass to {@link releaseLock}.
 *
 * @throws if the lock can't be acquired within `timeoutMs`.
 */
export async function acquireLock(
	key: string,
	ttlMs = 10_000,
	timeoutMs = 8_000
): Promise<LockHandle> {
	const c = await pb();
	const holder = holderId();
	const deadline = Date.now() + timeoutMs;
	let attempt = 0;

	for (;;) {
		const expiresAt = new Date(Date.now() + ttlMs).toISOString();

		// 1. Fast path: try to create the row. The UNIQUE index on `key` makes this
		//    the atomic test-and-set — success means we hold the lock.
		try {
			const row = await c.collection(COLLECTION).create<{ id: string }>({
				key,
				holder,
				expires_at: expiresAt
			});
			return { id: row.id, key, holder };
		} catch (err) {
			if (!isUniqueViolation(err)) throw err; // real error — surface it
		}

		// 2. A row already exists. If it's expired, steal it; the held row otherwise.
		try {
			const held = await c
				.collection(COLLECTION)
				.getFirstListItem<{ id: string; expires_at: string }>(
					`key=${JSON.stringify(key)}`
				);
			const expired = !held.expires_at || new Date(held.expires_at).getTime() <= Date.now();
			if (expired) {
				try {
					// Reclaim the dead holder's row in place (keeps the unique key).
					const stolen = await c.collection(COLLECTION).update<{ id: string }>(held.id, {
						holder,
						expires_at: expiresAt
					});
					return { id: stolen.id, key, holder };
				} catch {
					// Lost the steal race to another contender — fall through to retry.
				}
			}
		} catch {
			// The row vanished between the failed create and this read (holder
			// released it). Loop immediately to retry the create.
		}

		if (Date.now() >= deadline) {
			throw new Error(`Could not acquire lock "${key}" within ${timeoutMs}ms (held by another request).`);
		}

		// Exponential-ish backoff with jitter, capped, never overrunning the deadline.
		attempt += 1;
		const base = Math.min(50 * 2 ** Math.min(attempt, 5), 500);
		const wait = Math.min(base + Math.floor(Math.random() * 50), Math.max(0, deadline - Date.now()));
		await sleep(wait);
	}
}

/**
 * Release a previously-acquired lock. Best-effort: only deletes the row if WE
 * still hold it (guards against deleting a row another instance stole after our
 * TTL lapsed). Never throws — releasing must not break the caller's finally.
 */
export async function releaseLock(handle: LockHandle): Promise<void> {
	try {
		const c = await pb();
		const current = await c
			.collection(COLLECTION)
			.getOne<{ holder: string }>(handle.id)
			.catch(() => null);
		// Only delete if it's still ours (or already gone).
		if (!current || current.holder === handle.holder) {
			await c.collection(COLLECTION).delete(handle.id).catch(() => {});
		}
	} catch (err) {
		console.error('[lock] failed to release advisory lock:', err);
	}
}
