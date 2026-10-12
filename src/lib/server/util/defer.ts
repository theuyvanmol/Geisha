// deferWork — run a best-effort side-effect WITHOUT blocking the response.
//
// The booking write path (create / amend / swap / batch) does several best-effort
// things AFTER the row is written: the confirmation email, allergy-flag denorm,
// and the audit row. None of them affect the result the user sees, yet they were
// all `await`ed before the action returned — so on the Vercel→London round-trip
// they added ~5+ serial network hops (~450ms+) to every mutation for work the
// user never waits on.
//
// This helper moves them off the critical path:
//   • On Vercel serverless, a promise that isn't awaited can be KILLED when the
//     response is sent. `waitUntil()` (from @vercel/functions) tells the platform
//     to keep the function alive until the promise settles — the correct way to
//     run post-response work. It reads the current request context from async
//     local storage, so we don't have to thread the request `event` through every
//     booking helper.
//   • Outside a request context (cron sweeps, local `vite dev`, unit tests) there
//     is no waitUntil context; the call throws, and we fall back to running the
//     promise un-awaited. That's safe there because those processes are long-lived
//     (dev server / node) and won't be frozen mid-flight the way a serverless
//     invocation is.
//
// The work is ALWAYS wrapped so a rejection can never surface as an unhandled
// promise rejection — every deferred task is best-effort by contract.

import { waitUntil } from '@vercel/functions';

// In-flight deferred tasks, for {@link flushDeferred} (tests only). We keep a live
// set so a test can await the side-effects that production intentionally fires
// after the response — without this, a test would assert the audit/email BEFORE
// the deferred write lands and flake. Never used on the request path.
const _inFlight = new Set<Promise<unknown>>();

/**
 * Schedule best-effort work to run after the current response is sent, without
 * blocking it. Never throws; a rejection in `work` is swallowed (logged) since
 * every caller is best-effort. Pass a thunk so the promise is created lazily
 * inside the guard.
 */
export function deferWork(work: () => Promise<unknown>, label = 'deferred'): void {
	const run = Promise.resolve()
		.then(work)
		.catch((err) => {
			console.error(`[defer] ${label} failed:`, err);
		})
		.finally(() => {
			_inFlight.delete(run);
		});
	_inFlight.add(run);
	try {
		// Keep the serverless function alive until `run` settles (Vercel). Throws
		// when there's no request context (cron / dev / test) — see fallback below.
		waitUntil(run);
	} catch {
		// No waitUntil context: let `run` continue un-awaited. It already has its own
		// .catch(), so this can't become an unhandled rejection.
		void run;
	}
}

/**
 * TEST-ONLY: await every deferred task scheduled so far (and any they schedule as
 * they run). Production code never calls this — it exists so unit tests can assert
 * on side-effects (audit rows, emails) that {@link deferWork} deliberately runs
 * after the response instead of inline. Loops until the in-flight set drains so a
 * deferred task that itself defers is also awaited.
 */
export async function flushDeferred(): Promise<void> {
	while (_inFlight.size) {
		await Promise.allSettled([..._inFlight]);
	}
}
