// Regression guard for the "unverified webhook" hole.
//
// WHAT WENT WRONG
// ---------------
// Both webhook routes gated their production behaviour on
// `env.PUBLIC_GO_LIVE === 'true'`, read from `$env/dynamic/private`. That module
// EXCLUDES every name beginning with SvelteKit's publicPrefix (`PUBLIC_`), so the
// value was ALWAYS undefined and the guard never fired.
//
// The effect on the deployed site: with no signing secret configured, the endpoint
// accepted unsigned POSTs and processed them — and this one confirms bookings out
// of `pending_payment`. Proven against production, where an empty `{}` body to the
// (now-removed) Dojo webhook returned 200. Setting PUBLIC_GO_LIVE=true in the
// Vercel dashboard changed nothing, which is how it was found.
//
// The fix is to gate on `dev` from `$app/environment` — true only under
// `vite dev`, false in every built artefact — so there is no variable to forget,
// misname, or set on the wrong environment.
//
// These tests assert the SHAPE of that fix rather than mocking SvelteKit's env
// modules: the bug was invisible to unit tests precisely because it lived in how
// the environment was read, so what needs locking down is that the route never
// reads a PUBLIC_ name from the private env module again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROUTES = ['stripe'] as const;

const source = (name: string) => readFileSync(join(here, name, '+server.ts'), 'utf8');

describe.each(ROUTES)('%s webhook — signature guard', (route) => {
	const src = source(route);

	it('does not read a PUBLIC_ variable from $env/dynamic/private', () => {
		// The exact bug. `$env/dynamic/private` silently omits these, so any such
		// read is undefined at runtime and every comparison against it is false.
		const importsPrivateEnv = /from\s+'\$env\/dynamic\/private'/.test(src);
		const readsPublicName = /\benv\.PUBLIC_[A-Z0-9_]+/.test(src);
		expect(importsPrivateEnv && readsPublicName).toBe(false);
	});

	it('gates the unverified path on `dev`, not on an environment flag', () => {
		expect(src).toMatch(/from\s+'\$app\/environment'/);
		expect(src).toMatch(/if\s*\(!dev\)\s*throw error\(503/);
	});

	it('refuses to run without a secret before it can reach any processing', () => {
		// The 503 must sit inside the `if (!secret)` branch and before the parse,
		// so an unsigned body is never even read as JSON in a deployed build.
		const guard = src.indexOf('if (!dev) throw error(503');
		const parse = src.indexOf('JSON.parse(raw)');
		expect(guard).toBeGreaterThan(-1);
		expect(parse).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(parse);
	});

	it('still rejects a bad signature with 401 when a secret IS set', () => {
		expect(src).toMatch(/error\(401, 'Invalid webhook signature'\)/);
	});
});
