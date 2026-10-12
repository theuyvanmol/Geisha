/// <reference path="../pb_data/types.d.ts" />

// QA SWEEP FIX (B5) — snapshot the guest's name and phone ONTO the booking.
//
//   geisha_bookings += guest_name  (text) — who this booking was made under
//   geisha_bookings += guest_phone (text) — the number given for THIS booking
//
// WHY. Until now a booking carried no name at all: it held a `customer` relation and
// every screen read the name through it (`b.expand.customer.name`). `upsertCustomer`
// matches on email and overwrote that record's name on every new booking, so a repeat
// email RETROACTIVELY renamed the guest's earlier bookings — across the diary, the
// run-sheet and the floor plan at once — and the original name became unsearchable.
// The same three lines blanked the stored phone whenever a later booking omitted one
// (`input.phone ?? existing.phone` keeps an empty string; `??` only falls back on
// null/undefined). The trigger is a repeat email, which is the normal case: a regular
// typing "Dave" instead of "David", a couple sharing an address, a PA, a concierge.
//
// This mirrors how ResDiary separates the two concepts: the CUSTOMER record is CRM
// identity and history, while each BOOKING records who actually booked it. Fixing the
// overwrite alone is not enough — without a per-booking name, the second booking would
// simply display the first booking's name instead.
//
// Additive + back-compat: an absent/empty value falls back to the customer record, so
// every historical booking keeps rendering exactly as it does today. JSVM API only,
// mirroring 1772701500. Idempotent: each add is guarded so a re-run is a no-op.

migrate(
	(app) => {
		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		const has = (name) => bookings.fields.find((f) => f.name === name);

		if (!has('guest_name')) {
			bookings.fields.add(
				new Field({
					hidden: false,
					id: 'g_b_guest_name',
					name: 'guest_name',
					presentable: false,
					required: false,
					system: false,
					type: 'text',
					max: 0,
					min: 0,
					pattern: ''
				})
			);
		}

		if (!has('guest_phone')) {
			bookings.fields.add(
				new Field({
					hidden: false,
					id: 'g_b_guest_phone',
					name: 'guest_phone',
					presentable: false,
					required: false,
					system: false,
					type: 'text',
					max: 0,
					min: 0,
					pattern: ''
				})
			);
		}

		app.save(bookings);
	},
	(app) => {
		// Down: drop both added fields if present.
		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		for (const name of ['guest_name', 'guest_phone']) {
			const f = bookings.fields.find((x) => x.name === name);
			if (f) bookings.fields.removeById(f.id);
		}
		app.save(bookings);
	}
);
