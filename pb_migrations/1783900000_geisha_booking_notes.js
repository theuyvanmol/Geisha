/// <reference path="../pb_data/types.d.ts" />

// BOOKING NOTES — the columns the diary/floor "Edit Comments" editor has always
// written but the collection never had.
//
//   geisha_bookings += note_to_restaurant   (text)   — the FOH note the comments
//                                                      editor's second textarea saves.
//   geisha_bookings += confirm_attempts     (number) — bumped by markConfirmed().
//   geisha_bookings += leave_time_confirmed (bool)   — read by the diary popover /
//                                                      hover card / booking slip.
//
// WHY THIS EXISTS: `Booking` (src/lib/server/db/types.ts) declared all three as
// optional back-compat fields, and both `comments` actions
// (admin/(service)/diary and admin/(service)/floor) update `note_to_restaurant`
// on every save. PocketBase IGNORES keys that aren't in the collection schema —
// it does NOT error — so the write returned 200, the board painted the note
// optimistically, and the next reconcile pulled the booking back WITHOUT it.
// From the host's side that reads as "comments save, then vanish a second later".
// `confirm_attempts` was silently dropped the same way, so the popover's
// "N attempts" line was stuck on 0.
//
// Additive + back-compat: every reader already treats absent as ''/0/false, so
// existing rows need no backfill. Idempotent — each add is guarded, so a re-run
// (or a rebuild where the field already exists) is a no-op. JSVM API only,
// mirroring 1772701400.

migrate(
	(app) => {
		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		const has = (name) => bookings.fields.find((f) => f.name === name);

		if (!has('note_to_restaurant')) {
			bookings.fields.add(
				new Field({
					autogeneratePattern: '',
					hidden: false,
					id: 'g_b_note_foh',
					max: 0,
					min: 0,
					name: 'note_to_restaurant',
					pattern: '',
					presentable: false,
					primaryKey: false,
					required: false,
					system: false,
					type: 'text'
				})
			);
		}

		if (!has('confirm_attempts')) {
			bookings.fields.add(
				new Field({
					hidden: false,
					id: 'g_b_confirm_attempts',
					max: null,
					min: null,
					name: 'confirm_attempts',
					onlyInt: true,
					presentable: false,
					required: false,
					system: false,
					type: 'number'
				})
			);
		}

		if (!has('leave_time_confirmed')) {
			bookings.fields.add(
				new Field({
					hidden: false,
					id: 'g_b_leave_confirmed',
					name: 'leave_time_confirmed',
					presentable: false,
					required: false,
					system: false,
					type: 'bool'
				})
			);
		}

		app.save(bookings);
	},
	(app) => {
		// Down: drop the added fields if present.
		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		for (const name of ['note_to_restaurant', 'confirm_attempts', 'leave_time_confirmed']) {
			const f = bookings.fields.find((x) => x.name === name);
			if (f) bookings.fields.removeById(f.id);
		}
		app.save(bookings);
	}
);
