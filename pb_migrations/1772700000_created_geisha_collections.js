/// <reference path="../pb_data/types.d.ts" />

// Geisha booking system — all collections, prefixed `geisha_` so they never
// collide with the pmm project's existing collections (places/notes/tags/etc.),
// which this migration leaves completely untouched.
//
// Relations are resolved by NAME at apply-time via findCollectionByNameOrId,
// so collections are created in dependency order (referenced before referencing).
//
// Field-id strings are arbitrary-but-stable; PocketBase requires them unique
// within a collection. Money is stored in pence (integer). Times are PB `date`.

migrate(
  (app) => {
    // small helpers to keep the field definitions terse + consistent ----------
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
    const number = (id, name, required = false, onlyInt = true) => ({
      hidden: false,
      id,
      max: null,
      min: null,
      name,
      onlyInt,
      presentable: false,
      required,
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
    const relation = (id, name, targetCollectionName, required = false, maxSelect = 1) => ({
      cascadeDelete: false,
      collectionId: app.findCollectionByNameOrId(targetCollectionName).id,
      hidden: false,
      id,
      maxSelect,
      minSelect: 0,
      name,
      presentable: false,
      required,
      system: false,
      type: 'relation'
    });

    const make = (name, fields, opts = {}) =>
      app.save(
        new Collection({
          name,
          type: 'base',
          system: false,
          listRule: null, // server-only access for now (admin token); hardened in §11
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          indexes: opts.indexes || [],
          fields: [idField(), ...fields]
        })
      );

    // 1. geisha_restaurants ---------------------------------------------------
    make('geisha_restaurants', [
      select('g_r_brand', 'brand', ['asia', 'fusion'], true),
      text('g_r_name', 'display_name', true),
      text('g_r_tz', 'timezone')
    ]);

    // 2. geisha_service_periods (-> restaurants) ------------------------------
    make('geisha_service_periods', [
      relation('g_sp_rest', 'restaurant', 'geisha_restaurants', true),
      text('g_sp_name', 'name', true),
      json('g_sp_days', 'days_of_week'), // [0..6], 0 = Sunday
      text('g_sp_start', 'start_time'), // 'HH:mm'
      text('g_sp_end', 'end_time'),
      text('g_sp_last', 'last_booking_time'),
      number('g_sp_turn', 'default_turn_minutes'),
      bool('g_sp_active', 'active')
    ]);

    // 3. geisha_settings (-> restaurants) -------------------------------------
    make(
      'geisha_settings',
      [
        relation('g_set_rest', 'restaurant', 'geisha_restaurants', true),
        text('g_set_key', 'key', true),
        json('g_set_value', 'value')
      ],
      { indexes: ['CREATE INDEX idx_geisha_settings_key ON geisha_settings (restaurant, key)'] }
    );

    // 4. geisha_tables (-> restaurants) ---------------------------------------
    make('geisha_tables', [
      relation('g_t_rest', 'restaurant', 'geisha_restaurants', true),
      text('g_t_label', 'label', true),
      number('g_t_smin', 'seats_min'),
      number('g_t_smax', 'seats_max'),
      select('g_t_section', 'section', ['Main', 'Window', 'VIP', 'Bar', 'Outdoor']),
      bool('g_t_bookable', 'bookable'), // false = walk-in only
      number('g_t_x', 'x', false, false),
      number('g_t_y', 'y', false, false),
      number('g_t_w', 'width', false, false),
      number('g_t_h', 'height', false, false),
      select('g_t_shape', 'shape', ['rect', 'round', 'square'])
    ]);

    // 5. geisha_table_joins (-> restaurants, tables x2) -----------------------
    make('geisha_table_joins', [
      relation('g_tj_rest', 'restaurant', 'geisha_restaurants', true),
      relation('g_tj_a', 'table_a', 'geisha_tables', true),
      relation('g_tj_b', 'table_b', 'geisha_tables', true)
    ]);

    // 6. geisha_customers -----------------------------------------------------
    make(
      'geisha_customers',
      [
        text('g_c_name', 'name', true),
        text('g_c_email', 'email'),
        text('g_c_phone', 'phone'),
        editor('g_c_notes', 'notes'), // AI/RAG reads this
        bool('g_c_consent', 'marketing_consent')
      ],
      { indexes: ['CREATE INDEX idx_geisha_customers_email ON geisha_customers (email)'] }
    );

    // 7. geisha_bookings (-> restaurants, customers, service_periods, tables) --
    make(
      'geisha_bookings',
      [
        relation('g_b_rest', 'restaurant', 'geisha_restaurants', true),
        relation('g_b_cust', 'customer', 'geisha_customers'),
        number('g_b_party', 'party_size', true),
        date('g_b_start', 'starts_at', true),
        date('g_b_end', 'ends_at', true),
        relation('g_b_tables', 'tables', 'geisha_tables', false, 12), // multi-rel (joins)
        relation('g_b_sp', 'service_period', 'geisha_service_periods'),
        select(
          'g_b_status',
          'status',
          ['pending_payment', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'],
          true
        ),
        select('g_b_source', 'source', ['online', 'phone', 'walkin']),
        editor('g_b_req', 'special_requests'),
        text('g_b_occasion', 'occasion')
      ],
      {
        indexes: [
          'CREATE INDEX idx_geisha_bookings_start ON geisha_bookings (restaurant, starts_at)',
          'CREATE INDEX idx_geisha_bookings_status ON geisha_bookings (status)'
        ]
      }
    );

    // 8. geisha_payments (-> bookings) ----------------------------------------
    make('geisha_payments', [
      relation('g_p_booking', 'booking', 'geisha_bookings', true),
      text('g_p_intent', 'dojo_payment_intent_id'),
      select('g_p_kind', 'kind', ['deposit', 'noshow_hold']),
      number('g_p_amount', 'amount'), // pence
      select('g_p_status', 'status', [
        'Created',
        'Authorized',
        'Captured',
        'Reversed',
        'Refunded',
        'Canceled'
      ]),
      date('g_p_cap', 'captured_at'),
      date('g_p_rev', 'reversed_at')
    ]);

    // 9. geisha_floor_state (-> bookings, tables) -----------------------------
    make('geisha_floor_state', [
      relation('g_fs_booking', 'booking', 'geisha_bookings', true),
      relation('g_fs_table', 'table', 'geisha_tables', true),
      date('g_fs_seated', 'seated_at'),
      date('g_fs_cleared', 'cleared_at')
    ]);

    // 10. geisha_audit_log ----------------------------------------------------
    make('geisha_audit_log', [
      select('g_al_actor', 'actor', ['staff', 'ai', 'system', 'customer']),
      text('g_al_action', 'action'),
      text('g_al_entity', 'entity'),
      text('g_al_entity_id', 'entity_id'),
      json('g_al_before', 'before'),
      json('g_al_after', 'after')
    ]);
  },

  // --- rollback: delete in reverse dependency order ------------------------
  (app) => {
    const names = [
      'geisha_audit_log',
      'geisha_floor_state',
      'geisha_payments',
      'geisha_bookings',
      'geisha_customers',
      'geisha_table_joins',
      'geisha_tables',
      'geisha_settings',
      'geisha_service_periods',
      'geisha_restaurants'
    ];
    for (const n of names) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch (e) {
        // ignore if already gone
      }
    }
  }
);
