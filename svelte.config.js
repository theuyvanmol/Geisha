import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// PERF: pin the serverless functions to London (lhr1) so they sit next to the
		// PocketBase droplet (pmm.gtdigital.dev → 206.189.150.23, DO LON1). Without
		// this, Vercel defaults to iad1 (US-East) and EVERY PocketBase round-trip
		// crosses the Atlantic (~85ms each) — the admin diary makes ~15-20 serial
		// round-trips per load and each mutation ~20-30, so the region mismatch alone
		// turned ~150ms actions into ~2s. Co-locating drops each round-trip to a few ms
		// and is why the deployed admin was far slower than local dev (which already
		// runs from the UK, next to the droplet).
		adapter: adapter({ regions: ['lhr1'] })
	}
};

export default config;
