/// <reference path="../pb_data/types.d.ts" />

// GEISHA_PULSE — the realtime doorbell that makes cross-device live sync actually work.
//
// THE BUG THIS FIXES
// The diary/floor realtime store (src/lib/admin/realtime.svelte.ts) opened an ANONYMOUS
// browser PocketBase client and subscribed to geisha_bookings / geisha_floor_state /
// geisha_tables. All three are superuser-only (listRule: null — see 1772700000), so
// PocketBase, which authorises realtime at DELIVERY time against the List rule, never
// delivered a single event to that client. The subscribe() handshake still returns 204,
// so the store believed it was 'live' and never degraded to its poll fallback: a booking
// made on another device only ever surfaced via the 60s heartbeat re-pull. Staff had to
// hard-refresh to see each other's work.
//
// WHY A SEPARATE COLLECTION
// The store deliberately does NOT trust the realtime record body — it treats every event
// as a bare "something changed" signal and re-pulls the authoritative board from the
// SvelteKit loader (which is staff-session-gated and resolves customer PII server-side).
// So the browser never needed to READ bookings from PocketBase; it only needs a doorbell.
//
// The two alternatives were both worse:
//   • Opening up read rules on geisha_bookings would expose guest names, phones, emails
//     and allergies to the entire internet. Non-starter.
//   • Minting staff PocketBase auth tokens means a new auth collection on a SHARED
//     droplet that already hosts another tenant's `users` auth collection (the pmm
//     places/notes app) — so any rule looser than a collection-scoped one would hand
//     THEIR users the whole booking book. Far more security surface for no extra benefit.
//
// This collection carries NO guest data whatsoever — one row per restaurant, holding
// only "restaurant X last changed at T (rev N)". That makes it safe to expose read-only
// to an anonymous browser client, which is exactly what the realtime transport needs.
//
//   geisha_pulse.restaurant  relation -> geisha_restaurants (unique: one row per venue)
//   geisha_pulse.rev         number   — monotonic bump; gives every write a distinct
//                                       record diff so PocketBase always emits an event
//                                       (a no-op save would not).
//   geisha_pulse.at          date     — when it was bumped (debugging / staleness checks).
//
// RULES: list+view are PUBLIC ('') so the anonymous browser client can subscribe and be
// DELIVERED events. create/update/delete stay superuser-only (null) — only our server,
// via the afterSend hook in src/lib/server/db/pb.ts, ever writes it. Nothing else in the
// schema is touched: bookings/floor_state/tables remain superuser-only.
//
// Idempotent: re-running is a no-op (guarded on collection + seed-row existence).

migrate(
	(app) => {
		let collection;
		try {
			collection = app.findCollectionByNameOrId('geisha_pulse');
		} catch {
			collection = null;
		}

		if (!collection) {
			const restaurants = app.findCollectionByNameOrId('geisha_restaurants');

			collection = new Collection({
				name: 'geisha_pulse',
				type: 'base',
				system: false,
				// PUBLIC READ — safe: no guest data lives here, and the browser needs
				// delivery, which PocketBase gates on the List rule.
				listRule: '',
				viewRule: '',
				// Writes stay server-only (superuser token).
				createRule: null,
				updateRule: null,
				deleteRule: null,
				indexes: ['CREATE UNIQUE INDEX `idx_geisha_pulse_rest` ON `geisha_pulse` (`restaurant`)'],
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
						id: 'g_pl_rest',
						maxSelect: 1,
						minSelect: 1,
						name: 'restaurant',
						presentable: false,
						required: true,
						system: false,
						type: 'relation'
					},
					{
						hidden: false,
						id: 'g_pl_rev',
						max: null,
						min: null,
						name: 'rev',
						onlyInt: true,
						presentable: false,
						required: false,
						system: false,
						type: 'number'
					},
					{
						hidden: false,
						id: 'g_pl_at',
						max: '',
						min: '',
						name: 'at',
						presentable: false,
						required: false,
						system: false,
						type: 'date'
					},
					{
						// The browser TAB that caused this change (an opaque per-tab uuid, see
						// src/lib/admin/clientId.ts) — never a person, a staff id or a session.
						// It exists so the tab that made the change can recognise and ignore its
						// OWN echo, while every other board re-pulls. Empty when the write can't
						// be pinned on a single tab (a cron sweep, the Dojo webhook, or two
						// devices writing inside the same coalescing window), which makes EVERY
						// board re-pull — the safe default.
						autogeneratePattern: '',
						hidden: false,
						id: 'g_pl_actor',
						max: 0,
						min: 0,
						name: 'actor',
						pattern: '',
						presentable: false,
						primaryKey: false,
						required: false,
						system: false,
						type: 'text'
					}
				]
			});

			app.save(collection);
		}

		// No seeding: the first write for a restaurant creates its row (pulse.ts upserts),
		// which also means a restaurant added later needs no migration. Keeping this file to
		// collection-creation only keeps it on the exact JSVM surface the existing migrations
		// already prove works on this instance.
	},
	(app) => {
		// Down: drop the collection entirely (it holds no durable data — just a counter).
		try {
			const collection = app.findCollectionByNameOrId('geisha_pulse');
			app.delete(collection);
		} catch {
			// already gone — nothing to do
		}
	}
);
