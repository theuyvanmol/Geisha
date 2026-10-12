/// <reference path="../pb_data/types.d.ts" />

// mf-guest-comms — outbox statuses for the personalised guest-comms engine.
//
// F2 (1772700600) created geisha_messages.status as a select limited to the
// transactional-send lifecycle (queued → sent/failed/skipped/delivered/bounced).
// The comms engine queues AI-DRAFTED messages that a human reviews before they
// go out, so the select needs two extra, review-first states:
//
//     draft     — AI wrote it; awaiting staff approval (the default, review-first)
//     approved  — staff cleared it; the next cron sweep will actually send it
//
// PocketBase rejects a record whose select value isn't in the field's option
// list, so this MUST be a migration (a plain create with status:'draft' would
// 400). Purely ADDITIVE: every existing option is preserved and existing rows
// are untouched, so the transactional reminder/confirmation flow is unaffected.
//
// JSVM API only, mirroring the field edits in 1772700700.

migrate(
	(app) => {
		const COMMS_VALUES = [
			'draft',
			'approved',
			'queued',
			'sent',
			'failed',
			'skipped',
			'delivered',
			'bounced'
		];

		const messages = app.findCollectionByNameOrId('geisha_messages');
		const status = messages.fields.getByName('status');
		// Defensive: only widen the option list, never drop an existing one.
		const merged = COMMS_VALUES.slice();
		for (const v of status.values || []) {
			if (merged.indexOf(v) === -1) merged.push(v);
		}
		status.values = merged;
		app.save(messages);
	},
	(app) => {
		// Revert to the original transactional-only option list. Rows still carrying
		// 'draft'/'approved' would then be out-of-list, so guard the save.
		try {
			const messages = app.findCollectionByNameOrId('geisha_messages');
			const status = messages.fields.getByName('status');
			status.values = ['queued', 'sent', 'failed', 'skipped', 'delivered', 'bounced'];
			app.save(messages);
		} catch (e) {
			// collection or field already gone — nothing to revert
		}
	}
);
