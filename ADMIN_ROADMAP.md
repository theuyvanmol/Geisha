# Geisha Booking & Admin System — Definitive Build Roadmap

*Replacing ResDiary across two restaurants (Asia + Fusion). Prioritized, opinionated, and sequenced. Produced from a multi-agent audit of the admin area, 2026-06-25.*

---

## 1. Executive Summary

The custom system is **further along than a typical "replace the SaaS" project, but not yet shippable** — and the gap is concentrated in three places: trust (auth/payments/webhook security), live-service workflow (the floor view and diary are read-heavy and missing the core seating manoeuvres), and polish (an unbranded admin and a half-finished floor planner). The booking *engine* is genuinely strong: a pure, unit-tested availability/allocation core with DST-correct slots, table joins, a deposit/no-show policy engine, an audit log on every mutation, and a first-party widget already embedded on both brands. That engine already meets or beats ResDiary on slot search, allocation, and turn-time modelling.

What it does **not** yet do is the boring-but-critical operational layer ResDiary lives on: **covers pacing/throttling**, **closures/blackout dates**, **booking amends**, **reminders**, and **actually charging a card** (Dojo is wired but inert, and the webhook signature check is a no-op stub). Three hard blockers make today's build undeployable to the public internet: **(1) zero authentication** on all of `/admin/**` and the AI/cron endpoints running on a superuser PocketBase token; **(2) the Dojo webhook accepts forged "Captured" events**; and **(3) the in-process booking mutex doesn't hold on Vercel's multi-instance runtime**, so tables can be double-booked under load. The floor planner is a differentiator (CAD-lite, multi-floor, snapping) but ships a **silent data-loss trap** — shape edits/deletes only persist on a later manual "Save layout," which is almost certainly the reported "delete doesn't always work."

The AI story is the most exciting and the least finished: there are **two divergent agent stacks** (a weaker live Gemini admin agent and a richer legacy Claude concierge), neither front-and-centre, neither with the write tools needed to "manage anything," and one with an **unauthenticated, unvalidated confirm endpoint** that is a real exploit once writes expand. **Bottom line:** ship the trust layer and the live-service workflow first, finish the planner's persistence and keyboard/undo, *then* unify and surface the AI. The engine is the moat; everything around it is the work.

---

## 2. ResDiary Parity Gap Table

Priority key: **P0** = blocks replacing ResDiary at all; **P1** = needed for a credible daily-use replacement; **P2** = competitive/nice-to-have. Status: ✅ present · ◐ partial · ✗ missing.

### P0 — Must-haves to replace ResDiary

| Category | Capability | Status | Note / file |
|---|---|---|---|
| **Trust** | Authentication on `/admin/**` + AI/cron endpoints | ✗ | Superuser token, no gate. `admin/+layout.svelte:46` "No auth yet". **Hard blocker.** |
| **Trust** | Per-actor identity / RBAC | ✗ | Audit always logs `staff`/`system`, never a real user. |
| **Trust** | Dojo webhook signature verification | ◐ | `verifySignature()` returns `true` always (`webhooks/dojo:21-28`). Forgeable "Captured". |
| **Trust** | Multi-instance-safe double-booking guard | ◐ | In-process `Map` mutex (`create.ts:30-46`) doesn't hold across Vercel instances. |
| **Booking** | Covers cap / pacing throttle per slot/service | ✗ | Engine is purely table-supply driven. No kitchen throttle. |
| **Booking** | Closures / blackout / special-event calendar | ✗ | No `geisha_closures`. Can't express holidays/private hire. |
| **Booking** | Online payment step actually collected in widget | ✗ | "A secure payment step will follow" placeholder; deposits never taken. |
| **Payments** | Live capture/reverse/refund (Dojo keys) | ◐ | All gated on `isConfigured()`, no-op today. |
| **Payments** | Payment lifecycle tied to bookings | ✅ | `geisha_payments` rows. |
| **Comms** | Transactional confirmation email | ◐ | Templates exist; no-key console-log until `RESEND_API_KEY`/`EMAIL_FROM` set. |
| **Comms** | Automated reminder before service | ✗ | No reminder sender. Core no-show reducer. |
| **Live service** | Move a **seated** party between tables | ✗ | `?/move` only renders for *free* tables; `moveBooking()` unreachable for occupied. |
| **Live service** | Seat one party across **joined** tables live | ✗ | UI submits a single hidden `tableId`; can't seat across a join. |
| **Live service** | Multi-floor handling in live view | ✗ | `getFloorPlan` returns all tables, no floor filter → every floor overlaps. |
| **Staff** | Amend a live booking (time/party/requests) | ✗ | Only cancel+rebook. `bookings/[id]` has no edit action. |
| **Floor editor** | Shape edits (delete/move/resize) persist reliably | ◐ | Local-only until manual Save. The "delete doesn't work" bug. |
| **Reliability** | Auto-release of no-show holds | ◐ | Sweep exists but only fires *after* start; unpaid holds block slot pre-service. |
| *(Already done)* | Availability search, allocation+joins, turn-time, DST, status machine, embeddable widget, live floor colouring, seat/clear/walk-in, diary+date nav, manual booking, customer upsert, deposit/no-show policy logic, audit log, create-time race guard | ✅ | Engine core is solid. |

### P1 — Needed for a credible daily replacement

| Category | Capability | Status |
|---|---|---|
| Booking | Booking-window enforcement (`booking_window_days` is dead config) | ◐ |
| Booking | Minimum lead time / same-day cutoff | ✗ |
| Booking | Waitlist / notify-when-free | ✗ |
| Booking | Guest self-service amend/cancel link | ✗ |
| Live service | Drag-and-drop seating from diary onto a table | ✗ |
| Live service | Covers timeline / pacing visualisation | ✗ |
| Live service | Walk-in waitlist | ✗ |
| Live service | Run-sheet / allergen+occasion service summary | ✗ |
| Floor editor | Undo/redo + keyboard delete | ✗ |
| CRM | Guest profile page (history aggregated for staff) | ✗ (data layer exists, AI-only) |
| CRM | Structured dietary/allergy/preference fields | ✗ |
| CRM | Tags / segments / VIP flag | ✗ |
| CRM | No-show counter / risk signal on guest | ✗ |
| CRM | Per-brand customer scoping (currently global) | ✗ |
| CRM | Marketing consent toggle + provenance | ◐ |
| CRM | GDPR export / erasure | ✗ |
| Payments | Manual refund from back office | ✗ (`refundDeposit` is dead code) |
| Payments | Configurable per-service/per-event deposit rules | ✗ |
| Comms | Cancellation email status guard (fires for unconfirmed) | ◐ |
| Comms | Review-request / post-visit follow-up | ✗ |
| Comms | SMS channel | ✗ |
| Reporting | Covers/occupancy over a range | ✗ |
| Reporting | No-show rate reporting | ✗ |
| Staff | Service-period / opening-hours editing UI | ✗ (read-only) |
| Reliability | True realtime floor sync (push not poll) | ✗ |
| Reliability | Concurrency conflict resolution on simultaneous edits | ✗ |
| Design | Admin brand coherence + tablet responsiveness | ◐ |
| Marketing | Opt-in list / segmentation export | ✗ |

### P2 — Competitive / nice-to-have

| Category | Capability |
|---|---|
| Booking | Area/zone preference at booking · multiple fixed seatings · per-guest abuse limits · menu/pre-order on booking |
| Floor editor | Angled/non-rectangular/polygon walls · obstacles block table placement |
| Live service | `finishing` state + arrival/finish countdown on tiles · walk-in contact capture |
| CRM | Blacklist/deny-list · lifetime spend tracking |
| Payments | Card-on-file / saved-card · partial/tiered deposits |
| Reporting | Revenue/deposit reporting · channel breakdown · frequency/cohort · CSV/print export |
| Integrations | POS link (ICRTouch — deliberately separate) · TheFork/aggregators · Reserve with Google |
| Marketing | Promo codes · set-menu upsell · campaign/broadcast tooling |
| AI | Full admin write-tool agent + voice (a differentiator beyond ResDiary) |

---

## 3. Floor Editor — Confirmed Bugs & Half-Baked Features

All ten bugs below are **verified against source** (each independently refuted-and-confirmed). File anchors throughout are `src/routes/admin/floor-editor/`.

### 3.1 Confirmed bugs (root cause + fix)

**BUG-1 — Shape delete/edit is local-only; silently reverts on reload (HIGH).**
`deleteSelectedShape()` (`+page.svelte:202-206`) only does `allShapes = allShapes.filter(...)`. Contrast `deleteTable` (`+page.svelte:567`) which round-trips via `withSave(() => postForm('deleteTable'))`. Shape deletes/moves/resizes/rotations reach the DB **only** when the user later clicks "Save layout" (`buildSavePayload` seeds `shapesByFloor[f.id]=[]` then `setShapes` reconciles, deleting orphans — `admin.ts:281-302`). If the user deletes a wall and navigates/reloads, `reseedFromData()` (`:161-169`) rebuilds from unchanged loader data and the wall reappears. **This is almost certainly the "DELETE doesn't always work" report.**
*Fix:* make `deleteSelectedShape` (and shape move/resize/rotate commit points) call `await save()` immediately, mirroring `deleteTable`. At minimum add a `beforeunload` guard when unsaved edits exist.

**BUG-2 — Every shape is an axis-aligned rectangle; no angled/L/polyline walls (MEDIUM).**
Drawing builds shapes from `normalizeBox` (`geometry.ts:88-95`, always `Math.min/Math.abs`) with `rotation: 0` hardcoded (`FloorCanvas.svelte:233`). The data model stores only `x/y/width/height/rotation` (single centre angle); no vertex list. Rotation *render/persist works* (`ShapeItem.svelte:37`, `admin.ts:292`), but the only rotation entry point for shapes is the 90° stepper (`+page.svelte:208-213`) — so a wall can only ever be 0/90/180/270, never diagonal, and there's no shape-to-shape snapping. (`trySnap`/`adjacent` apply to **tiles only**.)
*Fix:* short-term, add a drag-rotate handle to shapes (tiles already have `onRotateStart` via `atan2` at `FloorCanvas.svelte:203-209`) for arbitrary angles. Long-term, extend `FloorShape` with an optional `points[]` and render as SVG polyline when present; compose L-shapes from two wall rects on draw.

**BUG-3 — No keyboard Delete/Backspace (MEDIUM).**
Zero keydown handlers anywhere in the editor; the stage div wires only pointer events (`FloorCanvas.svelte:277-288`). Tiles/shapes get `tabindex` but no key handling. Delete is button-only.
*Fix:* `$effect` in `+page.svelte` attaching `window.addEventListener('keydown', …)` (teardown-cleaned): on Delete/Backspace, when focus isn't in an input, route to `deleteSelectedShape()` or a `withSave` delete loop over `selectedIds`.

**BUG-4 — No undo/redo (MEDIUM).**
State is plain `$state` arrays (`+page.svelte:93-99`) mutated in place; no history, no Ctrl+Z. The only "undo" is reload, which discards *all* session edits.
*Fix:* push a `structuredClone` snapshot of `{allTiles, allShapes, joins, floors}` in the existing `onMutate`/`onGeometryChanged`/`onCreateShape` callbacks (the orchestrator already owns these). Undo/redo stacks capped ~50; bind Ctrl+Z / Ctrl+Shift+Z.

**BUG-5 — Shape drag is not clamped to the room (MEDIUM).**
`onPointerMove` shape branch sets `dragShape.x/y` with **no clamp** (`FloorCanvas.svelte:176-177`), while tile branches clamp (`:191-192, :198-199`). A wall can be dragged fully off-canvas and saved at negative coords (`admin.ts setShapes` only `Math.round`s, no bounds check).
*Fix:* clamp shapes the same way tiles are clamped; reuse the `clamp` helper (`:246`).

**BUG-6 — Clamp uses unrotated w/h, so rotated items overflow (LOW).**
`clamp` caps top-left using axis-aligned `t.w/t.h` (`:191-192`), but render is `transform: rotate()` about centre (`TableTile.svelte:45`). A 180×60 table at 90° has a 60×180 footprint and overflows. `rotatePoint` exists (`geometry.ts:111-125`) but is unused for clamping.
*Fix:* add a `rotatedBounds(rect)` helper (swap w/h at 90/270; `|w·cos|+|h·sin|` general), clamp the **centre**, derive top-left.

**BUG-7 — Click-to-place doesn't clamp (LOW).**
On a click (no drag), `onPointerUp` centres the default shape (`x: round(draft.x - w/2)`, `:228-230`) with no bounds check — near an edge, or for the 300cm bar default, it lands off-canvas and persists.
*Fix:* clamp computed x/y into `[0, room-w]`/`[0, room-h]` before `onCreateShape`.

**BUG-8 — Multi-select of shapes impossible; marquee acts on tables only (LOW).**
`onShapePointerDown` always does `selectedShapeId = s.id; selectedIds = new Set()` (`:142-143`) — a single id, no shift-add. Marquee feeds `marqueeHits` tiles only (`:218-219`) and clears shape selection on start (`:163`).
*Fix:* promote to `selectedShapeIds: Set<string>`, support shift-add, include shapes in `marqueeHits`, and iterate both sets in group drag/rotate/delete. If out of scope, at least shift-click + Delete-key on the set.

**BUG-9 — Room resize doesn't re-clamp existing items (LOW).**
`onScaleChange` only rescales tile px **when `px_per_cm` changes** (`+page.svelte:220-227`); a width/height-only change shrinks `roomWidthPx` (`:116-117`) but leaves items at old absolute coords, now outside the frame, and Save persists them. Shapes aren't touched at all.
*Fix:* after any room-size change, re-clamp every tile and shape into the new bounds (reuse the rotated-AABB clamp) and refresh joins.

### 3.2 Half-baked features to finish

- **`zone` / `label` shape kinds are unreachable** — `ShapeItem.svelte:44-95`, `types.ts:93`, and the edit panel (`+page.svelte:452-463`) fully support them, but `FloorToolbar DRAW_KINDS` (`:48-54`) omits them. Add to the Draw dropdown.
- **Obstacle drawing is box-only** — no angled/freehand/polyline (covered by BUG-2).
- **Shapes don't affect the booking engine** — purely visual (`ShapeItem.svelte:1-6`); a pillar over a table doesn't block it. Either accept (document as visual-only) or add collision validation on save.
- **`addFloor` reads stale `data.floors[length-1]`** (`:323-332`) — usually works via `sort_order`, fragile if two floors share a `sort_order`. Activate by returned id instead.

**Recommended editor work, in order:** BUG-1 (persistence) → BUG-3 + BUG-4 (keyboard delete + undo, which together make destructive editing safe) → BUG-5/7/9 (clamping) → shape drag-rotate (BUG-2 short-term) + expose zone/label → BUG-6/8 + polyline walls (polish/P2).

---

## 4. The AI Assistant Vision

**Strategic call: unify first, then surface, then voice.** There are two divergent stacks today — the *live* but weaker Gemini admin agent (`adminTools.ts` via `/api/admin-chat`: 5 read + 1 ui + 3 write) and the *richer but legacy* Claude concierge (`tools.ts` via `/api/ai`: includes `create_booking`, `cancel_booking`, `seat_booking`, `search_customers`, `get_customer_history`, `get_dashboard`). Keep the **transport-agnostic `geminiAgent.ts` loop** (it already does read-auto / write-halt / ui-directive and runs any provider via the Vercel Gateway), grow `adminTools.ts` to the full catalogue, and **retire the Claude `agent.ts`/`tools.ts` path and the `/admin/concierge` nav item.** One tool surface, one audit story, one confirm flow.

### 4.1 Full tool catalogue ("manage anything")

Every tool is tagged `read` (auto-runs) / `write` (confirm-gated) / `ui` (changes nothing until the user clicks Save). The confirm-gating spine in `geminiAgent.ts:404-414` already halts on the first `write` — keep that invariant as the surface grows.

**Bookings & lifecycle**
- `check_availability` *(read, exists)* — slots for date+party with table ids.
- `get_bookings_for_day` *(read, exists)* — add optional `status?` filter.
- `get_booking_detail` *(read, NEW wiring of `getBookingDetail`)*.
- `get_bookings_range` *(read, NEW)* — "this week" / pacing.
- `create_booking` *(write, NEW wiring)* — admin always `source:'phone', staff:true`.
- `amend_booking` *(write, NEW server fn)* — fills the no-amend gap; re-validates via `allocateTables` before writing; `actor='ai'`.
- `cancel_booking` *(write, exists in Claude stack — port)*.
- `mark_no_show` *(write, NEW wiring of `markNoShow`)*.
- `seat_booking` *(write, port from Claude stack)*.
- `clear_table` *(write, NEW wiring of `clearBooking`)*.
- `seat_walkin` *(write, NEW)* — `createBooking({source:'walkin',...})` then `seatBooking`.

**Floor & seating (live + planner)**
- `get_floor_plan` *(read, exists)* — add `floorId?` to fix multi-floor overlap.
- `list_tables` *(read, exists)* · `list_floors` *(read, NEW)*.
- `move_booking` *(write, exists)* · `join_tables` *(write, exists)* · `unjoin_tables` *(write, NEW)*.
- `create_table` / `update_table` / `delete_table` *(write, NEW — `delete_table` high blast radius)*.
- `save_layout` *(write, NEW)* — lets the agent persist geometry the editor leaves unsaved.
- `manage_floor` *(write, NEW — create/update/delete; delete already guards orphaned tables)*.
- `set_shapes` *(write, NEW — the only persistence path for shape deletes)*.

**Customers & CRM**
- `search_customers` *(read, port)* · `get_customer_history` *(read, port — surface no-show/cancel counts for risk flagging)*.
- `update_customer_notes` *(write, NEW)* · `set_marketing_consent` *(write, NEW — GDPR provenance)*.

**Payments**
- `get_payment_status` *(read, NEW)* — "has the deposit been taken?"
- `refund_deposit` *(write, NEW — currently dead code)* · `release_hold` *(write, NEW)*. Both no-op safely until Dojo keys exist.

**Settings & service config**
- `list_settings` *(read, exists)* · `list_periods` *(read, NEW)*.
- `open_settings` *(ui, exists — expand `SETTING_META` beyond the current 7 keys to cover periods/hours/bookable flags)*.
- `update_setting` *(write, exists)* · `update_service_period` *(write, NEW — no period editor exists today)*.

**Reporting & analytics**
- `get_dashboard` *(read, port)* · `get_covers_report` *(read, NEW, range, `groupBy day|period`)*.
- `get_noshow_report` *(read, NEW)* · `get_audit_trail` *(read, NEW — "who cancelled this and when")*.

### 4.2 Front-and-centre dashboard design

The assistant is buried as the 9th sidebar link today (`admin/+layout.svelte:22`) and the dashboard (`admin/+page.svelte`) has no embed. Three placement layers, all hitting `/api/admin-chat`:

1. **Persistent dock** — a right-hand collapsible rail (or bottom-right launcher → 380px drawer) rendered **outside `<main>`** in `+layout.svelte` so it survives route changes without remounting. Conversation/proposed-action/open-widget state lives in a Svelte 5 rune store (`src/lib/admin/assistant.svelte.ts` using `$state`), so navigating Dashboard → Diary keeps the chat. Reuses the existing `AIAssistantChat` composer + `open_settings` widget panel; the `/admin/assistant` page becomes the wide 2-column "expanded" view of the *same* store.
2. **Command bar (⌘/Ctrl-K)** — a prominent "Ask the assistant" input above the dashboard cards plus 3–4 example chips, and a global keydown listener. Submitting routes into the same store's `send()` and opens the dock with the answer.
3. **In-context result actions** — the `proposedAction` confirm card (already built at `assistant/+page.svelte:156-166`) moves into the dock; `open_settings` still spawns `SettingWidget`s; after a confirmed `move_booking`/`seat_booking` the dock fires `invalidateAll()` so the live floor/dashboard the user is looking at refreshes.

**Keeping the rest usable:** dock is collapsible, remembers open/closed in localStorage, defaults collapsed on data-dense pages (floor editor, diary). The shell grid (currently fixed `220px 1fr`, no breakpoint) gains a third optional column for the dock on wide screens and an overlay drawer on tablet — this *also* fixes the responsiveness gap (§5).

**Codebase tuning:** raise the history cap (`slice(-8)` at `geminiAgent.ts:341`) and loop cap (6 turns at `:351`) to ~16 turns / 8–10 loop turns, or summarise older turns. `max_tokens` 1024 (`:266`) is fine for text. Regenerate `systemFor()` in `/api/admin-chat` to advertise the full tool list and expanded `SETTING_META`.

### 4.3 Voice plan

**V1 — browser Web Speech API, zero-cost, client-only, no backend change.** Voice is greenfield (confirmed zero `SpeechRecognition`/`speechSynthesis`/`MediaRecorder` in src). Build it as a thin layer on the existing text loop: STT fills the same `draft`/`send()` path; TTS reads back the same answer string.
- **STT:** `window.SpeechRecognition || webkitSpeechRecognition`; hide the mic when undefined. Press-and-hold (pointerdown→`start()`, pointerup→`stop()`) is most predictable on a noisy floor; also offer tap-to-toggle. `interimResults=true` streams partial transcript into the draft; `lang='en-GB'`. On final result, auto-send or leave for review (per-user toggle). Wrap in `src/lib/admin/voice.ts` exposing `start/stop/onPartial/onFinal` so dock and ⌘-K share it.
- **TTS:** `speechSynthesis.speak(...)` when the message arrived via voice (`inputWasVoice` flag); en-GB voice from `getVoices()`; mute toggle.
- **Confirm flow stays mandatory:** never auto-execute a write from speech. TTS reads the `summarise()` text ("I'd like to move booking X to table 7 — say or tap confirm"); optionally match a spoken "confirm"/"cancel" client-side before calling the confirm endpoint.

**V2 — streaming + realtime, when latency matters.** (a) Token streaming: the Gateway supports SSE; add `stream:true`, convert `runAgent` to an async generator / streamed Response, feed partial tokens to TTS. (b) Full realtime (OpenAI Realtime / Gemini Live) for barge-in — needs server-side function-calling bridged to the **same** tools + a WebRTC/WS relay; defer until V1 proves the workflow. Same tool catalogue + confirm-gating means V2 is a transport swap, not a re-architecture. *Caveat:* mic needs HTTPS (the Vercel domain is fine); feature-detect and degrade to text-only silently.

### 4.4 AI safety — must close before writes expand

- **Confirm-gating:** keep `kind:'write'` on **all** mutations, especially high-blast-radius `delete_table` / `manage_floor delete` / `refund_deposit`. The confirm card must show a human summary **and** raw input JSON (`summarise()` + `<pre>` already does both — extend `summarise()` to cover every new tool). Consider type-to-confirm for deletes/refunds.
- **Audit gaps to fix:** `createTable/updateTable/deleteTable/createFloor/updateFloor/deleteFloor` **hard-code `writeAudit('staff', …)`** — change signatures to accept an actor (default `staff`) so AI writes log as `ai`. `saveLayout/setShapes/setJoins` write **no audit at all** — add `writeAudit` before exposing them. Then build `get_audit_trail`.
- **Known live bugs to fix in the loop** before expanding writes: a write among parallel tool calls drops already-run read results (can wedge the chat, `geminiAgent.ts:404-414`); the confirm path never re-feeds the result to the model (no memory of "did that work?"); `open_settings` widget saves audit as `staff` while `update_setting` audits `ai` (inconsistent); tool-call id collision across turns (`call_${i}` vs `call_${turn}_${i}`).
- **HARD BLOCKER — the confirm endpoint is exploitable:** `/api/admin-chat` Confirm branch takes `tool`+`input` straight from the browser as `z.unknown()` with no re-validation and no auth (`+server.ts:65-72`). A crafted POST could `move_booking` anywhere or `update_setting` any key. **Until auth + per-tool input re-validation land, ship only READ tools to production; keep writes behind a dev flag.** Also note the CRM brand-scoping leak (customers are global) — scope customers by restaurant before giving the agent customer writes.

---

## 5. Design / UX — Clean, On-Brand, Consistent Admin

**The problem:** the admin reuses **none** of the public design system. The public site is warm/editorial (lacquer-black + gold for Asia, cream + terracotta for Fusion, serif display type, tokenised via `tokens.css` and `data-brand`); the admin is generic SaaS blue-grey (`#2f6bd4` primary, `#1a1f2b` sidebar, `#f4f5f7` field) with the palette and primitives **copy-pasted across 16 files**. The only accidental overlap is Space Grotesk and the gold switch pill — both hardcoded. Status-pill semantics are defined twice (dashboard vs diary) and will drift.

**Plan:**

1. **One source of truth — admin design tokens.** Create `src/lib/theme/admin.css` (or extend `tokens.css`) with `--admin-bg`, `--admin-surface`, `--admin-border`, `--admin-ink`, `--admin-muted`, `--admin-primary`, radius/spacing/shadow scales, and a **brand accent** pulled from the existing `--accent` per `data-brand` so Asia admin reads gold and Fusion reads terracotta. Replace the 7 hardcoded hex values across all admin files with vars. A token change then edits one file, not sixteen.
2. **Shared admin component primitives.** Build `<Card>`, `<DataTable>`, `<StatusPill>`, `<PrimaryButton>`, `<Field>`. The white-card-1px-border-10px-radius pattern is re-authored in ≥6 files — consolidate. `<StatusPill>` owns the single colour vocabulary (`confirmed/pending_payment/seated/overdue/completed/cancelled/no_show`) so dashboard and diary can't drift.
3. **On-brand without losing legibility.** Keep the dark sidebar (it grounds the tool) but introduce the brand accent on active nav, primary buttons, and the brand-switch pill via tokens; keep content surfaces light and high-contrast for service use. Goal: it should *feel* like Geisha the moment you're past the wordmark, while staying a fast operational tool.
4. **Mobile/tablet — the biggest UX gap (HIGH).** The shell is a fixed `220px 1fr` with **no breakpoint** (`+layout.svelte:57-65`); on a portrait floor tablet the sidebar eats ~220px and never collapses. Add a breakpoint with a burger/off-canvas drawer (this dovetails with the assistant dock's third column from §4.2). Data-dense tables use fixed `fr` grid tracks with no overflow — wrap in `overflow-x:auto` or stack on narrow screens (`tables`, `diary`, `settings`). Bump tap targets: inputs/buttons padded at 0.3–0.45rem and the ✕ delete are well under the ~44px touch guideline. Only 2 of 11 pages have any `@media` query today.

---

## 6. Recommended Build Order

Effort sizing: **S** ≈ ≤1 day · **M** ≈ 2–4 days · **L** ≈ 1–2 weeks. Phases are sequenced so trust and daily-use workflow land before AI expansion and polish. **Nothing public ships before Phase A is complete.**

### Phase A — Trust & Go-Live Blockers *(must finish before any public deploy)*

| Item | Effort | Why first |
|---|---|---|
| Staff auth gate in `hooks.server.ts` for `/admin/**` + `/api/admin-chat` + `/api/ai` + cron | **M** | Everything else is reachable by anyone today. |
| Per-actor identity threaded into `writeAudit` (`actor='ai'` + `on_behalf_of=userId`) | **S** | Audit currently lies about who acted. |
| Implement Dojo webhook HMAC signature verification | **S** | Forgeable "Captured" confirms unpaid bookings. |
| Re-validate `/api/admin-chat` confirm `input` against each tool's schema | **S** | Untrusted client input → arbitrary writes. |
| Multi-instance-safe booking lock (PocketBase row-lock / optimistic version, not in-process `Map`) | **M** | Double-booking on Vercel under load. |
| Wire Dojo live keys + online payment step in the widget + pre-start hold timeout | **L** | Deposits/no-show fees aren't actually taken; unpaid holds block slots. |
| Wire Resend keys; add cancellation-email status guard; in-time deposit **refund** path (`refundDeposit` is dead) | **M** | Confirmations are console logs; in-time cancels forfeit deposits wrongly. |

### Phase B — ResDiary Parity for Daily Service *(makes it a real replacement)*

| Item | Effort |
|---|---|
| **Move a seated party** + **seat across joined tables** in live view (`moveBooking` exists; fix the UI to submit multiple/occupied tableIds) | **M** |
| Multi-floor filter + floor switcher in live view (`getFloorPlan` `floorId?`) | **S** |
| **Amend booking** flow on `bookings/[id]` (re-validate via `allocateTables`; fixes cancel-rebook penalty trap) | **M** |
| **Covers cap / pacing throttle** per slot/service in the availability engine | **L** |
| **Closures / blackout / special-event** calendar (`geisha_closures` + engine override) | **M** |
| Enforce `booking_window_days` + minimum lead time | **S** |
| **Reminder email** before service (new cron job; infra exists via the secured cron) | **M** |
| Fix seat-picker filter (only un-seated/waiting bookings) + walk-in phone capture | **S** |
| Auto-release sweep: add pre-start unpaid-hold timeout | **S** |

### Phase C — Floor Editor Hardening

| Item | Effort |
|---|---|
| BUG-1: persist shape delete/edit immediately (`await save()`) + `beforeunload` guard | **S** |
| BUG-3 keyboard delete + BUG-4 undo/redo (ship together) | **M** |
| BUG-5/6/7/9 clamping (shape drag, rotated AABB, click-place, room-resize re-clamp) | **M** |
| Shape drag-rotate handle (BUG-2 short-term) + expose `zone`/`label` in Draw dropdown | **S** |
| BUG-8 shape multi-select + polyline/L-shape walls (P2) | **M** |

### Phase D — AI Unification & Front-and-Centre

| Item | Effort |
|---|---|
| Fix `geminiAgent.ts` loop bugs (parallel-write read-drop, tool-call id collision, confirm result re-feed) | **M** |
| Audit-actor signature fixes + add audit to `saveLayout/setShapes/setJoins` | **S** |
| Grow `adminTools.ts` to full catalogue (§4.1); retire Claude stack + `/admin/concierge` | **L** |
| Shared assistant rune store + persistent dock in `+layout.svelte` + ⌘-K bar | **M** |
| Expand `SETTING_META`; `update_service_period` + service-period editor UI | **M** |
| Voice V1 (Web Speech STT/TTS, `voice.ts`, confirm-gating preserved) | **M** |

### Phase E — CRM, Reporting & Polish

| Item | Effort |
|---|---|
| Admin design tokens + shared primitives (`<Card>/<DataTable>/<StatusPill>`) + brand accent | **M** |
| Tablet responsiveness: collapsible sidebar/drawer + table overflow + tap targets | **M** |
| Per-brand customer scoping (add `restaurant` relation) + dedupe by phone-or-email | **M** |
| Guest profile page (history, no-show counter, structured dietary/VIP fields, tags) | **L** |
| Marketing consent toggle + provenance; opt-in segmentation export; GDPR export/erasure | **M** |
| Reporting: covers/occupancy range, no-show rate (`get_covers_report`/`get_noshow_report`) | **M** |
| Realtime floor sync (PocketBase subscriptions, replacing 20s poll) + drag-and-drop seating | **L** |

### Phase F — Competitive / Differentiators (P2, as capacity allows)

Waitlist + notify-when-free · guest self-service amend/cancel link · run-sheet/allergen summary · `finishing` state + tile countdowns · configurable per-event deposit rules · SMS channel · review-request follow-up · voice V2 (streaming/realtime) · revenue/channel/cohort reporting + CSV export · blacklist/VIP gating at booking · POS/spend link.

---

**One-line guidance:** the engine is your moat — protect it (Phase A), make a busy Saturday actually runnable on it (Phase B), stop the planner eating edits (Phase C), *then* put the AI front-and-centre (Phase D) and make it look like Geisha (Phase E). Don't let the shiny AI/voice work jump the queue ahead of auth, payments, and the seated-party-move — those are what "replace ResDiary" actually means.
