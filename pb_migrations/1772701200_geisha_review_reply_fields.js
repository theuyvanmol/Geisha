/// <reference path="../pb_data/types.d.ts" />

// mf-review-sentiment — additive fields on geisha_reviews so a manager can store
// an AI-drafted, human-confirmed reply alongside the review, and so the insights
// view can tell which negative reviews still need attention.
//
//   geisha_reviews += reply         (editor)  — the confirmed/published reply text
//                     reply_status  (text)    — '' | 'draft' | 'published'
//                     analyzed_at   (date)    — when sentiment/themes were last run
//
// All optional/additive — existing rows + the route cope with them empty. JSVM API
// only (new Field / app.save), mirroring 1772700600. Idempotent: each add is
// guarded so a re-run (or a row that already has the field) is a no-op.

migrate(
	(app) => {
		const editor = (id, name) => ({
			convertURLs: false,
			hidden: false,
			id,
			maxSize: 0,
			name,
			presentable: false,
			required: false,
			system: false,
			type: 'editor'
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

		const reviews = app.findCollectionByNameOrId('geisha_reviews');
		const has = (name) => reviews.fields.find((f) => f.name === name);

		if (!has('reply')) reviews.fields.add(new Field(editor('g_rv_reply', 'reply')));
		if (!has('reply_status')) reviews.fields.add(new Field(text('g_rv_reply_status', 'reply_status')));
		if (!has('analyzed_at')) reviews.fields.add(new Field(date('g_rv_analyzed', 'analyzed_at')));

		app.save(reviews);
	},
	(app) => {
		// Down: drop the added fields if present.
		const reviews = app.findCollectionByNameOrId('geisha_reviews');
		for (const name of ['reply', 'reply_status', 'analyzed_at']) {
			const f = reviews.fields.find((x) => x.name === name);
			if (f) reviews.fields.removeById(f.id);
		}
		app.save(reviews);
	}
);
