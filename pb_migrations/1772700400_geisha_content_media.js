/// <reference path="../pb_data/types.d.ts" />

// Geisha CMS — two collections that let staff edit public content from /admin
// without a redeploy (see the editable-content plan):
//
//   geisha_content : { restaurant, key, value(json) } — one row per (brand,key).
//                    Public pages read these per-request and fall back to the
//                    hardcoded src/lib/data/* defaults when a row is absent.
//   geisha_media   : uploaded images (a PB `file` field) staff add via the admin
//                    image picker, alongside the existing static/Content folder/.
//
// Mirrors the helper/style of 1772700000_created_geisha_collections.js. Both are
// server-only (all *Rule: null) like every other geisha_* collection — §11 auth
// still gates the admin surface. Timestamps are added in the next migration.

migrate(
  (app) => {
    // helpers (copied from the original geisha collections migration) -----------
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
    const file = (id, name) => ({
      hidden: false,
      id,
      maxSelect: 1,
      maxSize: 0, // 0 = PB default per-file cap
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
      name,
      presentable: false,
      protected: false,
      required: false,
      system: false,
      thumbs: [],
      type: 'file'
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
          listRule: null, // server-only access (admin token); hardened in §11
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          indexes: opts.indexes || [],
          fields: [idField(), ...fields]
        })
      );

    // geisha_content — one JSON blob per (restaurant, key). UNIQUE so upserts by
    // key are safe and duplicates are impossible.
    make(
      'geisha_content',
      [
        relation('g_ct_rest', 'restaurant', 'geisha_restaurants', true),
        text('g_ct_key', 'key', true),
        json('g_ct_value', 'value')
      ],
      {
        indexes: [
          'CREATE UNIQUE INDEX idx_geisha_content_key ON geisha_content (restaurant, key)'
        ]
      }
    );

    // geisha_media — uploaded images. restaurant is optional (media can be shared).
    make('geisha_media', [
      relation('g_md_rest', 'restaurant', 'geisha_restaurants', false),
      file('g_md_file', 'file'),
      text('g_md_alt', 'alt'),
      text('g_md_label', 'label')
    ]);
  },

  // --- rollback ------------------------------------------------------------
  (app) => {
    for (const n of ['geisha_content', 'geisha_media']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch (e) {
        // ignore if already gone
      }
    }
  }
);
