// Robust SvelteKit form-action POST for the service views (Floor ↔ Diary parity).
//
// Both the diary and the floor fire named form actions (?/seat, ?/cancel, ?/create…)
// from JS and must handle the FULL result space — 'success' | 'failure' | 'error' |
// 'redirect' | network-throw — not just 'failure'. The diary learned this the hard
// way: a thrown 500 came back as type:'error' and, when only 'failure' was checked,
// was mis-read as success — the optimistic change silently un-happened on the next
// reload with no toast. This helper centralises that classification so neither view
// can regress it.
//
// It intentionally does NOT know about optimistic patching, realtime echo-guards or
// reconcile scheduling — those are legitimately view-specific (the diary patches bar
// objects; the floor patches tiles). The caller wires those around this call. What's
// shared, and worth one source of truth, is the fetch + deserialize + result triage.

import { deserialize } from '$app/forms';
import { withClientId } from '$lib/admin/clientId';
import { connection } from '$lib/admin/connection.svelte';

export interface ServiceActionResult {
	ok: boolean;
	/** the action's returned data on success (e.g. { version, startsAt, … }). */
	data?: Record<string, unknown>;
	/** a human message on failure, ready to drop into a toast. */
	error?: string;
}

type RawResult =
	| { type: 'success'; data?: Record<string, unknown> }
	| { type: 'failure'; data?: { error?: string } }
	| { type: 'error'; error?: { message?: string } }
	| { type: 'redirect' };

/**
 * POST a named form action and classify the result. `query` is appended to the
 * `?/action` URL (e.g. `brand=asia&date=2026-07-06`). `fields` become the FormData.
 *
 * Returns `{ ok:false, error }` for EVERY non-success outcome (failure/error/redirect/
 * network) with a caller-surfaceable message, and `{ ok:true, data }` only on a clean
 * success. The caller reverts its optimistic patch whenever `ok` is false.
 */
export async function postServiceAction(
	action: string,
	query: string,
	fields: Record<string, string>
): Promise<ServiceActionResult> {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);

	let result: RawResult;
	try {
		const q = query ? `&${query}` : '';
		const res = await fetch(`?/${action}${q}`, {
			method: 'POST',
			// Identifies the acting tab so the realtime store can ignore the echo of this
			// very write while still re-pulling every other device's changes.
			headers: withClientId({ 'x-sveltekit-action': 'true' }),
			body: fd
		});
		result = deserialize(await res.text()) as RawResult;
		// We just proved the server is reachable — cheapest possible signal that the
		// line is healthy, so the offline banner clears itself without a probe.
		connection.reportSuccess();
	} catch {
		// A THROWN fetch is the signal that matters: the request never reached the
		// server. Tell the connection store so the shell can put up the honest
		// "this screen is not updating" banner instead of leaving the board looking
		// live with one silently-failed change on it. Deliberately not called for a
		// 4xx/5xx — those reached the server and mean something else entirely.
		connection.reportFailure();
		return { ok: false, error: 'Network problem — the change was not saved.' };
	}

	switch (result.type) {
		case 'success':
			return { ok: true, data: result.data };
		case 'failure':
			return { ok: false, error: String(result.data?.error ?? 'Action failed.') };
		case 'error':
			return {
				ok: false,
				error: String(result.error?.message ?? 'Something went wrong saving that.')
			};
		case 'redirect':
			return { ok: false, error: 'Your session expired — please sign in again.' };
	}
}
