/// <reference path="../pb_data/types.d.ts" />

// GEISHA_CLOSURES slot fields — REPAIR migration.
//
// 1772701600_geisha_section_closeouts was first deployed (2026-07-01) in a version that
// only added the `section` field + widened the `scope` select to include 'section'. The
// migration file was LATER expanded to also add `table`, `time_from`, `time_to` — but
// `migrate up` never re-runs an already-applied migration id, so on the (single, shared)
// pmm droplet those three columns were never created. Result: individual-table / time-slot
// close-outs (and the diary's on-grid RED close-out overlays for them) saved successfully
// but PocketBase silently dropped the unknown fields, so they came back empty and never
// rendered. Confirmed live 2026-07-23.
//
// This migration adds ONLY the missing fields, with the SAME field ids 1772701600 uses, so
// the two are consistent. Fully idempotent + additive: every add is guarded, and it also
// re-asserts 'section' in the scope select (a no-op where 1772701600 already did it). Safe
// to run anywhere — on an instance that already has all four fields it's a complete no-op.
// See memory geisha2-diary-section-closeouts.

migrate(
	(app) => {
		let closures;
		try {
			closures = app.findCollectionByNameOrId('geisha_closures');
		} catch {
			return; // collection not present on this instance — nothing to repair
		}
		if (!closures) return;

		// Re-assert 'section' in the scope select (idempotent).
		const scope = closures.fields.find((f) => f.name === 'scope');
		if (scope && Array.isArray(scope.values) && !scope.values.includes('section')) {
			scope.values = [...scope.values, 'section'];
		}

		const textField = (id, name) => ({
			autogeneratePattern: '',
			hidden: false,
			id,
			max: 0,
			min: 0,
			name,
			pattern: '',
			presentable: false,
			primaryKey: false,
			required: false,
			system: false,
			type: 'text'
		});
		const addIfMissing = (id, name) => {
			if (!closures.fields.find((f) => f.name === name)) {
				closures.fields.add(new Field(textField(id, name)));
			}
		};
		addIfMissing('g_cl_section', 'section');
		addIfMissing('g_cl_table', 'table');
		addIfMissing('g_cl_time_from', 'time_from');
		addIfMissing('g_cl_time_to', 'time_to');

		app.save(closures);
	},
	(app) => {
		// Down: drop only the table/time sub-window fields this repair is responsible for.
		// Leave `section` and the scope value alone — those belong to 1772701600.
		let closures;
		try {
			closures = app.findCollectionByNameOrId('geisha_closures');
		} catch {
			return;
		}
		if (!closures) return;
		for (const name of ['table', 'time_from', 'time_to']) {
			const f = closures.fields.find((x) => x.name === name);
			if (f) closures.fields.removeById(f.id);
		}
		app.save(closures);
	}
);
