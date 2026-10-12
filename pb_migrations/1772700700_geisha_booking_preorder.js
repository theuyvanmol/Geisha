/// <reference path="../pb_data/types.d.ts" />

// SET-MENU / PRE-ORDER AT BOOKING — additive, back-compat.
//
// Adds ONE optional field so a booking can carry the guest's chosen set menu:
//
//   geisha_bookings += preorder (json) — { id, name, pricePence, courses?, qty? }
//                                         snapshot of the chosen set menu, or empty.
//
// The bookable set-menu CATALOGUE itself lives in a geisha_settings row
// (key 'set_menus', json) so it needs NO migration — managers CRUD it from
// /admin/settings/menus-preorder. Only the per-booking selection is a column.
//
// All optional/additive: existing rows + every reader treat a missing/empty
// `preorder` as "no pre-order". Because this migration is applied to the droplet
// manually AFTER this dev session, the feature degrades gracefully when the
// column is still absent (create.ts writes it best-effort; readers guard for it).
//
// NOTE on the filename's timestamp: an earlier 1772700700_geisha_marketing_consent_at
// migration already exists; PocketBase keys migrations by the FULL filename, so
// this distinct slug coexists with it and applies in lexical order. JSVM API only
// (new Field / app.save), mirroring 1772700600 / 1772701200. Idempotent: the add
// is guarded so a re-run (or a row that already has the field) is a no-op.

migrate(
	(app) => {
		const json = (id, name) => ({
			hidden: false,
			id,
			maxSize: 0,
			name,
			presentable: false,
			required: false,
			system: false,
			type: 'json'
		});

		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		const has = (name) => bookings.fields.find((f) => f.name === name);

		if (!has('preorder')) bookings.fields.add(new Field(json('g_b_preorder', 'preorder')));

		app.save(bookings);
	},
	(app) => {
		// Down: drop the added field if present.
		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		const f = bookings.fields.find((x) => x.name === 'preorder');
		if (f) bookings.fields.removeById(f.id);
		app.save(bookings);
	}
);
