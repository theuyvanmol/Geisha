/// <reference path="../pb_data/types.d.ts" />

// MEDIA ON R2 — move the bytes off the droplet, keep the metadata in PocketBase.
//
// geisha_media shipped storing every upload as a PocketBase `file` attachment on
// the droplet's local disk (1772700400), served straight from the PB instance
// with no CDN. That put the site's whole photo/video library on a 1 GB shared box
// and made every image request an origin hit to London.
//
// Uploads now go to a Cloudflare R2 bucket (zero egress, CDN-backed) and this
// collection keeps only the *metadata* — alt text, label, brand scope, audit
// trail — which is what it was actually good for. Two additive fields:
//
//   url      (text) — the canonical public URL of the original object on R2.
//   variants (json) — the AVIF/WebP responsive ladder the upload endpoint
//                     generates with sharp: [{ w, fmt, url }]. Empty for video.
//
// `file` becomes optional rather than being dropped: existing rows still hold
// their PB attachment and keep rendering, so this is safe to apply before any
// backfill and there's no flag day. A row is on R2 if `url` is set, on PB
// otherwise — see mediaUrl() in src/routes/api/admin/media/+server.ts.
//
// Idempotent: each change is guarded, so re-applying is a no-op.

migrate(
	(app) => {
		let media;
		try {
			media = app.findCollectionByNameOrId('geisha_media');
		} catch {
			return; // media CMS never set up on this instance — nothing to migrate
		}
		if (!media) return;

		const text = (id, name) => ({
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

		const jsonField = (id, name) => ({
			hidden: false,
			id,
			maxSize: 0,
			name,
			presentable: false,
			required: false,
			system: false,
			type: 'json'
		});

		if (!media.fields.find((f) => f.name === 'url')) {
			media.fields.add(new Field(text('g_md_url', 'url')));
		}
		if (!media.fields.find((f) => f.name === 'variants')) {
			media.fields.add(new Field(jsonField('g_md_variants', 'variants')));
		}

		// The bytes live on R2 now, so an upload no longer produces a PB attachment.
		// Existing rows keep theirs.
		const file = media.fields.find((f) => f.name === 'file');
		if (file) file.required = false;

		app.save(media);
	},
	(app) => {
		let media;
		try {
			media = app.findCollectionByNameOrId('geisha_media');
		} catch {
			return;
		}
		if (!media) return;

		for (const name of ['url', 'variants']) {
			const f = media.fields.find((x) => x.name === name);
			if (f) media.fields.removeById(f.id);
		}
		// Deliberately NOT restoring file.required: rows created while this migration
		// was applied have no attachment, and flipping it back would make them invalid.

		app.save(media);
	}
);
