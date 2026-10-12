// Guided-tour runtime store for the admin onboarding system.
//
// A DELIBERATELY SEPARATE client rune singleton from the assistant store
// (assistant.svelte.ts) so the training feature never contends with that file —
// it owns only the active tour, the step cursor, and per-staff completion. The
// TourRunner.svelte component binds to it; the assistant's start_tour UI directive
// calls startTour() via a dynamic import (kept minimal to avoid coupling).
//
// ⚠️ CLIENT-ONLY. A module-level rune singleton is shared across ALL server
// requests if imported on the server, so this file MUST NOT be imported from any
// +server.ts / load / hooks. It is referenced only from .svelte components and the
// assistant store's applyDirectives branch (which runs client-side).
//
// Navigation: entering a step that carries a `path` routes there via goto (keeping
// the current ?brand). Role-guarding: startTour refuses a tour above the current
// staff role (read from page.data.staff — the same source the shell uses). Progress
// persists per staff in localStorage key `geisha.training.<staffId>`.

import { browser } from '$app/environment';
import { page } from '$app/state';
import { goto } from '$app/navigation';
import type { StaffRole } from '$lib/server/db/types';
import { TOURS, tourById, type Tour } from './tours';

// Role ranking mirrors src/lib/server/auth/rbac.ts (owner>manager>host>server).
const RANK: Record<StaffRole, number> = { owner: 4, manager: 3, host: 2, server: 1 };
function rank(role: StaffRole | '' | undefined | null): number {
	return role && role in RANK ? RANK[role as StaffRole] : 0;
}

/** The signed-in staff member as the shell's layout load exposes them. */
type Staff = { id?: string; role?: StaffRole } | null | undefined;
function currentStaff(): Staff {
	return (page.data as { staff?: Staff } | undefined)?.staff ?? null;
}

/** The active brand, read from the current URL (?brand=asia|fusion) — appended to
 *  step paths so a tour keeps the operator in the same restaurant. */
function currentBrandQuery(): string {
	const b = page.url?.searchParams.get('brand');
	return b ? `?brand=${b}` : '';
}

const STORAGE_PREFIX = 'geisha.training.';
function storageKey(): string | null {
	const id = currentStaff()?.id;
	return id ? `${STORAGE_PREFIX}${id}` : null;
}

// --- state (the singleton) ----------------------------------------------------
let activeTour = $state<Tour | null>(null);
let stepIndex = $state(0);
// Set of completed tour ids for the current staff member, hydrated from storage.
let completedTours = $state<Set<string>>(new Set());
// The staff id the completion set was hydrated for, so we re-hydrate if it changes.
let hydratedFor = $state<string | null>(null);

// --- persistence --------------------------------------------------------------
function loadCompleted(): void {
	if (!browser) return;
	const key = storageKey();
	if (!key) {
		completedTours = new Set();
		hydratedFor = null;
		return;
	}
	try {
		const raw = localStorage.getItem(key);
		const ids = raw ? (JSON.parse(raw) as unknown) : [];
		completedTours = new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
	} catch {
		completedTours = new Set();
	}
	hydratedFor = currentStaff()?.id ?? null;
}

function persistCompleted(): void {
	if (!browser) return;
	const key = storageKey();
	if (!key) return;
	try {
		localStorage.setItem(key, JSON.stringify([...completedTours]));
	} catch {
		/* private mode / disabled storage — ignore */
	}
}

// A module-level $effect (root-scoped so it lives outside any component) keeps the
// completion set in sync with the signed-in staff member: whenever page.data.staff
// changes, we re-hydrate from that member's localStorage key. This replaces the old
// lazy ensureHydrated()-on-read pattern, which mutated $state while a $derived was
// computing (progress()/isComplete() are called inside `$derived(...)`) and tripped
// Svelte's state_unsafe_mutation guard. Doing it in an effect keeps reads pure.
if (browser) {
	$effect.root(() => {
		$effect(() => {
			const id = currentStaff()?.id ?? null;
			if (id !== hydratedFor) loadCompleted();
		});
	});
}

// --- navigation between steps -------------------------------------------------
/** Enter a step: if it declares a path, navigate there (preserving ?brand) unless
 *  we're already on it. Guarded to the client. */
function enterStep(i: number): void {
	const tour = activeTour;
	if (!tour) return;
	const step = tour.steps[i];
	if (!step) return;
	if (browser && step.path) {
		const href = step.path + currentBrandQuery();
		if (page.url?.pathname !== step.path) {
			// Fire-and-forget; the runner re-renders on the same activeTour/stepIndex.
			void goto(href);
		}
	}
}

// --- public API ---------------------------------------------------------------
/**
 * Start a tour by id. Role-guarded: refuses (returns false) if the tour needs a
 * higher role than the signed-in staff member has, or if the id is unknown. On
 * success sets the active tour, resets the cursor to step 0, and navigates to the
 * first step's page if it has one.
 */
function startTour(id: string): boolean {
	const tour = tourById(id);
	if (!tour) return false;
	if (rank(currentStaff()?.role) < rank(tour.role)) return false;
	activeTour = tour;
	stepIndex = 0;
	enterStep(0);
	return true;
}

/** Advance to the next step, or finish (marking complete) if on the last one. */
function nextStep(): void {
	if (!activeTour) return;
	if (stepIndex >= activeTour.steps.length - 1) {
		finishTour();
		return;
	}
	stepIndex += 1;
	enterStep(stepIndex);
}

/** Step back (no-op on the first step). */
function prevStep(): void {
	if (!activeTour || stepIndex <= 0) return;
	stepIndex -= 1;
	enterStep(stepIndex);
}

/** Mark the active tour complete and close the runner. */
function finishTour(): void {
	if (activeTour) markTourComplete(activeTour.id);
	activeTour = null;
	stepIndex = 0;
}

/** Close the runner WITHOUT marking the tour complete (the Exit button). */
function exitTour(): void {
	activeTour = null;
	stepIndex = 0;
}

/** Record a tour id as completed for the current staff member (persisted). */
function markTourComplete(id: string): void {
	if (completedTours.has(id)) return;
	completedTours = new Set([...completedTours, id]);
	persistCompleted();
}

/** Whether a tour id has been completed by the current staff member. */
function isComplete(id: string): boolean {
	return completedTours.has(id);
}

/** Overall progress across the tours THIS staff member is allowed to take. */
function progress(): { done: number; total: number } {
	const myRank = rank(currentStaff()?.role);
	const eligible = TOURS.filter((t) => myRank >= rank(t.role));
	const done = eligible.filter((t) => completedTours.has(t.id)).length;
	return { done, total: eligible.length };
}

/** Hydrate the completion set from storage (call once on the client, e.g. onMount
 *  of the runner or the checklist page). */
function hydrate(): void {
	loadCompleted();
}

// The exported singleton. Getters expose reactive state to .svelte components;
// methods mutate it. Importing this object subscribes the reader to the runes.
export const training = {
	get activeTour() {
		return activeTour;
	},
	get stepIndex() {
		return stepIndex;
	},
	/** The current step object, or null when no tour is running. */
	get currentStep() {
		return activeTour ? (activeTour.steps[stepIndex] ?? null) : null;
	},
	/** 1-based "n / total" position for the runner header. */
	get position(): { n: number; total: number } {
		return activeTour ? { n: stepIndex + 1, total: activeTour.steps.length } : { n: 0, total: 0 };
	},
	/** The completed-tour id set (reactive). */
	get completedTours() {
		return completedTours;
	},
	startTour,
	nextStep,
	prevStep,
	exitTour,
	finishTour,
	markTourComplete,
	isComplete,
	progress,
	hydrate
};
