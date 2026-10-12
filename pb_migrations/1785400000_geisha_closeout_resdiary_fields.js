/// <reference path="../pb_data/types.d.ts" />

// GEISHA_CLOSURES — ResDiary "Close-Out" parity fields.
//
// The owner asked the close-outs manager to match ResDiary's "Add New Period" form exactly.
// ResDiary carries four fields our closure rows didn't yet store:
//   • name         — a short label for the close-out (ResDiary "Name"; our old `reason` is
//                    reused as ResDiary's "Description").
//   • days_of_week — json [0..6] (0=Sun). Empty = every day in the range (a one-off / manual
//                    close-out). Non-empty = a PERIODIC close-out that only bites on those
//                    weekdays inside [date_from, date_to] (ResDiary "Periodic" mode).
//   • channel_type — 'common' | 'internal' | 'online'. Which booking channel the close-out
//                    blocks (ResDiary "Type": Common = both, Internal = in-house only, Online
//                    = web only). Default 'common'.
//   • colour       — hex string for the block's colour on the diary (ResDiary "Colour").
//
// Fully idempotent + additive: every add is guarded, so it's a no-op on an instance that
// already has the fields. Safe to run anywhere.

migrate(
	(app) => {
		let closures;
		try {
			closures = app.findCollectionByNameOrId('geisha_closures');
		} catch {
			return; // collection not present on this instance — nothing to add
		}
		if (!closures) return;

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
		const jsonField = (id, name) => ({
			hidden: false,
			id,
			maxSize: 2000000,
			name,
			presentable: false,
			required: false,
			system: false,
			type: 'json'
		});
		const add = (field) => {
			if (!closures.fields.find((f) => f.name === field.name)) {
				closures.fields.add(new Field(field));
			}
		};
		add(textField('g_cl_name', 'name'));
		add(jsonField('g_cl_dow', 'days_of_week'));
		add(textField('g_cl_channel', 'channel_type'));
		add(textField('g_cl_colour', 'colour'));

		app.save(closures);
	},
	(app) => {
		let closures;
		try {
			closures = app.findCollectionByNameOrId('geisha_closures');
		} catch {
			return;
		}
		if (!closures) return;
		for (const name of ['name', 'days_of_week', 'channel_type', 'colour']) {
			const f = closures.fields.find((x) => x.name === name);
			if (f) closures.fields.removeById(f.id);
		}
		app.save(closures);
	}
);
