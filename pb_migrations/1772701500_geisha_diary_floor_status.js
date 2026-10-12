/// <reference path="../pb_data/types.d.ts" />

// DIARY RESDIARY-PARITY (phase 4) — a transient pre-seating sub-state for the diary
// popover's left status menu ("Waiting in Bar" / "Table Ready").
//
//   geisha_bookings += floor_status (text) — '' (normal) | 'waiting_bar' | 'table_ready'
//
// The arrival status the grid colours by is otherwise DERIVED (seated/cleared via
// floor_state + the clock). "Waiting in bar" and "table ready" are host-set holding
// states that have no seated/cleared signal of their own, so they need a stored flag
// that survives a refresh. It only applies BEFORE the party is seated — seating,
// clearing or no-showing the booking clears it (the diary action does this), and the
// derive function ignores it once the booking is seated/left/no-show.
//
// Additive + back-compat: an absent/empty value reads as "normal" everywhere, so the
// feature degrades gracefully pre-migration. JSVM API only, mirroring 1772701400.
// Idempotent: the add is guarded so a re-run is a no-op.

migrate(
	(app) => {
		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		const has = (name) => bookings.fields.find((f) => f.name === name);

		if (!has('floor_status')) {
			bookings.fields.add(
				new Field({
					hidden: false,
					id: 'g_b_floor_status',
					name: 'floor_status',
					presentable: false,
					required: false,
					system: false,
					type: 'text',
					max: 0,
					min: 0,
					pattern: ''
				})
			);
		}

		app.save(bookings);
	},
	(app) => {
		// Down: drop the added field if present.
		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		const f = bookings.fields.find((x) => x.name === 'floor_status');
		if (f) bookings.fields.removeById(f.id);
		app.save(bookings);
	}
);
