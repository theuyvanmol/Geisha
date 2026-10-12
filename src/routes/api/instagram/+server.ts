// GET /api/instagram: the latest posts for the "Keep it Social" strip.
//
// Uses the Instagram API with Instagram Login (graph.instagram.com). Needs a
// long-lived access token for the Instagram professional account in the
// INSTAGRAM_ACCESS_TOKEN environment variable (optionally INSTAGRAM_USER_ID too,
// which saves one lookup). The token never leaves the server.
//
// Only the media itself is requested: no captions, likes, comments or counts,
// so the strip shows just the photo or reel. Responses are cached here and at
// the CDN for 10 minutes, so new posts appear on the site shortly after posting.
//
// Tokens from the Meta App Dashboard last 60 days; refresh or replace the token
// before it expires, or the strip quietly shows nothing.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export type InstagramPost = {
	id: string;
	kind: 'image' | 'video';
	/** Image to show: the photo, or the reel's cover image. */
	image: string;
	/** Reel video file, when Instagram provides one (it doesn't for reels with licensed music). */
	video?: string;
	/** Link to the post on Instagram. */
	href: string;
};

type MediaItem = {
	id: string;
	media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
	media_url?: string;
	thumbnail_url?: string;
	permalink: string;
};

const API = 'https://graph.instagram.com/v25.0';
const FIELDS = 'id,media_type,media_url,thumbnail_url,permalink';
const LIMIT = 12;
const TTL_MS = 10 * 60 * 1000;

let cache: { at: number; posts: InstagramPost[] } | null = null;
let userId: string | null = null;

function toPost(m: MediaItem): InstagramPost | null {
	if (m.media_type === 'VIDEO') {
		const image = m.thumbnail_url;
		if (!image) return null;
		return { id: m.id, kind: 'video', image, video: m.media_url, href: m.permalink };
	}
	if (!m.media_url) return null;
	return { id: m.id, kind: 'image', image: m.media_url, href: m.permalink };
}

export const GET: RequestHandler = async ({ fetch, setHeaders }) => {
	setHeaders({ 'cache-control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400' });

	const token = env.INSTAGRAM_ACCESS_TOKEN;
	if (!token) return json({ posts: [] });
	if (cache && Date.now() - cache.at < TTL_MS) return json({ posts: cache.posts });

	try {
		const auth = `access_token=${encodeURIComponent(token)}`;
		if (!userId) userId = env.INSTAGRAM_USER_ID || null;
		if (!userId) {
			const me = await fetch(`${API}/me?fields=user_id&${auth}`);
			if (!me.ok) throw new Error(`Instagram /me ${me.status}`);
			userId = String((await me.json()).user_id);
		}

		const res = await fetch(`${API}/${userId}/media?fields=${FIELDS}&limit=${LIMIT}&${auth}`);
		if (!res.ok) throw new Error(`Instagram media ${res.status}`);
		const body: { data?: MediaItem[] } = await res.json();

		const posts = (body.data ?? []).map(toPost).filter((p): p is InstagramPost => p !== null);
		cache = { at: Date.now(), posts };
		return json({ posts });
	} catch (err) {
		console.error('[instagram]', err instanceof Error ? err.message : err);
		// Serve the last good feed if we have one; otherwise the strip hides itself.
		return json({ posts: cache?.posts ?? [] });
	}
};
