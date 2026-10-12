/// <reference path="../pb_data/types.d.ts" />

// GEISHA_FEEDBACK — the 0–5 "how was your visit?" score a guest who booked online
// gives from the email we send them the morning after (ResDiary parity).
//
//   geisha_feedback.restaurant    relation -> geisha_restaurants
//   geisha_feedback.booking       relation -> geisha_bookings (UNIQUE: one answer
//                                             per booking; a re-submit updates it)
//   geisha_feedback.score         number   — 0..5, whole numbers
//   geisha_feedback.comment       text     — optional, guest-typed, capped in code
//   geisha_feedback.visit_at      date     — copy of booking.starts_at, so the
//                                             report filters without a join
//   geisha_feedback.submitted_at  date     — the latest submit
//   geisha_feedback.alerted_at    date     — when the low-score alert went to the
//                                             restaurant (sent at most once)
//   geisha_feedback.source        text     — 'email'
//
//   geisha_customers += feedback_opt_out (bool) — the email's "Stop feedback
//                                                 emails" link sets it.
//
// `score` IS DELIBERATELY NOT REQUIRED. PocketBase's `required` on a number field
// rejects 0 as blank, and 0 is a real answer here — the one that matters most.
// The route validates 0..5 before anything is written.
//
// RULES: all null (superuser only). Guest names, comments and scores are PII read
// and written by our server alone, exactly like geisha_enquiries.
//
// `created` / `updated` ARE DECLARED on purpose — PocketBase 0.36 does not add them
// implicitly, and a missing column named in an index fails the migration, which
// takes the whole shared instance down (see 1786100000_geisha_enquiries.js).
//
// Idempotent: the collection is guarded on existence and the customer field on
// presence, so a re-run is a no-op.

migrate(
	(app) => {
		let collection;
		try {
			collection = app.findCollectionByNameOrId('geisha_feedback');
		} catch {
			collection = null;
		}

		if (!collection) {
			const restaurants = app.findCollectionByNameOrId('geisha_restaurants');
			const bookings = app.findCollectionByNameOrId('geisha_bookings');

			const date = (id, name) => ({
				hidden: false,
				id,
				max: '',
				min: '',
				name,
				presentable: false,
				required: false,
				system: false,
				type: 'date'
			});
			const text = (id, name) => ({
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

			collection = new Collection({
				name: 'geisha_feedback',
				type: 'base',
				system: false,
				listRule: null,
				viewRule: null,
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: [
					'CREATE UNIQUE INDEX `idx_geisha_fb_booking` ON `geisha_feedback` (`booking`)',
					'CREATE INDEX `idx_geisha_fb_rest_visit` ON `geisha_feedback` (`restaurant`, `visit_at`)'
				],
				fields: [
					{
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
					},
					{
						cascadeDelete: true,
						collectionId: restaurants.id,
						hidden: false,
						id: 'g_fb_rest',
						maxSelect: 1,
						minSelect: 1,
						name: 'restaurant',
						presentable: false,
						required: true,
						system: false,
						type: 'relation'
					},
					{
						// Cascade so a feedback row can never block deleting its booking —
						// a required non-cascade relation makes PocketBase refuse the delete.
						cascadeDelete: true,
						collectionId: bookings.id,
						hidden: false,
						id: 'g_fb_booking',
						maxSelect: 1,
						minSelect: 1,
						name: 'booking',
						presentable: false,
						required: true,
						system: false,
						type: 'relation'
					},
					{
						hidden: false,
						id: 'g_fb_score',
						max: 5,
						min: 0,
						name: 'score',
						onlyInt: true,
						presentable: false,
						required: false,
						system: false,
						type: 'number'
					},
					text('g_fb_comment', 'comment'),
					date('g_fb_visit_at', 'visit_at'),
					date('g_fb_submitted_at', 'submitted_at'),
					date('g_fb_alerted_at', 'alerted_at'),
					text('g_fb_source', 'source'),
					{
						hidden: false,
						id: 'g_fb_created',
						name: 'created',
						onCreate: true,
						onUpdate: false,
						presentable: false,
						system: false,
						type: 'autodate'
					},
					{
						hidden: false,
						id: 'g_fb_updated',
						name: 'updated',
						onCreate: true,
						onUpdate: true,
						presentable: false,
						system: false,
						type: 'autodate'
					}
				]
			});

			app.save(collection);
		}

		const customers = app.findCollectionByNameOrId('geisha_customers');
		if (!customers.fields.find((f) => f.name === 'feedback_opt_out')) {
			customers.fields.add(
				new Field({
					hidden: false,
					id: 'g_c_feedback_opt_out',
					name: 'feedback_opt_out',
					presentable: false,
					required: false,
					system: false,
					type: 'bool'
				})
			);
			app.save(customers);
		}
	},
	(app) => {
		// Down: drop the collection and the opt-out flag. NB this discards stored
		// scores — it exists for a failed rollout, not for routine use.
		try {
			app.delete(app.findCollectionByNameOrId('geisha_feedback'));
		} catch {
			// already gone
		}
		try {
			const customers = app.findCollectionByNameOrId('geisha_customers');
			const f = customers.fields.find((x) => x.name === 'feedback_opt_out');
			if (f) {
				customers.fields.removeById(f.id);
				app.save(customers);
			}
		} catch {
			// nothing to undo
		}
	}
);
