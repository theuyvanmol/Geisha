// Just-uploaded files, remembered for this browser session.
//
// An upload's R2 object is not reliably fetchable the instant the POST returns —
// the CDN in front of the bucket can still be serving (and briefly caching) a
// miss. Every admin surface that showed the new picture straight away therefore
// rendered a blank box: the picker tile, the gallery grid, the edit modal's big
// preview. Refreshing a minute later fixed it, which is not an explanation staff
// should ever need.
//
// The browser already has the bytes — it just uploaded them — so the upload
// records an object URL here against the canonical R2 url, and adminPreview() /
// adminThumb() prefer it. Module scope, not component state, so it survives the
// picker closing and is visible to the gallery editor behind it.
//
// Not revoked: these are a handful of small object URLs per session, and the
// alternative (revoking on unmount) is what put the blank tiles back. The map is
// gone on the next page load, by which point the CDN is serving the real file.
//
// Server-side this map is simply always empty — nothing calls remember() there.

const local = new Map<string, string>();

/** Record the in-memory copy of a file just uploaded to `url`. */
export function rememberLocalPreview(url: string, objectUrl: string): void {
	if (url && objectUrl) local.set(url, objectUrl);
}

/** The in-memory copy for `url`, if it was uploaded in this session. */
export function localPreview(url: string | undefined): string | undefined {
	return url ? local.get(url) : undefined;
}
