// Optimistic form-action enhancer for the admin.
//
// WHY THIS EXISTS
// ───────────────
// Every admin mutation used SvelteKit's *default* `use:enhance`, whose `update()`
// runs `invalidateAll()` — re-running every loader on the page — and keeps the form
// "in flight" until that whole round-trip lands. So one button press = the write
// round-trip PLUS a full re-load before anything moves on screen. On the heavier
// pages (floor, bookings) that reads as lag.
//
// This helper flips the order: apply the change to local UI *immediately*, fire the
// write in the BACKGROUND, and only reconcile (or revert) when the server answers.
// It generalises the hand-rolled pattern already in /admin/+page.svelte's
// `dismissAlert` (optimistic remove → background fetch → restore on failure).
//
// USAGE
// ─────
//   <form method="POST" action="?/toggleVip" use:enhance={optimistic({
//     apply: () => { const undo = () => (vip = vip); vip = !vip; return undo; },
//     // optional — runs after a successful server round-trip (loaders refreshed):
//     done:  () => {},
//     // optional — message shown to the user on failure (default: generic):
//     onError: (msg) => (errMsg = msg),
//     // optional — set false to NOT re-pull loaders after success (pure-optimistic):
//     revalidate: true,
//   })}>
//
// `apply` MUST return an undo function that restores the pre-action UI state; it is
// invoked if the server rejects the write so the screen snaps back to truth.
//
// CONTRACT
// ────────
// • `apply()` runs synchronously the instant the form submits — before any network.
// • On success: by default `update()` runs (loaders refresh) so the optimistic
//   state is replaced by authoritative data; this happens in the background and the
//   user already saw the change, so there is no perceived wait. Then `done()` fires.
// • On `failure`/`error`: `undo()` restores state and `onError(message)` is called.
// • A SvelteKit `redirect` result is left to the default handler (we don't undo).

import { applyAction } from '$app/forms';

type SubmitResult =
	| { type: 'success'; status: number; data?: Record<string, unknown> }
	| { type: 'failure'; status: number; data?: Record<string, unknown> }
	| { type: 'redirect'; status: number; location: string }
	| { type: 'error'; status?: number; error: unknown };

export interface OptimisticOptions {
	/** Apply the optimistic change now; return a function that undoes it. */
	apply: () => (() => void) | void;
	/** Runs after a successful, reconciled write. */
	done?: (data?: Record<string, unknown>) => void;
	/** User-facing failure message handler. */
	onError?: (message: string) => void;
	/** Re-run loaders after success to reconcile (default true). */
	revalidate?: boolean;
}

const DEFAULT_ERROR = 'That action could not be completed.';

export function optimistic(opts: OptimisticOptions) {
	// SvelteKit's enhance submit function: runs on submit, returns the result handler.
	return () => {
		const undo = opts.apply() ?? (() => {});

		return async ({
			result,
			update
		}: {
			result: SubmitResult;
			update: (o?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void>;
		}) => {
			if (result.type === 'redirect') {
				// Let SvelteKit perform the navigation; nothing to undo.
				await applyAction(result);
				return;
			}
			if (result.type === 'failure' || result.type === 'error') {
				undo();
				const msg =
					result.type === 'failure'
						? String((result.data as { error?: string })?.error ?? DEFAULT_ERROR)
						: DEFAULT_ERROR;
				opts.onError?.(msg);
				return;
			}
			// Success. The user already saw the optimistic change; reconcile in the
			// background (no visible wait) so server-derived fields land, unless the
			// caller opted out for a purely client-owned piece of state.
			if (opts.revalidate !== false) {
				// Don't reset form fields — admin forms keep their values (filters,
				// editor panels) across a save.
				await update({ reset: false });
			}
			opts.done?.(result.data);
		};
	};
}

/**
 * Fire-and-forget a form action WITHOUT a <form> — for plain buttons that mutate
 * idempotent state (alert dismiss, mark-read). Applies the optimistic change, posts
 * in the background, and reverts on failure. Mirrors `dismissAlert`'s shape so those
 * call sites can share one code path.
 */
export async function postAction(
	action: string,
	body: Record<string, string>,
	opts: { apply: () => (() => void) | void; onError?: (message: string) => void }
): Promise<void> {
	const undo = opts.apply() ?? (() => {});
	try {
		const res = await fetch(action, { method: 'POST', body: new URLSearchParams(body) });
		if (!res.ok) {
			undo();
			opts.onError?.(DEFAULT_ERROR);
		}
	} catch {
		undo();
		opts.onError?.(DEFAULT_ERROR);
	}
}
