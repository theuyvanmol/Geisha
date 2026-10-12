// WP-LIVE-7 — Realtime service sync (diary + floor).
//
// Keeps every open board in step within ~1s of any seat/clear/move/walk-in/booking from ANY
// device, with no continuous polling.
//
// ──────────────────────────────────────────────────────────────────────────
// WHAT WENT WRONG BEFORE (and why this file looks the way it does now)
//
// This store used to point an ANONYMOUS browser PocketBase client at geisha_bookings /
// geisha_floor_state / geisha_tables and subscribe to them directly. All three are
// superuser-only, and PocketBase authorises realtime at DELIVERY time against the List
// rule — so that client was subscribed to silence. It received nothing, ever.
//
// The failure was invisible because PocketBase's subscribe() HANDSHAKE still succeeds
// (204) for a collection you cannot read: the store therefore reported itself 'live',
// never fell back to its poll, and the only thing refreshing anyone's board was the 60s
// heartbeat. Staff had to hard-refresh to see each other's bookings.
//
// ──────────────────────────────────────────────────────────────────────────
// HOW IT WORKS NOW
//
//   • TRANSPORT — we subscribe to geisha_pulse: one row per restaurant carrying nothing
//     but {rev, at, actor}. It is public-read precisely BECAUSE it holds no guest data, so
//     the anonymous browser client is actually delivered its events. The private
//     collections stay superuser-only; no PII ever crosses this channel. The server rings
//     it on every write (src/lib/server/booking/pulse.ts).
//
//   • THE EVENT IS ONLY A DOORBELL. We never read board data from PocketBase. A pulse just
//     means "restaurant X changed"; the page re-pulls the authoritative board from its
//     staff-gated SvelteKit loader via onChange() (invalidate('admin:diary')), which
//     resolves customer PII server-side. This was always the contract — the pulse just
//     makes it honest.
//
//   • ECHO — a board must ignore the echo of its OWN change (already applied optimistically;
//     re-pulling it causes the redraw flicker the diary spent many commits killing) while
//     never missing anyone ELSE'S. That used to be guessed from timing: "ignore everything
//     for 4s after a local action". Timing cannot tell the two apart, so a colleague's
//     booking made inside that window was dropped and never re-pulled — the bug that sent
//     staff back to the refresh button.
//
//     Now every mutating request carries this tab's id (src/lib/admin/clientId.ts), the
//     server stamps it on the pulse, and we ignore EXACTLY the pulses stamped with our own
//     id. Everything else re-pulls — including unattributed pulses (cron, the Stripe webhook,
//     an online guest booking, or two devices writing in the same coalescing window), which
//     are never provably ours. Worst case that costs one redundant re-pull; it can never
//     cost a missed change. No windows, no guessing.
//
//   • STATUS — 'live' / 'reconnecting' / 'polling' is driven by the SDK's actual connection
//     state (realtime.isConnected), NOT by "did an event arrive recently". The old version
//     inferred a drop from 8s of silence, which on a quiet board is simply... a quiet board:
//     the indicator sat on "reconnecting" permanently and nobody trusted it, which is part
//     of why a dead transport went unnoticed for so long.
//
//   • DEGRADATION — if PUBLIC_POCKETBASE_URL is unset or the subscription can't be
//     established, we fall back to a slow poll so the board still works. That path should
//     now be genuinely unreachable in a configured environment; the heartbeat re-pull stays
//     as the belt-and-braces safety net for a pulse the server never managed to ring.
// ──────────────────────────────────────────────────────────────────────────

import PocketBase, { type RecordSubscription } from 'pocketbase';
import { env as publicEnv } from '$env/dynamic/public';
import { browser } from '$app/environment';
import { CLIENT_ID } from './clientId';

/** Connection health surfaced to the page header. */
export type RealtimeStatus = 'live' | 'reconnecting' | 'polling' | 'idle';

/** The doorbell collection. Public-read, carries no guest data. */
const PULSE = 'geisha_pulse';

const POLL_MS = 20_000; // only when realtime can't be provisioned at all
const HEARTBEAT_MS = 60_000; // belt-and-braces re-pull even when "live"
const CONN_WATCH_MS = 3_000; // local (no network) check of the SDK's connection state

/** The pulse row as delivered to the browser. No guest data by construction. */
interface PulseRecord {
	id: string;
	restaurant?: string;
	rev?: number;
	at?: string;
	/** The tab that caused the change, or '' when it can't be pinned on one. */
	actor?: string;
}

interface SubscribeArgs {
	/** Restaurant record id to scope to (from the realtime-token endpoint). */
	restaurantId: string;
	/** Active service date 'YYYY-MM-DD'. */
	date: string;
	/** Called (debounced) whenever a relevant change is observed — re-pull the loader. */
	onChange: () => void;
}

/**
 * The realtime service store. Shared singleton (see `floorRealtime`), used by both
 * /admin/diary and /admin/floor. Svelte-5 runes: `status` is reactive `$state`, so a page
 * can render `{floorRealtime.status}` and it updates live.
 */
class FloorRealtime {
	/** Reactive connection status for the header indicator. */
	status = $state<RealtimeStatus>('idle');

	#pb: PocketBase | null = null;
	#unsubFns: Array<() => void> = [];
	#pollTimer: ReturnType<typeof setInterval> | null = null;
	#heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	#connTimer: ReturnType<typeof setInterval> | null = null;
	#debounceTimer: ReturnType<typeof setTimeout> | null = null;

	#args: SubscribeArgs | null = null;
	/** Last seen connection state, to spot a reconnect and catch up on what we missed. */
	#wasConnected = false;
	/** True once subscribe() has wired things up. */
	#active = false;

	/**
	 * Begin keeping the board live for one restaurant/date. Idempotent: calling it again
	 * tears down the previous subscription first (e.g. on date/brand switch). Returns a
	 * teardown fn so the page can call it from $effect/onDestroy.
	 */
	subscribe(args: SubscribeArgs): () => void {
		this.stop();
		this.#args = args;
		this.#active = true;

		if (!browser) return () => this.stop();

		const url = publicEnv.PUBLIC_POCKETBASE_URL?.trim();
		if (!url) {
			// No public URL configured — degrade to the legacy poll rather than go dark.
			this.#startPolling();
			return () => this.stop();
		}

		// Try the realtime path. Any failure cleanly falls back to polling.
		this.#attach(url).catch(() => this.#startPolling());

		// A slow heartbeat re-pull runs alongside realtime, so a pulse the server failed to
		// ring (or one that landed while we were disconnected) still surfaces within a minute.
		this.#heartbeatTimer = setInterval(() => this.#fire(), HEARTBEAT_MS);

		return () => this.stop();
	}

	/** Tear everything down (sockets, timers). Safe to call repeatedly. */
	stop(): void {
		this.#active = false;
		for (const fn of this.#unsubFns.splice(0)) {
			try {
				fn();
			} catch {
				/* ignore */
			}
		}
		try {
			this.#pb?.realtime.unsubscribe();
		} catch {
			/* ignore */
		}
		this.#pb = null;
		if (this.#pollTimer) clearInterval(this.#pollTimer);
		if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
		if (this.#connTimer) clearInterval(this.#connTimer);
		if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
		this.#pollTimer = this.#heartbeatTimer = this.#connTimer = this.#debounceTimer = null;
		this.#wasConnected = false;
		this.status = 'idle';
	}

	// --- internals -----------------------------------------------------------

	async #attach(url: string): Promise<void> {
		const pb = new PocketBase(url);
		pb.autoCancellation(false);
		this.#pb = pb;

		// One subscription, to the doorbell. PocketBase resolves this once the EventSource is
		// open and the subscription registered; a rejection bubbles to the caller's catch.
		const unsub = await pb
			.collection(PULSE)
			.subscribe<PulseRecord>('*', (e: RecordSubscription<PulseRecord>) => this.#onPulse(e));
		this.#unsubFns.push(unsub);

		this.status = 'live';
		this.#wasConnected = true;
		this.#watchConnection(pb);
	}

	/** A change happened somewhere. Decide whether it's ours, and whether it's ours to care
	 *  about, then re-pull. */
	#onPulse(e: RecordSubscription<PulseRecord>): void {
		const rec = e.record;
		if (!rec) return;

		// Scope: another brand's churn must not re-pull this board.
		const mine = this.#args?.restaurantId;
		if (mine && rec.restaurant && rec.restaurant !== mine) return;

		// An event proves the socket is alive.
		this.status = 'live';

		// OUR OWN echo: this tab made the change and already applied it optimistically.
		// This is the ONLY case we ignore — and it's a positive identification, not a guess,
		// so it cannot swallow another device's change.
		if (rec.actor && rec.actor === CLIENT_ID) return;

		this.#fire();
	}

	/** Debounced re-pull so a burst of pulses is one reload. */
	#fire(): void {
		if (!this.#active || !this.#args) return;
		if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
		this.#debounceTimer = setTimeout(() => {
			this.#args?.onChange();
		}, 120);
	}

	/** Track the SDK's REAL connection state (a local boolean — no network cost) rather than
	 *  inferring a drop from event silence. On a reconnect we re-pull once: pulses rung while
	 *  the socket was down were never delivered and are gone for good. */
	#watchConnection(pb: PocketBase): void {
		this.#connTimer = setInterval(() => {
			if (!this.#active) return;
			const connected = pb.realtime.isConnected;
			if (connected && !this.#wasConnected) {
				this.status = 'live';
				this.#fire(); // catch up on whatever we missed while we were away
			} else if (!connected && this.#wasConnected) {
				this.status = 'reconnecting'; // the SDK retries the EventSource under the hood
			}
			this.#wasConnected = connected;
		}, CONN_WATCH_MS);
	}

	#startPolling(): void {
		if (this.#pollTimer) return;
		this.status = 'polling';
		this.#pollTimer = setInterval(() => this.#fire(), POLL_MS);
	}
}

/** Shared singleton — one realtime channel per open service tab (droplet-friendly). */
export const floorRealtime = new FloorRealtime();
