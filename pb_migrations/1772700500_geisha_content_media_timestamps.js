/// <reference path="../pb_data/types.d.ts" />

// Add `created` / `updated` autodate fields to the two CMS collections from
// 1772700400. PocketBase 0.36 doesn't add these automatically for
// migration-created collections, and the TS BaseRecord type + admin sorting
// rely on them. Mirrors 1772700100_geisha_add_timestamps.js exactly.

const COLLECTIONS = ['geisha_content', 'geisha_media'];

migrate(
	(app) => {
		for (const name of COLLECTIONS) {
			const collection = app.findCollectionByNameOrId(name);
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
