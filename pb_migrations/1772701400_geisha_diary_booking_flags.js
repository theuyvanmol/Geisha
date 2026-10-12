/// <reference path="../pb_data/types.d.ts" />

// DIARY RESDIARY-PARITY (phase 1) — two optional booking flags for the diary grid.
//
//   geisha_bookings += confirmed     (bool) — staff/guest explicitly confirmed the
//                                              booking (drives the Confirmation colour
//                                              scheme; ≠ booking.status).
//   geisha_bookings += seen_by_staff (bool) — the "new booking" bell has been
//                                              acknowledged for this booking, so it
//                                              stops ringing on the grid.
//
// Both additive + back-compat: every reader treats a missing/false value as
// "unconfirmed" / "still new", so the feature degrades gracefully when the column
// is still absent. JSVM API only (new Field / app.save), mirroring 1772700700.
// Idempotent: each add is guarded so a re-run (or a row that already has the field)
// is a no-op.

migrate(
	(app) => {
		const bool = (id, name) => ({
			hidden: false,
			id,
			name,
			presentable: false,
			required: false,
			system: false,
			type: 'bool'
		});

		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		const has = (name) => bookings.fields.find((f) => f.name === name);

		if (!has('confirmed')) bookings.fields.add(new Field(bool('g_b_confirmed', 'confirmed')));
		if (!has('seen_by_staff'))
			bookings.fields.add(new Field(bool('g_b_seen_by_staff', 'seen_by_staff')));

		app.save(bookings);
	},
	(app) => {
		// Down: drop the added fields if present.
		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		for (const name of ['confirmed', 'seen_by_staff']) {
			const f = bookings.fields.find((x) => x.name === name);
			if (f) bookings.fields.removeById(f.id);
		}
		app.save(bookings);
	}
);
