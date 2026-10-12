// Is this device actually able to reach the server right now?
//
// WHY navigator.onLine IS NOT ENOUGH
// ─────────────────────────────────
// `navigator.onLine` answers "does this machine have a network interface with a
// route", not "can I reach the app". A till connected to the restaurant's wifi
// while the broadband is down reports ONLINE, which is precisely the situation this
// store exists for. Captive portals, a dead 4G failover, and the droplet itself
// being down all look identical to it.
//
// So `offline` is driven by two signals:
//   • the browser events, which are instant and free but only ever trustworthy in
//     the NEGATIVE direction (offline really does mean offline), and
//   • an actual reachability probe against our own origin, which is the only thing
//     that can confirm the positive.
//
// The probe only runs when there is reason to think something is wrong — a failed
// request reported via `reportFailure()`, or an `online` event we want to verify —
// never on a timer while everything is fine. A restaurant's board should not be
// generating background traffic all evening to tell itself what it already knows.

import { browser } from '$app/environment';

/** How long to wait for the probe before calling it dead. Short: on a working line
 *  this is a sub-100ms request, and staff need the banner to be quick to be trusted. */
const PROBE_TIMEOUT_MS = 4000;

/** Don't probe more often than this, however many failures come in at once. */
const PROBE_COOLDOWN_MS = 5000;

class Connection {
	/** True when we believe the server is unreachable. Drives the admin banner. */
	offline = $state(false);
	/** When we last successfully reached the server. 0 until the first success. */
	lastSeen = $state(0);
	/** True while a reachability probe is in flight (the banner shows "checking…"). */
	checking = $state(false);

	#lastProbe = 0;
	#started = false;

	/** Wire up the browser events. Idempotent; called once from the admin shell. */
	start() {
		if (!browser || this.#started) return;
		this.#started = true;

		// A hard offline event is believed immediately — it is never a false positive.
		addEventListener('offline', () => {
			this.offline = true;
		});
		// An online event is only a HINT that it might be worth re-checking.
		addEventListener('online', () => void this.probe(true));

		if (!navigator.onLine) this.offline = true;
		else this.lastSeen = Date.now();
	}

	/**
	 * Tell the store a request just failed in a way that smells like a dead line.
	 * Call sites pass their own judgement — a 404 is not a connectivity problem, a
	 * thrown fetch is. Triggers a probe rather than flipping the flag directly, so a
	 * single unlucky request can't put a false OFFLINE banner over a working board.
	 */
	reportFailure() {
		void this.probe(false);
	}

	/** Tell the store a request just succeeded. Cheapest possible positive signal —
	 *  no probe needed, because we have just proved reachability for free. */
	reportSuccess() {
		this.lastSeen = Date.now();
		if (this.offline) this.offline = false;
	}

	/** Ask the server whether it is there. `force` bypasses the cooldown. */
	async probe(force: boolean): Promise<boolean> {
		if (!browser) return true;
		const now = Date.now();
		if (!force && now - this.#lastProbe < PROBE_COOLDOWN_MS) return !this.offline;
		this.#lastProbe = now;

		this.checking = true;
		try {
			const ctl = new AbortController();
			const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
			try {
				// Our own origin, cache-busted, and a HEAD so it costs essentially
				// nothing. `cache: 'no-store'` matters: a cached 200 from the service
				// worker would otherwise report a dead server as healthy.
				const res = await fetch(`/api/health?t=${now}`, {
					method: 'HEAD',
					cache: 'no-store',
					signal: ctl.signal
				});
				const ok = res.ok || res.status === 405; // 405 still proves we reached it
				this.offline = !ok;
				if (ok) this.lastSeen = Date.now();
				return ok;
			} finally {
				clearTimeout(timer);
			}
		} catch {
			this.offline = true;
			return false;
		} finally {
			this.checking = false;
		}
	}
}

export const connection = new Connection();
