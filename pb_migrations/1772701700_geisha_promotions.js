/// <reference path="../pb_data/types.d.ts" />

// PROMOTIONS (ResDiary "Promotions") — additive, back-compat.
//
// Adds ONE optional text field to each of two collections so bookings can carry
// a promotion + deposit rules can link one:
//
//   geisha_deposit_rules += promotion (text) — id of a promotion in
//                                               $lib/data/promotions (or empty).
//   geisha_bookings       += promotion (text) — the matched promotion's NAME,
//                                               stamped when a booking matches a
//                                               rule that links a promotion. Also
//                                               editable by staff on the diary.
//
// The promotion CATALOGUE itself (title + T&C wording + validity) is static data
// in $lib/data/promotions.ts, so it needs NO collection — only these two links
// are columns. Everything is optional/additive: existing rows and every reader
// treat a missing/empty `promotion` as "no promotion".
//
// Applied to the droplet manually AFTER this dev session; until then create.ts /
// the deposit-rule writer set the field best-effort (PocketBase drops unknown
// fields) and readers guard for it, so the feature degrades gracefully. JSVM API
// only, mirroring 1772700700_geisha_booking_preorder. Idempotent: each add is
// guarded so a re-run is a no-op.

migrate(
	(app) => {
		const text = (id, name) => ({
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

		const addField = (collectionName, fieldId, fieldName) => {
			const col = app.findCollectionByNameOrId(collectionName);
			if (!col.fields.find((f) => f.name === fieldName)) {
				col.fields.add(new Field(text(fieldId, fieldName)));
				app.save(col);
			}
		};

		addField('geisha_deposit_rules', 'g_dr_promo', 'promotion');
		addField('geisha_bookings', 'g_b_promotion', 'promotion');
	},
	(app) => {
		// Down: drop the added fields if present.
		const dropField = (collectionName, fieldName) => {
			const col = app.findCollectionByNameOrId(collectionName);
			const f = col.fields.find((x) => x.name === fieldName);
			if (f) {
				col.fields.removeById(f.id);
				app.save(col);
			}
		};

		dropField('geisha_deposit_rules', 'promotion');
		dropField('geisha_bookings', 'promotion');
	}
);
