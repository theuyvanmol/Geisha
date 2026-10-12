// Cloudflare R2 — object storage for the site's photo/video library.
//
// Replaces storing uploads as PocketBase `file` attachments on the droplet's
// local disk. Two things that bought us:
//
//   • The 1 GB shared droplet is no longer the origin for every image on the
//     site, so media traffic can't starve PocketBase of memory or bandwidth.
//   • R2 charges *nothing* for egress, so a busy Saturday can't produce a bill.
//     Storage is ~$0.015/GB/month beyond a 10 GB free allowance.
//
// Speaks S3 over aws4fetch rather than @aws-sdk/client-s3: the AWS SDK is ~3 MB
// and would dominate cold-start time on a Vercel function, and we need exactly
// three verbs.
//
// The bucket lives in Cloudflare's EU jurisdiction, so the endpoint is
// <account>.EU.r2cloudflarestorage.com — the default endpoint 403s. It's read
// from R2_ENDPOINT rather than rebuilt here so that stays impossible to get
// wrong.

import { AwsClient } from 'aws4fetch';
import { env } from '$env/dynamic/private';
import { env as pub } from '$env/dynamic/public';

const missing = (k: string): never => {
	throw new Error(`R2 is not configured: ${k} is unset. See .env.example.`);
};

const endpoint = () => (env.R2_ENDPOINT ?? '').replace(/\/$/, '') || missing('R2_ENDPOINT');
const bucket = () => env.R2_BUCKET || missing('R2_BUCKET');

/** True when every R2 var is present — lets callers fall back instead of throwing. */
export const isConfigured = (): boolean =>
	Boolean(env.R2_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);

let cached: AwsClient | null = null;
function client(): AwsClient {
	if (cached) return cached;
	cached = new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID || missing('R2_ACCESS_KEY_ID'),
		secretAccessKey: env.R2_SECRET_ACCESS_KEY || missing('R2_SECRET_ACCESS_KEY'),
		service: 's3',
		region: 'auto'
	});
	return cached;
}

const objectUrl = (key: string) => `${endpoint()}/${bucket()}/${key}`;

/**
 * The public URL for a key — what gets stored in the content blob and rendered.
 *
 * This is the bucket's *public* hostname (r2.dev or a custom domain), NOT the S3
 * endpoint: the S3 endpoint requires a signature on every request, so an <img
 * src> pointing at it would 403.
 */
export function publicUrl(key: string): string {
	const base = (pub.PUBLIC_MEDIA_BASE ?? '').replace(/\/$/, '');
	if (!base) missing('PUBLIC_MEDIA_BASE (enable Public access on the bucket)');
	return `${base}/${key}`;
}

/**
 * The object key behind a public URL — the inverse of publicUrl().
 *
 * Returns undefined for anything not served from our bucket (a legacy
 * PocketBase attachment, an external link), so callers can skip it rather than
 * trying to delete someone else's file.
 */
export function keyFromUrl(url: string | undefined): string | undefined {
	if (!url) return undefined;
	const base = (pub.PUBLIC_MEDIA_BASE ?? '').replace(/\/$/, '');
	if (!base || !url.startsWith(`${base}/`)) return undefined;
	const key = url.slice(base.length + 1).split('?')[0];
	return key || undefined;
}

/** Upload one object. `cacheControl` defaults to immutable — keys are content-addressed. */
export async function put(
	key: string,
	body: Uint8Array | ArrayBuffer | Blob,
	contentType: string,
	cacheControl = 'public, max-age=31536000, immutable'
): Promise<string> {
	const res = await client().fetch(objectUrl(key), {
		method: 'PUT',
		body: body as BodyInit,
		headers: { 'content-type': contentType, 'cache-control': cacheControl }
	});
	if (!res.ok) {
		throw new Error(`R2 PUT ${key} failed: ${res.status} ${await res.text().catch(() => '')}`);
	}
	return publicUrl(key);
}

/** Delete one object. A missing key is not an error. */
export async function del(key: string): Promise<void> {
	const res = await client().fetch(objectUrl(key), { method: 'DELETE' });
	if (!res.ok && res.status !== 404) {
		throw new Error(`R2 DELETE ${key} failed: ${res.status}`);
	}
}

/** Every key under a prefix, following pagination. */
export async function list(prefix = ''): Promise<string[]> {
	const keys: string[] = [];
	let token: string | undefined;

	do {
		const qs = new URLSearchParams({ 'list-type': '2', prefix });
		if (token) qs.set('continuation-token', token);

		const res = await client().fetch(`${endpoint()}/${bucket()}?${qs}`);
		if (!res.ok) throw new Error(`R2 LIST failed: ${res.status}`);

		const xml = await res.text();
		for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
		// Truncated responses carry the cursor for the next page.
		token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
			? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
			: undefined;
	} while (token);

	return keys;
}
