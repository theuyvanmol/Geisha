// Coverage for the shared content save action — specifically the stale-write
// guard, which exists because of a real loss of data.
//
// Every content editor holds the WHOLE blob in a hidden field and POSTs it
// wholesale. Two instances of the same editor (two tabs, or one left open while
// work happened in the other) were therefore last-writer-wins: the second save
// wrote its own stale idea of every field it hadn't touched back over the first
// one's work, said "Saved ✓", and the losing tab carried on displaying values it
// no longer had. That is how two menu cover photos were reverted — the audit log
// showed one save setting them and a later one blanking them again.
//
// The properties pinned here:
//   1. A save whose baseVersion no longer matches the stored row is REFUSED, and
//      writes nothing.
//   2. A save whose baseVersion matches goes through and hands back the new
//      stamp, so the same page can save again immediately.
//   3. An editor that sends no baseVersion keeps the old behaviour.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- mocks ------------------------------------------------------------------

/** The stored row, as getContentMeta / upsertContent see it. */
let stored: { value: unknown; version: string } = { value: null, version: '' };
const writes: Array<{ brand: string; key: string; value: unknown }> = [];

vi.mock('./content.js', () => ({
	getContent: async (_brand: string, _key: string, fallback: unknown) =>
		stored.value ?? fallback,
	getContentMeta: async (_brand: string, _key: string, fallback: unknown) => ({
		value: stored.value ?? fallback,
		version: stored.version
	}),
	upsertContent: async (brand: string, key: string, value: unknown) => {
		writes.push({ brand, key, value });
		// Each write moves the row on, exactly as PocketBase's `updated` does.
		stored = { value, version: `v${writes.length}` };
		return { id: 'row1', created: '', updated: stored.version, restaurant: '', key, value };
	}
}));

const { saveContentAction } = await import('./save.js');

// --- helpers ----------------------------------------------------------------

const MENUS = (coverA?: string) => [
	{
		slug: 'main',
		title: 'Main Menu',
		...(coverA ? { img: coverA } : {}),
		sections: [{ title: 'Starters', items: [{ name: 'Edamame' }] }]
	}
];

function save(value: unknown, extra: Record<string, string> = {}) {
	const form = new FormData();
	form.set('value', JSON.stringify(value));
	for (const [k, v] of Object.entries(extra)) form.set(k, v);
	return saveContentAction(
		'menus',
		new Request('http://localhost/admin/content/menus', { method: 'POST', body: form }),
		new URL('http://localhost/admin/content/menus?brand=asia')
	);
}

beforeEach(() => {
	stored = { value: null, version: '' };
	writes.length = 0;
});

// --- the stale-write guard --------------------------------------------------

describe('saveContentAction — stale-write guard', () => {
	it('refuses a save whose base version has been overtaken, and writes nothing', async () => {
		// Tab A and tab B both seeded at ''. Tab A saves a cover photo.
		const first = await save(MENUS('/cover-a.jpg'), { baseVersion: '' });
		expect(first).toMatchObject({ ok: true, version: 'v1' });

		// Tab B, still holding its pre-A copy, now saves its own edit. Left
		// unguarded this is the exact write that blanked two cover photos.
		const second = await save(MENUS(), { baseVersion: '' });

		expect(second).toMatchObject({ status: 409, data: { stale: true } });
		expect(writes).toHaveLength(1); // tab A's write is the only one
		expect(stored.value).toEqual(MENUS('/cover-a.jpg')); // the cover survives
	});

	it('lets a save through when its base version still matches', async () => {
		await save(MENUS('/cover-a.jpg'), { baseVersion: '' });
		const next = await save(MENUS('/cover-b.jpg'), { baseVersion: 'v1' });

		expect(next).toMatchObject({ ok: true, version: 'v2' });
		expect(stored.value).toEqual(MENUS('/cover-b.jpg'));
	});

	it('hands back the new stamp so the same page can save twice in a row', async () => {
		// Without this the second save from one page would look like a stale tab.
		const a = (await save(MENUS('/1.jpg'), { baseVersion: '' })) as { version: string };
		const b = (await save(MENUS('/2.jpg'), { baseVersion: a.version })) as { version: string };
		const c = await save(MENUS('/3.jpg'), { baseVersion: b.version });

		expect(c).toMatchObject({ ok: true });
		expect(writes).toHaveLength(3);
	});

	it('leaves editors that send no base version working as before', async () => {
		await save(MENUS('/cover-a.jpg'), { baseVersion: '' });
		const legacy = await save(MENUS()); // no baseVersion field at all

		expect(legacy).toMatchObject({ ok: true });
		expect(writes).toHaveLength(2);
	});

	it('treats a first-ever save (no stored row) as current', async () => {
		const first = await save(MENUS('/cover-a.jpg'), { baseVersion: '' });
		expect(first).toMatchObject({ ok: true });
	});
});

// --- the pre-existing guards still hold -------------------------------------

describe('saveContentAction — existing guards', () => {
	it('still refuses to empty a list that has things in it', async () => {
		await save(MENUS('/cover-a.jpg'), { baseVersion: '' });
		const wipe = await save([], { baseVersion: 'v1' });

		expect(wipe).toMatchObject({ status: 409 });
		expect(writes).toHaveLength(1);
	});

	it('still allows a deliberate clear via allowEmpty', async () => {
		await save(MENUS('/cover-a.jpg'), { baseVersion: '' });
		const wipe = await save([], { baseVersion: 'v1', allowEmpty: '1' });

		expect(wipe).toMatchObject({ ok: true });
		expect(stored.value).toEqual([]);
	});

	it('still rejects content that fails the key schema', async () => {
		const bad = await save([{ slug: 'NOT KEBAB', title: 'x', sections: [] }], {
			baseVersion: ''
		});

		expect(bad).toMatchObject({ status: 400 });
		expect(writes).toHaveLength(0);
	});
});
