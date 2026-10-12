// Shared `save` action body for the admin content editors. Each editor submits a
// hidden `value` field holding the whole content blob as JSON; we parse it,
// validate against the key's Zod schema, and upsert. Returns a SvelteKit
// action-style result object so editors can surface errors via use:enhance.

import { fail } from '@sveltejs/kit';
import { getContent, getContentMeta, upsertContent } from './content.js';
import { SCHEMA_BY_KEY, type ContentKey } from '$lib/content/schema';
import type { BrandId } from '../db/types.js';

const isBrand = (v: unknown): v is BrandId => v === 'asia' || v === 'fusion';

export async function saveContentAction(key: ContentKey, request: Request, url: URL) {
	const brand = url.searchParams.get('brand');
	if (!isBrand(brand)) return fail(400, { error: 'Unknown brand.' });

	const form = await request.formData();
	const raw = String(form.get('value') ?? '');

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return fail(400, { error: 'Content is not valid JSON.' });
	}

	const result = SCHEMA_BY_KEY[key].safeParse(parsed);
	if (!result.success) {
		const first = result.error.issues[0];
		const where = first?.path.join('.') || '(root)';
		return fail(400, { error: `Validation failed at ${where}: ${first?.message ?? 'invalid'}` });
	}

	// GUARD: never let a save empty a list that currently has things in it.
	//
	// Every editor holds the whole blob in a hidden field and POSTs it wholesale,
	// so anything that submits the form with an un-populated working copy replaces
	// the real content with []. That is exactly what happened when a form was
	// submitted before the page had hydrated. The editors now seed at init so this
	// shouldn't arise, but the cost of being wrong is someone's gallery, so the
	// server refuses it too. Deliberately clearing a list is still possible —
	// send allowEmpty.
	const allowEmpty = form.get('allowEmpty') === '1';
	if (!allowEmpty && Array.isArray(result.data) && result.data.length === 0) {
		const current = await getContent<unknown>(brand, key, null);
		if (Array.isArray(current) && current.length > 0) {
			return fail(409, {
				error:
					`That would delete all ${current.length} items from ${key}. If the page looks empty, ` +
					'reload it before saving — nothing has been changed.'
			});
		}
	}

	// GUARD: never let a save silently revert a save it never saw.
	//
	// Every editor holds the WHOLE blob and POSTs it wholesale, so two instances of
	// the same editor — two tabs, or one left open while work happened in another —
	// are last-writer-wins. The second save writes its own stale idea of every
	// field it didn't touch back over the first one's work, reports "Saved ✓", and
	// the losing tab goes on displaying the values it no longer has. That is
	// exactly how two menu cover photos were lost.
	//
	// So the editor sends the row's `updated` stamp from when it was seeded. If the
	// stored row has moved on since, this save is working from a stale copy and is
	// refused — reloading costs a moment; finding out weeks later which photos
	// quietly reverted does not. Editors that send no stamp keep the old behaviour.
	const baseVersion = form.get('baseVersion');
	if (typeof baseVersion === 'string') {
		const { version } = await getContentMeta(brand, key, null);
		if (version !== baseVersion) {
			return fail(409, {
				error:
					'Someone else — or another tab — has saved this since you opened it. ' +
					'Reload the page to pick up their changes, then make your edit again. ' +
					'Nothing has been changed.',
				stale: true
			});
		}
	}

	// "Apply to both" writes the same blob to Asia and Fusion. Otherwise just the
	// brand currently being edited.
	const applyBoth = form.get('both') === 'on' || form.get('both') === 'true';
	const targets: BrandId[] = applyBoth ? ['asia', 'fusion'] : [brand];
	// The stamp the editor must send with its NEXT save. Taken from the row this
	// save wrote for the brand being edited, so a second save from the same page
	// doesn't have to wait for the loader to re-run to be allowed through.
	let version = '';
	try {
		for (const t of targets) {
			const row = await upsertContent(t, key, result.data);
			if (t === brand) version = row.updated ?? '';
		}
	} catch (err) {
		// A write that throws (PocketBase unreachable / rejected the row) must NOT
		// bubble as a raw 500: the editors only render `form.error`, so an uncaught
		// throw shows neither "Saved ✓" nor a message — the change just silently
		// reverts on the next load. Surface it instead so staff know to retry.
		console.error(`[content] save failed for key=${key}:`, err);
		return fail(502, {
			error: 'Could not save — the content server did not accept the change. Please try again.'
		});
	}

	return { ok: true, appliedToBoth: applyBoth, version };
}
