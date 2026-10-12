/// <reference path="../pb_data/types.d.ts" />

// Booking-system plan foundation (F2) — ONE batched, additive, back-compat
// migration that builds out everything the operations/AI/lifecycle layers need:
//
//   New collections (all server-only, *Rule: null, like every geisha_* table):
//     geisha_staff          — staff accounts (base collection; F1 owns auth/hashing)
//     geisha_closures       — date(-range) closures: holidays / private hire / maint.
//     geisha_pacing_rules   — per-period covers/slot caps, lead time, booking window
//     geisha_deposit_rules  — priority-ordered deposit / no-show-hold policy
//     geisha_waitlist       — waitlist entries + offer lifecycle
//     geisha_messages       — outbound email/SMS log (queued -> sent/failed/…)
//     geisha_ai_insights    — AI-derived scores/payloads keyed to a subject
//     geisha_alerts         — operational alerts (metric thresholds etc.)
//     geisha_reviews        — aggregated reviews with sentiment/themes
//     geisha_locks          — advisory locks for the multi-instance booking lock
//
//   Field additions (all optional / additive — existing rows + the engine cope):
//     geisha_customers  += restaurant, tags, vip, dietary, allergies,
//                          no_show_count, cancel_count, marketing_consent_source,
//                          deleted_at
//     geisha_bookings   += amended_from, waitlist_origin, risk_score,
//                          risk_factors, dietary_flags  AND  source += 'ai'
//     geisha_audit_log  += on_behalf_of
//     geisha_floor_shapes += points (json — polyline walls)
//
//   Seed: per existing restaurant, the CURRENT deposit policy as geisha_deposit_rules
//     rows (per-person £10 deposit for parties >= 6; per-person £5 no-show hold on
//     Fri/Sat) plus a geisha_settings `deposit_rules` marker row.
//
// JSVM API only (new Field / new Collection / new Record / app.save /
// app.findCollectionByNameOrId). Mirrors 1772700000 + 1772700200 exactly.

migrate(
	(app) => {
		// --- field helpers (mirrors 1772700000 / 1772700200) --------------------
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
		const bool = (id, name) => ({
			hidden: false,
			id,
			name,
			presentable: false,
			required: false,
			system: false,
			type: 'bool'
		});
		const date = (id, name, required = false) => ({
			hidden: false,
			id,
			max: '',
			min: '',
			name,
			presentable: false,
			required,
			system: false,
			type: 'date'
		});
		const json = (id, name) => ({
			hidden: false,
			id,
			maxSize: 0,
			name,
			presentable: false,
			required: false,
			system: false,
			type: 'json'
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
			maxSelect: opts.maxSelect ?? 1,
			minSelect: 0,
			name,
			presentable: false,
			required: opts.required ?? false,
			system: false,
			type: 'relation'
		});

		// autodate created/updated to match every other geisha_* collection
		// (added wholesale in 1772700100; new collections get them at birth here).
		const createdField = () => ({
			type: 'autodate',
			name: 'created',
			onCreate: true,
			onUpdate: false,
			presentable: false,
			system: false
		});
		const updatedField = () => ({
			type: 'autodate',
			name: 'updated',
			onCreate: true,
			onUpdate: true,
			presentable: false,
			system: false
		});

		const make = (name, fields, opts = {}) =>
			app.save(
				new Collection({
					name,
					type: 'base',
					system: false,
					listRule: null, // server-only access (admin token); hardened in §11
					viewRule: null,
					createRule: null,
					updateRule: null,
					deleteRule: null,
					indexes: opts.indexes || [],
					fields: [idField(), ...fields, createdField(), updatedField()]
				})
			);

		// =========================================================================
		// NEW COLLECTIONS
		// =========================================================================

		// 1. geisha_staff — staff accounts. Base collection (NOT PB auth); F1 owns
		//    the password hashing + session logic and reads password_hash here.
		make(
			'geisha_staff',
			[
				text('g_st_email', 'email', true),
				text('g_st_name', 'name'),
				select('g_st_role', 'role', ['owner', 'manager', 'host', 'server']),
				relation('g_st_rests', 'restaurants', 'geisha_restaurants', { maxSelect: 8 }),
				bool('g_st_active', 'active'),
				text('g_st_pw', 'password_hash')
			],
			{ indexes: ['CREATE UNIQUE INDEX idx_geisha_staff_email ON geisha_staff (email)'] }
		);

		// 2. geisha_closures — full-day or per-period closures over a date range.
		make(
			'geisha_closures',
			[
				relation('g_cl_rest', 'restaurant', 'geisha_restaurants', { required: true }),
				date('g_cl_from', 'date_from', true),
				date('g_cl_to', 'date_to'),
				select('g_cl_scope', 'scope', ['full', 'period']),
				relation('g_cl_sp', 'service_period', 'geisha_service_periods'),
				text('g_cl_reason', 'reason'),
				select('g_cl_kind', 'kind', ['holiday', 'private_hire', 'maintenance'])
			],
			{
				indexes: [
					'CREATE INDEX idx_geisha_closures_rest_from ON geisha_closures (restaurant, date_from)'
				]
			}
		);

		// 3. geisha_pacing_rules — covers/slot + covers/period caps, lead time and
		//    booking window. service_period optional => restaurant-wide default.
		make(
			'geisha_pacing_rules',
			[
				relation('g_pr_rest', 'restaurant', 'geisha_restaurants', { required: true }),
				relation('g_pr_sp', 'service_period', 'geisha_service_periods'),
				json('g_pr_dow', 'dow'), // [0..6] this rule applies to; empty = all
				number('g_pr_cps', 'max_covers_per_slot'),
				number('g_pr_cpp', 'max_covers_per_period'),
				number('g_pr_lead', 'lead_time_minutes'),
				number('g_pr_win', 'booking_window_days')
			],
			{
				indexes: [
					'CREATE INDEX idx_geisha_pacing_rules_rest ON geisha_pacing_rules (restaurant, service_period)'
				]
			}
		);

		// 4. geisha_deposit_rules — priority-ordered deposit / no-show-hold policy.
		//    Lower `priority` wins; date_from/date_to optional (seasonal overrides).
		make(
			'geisha_deposit_rules',
			[
				relation('g_dr_rest', 'restaurant', 'geisha_restaurants', { required: true }),
				number('g_dr_prio', 'priority'),
				relation('g_dr_sp', 'service_period', 'geisha_service_periods'),
				number('g_dr_pmin', 'party_min'),
				number('g_dr_pmax', 'party_max'),
				json('g_dr_dow', 'dow'), // [0..6]; empty = all days
				date('g_dr_from', 'date_from'),
				date('g_dr_to', 'date_to'),
				select('g_dr_kind', 'kind', ['deposit', 'noshow_hold', 'none']),
				number('g_dr_pp', 'per_person_pence'),
				select('g_dr_cap', 'capture', ['auto', 'manual'])
			],
			{
				indexes: [
					'CREATE INDEX idx_geisha_deposit_rules_rest ON geisha_deposit_rules (restaurant, priority)'
				]
			}
		);

		// 5. geisha_waitlist — waitlist entries + offer lifecycle.
		make(
			'geisha_waitlist',
			[
				relation('g_wl_rest', 'restaurant', 'geisha_restaurants', { required: true }),
				relation('g_wl_cust', 'customer', 'geisha_customers'),
				date('g_wl_date', 'date'),
				number('g_wl_party', 'party_size'),
				date('g_wl_from', 'window_from'),
				date('g_wl_to', 'window_to'),
				select('g_wl_status', 'status', [
					'waiting',
					'offered',
					'claimed',
					'expired',
					'cancelled'
				]),
				date('g_wl_notified', 'notified_at')
			],
			{
				indexes: [
					'CREATE INDEX idx_geisha_waitlist_rest_date ON geisha_waitlist (restaurant, date, status)'
				]
			}
		);

		// 6. geisha_messages — outbound email/SMS log.
		make(
			'geisha_messages',
			[
				relation('g_msg_booking', 'booking', 'geisha_bookings'),
				relation('g_msg_cust', 'customer', 'geisha_customers'),
				select('g_msg_channel', 'channel', ['email', 'sms']),
				text('g_msg_template', 'template'),
				select('g_msg_status', 'status', [
					'queued',
					'sent',
					'failed',
					'skipped',
					'delivered',
					'bounced'
				]),
				text('g_msg_subject', 'subject'),
				editor('g_msg_body', 'body'),
				date('g_msg_sched', 'scheduled_for'),
				date('g_msg_sent', 'sent_at')
			],
			{
				indexes: [
					'CREATE INDEX idx_geisha_messages_status ON geisha_messages (status, scheduled_for)'
				]
			}
		);

		// 7. geisha_ai_insights — AI-derived scores/payloads keyed to a subject.
		make(
			'geisha_ai_insights',
			[
				relation('g_ai_rest', 'restaurant', 'geisha_restaurants'),
				text('g_ai_kind', 'kind'),
				text('g_ai_subject', 'subject_id'),
				number('g_ai_score', 'score', false), // float
				json('g_ai_payload', 'payload')
			],
			{
				indexes: [
					'CREATE INDEX idx_geisha_ai_insights_rest_kind ON geisha_ai_insights (restaurant, kind)'
				]
			}
		);

		// 8. geisha_alerts — operational alerts (metric thresholds, anomalies).
		make(
			'geisha_alerts',
			[
				relation('g_alt_rest', 'restaurant', 'geisha_restaurants'),
				text('g_alt_kind', 'kind'),
				text('g_alt_metric', 'metric'),
				text('g_alt_severity', 'severity'),
				text('g_alt_window', 'window'),
				text('g_alt_message', 'message'),
				bool('g_alt_ack', 'acknowledged')
			],
			{
				indexes: [
					'CREATE INDEX idx_geisha_alerts_rest_ack ON geisha_alerts (restaurant, acknowledged)'
				]
			}
		);

		// 9. geisha_reviews — aggregated reviews with sentiment/themes.
		make(
			'geisha_reviews',
			[
				relation('g_rv_rest', 'restaurant', 'geisha_restaurants'),
				text('g_rv_source', 'source'),
				number('g_rv_rating', 'rating', false), // float (e.g. 4.5)
				editor('g_rv_text', 'text'),
				text('g_rv_author', 'author'),
				date('g_rv_posted', 'posted_at'),
				relation('g_rv_cust', 'customer', 'geisha_customers'),
				text('g_rv_sentiment', 'sentiment'),
				json('g_rv_themes', 'themes')
			],
			{
				indexes: [
					'CREATE INDEX idx_geisha_reviews_rest_posted ON geisha_reviews (restaurant, posted_at)'
				]
			}
		);

		// 10. geisha_locks — advisory locks for the multi-instance booking lock
		//     (replaces the in-process Map in create.ts). `key` is unique; holders
		//     renew/expire via expires_at.
		make(
			'geisha_locks',
			[text('g_lk_key', 'key', true), text('g_lk_holder', 'holder'), date('g_lk_exp', 'expires_at')],
			{ indexes: ['CREATE UNIQUE INDEX idx_geisha_locks_key ON geisha_locks (key)'] }
		);

		// =========================================================================
		// FIELD ADDITIONS to existing collections (all additive / optional)
		// =========================================================================

		// geisha_customers += CRM fields ----------------------------------------
		const customers = app.findCollectionByNameOrId('geisha_customers');
		customers.fields.add(
			new Field(relation('g_c_rest', 'restaurant', 'geisha_restaurants'))
		);
		customers.fields.add(new Field(json('g_c_tags', 'tags')));
		customers.fields.add(new Field(bool('g_c_vip', 'vip')));
		customers.fields.add(new Field(json('g_c_dietary', 'dietary')));
		customers.fields.add(new Field(text('g_c_allergies', 'allergies')));
		customers.fields.add(new Field(number('g_c_noshow', 'no_show_count')));
		customers.fields.add(new Field(number('g_c_cancel', 'cancel_count')));
		customers.fields.add(new Field(text('g_c_mcsrc', 'marketing_consent_source')));
		customers.fields.add(new Field(text('g_c_deleted', 'deleted_at')));
		app.save(customers);

		// geisha_bookings += amendment/risk/dietary; extend source select -------
		const bookings = app.findCollectionByNameOrId('geisha_bookings');
		bookings.fields.add(
			new Field(relation('g_b_amend', 'amended_from', 'geisha_bookings'))
		);
		bookings.fields.add(
			new Field(relation('g_b_wlorigin', 'waitlist_origin', 'geisha_waitlist'))
		);
		bookings.fields.add(new Field(number('g_b_risk', 'risk_score', false))); // float
		bookings.fields.add(new Field(json('g_b_riskf', 'risk_factors')));
		bookings.fields.add(new Field(json('g_b_diet', 'dietary_flags')));
		const srcField = bookings.fields.getByName('source');
		srcField.values = ['online', 'phone', 'walkin', 'ai'];
		app.save(bookings);

		// geisha_audit_log += on_behalf_of --------------------------------------
		const audit = app.findCollectionByNameOrId('geisha_audit_log');
		audit.fields.add(new Field(text('g_al_obo', 'on_behalf_of')));
		app.save(audit);

		// geisha_floor_shapes += points (polyline walls) ------------------------
		const shapes = app.findCollectionByNameOrId('geisha_floor_shapes');
		shapes.fields.add(new Field(json('g_fsh_points', 'points')));
		app.save(shapes);

		// =========================================================================
		// SEED — current deposit policy as geisha_deposit_rules per restaurant
		// =========================================================================
		const depCol = app.findCollectionByNameOrId('geisha_deposit_rules');
		const setCol = app.findCollectionByNameOrId('geisha_settings');
		const restaurants = app.findRecordsByFilter('geisha_restaurants', '1=1');
		for (const r of restaurants) {
			// Per-person £10 deposit for parties of 6+ (all days), auto-captured.
			const dep = new Record(depCol);
			dep.set('restaurant', r.id);
			dep.set('priority', 10);
			dep.set('party_min', 6);
			dep.set('party_max', 0); // 0 = no upper bound
			dep.set('dow', []); // all days
			dep.set('kind', 'deposit');
			dep.set('per_person_pence', 1000);
			dep.set('capture', 'auto');
			app.save(dep);

			// Per-person £5 no-show hold on Fri/Sat (dow [5,6]), manual capture.
			const hold = new Record(depCol);
			hold.set('restaurant', r.id);
			hold.set('priority', 20);
			hold.set('party_min', 1);
			hold.set('party_max', 0);
			hold.set('dow', [5, 6]);
			hold.set('kind', 'noshow_hold');
			hold.set('per_person_pence', 500);
			hold.set('capture', 'manual');
			app.save(hold);

			// Settings marker so the deposit engine knows rules are DB-driven now.
			const marker = new Record(setCol);
			marker.set('restaurant', r.id);
			marker.set('key', 'deposit_rules');
			marker.set('value', { source: 'geisha_deposit_rules', migrated: '1772700600' });
			app.save(marker);
		}
	},

	// --- rollback: drop seeds, then reverse field adds, then new collections ---
	(app) => {
		// remove seeded deposit_rules marker settings + seeded deposit rules
		try {
			const markers = app.findRecordsByFilter('geisha_settings', 'key = {:k}', '', 0, 0, {
				k: 'deposit_rules'
			});
			for (const m of markers) app.delete(m);
		} catch (e) {
			// settings gone
		}

		// revert geisha_bookings field adds + source select
		try {
			const bookings = app.findCollectionByNameOrId('geisha_bookings');
			for (const n of [
				'amended_from',
				'waitlist_origin',
				'risk_score',
				'risk_factors',
				'dietary_flags'
			]) {
				try {
					bookings.fields.removeByName(n);
				} catch (e) {
					// already gone
				}
			}
			try {
				const srcField = bookings.fields.getByName('source');
				srcField.values = ['online', 'phone', 'walkin'];
			} catch (e) {
				// source field gone
			}
			app.save(bookings);
		} catch (e) {
			// bookings gone
		}

		// revert geisha_customers field adds
		try {
			const customers = app.findCollectionByNameOrId('geisha_customers');
			for (const n of [
				'restaurant',
				'tags',
				'vip',
				'dietary',
				'allergies',
				'no_show_count',
				'cancel_count',
				'marketing_consent_source',
				'deleted_at'
			]) {
				try {
					customers.fields.removeByName(n);
				} catch (e) {
					// already gone
				}
			}
			app.save(customers);
		} catch (e) {
			// customers gone
		}

		// revert geisha_audit_log field add
		try {
			const audit = app.findCollectionByNameOrId('geisha_audit_log');
			try {
				audit.fields.removeByName('on_behalf_of');
			} catch (e) {
				// already gone
			}
			app.save(audit);
		} catch (e) {
			// audit gone
		}

		// revert geisha_floor_shapes field add
		try {
			const shapes = app.findCollectionByNameOrId('geisha_floor_shapes');
			try {
				shapes.fields.removeByName('points');
			} catch (e) {
				// already gone
			}
			app.save(shapes);
		} catch (e) {
			// shapes gone
		}

		// drop new collections (reverse dependency order: waitlist before bookings
		// is irrelevant since fields already reverted; messages/reviews ref
		// customers+bookings so go before nothing here — collections only depend on
		// already-existing tables, so any order works).
		for (const n of [
			'geisha_locks',
			'geisha_reviews',
			'geisha_alerts',
			'geisha_ai_insights',
			'geisha_messages',
			'geisha_waitlist',
			'geisha_deposit_rules',
			'geisha_pacing_rules',
			'geisha_closures',
			'geisha_staff'
		]) {
			try {
				app.delete(app.findCollectionByNameOrId(n));
			} catch (e) {
				// already gone
			}
		}
	}
);
