// Shared admin-assistant rune store (WP-S6-5).
//
// ONE conversation, ONE proposed-action state, ONE widget set — shared by the
// persistent dock (AssistantDock.svelte mounted in the admin shell), the
// Cmd/Ctrl-K command bar (which focuses/opens that dock) and the full-page
// /admin/assistant view. Because SvelteKit keeps the +layout.svelte instance
// mounted across client-side navigation, this module-level singleton survives
// navigation: open the dock on /admin/floor, send a message, navigate to
// /admin/diary and the conversation is still there.
//
// ⚠️ CLIENT-ONLY. A module-level rune singleton is shared across ALL requests
// when imported on the server, so this file MUST NOT be imported from any
// +server.ts / load function / hooks. It is referenced only from .svelte
// components (the dock, command bar and assistant page), which run per-client.
// The fetch contract is identical to the original assistant/+page.svelte.

import { browser } from '$app/environment';
import { page } from '$app/state';
import { invalidateAll, goto } from '$app/navigation';
import type { Widget } from '../../routes/admin/assistant/SettingWidget.svelte';
import type { ContentWidgetDescriptor } from '../components/admin/ContentWidget.svelte';
import { pageMetaFor, type Suggestion } from './pageContext';

export type Msg = { role: 'user' | 'assistant'; content: string };
/** A dismissable visual result card spawned by a render-only UI tool (show_bookings
 *  / show_report — see tools/toolsCards.ts). Any directive whose result carries a
 *  `.kind` we don't otherwise route (not open_settings/open_content/navigate_to)
 *  becomes one of these, de-duped by (kind + a natural key like the date/range). */
export type ResultCard = { key: string; kind: string; result: unknown };
/** How firmly the operator must confirm a write: a normal click, or a typed word
 *  (high-blast-radius / destructive). Derived from the tool + DESTRUCTIVE_PREFIX. */
export type ConfirmStrength = 'normal' | 'type';
export type Proposed = { tool: string; input: unknown; description: string };

// --- mf-autonomous-copilot ("Plan tonight") -----------------------------------
// The structured evening plan + its discrete, individually-confirm-gated checklist
// (assembled server-side by ai/copilot.ts, fetched via /api/admin/evening-plan).
// Mirrors EveningPlanItem/EveningPlan in copilot.ts — kept as a local type so the
// client never imports the $lib/server module.
export type PlanItem = {
	id: string;
	kind: 'seating' | 'risk' | 'message' | 'note';
	title: string;
	detail: string;
	action?: { tool: 'move_booking' | 'draft_message'; input: Record<string, unknown> };
	actionKind?: 'write' | 'read';
	link?: string;
};
export type EveningPlan = {
	brand: 'asia' | 'fusion';
	date: string;
	generatedAt: string;
	headline: string;
	narration: string;
	aiWritten: boolean;
	items: PlanItem[];
	stats: {
		totalBookings: number;
		totalCovers: number;
		seatingMoves: number;
		seatsFreed: number;
		highRisk: number;
		mediumRisk: number;
		allergyAlerts: number;
		vips: number;
		openAlerts: number;
	};
};
/** Per-item progress state in the dock's checklist. */
export type PlanItemStatus = 'pending' | 'busy' | 'applied' | 'skipped' | 'failed';

const DOCK_KEY = 'geisha.admin.assistant.dock';

// Contract with the destructive write tools (src/lib/server/ai/tools/types.ts
// DESTRUCTIVE_PREFIX). Inlined because that module lives under $lib/server and
// must not be pulled into the client bundle; keep this literal in sync with it.
const DESTRUCTIVE_PREFIX = 'DESTRUCTIVE:';
/** The word the operator must type to enable Confirm on a destructive write. */
export const CONFIRM_WORD = 'DELETE';

// --- core conversation state (the singleton) ----------------------------------
let messages = $state<Msg[]>([]);
let draft = $state('');
let loading = $state(false);
let configured = $state(true);
let proposed = $state<Proposed | null>(null);
// What the operator has typed into the type-to-confirm gate for the current
// destructive proposal. Reset whenever the proposal changes.
let confirmTyped = $state('');
let widgets = $state<Widget[]>([]);
// Inline content editors spawned by the assistant's open_content UI tool (the
// content analogue of `widgets`). Keyed by content key; latest proposal wins.
let contentWidgets = $state<ContentWidgetDescriptor[]>([]);
// Visual result cards spawned by render-only UI tools (show_bookings/show_report).
// De-duped by ResultCard.key (kind + natural key) so re-asking replaces the card
// rather than stacking duplicates; each is individually dismissable.
let resultCards = $state<ResultCard[]>([]);

// --- mf-autonomous-copilot ("Plan tonight") state -----------------------------
// The fetched evening plan (or null), a loading flag, an error line, and the
// per-item progress map keyed by item id. All confirm-gated: applying an item
// fires its own /api/admin-chat call (write → confirm path, read → ask path).
let eveningPlan = $state<EveningPlan | null>(null);
let planLoading = $state(false);
let planError = $state<string | null>(null);
let planStatus = $state<Record<string, PlanItemStatus>>({});

// --- surface state ------------------------------------------------------------
// Dock open/closed persists in localStorage; defaults closed (data-dense pages
// open collapsed — callers can force-collapse via collapseForDataDensePage()).
let dockOpen = $state(false);
// When the command bar opens it should focus the dock composer; this flag is a
// one-shot the dock watches to grab focus.
let focusRequest = $state(0);

function readDockPref(): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(DOCK_KEY) === 'open';
	} catch {
		return false;
	}
}

function persistDockPref(open: boolean): void {
	if (!browser) return;
	try {
		localStorage.setItem(DOCK_KEY, open ? 'open' : 'closed');
	} catch {
		/* private mode / disabled storage — ignore */
	}
}

/** The active brand, read from the current page URL (?brand=asia|fusion). */
function currentBrand(): 'asia' | 'fusion' {
	return (page.url?.searchParams.get('brand') as 'asia' | 'fusion') || 'asia';
}

/** Compact page context for the current route — sent with each ask so the model
 *  can bias toward the tools that matter on the page the operator is looking at. */
function currentPageContext(): { key: string; label: string } {
	const meta = pageMetaFor(page.url?.pathname);
	return { key: meta.key, label: meta.label };
}

/** Derive a stable de-dupe key for a result card from its kind + a natural key, so
 *  re-asking the same visual (same date / same range+metric) REPLACES the card
 *  rather than stacking a duplicate. Falls back to the kind alone. */
function resultCardKey(kind: string, r: Record<string, unknown>): string {
	if (kind === 'bookings-table') return `bookings:${String(r.date ?? '')}`;
	if (kind === 'report') return `report:${String(r.metric ?? '')}:${String(r.from ?? '')}:${String(r.to ?? '')}`;
	return kind;
}

/**
 * Route the UI directives produced by a turn to the right client surface:
 *  · `open_settings`  → setting widgets (de-duped by key).
 *  · `open_content`   → inline content editors (de-duped by key).
 *  · `navigate_to`    → an ACTION: goto(href) if it's not the current path (never a card).
 *  · `start_tour`     → an ACTION: launch a guided tour via the training store (never a card).
 *  · anything else whose result carries a `.kind` → a dismissable RESULT CARD
 *    (show_bookings / show_report), de-duped by (kind + natural key).
 */
function applyDirectives(directives: Array<{ tool: string; result: unknown }>): void {
	for (const d of directives) {
		if (d.tool === 'open_settings') {
			const incoming = (d.result as { widgets?: Widget[] })?.widgets ?? [];
			for (const w of incoming) {
				widgets = [...widgets.filter((x) => x.key !== w.key), w];
			}
		} else if (d.tool === 'open_content') {
			const w = (d.result as { widget?: ContentWidgetDescriptor })?.widget;
			if (w) {
				contentWidgets = [...contentWidgets.filter((x) => x.key !== w.key), w];
			}
		} else if (d.tool === 'navigate_to') {
			// Navigation is an action, not a card. Only route when we have a valid href
			// that differs from where we already are (no pointless same-page reload).
			const res = (d.result ?? {}) as { ok?: boolean; href?: string };
			const href = typeof res.href === 'string' ? res.href : '';
			if (res.ok !== false && href && browser && page.url?.pathname !== href) {
				goto(href);
			}
		} else if (d.tool === 'start_tour') {
			// --- admin-onboarding: launch a guided tour --------------------------
			// start_tour is an ACTION (like navigate_to), not a card. Kept as an
			// EXPLICIT case BEFORE the resultCards fallback so its {kind:'start-tour'}
			// result never becomes a dismissable card. The training store is a SEPARATE
			// client singleton — imported dynamically to keep the coupling minimal and
			// avoid pulling it into this module's graph unless a tour actually starts.
			const res = (d.result ?? {}) as { ok?: boolean; tourId?: string };
			const tourId = typeof res.tourId === 'string' ? res.tourId : '';
			if (res.ok !== false && tourId && browser) {
				import('./training.svelte')
					.then((m) => m.training.startTour(tourId))
					.catch(() => {
						/* training store unavailable — the assistant's text reply still stands */
					});
			}
		} else {
			// Any other UI directive that returns a shaped result with a `.kind` becomes
			// a visual result card (show_bookings / show_report).
			const res = (d.result ?? null) as Record<string, unknown> | null;
			const kind = res && typeof res.kind === 'string' ? res.kind : '';
			if (kind) {
				const key = resultCardKey(kind, res!);
				const card: ResultCard = { key, kind, result: res };
				resultCards = [...resultCards.filter((c) => c.key !== key), card];
			}
		}
	}
}

/** Dismiss a visual result card by its key. */
function dismissResultCard(key: string): void {
	resultCards = resultCards.filter((c) => c.key !== key);
}

/** A tool description with any DESTRUCTIVE_PREFIX removed (UI never shows it). */
function displayDescription(description: string): string {
	const d = description.trim();
	return d.startsWith(DESTRUCTIVE_PREFIX) ? d.slice(DESTRUCTIVE_PREFIX.length).trim() : d;
}

/**
 * How firmly a proposed write must be confirmed. 'type' (typed confirmation
 * required) when the tool description carries the DESTRUCTIVE_PREFIX, OR for the
 * one case a static prefix can't express: manage_floor with action:'delete'
 * (the same tool also does non-destructive create/update). Everything else is a
 * normal one-click confirm.
 */
function confirmStrength(p: Proposed): ConfirmStrength {
	if (p.description.trim().startsWith(DESTRUCTIVE_PREFIX)) return 'type';
	const i = (p.input ?? {}) as Record<string, unknown>;
	if (p.tool === 'manage_floor' && String(i.action) === 'delete') return 'type';
	return 'normal';
}

/**
 * Human-readable one-line summary of a proposed write — one branch per tool in
 * the S6 catalogue. Param keys MUST match each tool's `parameters` (toolsX.ts);
 * a renamed param would silently render blank, so this stays in lockstep with
 * the tool definitions. Falls back to the (prefix-stripped) tool description.
 */
function summarise(p: Proposed): string {
	const i = (p.input ?? {}) as Record<string, unknown>;
	const str = (v: unknown) => (v == null ? '' : String(v));
	const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : str(v));
	switch (p.tool) {
		// --- bookings ---------------------------------------------------------
		case 'create_booking':
			return `Book a party of ${str(i.partySize)} on ${str(i.date)} at ${str(i.time)}${
				i.name ? ` under ${str(i.name)}` : ''
			}`;
		case 'amend_booking': {
			const changes = [
				i.date != null ? `date → ${str(i.date)}` : '',
				i.time != null ? `time → ${str(i.time)}` : '',
				i.partySize != null ? `party → ${str(i.partySize)}` : ''
			].filter(Boolean);
			return `Amend booking ${str(i.bookingId)}${changes.length ? ` (${changes.join(', ')})` : ''}`;
		}
		case 'cancel_booking':
			return `Cancel booking ${str(i.bookingId)}`;
		case 'mark_no_show':
			return `Mark booking ${str(i.bookingId)} as a no-show`;
		case 'seat_booking':
			return `Seat booking ${str(i.bookingId)} at its table(s)`;
		case 'clear_table':
			return `Clear booking ${str(i.bookingId)} from its table(s)`;
		case 'seat_walkin':
			return `Seat a walk-in of ${str(i.partySize)} at table(s): ${list(i.tableIds)}`;
		// --- floor ------------------------------------------------------------
		case 'move_booking':
			return `Move booking ${str(i.bookingId)} to table(s): ${list(i.tableIds)}`;
		case 'join_tables':
			return `Join tables ${str(i.tableIdA)} + ${str(i.tableIdB)}`;
		case 'unjoin_tables':
			return `Unjoin tables ${str(i.tableIdA)} + ${str(i.tableIdB)}`;
		case 'create_table':
			return `Create table ${str(i.label)}${
				i.seatsMin != null || i.seatsMax != null
					? ` (seats ${str(i.seatsMin ?? '?')}–${str(i.seatsMax ?? '?')})`
					: ''
			}`;
		case 'update_table':
			return `Update table ${str(i.tableId)}`;
		case 'delete_table':
			return `DELETE table ${str(i.tableId)} — permanent`;
		case 'save_layout': {
			const n = Array.isArray(i.positions) ? i.positions.length : 0;
			return `Save floor layout (${n} table${n === 1 ? '' : 's'})`;
		}
		case 'set_shapes': {
			const n = Array.isArray(i.shapes) ? i.shapes.length : 0;
			return `Set ${n} shape${n === 1 ? '' : 's'} on floor ${str(i.floorId)}`;
		}
		case 'manage_floor':
			return String(i.action) === 'create'
				? `Create floor ${str(i.name)}`
				: String(i.action) === 'delete'
					? `DELETE floor ${str(i.floorId)} and its walls/zones`
					: `Update floor ${str(i.floorId)}`;
		// --- settings ---------------------------------------------------------
		case 'update_setting':
			return `Set “${str(i.key)}” to ${JSON.stringify(i.value)}`;
		// --- pacing rules (covers caps) ---------------------------------------
		case 'create_pacing_rule': {
			const caps = [
				i.maxCoversPerSlot != null ? `${str(i.maxCoversPerSlot)}/slot` : '',
				i.maxCoversPerPeriod != null ? `${str(i.maxCoversPerPeriod)}/service` : ''
			].filter(Boolean);
			const when = Array.isArray(i.days) && i.days.length ? ` on ${list(i.days)}` : '';
			return `Add a pacing cap${caps.length ? ` (${caps.join(', ')})` : ''}${when}`;
		}
		case 'delete_pacing_rule':
			return `Remove pacing rule ${str(i.id)}`;
		// --- payments ---------------------------------------------------------
		case 'refund_deposit':
			return `Refund ${
				i.amountPence != null && Number(i.amountPence) > 0
					? `£${(Number(i.amountPence) / 100).toFixed(2)}`
					: 'the full deposit'
			} on booking ${str(i.bookingId)}`;
		case 'release_hold':
			return `Release the no-show hold on booking ${str(i.bookingId)}`;
		default:
			return displayDescription(p.description);
	}
}

async function send(text: string, opts?: { voice?: boolean }): Promise<void> {
	const msg = text.trim();
	if (!msg || loading) return;
	const brand = currentBrand();
	draft = '';
	messages = [...messages, { role: 'user', content: msg }];
	proposed = null;
	confirmTyped = '';
	loading = true;

	try {
		const history = messages.slice(0, -1);
		const res = await fetch('/api/admin-chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				brand,
				message: msg,
				history,
				voice: opts?.voice,
				// Where the operator is right now — biases the system prompt server-side.
				page: currentPageContext()
			})
		});
		const data = await res.json();
		configured = data.configured ?? true;
		if (data.answer) messages = [...messages, { role: 'assistant', content: data.answer }];
		proposed = data.proposedAction ?? null;
		confirmTyped = '';
		applyDirectives(data.directives ?? []);
	} catch {
		messages = [
			...messages,
			{ role: 'assistant', content: 'Something went wrong. Please try again.' }
		];
	} finally {
		loading = false;
	}
}

/** True when the current proposal may be confirmed: nothing pending, not already
 *  in flight, and — for a destructive write — the confirm word has been typed.
 *  The server STILL re-validates the input independently; this is the UI gate. */
function canConfirm(): boolean {
	if (!proposed || loading) return false;
	if (confirmStrength(proposed) === 'type') {
		return confirmTyped.trim().toUpperCase() === CONFIRM_WORD;
	}
	return true;
}

async function confirm(): Promise<void> {
	// Re-check the gate here too, so a confirm() called programmatically (e.g. an
	// Enter keypress) can't bypass the typed confirmation on a destructive write.
	if (!canConfirm()) return;
	const brand = currentBrand();
	loading = true;
	const action = proposed!;
	proposed = null;
	confirmTyped = '';
	try {
		const res = await fetch('/api/admin-chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ brand, confirm: { tool: action.tool, input: action.input } })
		});
		const data = await res.json().catch(() => null);
		const ok = res.ok && (data?.ok ?? false);
		messages = [
			...messages,
			{ role: 'assistant', content: ok ? '✓ Done.' : 'That action failed.' }
		];
		// A confirmed WRITE changed server state — re-run the mounted page's loaders
		// so whatever admin page is open (floor, diary, tables…) reflects it.
		if (ok) await invalidateAll();
	} catch {
		messages = [...messages, { role: 'assistant', content: 'That action failed.' }];
	} finally {
		loading = false;
	}
}

function dismissProposed(): void {
	proposed = null;
	confirmTyped = '';
}

// --- mf-autonomous-copilot ("Plan tonight") ----------------------------------
//
// "Plan tonight" fetches ONE structured evening plan and renders it as a CHECKLIST
// in the dock. Each firable item is applied through its OWN /api/admin-chat call:
//   · a WRITE item (move_booking) → the confirm path (audited, actor='ai').
//   · a READ item (draft_message) → the ask path; the drafted copy comes back as a
//     normal assistant message for the manager to send from the Comms outbox.
// "Approve all" iterates and fires each item SEPARATELY — never a bulk commit.

/** Open the dock and load the evening plan for `date` (defaults to today, Europe/
 *  London). Manager+ only — the server endpoint re-asserts the role. */
async function planTonight(date?: string): Promise<void> {
	const brand = currentBrand();
	const day =
		date && /^\d{4}-\d{2}-\d{2}$/.test(date)
			? date
			: new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
	setDock(true);
	planError = null;
	planLoading = true;
	eveningPlan = null;
	planStatus = {};
	try {
		const res = await fetch(
			`/api/admin/evening-plan?brand=${brand}&date=${encodeURIComponent(day)}`
		);
		if (res.status === 401 || res.status === 403) {
			planError = 'Planning tonight needs a manager or owner sign-in.';
			return;
		}
		const data = await res.json().catch(() => null);
		if (data?.ok && data.plan) {
			eveningPlan = data.plan as EveningPlan;
			// seed every item pending
			const seed: Record<string, PlanItemStatus> = {};
			for (const it of eveningPlan.items) seed[it.id] = 'pending';
			planStatus = seed;
		} else {
			planError = data?.error || 'Could not assemble a plan for that date.';
		}
	} catch {
		planError = 'Could not reach the planner. Please try again.';
	} finally {
		planLoading = false;
	}
}

/** Fire ONE plan item through /api/admin-chat. WRITE items go through the confirm
 *  path; READ items (draft_message) through the ask path (the draft returns as an
 *  assistant message). Returns true on success. Each call is independently audited
 *  server-side; this NEVER bulk-commits. */
async function fireItem(item: PlanItem): Promise<boolean> {
	if (!item.action) return false;
	const brand = currentBrand();
	// WRITE → the confirm path (audited, actor='ai'); READ (draft_message) → the
	// directRead path (runs the one READ tool, no LLM) and returns the drafted copy.
	const body =
		item.actionKind === 'write'
			? { brand, confirm: { tool: item.action.tool, input: item.action.input } }
			: { brand, directRead: { tool: item.action.tool, input: item.action.input } };
	const res = await fetch('/api/admin-chat', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => null);
	const ok = res.ok && (data?.ok ?? false);
	if (item.actionKind === 'write') {
		// A confirmed write changed server state — reflect it on the open page.
		if (ok) await invalidateAll();
		return ok;
	}
	// READ (draft): surface the drafted copy as an assistant message.
	if (ok && data?.answer) {
		messages = [...messages, { role: 'assistant', content: data.answer }];
	}
	return ok;
}

/** Apply a single checklist item (its own confirm-gated call). */
async function applyPlanItem(item: PlanItem): Promise<void> {
	if (!item.action || planStatus[item.id] === 'busy') return;
	planStatus = { ...planStatus, [item.id]: 'busy' };
	try {
		const ok = await fireItem(item);
		planStatus = { ...planStatus, [item.id]: ok ? 'applied' : 'failed' };
	} catch {
		planStatus = { ...planStatus, [item.id]: 'failed' };
	}
}

/** Mark a checklist item skipped (no server call — just hides it from the run). */
function skipPlanItem(item: PlanItem): void {
	planStatus = { ...planStatus, [item.id]: 'skipped' };
}

/** Approve EVERY still-pending firable item — but each through its OWN audited
 *  confirm-gated call (sequential, fail-soft). NEVER a bulk silent commit. */
async function approveAllPlan(): Promise<void> {
	if (!eveningPlan) return;
	for (const item of eveningPlan.items) {
		if (!item.action) continue;
		const st = planStatus[item.id];
		if (st === 'applied' || st === 'skipped' || st === 'busy') continue;
		await applyPlanItem(item);
	}
}

/** Close the plan checklist (does not undo anything already applied). */
function dismissPlan(): void {
	eveningPlan = null;
	planError = null;
	planStatus = {};
}

function closeWidget(key: string): void {
	widgets = widgets.filter((w) => w.key !== key);
}

function closeContentWidget(key: string): void {
	contentWidgets = contentWidgets.filter((w) => w.key !== key);
}

/** A content editor saved — re-run the open page's loaders so any live preview /
 *  admin surface reflects the new content. */
async function onContentSaved(): Promise<void> {
	await invalidateAll();
}

function setDock(open: boolean): void {
	dockOpen = open;
	persistDockPref(open);
}

function toggleDock(): void {
	setDock(!dockOpen);
}

/** Open the dock and ask it to focus the composer (used by Cmd/Ctrl-K). */
function openCommandBar(): void {
	setDock(true);
	focusRequest++;
}

/** On data-dense pages, default the dock collapsed (only when no stored pref). */
function collapseForDataDensePage(): void {
	if (browser) {
		try {
			if (localStorage.getItem(DOCK_KEY) == null) dockOpen = false;
		} catch {
			dockOpen = false;
		}
	}
}

/** Hydrate the dock-open preference from localStorage (call once on the client). */
function hydrate(): void {
	dockOpen = readDockPref();
}

// The exported singleton. Getters expose reactive state to .svelte components;
// methods mutate it. Importing this object in a component subscribes that
// component to the runes it reads.
export const assistant = {
	get messages() {
		return messages;
	},
	get draft() {
		return draft;
	},
	set draft(v: string) {
		draft = v;
	},
	get loading() {
		return loading;
	},
	get configured() {
		return configured;
	},
	get proposed() {
		return proposed;
	},
	get confirmTyped() {
		return confirmTyped;
	},
	set confirmTyped(v: string) {
		confirmTyped = v;
	},
	/** 'type' when the current proposal needs a typed confirmation, else 'normal'. */
	get confirmStrength(): ConfirmStrength {
		return proposed ? confirmStrength(proposed) : 'normal';
	},
	/** Reactive: whether Confirm may fire right now (honours the typed gate). */
	get canConfirm(): boolean {
		return canConfirm();
	},
	get widgets() {
		return widgets;
	},
	/** Inline content editors opened by the assistant's open_content UI tool. */
	get contentWidgets() {
		return contentWidgets;
	},
	/** Visual result cards opened by render-only UI tools (show_bookings/show_report). */
	get resultCards() {
		return resultCards;
	},
	// mf-autonomous-copilot ("Plan tonight") reactive surface.
	get eveningPlan() {
		return eveningPlan;
	},
	get planLoading() {
		return planLoading;
	},
	get planError() {
		return planError;
	},
	/** Per-item status map (id → pending|busy|applied|skipped|failed). */
	get planStatus() {
		return planStatus;
	},
	get dockOpen() {
		return dockOpen;
	},
	get focusRequest() {
		return focusRequest;
	},
	/** Suggestion chips for the page the operator is currently on (reactive —
	 *  reads page.url.pathname, so it updates as they navigate). */
	get suggestions(): Suggestion[] {
		return pageMetaFor(page.url?.pathname).suggestions;
	},
	/** The friendly label of the current page (e.g. "Floor Editor"). */
	get pageLabel(): string {
		return pageMetaFor(page.url?.pathname).label;
	},
	summarise,
	displayDescription,
	send,
	confirm,
	dismissProposed,
	// mf-autonomous-copilot ("Plan tonight") methods.
	planTonight,
	applyPlanItem,
	skipPlanItem,
	approveAllPlan,
	dismissPlan,
	applyDirectives,
	dismissResultCard,
	closeWidget,
	closeContentWidget,
	onContentSaved,
	toggleDock,
	setDock,
	openCommandBar,
	collapseForDataDensePage,
	hydrate
};
