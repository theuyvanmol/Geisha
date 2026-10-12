// Push src/lib/data/menus.*.ts into the geisha_content `menus` override rows.
//
// WHY THIS EXISTS: the public menu pages read
// `getContent(brand,'menus', getMenus(brand))`, and BOTH brands now have an
// override row — so editing the static data files alone changes nothing on the
// live site. (That used to be true of Fusion only; Asia grew an override on
// 2026-07-31.) This is the one command that makes the repo and the site agree.
//
// It preserves each stored menu's admin-chosen cover `img`, which is set in the
// admin Menus editor and exists nowhere in the repo — overwriting the blob
// without merging it back is how a pair of cover photos got lost before.
//
// Run:  npx vite-node scripts/sync-menus-to-db.ts -- [--dry] [--brand=asia|fusion]
// Always writes a timestamped backup of the current rows first.
import PocketBase from 'pocketbase';
import fs from 'node:fs';
import path from 'node:path';
import { ASIA_MENUS } from '../src/lib/data/menus.asia';
import { FUSION_MENUS } from '../src/lib/data/menus.fusion';
import type { Menu } from '../src/lib/data/menu-types';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const onlyBrand = args.find((a) => a.startsWith('--brand='))?.split('=')[1];

const env = Object.fromEntries(
	fs
		.readFileSync('.env', 'utf8')
		.split('\n')
		.filter((l) => l.includes('=') && !l.trim().startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
		})
);

const pb = new PocketBase(env.POCKETBASE_URL);
await pb
	.collection('_superusers')
	.authWithPassword(env.POCKETBASE_ADMIN_EMAIL!, env.POCKETBASE_ADMIN_PASSWORD!);

const SOURCE: Record<string, Menu[]> = { asia: ASIA_MENUS, fusion: FUSION_MENUS };

const rests = await pb.collection('geisha_restaurants').getFullList();
const rows = await pb.collection('geisha_content').getFullList({ filter: 'key="menus"' });

// Backup BEFORE touching anything.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join('scripts', 'menu-backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `menus-${stamp}.json`);
fs.writeFileSync(
	backupFile,
	JSON.stringify(
		rows.map((r) => ({
			id: r.id,
			restaurant: r.restaurant,
			brand: rests.find((x) => x.id === r.restaurant)?.brand,
			updated: r.updated,
			value: r.value
		})),
		null,
		1
	)
);
console.log(`backup → ${backupFile}`);

for (const [brand, menus] of Object.entries(SOURCE)) {
	if (onlyBrand && onlyBrand !== brand) continue;
	const rest = rests.find((x) => x.brand === brand);
	if (!rest) {
		console.error(`! no restaurant row for ${brand}`);
		continue;
	}
	const row = rows.find((r) => r.restaurant === rest.id);
	const stored: Menu[] = Array.isArray(row?.value) ? row.value : [];

	// Repo data wins for everything EXCEPT the cover photo, which only exists in
	// the DB (staff pick it in the admin and it is never written back to the repo).
	const merged = menus.map((m) => {
		const prev = stored.find((s) => s.slug === m.slug);
		return prev?.img ? { ...m, img: prev.img } : m;
	});

	const before = stored.reduce(
		(n, m) => n + (m.sections ?? []).reduce((k, s) => k + (s.items?.length ?? 0), 0),
		0
	);
	const after = merged.reduce(
		(n, m) => n + (m.sections ?? []).reduce((k, s) => k + (s.items?.length ?? 0), 0),
		0
	);
	const keptCovers = merged.filter((m) => m.img).length;
	console.log(
		`${brand}: ${stored.length}→${merged.length} menus, ${before}→${after} items, ${keptCovers} covers preserved`
	);

	if (DRY) continue;
	if (row) await pb.collection('geisha_content').update(row.id, { value: merged });
	else
		await pb
			.collection('geisha_content')
			.create({ restaurant: rest.id, key: 'menus', value: merged });
	console.log(`  ✓ written`);
}

console.log(DRY ? '\ndry run — nothing written' : '\ndone');
