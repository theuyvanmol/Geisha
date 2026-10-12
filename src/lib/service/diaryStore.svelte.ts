// Diary board store — the SINGLE client-owned owner of the diary board.
//
// ──────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// The old diary kept the board as `tl`, a deep clone of the loader's data.timeline,
// and let THREE systems fight over it: (1) a $effect that rebuilt `tl` from server
// truth on every invalidate('admin:diary'), (2) optimistic mutations that patched `tl`
// in place, and (3) a referee of 7 "reapply*" functions + 6 pin stores that pasted the
// optimistic edits back after each reload. A background reconcile landing mid-edit
// dropped the in-flight edit (it snapped back ~1s later). Every fix was a new referee
// rule, and the rules interacted.
//
// This store collapses the three into ONE owner. Optimistic edits and server reloads
// stop being able to fight because there is a single, explicit rule:
//
//     reconcile() merges server truth field-by-field, but SKIPS any field currently
//     marked dirty by an in-flight local edit.
//
// So a mid-edit reload structurally cannot clobber an edit. That one rule replaces all
// 7 reappliers and all 6 pin stores.
//
// ──────────────────────────────────────────────────────────────────────────
// DESIGN
//
//   • The SERVER stays the positioner. We hold already-positioned DiaryBars (startMin/
//     endMin/arrival/joinGroup all computed in getDiaryTimeline) and only re-bucket them
//     onto rows via diaryProjection. We never re-derive minute offsets / arrival / joins
//     client-side.
//   • bars: SvelteMap<barKey, PositionedBar> — barKey = `${bookingId}@${tableId}` because
//     a multi-table booking is several bars sharing a bookingId. SvelteMap (from
//     svelte/reactivity) tracks mutations that a plain Map in $state does not.
//   • #dirty: Map<bookingId, DirtyEntry> — TYPED, per-field, TTL'd. Three kinds:
//       - 'geometry' (pending-write): move/resize/swap/covers/create/walkin. Settles from
//         the action RESPONSE ({version,startsAt,endsAt,tableIds}); suppresses a delete
//         only until the write resolves.
//       - 'field': status/arrival (seat/clear/noShow/floorStatus/resetArrival/confirm).
//         The response is only {id} and arrival is server-derived, so it settles from the
//         next CONFIRMING reconcile (+ TTL backstop). Only the dirty FIELDS are skipped in
//         the merge, so a concurrent geometry reconcile still flows.
//       - 'tombstone': cancel/moveToWaitlist. Deletion is a dirty STATE, not absence — a
//         stale pull that still contains the booking can't resurrect it.
//
// STEP 0 (current): this store runs as a SHADOW alongside `tl`. The page calls
// reconcile()/mutate() in parallel with its existing logic and a dev-only oracle asserts
// store.rows deep-equals tl. Nothing renders from the store yet. Later steps flip the
// read path, then route each op through mutate(), then delete the old referee.
//
// Convention: rune-class singleton, matching src/lib/admin/realtime.svelte.ts.
// ──────────────────────────────────────────────────────────────────────────

import { SvelteMap } from 'svelte/reactivity';
import type { DiaryTimeline, DiarySection, DiaryBar } from '$lib/server/booking/admin';
import {
	splitScaffold,
	projectRows,
	barKey,
	type Scaffold,
	type PositionedBar
} from './diaryProjection';

/** How long a dirty entry survives without a confirming reconcile before the sweep drops
 *  it — the belt-and-braces so an optimistic edit can never wedge permanently (offline,
 *  dropped socket). Mirrors the old PIN_TTL_MS. */
const DIRTY_TTL_MS = 10_000;

/** Extra grace a gate gets while its write is STILL IN FLIGHT, beyond the TTL. The covers
 *  write measures ~3.2s against the droplet and clicks queue behind each other, so a burst
 *  can easily outlive a 10s TTL started at the first click — and losing the gate mid-write
 *  is what let a pre-write pull repaint the old value. This is the ceiling on that grace:
 *  every write path drains the in-flight count on both outcomes, so it should never be
 *  reached, but a write that neither resolves nor rejects must not wedge a booking
 *  permanently out of server truth. */
const PENDING_CEILING_MS = 50_000;

/** How long after a walk-in is seated we keep its optimistic 'arrived' over an incoming
 *  server 'unarrived' (the deferred floor_state write lags the booking insert). Long
 *  enough to cover a couple of reconcile round-trips against the London droplet; short
 *  enough that a genuine un-seat shows promptly. */
const SEATED_GRACE_MS = 6_000;

/** Which facet of a booking an in-flight local edit owns. `reconcile` skips exactly these
 *  fields when merging server truth over a dirty entity. */
export type DirtyKind = 'geometry' | 'field' | 'tombstone';

/** The bar fields each dirty kind protects from a reconcile overwrite. `partySize` is here
 *  because an oversize drop/swap shrinks the party inside the geometry patch, and the settle
 *  responses (`settleWindow`/`settleTables`) don't carry party — without protection a reconcile
 *  racing the write would flash the pre-shrink covers. */
const GEOMETRY_FIELDS = [
	'startMin',
	'endMin',
	'_tableId',
	'startsAt',
	'endsAt',
	'partySize'
] as const;

type DirtyEntry = {
	kind: DirtyKind;
	/** Field names on the bar that reconcile must NOT overwrite while dirty. */
	fields: Set<string>;
	/** Snapshot of the booking's bars BEFORE the optimistic patch, for revert-on-failure.
	 *  Across a geometry BURST (overlapping ops on one booking) this stays the PRE-BURST
	 *  server truth — never an optimistic intermediate. */
	snapshot: PositionedBar[];
	/** ms epoch after which the sweep force-clears this dirty (TTL backstop). */
	expires: number;
	/** For 'field' (status) dirties: the arrival the optimistic patch intended, so a
	 *  reconcile can decide whether the server pull CONFIRMS the intent before clearing. */
	intendedArrival?: string;
	/** For 'field' dirties whose intent is a plain VALUE rather than an arrival: the bar
	 *  fields the server must come back showing before this dirty may clear (e.g. a covers
	 *  change intends `{ partySize: 6 }`).
	 *
	 *  change intends `{ partySize: 6 }`). A key may be a DOTTED PATH into the bar, so an
	 *  edit that lands on the nested `detail` object can state its intent precisely — a
	 *  comments save intends `{ 'detail.bookingComments': '…' }`.
	 *
	 *  Without this, #pullConfirmsIntent falls back to "clear once the booking is present"
	 *  — and the booking is ALWAYS present, so the dirty cleared on the very next pull
	 *  whether or not the server had taken the edit. The pull then overwrote the optimistic
	 *  value with pre-write truth and the next pull put it back: the covers control visibly
	 *  snapped to the old number and counted back up. */
	intendedFields?: Record<string, unknown>;
	/** Writes still in flight for this booking (value-intent dirties only).
	 *
	 *  Matching `intendedFields` is necessary but NOT sufficient to clear the gate: a burst
	 *  of covers clicks commits SERIALLY (6→7→8→7→6→7…), so the server transiently passes
	 *  THROUGH the intended value while later writes are still queued. A pull landing in
	 *  that window would "confirm" the intent, drop the gate, and let the board then chase
	 *  the server through every intermediate — the covers control visibly bouncing
	 *  8 → 7 → 6 → 7 before settling. The gate holds until the burst has fully drained. */
	pending?: number;
	/** Store-global sequence stamp of the NEWEST op that owns this entry. A completing op
	 *  may settle/restore only while its own stamp still matches (ownership check) — an
	 *  older op's late response must not clobber a newer op's optimistic patch. */
	gen: number;
	/** True once any write in the current burst succeeded. A later failure must then NOT
	 *  restore the pre-burst snapshot (the DB has moved on) — the caller's drained
	 *  reconcile repaints truth instead. */
	succeededAny: boolean;
};

/**
 * The single client-owned diary board. One instance per open diary tab (see the
 * `diaryStore` singleton export).
 */
class DiaryStore {
	/** Positioned bars keyed by `${bookingId}@${tableId}`. The ONLY board truth. */
	readonly bars = new SvelteMap<string, PositionedBar>();
	/** The server's structural scaffold (rows skeleton + axis) — replaced wholesale on
	 *  every reconcile; never conflicts with a local edit. */
	scaffold = $state<Scaffold | null>(null);

	/** Per-booking in-flight local edits. Not reactive state — it gates reconcile, it is
	 *  not rendered. */
	#dirty = new Map<string, DirtyEntry>();

	/** Per-booking write chains: geometry writes on ONE booking run strictly in gesture
	 *  order. The optimistic patch stays synchronous — only the POST queues — so rapid
	 *  drag→drag→resize on one bar can't interleave snapshots/settles (the old "do things
	 *  quickly and the catch-up undoes them" class). Same shape as the page's
	 *  queueStatusWrite / walkinWriteChain. */
	#writeChains = new Map<string, Promise<unknown>>();
	/** temp→real id re-keys recorded by promote(), so an op enqueued under a temp id can
	 *  find its booking (dirty entry, chain, bars) after the create promotes mid-flight. */
	#aliases = new Map<string, string>();
	/** bookingId → ms-epoch: a walk-in shows 'arrived' the instant it's seated, but its
	 *  floor_state write is DEFERRED server-side, so a reconcile pull in the next ~seconds
	 *  reads it back as 'unarrived' (blue) — a race no ordering fix fully closes (the pull
	 *  can be in flight, keyed to the promoted real id, before the create response lands).
	 *  So we time-gate it: markSeated() stamps a booking; reconcile keeps 'arrived' over an
	 *  incoming 'unarrived' within the grace, unless the pull says something terminal
	 *  (left/no_show/seated-elsewhere). Self-heals — a genuine un-seat lands after the grace. */
	#seatedAt = new Map<string, number>();
	/** Store-global monotonic op sequence. Global, not per-entry: a per-entry counter would
	 *  ABA when a burst ends and a new one starts at the same small number. */
	#genSeq = 0;

	/** The nested sections→rows→bars the grid renders — a pure projection of bars onto the
	 *  scaffold. Derived, so it recomputes whenever a bar or the scaffold changes. */
	readonly rows: DiarySection[] = $derived.by(() => {
		if (!this.scaffold) return [];
		return projectRows(this.scaffold, this.bars.values());
	});

	/** True once a timeline has been loaded. */
	get ready(): boolean {
		return this.scaffold !== null;
	}

	// --- reads -----------------------------------------------------------------

	/** All positioned bars for a booking (a multi-table booking has several). Reactive. */
	barsOf(bookingId: string): PositionedBar[] {
		const out: PositionedBar[] = [];
		for (const b of this.bars.values()) if (b.bookingId === bookingId) out.push(b);
		return out;
	}

	/** The first bar of a booking, for a single-entity read (the popover binds to this so
	 *  it always sees the live entity, never a detached snapshot). Reactive. */
	bar(bookingId: string): PositionedBar | null {
		for (const b of this.bars.values()) if (b.bookingId === bookingId) return b;
		return null;
	}

	/** Whether a booking currently has an in-flight local edit (any kind). Follows a
	 *  temp→real alias so a check on the real id sees a dirty marked under the temp id. */
	isDirty(bookingId: string): boolean {
		return this.#dirty.has(this.#rid(bookingId));
	}

	/** Whether a booking has an in-flight local edit of a SPECIFIC kind (alias-aware).
	 *  Used to keep a create's settle from clobbering a concurrent geometry edit. */
	isDirtyKind(bookingId: string, kind: DirtyKind): boolean {
		return this.#dirty.get(this.#rid(bookingId))?.kind === kind;
	}

	// --- reconcile -------------------------------------------------------------

	/**
	 * Merge a freshly-loaded server timeline into the board. Replaces the scaffold
	 * wholesale, then diffs the bars in FIELD-BY-FIELD, skipping any field a dirty entity
	 * owns. A tombstoned booking is kept deleted even if the pull still contains it; a
	 * booking the pull lacks is removed UNLESS it's dirty (an in-flight create/edit).
	 *
	 * This is the one method that used to be 7 reappliers.
	 */
	reconcile(timeline: DiaryTimeline | null): void {
		this.#sweepExpired();
		if (!timeline) return;
		const { scaffold, bars: serverBars } = splitScaffold(timeline);
		this.scaffold = scaffold;

		// Index the incoming server bars by composite key and by bookingId.
		const serverByKey = new Map<string, PositionedBar>();
		const serverBookingIds = new Set<string>();
		for (const sb of serverBars) {
			serverByKey.set(barKey(sb.bookingId, sb._tableId), sb);
			serverBookingIds.add(sb.bookingId);
		}

		// 1) Upsert every server bar, honouring per-field dirty on dirty bookings.
		for (const [key, rawSb] of serverByKey) {
			// A freshly-seated walk-in reads back 'unarrived' until its deferred floor_state
			// write lands — hold 'arrived' over that (time-gated) so it never flashes blue,
			// even when this pull is a fresh insert under the promoted real id (no local bar
			// or dirty to compare against — the race the ordering fixes can't fully close).
			const sb = this.#applySeatedGrace(rawSb);
			const dirty = this.#dirty.get(sb.bookingId);
			if (!dirty) {
				this.bars.set(key, sb); // clean booking — server truth wins outright
				continue;
			}
			if (dirty.kind === 'tombstone') continue; // deleted locally — don't re-add
			// Merge field-by-field: keep the dirty fields from the local bar, take the rest
			// from the server.
			const local = this.bars.get(key);
			// A geometry edit owns WHICH keys the booking occupies: if the local edit moved
			// the booking off this key, materialising the server bar here would resurrect a
			// ghost on the old table (a duplicate bar for the whole flight — the "bars stack"
			// report). Skip it; the settle/next reconcile paints the true position.
			if (!local && dirty.kind === 'geometry') continue;
			this.bars.set(key, local ? this.#mergeSkippingDirty(local, sb, dirty.fields) : sb);
		}

		// 2) Confirm/clear 'field' (status) dirties whose intent the pull now reflects. We
		//    check against the RAW server bar (serverByKey), NOT the post-merge local bar —
		//    the merge just re-protected the dirty arrival, so reading the local bar would
		//    always look "confirmed" and clear too early.
		for (const [bookingId, dirty] of this.#dirty) {
			if (dirty.kind !== 'field') continue;
			if (this.#pullConfirmsIntent(bookingId, dirty, serverByKey, serverBookingIds)) {
				this.#dirty.delete(bookingId);
			}
		}

		// 3) Remove bars the server no longer has — UNLESS the booking is dirty (an
		//    in-flight create/edit/tombstone whose absence is expected). A tombstone whose
		//    booking is now ALSO absent from the server has fully settled → drop it.
		for (const [key, local] of [...this.bars]) {
			if (serverByKey.has(key)) continue;
			const dirty = this.#dirty.get(local.bookingId);
			if (dirty && dirty.kind !== 'tombstone') continue; // geometry/create in flight — keep
			if (dirty && dirty.kind === 'tombstone') {
				this.bars.delete(key); // server also lacks it — deletion settled
				continue;
			}
			this.bars.delete(key); // clean booking the server dropped (cross-device change)
		}
		// A tombstone whose booking has fully disappeared from the server is settled.
		for (const [bookingId, dirty] of this.#dirty) {
			if (dirty.kind === 'tombstone' && !serverBookingIds.has(bookingId))
				this.#dirty.delete(bookingId);
		}
	}

	/** Copy server fields onto the local bar EXCEPT the dirty ones (which the host is
	 *  actively editing and the server pull may not yet reflect). */
	#mergeSkippingDirty(
		local: PositionedBar,
		server: PositionedBar,
		skip: Set<string>
	): PositionedBar {
		const merged = { ...server };
		const mergedRec = merged as unknown as Record<string, unknown>;
		const localRec = local as unknown as Record<string, unknown>;
		for (const f of skip) mergedRec[f] = localRec[f];

		// `detail` is a nested object taken wholesale from the server above, so a protected
		// field that ALSO lives on detail (the popover reads partySize/status from there)
		// would still be repainted with pre-write truth. Carry the local value across for
		// any skipped key detail actually carries.
		const serverDetail = server.detail as unknown as Record<string, unknown>;
		const localDetail = local.detail as unknown as Record<string, unknown>;
		let detail: Record<string, unknown> | null = null;
		for (const f of skip) {
			if (!(f in serverDetail)) continue;
			detail ??= { ...serverDetail };
			detail[f] = localDetail[f];
		}
		if (detail) merged.detail = detail as unknown as PositionedBar['detail'];

		merged._tableId = skip.has('_tableId') ? local._tableId : server._tableId;
		return merged;
	}

	/** Does the server pull confirm a status op's intent, so its 'field' dirty can clear?
	 *  Conservative: only clears when the pulled arrival is consistent with the intent, so
	 *  a pre-seat pull (booking present but floor_state not yet visible) doesn't clear too
	 *  early and flash the wrong colour. The TTL sweep is the backstop if it never lands. */
	#pullConfirmsIntent(
		bookingId: string,
		dirty: DirtyEntry,
		serverByKey: Map<string, PositionedBar>,
		serverBookingIds: Set<string>
	): boolean {
		// Read the RAW server bar for this booking (any of its keys) — not the merged local
		// bar, whose dirty fields we just re-protected.
		let serverBar: PositionedBar | null = null;
		for (const sb of serverByKey.values())
			if (sb.bookingId === bookingId) {
				serverBar = sb;
				break;
			}

		// A VALUE intent (covers): the dirty may only clear once the server actually comes
		// back showing what we asked for. Clearing on mere presence would unprotect the
		// optimistic value while the write was still in flight, and the same pull that
		// cleared it would overwrite it with pre-write truth.
		if (dirty.intendedFields) {
			// A burst still draining: the server may be transiently sitting on the intended
			// value between writes. Confirming here would drop the gate mid-burst and let the
			// board chase every intermediate the queue is about to write.
			if ((dirty.pending ?? 0) > 0) return false;
			if (!serverBar) return false;
			return Object.entries(dirty.intendedFields).every(([k, v]) =>
				nullishEq(readPath(serverBar, k), v)
			);
		}

		if (!dirty.intendedArrival) {
			// No intent at all (e.g. ackNew) — clear once the booking is present.
			return serverBookingIds.has(bookingId);
		}
		if (!serverBar) return false;
		return arrivalConsistent(dirty.intendedArrival, serverBar.arrival, serverBar.status);
	}

	// --- mutate ----------------------------------------------------------------

	/** Resolve an id through promote()'s re-keys (temp→real). */
	#rid(id: string): string {
		let cur = id;
		for (let hop = 0; hop < 4; hop++) {
			const next = this.#aliases.get(cur);
			if (!next) return cur;
			cur = next;
		}
		return cur;
	}

	/** Run `job` once every prior write on the given bookings has finished. The stored
	 *  chain never rejects (jobs guard internally; the tail swallows anyway) and entries
	 *  self-remove once they're no longer the tail — checking both the enqueue-time id and
	 *  its current alias, since promote() re-keys chains mid-flight. */
	#enqueue<T>(ids: string[], job: () => Promise<T>): Promise<T> {
		const tails = ids.map((id) => this.#writeChains.get(this.#rid(id)) ?? Promise.resolve());
		const run = Promise.all(tails).then(job);
		const guard = run.then(
			() => undefined,
			() => undefined
		);
		for (const id of ids) this.#writeChains.set(this.#rid(id), guard);
		void guard.then(() => {
			for (const id of ids)
				for (const key of [id, this.#rid(id)])
					if (this.#writeChains.get(key) === guard) this.#writeChains.delete(key);
		});
		return run;
	}

	/** Resolves once the booking's write chain has fully drained (nothing queued or in
	 *  flight). The page defers its failure reconcile behind this: by drain time the
	 *  burst's dirties are gone, so the repaint applies server truth unconditionally and
	 *  repairs any board↔DB divergence a mid-burst failure left. */
	async whenIdle(bookingId: string): Promise<void> {
		for (;;) {
			const tail = this.#writeChains.get(this.#rid(bookingId));
			if (!tail) return;
			await tail;
		}
	}

	/**
	 * Apply an optimistic patch to a booking's bars, mark the relevant fields dirty, run
	 * the write in the background, and settle: on success merge the authoritative response
	 * (geometry) or leave the field-dirty for a confirming reconcile (status); on failure
	 * restore the pre-patch snapshot. Returns whether the write succeeded.
	 *
	 * The patch + dirty are SYNCHRONOUS (zero added latency); the write queues behind any
	 * in-flight op on the same booking. Ownership: only the burst's NEWEST op settles or
	 * restores — a superseded op's late response is skipped (writes carry absolute
	 * geometry, so last-op-wins is correct).
	 *
	 * @param bookingId  the booking being edited (real id, or a temp id for a create)
	 * @param kind       which dirty kind gates the reconcile for this op
	 * @param patch      mutates each of the booking's bars in place (optimistic)
	 * @param write      performs the server write; resolves to {ok, data?}
	 * @param opts.intendedArrival  for status ops, the arrival the patch set (settle hint)
	 * @param opts.settle           for geometry ops, merge the response window into the bars
	 */
	async mutate(
		bookingId: string,
		kind: DirtyKind,
		patch: (bar: PositionedBar) => void,
		write: () => Promise<{ ok: boolean; data?: Record<string, unknown> }>,
		opts: {
			intendedArrival?: string;
			settle?: (bars: PositionedBar[], data: Record<string, unknown>) => void;
		} = {}
	): Promise<boolean> {
		const id = this.#rid(bookingId); // follow an already-promoted temp so the patch hits live bars
		const snapshot = this.barsOf(id).map((b) => structuredCloneBar(b));
		// Apply the optimistic patch to every bar of the booking — synchronously.
		this.#patchBooking(id, patch);
		const myGen = this.#markDirty(id, kind, snapshot, opts.intendedArrival);

		return this.#enqueue([id], async () => {
			const pre = this.#dirty.get(this.#rid(id));
			if (pre) {
				pre.expires = Date.now() + DIRTY_TTL_MS; // a queued burst must not get TTL-swept mid-flight
				// …and refreshing the TTL once, here, is not enough on its own: it dates the
				// gate from when the write STARTED, so a write slower than the TTL loses its
				// protection while still in flight. A move takes ~3s against the droplet and
				// far longer on a weak connection, and the moment the gate goes, the next pull
				// — still carrying the OLD table — repaints the bar back and the host watches
				// their own drag undo itself. Count the write as in flight instead; the sweep
				// leaves those alone (bounded by PENDING_CEILING_MS) and #noteWriteDone below
				// restarts the clock from the response.
				pre.pending = (pre.pending ?? 0) + 1;
			}
			let ok = false;
			let data: Record<string, unknown> | undefined;
			try {
				({ ok, data } = await write());
			} catch {
				ok = false;
			}
			const rid = this.#rid(id); // the write may have promoted temp→real
			// Drain FIRST, on every path — including a superseded one — or the gate stays
			// "write in flight" for ever and this booking stops taking server truth.
			this.#noteWriteDone(rid);
			const d = this.#dirty.get(rid);
			const current = d !== undefined && d.gen === myGen;
			if (!ok) {
				if (current && d) {
					// Final failure of the burst. Restore ONLY if nothing in the burst
					// succeeded — after a mid-burst success the snapshot matches neither DB
					// nor intent; the caller's drained reconcile repaints truth instead.
					if (!d.succeededAny) this.#restore(rid, d.snapshot);
					this.#dirty.delete(rid);
				}
				return false; // superseded failure: no restore — the newer op owns the board
			}
			if (current) {
				if (kind === 'geometry') {
					// Geometry settles from the response — merge the authoritative window then
					// clear the dirty (the reconcile no longer needs to protect it).
					if (opts.settle && data) opts.settle(this.barsOf(rid), data);
					this.#dirty.delete(rid);
				}
				// 'field' (status) stays dirty until a confirming reconcile / TTL. 'tombstone'
				// stays dirty until the booking is absent from the server.
			} else if (d) {
				// Superseded success: the newer op's response is the authority — skip the
				// settle so its optimistic geometry stands. Record that the DB moved (failure
				// semantics above) and keep the version token fresh (cheap hardening).
				d.succeededAny = true;
				const version = data && typeof data.version === 'string' ? data.version : '';
				if (version)
					for (const [key, b] of [...this.bars])
						if (b.bookingId === rid) this.bars.set(key, { ...b, version });
			}
			return true;
		});
	}

	/** Remove a booking's bars optimistically and tombstone it (cancel / move-to-waitlist).
	 *  Runs the write; on failure restores the bars and drops the tombstone. */
	async remove(bookingId: string, write: () => Promise<{ ok: boolean }>): Promise<boolean> {
		const snapshot = this.barsOf(bookingId).map((b) => structuredCloneBar(b));
		for (const b of snapshot) this.bars.delete(barKey(b.bookingId, b._tableId));
		this.#markDirty(bookingId, 'tombstone', snapshot);
		const { ok } = await write();
		if (!ok) {
			this.#restore(bookingId, snapshot);
			this.#dirty.delete(bookingId);
		}
		return ok;
	}

	/**
	 * Atomically mutate TWO bookings as one operation (a table SWAP). `mutate` is single-
	 * booking, but a swap exchanges two bookings' tables via ONE server write (swapBookingTables
	 * runs under one lock) and settles from a paired `{a, b}` response. This owns that:
	 *  - snapshots BOTH bookings first (so a failure restores both),
	 *  - `patch` exchanges both bars' `_tableId`/window SIMULTANEOUSLY — the caller computes both
	 *    targets up front and re-keys both, so the board never transiently stacks two bookings on
	 *    one row (the old placeAllAtomically lift-then-place invariant),
	 *  - marks BOTH geometry-dirty (a mid-swap reconcile can't clobber either),
	 *  - runs the single write; on success `settle(data)` merges each booking's authoritative
	 *    response and clears both dirties; on failure restores BOTH snapshots and drops both.
	 *
	 * `patch` receives the two bookings' current bar arrays and mutates them in place. Because a
	 * swap can involve a still-`temp-` walk-in whose real id only exists after its create resolves,
	 * `write` may await/promote internally and then `settle` targets the (possibly promoted) ids —
	 * the caller passes the ids it wants settled via the settle closure, not this method.
	 */
	async mutatePair(
		idA: string,
		idB: string,
		patch: (barsA: PositionedBar[], barsB: PositionedBar[]) => void,
		write: () => Promise<{ ok: boolean; data?: Record<string, unknown> }>,
		settle: (data: Record<string, unknown>) => void
	): Promise<boolean> {
		const a = this.#rid(idA);
		const b = this.#rid(idB);
		const snapA = this.barsOf(a).map((x) => structuredCloneBar(x));
		const snapB = this.barsOf(b).map((x) => structuredCloneBar(x));
		// Compute the patched bars off clones, then commit both re-keyings together so there is
		// never an intermediate board state with both bookings on one row.
		const nextA = snapA.map((x) => structuredCloneBar(x));
		const nextB = snapB.map((x) => structuredCloneBar(x));
		patch(nextA, nextB);
		this.#replaceBookingBars(a, nextA);
		this.#replaceBookingBars(b, nextB);
		const genA = this.#markDirty(a, 'geometry', snapA);
		const genB = this.#markDirty(b, 'geometry', snapB);

		// The single write queues behind BOTH bookings' in-flight ops (e.g. swap A↔B right
		// after dragging A: the swap posts once the move has landed, so the server sees the
		// moved position — matching the optimistic exchange).
		return this.#enqueue([a, b], async () => {
			for (const id of [a, b]) {
				const pre = this.#dirty.get(this.#rid(id));
				if (pre) pre.expires = Date.now() + DIRTY_TTL_MS;
			}
			let ok = false;
			let data: Record<string, unknown> | undefined;
			try {
				({ ok, data } = await write());
			} catch {
				ok = false;
			}
			const ra = this.#rid(a);
			const rb = this.#rid(b);
			const dA = this.#dirty.get(ra);
			const dB = this.#dirty.get(rb);
			const curA = dA !== undefined && dA.gen === genA;
			const curB = dB !== undefined && dB.gen === genB;
			if (!ok) {
				// Restore each CURRENT, un-succeeded participant; a superseded participant is
				// left to its newer op (same rules as mutate).
				if (curA && dA) {
					if (!dA.succeededAny) this.#restore(ra, dA.snapshot);
					this.#dirty.delete(ra);
				}
				if (curB && dB) {
					if (!dB.succeededAny) this.#restore(rb, dB.snapshot);
					this.#dirty.delete(rb);
				}
				return false;
			}
			if (curA && curB) {
				// The settle closure touches BOTH bookings — run it only while both are still
				// owned by this op.
				if (data) settle(data);
				this.#dirty.delete(ra);
				this.#dirty.delete(rb);
			} else {
				// One side superseded: the optimistic exchange already equals the swap the
				// server confirmed, so the still-current side just clears (the next reconcile
				// refreshes its version); the superseded side belongs to its newer op.
				if (curA) this.#dirty.delete(ra);
				else if (dA) dA.succeededAny = true;
				if (curB) this.#dirty.delete(rb);
				else if (dB) dB.succeededAny = true;
			}
			return true;
		});
	}

	/** Merge a swap's authoritative `{version, tableIds}` into a booking's bars and clear its
	 *  dirty. Unlike settleWindow, a swap response carries NO start/end (each booking keeps its
	 *  own time), so we only refresh version + re-home the bar(s) onto the returned table(s). */
	settleTables(
		bookingId: string,
		data: { version?: string; tableIds?: string[] } | undefined
	): void {
		if (data) {
			const version = typeof data.version === 'string' ? data.version : '';
			const tables = Array.isArray(data.tableIds)
				? data.tableIds.map(String).filter((t) => t && t !== '__unassigned__')
				: [];
			if (tables.length) {
				// Re-home: the booking should end up as one bar per returned table, preserving the
				// current window. Take the first current bar as the template.
				const cur = this.barsOf(bookingId);
				const template = cur[0];
				if (template) {
					for (const b of cur) this.bars.delete(barKey(b.bookingId, b._tableId));
					for (const tid of tables) {
						const next: PositionedBar = { ...structuredCloneBar(template), _tableId: tid };
						if (version) next.version = version;
						this.bars.set(barKey(bookingId, tid), next);
					}
				}
			} else if (version) {
				for (const [key, b] of [...this.bars]) {
					if (b.bookingId === bookingId) this.bars.set(key, { ...b, version });
				}
			}
		}
		this.#dirty.delete(bookingId);
	}

	/** Replace ALL of a booking's bars with the given set (used by mutatePair's atomic swap). */
	#replaceBookingBars(bookingId: string, bars: PositionedBar[]): void {
		for (const [key, b] of [...this.bars]) if (b.bookingId === bookingId) this.bars.delete(key);
		for (const b of bars) this.bars.set(barKey(b.bookingId, b._tableId), b);
	}

	// --- write-decoupled optimistic ops (migration phase) ----------------------
	// During the incremental migration the LEGACY code path still issues the single server
	// write (e.g. queueStatusWrite → postAction). These helpers let the store mirror the
	// optimistic patch + dirty WITHOUT owning the write, so there's exactly one POST. The
	// legacy write's success/failure then drives settle (a confirming reconcile clears a
	// 'field' dirty; the tombstone clears when the server drops the booking) or revert
	// (revertOptimistic). Once all ops route through mutate()/remove() these can go.

	/** Apply an optimistic status/arrival patch + mark the booking 'field'-dirty, without
	 *  issuing a write. Snapshot is kept for revertOptimistic on a failed write. `fields`
	 *  overrides which bar fields the reconcile must skip (default arrival+status); e.g. a
	 *  confirm passes ['confirmed']. `intendedArrival` (when set) settles the dirty on a
	 *  confirming reconcile; without it the dirty clears once the booking is present + TTL. */
	applyOptimisticStatus(
		bookingId: string,
		patch: (bar: PositionedBar) => void,
		intendedArrival?: string,
		fields?: string[],
		intendedFields?: Record<string, unknown>
	): number {
		const snapshot = this.barsOf(bookingId).map((b) => structuredCloneBar(b));
		this.#patchBooking(bookingId, patch);
		// Returns the generation stamp: pass it to settleWindow/revertOptimistic so a write
		// whose response arrives AFTER a newer edit knows it's been superseded and keeps its
		// hands off the board.
		return this.#markDirty(bookingId, 'field', snapshot, intendedArrival, fields, intendedFields);
	}

	/** Patch a booking's bars AND widen its EXISTING dirty to also protect `fields`, without
	 *  changing the dirty's kind or clearing it. For a fresh walk-in that the host has already
	 *  resized/swapped: the geometry dirty guards size/table, but a walk-in's SEAT (floor_state)
	 *  write is deferred server-side, so a reconcile carrying the booking pre-seat would flash
	 *  its arrival to 'unarrived' (blue) for a frame. This stamps 'arrived' on the bar and adds
	 *  arrival/status to that same geometry dirty's protected set, so the one entry guards BOTH
	 *  the edit's geometry and the walk-in's colour until the edit settles. No-op if the booking
	 *  has no dirty (nothing in flight → the normal settle path owns it). */
	protectAndPatch(bookingId: string, patch: (bar: PositionedBar) => void, fields: string[]): void {
		const id = this.#rid(bookingId);
		const d = this.#dirty.get(id);
		if (!d) return;
		this.#patchBooking(id, patch);
		for (const f of fields) d.fields.add(f);
	}

	/** Optimistically remove a booking's bars + tombstone it, without issuing a write. */
	applyOptimisticRemove(bookingId: string): void {
		const snapshot = this.barsOf(bookingId).map((b) => structuredCloneBar(b));
		if (!snapshot.length && this.#dirty.has(bookingId)) return;
		for (const b of snapshot) this.bars.delete(barKey(b.bookingId, b._tableId));
		this.#markDirty(bookingId, 'tombstone', snapshot);
	}

	/** Revert a write-decoupled optimistic op from its snapshot and drop its dirty. Called
	 *  when the legacy path's single write FAILED. No-op if the booking isn't dirty. */
	revertOptimistic(bookingId: string, gen?: number): void {
		const d = this.#dirty.get(bookingId);
		if (!d) return;
		if (gen !== undefined) this.#noteWriteDone(bookingId); // drain first — every path
		// Superseded failure: a newer edit owns the board now. Rolling back to OUR snapshot
		// would throw away the user's latest click. The newer op's own settle/revert decides.
		if (gen !== undefined && d.gen !== gen) return;
		// A later op in this burst already committed, so the pre-burst snapshot matches
		// neither the DB nor the user's intent — let the reconcile repaint truth instead.
		if (!d.succeededAny) this.#restore(bookingId, d.snapshot);
		this.#dirty.delete(bookingId);
	}

	/** Remove a booking's bars AND drop its dirty outright — for an optimistic create/walk-in
	 *  whose write FAILED or was UNDONE, so nothing (no ghost bar, no dead temp-keyed dirty)
	 *  survives. Unlike revertOptimistic this does NOT restore a snapshot (a create has no
	 *  prior state to restore to). Replaces the old delete(pendingWalkins)+removeBars+
	 *  dropStagedFor trio for the store side. */
	dropOptimistic(bookingId: string): void {
		for (const [key, b] of [...this.bars]) if (b.bookingId === bookingId) this.bars.delete(key);
		this.#dirty.delete(bookingId);
	}

	/** Stage a booking's optimistic geometry: replace its bars with the given positioned set
	 *  (one per table it now occupies) and mark it geometry-dirty so a reconcile can't snap it
	 *  back. Idempotent across successive drags of the same booking (re-keys freely). This is
	 *  the store side of the legacy patchBarMove/patchBarEnd/placeBarAt staging — the page
	 *  computes the final positions from `tl`, the store just holds them dirty until the batch
	 *  commit settles (settleWindow) or cancel reverts (revertOptimistic). */
	stageGeometry(
		bookingId: string,
		targets: { tableId: string; startMin: number; endMin: number }[]
	): void {
		// Capture the pre-stage snapshot ONCE (the first time this booking is staged), so a
		// cancel restores its true origin, not a half-applied intermediate.
		const existing = this.#dirty.get(bookingId);
		const snapshot =
			existing && existing.kind === 'geometry'
				? existing.snapshot
				: this.barsOf(bookingId).map((b) => structuredCloneBar(b));
		// Use the first current bar as the template for scalar fields (guest, party, detail…).
		const template = this.bar(bookingId) ?? snapshot[0];
		if (!template) return;
		// Drop the booking's current bars, then place one per target table.
		for (const [key, b] of [...this.bars]) if (b.bookingId === bookingId) this.bars.delete(key);
		for (const t of targets) {
			const next: PositionedBar = {
				...structuredCloneBar(template),
				_tableId: t.tableId,
				startMin: t.startMin,
				endMin: t.endMin
			};
			this.bars.set(barKey(bookingId, t.tableId), next);
		}
		this.#dirty.set(bookingId, {
			kind: 'geometry',
			fields: new Set(GEOMETRY_FIELDS),
			snapshot,
			expires: Date.now() + DIRTY_TTL_MS,
			gen: ++this.#genSeq,
			succeededAny: false
		});
	}

	/** Merge an authoritative server window ({version,startsAt,endsAt,tableIds}) into a
	 *  booking's bars. This is the store's version of applyServerWindow — used by
	 *  covers/reallocate whose action response carries the fresh window (a party change can
	 *  lengthen the sitting via the turn ladder). Position (startMin/endMin) is re-derived
	 *  from the ISO window by the caller-supplied `minOf` so the store stays free of the
	 *  page's axis math. No-op if the booking isn't present.
	 *
	 *  `opts.gen` — the stamp from applyOptimisticStatus. When a NEWER edit has since taken
	 *  ownership of this booking, this response is stale: it describes the world as of an
	 *  earlier click. Settling it would drag the board backwards, so we only refresh the
	 *  version token (needed by the next write) and leave the newer optimistic state alone.
	 *  Mirrors the supersede handling in mutate(). Omit for single-shot callers.
	 *
	 *  `opts.clearDirty` — defaults true (a geometry settle owns its dirty). A 'field' edit
	 *  must pass FALSE: its response proves the server took the write, but a reconcile
	 *  already in flight can still land afterwards carrying pre-write truth, and with the
	 *  gate dropped it would overwrite the value. Let the confirming reconcile clear it.
	 *
	 *  `opts.reposition` — defaults true. FALSE for a drag (move/resize), because the bar is
	 *  already exactly where the host put it and this window cannot say where that is. A
	 *  bar's DRAWN minutes are not its booked window: the server pushes the right edge out to
	 *  the end of its cell (barGrid.ts) and pulls the left edge in to the seat stamp
	 *  (seatTrim.ts), using seat times and neighbouring bars the browser never sees. Deriving
	 *  the position from starts_at/ends_at therefore UNDOES that drawing — a party seated at
	 *  16:00 on a 13:00 booking snapped three hours left the moment their move settled, and
	 *  stayed there until the next pull put it back. The ISO window and the version token are
	 *  still authoritative and still merged; only the drawing is left alone, for the reconcile
	 *  (which carries the server's real geometry) to correct. */
	settleWindow(
		bookingId: string,
		data: Record<string, unknown> | undefined,
		minOf: (iso: string) => number | null,
		opts: { gen?: number; clearDirty?: boolean; reposition?: boolean } = {}
	): void {
		const d = this.#dirty.get(bookingId);
		const superseded = opts.gen !== undefined && d !== undefined && d.gen !== opts.gen;
		if (opts.gen !== undefined) this.#noteWriteDone(bookingId);

		if (superseded) {
			// The DB did move — a later failure must not restore the pre-burst snapshot.
			d.succeededAny = true;
			const version = data && typeof data.version === 'string' ? data.version : '';
			if (version)
				for (const [key, b] of [...this.bars])
					if (b.bookingId === bookingId) this.bars.set(key, { ...b, version });
			return;
		}

		if (data) {
			const version = typeof data.version === 'string' ? data.version : '';
			const startsAt = typeof data.startsAt === 'string' ? data.startsAt : '';
			const endsAt = typeof data.endsAt === 'string' ? data.endsAt : '';
			const reposition = opts.reposition ?? true;
			const startMin = reposition && startsAt ? minOf(startsAt) : null;
			const endMin = reposition && endsAt ? minOf(endsAt) : null;
			for (const [key, b] of [...this.bars]) {
				if (b.bookingId !== bookingId) continue;
				const next = { ...b };
				if (version) next.version = version;
				if (startsAt) {
					next.startsAt = startsAt;
					next.detail = { ...next.detail, startsAt };
				}
				if (endsAt) {
					next.endsAt = endsAt;
					next.detail = { ...next.detail, endsAt };
				}
				if (startMin !== null) next.startMin = startMin;
				if (endMin !== null) next.endMin = endMin;
				this.bars.set(key, next);
			}
		}
		if (opts.clearDirty ?? true) this.#dirty.delete(bookingId);
		else if (d) d.succeededAny = true;
	}

	/** Insert an optimistic bar (a create / walk-in not yet on the server). Marked geometry-
	 *  dirty so a reconcile that predates the write can't drop it. */
	insert(bar: PositionedBar, kind: DirtyKind = 'geometry'): void {
		this.bars.set(barKey(bar.bookingId, bar._tableId), bar);
		const snapshot = this.barsOf(bar.bookingId).map((b) => structuredCloneBar(b));
		this.#markDirty(bar.bookingId, kind, snapshot);
	}

	/** Insert an optimistic CREATE bar whose real id is already known (the Book modal).
	 *  Marked as a 'presence' dirty: it keeps the bar alive against a reconcile that PREDATES
	 *  the create (server doesn't have it yet → don't drop), but it does NOT protect any
	 *  field — so the FIRST reconcile that DOES contain the real booking supersedes the
	 *  optimistic bar with full server truth and clears the dirty. This is the create
	 *  semantics (server wins on arrival), distinct from an edit (local wins until settled). */
	insertCreated(bar: PositionedBar): void {
		this.bars.set(barKey(bar.bookingId, bar._tableId), bar);
		const snapshot = this.barsOf(bar.bookingId).map((b) => structuredCloneBar(b));
		// 'field' kind with an EMPTY field set: protects nothing (server truth flows through)
		// but its presence still suppresses the "server lacks it → delete" path in reconcile,
		// and it self-clears once the booking is present (no intendedArrival → present-is-enough).
		this.#dirty.set(bar.bookingId, {
			kind: 'field',
			fields: new Set(),
			snapshot,
			expires: Date.now() + DIRTY_TTL_MS,
			gen: ++this.#genSeq,
			succeededAny: false
		});
	}

	/** Promote a temp (client-id) booking to its real server id in ONE place: re-key every
	 *  bar and dirty entry from tempId to realId. Replaces the old promoteTempBar +
	 *  tempPromotions re-keying smeared across staged/swapOrigins/pendingWalkins. */
	promote(tempId: string, realId: string, version?: string): void {
		for (const [key, b] of [...this.bars]) {
			if (b.bookingId !== tempId) continue;
			this.bars.delete(key);
			const next: PositionedBar = { ...b, bookingId: realId };
			if (version) next.version = version;
			this.bars.set(barKey(realId, next._tableId), next);
		}
		const d = this.#dirty.get(tempId);
		if (d) {
			this.#dirty.delete(tempId);
			// The snapshot must restore under REAL keys — a promote-then-fail would otherwise
			// resurrect temp-keyed ghost bars alongside the real ones.
			for (const s of d.snapshot) s.bookingId = realId;
			this.#dirty.set(realId, d);
		}
		// Re-key the write chain and record the alias so ops enqueued under the temp id
		// (and later gestures on the real id) share ONE serialized chain.
		const chain = this.#writeChains.get(tempId);
		if (chain) {
			this.#writeChains.delete(tempId);
			this.#writeChains.set(realId, chain);
		}
		// Carry a seated stamp across the promote (a walk-in marked seated on its temp id
		// must keep the grace under its real id).
		const seatedAt = this.#seatedAt.get(tempId);
		if (seatedAt !== undefined) {
			this.#seatedAt.delete(tempId);
			this.#seatedAt.set(realId, seatedAt);
		}
		this.#aliases.set(tempId, realId);
	}

	/** Clear a booking's dirty (e.g. a status write that has fully settled by other means). */
	clearDirty(bookingId: string): void {
		this.#dirty.delete(bookingId);
	}

	/** Record that a booking was just SEATED, so reconcile holds its 'arrived' colour over the
	 *  server's transient 'unarrived' (deferred floor_state) for SEATED_GRACE_MS. Call when a
	 *  walk-in create resolves (the server seats on create). Alias-aware. */
	markSeated(bookingId: string): void {
		this.#seatedAt.set(this.#rid(bookingId), Date.now());
	}

	// --- lifecycle -------------------------------------------------------------

	/** Hard reset — drop all bars, dirty, and the scaffold. Wired to the SAME
	 *  beforeNavigate param-compare the old resetUncommittedState used, so a staged edit
	 *  can never leak across a brand/date/floor change (buildBatchEntries stamps data.date).
	 */
	reset(): void {
		this.bars.clear();
		this.#dirty.clear();
		this.#writeChains.clear();
		this.#aliases.clear();
		this.#seatedAt.clear();
		this.scaffold = null;
	}

	// --- internals -------------------------------------------------------------

	#patchBooking(bookingId: string, patch: (bar: PositionedBar) => void): void {
		// Patch every bar FIRST, then delete all the old keys, then write the new ones.
		//
		// Doing it per-bar (delete-then-set inside the loop) silently ate bars whenever a
		// patch SHIFTED a booking onto rows it already occupied — a JOINED party dragged one
		// row down remaps 20→21, 21→22, 22→23, 23→24, so each iteration's delete removed the
		// bar the previous iteration had just written, and a 4-table party collapsed to a
		// single bar on the last row. Two passes make the re-key atomic and order-independent.
		const patched: PositionedBar[] = [];
		const oldKeys: string[] = [];
		for (const [key, b] of this.bars) {
			if (b.bookingId !== bookingId) continue;
			oldKeys.push(key);
			const next = { ...b };
			patch(next);
			patched.push(next);
		}
		if (!patched.length) return;
		for (const key of oldKeys) this.bars.delete(key);
		for (const b of patched) this.bars.set(barKey(b.bookingId, b._tableId), b);
	}

	#restore(bookingId: string, snapshot: PositionedBar[]): void {
		// Drop whatever is currently keyed under this booking, then re-insert the snapshot.
		for (const [key, b] of [...this.bars]) if (b.bookingId === bookingId) this.bars.delete(key);
		for (const b of snapshot) this.bars.set(barKey(b.bookingId, b._tableId), b);
	}

	/** Mark a booking dirty and return the op's ownership stamp. When a geometry op lands
	 *  on an existing geometry entry (a BURST), the original snapshot is KEPT — it is the
	 *  pre-burst server truth; re-snapshotting would capture an optimistic intermediate and
	 *  a later revert would restore the wrong state. */
	#markDirty(
		bookingId: string,
		kind: DirtyKind,
		snapshot: PositionedBar[],
		intendedArrival?: string,
		fieldsOverride?: string[],
		intendedFields?: Record<string, unknown>
	): number {
		const gen = ++this.#genSeq;
		const fields = new Set<string>();
		if (kind === 'geometry') for (const f of GEOMETRY_FIELDS) fields.add(f);
		if (kind === 'field') {
			if (fieldsOverride?.length) for (const f of fieldsOverride) fields.add(f);
			else {
				fields.add('arrival');
				fields.add('status');
			}
		}
		// BURST: an op landing on a booking that already has a same-kind dirty takes
		// ownership of the existing entry rather than replacing it. Replacing would reset
		// `snapshot` to the previous op's OPTIMISTIC bars (so a revert would restore an
		// intermediate, not the truth we started from) and reset `succeededAny` (so a late
		// failure would restore a snapshot the DB has already moved past).
		//
		// This used to apply only to geometry, which left rapid covers clicks — 'field'
		// dirties — replacing the entry on every click.
		const existing = this.#dirty.get(bookingId);
		if (existing && existing.kind === kind && kind !== 'tombstone') {
			for (const f of fields) existing.fields.add(f);
			existing.gen = gen; // newest op takes ownership; snapshot stays pre-burst truth
			existing.expires = Date.now() + DIRTY_TTL_MS;
			// The newest op's intent is the one the server must confirm.
			if (intendedArrival !== undefined) existing.intendedArrival = intendedArrival;
			if (intendedFields) {
				existing.intendedFields = { ...existing.intendedFields, ...intendedFields };
				existing.pending = (existing.pending ?? 0) + 1;
			}
			return gen;
		}
		this.#dirty.set(bookingId, {
			kind,
			fields,
			snapshot,
			expires: Date.now() + DIRTY_TTL_MS,
			intendedArrival,
			intendedFields,
			pending: intendedFields ? 1 : undefined,
			gen,
			succeededAny: false
		});
		return gen;
	}

	/** One in-flight write for a value-intent dirty has finished (either way). The gate can
	 *  only clear once the whole burst has drained — see DirtyEntry.pending. Must run on
	 *  EVERY terminal path, including a superseded response, or the gate wedges open until
	 *  the TTL sweep. */
	#noteWriteDone(bookingId: string): void {
		const d = this.#dirty.get(bookingId);
		if (!d) return;
		if (d.pending) d.pending -= 1;
		// Restart the clock on the RESPONSE. settleWindow keeps a value-intent gate open on
		// purpose until a pull CONFIRMS the value, and that pull is a whole reconcile away.
		// Measured on production: the covers write answers in ~3.2s and the day read alone
		// takes ~1.9s, so a TTL started at the CLICK could already have lapsed by the time
		// there was anything to confirm — and the host's change quietly reverted.
		d.expires = Date.now() + DIRTY_TTL_MS;
	}

	/** Drop dirties past their TTL so a never-confirmed edit can't wedge state forever. */
	#sweepExpired(): void {
		const now = Date.now();
		for (const [id, d] of this.#dirty) {
			// A write still in flight OWNS its gate, however long the server takes. The TTL is
			// here to release a gate nobody will ever settle — it is not a deadline for the
			// server, and treating it as one is what let a slow write lose its protection
			// mid-flight: the gate went, the next pull landed carrying pre-write truth, and the
			// party the host had set reverted (owner: "it was 2 and then I set to 4 and then
			// when I came back to it later it was 2 again"). Once the write returns,
			// #noteWriteDone restarts the clock, so an unconfirmed gate still expires.
			//
			// Not forever, though. Every write path drains the count on both outcomes, but a
			// write that neither resolves nor rejects (a tab suspended mid-flight, a killed
			// service worker) would leave it stuck above zero and wedge this booking out of
			// server truth for the life of the tab. PENDING_CEILING_MS is the backstop.
			if ((d.pending ?? 0) > 0 && d.expires > now - PENDING_CEILING_MS) continue;
			if (d.expires <= now) this.#dirty.delete(id);
		}
		for (const [id, at] of this.#seatedAt)
			if (now - at > SEATED_GRACE_MS) this.#seatedAt.delete(id);
	}

	/** If an incoming server bar reads 'unarrived' but its booking was just seated (within
	 *  the grace), return a copy showing 'arrived' — the deferred floor_state hasn't caught
	 *  up. Leave a terminal state (left / no_show / an already-seated status) alone. Returns
	 *  the bar unchanged in every other case. */
	#applySeatedGrace(sb: PositionedBar): PositionedBar {
		if (sb.arrival !== 'unarrived' && sb.arrival !== 'late') return sb;
		if (sb.status === 'completed' || sb.status === 'no_show' || sb.status === 'cancelled')
			return sb;
		let seatedAt = this.#seatedAt.get(this.#rid(sb.bookingId));
		if (seatedAt === undefined) {
			// The stamp may still be under the TEMP id if the reconcile beat the promote — the
			// server bar arrives under the real id before #aliases records temp→real. Match a
			// seated temp that will promote to this id (temp-{startMin}-{tableId}) so the grace
			// still catches this first pre-seat pull.
			const tempGuess = `temp-${sb.startMin}-${sb._tableId}`;
			seatedAt = this.#seatedAt.get(tempGuess);
		}
		if (seatedAt === undefined || Date.now() - seatedAt > SEATED_GRACE_MS) return sb;
		return { ...sb, arrival: 'arrived' };
	}
}

/** Read a (possibly dotted) path off a bar — `'partySize'` or `'detail.bookingComments'`.
 *  Returns undefined for any missing hop rather than throwing. */
function readPath(bar: PositionedBar, path: string): unknown {
	let cur: unknown = bar;
	for (const key of path.split('.')) {
		if (cur === null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string, unknown>)[key];
	}
	return cur;
}

/** Compare an intended value against what the server came back with, treating null/undefined
 *  and '' as the same. The board's adapters map an empty column to `undefined`
 *  (`b.special_requests || undefined`), so an edit that CLEARS a note intends '' but reads
 *  back as undefined — strict equality would never confirm it and the gate would only drop
 *  on the 10s TTL sweep. */
function nullishEq(a: unknown, b: unknown): boolean {
	return (a ?? '') === (b ?? '');
}

/** Deep-ish clone of a positioned bar for snapshots (detail is a nested object). */
function structuredCloneBar(b: PositionedBar): PositionedBar {
	return { ...b, detail: { ...b.detail } };
}

/** Is a pulled arrival/status consistent with an optimistic status intent, so its dirty
 *  can clear? Mirrors the old reapplyWalkins seated-consistency check. */
function arrivalConsistent(intended: string, pulledArrival: string, pulledStatus: string): boolean {
	if (pulledArrival === intended) return true;
	switch (intended) {
		// A booking is status='seated' whether it is FULLY or only PARTLY down, so the
		// status check can't stand in for the arrival here: it would let a pull taken
		// before a "Seat all" write landed (still reading part-seated) clear the gate and
		// repaint the bar yellow, which reads as "the button did nothing". Each of the two
		// seated states clears only on itself (or a terminal 'left'); anything else waits
		// for the next pull or the dirty TTL.
		case 'arrived':
			return (
				pulledArrival === 'arrived' ||
				pulledArrival === 'left' ||
				(pulledStatus === 'seated' && pulledArrival !== 'partially_seated')
			);
		case 'partially_seated':
			return pulledArrival === 'partially_seated' || pulledArrival === 'left';
		case 'left':
			return pulledArrival === 'left' || pulledStatus === 'completed';
		case 'no_show':
			return pulledArrival === 'no_show' || pulledStatus === 'no_show';
		case 'unarrived':
			return pulledArrival === 'unarrived';
		default:
			// waiting_bar / table_ready (floor_status) — clear once the pull reflects it.
			return pulledArrival === intended;
	}
}

/** Shared singleton — one board per open diary tab. */
export const diaryStore = new DiaryStore();
