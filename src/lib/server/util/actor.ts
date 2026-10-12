// REQUEST ACTOR — which browser tab is behind the write currently being executed.
//
// The pulse writer (src/lib/server/booking/pulse.ts) runs deep inside the PocketBase
// client's afterSend hook, far from the request handler, and needs to stamp the pulse row
// with the tab that caused the change so that tab can ignore its own echo. Threading a
// client id through every booking helper's signature would touch the entire mutation
// surface for one diagnostic string, so we hang it off the request context instead —
// exactly how src/lib/server/util/defer.ts gets at Vercel's waitUntil.
//
// AsyncLocalStorage propagates through every await in the request, so a write triggered
// from a load, an action, an API route or the AI agent all see the right actor. Outside a
// request (cron sweeps, tests) it's simply empty — an unattributed pulse, which every
// board treats as "someone else changed something" and re-pulls. Safe default: a missing
// actor costs one redundant re-pull, never a missed change.

import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<string>();

/** Run `fn` with `clientId` as the acting tab for everything it awaits. */
export function runWithActor<T>(clientId: string, fn: () => T): T {
	return store.run(clientId, fn);
}

/** The acting tab's id, or '' outside a request / when the caller sent no id. */
export function currentActor(): string {
	return store.getStore() ?? '';
}
