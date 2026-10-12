/// <reference path="../pb_data/types.d.ts" />

// DIARY SECTION CLOSE-OUTS — close part of the room for one service straight from the
// diary's "CloseOuts Management Console" (and by clicking a grid cell), instead of only
// being able to close a whole day or a whole service. Supports three granularities:
// a whole floor SECTION, a single TABLE, and an arbitrary TIME WINDOW within a service.
//
//   geisha_closures.scope  += 'section'   (was ['full','period'])
//   geisha_closures        += section   (text) — floor-section name (whole-section close-out)
//                          += table     (text) — a single geisha_tables id (table close-out)
//                          += time_from (text) — 'HH:mm' sub-window start (optional)
//                          += time_to   (text) — 'HH:mm' sub-window end (optional)
//
// A section-scope row reuses the existing service_period relation (which service it's
// shut for). `table` (when set) targets one table, else `section` targets a whole area.
// `time_from`/`time_to` (when both set) restrict the block to a sub-window, else it's
// the whole service. The booking engine treats the targeted table(s) as occupied for
// the window, so they can't be auto-allocated or manually seated.
//
// Additive + back-compat: existing rows are untouched, and absent fields read as ""
// everywhere. Idempotent: the select-widen and every field-add are guarded so a re-run
// is a no-op. JSVM API only, mirroring 1772701500.

migrate(
	(app) => {
		const closures = app.findCollectionByNameOrId('geisha_closures');

		// 1. widen the `scope` select to allow 'section' (keep 'full'/'period').
		const scope = closures.fields.find((f) => f.name === 'scope');
		if (scope && Array.isArray(scope.values) && !scope.values.includes('section')) {
			scope.values = [...scope.values, 'section'];
		}

		// 2. add the section-scope text fields if they aren't there yet.
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
		// Down: drop the added fields and remove 'section' from the scope values.
		const closures = app.findCollectionByNameOrId('geisha_closures');
		for (const name of ['section', 'table', 'time_from', 'time_to']) {
			const f = closures.fields.find((x) => x.name === name);
			if (f) closures.fields.removeById(f.id);
		}
		const scope = closures.fields.find((f) => f.name === 'scope');
		if (scope && Array.isArray(scope.values)) {
			scope.values = scope.values.filter((v) => v !== 'section');
		}
		app.save(closures);
	}
);
