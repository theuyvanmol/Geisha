/// <reference path="../pb_data/types.d.ts" />
// GROWTH: index geisha_audit_log — the one table the admin reads on every diary load
// that had NO index at all (SERVER_MIGRATION_PLAN.md, workstream E2).
//
// Measured on production, 2 Oct 2026 (PocketBase request log, last 7 days):
//   • the diary's cancellation-reason lookup (diaryDay.ts: entity + action + entity_id IN
//     the day's cancelled bookings, sort -created) ran 14,898 times and cost 701 s of
//     database time — avg 47 ms, worst 2.6 s. EXPLAIN QUERY PLAN: SCAN geisha_audit_log +
//     USE TEMP B-TREE FOR ORDER BY. Every other query on that path is indexed and scoped to
//     one day, so this was the only diary read whose cost grew with the whole database.
//   • the table is 13,458 rows / 15 MB and grows ~32 MB a year (96% of all DB growth),
//     so that scan got slower every week, forever.
//
// Every audit read in the app filters on entity_id (diary cancellations, booking history,
// the self-service amend count, the un-finish restore, diagnostics) and orders by created,
// so (entity_id, created) serves all of them. (created) serves diagnostics' time window
// and the monthly archive job planned in E3.
//
// Applied to production LIVE through the collections API (no restart), so this file is
// what a rebuilt or new server runs. Appending only missing indexes makes a re-run on a
// server that already has them a no-op.

const COLLECTION = 'geisha_audit_log';
const INDEXES = [
	'CREATE INDEX `idx_geisha_audit_entity_created` ON `geisha_audit_log` (`entity_id`, `created`)',
	'CREATE INDEX `idx_geisha_audit_created` ON `geisha_audit_log` (`created`)'
];

/** Extract the index name from a `CREATE INDEX \`name\` ...` statement. */
function indexName(sql) {
	const m = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+`?([^`\s(]+)`?/i);
	return m ? m[1] : sql;
}

migrate(
	(app) => {
		let collection;
		try {
			collection = app.findCollectionByNameOrId(COLLECTION);
		} catch {
			return; // collection absent on this instance — skip
		}
		const have = new Set((collection.indexes || []).map(indexName));
		const missing = INDEXES.filter((sql) => !have.has(indexName(sql)));
		if (!missing.length) return; // already present — no-op
		collection.indexes.push(...missing);
		app.save(collection);
	},
	(app) => {
		let collection;
		try {
			collection = app.findCollectionByNameOrId(COLLECTION);
		} catch {
			return;
		}
		const drop = new Set(INDEXES.map(indexName));
		const kept = (collection.indexes || []).filter((sql) => !drop.has(indexName(sql)));
		if (kept.length !== (collection.indexes || []).length) {
			collection.indexes = kept;
			app.save(collection);
		}
	}
);
