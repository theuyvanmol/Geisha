/// <reference path="../pb_data/types.d.ts" />

// GEISHA_ENQUIRIES — the contact-form inbox.
//
// WHY THIS EXISTS: the public Contact page had a form that submitted NOTHING.
// ContactPanel.svelte's handler called preventDefault(), set `submitted = true`
// and stopped — there was no /api/contact route at all. Every guest who used it
// was shown "your message is on its way" and the message went nowhere. This is
// the store behind the real endpoint.
//
//   geisha_enquiries.restaurant  relation -> geisha_restaurants (which brand's
//                                            Contact page it came from)
//   geisha_enquiries.name        text     — as typed by the guest
//   geisha_enquiries.email       text     — as typed; the mailto: target
//   geisha_enquiries.subject     text     — optional
//   geisha_enquiries.message     text     — the body
//   geisha_enquiries.status      text     — 'new' | 'replied' | 'closed'
//   geisha_enquiries.handled_by  text     — geisha_staff id who last moved it
//   geisha_enquiries.handled_at  date     — when
//   geisha_enquiries.source      text     — 'contact_form' (room for future
//                                            intake routes without a migration)
//
// RULES: all null (superuser only). This holds guest-supplied names, email
// addresses and free text — PII — so it is read and written exclusively by our
// server through the superuser client, exactly like geisha_bookings. It must
// NOT follow geisha_pulse's public-read pattern; that collection is safe to
// expose precisely because it carries no guest data, and this one is the
// opposite case.
//
// Idempotent: guarded on collection existence, so a re-run is a no-op.
//
// `created` / `updated` MUST BE DECLARED. PocketBase (0.36 here) does not add
// them implicitly — they are ordinary `autodate` fields, and a collection
// without them simply has no such columns. The first version of this file
// omitted them while indexing `created`, so the migration failed with
//
//   Failed to create index idx_geisha_enq_rest_created
//   - SQL logic error: no such column: created
//
// and PocketBase EXITS on a failed migration rather than skipping it, taking
// the whole shared instance down until the file was pulled. The failure rolls
// back cleanly (no partial collection), but the outage is real: this box also
// serves another tenant. The loader sorts by `-created`, so these fields are
// load-bearing and not decoration. Copy this pair into any new collection.

migrate(
	(app) => {
		let collection;
		try {
			collection = app.findCollectionByNameOrId('geisha_enquiries');
		} catch {
			collection = null;
		}
		if (collection) return;

		const restaurants = app.findCollectionByNameOrId('geisha_restaurants');

		const text = (id, name, required) => ({
			autogeneratePattern: '',
			hidden: false,
			id,
			max: 0,
			min: 0,
			name,
			pattern: '',
			presentable: false,
			primaryKey: false,
			required: Boolean(required),
			system: false,
			type: 'text'
		});

		collection = new Collection({
			name: 'geisha_enquiries',
			type: 'base',
			system: false,
			// Server-only, via the superuser token. Guest PII lives here.
			listRule: null,
			viewRule: null,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			indexes: [
				'CREATE INDEX `idx_geisha_enq_rest_created` ON `geisha_enquiries` (`restaurant`, `created`)',
				'CREATE INDEX `idx_geisha_enq_status` ON `geisha_enquiries` (`status`)'
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
					id: 'g_en_rest',
					maxSelect: 1,
					minSelect: 1,
					name: 'restaurant',
					presentable: false,
					required: true,
					system: false,
					type: 'relation'
				},
				text('g_en_name', 'name', true),
				text('g_en_email', 'email', true),
				text('g_en_subject', 'subject', false),
				// Plain text, not `editor` — this is guest-supplied and must never be
				// rendered as HTML. max: 0 is PocketBase's "no limit"; the endpoint
				// caps the length before it gets here.
				text('g_en_message', 'message', false),
				text('g_en_status', 'status', false),
				text('g_en_handled_by', 'handled_by', false),
				{
					hidden: false,
					id: 'g_en_handled_at',
					max: '',
					min: '',
					name: 'handled_at',
					presentable: false,
					required: false,
					system: false,
					type: 'date'
				},
				text('g_en_source', 'source', false),
				// See the header note — these are NOT implicit, and the index below
				// plus the admin page's `sort: '-created'` both depend on them.
				{
					hidden: false,
					id: 'g_en_created',
					name: 'created',
					onCreate: true,
					onUpdate: false,
					presentable: false,
					system: false,
					type: 'autodate'
				},
				{
					hidden: false,
					id: 'g_en_updated',
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
	},
	(app) => {
		// Down: drop the collection. NB this discards stored enquiries — it exists
		// for a failed rollout, not for routine use.
		try {
			app.delete(app.findCollectionByNameOrId('geisha_enquiries'));
		} catch {
			// already gone — nothing to do
		}
	}
);
