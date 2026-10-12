/// <reference path="../pb_data/types.d.ts" />
// PERF: add the missing indexes on the collections the admin diary reads on EVERY
// load and every seat/clear/move write. Without these, PocketBase full-scans the
// collection for each of these filters — invisible on a tiny dev DB, but a real
// cost on the shared 1GB droplet under service load.
//
// Confirmed missing (audited across all prior migrations):
//   • geisha_floor_state — ZERO indexes. Read on every diary/floor load
//     (filter: booking=x || booking=y …) and every seat/clear (booking=x && table=y),
//     plus the 60-day turn-samples scan (seated_at range + cleared_at).
//   • geisha_payments   — ZERO indexes. Read on every diary load (Payment colour
//     scheme) and per-booking payment lookups (filter: booking=x).
//   • geisha_bookings   — has (restaurant, starts_at) + a near-useless standalone
//     (status). The occupancy hot path filters restaurant + starts_at range + status,
//     so a composite (restaurant, starts_at, status) fully covers it.
//   • geisha_closures   — has (restaurant, date_from) but the diary also filters
//     restaurant + scope="section" twice per load; add (restaurant, scope).
//
// Each index is appended only if an index of that name isn't already present, so a
// re-run (or a droplet that already has some) is a safe no-op. Down-migration drops
// the ones we added.

const ADDITIONS = [
	{
		collection: 'geisha_floor_state',
		indexes: [
			'CREATE INDEX `idx_geisha_floor_state_booking` ON `geisha_floor_state` (`booking`)',
			'CREATE INDEX `idx_geisha_floor_state_seated` ON `geisha_floor_state` (`seated_at`, `cleared_at`)'
		]
	},
	{
		collection: 'geisha_payments',
		indexes: ['CREATE INDEX `idx_geisha_payments_booking` ON `geisha_payments` (`booking`)']
	},
	{
		collection: 'geisha_bookings',
		indexes: [
			'CREATE INDEX `idx_geisha_bookings_rest_start_status` ON `geisha_bookings` (`restaurant`, `starts_at`, `status`)'
		]
	},
	{
		collection: 'geisha_closures',
		indexes: [
			'CREATE INDEX `idx_geisha_closures_rest_scope` ON `geisha_closures` (`restaurant`, `scope`)'
		]
	}
];

/** Extract the index name from a `CREATE INDEX \`name\` ...` statement. */
function indexName(sql) {
	const m = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+`?([^`\s(]+)`?/i);
	return m ? m[1] : sql;
}

migrate(
	(app) => {
		for (const add of ADDITIONS) {
			let collection;
			try {
				collection = app.findCollectionByNameOrId(add.collection);
			} catch {
				continue; // collection absent on this instance — skip
			}
			const have = new Set((collection.indexes || []).map(indexName));
			let changed = false;
			for (const sql of add.indexes) {
				if (have.has(indexName(sql))) continue; // already present — no-op
				collection.indexes.push(sql);
				changed = true;
			}
			if (changed) app.save(collection);
		}
	},
	(app) => {
		for (const add of ADDITIONS) {
			let collection;
			try {
				collection = app.findCollectionByNameOrId(add.collection);
			} catch {
				continue;
			}
			const drop = new Set(add.indexes.map(indexName));
			const kept = (collection.indexes || []).filter((sql) => !drop.has(indexName(sql)));
			if (kept.length !== (collection.indexes || []).length) {
				collection.indexes = kept;
				app.save(collection);
			}
		}
	}
);
