/// <reference path="../pb_data/types.d.ts" />

// Extend geisha_floor_shapes.kind with obstacle types so the floor editor can
// model real rooms: pillars/columns, the bar/counter, generic blocked areas
// (cut-off corners, alcoves, walkways, service stations, stairs), and doors.
// These are VISUAL guides — they don't affect the booking/allocation engine.
//
// Updates the existing `select` field's allowed values in place (JSVM API).

migrate(
	(app) => {
		const col = app.findCollectionByNameOrId('geisha_floor_shapes');
		const field = col.fields.getByName('kind');
		field.values = ['wall', 'zone', 'label', 'pillar', 'bar', 'blocked', 'door'];
		app.save(col);
	},
	(app) => {
		// revert to the original set (existing rows using new kinds would become
		// invalid on validation, but unblocking a downgrade is the priority here)
		try {
			const col = app.findCollectionByNameOrId('geisha_floor_shapes');
			const field = col.fields.getByName('kind');
			field.values = ['wall', 'zone', 'label'];
			app.save(col);
		} catch (e) {
			// collection gone
		}
	}
);
