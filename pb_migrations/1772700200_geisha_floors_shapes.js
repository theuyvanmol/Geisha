/// <reference path="../pb_data/types.d.ts" />

// Floor-planner expansion (BOOKING_SYSTEM_PLAN §8.2 / floor-editor).
//
// Adds two collections and extends geisha_tables so the floor editor can model
// multiple floors, real-world measurements, walls/outlines, and table rotation:
//
//   geisha_floors        — one per physical floor of a restaurant; carries the
//                          room size (cm) and the px-per-cm drawing scale.
//   geisha_floor_shapes  — walls / zones / labels drawn on a floor.
//   geisha_tables.*      — floor (rel), rotation (deg), width_cm, height_cm.
//
// All new table fields are OPTIONAL so existing rows + the geometry-free booking
// engine are unaffected. The `up` step backfills a default "Ground floor" per
// restaurant and assigns every existing table to it, so the editor never sees
// an orphan table after this migration applies.
//
// JSVM API only (new Field / app.save / app.findCollectionByNameOrId) — NOT the
// runtime JS SDK. Mirrors the field-object shapes in 1772700000 and the
// add-field-to-existing-collection idiom in 1772700100.

migrate(
	(app) => {
		// --- field helpers (closure-private in 1772700000, re-declared here) ----
		const idField = () => ({
			autogeneratePattern: '[a-z0-9]{15}',
			hidden: false,
			id: 'text_id',
			max: 15,
			min: 15,
			name: 'id',
			pattern: '^[a-z0-9]+$',
			presentable: false,
			primaryKey: true,
			required: true,
			system: true,
			type: 'text'
		});
		const text = (id, name, required = false) => ({
			autogeneratePattern: '',
			hidden: false,
			id,
			max: 0,
			min: 0,
			name,
			pattern: '',
			presentable: false,
			primaryKey: false,
			required,
			system: false,
			type: 'text'
		});
		const number = (id, name, onlyInt = true) => ({
			hidden: false,
			id,
			max: null,
			min: null,
			name,
			onlyInt,
			presentable: false,
			required: false,
			system: false,
			type: 'number'
		});
		const select = (id, name, values, required = false, maxSelect = 1) => ({
			hidden: false,
			id,
			maxSelect,
			name,
			presentable: false,
			required,
			system: false,
			type: 'select',
			values
		});
		const relation = (id, name, targetCollectionName, opts = {}) => ({
			cascadeDelete: opts.cascadeDelete ?? false,
			collectionId: app.findCollectionByNameOrId(targetCollectionName).id,
			hidden: false,
			id,
			maxSelect: 1,
			minSelect: 0,
			name,
			presentable: false,
			required: opts.required ?? false,
			system: false,
			type: 'relation'
		});

		const make = (name, fields, opts = {}) =>
			app.save(
				new Collection({
					name,
					type: 'base',
					system: false,
					listRule: null,
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					indexes: opts.indexes || [],
					fields: [idField(), ...fields]
				})
			);

		// 1. geisha_floors (-> restaurants) --------------------------------------
		make('geisha_floors', [
			relation('g_fl_rest', 'restaurant', 'geisha_restaurants', { required: true }),
			text('g_fl_name', 'name', true),
			number('g_fl_order', 'sort_order'),
			number('g_fl_wcm', 'width_cm'),
			number('g_fl_hcm', 'height_cm'),
			number('g_fl_ppc', 'px_per_cm', false) // float
		]);

		// 2. geisha_floor_shapes (-> floors) -------------------------------------
		make(
			'geisha_floor_shapes',
			[
				relation('g_fsh_floor', 'floor', 'geisha_floors', { required: true, cascadeDelete: true }),
				select('g_fsh_kind', 'kind', ['wall', 'zone', 'label']),
				number('g_fsh_x', 'x', false),
				number('g_fsh_y', 'y', false),
				number('g_fsh_w', 'width', false),
				number('g_fsh_h', 'height', false),
				number('g_fsh_rot', 'rotation', false),
				text('g_fsh_label', 'label'),
				text('g_fsh_color', 'color')
			],
			{
				indexes: ['CREATE INDEX idx_geisha_floor_shapes_floor ON geisha_floor_shapes (floor)']
			}
		);

		// 3. extend geisha_tables -------------------------------------------------
		const tables = app.findCollectionByNameOrId('geisha_tables');
		tables.fields.add(new Field(number('g_t_rot', 'rotation', false)));
		tables.fields.add(new Field(number('g_t_wcm', 'width_cm', false)));
		tables.fields.add(new Field(number('g_t_hcm', 'height_cm', false)));
		tables.fields.add(
			new Field(relation('g_t_floor', 'floor', 'geisha_floors', { cascadeDelete: false }))
		);
		app.save(tables);

		// 4. backfill: one default floor per restaurant; assign every table to it,
		//    seeding cm sizes from the current px size at the default scale.
		const DEFAULT_PPC = 0.5; // 0.5 px per cm => 200px ≈ 4m
		const restaurants = app.findRecordsByFilter('geisha_restaurants', '1=1');
		for (const r of restaurants) {
			const floor = new Record(app.findCollectionByNameOrId('geisha_floors'));
			floor.set('restaurant', r.id);
			floor.set('name', 'Ground floor');
			floor.set('sort_order', 0);
			floor.set('width_cm', 1000);
			floor.set('height_cm', 800);
			floor.set('px_per_cm', DEFAULT_PPC);
			app.save(floor);

			const tbls = app.findRecordsByFilter('geisha_tables', 'restaurant = {:r}', '', 0, 0, {
				r: r.id
			});
			for (const t of tbls) {
				t.set('floor', floor.id);
				const w = t.getFloat('width') || 90;
				const h = t.getFloat('height') || 90;
				t.set('width_cm', Math.round(w / DEFAULT_PPC));
				t.set('height_cm', Math.round(h / DEFAULT_PPC));
				t.set('rotation', 0);
				app.save(t);
			}
		}
	},

	// --- rollback ------------------------------------------------------------
	(app) => {
		try {
			const tables = app.findCollectionByNameOrId('geisha_tables');
			for (const n of ['rotation', 'width_cm', 'height_cm', 'floor']) {
				try {
					tables.fields.removeByName(n);
				} catch (e) {
					// field already gone
				}
			}
			app.save(tables);
		} catch (e) {
			// geisha_tables gone
		}
		for (const n of ['geisha_floor_shapes', 'geisha_floors']) {
			try {
				app.delete(app.findCollectionByNameOrId(n));
			} catch (e) {
				// already gone
			}
		}
	}
);
