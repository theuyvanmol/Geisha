/// <reference path="../pb_data/types.d.ts" />

// WP-CRM-3 — provenance timestamp for marketing consent.
//
// F2 (1772700600) added geisha_customers.marketing_consent_source but NOT a
// companion timestamp. WP-CRM-3 needs to record WHEN consent was last changed so
// the profile can render "Opted in via online booking on 12 Jun 2026" and the
// export can carry consentAt. The plan forbids encoding the timestamp as a prefix
// on the source field, so this single additive (optional) text/datetime field is
// the documented-correct fix — a NEW migration that never touches F2's file.
//
// Additive + back-compat: existing rows simply have an empty marketing_consent_at
// until the next consent change stamps it.

migrate(
	(app) => {
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

		const customers = app.findCollectionByNameOrId('geisha_customers');
		// ISO-8601 instant of the last consent change. Stored as text (not date) so
		// "no consent timestamp yet" is an empty string, matching how the rest of
		// the geisha_* schema models optional instants.
		customers.fields.add(new Field(text('g_c_mcat', 'marketing_consent_at')));
		app.save(customers);
	},
	(app) => {
		try {
			const customers = app.findCollectionByNameOrId('geisha_customers');
			try {
				customers.fields.removeByName('marketing_consent_at');
			} catch (e) {
				// already gone
			}
			app.save(customers);
		} catch (e) {
			// customers gone
		}
	}
);
