/// <reference path="../pb_data/types.d.ts" />

// Add `created` / `updated` autodate fields to every geisha_* collection.
// PocketBase 0.36 does not add these automatically for API/migration-created
// collections, but we rely on them for ordering (recent customers, booking
// creation order, audit timing) and the TS BaseRecord type. autodate fields are
// safe to add to populated collections — existing rows get the current time.

const COLLECTIONS = [
	'geisha_restaurants',
	'geisha_service_periods',
	'geisha_settings',
	'geisha_tables',
	'geisha_table_joins',
	'geisha_customers',
	'geisha_bookings',
	'geisha_payments',
	'geisha_floor_state',
	'geisha_audit_log'
];

migrate(
	(app) => {
		for (const name of COLLECTIONS) {
			const collection = app.findCollectionByNameOrId(name);
			// `created` — set once on create
			collection.fields.add(
				new Field({
					type: 'autodate',
					name: 'created',
					onCreate: true,
					onUpdate: false,
					presentable: false,
					system: false
				})
			);
			// `updated` — set on create and every update
			collection.fields.add(
				new Field({
					type: 'autodate',
					name: 'updated',
					onCreate: true,
					onUpdate: true,
					presentable: false,
					system: false
				})
			);
			app.save(collection);
		}
	},
	(app) => {
		for (const name of COLLECTIONS) {
			try {
				const collection = app.findCollectionByNameOrId(name);
				collection.fields.removeByName('created');
				collection.fields.removeByName('updated');
				app.save(collection);
			} catch (e) {
				// ignore
			}
		}
	}
);
