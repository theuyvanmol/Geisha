// Training-domain tools for the admin assistant: explain_page + start_tour.
//
// The onboarding surface of the assistant. Both are grounded in client-safe data
// modules so there's a single source of truth shared with the UI:
//   · explain_page (READ) → returns the per-page training entry (title, what it's
//     for, key tasks, tips) from src/lib/admin/trainingContent.ts, so the model can
//     narrate "what is this page and how do I use it?" from real, curated content
//     rather than guessing. Optional `pageKey`; when omitted it falls back to the
//     page the operator is on (the server passes that in via the system prompt /
//     the caller can pass it) — but since the tool has no request context for the
//     current page, the model should pass the pageKey it was told about.
//   · start_tour (UI) → asks the client to launch a scripted guided tour. Like
//     navigate_to it auto-runs and pushes a UiDirective { tool:'start_tour', input,
//     result:{ kind:'start-tour', tourId } }; the shared store (assistant.svelte.ts
//     applyDirectives) has an explicit 'start-tour' case that dynamically imports
//     the training store and calls startTour(tourId).
//
// Server-only; registered in the composer (./index.ts). Kept in its OWN factory so
// each stream's tools stay disjoint and easy to merge. It imports ONLY the two
// client-safe data modules (trainingContent.ts / tours.ts) — no $lib/server data.

import type { GeminiTool, ToolContext } from './types.js';
import { explainFor, TRAINING } from '$lib/admin/trainingContent';
import { TOURS, TOUR_IDS, tourById } from '$lib/admin/tours';

const PAGE_KEYS = Object.keys(TRAINING);

/** Training-domain tools (page explanations + guided tours). */
export function trainingTools(_ctx: ToolContext): GeminiTool[] {
	return [
		{
			name: 'explain_page',
			kind: 'read',
			description:
				`Explain what an admin page is for and how to use it — a short, curated walkthrough (what it's for, the key tasks staff do there, and practical tips). Use this when the operator seems unsure, asks "what does this page do / how do I use this / what is this for", or is clearly new. Pass \`pageKey\` for the page they mean (one of: ${PAGE_KEYS.join(', ')}); if they just say "this page", pass the key for the page they're currently on. Present the result as a friendly explanation, not a raw dump. This only reads curated help text — it changes nothing and reads no live data.`,
			parameters: {
				type: 'object',
				properties: {
					pageKey: {
						type: 'string',
						enum: PAGE_KEYS,
						description:
							'Which admin page to explain. Defaults to the generic overview if omitted or unknown.'
					}
				},
				required: []
			},
			run: async ({ pageKey }: { pageKey?: string }) => {
				const entry = explainFor(pageKey);
				return {
					pageKey: pageKey && PAGE_KEYS.includes(pageKey) ? pageKey : 'other',
					title: entry.title,
					whatItIsFor: entry.whatItIsFor,
					keyTasks: entry.keyTasks,
					tips: entry.tips
				};
			}
		},
		{
			name: 'start_tour',
			kind: 'ui',
			description:
				`Launch an interactive guided tour that walks the operator through a task step-by-step on the real pages (navigating and spotlighting controls as it goes). Use this when a NEW or unsure operator would benefit from a hands-on walkthrough rather than a text explanation — offer it explicitly ("want me to walk you through it?") and start it when they say yes. tourId must be one of: ${TOUR_IDS.join(', ')} — respectively: take a phone booking, handle a walk-in, add a closure, set up a deposit rule, read the diary during service, change site content. Some tours need a manager/host role; if the operator lacks it the client quietly declines. It only starts the tour UI — it changes no data.`,
			parameters: {
				type: 'object',
				properties: {
					tourId: {
						type: 'string',
						enum: TOUR_IDS,
						description: 'Which guided tour to start. One of the listed ids.'
					}
				},
				required: ['tourId']
			},
			run: async ({ tourId }: { tourId: string }) => {
				const tour = tourById(tourId);
				if (!tour) {
					return {
						kind: 'start-tour',
						ok: false,
						error: `Unknown tour "${tourId}". Valid tours: ${TOUR_IDS.join(', ')}.`
					};
				}
				return {
					kind: 'start-tour',
					ok: true,
					tourId: tour.id,
					title: tour.title,
					description: tour.description,
					role: tour.role,
					steps: tour.steps.length
				};
			}
		}
	];
}

/** All authored tours, for callers that want the catalogue (e.g. the system prompt). */
export { TOURS };
