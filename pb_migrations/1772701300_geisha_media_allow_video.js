/// <reference path="../pb_data/types.d.ts" />

// mf-media-video — let staff upload VIDEOS (not just images) through the admin
// media picker, for the new Content → Media editor (landing/hero clips, plate
// motif). The geisha_media.file field shipped image-only with the default ~5MB
// cap (1772700400); both are too tight for video.
//
// This widens the existing field in place:
//   • mimeTypes += the common web video types (mp4/webm/ogg/quicktime)
//   • maxSize    = 200MB so a short hero clip uploads without rejection
//
// Idempotent: we rewrite the field's mimeTypes/maxSize to the target each run, so
// re-applying is a no-op. JSVM API only (mutate field, app.save), mirroring
// 1772701200. Existing image rows are untouched.

const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_SIZE = 200 * 1024 * 1024; // 200 MB per file

migrate(
	(app) => {
		// Guard: on a droplet where the media CMS was never set up (the creating
		// migration 1772700400 isn't applied), geisha_media doesn't exist — there's
		// nothing to widen, so this is a clean no-op rather than a boot-breaking throw.
		let media;
		try {
			media = app.findCollectionByNameOrId('geisha_media');
		} catch {
			return; // collection absent — nothing to do
		}
		if (!media) return;
		const file = media.fields.find((f) => f.name === 'file');
		if (!file) return; // unexpected shape — leave it untouched rather than throw

		file.mimeTypes = [...IMAGE_MIME, ...VIDEO_MIME];
		file.maxSize = MAX_SIZE;

		app.save(media);
	},
	(app) => {
		// Down: restore the original image-only whitelist + default cap (guarded).
		let media;
		try {
			media = app.findCollectionByNameOrId('geisha_media');
		} catch {
			return;
		}
		if (!media) return;
		const file = media.fields.find((f) => f.name === 'file');
		if (file) {
			file.mimeTypes = IMAGE_MIME;
			file.maxSize = 0;
			app.save(media);
		}
	}
);
