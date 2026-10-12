/**
 * Sync static/media/ -> the R2 bucket.
 *
 * Keys mirror the public paths exactly ("media/foo-640.avif"), so
 * PUBLIC_MEDIA_BASE + the URL already in the manifest resolves with no rewriting
 * — the same manifest serves local files in dev and the CDN in production.
 *
 * Skips keys already present, so re-running after adding photos only uploads the
 * new ones. Objects are sent immutable: every filename encodes its width and
 * format, so a given key's bytes never change.
 *
 *   node --env-file=.env scripts/upload-r2.mjs
 *   node --env-file=.env scripts/upload-r2.mjs --force   # re-upload everything
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';

const SRC = 'static/media';
const PREFIX = 'media';
const CONCURRENCY = 8;
const FORCE = process.argv.includes('--force');

const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
for (const [k, v] of Object.entries({ R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY })) {
	if (!v) {
		console.error(`${k} is unset. Run with:  node --env-file=.env scripts/upload-r2.mjs`);
		process.exit(1);
	}
}

const endpoint = R2_ENDPOINT.replace(/\/$/, '');
const client = new AwsClient({
	accessKeyId: R2_ACCESS_KEY_ID,
	secretAccessKey: R2_SECRET_ACCESS_KEY,
	service: 's3',
	region: 'auto'
});

const TYPES = {
	'.avif': 'image/avif',
	'.webp': 'image/webp',
	'.mp4': 'video/mp4',
	'.jpg': 'image/jpeg',
	'.png': 'image/png'
};

async function listRemote() {
	const keys = new Set();
	let token;
	do {
		const qs = new URLSearchParams({ 'list-type': '2', prefix: PREFIX });
		if (token) qs.set('continuation-token', token);
		const res = await client.fetch(`${endpoint}/${R2_BUCKET}?${qs}`);
		if (!res.ok) throw new Error(`LIST failed: ${res.status} ${await res.text()}`);
		const xml = await res.text();
		for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.add(m[1]);
		token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
			? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
			: undefined;
	} while (token);
	return keys;
}

async function main() {
	const files = (await readdir(SRC)).filter((f) => TYPES[path.extname(f).toLowerCase()]);
	if (!files.length) return console.log(`Nothing in ${SRC}/ to upload.`);

	console.log(`${files.length} local files. Checking what's already on R2...`);
	const remote = FORCE ? new Set() : await listRemote();

	const todo = files.filter((f) => !remote.has(`${PREFIX}/${f}`));
	if (!todo.length) {
		console.log(`All ${files.length} already on R2. Nothing to do.`);
		return;
	}
	console.log(`Uploading ${todo.length} (${files.length - todo.length} already there)\n`);

	let done = 0;
	let bytes = 0;
	let failed = 0;

	// Fixed pool of workers pulling off a shared cursor — simplest way to cap
	// concurrency without a dependency.
	let cursor = 0;
	const worker = async () => {
		while (cursor < todo.length) {
			const file = todo[cursor++];
			const key = `${PREFIX}/${file}`;
			const body = await readFile(path.join(SRC, file));
			const type = TYPES[path.extname(file).toLowerCase()];

			const res = await client.fetch(`${endpoint}/${R2_BUCKET}/${key}`, {
				method: 'PUT',
				body,
				headers: {
					'content-type': type,
					// Filenames encode width+format, so bytes for a key never change.
					'cache-control': 'public, max-age=31536000, immutable'
				}
			});

			if (!res.ok) {
				failed++;
				console.error(`  FAIL ${key} -> ${res.status} ${await res.text().catch(() => '')}`);
				continue;
			}
			bytes += body.length;
			if (++done % 50 === 0 || done === todo.length) {
				console.log(`  ${done}/${todo.length}  (${(bytes / 1e6).toFixed(1)} MB)`);
			}
		}
	};

	await Promise.all(Array.from({ length: CONCURRENCY }, worker));

	const total = (await Promise.all(files.map(async (f) => (await stat(path.join(SRC, f))).size))).reduce(
		(a, b) => a + b,
		0
	);

	console.log(`\n  uploaded  ${done} objects, ${(bytes / 1e6).toFixed(1)} MB`);
	if (failed) console.log(`  FAILED    ${failed}`);
	console.log(`  bucket    ${R2_BUCKET} now holds ${(total / 1e6).toFixed(1)} MB of media`);
	console.log(`\n  Free tier is 10 GB — that's ${((total / 1e9 / 10) * 100).toFixed(1)}% of it.`);
}

await main();
