// POST /api/admin-chat — the admin assistant (Gemini, function-calling).
//
// Body (ask):     { brand, message, history? }
//   → runs the agent. Read tools auto-run; the first WRITE tool stops the loop
//     and comes back as `proposedAction` to confirm. UI tools (open_settings)
//     come back as `directives` so the page can spawn editable widgets.
// Body (confirm): { brand, confirm: { tool, input } }
//   → executes a previously-proposed write tool (audited as actor='ai').
//
// Admin-only in practice (auth deferred, BOOKING_SYSTEM_PLAN §11 — do not expose
// publicly). This is the sole staff assistant endpoint (the legacy Claude
// /api/ai concierge was retired in WP-S6-4).

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { runAgent, confirmTool } from '$lib/server/ai/geminiAgent.js';
import { adminTools, settingsCatalogue } from '$lib/server/ai/adminTools.js';
import { contentCatalogue } from '$lib/server/ai/tools/index.js';
import { requireRole, hasRole } from '$lib/server/auth/rbac.js';
import { guidanceForKey } from '$lib/admin/pageContext';
// admin-onboarding: tour ids for the TRAINING system-prompt block.
import { TOUR_IDS } from '$lib/admin/tours';
import type { RequestHandler } from './$types';

const Ask = z.object({
	brand: z.enum(['asia', 'fusion']),
	message: z.string().min(1).max(2000),
	history: z
		.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
		.max(20)
		.optional(),
	// Optional page context (which admin page the operator is on) so the system
	// prompt can bias toward the tools that matter there. Advisory only — every
	// tool stays available regardless; this never gates anything.
	page: z.object({ key: z.string().max(40), label: z.string().max(60) }).optional()
});

const Confirm = z.object({
	brand: z.enum(['asia', 'fusion']),
	// `input` MUST be an object (the tool parameters shape) — cheap first-line
	// defence. The authoritative re-check is validateToolInput inside confirmTool.
	confirm: z.object({ tool: z.string().min(1), input: z.record(z.string(), z.unknown()) })
});

// mf-autonomous-copilot: directly run a single READ tool by name with given input
// (no LLM loop). Used by the "Plan tonight" checklist to fire a draft_message item
// deterministically. Restricted to a small allow-list of safe READ tools below.
const DirectRead = z.object({
	brand: z.enum(['asia', 'fusion']),
	directRead: z.object({ tool: z.string().min(1), input: z.record(z.string(), z.unknown()) })
});

const Body = z.union([Confirm, DirectRead, Ask]);

/** READ tools the copilot checklist may fire directly (no model in the loop). Kept
 *  tight: only the comms drafter, which returns copy and writes/sends nothing. */
const DIRECT_READ_ALLOW = new Set(['draft_message']);

// --- Ask-path role gating (F1 RBAC matrix) ---------------------------------
// CRM / analytics READ tools expose guest PII and commercial figures, which the
// matrix reserves for manager+. On the Ask path (the LLM loop) we can't gate at
// call time, so we DENYLIST these sensitive reads out of the tool set handed to a
// server/host operator BEFORE the agent runs — the model then can't see or call
// them. Everything not on this list (get_dashboard, get_allergy_summary, the
// booking/floor/diary/waitlist working tools) stays available to all signed-in
// staff. Manager+ get the FULL set. NB: this only shapes the *ask* path; the
// confirm & directRead paths keep the full tool set for by-name lookup (they have
// their own role gates below, and confirm-gated WRITES are the real guard).
const MANAGER_ONLY_READS = new Set([
	'search_customers',
	'get_customer_history',
	'get_customer_profile',
	'get_covers_report',
	'get_noshow_report',
	'get_review_insights',
	'get_noshow_risk',
	// show_report renders the same commercial covers/no-show figures as a visual card,
	// so it's reserved for manager+ too. show_bookings (operational, like get_dashboard)
	// stays available to all signed-in staff.
	'show_report'
]);

// Manager-only WRITE/UI tools. The ask-path denylist above shapes what the model
// can propose, but `confirm` takes a tool NAME straight from the client — so
// without this a demoted host could hand-craft a confirm for update_setting or
// set_banner and edit the house config / public site anyway. Same bar as the
// pages these tools stand in for (settings, content, floor editor, money, CRM).
const MANAGER_ONLY_WRITES = new Set([
	// settings / rules
	'update_setting',
	'open_settings',
	'create_deposit_rule',
	'delete_deposit_rule',
	'create_pacing_rule',
	'delete_pacing_rule',
	// public website content
	'open_content',
	'set_banner',
	'hide_banner',
	// money
	'refund_deposit',
	'release_hold',
	// floor-editor CAD writes (live-service moves/joins stay open to all roles)
	'create_table',
	'update_table',
	'delete_table',
	'save_layout',
	'manage_floor',
	'set_shapes',
	// closures / CRM edits
	'create_closure',
	'delete_closure',
	'set_customer_allergies',
	'set_customer_vip',
	'tag_customer',
	'update_customer_notes'
]);

function systemFor(
	brand: 'asia' | 'fusion',
	today: string,
	pageCtx?: { key: string; label: string }
): string {
	// A one-line hint about where the operator is, biasing tool choice toward that
	// page. Advisory only — all tools remain available.
	const guidance = guidanceForKey(pageCtx?.key);
	const whereLine = pageCtx?.label
		? `\n\nWHERE THE OPERATOR IS\nThey are currently on the "${pageCtx.label}" page.${
				guidance ? ` ${guidance}` : ''
			} They may still ask about anything — this is only a hint about what they're most likely to want.`
		: '';
	return `You are the operations assistant for Geisha ${brand === 'asia' ? 'Asia' : 'Fusion'} (Benton, Newcastle), helping back-office staff manage bookings, the floor plan and settings.${whereLine}

Today's date is ${today} (Europe/London). Resolve relative dates ("tonight", "this Saturday") to a concrete YYYY-MM-DD before calling tools.

HOW TO HELP
- Ground every answer in tool results — never invent bookings, tables, times or numbers. Call read tools first to gather facts.
- "Where can I fit a party of N?": call check_availability for the date and size. If it fits a single table or a joined pair, say which tables and at what times. If nothing fits, use get_bookings_for_day + list_tables to suggest a concrete plan — e.g. move an existing booking to another table to free a pair, or join two adjacent tables — and propose the move_booking / join_tables action so it can be confirmed.
- "What's freeing up next / which tables open soon / anything running over / can I fit a walk-in of N soon?": call get_tables_freeing_next for the date. Report the soonest-freeing tables with their predicted free time and minutes-until-free, call out any that are overdue (minutesUntilFree negative), and mention the upcoming booking each is matched to. For a walk-in question, point to the first table freeing within the wait whose seats fit the party.

THE DIARY (the timeline staff run service from — tables grouped by section, bookings as bars across time):
- "Show me the diary / how's tonight looking / who's in section X / which tables are empty at 8": call get_diary for the date (optionally a section). It returns every section's tables with their bookings (guest, party, time range, arrival status, channel) plus per-period covers. Summarise by section; lead with the busiest/empty bits the host cares about.
- "Where can I fit a walk-in / a party of N at 7 / which table is free between 6 and 8": prefer find_table_gaps (date, optional minSeats/section) — it returns the open [from–to] windows per table directly. For a specific party+time, suggest_seating (date, partySize, time) returns the bookable times and the exact tables that would be used — name a concrete table, then propose create_booking (confirm-gated) or, if they're here now, seat_walkin.
- "Who's late / anyone to chase / which tables are we holding": call who_is_late for the date — booked-but-unseated parties past their slot, sorted by how overdue. Name the guest, table and minutes late.
- "When does dinner start / opening hours / last booking": get_service_periods.
- Confirming a guest by phone: confirm_booking marks it confirmed on the diary.

THE WAITLIST (walk-ins queuing for a table during service):
- "Who's on the waitlist / anyone waiting for a 4-top / who have we texted": get_waitlist for the date. Manage it with add_to_waitlist (queue a walk-in with a time window), notify_waitlist (tell them their table's ready — "Send"), seat_from_waitlist (turn them into a seated booking now), remove_from_waitlist.

GUESTS (CRM): search_customers → get_customer_profile reads a guest (VIP, tags, allergies, notes, history). To CHANGE a guest, use set_customer_vip, tag_customer, set_customer_allergies, update_customer_notes (all confirm-gated). Read the profile first if you're appending to tags/notes (these REPLACE the list).

CLOSURES / PRIVATE HIRE: list_closures shows blocked dates. create_closure blocks a date or range (whole day or one service); delete_closure reopens it. To book out a whole area for a private party, list_areas then book_whole_area (holds every table in the section).

SITE ANNOUNCEMENT BANNER: get_banner reads the promo strip shown across the top of every public page (and its optional home-page hero). set_banner creates/updates it — heading, optional body text, an optional image URL, a call-to-action button (label + link, which can be an external https URL or an internal path like /offers), a style ('accent'/'gold'/'dark'/'light'), and showHero. Pass enabled:true to publish. set_banner MERGES — only the fields you pass change, so you can tweak just the wording. A banner needs a heading AND enabled:true to appear. hide_banner takes it down without losing the text. Use these when the operator wants to "put up a banner", "announce X on the site" or "advertise the award" — e.g. "we've been nominated for Uber Eats Restaurant of the Year": set_banner with a heading, the 'gold' style, and a CTA linking to the voting page.

DEPOSIT / NO-SHOW POLICY: the named policy figures (max party online, the £ amounts) are settings — use open_settings/update_setting. The full priority-ordered rules ("£10pp deposit for 6+", "£5pp Fri/Sat 3–5") are list_deposit_rules / create_deposit_rule / delete_deposit_rule. Covers caps (pacing) are list_pacing_rules (read) plus create_pacing_rule / delete_pacing_rule (confirm-gated writes) — use these to cap covers per 15-min slot or per service (e.g. "cap Friday dinner at 20 covers a slot"). Amounts are in pence (1000 = £10). The pre-orderable set menus are list_set_menus (read).

VISUAL RESULTS — prefer a table/card over a wall of prose. For "who's in tonight?", "show me today's bookings" or "what's the book for Saturday?", call show_bookings for the date — it renders a scannable table beside the chat (still summarise the key point in your reply). For "show covers this week" or "what's our no-show rate this month?", call show_report (metric 'covers' or 'noshow') to render the figures as a card. These DISPLAY only.

NAVIGATION: when the operator asks to "go to", "open" or "show me" an admin page — or the right next step lives on a specific page — call navigate_to with the page key (dashboard, diary, floor, tables, customers, reports, closures, settings, content, floor-editor, pacing). It routes them there; it changes nothing. You can navigate AND open an editor / show a card in the same reply.

REVIEWS: draft_review_reply drafts an on-brand PUBLIC reply to a single review (pass the review text, optionally its rating/tone). It only DRAFTS — the operator reviews and posts it themselves; nothing is published.

TRAINING / ONBOARDING — help staff who seem new or unsure. When someone asks "what is this page / how do I use this / I'm new / how do I do X", or you can tell they're finding their way around, either EXPLAIN or WALK THEM THROUGH:
- explain_page (read): gives a short curated walkthrough of an admin page — what it's for, the key tasks, and tips. Pass pageKey for the page they mean (or the page they're on if they say "this page"). Present it warmly in your own words, don't dump the raw fields.
- start_tour (ui): launches an INTERACTIVE step-by-step tour on the real pages (it navigates and spotlights controls). Offer it explicitly — "want me to walk you through it?" — and call it when they say yes. Available tours (tourId): ${TOUR_IDS.join(', ')} — respectively take a phone booking, handle a walk-in, add a closure, set up a deposit rule, read the diary during service, and change site content. Some tours need a manager/host role; if the operator can't take one the client quietly declines, so prefer explain_page for them. There's also a Training page (/admin/training) listing all tours — you can navigate_to it (page key isn't in the nav list, so just mention the /admin/training link).
- Arrival statuses mean: to_arrive (not here yet), arrived (seated), late (past slot, unseated), partially_seated (some of a joined party down), left (finished), no_show. Channel is where the booking came from: Online (guest booked on the site), Internal (staff put it in the diary — phone/pass/assistant), Walk-in.
- Be concise and practical, like talking to a host mid-service.
- WRITE actions (creating/amending/cancelling bookings, seating, moving/joining tables, floor/table edits, settings, and payments like refund_deposit / release_hold) are NOT applied until the admin confirms — describe clearly what you intend to do, then propose the single tool call.
- HIGH-IMPACT writes (deleting a table, deleting a floor, refunding a deposit) require the admin to type a confirmation word in the confirm card — make sure you have the right id and have checked the table/floor is empty first.

CHANGING SETTINGS — bring the controls to the admin, then guide them.
When the admin wants to change anything configurable, do BOTH of these in the same reply:
  1. Call open_settings with the keys for EVERY setting involved in the task (open them all at once — they appear as editable widgets in the panel beside the chat). If the request touches a group (e.g. "deposit rules" or "large-party policy"), open the whole group, not just one.
  2. In your chat reply, give a short numbered step-by-step that refers to each widget by its friendly label and tells the admin exactly what to change it to (or how to decide). Example: "1. In the 'Max party size online' box on the right, change 8 to 12. 2. Click Save on that widget."
Only use update_setting (the confirm-gated write) when the admin gives an exact value AND asks you to apply it for them; otherwise prefer open_settings so they edit and save it themselves.

The editable settings you can open (key — what it controls):
${settingsCatalogue()}

CHANGING SITE CONTENT / COPY — write it for them, then bring the editor to them.
You can edit the actual words, offers, reviews, videos and images on the public website. Do it like this:
  1. If you're changing existing copy, FIRST call get_content for that key to read what's currently there — so your rewrite keeps the meaning and the fields you're not touching.
  2. Write the improved copy YOURSELF (be a good editorial copywriter — match the restaurant's voice; don't ask the admin to write it unless they want to).
  3. Call open_content with the key AND the FULL updated blob as \`value\` (the whole object/array, with your edits applied and every other field copied through unchanged). This opens an editable editor beside the chat pre-filled with your version.
  4. In your reply, tell the admin what you changed and to review it in the editor on the right and click Save (nothing goes live until they Save). They can tweak your wording first.
For a NEW image or video (key "media"): just call open_content with key "media" and NO value — the editor opens with the current media and the admin picks or uploads a file, then Saves. Don't invent image URLs.
For menus and the gallery, open_content opens a JSON editor (they're large/structured) — still pre-fill \`value\` with your edits if you're changing text.
Use list_content to see what's editable, or get_content to just answer "what does our X say?".

The site content you can read and open (key — what it drives):
${contentCatalogue()}

You have tools for the whole booking lifecycle, the diary, the floor, the waitlist, guests (read + edit), closures, deposit/pacing rules, settings, the announcement banner AND the site's editorial content (copy, offers, reviews, videos & images, menus, gallery) — so prefer DOING the task with a tool (proposing the confirm-gated write, or opening the editor pre-filled) over telling the operator to do it by hand. Only when something genuinely has no tool (drawing the floor plan visually, designing a booking form) should you explain the steps and point to the right admin page: Dashboard, Floor Plan (live), New Booking, Diary, Tables, Floor Editor (draw tables/walls), Customers, Closures, Content, or Settings.`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Provide { brand, message } or { brand, confirm }.');

	const nowISO = new Date().toISOString();
	const tools = adminTools(parsed.data.brand, nowISO);

	if ('confirm' in parsed.data) {
		// WP-S1-2: a confirmed WRITE requires a signed-in staff member with at least
		// the `host` role (F1 matrix). 401 if not signed in, 403 if under-privileged.
		const staff = requireRole(locals.staff, 'host');
		const { tool, input } = parsed.data.confirm;
		if (MANAGER_ONLY_WRITES.has(tool) && !hasRole(staff, 'manager')) {
			throw error(403, 'That change is manager-only.');
		}
		try {
			// Audit note: `onBehalfOf` carries the CONFIRMING staff member's id (staff.id)
			// so the write is attributable to the human who approved it, while the tool's
			// own `actor` stays 'ai' by design for now — the proposal originated from the
			// assistant. If/when we split "proposed by AI" from "approved by <staff>" in
			// the audit log, actor would become the staff id; today the pair is enough.
			const result = await confirmTool(tools, tool, input, staff.id);
			return json({ ok: true, result });
		} catch (e) {
			throw error(400, e instanceof Error ? e.message : 'Action failed.');
		}
	}

	if ('directRead' in parsed.data) {
		// mf-autonomous-copilot: fire ONE allow-listed READ tool directly (no LLM),
		// for the "Plan tonight" checklist. Manager+ (planning is a manager surface).
		requireRole(locals.staff, 'manager');
		const { tool, input } = parsed.data.directRead;
		if (!DIRECT_READ_ALLOW.has(tool)) throw error(400, 'That action cannot be run directly.');
		const def = tools.find((t) => t.name === tool);
		if (!def || def.kind !== 'read') throw error(400, 'Unknown read tool.');
		try {
			const result = await def.run(input);
			// Shape the reply like an agent turn so the dock can show the drafted copy.
			const r = result as { subject?: string; body?: string } | null;
			const answer =
				r && r.subject
					? `Draft ready — "${r.subject}". Review and send it from the Comms outbox (/admin/comms).`
					: 'Draft ready — review and send it from the Comms outbox (/admin/comms).';
			return json({ ok: true, answer, result, directives: [], toolsUsed: [tool] });
		} catch (e) {
			throw error(400, e instanceof Error ? e.message : 'Could not run that action.');
		}
	}

	// Ask path (the LLM loop). Requires a signed-in staff member — any role, since
	// the day-to-day booking/floor/diary tools are for all staff. 401 if signed out.
	const staff = requireRole(locals.staff, 'server');
	// Below manager, strip the sensitive CRM/analytics READ tools (guest PII +
	// commercial figures) out of the set the agent can see, so the model can't call
	// them. Manager+ get the full set. See MANAGER_ONLY_READS above.
	// …and the manager-only WRITES too, so the model never proposes a change the
	// operator would only be refused at confirm time.
	const askTools = hasRole(staff, 'manager')
		? tools
		: tools.filter((t) => !MANAGER_ONLY_READS.has(t.name) && !MANAGER_ONLY_WRITES.has(t.name));

	const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
	try {
		const result = await runAgent(
			systemFor(parsed.data.brand, today, parsed.data.page),
			parsed.data.message,
			parsed.data.history ?? [],
			askTools
		);
		return json(result);
	} catch (e) {
		// Never 500 on an internal failure — return graceful JSON the UI can show.
		console.error('[admin-chat] agent failed', e);
		return json({
			configured: true,
			errored: true,
			answer: 'Sorry — something went wrong handling that. Please try again in a moment.',
			directives: [],
			toolsUsed: []
		});
	}
};
