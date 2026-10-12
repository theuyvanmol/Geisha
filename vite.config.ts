import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],

	server: {
		// One dev server, always at the same address. `strictPort` is the important
		// half: Vite's default is to silently take the NEXT free port when 5188 is
		// busy, so a second `npm run dev` used to succeed on 5189, 5190, ... Nothing
		// ever reported a duplicate, and each extra server re-ran the warmup below
		// (the heaviest transform in the app) and added another full-tree file
		// watcher — which is what ground the machine to a halt. Now a second start
		// fails loudly instead, and everything can rely on http://localhost:5188.
		//
		// 5188 is Geisha's own port: 5173 is Vite's default and gets claimed by
		// whichever project boots first (usually British Learning Centre).
		port: 5188,
		strictPort: true,

		// PERF (dev only): the Service pages are the heaviest components in the app —
		// diary/+page.svelte alone is ~8.7k lines, and Vite's cold transform of it
		// takes ~5s, emitting a ~1MB dev module before the browser even starts on its
		// imports. Vite compiles on demand, so that whole cost landed on the FIRST
		// click of "Diary" (the click appeared to do nothing — hence double-clicking),
		// and then vanished once the module was cached.
		//
		// Warming pre-transforms both routes in the background as soon as `vite dev`
		// boots, so by the time anyone opens Service the module is already cached and
		// the click is instant. Dev-server only: it has no effect on the production
		// build, which pays the equivalent cost as a 142kB JS + 57kB CSS chunk
		// download — that one is fixed by splitting the component up, not here.
		warmup: {
			clientFiles: [
				'./src/routes/admin/**/diary/+page.svelte',
				'./src/routes/admin/**/floor/+page.svelte'
			],
			ssrFiles: [
				'./src/routes/admin/**/diary/+page.server.ts',
				'./src/routes/admin/**/floor/+page.server.ts'
			]
		}
	},

	// `vite preview` gets the same treatment, for the same reason.
	preview: {
		port: 4188,
		strictPort: true
	}
});
