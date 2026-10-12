# Geisha Booking & Admin System — Master Implementation Plan

*The definitive, fully-formed build plan to replace ResDiary across two restaurants (Asia + Fusion), structured for maximum parallel execution, with a beyond-industry-standard AI feature set. Supersedes `ADMIN_ROADMAP.md` with full implementation detail.*

---

## How to read this document

- **Work-package (WP):** the unit of work. Each has a stable id (`WP-S1-3`), a goal, dependencies, schema/server-fn/API/component/AI-tool changes, ordered steps, files, testable acceptance criteria, an effort size, what is parallelizable inside it, and risks.
- **Foundation (F1–F3):** cross-cutting work that must land before the streams. A hard barrier — nothing public ships until it is merged.
- **Stream (S1–S9):** an independent, end-to-end build track owning a mostly-disjoint set of files so streams run concurrently.
- **Effort key:** **S** ≈ ≤1 day · **M** ≈ 2–4 days · **L** ≈ 1–2 weeks · **XL** ≈ multi-week.
- **AI tool kinds:** `read` (auto-runs, fed back to the model) · `write` (HALTS the loop → client confirm) · `ui` (returns a UI directive). This confirm-gate invariant is preserved everywhere.
- **Decisions baked in:** Moonshot AI ambition · PocketBase staff users + RBAC roles (owner/manager/host/server) · fully-configurable deposit-rules engine · spec-as-parallel-work-streams.

---

## 1. System overview & target architecture

The booking **engine** (pure, DST-correct availability + allocation + joins + policy + audit) is the moat and already meets/beats ResDiary on the hard parts. This plan builds everything around it: the trust layer (staff auth/RBAC, real Dojo webhook HMAC, multi-instance-safe lock, hardened AI confirm endpoint), the live-service workflow, the operational booking layer (pacing, closures, lead-time, waitlist), the floor-editor fixes, CRM + reporting + GDPR, a unified front-and-centre AI agent with voice, a moonshot AI feature set, an on-brand admin design system, and the guest-facing widget + self-service.

**Schema additions** are batched into a single additive migration (`F2`, `pb_migrations/1772700600_*.js`) to spare the 1GB no-swap droplet a restart storm. It adds: `geisha_staff`; `geisha_closures`; `geisha_pacing_rules`; `geisha_deposit_rules` (seeded with the current £10pp-6+/£5pp policy as data); `geisha_waitlist`; `geisha_messages` (incl. a `reminder` template); customer fields (`restaurant` rel, `tags[]`, `vip`, `dietary` json, `allergies`, `no_show_count`, `cancel_count`, `marketing_consent_source`, `deleted_at`); booking fields (`amended_from`, `waitlist_origin`, `risk_score`, `risk_factors`, `dietary_flags`, `source: ai`); `geisha_audit_log.on_behalf_of`; `FloorShape.points` (polyline); `geisha_ai_insights`; `geisha_alerts`; `geisha_reviews`; `geisha_locks` (the multi-instance lock table); and `geisha_settings` rows for `deposit_rules`, `pacing_curve`, `risk_threshold`, `comms_autosend`, `unpaid_hold_minutes`, briefing recipients.

> **Review verdict:** PROCEED WITH AMENDMENTS. The dependency graph is structurally sound — verified against source: zero cycles, zero dangling dependsOn references, and the four headline claims (always-true Dojo verifySignature, in-process Map lock in create.ts:30-46, geminiAgent write-halt dropping already-run reads + the call_${i} vs call_${turn}_${i} id collision, and z.unknown() confirm passthrough) are all real and correctly targeted. The foundation-first ordering (F1/F2/F3 as a hard barrier) is right, and the two designated merge points (WP-S6-1 to split adminTools, WP-S8-1 for primitives) correctly gate their streams. HOWEVER, do not finalise until these are closed: (1) GAPS — no WP for the pre-service REMINDER email cron (ROADMAP calls it a core no-show reducer), the RUN-SHEET/allergen service summary, or the CONFIGURABLE DEPOSIT-RULES ENGINE + editor that consumes F2's geisha_deposit_rules (owner decision #4 — currently dead schema); cron-securing must be an explicit F1 acceptance criterion; and /admin/circle + /admin/content exist in the live shell but are unscoped (will ship unauthenticated/off-brand under F1/S8 unless explicitly handled). (2) The MOONSHOT graph is a disconnected island — no mf-* references any WP-* and vice-versa, so it is unschedulable; bridge mf-foundation-auth=F1, mf-foundation-schema=F2, mf-foundation-tools=S6-1/2/3. (3) WP-S7-1 'Test' is an un-scoped placeholder and must become concrete regression coverage for the lock swap and the S3 engine edits. (4) MERGE DISCIPLINE — +layout.svelte (5 editors across F1/F3d/S6-5/S8-2/S8-3) and availability.ts (3 S3 WPs) need the partitioning/serialisation spelled out above, and the F3b lock table must be pinned inside F2 before F3b starts. Verify F2 actually enumerates geisha_locks (F3's 'why' offers it only as an OR-alternative).

---

## 2. Parallel execution schedule (start here)

Land the foundation, then run the streams in waves. The waves below come from the adversarial review and already partition the known merge hotspots (see §8).

### Wave 0 — Foundation (mostly serial, F2/F3 partly parallel)

**Runs concurrently:** `F1` · `F2` · `F3`

> F1 (auth/RBAC + hooks gate + cron CRON_SECRET) and F2 (the single batched migration 1772700600) have no code deps on each other and can be authored in parallel by two people. F3 (audit-actor threading, multi-instance lock, AI-loop hardening, admin.css tokens) has FOUR independent sub-parts: F3a/F3b touch booking core, F3c touches geminiAgent.ts, F3d adds admin.css — these can be split across people, BUT F3b's lock table must be pinned in F2 first, so F2's schema decision (include geisha_locks? add version column?) gates F3b. Land order within the wave: F2 schema frozen -> F3b; F1 + F3a/c/d concurrent. NOTHING in Wave 1+ starts until F1+F2+F3 are merged — the prompt's own 'nothing public ships before Phase A' rule plus the shared-signature breaks in F3a make this a true barrier. Fold the two missing schema items into F2 now: geisha_messages 'reminder' template + seed geisha_deposit_rules with the current hardcoded policy.

### Wave 1 — Independent leaf WPs (all depend only on F1/F2/F3)

**Runs concurrently:** `WP-S1-1` · `WP-S1-2` · `WP-S1-4` · `WP-S6-1` · `WP-S8-1` · `WP-LIVE-1` · `WP-LIVE-3` · `WP-LIVE-4` · `WP-AVAIL-3` · `WP-AVAIL-2` · `WP-CRM-1` · `WP-CRM-5` · `WP-FLOOR-1` · `WP-S9-1` · `WP-S9-4` · `WP-S7-1`

> These share no files EXCEPT the availability.ts cluster — do NOT run WP-AVAIL-1, WP-AVAIL-2, WP-AVAIL-3 as three parallel authors of checkAvailability. AVAIL-1 is held to Wave 2 here (see note) so Wave 1 carries only AVAIL-2+AVAIL-3 as co-authored pre-filters in one PR. WP-S6-1 (registry split) and WP-S8-1 (admin primitives) are the two 'merge-point' enablers — prioritise them so Wave 2 of S6/S8 unblocks. WP-FLOOR-1 must precede all other S4 work. WP-CRM-1 should be treated as near-foundation (scope customers before S9 widget writes un-scoped rows). WP-S7-1 must be re-scoped from 'Test' to concrete engine+lock+confirm-endpoint regression tests before it is schedulable.

### Wave 2 — Second-order WPs

**Runs concurrently:** `WP-AVAIL-1` · `WP-S1-3` · `WP-S1-5` · `WP-S1-6` · `WP-LIVE-2` · `WP-LIVE-6` · `WP-AVAIL-4` · `WP-AVAIL-5` · `WP-CRM-2` · `WP-CRM-3` · `WP-CRM-6` · `WP-FLOOR-2` · `WP-FLOOR-3` · `WP-FLOOR-4` · `WP-FLOOR-7` · `WP-S6-2` · `WP-S6-3` · `WP-S6-4` · `WP-S6-5` · `WP-S8-2` · `WP-S8-3` · `WP-S9-2` · `WP-S9-3`

> S6-2/3/4 are parallel ONLY because S6-1 split adminTools into per-domain modules in Wave 1 — but de-dup create/cancel/seat between S6-2 and S6-4 (assign to S6-2; S6-4 ports only get_dashboard/search_customers/get_customer_history then deletes the Claude stack). S8-2 (token sweep across ALL admin pages incl /admin/circle + /admin/content) and S8-3 (responsive grid) both edit +layout.svelte — co-author or serialise S8-3 with WP-S6-5 (dock column) since both restructure the .admin grid. AVAIL-1 (pacing, post-allocation phase) lands here after AVAIL-2/3 pre-filters to avoid concurrent edits to checkAvailability. WP-FLOOR-2/3/4 all extend WP-FLOOR-1's persistence and touch FloorCanvas/geometry — they edit overlapping pointer-handler code; recommend FLOOR-3 (clamping) + FLOOR-1 author continuity, FLOOR-4 (rotate handle) separate.

### Wave 3 — Capstones

**Runs concurrently:** `WP-S1-7` · `WP-LIVE-5` · `WP-LIVE-7` · `WP-AVAIL-6` · `WP-CRM-4` · `WP-FLOOR-5` · `WP-FLOOR-6` · `WP-S6-6` · `WP-S6-7` · `WP-S8-5` · `WP-S9-5`

> These are integration/polish riders. WP-LIVE-7 (realtime PB subscriptions replacing the 20s poll + conflict handling) should land LAST in S2 as it touches every live-view mutation from LIVE-1/2/3. WP-S6-7 (voice V1) rides on the dock (S6-5). WP-S6-6 (type-to-confirm + invalidateAll) depends on S6-3+S6-5. ADD HERE the missing gap WPs once defined: reminder-email cron (after WP-S1-5), run-sheet view (after WP-CRM-2 + WP-LIVE-3), and the deposit-rules engine+editor (after F2; the engine could actually go as early as Wave 1). Moonshot mf-* features become a Wave 4 once you bridge mf-foundation-{auth=F1, schema=F2, tools=S6-1/2/3} into this graph.

**Concurrency model (architect):** Concurrency model: land F1→F2→F3 first (F1 and F2 can be authored in parallel since F2 is schema-only and F1 is auth code; F3 depends on both touching the booking/AI core). Once foundation merges, all 9 streams run concurrently — they were partitioned so each owns a near-disjoint file set. Realistically 6-8 of them truly run at once; S7 is gated on S6 and S1's payment plumbing for auto-comms.



Known merge points and how to keep them clean:

1) adminTools.ts is the hottest file — touched conceptually by S6 (full catalogue), S3 (settings/period/pacing read tools), S5 (CRM tools), S7 (insight tools). RESOLUTION: S6's FIRST work-package splits adminTools.ts into per-domain registry modules under src/lib/server/ai/tools/ with a thin composer; thereafter every other stream adds ONE file (toolsReports.ts, toolsInsights.ts, etc.) and never edits the shared barrel except to register. Land that split before other streams add tools.

2) src/lib/server/booking/admin.ts is shared by S2 (getFloorPlan floorId), S3 (none — it owns new modules), S5 (upsertCustomer/CRM reads), S6 (wiring existing fns as tools), F3 (audit-actor signatures). RESOLUTION: F3 lands the actor-signature changes to admin.ts FIRST; S2 confines its edit to getFloorPlan; S5 moves CRM logic into a new crm.ts and only touches queries.ts upsertCustomer. Treat admin.ts as append-mostly after F3.

3) src/lib/server/booking/mutate.ts already threads actor:AuditActor through every fn — S2 (move/seat) and S6 (AI wiring) call it but should NOT change signatures; new mutations (amend) go in S9's amend.ts, not mutate.ts.

4) availability.ts purity: S3 extends it via NEW pure inputs (pacing) passed by index.ts; S2 never touches availability.ts (only floor/mutate). Keep the engine pure so unit tests stay green.

5) admin/+layout.svelte is touched by S6 (dock mount), S8 (grid/drawer/tokens). RESOLUTION: S8 owns the layout's structure/CSS; S6 mounts the dock as a single component slot outside <main> — coordinate one small interface (a named region) so they don't both rewrite the grid. Sequence S8's shell change before S6's dock mount if possible.

6) Cron endpoints: each new sweep is its own route (api/cron/waitlist S3, api/cron/insights + api/cron/briefing S7), reusing the CRON_SECRET pattern from api/cron/release — no shared file.

7) DB writes to the gentle 1GB droplet: nightly insight/briefing jobs (S7) and the realtime subscriptions (S2) are the heaviest; schedule insight crons off-peak and cap subscription fan-out. All schema changes are already batched in F2 so only ONE migration ships to the droplet for the whole plan (plus any unavoidable late additive column, which should be appended as 1772700700+).

Production gating: per the roadmap, until F1 auth + S1's confirm re-validation land, ship only READ AI tools to prod and keep writes behind a dev flag.

---

## 3. Foundation layer (F1–F3 — hard barrier)

### F1 — Staff auth + RBAC (geisha_staff collection, hooks.server.ts gate, session helper, role matrix)

**Why first:** Every /admin/** page, /api/admin-chat, /api/ai and cron run today on a superuser PocketBase token behind a 'No auth yet' warning (hooks.server.ts only stamps data-route-brand; admin/+layout.svelte:47). Nothing can ship publicly and no stream can rely on a real actor identity until login + a server-side guard + a role helper exist. Adds geisha_staff(email,password,name,role[owner|manager|host|server],restaurants[],active) and an event.locals.staff populated in hooks, plus a requireRole() helper consumed by every loader/action/endpoint.

**Unblocks:** `F2`, `F3`, `S1`, `S2`, `S3`, `S4`, `S5`, `S6`, `S7`, `S8`, `S9`

### F2 — Batched schema migration 1772700600 — all new collections/fields for the whole plan

**Why first:** Avoids N uncoordinated migrations racing on the gentle 1GB droplet and lets every stream code against a fixed schema from day one. One additive migration adds: geisha_staff; geisha_closures(restaurant,date_from,date_to,scope[full|period],service_period?,reason,kind[holiday|private_hire|maintenance]); geisha_pacing_rules(restaurant,service_period?,dow[],max_covers_per_slot,max_covers_per_period,lead_time_minutes,booking_window_days); geisha_deposit_rules(restaurant,priority,service_period?,party_min,party_max,dow[],date_from?,date_to?,kind[deposit|noshow_hold|none],per_person_pence,capture[auto|manual]); geisha_waitlist(restaurant,customer,date,party_size,window_from,window_to,status,notified_at); customer fields (restaurant rel, tags[], vip bool, dietary json, allergies, no_show_count, cancel_count, marketing_consent_source, deleted_at); booking fields (amended_from?, waitlist_origin?, source 'ai'); geisha_audit_log.on_behalf_of; FloorShape.points json (polyline); geisha_ai_insights(restaurant,kind,subject_id,score,payload,created); geisha_messages(booking?,customer,channel[email|sms],template,status,sent_at). Schema only — no behaviour.

**Unblocks:** `S1`, `S3`, `S4`, `S5`, `S6`, `S7`, `S9`

### F3 — Audit-actor threading + multi-instance booking lock + AI-loop hardening + shared admin tokens

**Why first:** Four small cross-cutting fixes that, if left to individual streams, would cause constant merge collisions in the shared booking/AI/theme core. (a) Audit-actor: change createTable/updateTable/deleteTable/createFloor/updateFloor/deleteFloor in admin.ts to accept actor:AuditActor='staff' + on_behalf_of, and add writeAudit to saveLayout/setShapes/setJoins (currently silent) — extend writeAudit() + AuditLog.on_behalf_of. (b) Replace the in-process Map withLock in create.ts:30-46 with a PocketBase-backed advisory lock (geisha_locks row or optimistic version re-check) so Vercel's multi-instance runtime can't double-book. (c) Fix geminiAgent.ts loop bugs once: parallel-write read-drop at :404-414 (run reads, THEN halt on first write so already-run results aren't lost), tool-call id collision (call_${turn}_${i} everywhere), confirm-result re-feed, and lift history slice(-8)/6-turn caps to ~16/~10 — so the AI streams build on a stable loop. (d) Create src/lib/theme/admin.css with --admin-* tokens + brand accent from existing --accent, imported once in admin/+layout.svelte, so the design stream and every page touching markup share one token source.

**Unblocks:** `S1`, `S2`, `S4`, `S6`, `S7`, `S8`

> **Foundation acceptance additions from review:** cron endpoints (`/api/cron/*`) must be explicitly gated by a `CRON_SECRET` header check in F1 (distinct from staff session — cron has no logged-in actor). F2 must enumerate `geisha_locks` (the F3b lock table) and seed `geisha_deposit_rules` with the current policy. Decide the fate of the existing `/admin/circle` (loyalty) and `/admin/content` nav routes here — either bring them into F1’s gate + S8’s token sweep, or explicitly mark them out of scope (do not leave them silently unauthenticated/off-brand).

---

## 4. Build streams (S1–S9)

Each stream below is rendered from its detailed work-packages. Streams are ordered S1→S9; build them per the wave schedule in §2, not top-to-bottom.

### Stream S1 — Trust, Payments & Comms Go-Live

Closes the three hard go-live blockers in the money/security path and makes deposits, refunds and transactional email actually work. Implements the real Dojo webhook HMAC, re-validates the AI confirm endpoint input per-tool schema, collects the online payment step in the public widget, and wires Resend keys with status-guarded confirmation/cancellation/refund flows.

- **Depends on:** `F1`, `F2`, `F3`
- **Owns files:** `src/routes/api/webhooks/dojo/+server.ts`, `src/lib/server/payments/dojo.ts`, `src/lib/server/booking/payments.ts`, `src/lib/server/booking/release.ts`, `src/lib/server/email/send.ts`, `src/lib/server/email/confirmations.ts`, `src/lib/components/BookingPanel.svelte`, `src/routes/api/bookings/+server.ts`

This stream closes the three hard go-live blockers in Geisha's money + security path and makes deposits, no-show holds, refunds and transactional email actually work end-to-end. Today three things are stubs that quietly accept everything: the Dojo webhook's verifySignature() (src/routes/api/webhooks/dojo/+server.ts:21) ALWAYS returns true, so anyone who learns the URL can POST a fake "Captured" event and flip a pending_payment booking to confirmed; the /api/admin-chat and /api/ai confirm branches accept z.unknown() input (admin-chat/+server.ts:30) and re-run a confirm-gated WRITE tool with whatever the client sends, bypassing the per-tool JSON-schema the model was constrained to; and the public BookingPanel.svelte ends at a "A secure payment step will follow" placeholder (line 209) — no card is ever collected, so every deposit/no-show booking sits in pending_payment forever and is auto-released by release.ts.



The work here: (1) real Dojo HMAC verification keyed on DOJO_WEBHOOK_SECRET with timing-safe compare + idempotency; (2) per-tool input re-validation on BOTH confirm endpoints by converting each GeminiTool.parameters (the JSON-schema-ish spec already on every tool) into a runtime validator and rejecting anything that does not match; (3) a real card-collection step in BookingPanel using a new Dojo client-session (Setup Intent for no-show holds via card-on-file, Payment Intent for deposits) returned by /api/bookings and finalised by the webhook; (4) a pre-start unpaid-hold timeout in release.ts so pending_payment holds do NOT block slots before service; (5) Resend keys wired + a status guard so cancellation email never fires for a never-confirmed booking; (6) make the dead refundDeposit() reachable from cancelBooking AND a back-office action; (7) a Refund / Release-hold UI on the booking detail page replacing its "P4" placeholder note.



It depends on F1 (real event.locals.staff + requireRole so the admin/back-office actions and confirm endpoints have a real actor and are gated), F2 (batched migration 1772700600 — this stream needs the geisha_messages collection + booking fields it adds; we add NO new migration, only consume F2's schema), and F3 (audit-actor threading + multi-instance lock + AI-loop hardening + admin tokens — the confirm-revalidation WP layers directly on F3's hardened geminiAgent loop, and the refund actions reuse F3's actor/on_behalf_of audit signature). Everything is configured via existing settings (geisha_settings) and the F2 deposit-rules engine; this stream does not hardcode new policy. All money stays in pence; all times Europe/London.

#### WP-S1-1 — Real Dojo webhook HMAC verification (replace always-true stub) + idempotent event handling  `M`

**Goal:** Make /api/webhooks/dojo cryptographically reject forged/replayed events so a stranger can no longer flip a booking to confirmed by POSTing a fake Captured event.

**Depends on:** `F1`, `F3`

**Schema:** None. Consumes F2 schema only (no new fields needed for verification).

**Server functions:**

- src/lib/server/payments/dojo.ts: verifyWebhookSignature(rawBody:string, signatureHeader:string|null, timestampHeader:string|null): {ok:boolean; reason?:string}
- src/lib/server/payments/dojo.ts: webhookConfigured(): boolean
- src/lib/server/booking/payments.ts: markPayment(...) — add idempotency short-circuit (signature unchanged)

**API / actions:**

- POST /api/webhooks/dojo — unchanged request/response shape ({ok:true} variants); now 401 on bad signature, 503 when go-live and secret unset. Reads raw body via request.text() BEFORE JSON.parse (already does) — must keep raw for HMAC.

**Implementation steps:**

1. In src/lib/server/payments/dojo.ts add `export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, timestampHeader: string | null): { ok: boolean; reason?: string }`. Implement Dojo's documented scheme: compute HMAC-SHA256 over the concatenation `${timestampHeader}.${rawBody}` using DOJO_WEBHOOK_SECRET (read via $env/dynamic/private), hex-encode, and compare to the signature header using node:crypto `timingSafeEqual` (guard equal length first to avoid throw). Parse the header which Dojo sends as `t=<unix>,v1=<hex>` — split on ',' then on '=' into a map; accept the `v1` value. Return {ok:false,reason} on any mismatch/missing part.
2. Add replay protection: reject if `Math.abs(nowSeconds - Number(timestamp)) > 300` (5-minute tolerance) → reason 'stale timestamp'. Export the tolerance as a const so a test can override.
3. Keep isConfigured() semantics but split: add `export function webhookConfigured(): boolean { return Boolean(env.DOJO_WEBHOOK_SECRET); }`. The route uses webhookConfigured(), not the payment-key isConfigured().
4. In src/routes/api/webhooks/dojo/+server.ts replace the local verifySignature() (lines 21-28) with a call to verifyWebhookSignature(raw, request.headers.get('dojo-signature'), request.headers.get('dojo-timestamp')). If !webhookConfigured(): in dev (env unset) log a loud warning and proceed (preserve current dev behaviour) BUT short-circuit to 503 when env.PUBLIC_GO_LIVE === 'true' so we can hard-fail the unconfigured route in production. Add a comment that the route must be configured before the public webhook URL is registered with Dojo.
5. On a verification failure throw error(401,'Invalid webhook signature') (already present) and console.warn the reason (not the secret).
6. Idempotency: before mutating, guard double-processing. The webhook already calls markPayment + confirms the booking; wrap the confirm so it is a no-op if booking.status !== 'pending_payment' (already done at line 67) AND make markPayment idempotent by skipping the write when status is unchanged AND the relevant timestamp is already set (so a Dojo retry of the same Captured event does not write a second audit row). Add this guard inside markPayment in payments.ts: `if (before.status === status && (!extra.captured_at || before.captured_at) && (!extra.reversed_at || before.reversed_at)) return before;`.
7. Add unit tests in src/lib/server/payments/dojo.test.ts: (a) a body+timestamp signed with the known secret verifies ok; (b) a tampered body fails; (c) a stale timestamp (>300s) fails; (d) missing header fails; (e) wrong-length signature does not throw.

**Files:** `src/lib/server/payments/dojo.ts`, `src/routes/api/webhooks/dojo/+server.ts`, `src/lib/server/booking/payments.ts`, `src/lib/server/payments/dojo.test.ts`

**Acceptance criteria:**

- A POST signed with DOJO_WEBHOOK_SECRET (correct t=.v1= header) returns 200 and advances the payment/booking.
- A POST with a tampered body or wrong signature returns 401 and does NOT mutate any geisha_payments or geisha_bookings row.
- A POST with a timestamp older than 5 minutes returns 401.
- Re-delivering the identical Captured event a second time does NOT create a second audit_log row and leaves status/captured_at unchanged.
- With DOJO_WEBHOOK_SECRET unset and PUBLIC_GO_LIVE!=='true', the route still processes (dev) and logs a warning; with PUBLIC_GO_LIVE==='true' it returns 503.
- dojo.test.ts passes all five cases.

**Parallelizable:** The dojo.ts verify function + its unit tests can be built and tested in complete isolation (pure crypto, no PB) in parallel with the route wiring. The markPayment idempotency tweak is independent of WP-S1-3..7 and can land first.

**Risks:**

- Dojo's exact header name/format must be confirmed against their live docs — implement the parser tolerantly (accept either a combined `dojo-signature: t=..,v1=..` header or separate `dojo-signature`+`dojo-timestamp` headers) and unit-test both.
- SvelteKit body consumption: the route MUST read request.text() once (it does) — do not also call request.json() or the stream is already consumed.
- timingSafeEqual throws on unequal Buffer lengths — length-guard before calling.

---

#### WP-S1-2 — Per-tool input re-validation on the confirm branch of /api/admin-chat and /api/ai (reject z.unknown() passthrough)  `M`

**Goal:** Stop a confirmed WRITE tool from running with arbitrary client-supplied input: validate the confirm payload against the exact parameters schema declared on that tool before executing.

**Depends on:** `F1`, `F3`

**Server functions:**

- src/lib/server/ai/validateToolInput.ts: validateToolInput(schema, input): {ok:true; value} | {ok:false; errors}
- src/lib/server/ai/geminiAgent.ts: confirmTool(tools, name, input) — now validates against def.parameters before run()
- src/lib/server/ai/agent.ts: confirmAction(tool, input) — same validation

**API / actions:**

- POST /api/admin-chat (confirm branch): body {brand, confirm:{tool:string, input:object}} — now 400 'Invalid input for <tool>: ...' on schema mismatch, 401/403 if not staff. Success unchanged {ok:true, result}.
- POST /api/ai (confirm branch): body {confirm:{tool:string, input:object}} — same new failure modes.

**AI tools:**

- No new tool. This WP HARDENS the existing confirm-gated WRITE tools (move_booking, join_tables, update_setting on adminTools.ts; create_booking/cancel_booking/seat_booking on the legacy agent) by re-validating their input against each tool's own `parameters` at confirm time. The AI stream needs to do nothing — validation reads the schema they already declare.

**Implementation steps:**

1. Add a small runtime validator that turns a GeminiTool.parameters object (the JSON-schema-ish spec already on every tool: {type:'object', properties:{...}, required:[...]}) into a checked value. Put it in a new file src/lib/server/ai/validateToolInput.ts: `export function validateToolInput(schema: Record<string,unknown>, input: unknown): { ok: true; value: Record<string,unknown> } | { ok: false; errors: string[] }`. Support the subset actually used by the tools: top-level type:'object', required[], and property types 'string' | 'integer' | 'number' | 'boolean' | 'array' (with items.type) | unconstrained (update_setting.value has no type → accept any). Reject unknown extra keys (strip or error — choose error for writes). Coerce nothing here except: leave numeric coercion to the tool's own run() (update_setting already coerces).
2. Extend GeminiTool conceptually: do NOT add a field — derive validation purely from existing `parameters`. This keeps the AI stream (adminTools.ts) untouched; the validator is fed `def.parameters`.
3. In src/lib/server/ai/geminiAgent.ts harden confirmTool(): change signature to `confirmTool(tools: GeminiTool[], name: string, input: unknown): Promise<unknown>` (already that shape). Inside, after finding the def and asserting kind==='write', call validateToolInput(def.parameters, input); if !ok throw new Error('Invalid input for '+name+': '+errors.join('; ')). Only then call def.run(value). This single change covers BOTH endpoints because both route through confirmTool / confirmAction.
4. Mirror the same guard in the legacy Claude path src/lib/server/ai/agent.ts confirmAction() (it currently runs the tool with raw input). Import validateToolInput and validate against that tool's parameters too. (Note: PLAN retires the Claude concierge, but until it is deleted this hole must be closed.)
5. In src/routes/api/admin-chat/+server.ts and src/routes/api/ai/+server.ts tighten the Zod Confirm schema from `input: z.unknown()` to `input: z.record(z.string(), z.unknown())` (must be an object) and keep tool as a non-empty string — cheap first-line defence; the authoritative check is validateToolInput inside confirmTool.
6. Gate the confirm branch behind F1: require event.locals.staff with a role permitted to perform writes (requireRole('host') or higher per F1's matrix) at the top of both POST handlers; return 401/403 if absent. Pass the real actor through (F3 threaded actor) so the audit row records who confirmed.
7. Add unit tests src/lib/server/ai/validateToolInput.test.ts: move_booking with {bookingId:'x',tableIds:['a','b']} passes; move_booking missing tableIds fails; move_booking with tableIds: 'a' (string not array) fails; update_setting {key:'online_party_max',value:12} passes; an extra unexpected key fails; join_tables with numbers instead of strings fails.

**Files:** `src/lib/server/ai/validateToolInput.ts`, `src/lib/server/ai/geminiAgent.ts`, `src/lib/server/ai/agent.ts`, `src/routes/api/admin-chat/+server.ts`, `src/routes/api/ai/+server.ts`, `src/lib/server/ai/validateToolInput.test.ts`

**Acceptance criteria:**

- Confirming move_booking with a non-array tableIds (or missing bookingId) returns 400 and never calls moveBooking().
- Confirming update_setting with {key,value} of the right shape still works end-to-end and audits actor='ai' (with on_behalf_of = the confirming staff from F1/F3).
- A confirm POST without a valid staff session returns 401/403.
- Sending an extra unexpected property in input is rejected.
- validateToolInput.test.ts passes; existing admin-assistant happy-path (open_settings then confirm update_setting) still works in a manual run.

**Parallelizable:** validateToolInput.ts + its tests are pure and can be written first in isolation. Wiring into geminiAgent.confirmTool vs agent.confirmAction are two independent edits. The Zod-tightening in the two routes is trivial and independent. Depends on F3 having already de-collided the loop's tool-call ids and on F1 for the requireRole gate, but the validator itself does not.

**Risks:**

- The JSON-schema subset must cover every shape the live tools declare — audit adminTools.ts (5 read, 1 ui, 3 write) and agent/tools.ts before shipping so no legitimate confirm is wrongly rejected. update_setting.value is intentionally unconstrained (number|string) — the validator must allow an untyped property.
- Do not double-validate to the point of breaking ui/read tools — only confirmTool/confirmAction (writes) gain the strict check; read/ui tools still run inside the loop from model-supplied args (the model is constrained by the same parameters at call time).

---

#### WP-S1-3 — Wire live Dojo card-collection step in BookingPanel.svelte (Setup Intent for holds, Payment Intent for deposits) + client session endpoint  `L`

**Goal:** Replace the 'A secure payment step will follow' placeholder with a real Dojo client card-collection flow so deposit/no-show-hold bookings actually capture/authorise and reach confirmed.

**Depends on:** `F1`, `F2`, `WP-S1-1`

**Schema:** None new. Reuses geisha_payments.dojo_payment_intent_id for the session/intent id and geisha_bookings.status. (F2 added deposit-rules + booking fields the deposit amount derives from; this WP reads them via policy/deposit-rules engine, does not add schema.)

**Server functions:**

- src/lib/server/payments/dojo.ts: createPaymentSession({amountPence,reference,captureMode}): {id,clientSecret?,hostedUrl?,configured}
- src/lib/server/payments/dojo.ts: createSetupSession({reference}): {id,clientSecret?,hostedUrl?,configured}
- src/lib/server/booking/payments.ts: startPaymentForBooking(bookingId, requirement) → now returns {payment, configured, clientSecret?, hostedUrl?, mode} | null

**API / actions:**

- POST /api/bookings — response.payment now {kind, amountPence, reason, mode?:'payment'|'setup', clientSecret?, hostedUrl?, paymentId?} alongside paymentConfigured. 201 unchanged on shape-compatible additions.
- GET /api/bookings/[id]/status — {status:BookingStatus, paid:boolean}. Read-only poll for the client to detect webhook confirmation.

**Components:**

- BookingPanel.svelte — add phase 'payment': renders Dojo hosted-payment link OR mounts the Dojo card SDK; handles success→done; shows configured:false fallback. Responsibility stays: customer card capture; it does NOT decide confirmation (webhook does).

**Implementation steps:**

1. Decide the two Dojo modes precisely: DEPOSIT (party 6+ per F2 deposit-rules) = Payment Intent captureMode 'Auto' (charge now); NO-SHOW HOLD (Fri/Sat 3-5) = a Setup Intent / card-on-file so we store the card and only create+capture a Manual Payment Intent at no-show time (a £5pp pre-auth held for days fails/expires, so card-on-file is correct). Add `export async function createSetupSession(input:{reference:string}): Promise<{ id:string; clientSecret?:string; hostedUrl?:string; configured:boolean }>` to src/lib/server/payments/dojo.ts that POSTs Dojo's setup/card-on-file session endpoint; mirror the stub behaviour of createPaymentIntent when !isConfigured() (return id 'stub_*', configured:false).
2. Add `export async function createPaymentSession(input:{ amountPence:number; reference:string; captureMode:CaptureMode }): Promise<{ id:string; clientSecret?:string; hostedUrl?:string; configured:boolean }>` — the client-facing variant of createPaymentIntent that returns the data the Dojo web SDK / hosted page needs (clientSecret or hostedUrl). Keep the existing server-side createPaymentIntent for staff/back-office paths.
3. In src/lib/server/booking/payments.ts extend startPaymentForBooking to also return the client session: change its return to `{ payment: Payment; configured: boolean; clientSecret?: string; hostedUrl?: string; mode: 'payment'|'setup' } | null`. For kind 'deposit' call createPaymentSession(captureMode 'Auto'); for kind 'noshow_hold' call createSetupSession (mode 'setup'); persist the resulting intent/session id into geisha_payments.dojo_payment_intent_id (existing field).
4. In src/routes/api/bookings/+server.ts surface the session to the client: add to the 201 response a `payment` block that now includes `{ kind, amountPence, reason, clientSecret?, hostedUrl?, mode?, paymentId }`. Keep paymentConfigured. When Dojo is unconfigured (stub) the response carries configured:false and the client shows the existing 'we'll confirm by phone/email' fallback instead of a card form.
5. In src/lib/components/BookingPanel.svelte add a new phase 'payment' between 'details' and 'done'. After POST /api/bookings succeeds and payment.kind!=='none' && payment.clientSecret/hostedUrl present: render a card step. Two implementation options, pick hostedUrl-first for v1 simplicity: if hostedUrl present, render a 'Continue to secure payment' button linking to it (Dojo-hosted), with a note that the booking confirms automatically once paid; if only clientSecret, mount the Dojo web components/SDK (dynamic import, client-only, guarded) into a <div bind:this={cardMount}>. Add $state for paymentClientSecret, paymentHostedUrl, paymentMode, paymentId, paying, payError.
6. On successful client-side card submit (SDK callback) or on return from hostedUrl, transition phase to 'done' and show a 'Payment received — your booking is confirmed once we get the all-clear (usually instant)'. The authoritative confirmation is the webhook (WP-S1-1) flipping pending_payment→confirmed; the UI must NOT itself mark confirmed. Poll GET /api/bookings/:id/status (new lightweight read) up to ~10s to reflect the confirmed state, else show 'we'll email your confirmation shortly'.
7. Add GET /api/bookings/[id]/status (+server.ts) returning {status, paid:boolean} from getBookingDetail — read-only, no auth (id is an opaque PB id), used by the poll. Gate to only return minimal fields.
8. Update the BookingPanel 'done' branch copy: remove the literal 'A secure payment step will follow to confirm your reservation.' placeholder (line 209). Keep the no-payment path copy as-is.
9. Wire env: document DOJO_SECRET_KEY (server) and any DOJO public/publishable key needed by the web SDK as PUBLIC_DOJO_* in .env via the env-sync skill; the SDK key, if required, is exposed through $env/static/public or returned in the session payload (prefer returning per-session clientSecret/hostedUrl so no long-lived public key is shipped).

**Files:** `src/lib/server/payments/dojo.ts`, `src/lib/server/booking/payments.ts`, `src/routes/api/bookings/+server.ts`, `src/routes/api/bookings/[id]/status/+server.ts`, `src/lib/components/BookingPanel.svelte`

**Acceptance criteria:**

- With live DOJO_SECRET_KEY: a 6+ booking goes details→payment, the deposit is charged via the Dojo flow, the webhook then flips the booking to confirmed and the panel shows confirmed within the poll window.
- A Fri/Sat 3-5 booking goes through the Setup/card-on-file step (no immediate charge), webhook authorises/records the hold, booking confirmed.
- With Dojo unconfigured (stub), the panel shows the graceful 'we'll confirm shortly' message and never renders a broken card form; no console errors.
- The literal placeholder string 'A secure payment step will follow' no longer appears in BookingPanel.
- GET /api/bookings/:id/status returns the live status and is used by the poll.

**Parallelizable:** Server-side (dojo.ts session fns + payments.ts return shape + /api/bookings response + status endpoint) can be built and stubbed first, unblocking the Svelte work. The BookingPanel 'payment' phase UI and the Dojo client SDK integration are a separable front-end sub-task that can proceed against the stub response. Hosted-URL path and clientSecret/SDK path are two independent rendering branches.

**Risks:**

- Dojo's exact client integration (web components vs hosted page, field names clientSecret/hostedUrl/sessionToken) must be verified against their live SDK docs before final wiring; the WP is written to accommodate either by returning both optional fields — confirm which Dojo actually provides.
- Setup-Intent vs long Manual pre-auth for the no-show hold: a multi-day card pre-auth typically expires; card-on-file + capture-at-no-show is the robust choice and is the assumed design — confirm Dojo supports storing a card token reusable later.
- Client must never treat its own success callback as confirmation of the booking (webhook is source of truth) to avoid confirming a booking whose charge later fails.

---

#### WP-S1-4 — Pre-start unpaid-hold timeout + release in release.ts (don't let pending_payment holds block slots before service)  `M`

**Goal:** Auto-release stale pending_payment bookings whose card step was abandoned, BEFORE service starts, so an unpaid hold doesn't silently occupy a table for hours/days.

**Depends on:** `F1`, `F2`

**Schema:** None new (uses geisha_settings key 'unpaid_hold_minutes' — a value row, not a schema change; default applied in getSettings()).

**Server functions:**

- src/lib/server/booking/release.ts: shouldExpireUnpaid(booking, now, holdMinutes): boolean
- src/lib/server/booking/release.ts: runReleaseSweep(brand, now) → ReleaseResult{checked, released[], expired[]}
- src/lib/server/booking/mutate.ts: expireUnpaidHold(id: string, actor: AuditActor='system'): Promise<Booking>
- src/lib/server/booking/queries.ts: getSettings() → add unpaid_hold_minutes (default 15)

**API / actions:**

- POST /api/cron/release — unchanged contract; response now includes per-brand {checked, released[], expired[]}.

**AI tools:**

- Extends the existing update_setting / open_settings tools by adding the 'unpaid_hold_minutes' key to SETTING_META — no new tool, the admin assistant can now open/edit this setting.

**Implementation steps:**

1. Add a second pure predicate to src/lib/server/booking/release.ts: `export function shouldExpireUnpaid(booking: Pick<Booking,'status'|'created'|'starts_at'>, now: Date, holdMinutes: number): boolean` — returns true only when status==='pending_payment' AND now > created + holdMinutes (the card step was never completed). This is distinct from shouldRelease() which is the post-start 20-min no-show rule. Guard: never expire a pending_payment booking that has actually been paid (status would already be 'confirmed' via webhook), and never expire one whose start is already past (that's the no-show path).
2. Add a setting key `unpaid_hold_minutes` to the policy settings read in queries.ts getSettings() (default 15) so the timeout is configurable; expose it in SETTING_META (adminTools.ts) with label 'Cancel unpaid hold after (minutes)' type 'number' so the admin assistant + settings page can edit it.
3. Extend runReleaseSweep() in release.ts: in addition to the existing post-start candidates, fetch pending_payment bookings created earlier than (now - unpaid_hold_minutes) that are NOT yet expired/cancelled, and for each where shouldExpireUnpaid() is true, cancel them via a dedicated path (NOT markNoShow — these never started). Call a new mutate fn expireUnpaidHold(id,'system') that: sets status 'cancelled', calls releaseHold(id) (reverse any auth / void the setup), writes audit action 'expire_unpaid_hold', and does NOT send a cancellation email (guarded by WP-S1-5's never-confirmed rule). Add expireUnpaidHold to src/lib/server/booking/mutate.ts.
4. Update ReleaseResult to also carry `expired: string[]` and return both released (post-start no-shows) and expired (pre-start unpaid). Keep `checked`.
5. Ensure the PB filter for the unpaid candidates uses toPbDateFilter() on the created bound (space not T, lexicographic) — reuse the helper from queries.ts. Filter: restaurant + status='pending_payment' + created<=(now-hold) — but compute the cutoff in JS and pass it normalised.
6. The cron route /api/cron/release already calls runReleaseSweepAll — no route change needed; it now also expires unpaid holds. Confirm the response JSON surfaces expired counts.
7. Unit tests in release.test.ts: shouldExpireUnpaid true for a 20-min-old pending_payment with hold=15; false for a 5-min-old one; false for a confirmed booking; false for a pending_payment whose start is already past (defer to no-show); sweep returns the id in `expired` and the booking ends 'cancelled'.

**Files:** `src/lib/server/booking/release.ts`, `src/lib/server/booking/mutate.ts`, `src/lib/server/booking/queries.ts`, `src/lib/server/ai/adminTools.ts`, `src/lib/server/booking/release.test.ts`

**Acceptance criteria:**

- A pending_payment booking older than unpaid_hold_minutes whose start is still in the future is cancelled by the next sweep, its table freed, and a releaseHold() reversal/void is attempted.
- A confirmed booking is never touched by the unpaid-hold path.
- A pending_payment booking whose start is already past is handled by the existing no-show release, NOT the unpaid path (no double handling).
- No cancellation email is sent for an expired-unpaid (never-confirmed) booking.
- The cron response reports expired ids; release.test.ts passes.

**Parallelizable:** shouldExpireUnpaid + its tests are pure and can be written immediately, independent of everything. The mutate.expireUnpaidHold fn and the getSettings default are small independent edits. The SETTING_META addition is a one-liner that can be done alongside WP-S1-2/3 without conflict.

**Risks:**

- Race with the webhook: a booking could be paid the instant before the sweep cancels it. Mitigate by re-reading the booking inside expireUnpaidHold and aborting if status is no longer 'pending_payment' (TOCTOU guard), reusing F3's lock/version pattern.
- Clock: created is PB-server time; compare in UTC ms consistently. Use the toPbDateFilter helper for the query bound.

---

#### WP-S1-5 — Wire Resend (RESEND_API_KEY/EMAIL_FROM) + cancellation-email status guard + delivery logging to geisha_messages  `M`

**Goal:** Turn on real transactional email and stop sending a 'your booking is cancelled' email for a booking that was never confirmed (abandoned/unpaid), while logging every send to geisha_messages for an audit trail.

**Depends on:** `F1`, `F2`, `WP-S1-4`

**Schema:** Uses F2's geisha_messages(booking?, customer, channel[email|sms], template, status, sent_at). No new migration in this stream.

**Server functions:**

- src/lib/server/email/send.ts: send(msg: EmailMessage, ctx?: {booking?:string; customer?:string; template:string}): {sent:boolean; id?:string} — now also logs to geisha_messages
- src/lib/server/email/confirmations.ts: sendBookingConfirmation / sendCancellation — pass template + ids context through
- src/lib/server/booking/mutate.ts: cancelBooking — gate sendCancellation on before.status in {confirmed, seated}

**Implementation steps:**

1. Operational: set RESEND_API_KEY + EMAIL_FROM in the Vercel + local env via the env-sync skill. send.ts already goes live automatically once the key is present (isConfigured()). No code change needed to send.ts for the key itself.
2. Add a status guard so cancellation email only fires for a booking the guest actually had confirmed. In src/lib/server/booking/mutate.ts cancelBooking(): only call sendCancellation() when `before.status === 'confirmed' || before.status === 'seated'`. For 'pending_payment' (never paid/confirmed) or already-terminal states, skip the email. Same guard for expireUnpaidHold (WP-S1-4) — never email.
3. Add the same notion to sendCancellation in confirmations.ts defensively: it already returns {sent:false} when no email; leave that, but the authoritative gate is the status check in mutate so we don't fire for never-confirmed.
4. Add delivery logging: extend send() in src/lib/server/email/send.ts to accept an optional context `{ booking?: string; customer?: string; template: string }` and, after attempting send, write a geisha_messages row (F2 collection: {booking?, customer, channel:'email', template, status, sent_at}) with status 'sent'|'failed'|'skipped' and sent_at when sent. Keep send() non-throwing (email is best-effort) — wrap the message-log write in try/catch so a logging failure never breaks a booking.
5. Thread the context through confirmations.ts: sendBookingConfirmation passes {booking:booking.id, customer:customer.id, template:'booking_confirmation'}; sendCancellation passes template:'booking_cancellation'. (Refund email in WP-S1-6 passes template:'deposit_refunded'.)
6. Add a Resend webhook (optional, low priority) note as a follow-up: a future /api/webhooks/resend could update geisha_messages.status to delivered/bounced; out of scope for go-live but the schema (status field) supports it.
7. Tests: a unit test for the cancel guard — cancelBooking on a pending_payment booking does NOT call sendCancellation (mock confirmations); on a confirmed booking it DOES. A test that send() writes a geisha_messages row with the right template + status (mock the Resend fetch).

**Files:** `src/lib/server/email/send.ts`, `src/lib/server/email/confirmations.ts`, `src/lib/server/booking/mutate.ts`, `src/lib/server/email/send.test.ts`

**Acceptance criteria:**

- Cancelling a confirmed booking sends a cancellation email AND writes a geisha_messages row template='booking_cancellation' status='sent'.
- Cancelling a pending_payment (never-confirmed) booking sends NO cancellation email and writes either no message row or a status='skipped' row.
- With RESEND_API_KEY set, a confirmation email is actually delivered (verified in Resend dashboard / test inbox); with it unset, send() logs and returns {sent:false} and the booking still succeeds.
- A Resend API failure (mocked non-200) returns {sent:false}, logs status='failed', and never throws into the booking flow.
- send.test.ts passes.

**Parallelizable:** The cancel-status guard in mutate.ts is independent of the geisha_messages logging in send.ts — two separate edits that can be done in parallel. Threading template context through confirmations.ts is mechanical. Setting the env keys (env-sync skill) is an ops task that can happen any time.

**Risks:**

- Don't let geisha_messages write failures bubble into the booking path — wrap in try/catch; email + logging are strictly best-effort.
- EMAIL_FROM domain must be verified in Resend or sends silently fail (200 from Resend but bounced) — the message log + a real test inbox is how we catch this.
- Be careful the guard doesn't suppress legitimate cancellations: a manually-confirmed phone booking is status 'confirmed', so it is correctly included.

---

#### WP-S1-6 — In-time deposit refund path: make refundDeposit reachable from cancelBooking + a back-office refund server fn  `M`

**Goal:** Stop refundDeposit() being dead code — actually refund a captured deposit on a valid (in-time) cancellation, and expose a back-office refund function the detail-page UI (WP-S1-7) calls.

**Depends on:** `F1`, `F3`, `WP-S1-1`

**Schema:** None new (uses geisha_payments + F2's geisha_audit_log.on_behalf_of from F3).

**Server functions:**

- src/lib/server/booking/payments.ts: refundDepositManual(bookingId, amountPence|'full', reason, actor, onBehalfOf?): {refunded:boolean; payment?}
- src/lib/server/booking/payments.ts: releaseHoldManual(bookingId, actor, onBehalfOf?): {released:boolean}
- src/lib/server/booking/policy.ts: depositRefundable(now, startsAt, rule?): boolean
- src/lib/server/booking/mutate.ts: cancelBooking — in-time branch now calls refundDeposit when depositRefundable()

**API / actions:**

- No standalone API route — the back-office refund/release is invoked via the booking-detail +page.server.ts form actions defined in WP-S1-7.

**Implementation steps:**

1. Wire refundDeposit into cancelBooking. Today mutate.cancelBooking() calls chargeNoShow() (late) or releaseHold() (in-time). releaseHold() only reverses a noshow_hold auth and is a no-op for a captured deposit. Change the in-time branch: if late → chargeNoShow(); else → releaseHold() AND refundDeposit(id, 'In-time cancellation'). refundDeposit (payments.ts) already guards to only act when payment.kind is a deposit with status 'Captured', so calling it unconditionally on the in-time branch is safe (it no-ops for holds).
2. Make policy explicit per the deposit-rules engine (F2): whether an in-time cancellation refunds the deposit should be governed by the deposit rule's terms, not hardcoded. Add a tiny helper in policy.ts `export function depositRefundable(now: Date, startsAt: Date, rule?: DepositRuleContext): boolean` defaulting to !isLateCancellation (in-time → refundable) so current behaviour (£10pp non-refundable for late) is preserved and future rules can override. cancelBooking consults it.
3. Add a back-office refund server function in src/lib/server/booking/payments.ts: `export async function refundDepositManual(bookingId: string, amountPence: number | 'full', reason: string, actor: AuditActor, onBehalfOf?: string): Promise<{ refunded: boolean; payment?: Payment }>`. It loads the payment, asserts kind deposit & status 'Captured', computes amount (full = payment.amount; partial must be <= payment.amount), calls refundPaymentIntent(intentId, amount, idempotencyKey=`refund-${paymentId}-${amountPence}`, reason), then markPayment(...). Writes audit (action 'refund_deposit', actor, on_behalf_of via F3's extended writeAudit). Returns refunded:false (not throw) when Dojo unconfigured or not refundable, so the UI can show a clear reason.
4. Add a release-hold back-office fn `export async function releaseHoldManual(bookingId: string, actor: AuditActor, onBehalfOf?: string): Promise<{released:boolean}>` wrapping releaseHold() with an audit entry, for the 'Release hold' button (WP-S1-7) on a noshow_hold that staff want to void early.
5. Idempotency: the idempotencyKey passed to refundPaymentIntent must be stable per (payment, amount) so a double-click can't double-refund. refundPaymentIntent already takes an idempotencyKey arg — pass the composed key.
6. Optionally send a 'deposit refunded' email via WP-S1-5's send() with template 'deposit_refunded' (best-effort) on a successful manual refund.
7. Tests: cancelBooking in-time on a deposit booking calls refundPaymentIntent (mock dojo) and marks Refunded; cancelBooking late on a deposit does NOT refund; refundDepositManual on a non-captured payment returns refunded:false without calling Dojo; a partial amount > captured is rejected.

**Files:** `src/lib/server/booking/payments.ts`, `src/lib/server/booking/mutate.ts`, `src/lib/server/booking/policy.ts`, `src/lib/server/booking/payments.test.ts`

**Acceptance criteria:**

- An in-time cancellation of a 6+ deposit booking issues a Dojo refund and the payment row becomes status 'Refunded'.
- A late cancellation of a deposit booking does NOT refund (deposit forfeited) — current policy preserved.
- refundDepositManual full-refunds a captured deposit, audits action 'refund_deposit' with actor + on_behalf_of, and is idempotent under a double call (same idempotencyKey → Dojo dedupes).
- refundDepositManual on an uncaptured/already-refunded payment returns {refunded:false} with a reason and makes no Dojo call.
- releaseHoldManual voids an Authorized no-show hold and audits it.
- payments.test.ts passes.

**Parallelizable:** depositRefundable() (pure) + the cancelBooking wiring are independent of the back-office refundDepositManual/releaseHoldManual fns; both sub-tasks can proceed in parallel. The email-on-refund piece depends on WP-S1-5 but is optional and can be added last.

**Risks:**

- Double-refund: rely on the stable idempotencyKey AND a status re-check (status must be 'Captured' before refunding) to prevent it.
- refundPaymentIntent currently passes idempotencyKey as a header (extraHeaders.idempotencyKey) — confirm Dojo's expected header name and that the partial-amount field name matches Dojo's refund API.
- Policy must come from F2's deposit-rules engine eventually; the depositRefundable default keeps go-live correct without coupling tightly to F2's internal shape.

---

#### WP-S1-7 — Manual refund / release-hold UI on the booking detail page (replace the 'P4' placeholder)  `M`

**Goal:** Give staff a real Refund and Release-hold control on /admin/bookings/[id], showing the payment state and calling the WP-S1-6 server fns — replacing the 'Payment capture / refund will appear here once Dojo is connected (P4)' note.

**Depends on:** `F1`, `F3`, `WP-S1-6`

**Server functions:**

- src/lib/server/booking/admin.ts: getPaymentForBooking(bookingId: string): Promise<Payment | null>
- +page.server.ts actions: refund (calls refundDepositManual), releaseHold (calls releaseHoldManual) — both pass actor='staff', onBehalfOf=locals.staff.id

**API / actions:**

- Form action POST ?/refund — body {amount:'full'|pence-number, reason} → {ok, refunded, reason?} or fail(400,{reason}).
- Form action POST ?/releaseHold — no body → {ok, released} or fail(400,{reason}).

**Components:**

- admin/bookings/[id]/+page.svelte — add a Payment panel + Refund/Release-hold forms (use:enhance), payment-status pill, stub/unconfigured disabled state, outcome messaging. Replaces the P4 placeholder note.

**Implementation steps:**

1. Extend the loader src/routes/admin/bookings/[id]/+page.server.ts to also load the payment row for the booking. Add a getPaymentForBooking export to admin.ts (or reuse a small query) returning the geisha_payments row (kind, amount pence, status, captured_at, reversed_at) so the page can show 'Deposit £10.00 — Captured' / 'No-show hold — Authorized' / 'Refunded'. Add it to the returned data: { brand, booking, payment }.
2. Gate the page + actions behind F1 requireRole: viewing detail = host+, refunding = manager+ (per F1 matrix). Use event.locals.staff in load + actions; redirect/403 if unauthorised. Pass the staff id as on_behalf_of / actor='staff' into the refund/release fns.
3. Add two new form actions to +page.server.ts: `refund` → reads amount (full or a pence value from a form field) + reason, calls refundDepositManual(params.id, amount, reason, 'staff', locals.staff.id); `releaseHold` → calls releaseHoldManual(params.id, 'staff', locals.staff.id). Return {ok:true, refunded/released, reason?} for the UI to surface; on a refunded:false result, return a fail() with the reason (e.g. 'Nothing to refund — deposit not captured').
4. In src/routes/admin/bookings/[id]/+page.svelte replace the placeholder <p class="note">…(P4)</p> with a Payment panel: show payment kind + formatted amount (pence/100) + status pill; when status is 'Captured' && kind 'deposit' show a 'Refund deposit' form (with an optional partial-amount input defaulting to full and a reason input) using use:enhance posting ?/refund; when kind 'noshow_hold' && status 'Authorized' show a 'Release hold' button posting ?/releaseHold. Disable controls + show 'Dojo not connected' when payment is a stub id (starts with 'stub_') or env not configured.
5. Show the outcome inline (success/refunded amount, or the failure reason from fail()). After a successful action, the action re-runs load so the payment status pill reflects the new state (Refunded/Reversed).
6. Use the F3 shared admin tokens (src/lib/theme/admin.css --admin-* + brand accent) instead of the current hardcoded #2f6bd4/#9c2f28 hexes for the new controls, to match the design stream. Keep markup minimal; the existing pill styles can be reused/extended for a 'Refunded' pill.
7. Manual acceptance walk-through (no unit test needed for the Svelte form; the server fns are tested in WP-S1-6): create a deposit booking, mark it confirmed (simulate webhook), open detail, click Refund, confirm the pill flips to Refunded and an audit row exists.

**Files:** `src/routes/admin/bookings/[id]/+page.server.ts`, `src/routes/admin/bookings/[id]/+page.svelte`, `src/lib/server/booking/admin.ts`

**Acceptance criteria:**

- The detail page shows the booking's payment kind, amount (£) and status; the 'P4 placeholder' text is gone.
- For a Captured deposit, a manager sees a Refund form; submitting it refunds via Dojo and the pill updates to Refunded without a full page reload (enhance) and an audit row records actor='staff' + on_behalf_of.
- For an Authorized no-show hold, a Release-hold button voids the auth and the pill updates to Reversed.
- A host (not manager) cannot see/submit the Refund action (403 / control hidden per F1 matrix).
- When the payment is a stub / Dojo unconfigured, the controls are disabled with a clear 'Dojo not connected' message.
- Attempting to refund a non-captured payment surfaces the 'Nothing to refund' reason from the server fn.

**Parallelizable:** getPaymentForBooking + loader change are independent of the Svelte panel markup; the two form actions are independent of each other. The styling-to-admin-tokens pass can be done after the functional wiring. Depends on WP-S1-6's server fns existing (can stub them to build the UI in parallel) and F1's requireRole helper.

**Risks:**

- Avoid a double-submit refund — disable the button while the enhance submission is in flight and rely on WP-S1-6's idempotencyKey.
- RBAC must be enforced server-side in the action, not just by hiding the button (a host could POST the action directly) — use requireRole in the action body.
- Partial-refund input must validate <= captured amount server-side (handled in refundDepositManual) and the UI should show pence vs pounds clearly to avoid a £/p mistake.

---

### Stream S2 — Live-Service Floor Workflow & Realtime

Makes a busy service actually runnable: move a seated party, seat across joined tables, multi-floor live view, drag-and-drop seating, and push-based realtime replacing the 20s poll. Owns the live floor page and its server loader/actions, plus the getFloorPlan floor filter.

- **Depends on:** `F1`, `F3`
- **Owns files:** `src/routes/admin/floor/+page.svelte`, `src/routes/admin/floor/+page.server.ts`, `src/lib/server/booking/mutate.ts`, `src/lib/server/booking/admin.ts (getFloorPlan only)`, `src/lib/admin/realtime.svelte.ts`

This stream makes a busy Saturday actually runnable on the floor page (src/routes/admin/floor/+page.svelte + +page.server.ts), which today is read-heavy and missing the core seating manoeuvres. The booking-mutation engine (src/lib/server/booking/mutate.ts) already exposes seatBooking / moveBooking / clearBooking and writes geisha_floor_state rows; the gap is almost entirely in the UI/loader/actions plumbing plus three engine refinements: (1) the live UI only surfaces ?/move for FREE tables with a single hidden tableId, so a SEATED party can never be moved and a join can never be seated; (2) getFloorPlan(brand,date,nowISO) in admin.ts returns ALL tables with no floor filter, so multi-floor restaurants render every floor's tables overlapped at the same absolute x/y; (3) the page polls invalidateAll() every 20s instead of receiving push updates, and has no conflict handling for two hosts editing at once.



The seven work-packages build in dependency order on a shared realtime substrate (src/lib/admin/realtime.svelte.ts, a Svelte 5 rune store wrapping a browser PocketBase client). WP-LIVE-1/2 unlock the seated-move and join-seat manoeuvres (P0 ResDiary parity); WP-LIVE-3 fixes the multi-floor overlap (P0); WP-LIVE-4 hardens the seat-picker + adds walk-in phone capture (P0/P2); WP-LIVE-5 adds drag-and-drop seating from an upcoming list (P1); WP-LIVE-6 adds a covers/pacing timeline strip (P1); WP-LIVE-7 replaces the poll with PocketBase subscriptions and adds optimistic-version conflict handling (P1 reliability). Everything depends on F1 (event.locals.staff + requireRole gate so loaders/actions run as a real actor) and F3 (audit-actor threading through mutate.ts, the multi-instance booking lock that moveBooking/seat-walkin reuse, and src/lib/theme/admin.css tokens that replace the page's hardcoded #2f6bd4/#1a1f2b hex). Where the stream extends the AI agent it defines tools precisely (move_seated_booking, seat_walkin) for the AI stream to register in adminTools.ts; it does NOT register them itself. No new collections are required — geisha_floor_state already exists — but WP-LIVE-7 needs a PUBLIC_POCKETBASE_URL env + a read-only realtime API rule, and WP-LIVE-4 consumes the F2 customer.phone capture. The current single-page absolute-x/y room render is preserved; floor filtering and per-floor canvas sizing (geisha_floors.width_cm * px_per_cm) replace the overlap.

#### WP-LIVE-1 — Move a SEATED party between tables in the live view  `M`

**Goal:** A host can move an already-seated (or overdue) party onto a different free table or set of tables directly from the live floor, re-validating fit and freeing the old table — not just FREE tables as today.

**Depends on:** `F1`, `F3`

**Server functions:**

- moveBooking(id:string, newTableIds:string[], nowISO:string, actor:AuditActor='staff', onBehalfOf?:string):Promise<Booking> — src/lib/server/booking/mutate.ts (extend signature only; F3 owns the AuditActor/on_behalf_of plumbing in writeAudit)

**API / actions:**

- POST ?/move (form action) — body: bookingId:string, tableIds:string (comma-joined ids). Response: {ok:true} | fail(409,{error}) | fail(500,{error}). Now reachable for seated/overdue bookings, validates fit+free+joinable, audits move_booking with actor='staff', on_behalf_of=staff.id.

**Components:**

- src/routes/admin/floor/+page.svelte — adds move-mode interaction (moveMode + moveTargets $state, eligible-tile highlighting, sticky confirm bar) to the existing selected-table panel and room grid

**AI tools:**

- move_seated_booking (write, confirm-gated) — DEFINED HERE for the AI stream to register in adminTools.ts. params {bookingId:string, tableIds:string[]}; run: server-validate fit/free/joinable then moveBooking(bookingId,tableIds,nowISO,'ai',staffId). Differs from the existing move_booking only by enforcing the seated-move validation; if the AI stream prefers, fold this validation into the existing move_booking tool instead of adding a second tool.

**Implementation steps:**

1. In src/routes/admin/floor/+page.server.ts, harden the existing `move` action: read `tableIds` (comma-joined string -> string[].filter(Boolean)), validate non-empty, and call `moveBooking(bookingId, tableIds, nowISO(), event.locals.staff.role==='ai'?'ai':'staff', event.locals.staff.id)` (actor + on_behalf_of threaded per F3). Wrap in try/catch returning fail(409,{error}) on BookingError and fail(500) otherwise; gate the action with requireRole(event,'host') from F1.
2. Add a server-side move-target validation step before calling moveBooking: load getFloorPlan(brand,date,nowISO) + listJoins(brand); compute the chosen tables' combined seats_max and that every chosen table is currently free OR already belongs to this booking, and (for 2+ ids) that the pair/chain is a registered join. Reject with fail(409,{error:'Those tables don\'t fit the party / aren\'t free / aren\'t joinable.'}) so the UI never silently no-ops. (moveBooking itself does NOT re-validate fit, so the action must.)
3. Extend moveBooking in src/lib/server/booking/mutate.ts ONLY by threading the F3 actor+on_behalf_of params (signature already `moveBooking(id,newTableIds,nowISO,actor='staff')` -> add `onBehalfOf?:string`); it already deletes old floor_state rows and recreates them when status==='seated'. No behavioural change beyond audit actor.
4. In src/routes/admin/floor/+page.svelte, in the SELECTED-table panel, when the table is in state 'seated' or 'overdue' AND has a booking, render a new 'Move party' affordance beside 'Clear table': a button that toggles a move-mode where the host taps a destination table (or multiselects joined tables) on the room, then a 'Move here' confirm submits the `move` action with name=bookingId + name=tableIds (the selected destination id set joined by comma).
5. Add a `moveMode` $state and `moveTargets = $state(new Set<string>())`; while moveMode is true, clicking a room tile toggles its id in moveTargets (only free tiles, or tiles already on the booking) and highlights them; a sticky 'Move <guest> here (<n> seats)' bar submits via use:enhance, then resets moveMode + selected on success and triggers realtime/invalidate.
6. Visually distinguish move-mode: dim non-eligible tiles, ring eligible ones in the brand accent (var(--admin-primary) from F3), and show the originating seated tile with a 'moving from' badge.
7. Add a guard: if the destination set is identical to the current tables, disable the confirm. If the party no longer fits (seats_max sum < party_size), show inline 'Won\'t fit — pick another table or a joined pair'.

**Files:** `src/routes/admin/floor/+page.server.ts`, `src/routes/admin/floor/+page.svelte`, `src/lib/server/booking/mutate.ts`

**Acceptance criteria:**

- Selecting a SEATED table shows a 'Move party' button (it does NOT today); FREE tables still show seat/walk-in as before.
- Moving a seated party to a free table updates both tiles within one refresh: old tile -> free, new tile -> seated with the same guest name; geisha_floor_state old rows deleted and a new row created (seated_at set, cleared_at empty).
- Attempting to move onto an occupied table, or a non-joined pair, or a set too small for the party returns a 409 and the floor is unchanged.
- geisha_audit_log gains a move_booking row with actor='staff' and on_behalf_of = the logged-in staff id (verifiable once F1+F3 land).
- Moving an overdue party works identically to a seated one.

**Parallelizable:** Server-action hardening/validation (steps 1-3) and the client move-mode UI (steps 4-6) can be built concurrently against the agreed ?/move contract (bookingId + comma-joined tableIds). The AI tool definition is independent and handed to the AI stream.

**Risks:**

- moveBooking deletes old floor_state then recreates — if the create fails mid-way a party could be left with no floor_state row; mitigate by ordering (create-new before delete-old) or wrapping the action so a failure reports clearly. Confirm with F3's lock whether move needs the same advisory lock as create to avoid two hosts moving onto the same table.
- Move-mode tap target conflicts with normal select-to-manage; must clearly enter/exit move-mode (Escape key + explicit Cancel) so a mis-tap doesn't move a party.
- If the booking spans floors after WP-LIVE-3, move-mode must restrict targets to the current floor or warn.

---

#### WP-LIVE-2 — Seat one party across JOINED tables live  `M`

**Goal:** When the next booking holds two or more joined tables (a big party), the host can seat it across all of them in one action, and the seat-picker / walk-in path can target a joined set — not a single hidden tableId as today.

**Depends on:** `F1`, `F3`, `WP-LIVE-1`

**Server functions:**

- seatBooking(id:string, nowISO:string, actor:AuditActor='staff', onBehalfOf?:string):Promise<Booking> — src/lib/server/booking/mutate.ts (thread actor/on_behalf_of only)
- moveBooking(...) — reused from WP-LIVE-1

**API / actions:**

- POST ?/seatOn (NEW form action) — body: bookingId:string, tableIds:string (csv of the joined chain). Validates fit+free+join-chain, then moveBooking then seatBooking. Response {ok:true} | fail(409,{error}).
- POST ?/seat (existing) — unchanged contract; seats a booking on its already-allocated tables; now correctly used only when the booking already has tables[].

**Components:**

- src/routes/admin/floor/+page.svelte — seat-picker now computes + submits the full join chain; join-chain highlight overlay

**Implementation steps:**

1. Root cause: in +page.svelte the 'Or seat a waiting booking here' picker submits a single hidden `name=tableIds value={selectedTable.id}` (the one tile clicked), and the `seat` action in +page.server.ts calls seatBooking(bookingId,nowISO) which seats the booking's OWN tables — so the picker's chosen table is ignored and a multi-table booking is fine, but a booking with NO tables, or seating onto a different/joined set, can't be expressed. Fix the picker to (a) seat the booking on its OWN allocated tables when it already has them (call ?/seat), or (b) when seating onto a chosen set, submit ALL ids of the joined chain via ?/move (which sets booking.tables then, because status will be seated, writes floor_state for each).
2. In +page.svelte, when a host opens a FREE tile and picks a waiting booking whose party needs joined tables, auto-expand the selection to the full join chain: from data.joins (added to the loader), compute the connected component of the clicked tile among free tiles and show 'Seat across T6+T7 (8 seats)'. Submit those ids (comma-joined) to ?/move, then immediately ?/seat the booking — OR add a single ?/seatOn action that does both server-side.
3. Add a new `seatOn` action to +page.server.ts: body {bookingId, tableIds(csv)}; server validates the booking's party fits the combined seats_max, all tiles free, and (for 2+) a registered join chain via listJoins; then calls moveBooking(bookingId,tableIds,nowISO,actor,onBehalfOf) followed by seatBooking(bookingId,nowISO,actor,onBehalfOf). Returns {ok:true} | fail(409). Gate with requireRole(event,'host').
4. Extend seatBooking signature in mutate.ts to thread actor+onBehalfOf (F3) — it already iterates `after.tables` creating/refreshing floor_state per table, so seating across N tables already works once booking.tables holds N ids.
5. Add `joins` to the floor loader (load getJoins via listJoins(brand)) and pass to the page so the client can compute join chains for both seat-picker and WP-LIVE-1 move-mode.
6. Update the existing inline `?/move` seat-row in the picker to use the join-chain ids rather than the single selectedTable.id; remove the misleading single-id hidden input.
7. Show joined sets as a single grouped highlight in the room (draw a subtle bracket/outline around a join chain when its member is hovered in seat/move mode).

**Files:** `src/routes/admin/floor/+page.server.ts`, `src/routes/admin/floor/+page.svelte`, `src/lib/server/booking/mutate.ts`

**Acceptance criteria:**

- A waiting party of 7 that was allocated T6+T7 (a registered join) is seated across BOTH tiles in one action; both tiles turn 'seated' with the same guest and both get geisha_floor_state rows.
- Seating a party onto a chosen joined free pair via the picker validates the pair is joined and fits; an un-joined pair is rejected with 409.
- The misleading single hidden tableId is gone; the picker submits either ?/seat (own tables) or ?/seatOn (chosen chain).
- Clearing one of a joined seated set clears the booking (clearBooking sets cleared_at on all its floor_state rows) so both tiles free together.

**Parallelizable:** Join-chain computation (client helper, shared with WP-LIVE-1 move-mode), the seatOn server action, and the room join-highlight overlay are three independent sub-tasks. Depends on WP-LIVE-1's validation helper being shared.

**Risks:**

- Join-chain transitive closure: if T6-T7 and T7-T8 are joined, is T6+T8 a valid 3-table party? Decide whether joins are pairwise-only or chainable; the availability engine's allocateTables already has join logic — mirror its definition to avoid divergence.
- Race: two hosts seating different parties onto overlapping members of a chain — relies on F3's lock or an optimistic re-check inside seatOn.

---

#### WP-LIVE-3 — Multi-floor filter + floor switcher in live view  `M`

**Goal:** On a multi-floor restaurant, the live view shows one floor at a time at its true scale, instead of every floor's tables overlapping at the same absolute x/y. Adds a floor switcher and a floorId? filter to getFloorPlan.

**Depends on:** `F1`

**Server functions:**

- getFloorPlan(brand:BrandId, date:string, nowISO:string, floorId?:string):Promise<{tables:FloorTable[]; restaurant:Restaurant; floor?:Floor; floors:Floor[]}> — src/lib/server/booking/admin.ts (extend signature + filter; preserve old 3-arg callers, e.g. adminTools.get_floor_plan, via optional 4th arg)

**API / actions:**

- GET /admin/floor?brand=&date=&floor=<floorId> — loader now scopes tiles + shapes + canvas size to one floor; floor optional (defaults to first floor).

**Components:**

- src/routes/admin/floor/+page.svelte — FloorSwitcher segmented control + per-floor canvas sizing + read-only shape backdrop

**AI tools:**

- get_floor_plan (read) — NOT added by this stream, but this WP enables the planned floorId? param on the existing adminTools get_floor_plan; the AI stream should pass floorId through to the extended getFloorPlan signature. Documented here so the signature change is coordinated.

**Implementation steps:**

1. In src/lib/server/booking/admin.ts, change getFloorPlan(brand,date,nowISO) -> getFloorPlan(brand,date,nowISO,floorId?:string). When floorId is provided, filter `tables` to those with table.floor===floorId; when omitted, default to the first floor (listFloors sorted by sort_order)[0]?.id, falling back to ALL tables only if the restaurant has zero floors (back-compat with pre-1772700200 data). Return {tables, restaurant, floor?:Floor, floors:Floor[]} so the page can render the switcher + the active floor's width_cm/height_cm/px_per_cm for canvas sizing.
2. Load floors inside getFloorPlan via getFloors(restaurant.id) (already imported) — single extra read; bookings/floor_state queries are unchanged (they key off booking ids, not floor).
3. In +page.server.ts load(): read `floor` from url.searchParams (?floor=<id>) and pass to getFloorPlan; expose data.floors + data.activeFloor to the page. Keep ?brand and ?date as today.
4. In +page.svelte, render a floor switcher (segmented control) from data.floors above the room when floors.length>1; clicking a floor navigates to ?brand&date&floor=<id> (preserving date), or — once WP-LIVE-7 lands — swaps the realtime filter client-side without a full reload.
5. Size the .room element to the active floor's width_cm*px_per_cm x height_cm*px_per_cm (mirroring the floor-editor canvas) instead of the fixed 70vh, so tiles drawn at editor coordinates land correctly; keep an overflow:auto + min-size fallback for small screens.
6. Render the active floor's geisha_floor_shapes (walls/zones/pillars/bar/door/label) behind the tiles as read-only context (reuse the visual logic from floor-editor/ShapeItem.svelte, extracted to a shared read-only renderer or duplicated minimally) so hosts recognise the room. Load shapes for the active floor via listShapes(activeFloor.id) in the loader.
7. Default floor selection persists per-session (e.g. last-viewed floor in localStorage keyed by brand) so a host returns to the floor they work.

**Files:** `src/lib/server/booking/admin.ts`, `src/routes/admin/floor/+page.server.ts`, `src/routes/admin/floor/+page.svelte`

**Acceptance criteria:**

- A restaurant with 2 floors shows a floor switcher; only the selected floor's tiles render, none overlap.
- Tiles render at their editor x/y on a canvas sized to floor.width_cm*px_per_cm (visually matching the floor-editor layout).
- Walls/zones for the active floor render behind tiles, read-only.
- getFloorPlan called with no floorId returns the first floor's tiles (or all tiles if the restaurant has no floors) — existing AI get_floor_plan call still works.
- Switching floors preserves the selected ?date.

**Parallelizable:** The getFloorPlan signature+filter change (server) and the floor-switcher + canvas-sizing UI (client) are independent given the agreed return shape. The read-only shape backdrop is a separable sub-task (can ship after the switcher).

**Risks:**

- Tables with floor==='' (legacy/unassigned) would vanish under a strict filter — must surface them under a synthetic 'Unassigned' floor or the first floor so no table disappears.
- Changing the get_floor_plan signature must keep the AI tool's 3-arg call compiling; use an optional param, not a required one.
- Canvas sizing depends on geisha_floors px_per_cm being set; fall back to a sensible default if a floor row is missing scale.

---

#### WP-LIVE-4 — Fix seat-picker to list only un-seated/waiting bookings + walk-in phone capture  `S`

**Goal:** The 'seat a waiting booking' picker shows only bookings that still need seating (confirmed/pending_payment, not yet seated/completed/cancelled) sorted by start time, and the walk-in form captures an optional phone number so the guest becomes a real CRM record.

**Depends on:** `F1`, `F3`

**Server functions:**

- (loader change only) seatable derivation in src/routes/admin/floor/+page.server.ts — exclude uncleared-floor_state bookings, sort by starts_at
- createBooking(input) with customer.phone — existing src/lib/server/booking/create.ts, no change (upsertCustomer already persists phone)

**API / actions:**

- POST ?/walkin (existing) — body now also: phone?:string. Still: tableId, partySize, name?. Creates a confirmed staff booking for now + seats it; phone flows into upsertCustomer.
- GET /admin/floor loader — `seatable` now excludes already-seated bookings and is sorted/shaped for the picker.

**Components:**

- src/routes/admin/floor/+page.svelte — phone field in walk-in form; cleaned seat-picker list with disabled-reason states + success toast

**AI tools:**

- seat_walkin (write, confirm-gated) — DEFINED HERE for the AI stream to register in adminTools.ts. params {tableId:string, partySize:integer, name?:string, phone?:string}; run: createBooking({brand,date:today,time:nowHHmm,partySize,customer:{name:name??'Walk-in',email:'',phone},source:'walkin',staff:true,tableIds:[tableId]}) then seatBooking(result.booking.id,nowISO,'ai',staffId). Mirrors the ?/walkin action exactly.

**Implementation steps:**

1. Today the loader's `seatable` = bookings.filter(b.status==='confirmed'||b.status==='pending_payment'). Tighten it: also exclude any booking that ALREADY has an uncleared geisha_floor_state row (i.e. is effectively seated even if status lagged), and exclude past-window bookings older than the release threshold. Compute via getFloorPlan's floor_state read or a new lightweight query; sort by starts_at ascending; cap to the active service window.
2. Refactor the loader so `seatable` is derived from the SAME getFloorPlan call data where possible (it already loads bookings + floor_state) to avoid a third DB round-trip; expose seatable as [{id,name,partySize,startsAt,tableLabels,status}] pre-shaped for the picker.
3. In +page.svelte, show seatable in a clear list (guest, party, time, current tables) and disable rows whose allocated tables aren't all free (so the host sees why a party can't be seated yet); keep the per-tile picker (WP-LIVE-2) for seating onto a chosen set.
4. Walk-in phone capture: add an optional <input name=phone type=tel> to the existing walk-in form in the selected free-table panel. In +page.server.ts `walkin` action, pass phone through to createBooking({customer:{name,email:'',phone}}) — upsertCustomer (queries.ts) already stores phone. This makes the walk-in a real geisha_customers row reachable later (F2 adds customer.restaurant scoping + no_show_count which the CRM stream uses).
5. Thread actor/on_behalf_of into the walkin action's seatBooking call (createBooking already audits; seatBooking gets F3 actor params).
6. Validate phone lightly (strip spaces, allow +/digits) but never block the walk-in on a bad phone — it's optional and service is fast.
7. Show a tiny confirmation toast 'Seated <name> (party of N)' on success and refresh the floor (realtime/invalidate).

**Files:** `src/routes/admin/floor/+page.server.ts`, `src/routes/admin/floor/+page.svelte`

**Acceptance criteria:**

- The picker never lists a booking that is already seated (status='seated' or has an uncleared floor_state row) or cancelled/completed/no_show.
- Picker rows are ordered by start time and show guest, party, time and current tables.
- A walk-in entered with a phone number creates/updates a geisha_customers row carrying that phone (verify in PocketBase).
- A walk-in with no phone still seats successfully.
- A row whose allocated tables aren't free is visibly disabled with a reason.

**Parallelizable:** Loader seatable-tightening and the walk-in phone field are independent edits; the picker UI cleanup is a third independent sub-task. The AI seat_walkin tool spec is handed to the AI stream.

**Risks:**

- Excluding by uncleared floor_state requires the floor_state read the loader already does via getFloorPlan — make sure not to double-query; reuse the computed FloorTable.state instead.
- Phone-based dedupe is out of scope here (F2/CRM stream owns dedupe-by-phone); upsertCustomer currently keys on email, so a phone-only walk-in always creates a new row — acceptable for now, flag for CRM stream.

---

#### WP-LIVE-5 — Drag-and-drop seating from the upcoming/diary list onto a table tile  `M`

**Goal:** A host can drag a waiting booking from an 'Upcoming' rail straight onto a free table tile to seat it there, as an alternative to the tap-tap picker — the fast gesture for a busy pass.

**Depends on:** `F1`, `F3`, `WP-LIVE-2`

**Server functions:**

- (none new) — reuses seatOn -> moveBooking + seatBooking

**API / actions:**

- POST ?/seatOn (reused from WP-LIVE-2) — drag-drop submits {bookingId, tableIds:csv}. No new route.

**Components:**

- src/routes/admin/floor/+page.svelte — Upcoming rail of draggable booking cards + tile drop targets + drop preview/validation overlay
- src/lib/admin/realtime.svelte.ts — optimistic seat() helper used for the drop preview/commit (shared with WP-LIVE-7)

**Implementation steps:**

1. Add an 'Upcoming' rail to +page.svelte (sourced from the WP-LIVE-4 seatable list) rendered as draggable cards (guest, party, time). Use the HTML Drag and Drop API (draggable=true, dragstart sets dataTransfer with bookingId + partySize) for desktop, and Pointer Events for touch tablets (pointerdown on a card -> follow finger -> drop on a tile) since DnD API is unreliable on touch.
2. Make each room tile a drop target: dragover/drop handlers (and pointerup hit-testing for touch) that, on drop onto a FREE tile, compute the join chain needed for the party (reuse WP-LIVE-2 helper) and submit ?/seatOn with {bookingId, tableIds:chain}. Show a live drop preview: highlight the tile (and its join chain) green if the party fits + free, red if not.
3. On a successful drop, optimistically mark the tile seated client-side (WP-LIVE-7 store) then reconcile with the server response / realtime event; on failure, snap the card back to the rail and toast the 409 reason.
4. Reuse the SAME ?/seatOn action from WP-LIVE-2 — no new server endpoint. The drag gesture is purely a second client entry point to the validated seat-on-chain flow.
5. Accessibility/fallback: keep the tap-to-seat picker (WP-LIVE-2) fully working so DnD is additive; add keyboard support (focus a card, press Enter to enter 'place mode', Arrow/Tab to a tile, Enter to drop) so it's usable without a mouse.
6. Touch ergonomics: large drag handle, haptic-ish visual lift, auto-scroll the room when dragging near an edge, and a clear cancel zone (drop outside any tile = cancel).

**Files:** `src/routes/admin/floor/+page.svelte`, `src/lib/admin/realtime.svelte.ts`

**Acceptance criteria:**

- Dragging an upcoming booking onto a free tile that fits seats the party there (tile -> seated, floor_state row created) using ?/seatOn.
- Dragging onto a tile too small / occupied shows a red preview and, if dropped, is rejected with a toast; the floor is unchanged.
- Dragging onto a tile that's part of a join chain large enough seats across the whole chain.
- Works with mouse (DnD API) and on a touch tablet (Pointer Events).
- The tap-to-seat picker still works (DnD is additive); keyboard place-mode seats without a pointer.

**Parallelizable:** Desktop DnD handlers and touch Pointer-Events handlers can be developed in parallel behind one drop-commit function; the drop-preview/validation overlay is a separate sub-task; the keyboard fallback is independent.

**Risks:**

- HTML DnD API does not fire on most touchscreens — must implement the Pointer-Events path or tablet hosts (the primary device per the roadmap's tablet focus) can't drag.
- Optimistic UI can desync if the server 409s; the realtime store must be the single source of truth and reconcile on the server response.
- Drag over an absolutely-positioned, rotated tile makes hit-testing tricky — use elementFromPoint on pointerup rather than CSS :hover.

---

#### WP-LIVE-6 — Covers timeline / pacing visualisation strip on the floor page  `M`

**Goal:** A horizontal time strip across the top of the floor page shows covers booked per slot for the service, so the host sees the pacing of arrivals at a glance and spots crunch points.

**Depends on:** `F1`, `WP-LIVE-3`

**Schema:** Reads (does not create) geisha_pacing_rules.max_covers_per_slot if F2 has added it; degrades gracefully (no threshold line) when absent.

**Server functions:**

- (loader-local) buildPacing(bookings:BookingWithRefs[], period, slotIntervalMinutes, nowISO) — pure bucketing helper in +page.server.ts (or src/lib/server/booking/admin.ts if reused); reads geisha_pacing_rules threshold when F2 present

**API / actions:**

- GET /admin/floor loader — adds `pacing:{slots:[{time,covers,bookings,seated}]}` derived from getBookingsForDay (no new DB read).

**Components:**

- src/routes/admin/floor/+page.svelte — CoversTimeline strip (per-slot bars, now-marker, threshold line, seated/expected split, slot drill-down)

**Implementation steps:**

1. In +page.server.ts load(), compute a pacing summary from the day's bookings (already loaded via getBookingsForDay): bucket live bookings (status not in cancelled/no_show) by start slot using the restaurant's slot_interval_minutes (read via getSettings or expose from getFloorPlan) across the active service period window; for each bucket sum party_size (covers) and count bookings. Shape: {slots:[{time:'HH:mm', covers:number, bookings:number, seated:number}]}.
2. Add `pacing` to the loader return and the page; render a CSS-grid/flex bar strip (one column per slot) with bar height ~ covers, a 'now' marker line at the current time (Europe/London), and a subtle threshold line if a pacing cap exists (F2 adds geisha_pacing_rules.max_covers_per_slot — read it if present; otherwise no threshold).
3. Colour bars by load: under threshold neutral, at/over threshold in the overdue/warning colour (var(--admin-*) tokens from F3). Hovering/tapping a bar lists the bookings in that slot (guest, party, time) and lets the host jump to them (select the booking's table).
4. Distinguish already-seated vs still-expected covers within each bar (stacked: seated portion solid, expected portion hatched) so the host sees what's still to arrive.
5. Make the strip collapsible (it's secondary to the room) and remember collapsed state in localStorage; default expanded on wide screens, collapsed on narrow.
6. Keep it read-only and cheap — no extra DB calls beyond bookings already loaded; recompute on realtime updates (WP-LIVE-7) so it stays live.

**Files:** `src/routes/admin/floor/+page.server.ts`, `src/routes/admin/floor/+page.svelte`

**Acceptance criteria:**

- The strip shows one bar per slot across the service window with covers totals matching the day's live bookings.
- A 'now' marker sits at the current Europe/London time.
- Bars at/over a configured pacing cap (when F2's geisha_pacing_rules exists) are visually flagged; with no cap, no false warnings.
- Seated vs still-expected covers are visually distinguished within each bar.
- Tapping a bar reveals that slot's bookings; the strip collapses/remembers state.
- No additional DB round-trips beyond the bookings already loaded.

**Parallelizable:** The pure bucketing helper (server) and the bar-strip rendering (client) are independent; the slot drill-down and the seated/expected split are separable polish sub-tasks.

**Risks:**

- Slot bucketing must use the restaurant timezone (Europe/London) and the period's start/last_booking_time, not naive local time, to align bars with real slots.
- If geisha_pacing_rules schema lands later than this WP, guard the threshold read so the strip ships threshold-less and gains the line automatically once F2 is deployed.

---

#### WP-LIVE-7 — Realtime floor sync via PocketBase subscriptions (replace 20s poll) + simultaneous-edit conflict handling  `L`

**Goal:** The live floor updates within a second of any seat/clear/move/walk-in from any device, via PocketBase realtime subscriptions instead of the 20s invalidateAll poll, and two hosts editing at once never silently clobber each other.

**Depends on:** `F1`, `F3`, `WP-LIVE-1`, `WP-LIVE-2`, `WP-LIVE-3`

**Schema:** No new collection. Requires a PocketBase API/record rule allowing SCOPED read+subscribe on geisha_bookings + geisha_floor_state (and geisha_tables) for staff — added as a rule change on the pmm instance (gentle: read-only, restaurant-scoped), plus PUBLIC_POCKETBASE_URL env. If a dedicated read rule is infeasible, the SSE-bridge fallback needs no schema/rule change.

**Server functions:**

- getRealtimeToken(staff):Promise<{token,url,restaurantId}> — new server helper (src/lib/server/...) issuing the scoped client token, or the SSE bridge handler
- version-guarded mutate wrappers — in +page.server.ts actions: re-read booking.updated and compare before calling mutate.ts fns (or add an optional expectedVersion param to moveBooking/seatBooking/clearBooking — coordinate with F3 which already touches these signatures)

**API / actions:**

- POST /api/admin/realtime-token (NEW, requireRole-gated) — returns {token:string, url:string, restaurantId:string} a short-lived PB token scoped to read the live geisha_* collections for the staff's restaurant. (Or: GET /api/admin/floor-stream — SSE fallback re-emitting server-side PB subscription events.)
- All ?/seat ?/clear ?/move ?/seatOn ?/walkin actions — extended to accept an optional `version` (the booking's last-known updated) and return fail(409,{error:'conflict',current}) when stale.

**Components:**

- src/lib/admin/realtime.svelte.ts — rune-based realtime store: subscribe/unsubscribe, $state floor model, optimistic seat()/move()/clear(), reconnect/backoff, echo-guard, live/reconnecting status
- src/routes/admin/floor/+page.svelte — binds to the store instead of polling; live/reconnecting indicator; conflict toast

**Implementation steps:**

1. Create src/lib/admin/realtime.svelte.ts — a Svelte 5 rune store ($state) that: (a) lazily instantiates a BROWSER PocketBase client pointed at PUBLIC_POCKETBASE_URL (new env, the public read URL of the pmm instance); (b) authenticates the realtime channel — see auth note below; (c) exposes subscribe(brand, date, floorId, onChange) which subscribes to geisha_bookings, geisha_floor_state and (optionally) geisha_tables changes for the active restaurant/date and calls onChange on any create/update/delete; (d) holds the current FloorTable[] + seatable + pacing as $state so the page binds to it; (e) provides optimistic helpers seat()/move()/clear() used by drag-drop (WP-LIVE-5) that mutate local state immediately then reconcile.
2. Add PUBLIC_POCKETBASE_URL to .env.example and Vercel (Vercel-prefixed PUBLIC_ so it's exposed to the client). Add a PocketBase API rule / a scoped read token so the browser can SUBSCRIBE to geisha_bookings + geisha_floor_state for the staff's restaurant only — do NOT ship the superuser token to the client. Preferred: a server endpoint /api/admin/realtime-token that, gated by requireRole (F1), returns a short-lived PocketBase auth token bound to a record-rule that permits read on the geisha_* live collections; the store authStore.save()s it. Fallback if record rules can't be scoped in time: keep the realtime subscription server-side via a SvelteKit SSE endpoint that the server (superuser) subscribes to and re-emits filtered events to the browser (no PB token in the client at all).
3. In +page.svelte, replace `onMount(setInterval(invalidateAll,20000))` with realtime.subscribe(...) on mount and unsubscribe on destroy. On any change event, recompute the affected FloorTable state (or re-run a lightweight load via invalidate('admin:floor')) so tiles/pacing/seatable update. Keep a manual ↻ Refresh and a heartbeat fallback (e.g. invalidate every 60s) in case the socket drops.
4. Conflict handling — optimistic version re-check: when an action (seat/move/clear/seatOn/walkin) is submitted, include the booking's last-known `updated` timestamp; the server action compares it to the current row's `updated` before mutating and returns fail(409,{error:'conflict', current}) if it changed (someone else already acted). The UI shows 'This booking changed — refreshing' and re-pulls. This complements F3's create-time lock (which prevents double-CREATE); WP-LIVE-7 prevents double-MUTATE of the same booking.
5. Add a presence/echo guard: tag each mutation with the acting staff id (on_behalf_of, F3) so the originating client can ignore the realtime echo of its own optimistic change (avoid flicker).
6. Degrade gracefully: if PUBLIC_POCKETBASE_URL is unset or the socket can't connect, fall back to the existing poll (longer interval) so the floor still works; surface a small 'live'/'reconnecting' indicator in the header.
7. Document the realtime contract (collections subscribed, event shape, reconnect/backoff) in a comment block in realtime.svelte.ts so WP-LIVE-5's optimistic helpers and future pages reuse it.

**Files:** `src/lib/admin/realtime.svelte.ts`, `src/routes/admin/floor/+page.svelte`, `src/routes/admin/floor/+page.server.ts`, `.env.example`

**Acceptance criteria:**

- Seating/clearing/moving a party on device A reflects on device B within ~1s with no manual refresh and with the 20s poll removed.
- The browser never receives the PocketBase superuser token; the client uses either a scoped short-lived token or the SSE bridge.
- If two hosts try to move/seat the SAME booking, the second submit gets a 409 conflict and re-syncs instead of clobbering.
- If the socket drops, the UI shows 'reconnecting', falls back to polling, and recovers when reconnected.
- The acting device doesn't flicker from the echo of its own change (echo-guard works).
- With PUBLIC_POCKETBASE_URL unset, the page degrades to the legacy poll without errors.

**Parallelizable:** Three largely independent tracks once the store interface is agreed: (1) the realtime store + token/SSE plumbing; (2) the page rewrite to bind the store + status indicator; (3) the version-guard conflict handling on the actions. The token-scoping rule change on PocketBase can be prototyped in parallel with the SSE fallback as a safety net.

**Risks:**

- Vercel serverless can't hold a long-lived PB websocket per request — the realtime socket MUST live in the browser (scoped-token path) OR via an edge/streaming SSE response; a normal serverless function will not keep the subscription alive. This is the central architectural decision; prototype both early.
- Exposing any PB read to the browser risks leaking customer PII (geisha_bookings expands customer) — the scoped rule must NOT expose customer email/phone to the client; subscribe to floor_state/bookings minimal fields and resolve names server-side, or expand only safe fields.
- The shared pmm droplet is 1GB no-swap — many concurrent realtime subscriptions add load; cap subscriptions (one per open floor tab), use restaurant+date filters, and prefer the SSE bridge if PB realtime proves heavy.
- Optimistic-version 409s depend on PocketBase's `updated` advancing on every mutation (it does) — verify mutate.ts updates bump `updated` and that the re-read happens inside any F3 lock to avoid a TOCTOU gap.

---

### Stream S3 — Availability Engine Extensions

Extends the pure availability engine and its loader with the operational layer ResDiary lives on: covers pacing/throttle caps, closures/blackout calendar, lead-time + booking-window enforcement, and a waitlist with notify-when-free. Keeps availability.ts pure (data passed in) and adds new pure modules so it merges cleanly with S2's floor work.

- **Depends on:** `F2`
- **Owns files:** `src/lib/server/booking/pacing.ts`, `src/lib/server/booking/closures.ts`, `src/lib/server/booking/waitlist.ts`, `src/lib/server/booking/availability.ts`, `src/lib/server/booking/index.ts`, `src/routes/admin/closures/+page.svelte`, `src/routes/admin/pacing/+page.svelte`, `src/routes/api/cron/waitlist/+server.ts`

S3 adds the operational layer that turns the pure availability engine (src/lib/server/booking/availability.ts, checkAvailability) into something equivalent to ResDiary: covers pacing/throttle caps, a closures/blackout/private-hire calendar, lead-time + booking-window enforcement, and a waitlist with notify-when-free. The architectural rule is preserved: availability.ts stays PURE (all DB rows passed in as arguments). All new logic lands in NEW pure modules (pacing.ts, closures.ts, waitlist.ts) that produce plain data/predicates, with the only DB-touching glue living in index.ts::getAvailability (the single loader the /api/availability route calls) and in admin.ts-style server fns for the editors. This keeps S3 merge-clean against S2's floor work (S2 owns table/floor allocation; S3 only adds gates and per-slot cap math around it).



Schema dependency: ALL collections/fields S3 needs are added by F2's single batched migration 1772700600 — geisha_closures(restaurant,date_from,date_to,scope[full|period],service_period?,reason,kind[holiday|private_hire|maintenance]), geisha_pacing_rules(restaurant,service_period?,dow[],max_covers_per_slot,max_covers_per_period,lead_time_minutes,booking_window_days), geisha_waitlist(restaurant,customer,date,party_size,window_from,window_to,status,notified_at), geisha_messages(booking?,customer,channel,template,status,sent_at), plus booking.source 'ai' and booking.waitlist_origin. S3 writes NO migrations of its own. S3 depends on F2 (schema) for every WP, and additionally on F1 (requireRole gates the two new admin pages + actions) and F3 (audit-actor threading + hardened AI loop the new AI tools register on). S3 contributes one read tool (check_waitlist_demand) and one confirm-gated write tool (offer_waitlist_slot) for the AI stream to register in adminTools.ts.



Today's gaps S3 closes: booking_window_days is loaded by getSettings() but never enforced (dead config — see queries.ts:132); there is no minimum lead time / same-day cutoff; there are no covers caps so an unlimited number of parties can book the same 19:00 slot as long as distinct tables exist; there is no way to close a date or a single service for a private hire/holiday; and there is no waitlist at all. WP order within the stream: S3-1 (pacing, extends the engine) and S3-2 (closures) are the engine-shaped foundations and can run in parallel; S3-3 (lead-time/window) layers on the same getAvailability loader; S3-4 (pacing admin editor) consumes S3-1's collection; S3-5 (waitlist capture) and S3-6 (notify-when-free sweep) form the waitlist pair and depend on S3-2 (closures) only in that a closure suppresses offers.

#### WP-AVAIL-1 — Covers cap / pacing throttle per slot + service in checkAvailability  `L`

**Goal:** A slot becomes unavailable once the covers booked in it (or in the whole service period) reach configured caps, so the kitchen/front-of-house is never flooded even when physical tables remain free.

**Depends on:** `F2`

**Schema:** Reads geisha_pacing_rules (added by F2 migration 1772700600): restaurant rel, service_period? rel (null = applies to all periods), dow[] (0..6 subset; empty = all days), max_covers_per_slot (int, 0 = unlimited), max_covers_per_period (int, 0 = unlimited), lead_time_minutes (int), booking_window_days (int). S3-1 only READS this collection; no schema authored here.

**Server functions:**

- src/lib/server/booking/pacing.ts (NEW, PURE): export interface PacingRule { servicePeriodId?: string; dow: number[]; maxCoversPerSlot: number; maxCoversPerPeriod: number }. export interface PacingInput { rules: PacingRule[]; existing: BookingFootprint[] }. export function coversInWindow(startMs:number, endMs:number, existing: BookingFootprint[]): number — sums party_size of footprints overlapping [start,end). NOTE: requires BookingFootprint to carry partySize (see steps). export function selectPacingRule(periodId:string, dow:number, rules: PacingRule[]): PacingRule|null — most-specific match wins (period+dow > period > dow > global). export function slotWithinSlotCap(rule:PacingRule|null, slotStartMs:number, slotIntervalMin:number, addingCovers:number, existing:BookingFootprint[]): boolean. export function withinPeriodCap(rule:PacingRule|null, periodStartMs:number, periodEndMs:number, addingCovers:number, existing:BookingFootprint[]): boolean. All pure, no DB.
- src/lib/server/booking/availability.ts (EDIT): add optional field `pacing?: PacingRule[]` and ensure `existing: BookingFootprint[]` footprints carry `partySize:number`. In checkAvailability's per-slot loop, after allocateTables succeeds, also gate on slotWithinSlotCap + withinPeriodCap; a slot is `available` only if BOTH table allocation AND pacing pass. Add a `Slot.unavailableReason?: 'no_table' | 'slot_cap' | 'period_cap'` so callers/UX can explain why.
- src/lib/server/booking/availability.ts (EDIT): extend interface BookingFootprint to add `partySize: number` (covers math needs it). Keep tableIds/startsAt/endsAt.
- src/lib/server/booking/queries.ts (EDIT): add export async function getPacingRules(restaurantId:string): Promise<PacingRule[]> (try/catch → [] if collection absent, mirroring getFloors). Add partySize to the getOccupyingBookings map: `partySize: b.party_size`.
- src/lib/server/booking/index.ts (EDIT): in getAvailability, add getPacingRules(restaurant.id) to the Promise.all and pass `pacing` into checkAvailability.
- src/lib/server/booking/create.ts (EDIT): import getPacingRules + the pacing predicates; after the lock re-check and allocateTables but before the PB create, enforce the SAME slot/period caps server-side so a direct POST cannot bypass the cap the UI hid. Throw new BookingError(message,'no_availability') when a cap is hit. (Staff bookings with input.staff=true BYPASS pacing — staff can overbook deliberately; document in code comment.)

**API / actions:**

- GET /api/availability (existing route, behaviour change only): slots now reflect pacing caps automatically because index.ts::getAvailability passes pacing in. Response shape unchanged except each slot MAY include unavailableReason. No new route.

**Implementation steps:**

1. 1. Edit availability.ts: add `partySize:number` to BookingFootprint; add `pacing?: PacingRule[]` to AvailabilityInput; import PacingRule type from pacing.ts.
2. 2. Create pacing.ts with the pure predicates (coversInWindow, selectPacingRule, slotWithinSlotCap, withinPeriodCap). slotWithinSlotCap: window = [slotStart, slotStart+slotIntervalMin); covers = coversInWindow(...) of existing footprints whose start lands in that window; available iff maxCoversPerSlot===0 || covers+addingCovers <= maxCoversPerSlot. withinPeriodCap: covers all footprints whose start lands inside the period window.
3. 3. In checkAvailability, before the period loop, resolve the rule once per period via selectPacingRule(period.id, dow, pacing??[]). Inside the slot loop, compute available = (tableIds!==null) && slotWithinSlotCap(rule, slotMs, slotIntervalMinutes, partySize, existing) && withinPeriodCap(rule, periodStartMs, periodEndMs, partySize, existing). Set unavailableReason accordingly (table loss takes precedence in the message).
4. 4. Edit queries.ts: add getPacingRules + partySize in getOccupyingBookings mapping.
5. 5. Edit index.ts getAvailability to load + pass pacing.
6. 6. Edit create.ts to load pacing rules and re-assert caps inside withLock (skip when input.staff). Use the same predicates.
7. 7. Unit tests: pacing.spec.ts covering: slot cap blocks the Nth cover; period cap blocks across slots; 0 = unlimited; most-specific rule selection; DST date still correct (covers windows compared as epoch ms).
8. 8. Update the de-dupe step in checkAvailability so that when two overlapping periods produce the same time, the available one still wins AND its unavailableReason is cleared.

**Files:** `src/lib/server/booking/pacing.ts (new)`, `src/lib/server/booking/availability.ts (edit)`, `src/lib/server/booking/queries.ts (edit)`, `src/lib/server/booking/index.ts (edit)`, `src/lib/server/booking/create.ts (edit)`, `src/lib/server/booking/__tests__/pacing.spec.ts (new)`

**Acceptance criteria:**

- With max_covers_per_slot=10 and one existing 8-cover booking at 19:00, a new party of 4 sees 19:00 as unavailable (8+4>10) but 19:15 available (assuming slot interval 15m).
- With max_covers_per_period=40, once 40 covers are booked across the dinner period, every remaining dinner slot is unavailable even though tables are physically free; the reason is 'period_cap'.
- max_covers_per_slot=0 and max_covers_per_period=0 reproduce today's behaviour exactly (regression test passes on existing availability.spec).
- A direct POST /api/bookings into a slot-capped time returns 409 no_availability; a staff booking (input.staff=true) into the same time succeeds (bypass).
- selectPacingRule returns the period+dow rule over a period-only rule over a global rule.
- availability.ts still imports zero DB modules (grep shows no pb import) — engine remains pure.

**Parallelizable:** pacing.ts (pure module + unit tests) can be written entirely in parallel with the availability.ts integration and the queries/index/create glue, since the module has no imports from the rest of the stream. The BookingFootprint partySize change is a one-line schema-of-types edit that should land first as it is shared by WP-AVAIL-5/6.

**Risks:**

- Adding partySize to BookingFootprint touches getOccupyingBookings and the create.ts manual-table path — must update every constructor of a footprint or TS will flag it (this is intended, acts as a checklist).
- Covers math must use epoch-ms windows (not local HH:mm string compares) to stay DST-correct; reuse the existing toInstant() helper.
- Period cap interacts with the existing cross-period de-dupe: a time present in two periods must not be double-counted; resolve by attributing each footprint to the period whose window contains its start.

---

#### WP-AVAIL-2 — Closures / blackout / private-hire calendar (engine override + admin calendar UI)  `L`

**Goal:** Staff can close an entire date or a single service period on a date (holiday, private hire, maintenance); availability returns zero slots for the closed scope and the booking write path refuses bookings that fall in a closure.

**Depends on:** `F1`, `F2`, `F3`

**Schema:** Reads geisha_closures (added by F2 migration 1772700600): restaurant rel, date_from (date), date_to (date), scope ('full'|'period'), service_period? rel (required when scope='period'), reason (text), kind ('holiday'|'private_hire'|'maintenance'). Multi-day closures via date_from..date_to inclusive. S3-2 authors no schema; it WRITES rows via new admin server fns.

**Server functions:**

- src/lib/server/booking/closures.ts (NEW, PURE): export interface ClosureRule { dateFrom:string; dateTo:string; scope:'full'|'period'; servicePeriodId?:string; kind:string; reason:string }. export function isDateClosed(date:string, closures:ClosureRule[]): boolean — true if any FULL-scope closure spans the date. export function isPeriodClosed(date:string, periodId:string, closures:ClosureRule[]): boolean — true if a full closure spans the date OR a period closure for that periodId spans it. export function activeClosuresFor(date:string, closures:ClosureRule[]): ClosureRule[]. Pure string-date comparisons (YYYY-MM-DD lexicographic is date-correct).
- src/lib/server/booking/availability.ts (EDIT): add optional `closures?: ClosureRule[]` to AvailabilityInput. At top of checkAvailability, if isDateClosed(date, closures) → return { slots: [], requiresPhone: false, closed: true, closureReason }. Inside the period loop, skip any period where isPeriodClosed(date, period.id, closures). Add `closed?: boolean` + `closureReason?: string` to AvailabilityResult.
- src/lib/server/booking/queries.ts (EDIT): export async function getClosures(restaurantId:string, fromDate:string, toDate:string): Promise<ClosureRule[]> (filter date_to>=fromDate && date_from<=toDate; try/catch → []).
- src/lib/server/booking/index.ts (EDIT): getAvailability loads getClosures(restaurant.id, date, date) and passes closures in.
- src/lib/server/booking/create.ts (EDIT): after resolving `period`, load closures for the date and throw new BookingError('That date/service is closed for bookings.','no_period') if isPeriodClosed(date, period.id, closures). Applies to staff bookings too (a closure is physical, not a policy relaxation).
- src/lib/server/booking/admin.ts (EDIT): add listClosures(brand): Promise<Closure[]>; createClosure(brand, data, actor:AuditActor='staff', onBehalfOf?:string): Promise<Closure> (writeAudit 'create_closure'); updateClosure(id, data, actor, onBehalfOf?); deleteClosure(id, actor, onBehalfOf?) — all audited via the F3-extended writeAudit signature.

**API / actions:**

- Form actions on /admin/closures (+page.server.ts): action 'create' (FormData: dateFrom, dateTo, scope, servicePeriodId?, kind, reason) → createClosure → returns {ok:true}; action 'delete' (FormData: id) → deleteClosure; action 'update' (id + fields) → updateClosure. All gated by requireRole('manager') (F1) and use locals.staff as the actor on_behalf_of.
- GET /api/availability (behaviour change): a closed date returns slots:[] plus closed:true + closureReason so BookingPanel can show 'Closed for a private event' rather than a generic 'fully booked'.

**Components:**

- src/routes/admin/closures/+page.svelte (NEW): month calendar grid for the selected brand showing closure badges per day (full-day = solid block, period = striped, colour by kind). Svelte 5 runes: let { data } = $props(); $state for the visible month + a 'new closure' panel; uses use:enhance on the create/delete forms like settings/+page.svelte. Responsibilities: render month, list active closures with kind+reason, add/edit/remove a closure, pick scope (full vs a specific service period from data.periods), date range picker (from/to). Brand carried via ?brand= query param.
- src/routes/admin/closures/+page.server.ts (NEW): load = requireRole + listClosures(brand) + listPeriods(brand) + brand; actions create/update/delete as above.
- src/lib/components/BookingPanel.svelte (EDIT): when the availability response has closed:true, show closureReason in the 'no availability' branch instead of the generic 'fully booked' copy.

**Implementation steps:**

1. 1. Create closures.ts pure predicates + types.
2. 2. Edit availability.ts to short-circuit on full closure and skip closed periods; extend AvailabilityResult.
3. 3. Edit queries.ts getClosures + index.ts wiring.
4. 4. Edit create.ts to refuse bookings in a closure (all sources).
5. 5. Add admin.ts CRUD fns (audited via F3 writeAudit).
6. 6. Build /admin/closures route (server load + actions + Svelte calendar), gated by requireRole('manager').
7. 7. Edit BookingPanel.svelte closure messaging.
8. 8. Unit tests closures.spec.ts: full closure blocks date; period closure blocks only that period; multi-day range inclusive; non-closed dates unaffected.
9. 9. Add a Closure interface to src/lib/server/db/types.ts (hand-maintained, mirroring F2 migration) and a 'geisha_closures' entry in the Collection union.

**Files:** `src/lib/server/booking/closures.ts (new)`, `src/lib/server/booking/availability.ts (edit)`, `src/lib/server/booking/queries.ts (edit)`, `src/lib/server/booking/index.ts (edit)`, `src/lib/server/booking/create.ts (edit)`, `src/lib/server/booking/admin.ts (edit)`, `src/lib/server/db/types.ts (edit)`, `src/routes/admin/closures/+page.svelte (new)`, `src/routes/admin/closures/+page.server.ts (new)`, `src/lib/components/BookingPanel.svelte (edit)`, `src/lib/server/booking/__tests__/closures.spec.ts (new)`

**Acceptance criteria:**

- Creating a full-day closure for 2026-12-25 makes GET /api/availability return slots:[] + closed:true for that date on the chosen brand, and POST /api/bookings for that date returns 400 no_period.
- A period closure (scope='period', the Lunch period) on a date leaves Dinner slots available but removes all Lunch slots.
- A multi-day private_hire closure 2026-07-01..2026-07-03 blocks all three dates inclusive.
- The /admin/closures calendar shows the closure on the right days with the correct kind colour; deleting it restores availability immediately.
- Only a manager+ (F1 requireRole) can open /admin/closures or run its actions; a 'server' role gets 403.
- Every closure create/update/delete writes a geisha_audit_log row with actor + on_behalf_of (F3).

**Parallelizable:** closures.ts (pure) + its unit tests are independent of the admin UI. The /admin/closures Svelte calendar can be built against a mocked load payload while the server fns are written. The BookingPanel copy tweak is independent and tiny.

**Risks:**

- Date-range comparison must be inclusive and string-lexicographic on YYYY-MM-DD; guard against date_to < date_from at the action layer.
- scope='period' rows with a null service_period must be rejected at create time (validation), else isPeriodClosed could behave like a full closure.
- Calendar timezone: closures are wall-clock calendar dates (Europe/London), not instants — never convert them through Date()/UTC. Compare as strings.

---

#### WP-AVAIL-3 — Enforce booking_window_days + minimum lead time / same-day cutoff  `M`

**Goal:** Guests can only book within the allowed forward window and not closer to service than the configured lead time; today booking_window_days is loaded but never enforced (dead config) and there is no lead-time cutoff at all.

**Depends on:** `F2`

**Schema:** Reads existing geisha_settings keys booking_window_days (already in getSettings, queries.ts:132) and a NEW setting lead_time_minutes (online minimum lead; default 0). Also reads geisha_pacing_rules.lead_time_minutes / .booking_window_days (per service/dow override; from F2) which, when present, take precedence over the global setting for that period. No new collection.

**Server functions:**

- src/lib/server/booking/availability.ts (EDIT): add `nowMs?: number` (request instant), `bookingWindowDays?: number`, `leadTimeMinutes?: number` (global fallbacks) to AvailabilityInput. Add a pure helper `function withinBookingHorizon(slotStartMs:number, nowMs:number, leadMin:number, windowDays:number): boolean` — true iff slotStartMs >= nowMs + leadMin*60000 AND slotStartMs <= nowMs + windowDays*86400000. In the slot loop, a slot is available only if it ALSO passes withinBookingHorizon (use the per-period pacing rule's lead_time_minutes/booking_window_days if set, else the globals). Add Slot.unavailableReason values 'too_soon' | 'beyond_window'.
- src/lib/server/booking/index.ts (EDIT): getAvailability passes nowMs:Date.now(), bookingWindowDays:settings.booking_window_days, leadTimeMinutes from a new getSettings field (add lead_time_minutes:num('lead_time_minutes',0) in queries.ts getSettings).
- src/lib/server/booking/queries.ts (EDIT): getSettings return type gains lead_time_minutes:number.
- src/lib/server/booking/create.ts (EDIT): re-assert the horizon server-side before create: throw new BookingError('That time is too soon to book online.','invalid') if within lead time, and BookingError('That date is beyond our booking window.','invalid') if past the window. Staff bookings (input.staff) BYPASS both (staff can book same-day / far ahead by phone).

**API / actions:**

- GET /api/availability (behaviour change only): same-day slots earlier than now+lead disappear; dates beyond now+windowDays return slots:[]. No new route. BookingPanel's date input min/max can be tightened: it already sets min={today}; add max = today + windowDays via the availability response echoing back the effective window (add bookingWindow:{leadMinutes,windowDays} to the result so the client can constrain the picker).

**Components:**

- src/lib/components/BookingPanel.svelte (EDIT): set the date <input max> from the returned bookingWindow.windowDays and show 'Bookings open up to N days ahead' hint; when all of today's remaining slots are filtered by lead time, show 'No more availability today — try tomorrow.'

**Implementation steps:**

1. 1. Add lead_time_minutes to getSettings (queries.ts) + the AvailabilityInput fields.
2. 2. Add withinBookingHorizon pure helper to availability.ts and gate slots on it (combined with table + pacing checks).
3. 3. Wire nowMs/window/lead in index.ts getAvailability; echo bookingWindow into AvailabilityResult.
4. 4. Re-assert in create.ts (skip for staff).
5. 5. Tighten BookingPanel date max + messaging.
6. 6. Unit tests horizon.spec.ts: slot exactly at now+lead is allowed; one minute earlier blocked; date at window boundary allowed; window+1 day blocked; per-period override beats global.
7. 7. Add SETTING_META entry for lead_time_minutes in adminTools.ts so the AI/settings UI can edit it ({label:'Minimum lead time online (minutes)', type:'number'}).

**Files:** `src/lib/server/booking/availability.ts (edit)`, `src/lib/server/booking/queries.ts (edit)`, `src/lib/server/booking/index.ts (edit)`, `src/lib/server/booking/create.ts (edit)`, `src/lib/server/ai/adminTools.ts (edit — SETTING_META only)`, `src/lib/components/BookingPanel.svelte (edit)`, `src/lib/server/booking/__tests__/horizon.spec.ts (new)`

**Acceptance criteria:**

- With lead_time_minutes=120 and now=18:00, today's 19:00 slot is shown but 19:45 is the first allowed only if >=120m away — verify a slot < now+120m is unavailable with reason 'too_soon'.
- With booking_window_days=60, a date 61 days out returns slots:[] (reason beyond_window) and POST is rejected 400; 60 days out works.
- A per-period pacing rule lead_time_minutes overrides the global for that service only.
- Staff new-booking can still book same-day inside the lead window and far beyond the window (bypass).
- BookingPanel date picker max equals today+booking_window_days and the lead-time hint renders.
- Existing availability.spec regression: with lead=0 and a large window, output is unchanged from before this WP.

**Parallelizable:** The pure withinBookingHorizon helper + tests are independent of the BookingPanel client tweak and the create.ts re-assert. lead_time_minutes settings plumbing (queries + SETTING_META) is a small independent sub-task.

**Risks:**

- now must be the request instant passed in (not Date.now() inside the pure engine) to keep availability.ts pure and deterministic in tests — pass nowMs from index.ts.
- Lead-time + same-day interaction with the auto-release sweep: a slot freed by release should reappear; confirm getAvailability recomputes live (it does, no cache).
- Client date max must use Europe/London calendar date, not the browser's local date, to avoid off-by-one near midnight.

---

#### WP-AVAIL-4 — Pacing-rules admin editor (per service / dow caps) reading geisha_pacing_rules  `M`

**Goal:** Managers can create/edit/delete pacing rules (covers-per-slot, covers-per-period, lead time, booking window) scoped to all services or one service period and to specific days of week — the config that powers WP-AVAIL-1 and WP-AVAIL-3.

**Depends on:** `F1`, `F2`, `F3`, `WP-AVAIL-1`

**Schema:** CRUD over geisha_pacing_rules (F2). Fields edited: service_period? (dropdown incl. 'All services'), dow[] (Mon..Sun checkboxes; empty = all days), max_covers_per_slot, max_covers_per_period, lead_time_minutes, booking_window_days. No schema authored here.

**Server functions:**

- src/lib/server/booking/admin.ts (EDIT): listPacingRules(brand): Promise<PacingRuleRow[]>; createPacingRule(brand, data, actor:AuditActor='staff', onBehalfOf?): Promise<PacingRuleRow> (writeAudit 'create_pacing_rule'); updatePacingRule(id, data, actor, onBehalfOf?) (writeAudit 'update_pacing_rule'); deletePacingRule(id, actor, onBehalfOf?) (writeAudit 'delete_pacing_rule'). Reuse getRestaurant(brand) + the q() filter helper already in admin.ts.
- src/lib/server/db/types.ts (EDIT): add PacingRuleRow interface + 'geisha_pacing_rules' in the Collection union (hand-maintained, mirroring F2).

**API / actions:**

- Form actions on /admin/pacing (+page.server.ts): 'create' (FormData: servicePeriodId?, dow (csv of 0..6), maxCoversPerSlot, maxCoversPerPeriod, leadTimeMinutes, bookingWindowDays) → createPacingRule; 'update' (id + fields) → updatePacingRule; 'delete' (id) → deletePacingRule. All gated requireRole('manager') (F1); actor on_behalf_of = locals.staff.

**Components:**

- src/routes/admin/pacing/+page.svelte (NEW): table of rules (service | days | per-slot | per-period | lead | window | edit/delete) plus an inline 'add rule' form, styled on the same pattern as settings/+page.svelte (use:enhance, $props/$state runs). Days-of-week chip toggles. A live preview line: 'Dinner Fri/Sat: max 12 covers / 15-min slot, 60 covers / service'. Shows a warning chip when no rule exists (then caps are unlimited — current behaviour).
- src/routes/admin/pacing/+page.server.ts (NEW): load = requireRole + listPacingRules(brand) + listPeriods(brand) + brand; actions create/update/delete.

**Implementation steps:**

1. 1. Add PacingRuleRow type + Collection entry to types.ts.
2. 2. Add admin.ts CRUD fns (audited via F3 writeAudit signature).
3. 3. Build /admin/pacing server load + actions (requireRole manager).
4. 4. Build /admin/pacing Svelte editor (table + add/edit form + dow chips + preview).
5. 5. Add a 'Pacing' link to admin/+layout.svelte sidebar nav (next to Settings).
6. 6. Validation: maxCoversPerSlot/Period/lead/window are non-negative ints; dow values in 0..6; servicePeriodId belongs to the brand.
7. 7. Manual e2e: create a Dinner Fri/Sat rule with per-slot 12 → confirm WP-AVAIL-1 honours it in /api/availability.

**Files:** `src/lib/server/booking/admin.ts (edit)`, `src/lib/server/db/types.ts (edit)`, `src/routes/admin/pacing/+page.svelte (new)`, `src/routes/admin/pacing/+page.server.ts (new)`, `src/routes/admin/+layout.svelte (edit — sidebar link)`

**Acceptance criteria:**

- Creating a rule (Dinner, Fri+Sat, per-slot 12) persists to geisha_pacing_rules and immediately changes /api/availability slot availability for those days.
- Editing per-period cap to 0 makes that period unlimited again.
- Deleting all rules returns the engine to uncapped behaviour.
- dow chips: a rule with no days ticked saves dow:[] and applies every day; ticking Fri+Sat saves [5,6].
- Only manager+ can reach /admin/pacing; create/update/delete each write an audited geisha_audit_log row with on_behalf_of.
- selectPacingRule precedence is observable: a Dinner+Fri rule wins over a Dinner-all-days rule on a Friday.

**Parallelizable:** The Svelte editor can be built against a stubbed load payload in parallel with the admin.ts CRUD fns. The sidebar-link edit is trivial and independent. Depends on WP-AVAIL-1 only for the runtime payoff (the engine must read the rules) — the editor itself can be coded before AVAIL-1 lands.

**Risks:**

- Two overlapping rules (e.g. a global rule and a Dinner rule) — selectPacingRule's most-specific-wins must be documented in the UI so managers understand precedence; show the effective rule per period in the preview.
- The admin sidebar in +layout.svelte uses hardcoded hex and has no breakpoint (per facts); add the link without reworking the shell (that is F3's admin tokens job).

---

#### WP-AVAIL-5 — Waitlist capture when a slot is full (geisha_waitlist write from BookingPanel + availability 'join waitlist' path)  `M`

**Goal:** When a guest's requested date/party has no available slot (fully booked or capped), they can join a waitlist for a time window; the request is recorded for the notify-when-free sweep (WP-AVAIL-6).

**Depends on:** `F2`, `WP-AVAIL-1`, `WP-AVAIL-2`

**Schema:** Writes geisha_waitlist (F2): restaurant rel, customer rel, date (YYYY-MM-DD), party_size (int), window_from ('HH:mm'), window_to ('HH:mm'), status ('waiting'|'notified'|'converted'|'expired'|'cancelled'), notified_at (datetime, empty until offered). Also sets booking.waitlist_origin (F2) on the converted booking later (WP-AVAIL-6). No schema authored here.

**Server functions:**

- src/lib/server/booking/waitlist.ts (NEW): export interface JoinWaitlistInput { brand:BrandId; date:string; partySize:number; windowFrom:string; windowTo:string; customer:{name:string;email:string;phone?:string;marketingConsent?:boolean} }. export async function joinWaitlist(input): Promise<{ id:string }> — getRestaurant(brand) + upsertCustomer (reuse queries.ts upsertCustomer) + create geisha_waitlist row status 'waiting'; writeAudit('customer','join_waitlist','geisha_waitlist',id,null,row). export async function listWaitlist(brand:BrandId, date?:string): Promise<WaitlistRow[]>. export async function cancelWaitlistEntry(id:string, actor:AuditActor='staff'): Promise<void>. The waitlist matching/offer logic lives in WP-AVAIL-6; this WP is capture + read only.
- src/lib/server/db/types.ts (EDIT): add WaitlistRow + WaitlistStatus + 'geisha_waitlist' Collection entry (mirroring F2).
- src/lib/server/booking/index.ts (EDIT): re-export joinWaitlist, listWaitlist from waitlist.ts on the barrel.

**API / actions:**

- POST /api/waitlist (NEW, public, brand-locked): body { brand, date, partySize, windowFrom, windowTo, customer:{name,email,phone?,marketingConsent?} } validated with zod (mirror /api/bookings Body schema). Calls joinWaitlist. Returns 201 { id }. Rate-limit-friendly: validate windowFrom<=windowTo and partySize 1..onlinePartyMax (reject larger with 'phone' message, mirroring BookingPanel's bigParty rule). Errors via @sveltejs/kit error() like /api/bookings.
- Admin: /admin/closures and /admin/pacing are unrelated; waitlist admin view is added as a read on the existing /admin/diary load OR a small section — but to keep file ownership tight, S3 only adds the public POST + a listWaitlist server fn that the diary page (S? owner) can consume. (Document the handoff: listWaitlist is exported for whichever stream owns /admin/diary.)

**Components:**

- src/lib/components/BookingPanel.svelte (EDIT): in the 'slots' phase, when availableSlots.length === 0 AND not requiresPhone AND not closed, render a 'Join the waitlist' affordance: a time-window picker (from/to defaulting to the requested service span) + reuses the existing name/email/phone/consent fields, posting to POST /api/waitlist. On success show a 'You're on the waitlist — we'll email you if a table frees up' confirmation (new phase value 'waitlisted'). Keep brand theming (var(--accent) etc.).

**Implementation steps:**

1. 1. Add WaitlistRow/WaitlistStatus types + Collection entry.
2. 2. Create waitlist.ts with joinWaitlist/listWaitlist/cancelWaitlistEntry (reuse upsertCustomer, getRestaurant, writeAudit).
3. 3. Add POST /api/waitlist route with zod validation (brand-locked, party cap check).
4. 4. Edit BookingPanel: add 'waitlisted' phase + window picker + the join form in the empty-slots branch; do NOT offer waitlist when closed:true (suggest another date instead).
5. 5. Barrel re-export from index.ts.
6. 6. Unit test waitlist.spec.ts (joinWaitlist creates a row with status waiting; window validation).
7. 7. Manual: fully book a date, confirm the BookingPanel shows the waitlist option and POST creates a geisha_waitlist row.

**Files:** `src/lib/server/booking/waitlist.ts (new)`, `src/lib/server/db/types.ts (edit)`, `src/lib/server/booking/index.ts (edit)`, `src/routes/api/waitlist/+server.ts (new)`, `src/lib/components/BookingPanel.svelte (edit)`, `src/lib/server/booking/__tests__/waitlist.spec.ts (new)`

**Acceptance criteria:**

- On a fully-booked, non-closed date, BookingPanel shows 'Join the waitlist' with a from/to window; submitting creates a geisha_waitlist row (status 'waiting') and shows the confirmation.
- POST /api/waitlist validates window_from<=window_to and rejects party_size>online_party_max with a phone message.
- joinWaitlist upserts the customer (no duplicate customer rows for a repeat email) using the existing upsertCustomer.
- A closure date hides the waitlist option (guest is told to pick another date).
- Each join writes an audit row actor='customer', action='join_waitlist'.
- listWaitlist(brand, date) returns the waiting entries for that date sorted by created.

**Parallelizable:** waitlist.ts server fns + the /api/waitlist route can be built in parallel with the BookingPanel UI (UI can post to a stubbed endpoint first). Types edit lands first (shared with WP-AVAIL-6).

**Risks:**

- Window picker must store wall-clock HH:mm (Europe/London), matching service-period times — do not convert to UTC.
- Spam: a public POST that upserts customers could be abused; add basic shape validation + a soft per-email/day cap (reject if an identical waiting entry already exists for that customer+date).
- Handoff seam: listWaitlist is consumed by the /admin/diary page owned by another stream — keep the export stable and documented.

---

#### WP-AVAIL-6 — Notify-when-free sweep: on cancellation/release, match waitlist and send offer  `L`

**Goal:** When a table frees up (cancellation, in-time cancel releasing a hold, or auto-release no-show), the system finds matching 'waiting' waitlist entries and emails them an offer, marking them 'notified' so they aren't spammed; a cron drives it and the cancel/release paths trigger it.

**Depends on:** `F2`, `F3`, `WP-AVAIL-2`, `WP-AVAIL-5`

**Schema:** Reads/writes geisha_waitlist (status waiting→notified, notified_at set). Writes geisha_messages (F2): customer rel, channel 'email', template 'waitlist_offer', status 'sent'|'failed', sent_at, booking? null. Reads geisha_closures (skip offers on closed dates) + the availability engine. No schema authored here.

**Server functions:**

- src/lib/server/booking/waitlist.ts (EDIT): export async function matchWaitlistForDate(brand:BrandId, date:string, nowISO:string): Promise<{ matched:number; notified:string[] }> — load waiting entries for the date (listWaitlist), for each call getAvailability(brand, date, entry.party_size) (the WP-1/2/3-aware loader), and if any available slot falls within [window_from, window_to], mark the entry status='notified' + notified_at=now, send the offer email, and record a geisha_messages row. Skips entries whose date is now closed (isPeriodClosed). Caps offers per sweep to avoid thundering-herd (e.g. notify only the earliest-created waiting entry per freed capacity bucket). export async function sweepWaitlistAfterRelease(brand:BrandId, now:Date): Promise<...> — convenience that matches today + the days that just had a release. export function offerExpiryMinutes(): number (config, default 30) — a 'notified' entry not converted within the window can be re-set to 'waiting' by the cron so the offer rolls to the next person.
- src/lib/server/email/confirmations.ts (EDIT): add export async function sendWaitlistOffer(entry:WaitlistRow, customer:Customer, restaurant:Restaurant, slot:{date:string;time:string}): Promise<{sent:boolean}> — brand-tinted HTML (reuse shell()) with a deep link to BookingPanel pre-filled (date+party) and the offer-expiry note. Uses the existing send() (Resend, isConfigured fallback console.logs).
- src/lib/server/booking/mutate.ts (EDIT): at the end of cancelBooking, markNoShow, and clearBooking, fire-and-forget matchWaitlistForDate(brand, dateOfBooking, nowISO) (best-effort try/catch, never blocks the mutation) so a freed table immediately triggers matching. Resolve brand from the booking's restaurant (one getOne). NOTE: keep it best-effort like the existing email sends.
- src/lib/server/booking/release.ts (EDIT): after runReleaseSweep marks no_shows, call matchWaitlistForDate for the affected date(s) so auto-released tables offer to the waitlist.

**API / actions:**

- POST /api/cron/waitlist (NEW): mirrors /api/cron/release exactly — guarded by Authorization: Bearer ${CRON_SECRET}; 503 if CRON_SECRET unset; 401 on mismatch. Body: optional { date? }. Runs matchWaitlistForDate for today + the next N days (default 2) for BOTH brands, AND expires stale 'notified' entries past offerExpiryMinutes back to 'waiting'. Returns json({ ok:true, asia:{matched,notified}, fusion:{...} }). Schedule every ~5 min alongside the release cron (PocketBase cron / external scheduler / Vercel cron).

**AI tools:**

- check_waitlist_demand (kind: read, NOT confirm-gated): added to adminTools.ts so the admin assistant can answer 'who's waiting for Saturday?'. parameters {date}. run: listWaitlist(brand, date) → [{id, name, partySize, window:'HH:mm–HH:mm', status, notifiedAt}]. Wraps the same server fn the cron uses; read-only, brand-locked.
- offer_waitlist_slot (kind: write, CONFIRM-GATED — halts the AI loop until staff confirm, per F3-hardened geminiAgent): added to adminTools.ts. description 'Offer a freed table to a waitlisted guest by emailing them; marks them notified. WRITE action — must be confirmed before it runs.' parameters {waitlistId, time?:'HH:mm'}. run: load the entry, send sendWaitlistOffer for the matched slot, set status='notified'+notified_at, write geisha_messages, writeAudit('ai',...,onBehalfOf). Returns {notified:[waitlistId], emailed:bool}. The AI STREAM registers both tools; S3 supplies the exact tool definitions + the underlying server fns.

**Implementation steps:**

1. 1. Add matchWaitlistForDate + offerExpiryMinutes + sweepWaitlistAfterRelease to waitlist.ts (uses getAvailability so it respects pacing/closures/horizon).
2. 2. Add sendWaitlistOffer to confirmations.ts.
3. 3. Hook matchWaitlistForDate into mutate.ts (cancel/noShow/clear) and release.ts as best-effort post-steps.
4. 4. Build POST /api/cron/waitlist (copy the release route's auth pattern) including the notified→waiting expiry roll-over.
5. 5. Define the two AI tools in adminTools.ts (check_waitlist_demand read + offer_waitlist_slot write) wired to the waitlist server fns; document for the AI stream to register.
6. 6. Unit tests waitlist-match.spec.ts: a freed slot inside a waiting entry's window notifies exactly one (earliest) entry; outside the window does not; a closed date is skipped; a 'notified' entry past expiry returns to 'waiting'; no double-notify of an already-notified entry.
7. 7. Manual e2e: book out a date, add a waitlist entry, cancel a booking → confirm an offer email (or console.log when Resend unconfigured) + status flips to notified + a geisha_messages row exists.

**Files:** `src/lib/server/booking/waitlist.ts (edit)`, `src/lib/server/email/confirmations.ts (edit)`, `src/lib/server/booking/mutate.ts (edit)`, `src/lib/server/booking/release.ts (edit)`, `src/routes/api/cron/waitlist/+server.ts (new)`, `src/lib/server/ai/adminTools.ts (edit — add 2 tools)`, `src/lib/server/booking/__tests__/waitlist-match.spec.ts (new)`

**Acceptance criteria:**

- Cancelling a booking on a fully-booked date with one matching waiting entry sends one offer email (or logs it when Resend unconfigured), sets that entry status='notified'+notified_at, and writes a geisha_messages row.
- An auto-release no-show (runReleaseSweep) on a date triggers the same matching for that date.
- POST /api/cron/waitlist with the correct Bearer token returns ok:true with per-brand matched/notified counts; wrong/missing token → 401/503 (parity with /api/cron/release).
- A 'notified' entry not converted within offerExpiryMinutes is rolled back to 'waiting' by the cron and can be offered to the next person.
- matchWaitlistForDate never offers a slot outside the entry's [window_from,window_to] and never offers on a closed date.
- Only one entry is notified per freed capacity bucket per sweep (no spamming the whole list).
- The admin assistant, with the registered tools, can answer 'who is waiting for 2026-07-04' (check_waitlist_demand) and propose offer_waitlist_slot as a confirm-gated write that halts the loop until staff approve (F3 behaviour).

**Parallelizable:** matchWaitlistForDate + its unit tests are independent of the cron route and the AI-tool definitions. sendWaitlistOffer (email template) is independent. The mutate.ts/release.ts hooks are small best-effort additions that can land last. The two AI tool definitions can be written in parallel and handed to the AI stream.

**Risks:**

- Multi-instance / race: two cancellations near-simultaneously could double-offer; gate the status flip with an optimistic update (only flip if status still 'waiting') — reuse F3's PB advisory-lock approach if needed.
- Best-effort hooks in mutate.ts must NEVER block or fail the cancellation if matching/email errors (wrap in try/catch + console.error, matching the existing email pattern).
- Offer fairness: notifying the earliest-created waiting entry is the simplest fair policy; document that VIP-priority ordering is a future enhancement (depends on customer.vip from F2).
- Email deliverability when Resend unconfigured: the offer must still flip status to notified and log, so the flow is testable pre-keys (mirror send()'s isConfigured no-op fallback).

---

### Stream S4 — Floor Editor Hardening

Fixes the 9 confirmed floor-editor bugs and finishes the half-baked features: immediate-persist on shape delete/edit (the data-loss trap), keyboard delete + undo/redo, all clamping fixes, shape drag-rotate, exposing zone/label kinds, multi-select, and polyline/L-shape walls. Entirely contained in the floor-editor route directory.

- **Depends on:** `F2`, `F3`
- **Owns files:** `src/routes/admin/floor-editor/+page.svelte`, `src/routes/admin/floor-editor/FloorCanvas.svelte`, `src/routes/admin/floor-editor/FloorToolbar.svelte`, `src/routes/admin/floor-editor/ShapeItem.svelte`, `src/routes/admin/floor-editor/TableTile.svelte`, `src/routes/admin/floor-editor/geometry.ts`

This stream fixes all 9 confirmed floor-editor bugs (ADMIN_ROADMAP §3.1) and finishes the half-baked features (§3.2), entirely within src/routes/admin/floor-editor/. The current editor holds every floor's tables + shapes client-side as plain $state arrays (+page.svelte:93-99), mutates them in place, and persists ONLY when "Save layout" is clicked — which is the root of the worst bug (BUG-1: shape delete/edit silently reverts on reload because reseedFromData() rebuilds from unchanged loader data). It has no keyboard handling, no undo, clamps tiles but not shapes, clamps using unrotated w/h, never re-clamps on room resize, can't multi-select shapes, can't draw zone/label kinds, and supports only axis-aligned rectangular obstacles.



DEPENDENCIES. The whole stream depends on F2 (batched migration 1772700600 adds FloorShape.points json — the polyline vertex list) and F3 (a) audit-actor threading so saveLayout/setShapes/setJoins gain writeAudit and createTable/updateTable/deleteTable/createFloor/updateFloor/deleteFloor accept actor:AuditActor='staff' + on_behalf_of; (d) src/lib/theme/admin.css --admin-* tokens which this stream's markup should consume instead of the hardcoded hex (#2f6bd4, #44506a, #9c2f28 etc.) sprinkled through these 6 files. We do NOT re-specify F2/F3 — we consume them.



ARCHITECTURE DECISION threaded through every WP: the editor's biggest design flaw is "edit-in-place, persist-on-explicit-Save". We keep instant in-memory editing (so floor-switching stays lossless) BUT add (1) immediate awaited persistence after structural ops — delete/create/move-commit/resize/rotate-commit — mirroring the existing deleteTable round-trip; (2) a dirty flag + beforeunload guard as the safety net; (3) a client-side undo/redo history of structuredClone snapshots; (4) a centralised re-clamp pass invoked after any geometry-affecting change. The pure-maths additions (rotatedBounds, clampRect, polyline helpers, shape marqueeHits) all go in geometry.ts with vitest coverage in geometry.test.ts, keeping the same offline-testable ethos as the booking engine.



This stream also extends the AI agent surface (adminTools.ts, owned by the AI stream) with three precisely-specified write tools — save_layout, set_shapes, manage_floor — so the assistant can persist floor geometry the editor leaves unsaved and create/rename/delete floors; all three are kind:'write' (HALT-and-confirm) and route through the F3-threaded actor='ai' audit path. We define them here; the AI stream registers them.

#### WP-FLOOR-1 — BUG-1: immediate-persist shape delete/edit/move/resize/rotate + dirty-flag beforeunload guard  `M`

**Goal:** Every structural shape operation reaches PocketBase immediately (mirroring the existing deleteTable round-trip) so nothing silently reverts on reload, with a beforeunload guard as the safety net for any still-unsaved in-memory edits.

**Depends on:** `F2`, `F3`

**Schema:** None new in this WP. Consumes F2's FloorShape.points json field (read-through only). No migration owned here.

**Server functions:**

- No new server functions. Reuses saveLayout(positions, actor?) / setShapes(floorId, desired, actor?) / setJoins(brand, desired, actor?) in src/lib/server/booking/admin.ts as extended by F3 (audit-actor threading). Confirm setShapes payload mapping (admin.ts:284-300) is extended by F2 to write `points: d.points ?? null`.

**API / actions:**

- Reuses existing form action POST ?/save in src/routes/admin/floor-editor/+page.server.ts. Request body unchanged shape: { brand, positions JSON, joins JSON, floorScales JSON, shapesByFloor JSON } where each shape now also carries optional `points`. Response: { ok: true, saved: number }.

**Components:**

- +page.svelte (orchestrator): owns the new `dirty` rune, async deleteSelectedShape, debounced label/edit commit, beforeunload + beforeNavigate guards.
- FloorCanvas.svelte: adds `onShapeCommit` callback prop, fired on shape drag/resize pointer-up.

**Implementation steps:**

1. Read +page.svelte: the current data-loss path is deleteSelectedShape() (lines 202-206) doing only `allShapes = allShapes.filter(...)` with no server call, vs deleteTable (line 567) which does `withSave(() => postForm('deleteTable', {id}))`. On reload, reseedFromData() (lines 161-169) rebuilds from unchanged loader data so the deleted wall reappears.
2. Introduce a single dirty-tracking rune in +page.svelte: `let dirty = $state(false);` Set it true inside the three child callbacks where in-memory geometry changes (onMutate, onGeometryChanged, onCreateShape) and inside onScaleChange/rotate90/rotateShape90. Set it false at the end of a successful save() and after reseedFromData().
3. Refactor deleteSelectedShape() to be async: optimistically remove from allShapes (so the UI updates instantly), set selectedShapeId/clear selection, then `await save()` (save already serialises the full shapesByFloor via buildSavePayload + setShapes which deletes orphans — admin.ts:281-302). save() already calls invalidateAll().then(reseedFromData) on success, so a successful delete is now durable. On save failure, re-seed from data to roll back the optimistic removal and surface savedMsg='Save failed.'.
4. Apply the same await save() commit to the shape edit-panel mutations that currently only mutate in place: the width/depth onchange handlers (lines 464-487), the label oninput (debounce 600ms then save), rotateShape90 (lines 208-213). For label, debounce so we do not POST on every keystroke: a `let labelTimer` + clearTimeout pattern that fires save() after the user pauses.
5. Commit shape MOVE/RESIZE on pointer-up not on every move: FloorCanvas already calls onGeometryChanged() on drag/rotate pointer-up (FloorCanvas.svelte:238-240) for tiles, but the shape-drag branch (mode==='drag' && dragShape, :175-178) only calls onMutate('shapes') and never signals a commit. Add an `onShapeCommit` callback prop to FloorCanvas fired from onPointerUp when a shape was dragged/resized, wired in +page.svelte to `() => { dirty = true; save(); }` (debounced/coalesced so a rapid drag-drop-drag doesn't fire 3 POSTs — use a 250ms trailing debounce shared with the geometry commit).
6. Add the beforeunload guard as the safety net: `$effect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); });` Also guard SvelteKit client nav with `beforeNavigate(({cancel}) => { if (dirty && !confirm('You have unsaved floor changes. Leave anyway?')) cancel(); })` imported from $app/navigation.
7. Confirm setShapes already persists the points[] field (added by F2) — extend buildSavePayload's shape serialisation (lines 262-273) to include `points: s.points ?? null` so polyline data round-trips (consumed by WP-FLOOR-6). For this WP just thread the field through; rendering is WP-FLOOR-6.
8. Thread the F3 audit actor: save()'s server action (+page.server.ts save) calls setShapes/saveLayout/setJoins which under F3 now accept actor='staff'. No change needed here beyond confirming the server action passes through; add a code comment noting AI callers use save_layout/set_shapes tools (WP-FLOOR-7) with actor='ai'.

**Files:** `src/routes/admin/floor-editor/+page.svelte`, `src/routes/admin/floor-editor/FloorCanvas.svelte`

**Acceptance criteria:**

- Draw a wall, click Delete (or panel Delete button), then hard-reload the page (or navigate away and back): the wall stays deleted — it does NOT reappear. (Direct repro of BUG-1.)
- Drag a wall to a new position, drop it, reload: the wall is at the new position.
- Edit a shape's width/depth in the panel, reload: the new size persists.
- With an unsaved in-memory change pending (mid-edit before debounce fires), attempting to close the tab triggers the browser's unsaved-changes prompt; SvelteKit client nav prompts via beforeNavigate.
- After a successful save the dirty flag clears (no spurious beforeunload prompt on a clean editor).
- On a forced save failure (e.g. network error), the optimistic delete rolls back (the shape reappears) and savedMsg shows 'Save failed.'.
- geisha_audit_log gains a set_shapes / save_layout entry on each commit (verifies F3 audit threading reaches the editor path).

**Parallelizable:** The beforeunload/beforeNavigate guard sub-task is independent of the async-delete sub-task and can be done concurrently. The debounce utility (a small trailing-debounce helper) can be written and unit-tested in isolation first. Must land before WP-FLOOR-2's keyboard-delete (which calls the same async delete path) and before WP-FLOOR-6 (which relies on points[] round-tripping).

**Risks:**

- Debounce coalescing must not drop the final state — use a trailing-edge debounce and always flush on beforeNavigate/explicit Save.
- save() re-seeds from server data which resets selection — preserve selectedShapeId/selectedIds across a commit-driven save by capturing and restoring them (or skip reseed for pure shape commits and only reseed on add/delete-floor). Decide: commit-saves should NOT reseed (avoid selection flicker); only structural add/delete operations reseed.
- Optimistic-then-await pattern can race if the user deletes shape A then B quickly — serialise commits through the shared debounce/in-flight guard so the second save includes the first deletion.

---

#### WP-FLOOR-2 — BUG-3 keyboard Delete/Backspace + BUG-4 undo/redo history stack (shipped together)  `M`

**Goal:** Make destructive editing safe: keyboard Delete/Backspace removes the current selection (tables and/or shapes) and a structuredClone-snapshot history gives Ctrl+Z / Ctrl+Shift+Z undo/redo across the whole session.

**Depends on:** `F2`, `F3`, `WP-FLOOR-1`

**Server functions:**

- No new server functions. Keyboard table-delete reuses deleteTable(id, actor?) via existing ?/deleteTable action; shape-delete reuses save() path from WP-FLOOR-1.

**API / actions:**

- Reuses existing POST ?/deleteTable ({ id }) and ?/save actions. No new routes.

**Components:**

- +page.svelte: owns undoStack/redoStack, snapshot()/pushHistory()/undo()/redo(), the window keydown $effect.
- FloorCanvas.svelte: adds onInteractionStart callback prop fired once on drag/rotate pointer-down.
- FloorToolbar.svelte: adds Undo/Redo buttons + onUndo/onRedo/canUndo/canRedo props.

**Implementation steps:**

1. KEYBOARD (BUG-3): Add a window keydown $effect in +page.svelte (the editor currently has ZERO keydown handlers — FloorCanvas only wires pointer events at :277-288). Guard against typing in form fields: `if (e.target instanceof HTMLElement && (e.target.matches('input,select,textarea') || e.target.isContentEditable)) return;`.
2. On Delete/Backspace: if selectedShapeIds has entries (post WP-FLOOR-8) or selectedShapeId is set, call the async deleteSelectedShape()/deleteSelectedShapes() path from WP-FLOOR-1 (which awaits save()). If selectedIds (tables) has entries, run a delete loop: `for (const id of selectedIds) await postForm('deleteTable', {id})` wrapped so it saves geometry first (reuse withSave semantics) then reseeds once at the end — NOT per-table reseed (avoid N invalidateAll round-trips). preventDefault so Backspace doesn't navigate back.
3. HISTORY (BUG-4): Define a Snapshot type `{ allTiles: Tile[]; allShapes: Shape[]; joins: string[]; floors: Floor[] }` and two capped stacks `let undoStack = $state<Snapshot[]>([])` / `let redoStack = $state<Snapshot[]>([])`, cap 50 (shift oldest on overflow).
4. Add `function snapshot(): Snapshot` returning structuredClone of the four pieces (joins serialised as [...joins]) and `function pushHistory()` that pushes the CURRENT state then clears redoStack. Call pushHistory() at the START of every mutating operation: before onCreateShape commits, before rotate90/rotateShape90, before delete, and — for drags — once at pointer-DOWN (capture pre-drag state) rather than per-move. Wire a `onInteractionStart` callback from FloorCanvas fired on the pointer-down of a drag/rotate so the orchestrator snapshots the pre-drag state exactly once.
5. Add `function undo()`: if undoStack non-empty, push current state to redoStack, pop snapshot, restore allTiles/allShapes/joins(as Set)/floors from it, recompute derived (tiles/shapes are $derived so they follow), set dirty=true. `function redo()`: symmetric. Both must re-validate activeFloorId still exists.
6. Bind keys in the same keydown $effect: Ctrl/Cmd+Z → undo(); Ctrl/Cmd+Shift+Z (and Ctrl+Y) → redo(). preventDefault. Skip when focus is in a form field.
7. Add toolbar buttons in FloorToolbar.svelte: a new 'Edit' segment with ↶ Undo / ↷ Redo buttons (disabled when the respective stack is empty), wired via new onUndo/onRedo/canUndo/canRedo props. Use --admin-* tokens (F3) for styling, not hardcoded hex.
8. Persistence interplay: undo/redo only mutate in-memory state and set dirty=true; they do NOT auto-save (so a user can undo freely then Save once). The beforeunload guard from WP-FLOOR-1 covers an un-saved undo. Document that undo restores client state but the DB reflects whatever was last committed — pressing Save after undo writes the undone state.

**Files:** `src/routes/admin/floor-editor/+page.svelte`, `src/routes/admin/floor-editor/FloorCanvas.svelte`, `src/routes/admin/floor-editor/FloorToolbar.svelte`

**Acceptance criteria:**

- With a table selected and focus on the canvas, pressing Delete or Backspace removes the table and persists it (reload confirms gone); pressing Backspace does not navigate the browser back.
- With a shape selected, Delete removes and persists it.
- Multi-selecting several tables (marquee) then Delete removes all of them in one reseed, not N flickers.
- Move a table, press Ctrl+Z: it returns to the prior position. Ctrl+Shift+Z (or Ctrl+Y) re-applies the move.
- Draw a wall, undo: the wall disappears. Redo: it returns. Delete a wall, undo: it returns.
- A new action after an undo clears the redo stack (standard editor semantics).
- Undo/Redo toolbar buttons disable correctly when their stack is empty; the history is capped at 50 (oldest dropped, no unbounded memory growth).
- Typing in the table label / width input does NOT trigger Delete-key deletion or Ctrl+Z undo (focus guard works).

**Parallelizable:** Keyboard-delete and the undo/redo history are two largely independent sub-tasks that share only the keydown $effect — they can be built in parallel by splitting the keydown handler into deleteKey + historyKey helpers. The FloorToolbar Undo/Redo button markup can be done concurrently with the orchestrator history logic against an agreed prop interface.

**Risks:**

- structuredClone of joins (a Set) is not directly clonable as a Set inside the Snapshot if mixed with reactive proxies — serialise joins to string[] in the snapshot and rehydrate to new Set() on restore.
- Capturing the snapshot per pointer-move would explode the stack — must snapshot once at interaction-start (onInteractionStart) and on discrete ops only.
- Restoring floors[] via undo could leave activeFloorId pointing at a deleted floor — re-validate and fall back to floors[0]?.id.
- Svelte 5 reactivity: replacing whole arrays (allTiles = restored.allTiles) is correct; mutating nested objects after structuredClone is fine since they're fresh.

---

#### WP-FLOOR-3 — BUG-5/6/7/9 clamping: shape drag clamp, rotated-AABB bounds, click-to-place clamp, room-resize re-clamp  `M`

**Goal:** Nothing can be positioned or sized outside the room frame: shape drags clamp like tile drags, clamping respects the rotated footprint (centre-based AABB), click-to-place obstacles clamp, and any room-size change re-clamps every tile and shape into the new bounds.

**Depends on:** `F2`, `F3`, `WP-FLOOR-1`

**Server functions:**

- No new server functions. (Note: admin.ts setShapes/saveLayout only Math.round, no bounds check — server stays trusting; clamping is enforced client-side, and a future server guard is out of scope for this WP.)

**Components:**

- geometry.ts: new pure helpers rotatedBounds + clampRect (unit-tested).
- FloorCanvas.svelte: drag/click-place branches route through clampRect.
- +page.svelte: onScaleChange re-clamps all items on room-size change.

**Implementation steps:**

1. GEOMETRY HELPERS (geometry.ts): Add `export function rotatedBounds(r: Pick<Rect,'w'|'h'|'rotation'>): { w: number; h: number }` returning the axis-aligned bounding-box size of a rotated rect: at 90/270 swap w/h; general case `{ w: Math.abs(r.w*cos)+Math.abs(r.h*sin), h: Math.abs(r.w*sin)+Math.abs(r.h*cos) }` with rad = (r.rotation??0)*PI/180. (rotatePoint already exists at :111-125 but is unused for clamping.)
2. Add `export function clampRect(x: number, y: number, w: number, h: number, rotation: number, roomW: number, roomH: number): { x: number; y: number }`: compute centre cx=x+w/2, cy=y+h/2; get the rotated AABB via rotatedBounds; clamp the CENTRE so the AABB stays inside [0,roomW]×[0,roomH] (cx in [bw/2, roomW-bw/2] when bw<=roomW, else centre the item); derive and return the clamped top-left {x: cx-w/2, y: cy-h/2}. This replaces the naive `clamp(v, max)` (FloorCanvas.svelte:246) which uses unrotated w/h.
3. BUG-5 + BUG-6 (drag clamp): In FloorCanvas.onPointerMove, replace the shape-drag branch (lines 175-178, currently unclamped `dragShape.x = round(dragShapeStart.x+dx)`) with clampRect(...) using dragShape.width/height/rotation and roomWidthPx/roomHeightPx. Replace the tile-drag clamps (single-select :191-192 and group :198-199) which currently call `clamp(snapped.x, roomWidthPx - t.w)` — these use unrotated t.w/t.h — with clampRect(snapped.x, snapped.y, t.w, t.h, t.rotation, roomWidthPx, roomHeightPx). A 180×60 table at 90° (60×180 footprint) now no longer overflows.
4. BUG-7 (click-to-place clamp): In FloorCanvas.onPointerUp draw branch (lines 221-237), after computing x/y/w/h for the click-placed (un-dragged) shape, run clampRect(x, y, w, h, 0, roomWidthPx, roomHeightPx) before onCreateShape — fixes the 300cm bar default landing off-canvas near an edge. Also clamp the dragged-rectangle case so a draft drawn partly outside is pulled in.
5. BUG-9 (room-resize re-clamp): In +page.svelte onScaleChange (lines 216-228), after applying the patch (width_cm/height_cm and/or px_per_cm), add a re-clamp pass: compute new roomWidthPx/roomHeightPx for the active floor, then for every tile AND shape on activeFloorId run clampRect to pull anything now-outside back inside. Currently it only rescales tile px when px_per_cm changes and never touches shapes or re-clamps on a width/height-only change. After re-clamping, call onGeometryChanged() to refresh joins and set dirty=true.
6. Keep the old `clamp(v,max)` helper for any non-rotated internal use, but route all positional clamping through clampRect. Remove dead usages.
7. geometry.test.ts: add unit tests — rotatedBounds swaps at 90°, computes diagonal AABB at 45°; clampRect pulls a rect past the right/bottom edge back in, clamps a 90°-rotated 180×60 by its 60×180 footprint, centres an item larger than the room; a room shrink moves an out-of-bounds tile inside.

**Files:** `src/routes/admin/floor-editor/geometry.ts`, `src/routes/admin/floor-editor/geometry.test.ts`, `src/routes/admin/floor-editor/FloorCanvas.svelte`, `src/routes/admin/floor-editor/+page.svelte`

**Acceptance criteria:**

- Dragging a wall toward any edge stops it at the frame; it cannot be dropped off-canvas or saved at negative coords (direct BUG-5 repro).
- A 180×60 table rotated to 90° (footprint 60×180) cannot be dragged so its rotated footprint overflows the room (BUG-6).
- Clicking near the right edge with the Bar tool (300cm default) places the bar fully inside the room, not clipped/off-canvas; reload confirms in-bounds (BUG-7).
- Reducing the room Width/Height in the toolbar pulls every previously-placed tile and shape that would now be outside back inside the new frame, and Save persists the corrected coords; joins recompute (BUG-9).
- vitest: rotatedBounds and clampRect tests pass (90° swap, 45° diagonal, oversize-centre, edge pull-in).
- No regression to tile snapping — trySnap still fires, then clampRect runs on the snapped result.

**Parallelizable:** The two pure geometry helpers (rotatedBounds, clampRect) plus their vitest tests are fully independent and should be written first; the four call-site edits (BUG-5, BUG-6, BUG-7 in FloorCanvas; BUG-9 in +page.svelte) are then independent of each other and can be done concurrently once the helper signatures are agreed.

**Risks:**

- Centre-based clamping changes the felt drag behaviour slightly vs the old top-left clamp — verify snapping still feels right (snap result passed through clampRect must not undo a valid flush snap; if the snapped position is already in-bounds clampRect is a no-op).
- Items larger than the room (oversized bar on a tiny floor) must be centred not NaN'd — guard the bw>roomW branch.
- onScaleChange re-clamp must run AFTER px sizes are recomputed (px_per_cm change rescales t.w/t.h first), else it clamps using stale sizes.

---

#### WP-FLOOR-4 — BUG-2 (short-term) shape drag-rotate handle for arbitrary angles + expose zone/label in DRAW_KINDS  `S`

**Goal:** Shapes can be rotated to any angle by dragging a rotate handle (not just the 90° stepper), and the fully-supported-but-unreachable zone and label shape kinds become drawable from the toolbar.

**Depends on:** `F2`, `F3`, `WP-FLOOR-1`

**Schema:** None for drag-rotate/zone/label (rotation, kind already exist; zone/label are existing ShapeKind values in types.ts:114).

**Server functions:**

- No new server functions. Reuses setShapes (rotation + kind fields already persisted).

**Components:**

- ShapeItem.svelte: adds selected-gated rotate handle + onrotatestart prop.
- FloorCanvas.svelte: adds rotateShape state + onShapeRotateStart + extends onPointerMove rotate branch + defaultSize cases for zone/label.
- FloorToolbar.svelte: adds zone + label to DRAW_KINDS dropdown.
- +page.svelte: keeps rotateShape90 stepper; commits drag-rotate via onShapeCommit.

**Implementation steps:**

1. DRAG-ROTATE (BUG-2 short-term): ShapeItem.svelte currently has no rotate affordance. Mirror TableTile.svelte (a rotate handle appears when selected at :68-79 forwarding onrotatestart). Add a `selected`-gated rotate handle button to ShapeItem with data-nodrag, forwarding an `onrotatestart` callback prop; suppress it for `label` and `door` kinds where rotation is meaningless (optional — allow for wall/bar/blocked/pillar/zone).
2. In FloorCanvas, generalise the existing tile rotate logic. onRotateStart currently only handles tiles (sets rotateTile, :131-136); the rotate branch in onPointerMove (:203-209) uses atan2 around the tile centre with Shift→15° snap. Add a parallel `rotateShape: Shape | null` + `onShapeRotateStart(e, s)` and extend the onPointerMove rotate branch to also handle rotateShape (centre = s.x+s.width/2, s.y+s.height/2; same atan2 + Shift-snap-to-15°). On pointer-up fire the WP-FLOOR-1 onShapeCommit (persist) + push history (WP-FLOOR-2 onInteractionStart captured the pre-rotate snapshot).
3. Wire ShapeItem's onrotatestart through FloorCanvas's per-shape render (the {#each shapes} block :289-295) to onShapeRotateStart.
4. Keep the 90° stepper (rotateShape90, +page.svelte:208-213) as a quick-step button in the edit panel; the drag handle is the arbitrary-angle path. Both set dirty + commit.
5. EXPOSE zone/label (half-baked feature §3.2): In FloorToolbar.svelte DRAW_KINDS (:48-54) — currently only wall/pillar/bar/blocked/door — add `{ kind: 'zone', label: 'Zone', icon: '▦' }` and `{ kind: 'label', label: 'Text label', icon: 'T' }`. ShapeItem already fully renders zone (soft dashed area :83-87) and label (transparent text :90-95), and the edit panel already shows the Label field for non-wall/door/pillar kinds (+page.svelte:452-463), so no other change is needed for them to work end-to-end.
6. Default sizes for new kinds: extend FloorCanvas.defaultSize() (the click-to-place sizer, :249-263) with `case 'zone': return { w: cm(300), h: cm(300) }` and `case 'label': return { w: cm(120), h: cm(40) }` so a click-placed zone/label is sensibly sized at the current scale.
7. For label kind, when created with empty text, immediately select it and focus the panel Label input so the user can type the caption (small UX nicety; reuse selectedShape edit panel).
8. Confirm rotation persists: ShapeItem render already applies transform: rotate({shape.rotation}deg) (:37) and admin.ts setShapes writes rotation (:292), so arbitrary angles round-trip once WP-FLOOR-1's commit fires.

**Files:** `src/routes/admin/floor-editor/ShapeItem.svelte`, `src/routes/admin/floor-editor/FloorCanvas.svelte`, `src/routes/admin/floor-editor/FloorToolbar.svelte`, `src/routes/admin/floor-editor/+page.svelte`

**Acceptance criteria:**

- Selecting a wall shows a rotate handle; dragging it rotates the wall to any angle (e.g. 37°); Shift constrains to 15° steps; reload confirms the angle persists (depends on WP-FLOOR-1 commit).
- The Draw dropdown now lists Zone and Text label; selecting Zone and dragging/clicking creates a soft dashed labelled area; selecting Text label creates an editable caption.
- A newly click-placed Zone is ~3m×3m at the current scale; a Text label is ~1.2m×0.4m.
- The zone/label edit panel shows the Label field and edits persist (already wired; verify end-to-end now that the kind is reachable).
- The 90° stepper still works alongside the new drag handle; both mark the editor dirty and persist.

**Parallelizable:** Exposing zone/label (a 2-line DRAW_KINDS edit + 2 defaultSize cases) is trivial and fully independent of the drag-rotate work — do it first as a quick win. The ShapeItem handle markup and the FloorCanvas rotate-branch extension can be built in parallel against the agreed onShapeRotateStart signature.

**Risks:**

- label kind has no background/border (transparent), so its hit-target for selecting/dragging/rotating is thin — ensure the .shape.label container still has pointer-events and a minimum hit area, otherwise the rotate handle is unreachable.
- Drag-rotate centre maths must use the shape's CURRENT width/height (not the rotated AABB) since transform-origin is center (ShapeItem.svelte:58) — matches the tile implementation.
- Arbitrary-angle shapes won't snap to each other (trySnap/adjacent are tile-only and axis-aligned) — acceptable for the short-term fix; polyline/L-walls are WP-FLOOR-6.

---

#### WP-FLOOR-5 — BUG-8: shape multi-select (Set) + marquee includes shapes + group drag/rotate/delete  `M`

**Goal:** Shapes become multi-selectable like tables: shift-click adds/removes, the marquee selects shapes alongside tables, and group operations (drag, rotate, delete) act on the whole mixed selection.

**Depends on:** `F2`, `F3`, `WP-FLOOR-1`, `WP-FLOOR-2`, `WP-FLOOR-3`

**Server functions:**

- No new server functions. Group delete reuses deleteTable + setShapes (via save).

**Components:**

- +page.svelte: selectedShapeIds Set, unified rotateSelected90, deleteSelectedShapes, multi-shape panel card.
- FloorCanvas.svelte: shift-add on shapes, unified group drag (tiles+shapes), marquee over both, asRectsShapes helper.
- ShapeItem.svelte: selected prop driven by Set membership.
- geometry.ts: reuse marqueeHits for shapes (already generic over Rect).

**Implementation steps:**

1. PROMOTE selection model: replace the single `selectedShapeId: string | null` (+page.svelte:106, FloorCanvas $bindable :48,64) with `selectedShapeIds = $state(new Set<string>())`. Keep a derived `selectedShape` for the single-selection edit panel = (selectedShapeIds.size===1 ? allShapes.find(matching) : null), mirroring how `selected` (tiles) is derived (:146-148).
2. SHIFT-ADD on shapes: rewrite onShapePointerDown (FloorCanvas.svelte:138-149) to mirror onTilePointerDown (:106-129): on shiftKey toggle membership in selectedShapeIds; otherwise if not already selected, set to new Set([s.id]); DON'T blanket-clear tile selection unless a non-shift fresh click (allow mixed selection to persist on group drag). Build groupStart over BOTH selected tiles and selected shapes for group drag.
3. GROUP DRAG: extend the mode==='drag' branch in onPointerMove. Currently single dragShape (:175-178) vs tile group (:179-201). Unify: when a drag starts, capture start positions for every selected tile AND every selected shape into groupStart (keyed by id, with a kind tag). On move, apply dx/dy to all, each routed through clampRect (WP-FLOOR-3) using its own w/h/rotation. Tile snapping (trySnap) only applies when exactly one tile and no shapes are selected (preserve current single-tile snap behaviour).
4. MARQUEE includes shapes: marqueeHits (geometry.ts:97-104) takes Rect[]; today onPointerUp feeds it tiles only (:218-219) and onStagePointerDown clears shape selection (:163). Change marquee resolution to compute hits over BOTH asRects(tiles) and a new asRectsShapes(shapes) (mapping shape.width/height→w/h), then set selectedIds = tile-hit set and selectedShapeIds = shape-hit set. Don't clear shape selection on marquee start; clear both then repopulate on pointer-up.
5. GROUP ROTATE: extend rotate90 (+page.svelte:193-200, tiles) and add the shapes into a unified `rotateSelected90()` that 90°-steps every selected tile AND shape. The drag-rotate handle (WP-FLOOR-4) remains single-item (rotating a group about a common centroid is out of scope — note it).
6. GROUP DELETE: extend the WP-FLOOR-2 keyboard-delete and panel delete to iterate BOTH sets — delete selected tiles (await deleteTable loop) and selected shapes (remove from allShapes) then a single save() + reseed. Add a multi-shape panel card ('N shapes selected' with a group Delete + group Rotate) mirroring the existing 'N tables selected' card (+page.svelte:571-576).
7. Update all consumers of selectedShapeId: +page.svelte selectedShape derivation, the edit-panel conditionals (:448-490), deleteSelectedShape→deleteSelectedShapes, rotateShape90, FloorCanvas $bindable prop, ShapeItem `selected={selectedShapeIds.has(s.id)}` (was ===). Thread the history snapshot (WP-FLOOR-2) and dirty flag through group ops.
8. geometry.test.ts: add a test that marqueeHits over a mixed Rect[] of tiles+shapes returns the overlapping ids of both.

**Files:** `src/routes/admin/floor-editor/+page.svelte`, `src/routes/admin/floor-editor/FloorCanvas.svelte`, `src/routes/admin/floor-editor/ShapeItem.svelte`, `src/routes/admin/floor-editor/geometry.ts`, `src/routes/admin/floor-editor/geometry.test.ts`

**Acceptance criteria:**

- Shift-clicking multiple shapes selects all of them; shift-clicking a selected shape deselects it.
- Dragging an empty-space marquee over a region containing both tables and walls selects all of them; dragging any one moves the whole group, each clamped to the room (BUG-8 + WP-FLOOR-3 interplay).
- With multiple shapes selected, the panel shows 'N shapes selected' with group Rotate 90° and Delete; Delete removes all and persists (reload confirms).
- Keyboard Delete removes a mixed tile+shape selection in one save/reseed.
- Group 90° rotate steps every selected item.
- Single-shape selection still shows the full edit panel (label/size/rotate/delete) — the single-selection derived value works.
- vitest: marqueeHits returns mixed tile+shape ids over a combined Rect[].

**Parallelizable:** The selection-model refactor (selectedShapeId→Set, all consumer updates) is the prerequisite spine and must land first. After that, group-drag, marquee-over-both, group-rotate, and group-delete are independent sub-tasks. Coordinate with WP-FLOOR-1/2/3 which also touch selection and the panel — sequence S5 AFTER those three (declared in dependsOn) to avoid churn on the same lines.

**Risks:**

- This WP touches the same selection state and edit-panel markup as WP-FLOOR-1/2/3/4 — high merge-collision risk WITHIN the stream. Mitigate by landing S5 last and treating selectedShapeId→Set as a single atomic refactor commit.
- Mixed-selection drag with tile-snapping active could produce surprising snaps — disable snapping for group/mixed drags (only single-tile, zero-shape drags snap).
- $bindable Set props in Svelte 5: reassign the whole Set (selectedShapeIds = new Set(next)) to trigger reactivity, never mutate in place.

---

#### WP-FLOOR-6 — Polyline / L-shape walls: FloorShape.points[] rendered as SVG polyline + L composed from two rects  `M`

**Goal:** Walls are no longer limited to single axis-aligned/rotated rectangles: a shape may carry a points[] vertex list rendered as an SVG polyline (arbitrary multi-segment walls), and the toolbar offers an 'L-wall' that composes two wall rectangles in one action.

**Depends on:** `F2`, `F3`, `WP-FLOOR-1`, `WP-FLOOR-3`, `WP-FLOOR-4`

**Schema:** Consumes F2 migration 1772700600's FloorShape.points json field (array of {x,y} px relative to shape origin). No migration owned by this WP. types.ts FloorShape.points?: {x:number;y:number}[] (added by F2; verify).

**Server functions:**

- Reuses setShapes(floorId, desired, actor?) — F2 extends its payload map (admin.ts:284-300) to persist `points`. No new function; verify the field is written and read by getShapes/listShapes.

**API / actions:**

- Reuses POST ?/save; each shape in shapesByFloor JSON now optionally carries `points: {x,y}[]`. No new route.

**Components:**

- geometry.ts: pointsBounds + lPolyline pure helpers (tested).
- ShapeItem.svelte: SVG <polyline> render path when points present.
- FloorCanvas.svelte: polyline-draw interaction mode (click-to-add-vertex, dblclick/Enter/Esc to finalise) + live draft polyline.
- FloorToolbar.svelte: 'Polyline wall' + 'L-wall' DRAW_KINDS entries.
- +page.svelte: seedShapes reads points; buildSavePayload writes points; panel hides cm size inputs for polyline shapes.

**Implementation steps:**

1. SCHEMA (consumes F2): F2 migration 1772700600 adds `FloorShape.points` json (array of {x,y} relative to the shape's x/y origin, in px). Confirm types.ts FloorShape gains `points?: { x: number; y: number }[]` (F2 owns the type edit; if not present, add it here as a local extension on the editor's Shape type and ensure setShapes persists it — admin.ts:284-300 maps `points: d.points ?? null`).
2. RENDER polyline (ShapeItem.svelte): when shape.points is a non-empty array, render an inline <svg> overlay (width=shape.width, height=shape.height, overflow visible) containing a <polyline points={pts} stroke=var(--c,#44506a) stroke-width based on a wall thickness (e.g. 6px) fill=none stroke-linejoin=round /> instead of the rectangular div background. Keep the bounding div for hit-testing/selection (transparent, pointer-events on). The polyline coords are relative to the shape origin so the existing left/top/transform positioning still moves/rotates the whole polyline.
3. DRAW polyline (FloorCanvas + FloorToolbar): add a 'Polyline wall' draw kind. In polyline-draw mode, clicks append vertices to an in-progress draft points list (instead of the box drag); double-click / Enter / Escape finalises. Render the in-progress draft as a live <polyline>. On finalise compute the bounding box of the points → that becomes the shape's x/y/width/height, points stored relative to that origin; call onCreateShape with kind:'wall' + points. Reuse clampRect (WP-FLOOR-3) to keep the bbox in-room. (This is a distinct interaction mode from the box-drag in onStagePointerDown :157-160 — branch on drawKind==='polyline'.)
4. L-WALL convenience (compose two rects): add an 'L-wall' entry to DRAW_KINDS. Rather than a new data type, on selecting L-wall and a single drag, create ONE polyline-backed wall whose points trace an L (5 vertices) sized to the drag bbox — i.e. L-wall is sugar over the points[] path. Alternatively (documented fallback) emit TWO wall rects via two onCreateShape calls in one history step; choose the polyline approach since points[] now exists (cleaner single object, single select/move).
5. GEOMETRY helpers (geometry.ts): add `export function pointsBounds(pts: {x:number;y:number}[]): Box` (min/max → x/y/w/h) and `export function lPolyline(w: number, h: number, t: number): {x:number;y:number}[]` returning the 5-vertex L outline for a w×h leg footprint with thickness t. Unit-test both.
6. PERSIST: buildSavePayload (+page.svelte:262-273, extended in WP-FLOOR-1) already threads points; setShapes writes it (F2). seedShapes (:77-90) must read s.points into the working Shape. Confirm round-trip: draw polyline → Save → reload → polyline reappears with same vertices.
7. EDIT: polyline shapes use the same move (group/single drag, clamped) and drag-rotate (WP-FLOOR-4) as rect shapes — rotation applies to the whole polyline via the container transform. Resizing a polyline's individual vertices is OUT OF SCOPE for v1 (document: edit = redraw); the panel shows kind + delete + rotate, hides the width/depth cm inputs when points present.
8. geometry.test.ts: pointsBounds returns correct bbox; lPolyline returns 5 vertices forming a closed-ish L; a points[] round-trip (relative coords) preserves shape under translate.

**Files:** `src/routes/admin/floor-editor/geometry.ts`, `src/routes/admin/floor-editor/geometry.test.ts`, `src/routes/admin/floor-editor/ShapeItem.svelte`, `src/routes/admin/floor-editor/FloorCanvas.svelte`, `src/routes/admin/floor-editor/FloorToolbar.svelte`, `src/routes/admin/floor-editor/+page.svelte`

**Acceptance criteria:**

- Selecting 'Polyline wall', clicking several points and finishing (dblclick/Enter) draws a multi-segment wall along those vertices; Save + reload reproduces it exactly.
- Selecting 'L-wall' and dragging creates a single L-shaped wall object that can be selected/moved/rotated/deleted as one unit; reload persists it.
- A polyline wall drags as a whole, clamped to the room (bbox stays in-frame), and drag-rotates about its centre.
- The edit panel for a polyline shape hides the rectangular width/depth cm inputs and shows kind + rotate + delete.
- vitest: pointsBounds and lPolyline pass; a relative-coords round-trip under translate is stable.
- Non-polyline (plain rect) walls are unaffected — the SVG path only activates when points[] is present.

**Parallelizable:** The geometry helpers (pointsBounds, lPolyline) + tests and the ShapeItem SVG render path are independent and can be built first against sample points[] data. The polyline-DRAW interaction mode in FloorCanvas is the heaviest, most isolated sub-task. L-wall (sugar over points[]) depends on lPolyline. Sequence after WP-FLOOR-4 (shares ShapeItem/FloorCanvas) to reduce collisions; this is the P2 polish item per the roadmap ordering.

**Risks:**

- Depends on F2 actually shipping FloorShape.points json — if F2 slips, fall back to the two-wall-rects composition for L-walls and defer true polyline (gate this WP on F2 being merged).
- SVG overflow + the container transform: ensure the polyline isn't clipped by the bbox and that rotation origin matches the rect path (center).
- Vertex coords stored relative to shape origin must stay relative when the shape moves; a bug here makes the wall 'jump' on save/reload — covered by the round-trip test.
- Polyline-draw mode changes pointer semantics (click=add-vertex vs box-drag) — guard so leaving the mode (switch tool / Escape) discards an unfinished draft and never persists a 1-point wall.

---

#### WP-FLOOR-7 — addFloor: activate by returned id + AI floor-editor write tools (save_layout, set_shapes, manage_floor)  `M`

**Goal:** Fix the stale-data addFloor activation bug, and expose three confirm-gated AI write tools so the admin assistant can persist floor geometry the editor leaves unsaved and manage floors — all routed through the F3 actor='ai' audit path.

**Depends on:** `F2`, `F3`, `WP-FLOOR-1`

**Schema:** None owned here. AI tools consume F2 schema (points on set_shapes) and F3 audit signatures.

**Server functions:**

- No NEW server functions — the three AI tools call existing admin.ts functions with the F3-added actor arg: saveLayout(positions, actor, onBehalfOf), setShapes(floorId, desired, actor, onBehalfOf), setJoins(brand, desired, actor), createFloor(brand, data, actor), updateFloor(id, data, actor), deleteFloor(id, actor). (Signatures extended by F3; called here with 'ai'.)

**API / actions:**

- No new HTTP routes. The three tools execute inside the existing /api/admin-chat tool loop (geminiAgent runAgent + confirmTool). The addFloor fix reuses the existing POST ?/addFloor action (response already returns { ok, created }).

**Components:**

- +page.svelte: addFloor activates by the action-returned id (deserialize the ?/addFloor response).
- adminTools.ts (AI-stream-owned): three new GeminiTool definitions registered — save_layout, set_shapes, manage_floor.

**AI tools:**

- save_layout — write, confirm-gated, role host+ — persists table positions/sizes/rotations + optional joins (calls saveLayout/setJoins with actor='ai').
- set_shapes — write, confirm-gated, role manager+ — replaces all shapes on a floor incl. deletes (calls setShapes with actor='ai'); confirm card surfaces delete count.
- manage_floor — write, confirm-gated, role manager+ for delete / host+ for create+update — create/rename/resize/delete a floor (calls createFloor/updateFloor/deleteFloor with actor='ai'; delete inherits the orphaned-tables guard).

**Implementation steps:**

1. FIX addFloor (half-baked §3.2): +page.svelte addFloor (lines 323-332) calls withSave then reads `data.floors[data.floors.length-1]` to pick the new floor — stale/fragile if two floors share sort_order. The ?/addFloor action already returns { ok:true, created: row.id } (+page.server.ts:119-124). Change addFloor to parse the action response and activate by the RETURNED id: `const res = await withSave(() => postForm('addFloor',{...})); const body = await res.json().catch(()=>null); const newId = deserialize(body)?.data?.created; if (newId) activeFloorId = newId;` (use SvelteKit's deserialize from $app/forms for action responses, or read the JSON the action returns). After withSave's reseed, confirm the floor with that id exists in floors before activating; fall back to floors[0].
2. AI TOOL save_layout (write, confirm-gated): add to src/lib/server/ai/adminTools.ts (owned by AI stream; defined here for registration). name:'save_layout', kind:'write', description:'Persist table positions, sizes, rotations and joins for a brand\'s floor plan (the geometry the floor editor leaves unsaved until Save).', parameters: { brand: {type:'string', enum:['asia','fusion']}, positions: {type:'array', items:{ id, x, y, width?, height?, width_cm?, height_cm?, rotation?, floor? }}, joins?: {type:'array', items:{ table_a, table_b }} }. run() calls saveLayout(positions, 'ai', onBehalfOf) then (if joins provided) setJoins(brand, joins, 'ai'). Returns a human summary '{n} tables repositioned'. Confirm card (proposedAction) shows the summary + raw JSON.
3. AI TOOL set_shapes (write, confirm-gated): name:'set_shapes', kind:'write', description:'Replace the full set of walls/zones/labels/obstacles on a floor (the only persistence path for shape deletes).', parameters: { floorId: {type:'string'}, shapes: {type:'array', items:{ id?, kind, x, y, width, height, rotation?, label?, color?, points? }} }. run() calls setShapes(floorId, shapes, 'ai', onBehalfOf). Returns '{n} features set on floor'. HIGH blast-radius (reconcile deletes orphans) → keep kind:'write' and surface the delete count in the confirm summary.
4. AI TOOL manage_floor (write, confirm-gated): name:'manage_floor', kind:'write', description:'Create, rename, resize, or delete a floor (delete refuses if tables remain on it).', parameters: { op: {enum:['create','update','delete']}, brand?: {string}, id?: {string}, name?: {string}, width_cm?: {number}, height_cm?: {number}, px_per_cm?: {number} }. run(): op==='create'→createFloor(brand,{name,...},'ai'); op==='update'→updateFloor(id,{name?,width_cm?,height_cm?,px_per_cm?},'ai'); op==='delete'→deleteFloor(id,'ai') (already throws if tables remain — surface that message). Returns the resulting floor or the guard error.
5. Extend the assistant's summarise() (roadmap §10.4 note) to produce human summaries for save_layout / set_shapes / manage_floor so the confirm card reads naturally (not just raw JSON). Provide the summary strings here; AI stream wires them into summarise().
6. All three tools rely on F3's audit-actor threading: saveLayout/setShapes/setJoins/createFloor/updateFloor/deleteFloor must accept actor + on_behalf_of (F3 (a)). This WP does NOT modify admin.ts signatures (F3 owns that) — it only calls them with 'ai'. Add a guard comment that these tools must be registered ONLY after F3 lands.
7. RBAC (F1): gate all three write tools behind requireRole — manage_floor delete and set_shapes (destructive) require manager+; save_layout host+. The role matrix lives in F1; this WP declares the required role per tool so F1/AI-stream can enforce it in confirmTool().

**Files:** `src/routes/admin/floor-editor/+page.svelte`, `src/lib/server/ai/adminTools.ts`

**Acceptance criteria:**

- Adding a floor via the toolbar activates the NEWLY created floor reliably even when sort_order collides (verify by mocking two floors with equal sort_order), because activation uses the returned id (BUG / §3.2 stale-data fix).
- In the admin assistant, asking to 'remove all walls on the ground floor' proposes a set_shapes write whose confirm card shows '0 features set on floor (N deleted)'; confirming persists the deletion and writes a geisha_audit_log row with actor='ai'.
- Asking to 'create a floor called Mezzanine' proposes manage_floor op=create; confirming creates it and audits actor='ai'.
- Asking to delete a floor that still has tables returns the guard error message ('Cannot delete floor: N tables...') instead of deleting.
- save_layout confirm card lists the table count and shows raw JSON; confirming repositions tables and audits actor='ai'.
- All three tools are kind:'write' (the loop HALTS for confirmation, never auto-runs); they are unregistered/inert until F3 lands (guarded).
- RBAC: a 'server' role is denied set_shapes/manage_floor delete (per declared matrix), enforced by F1's requireRole in confirmTool.

**Parallelizable:** The addFloor activation fix is a small, fully independent change (do immediately, depends only on WP-FLOOR-1's withSave). The three AI tool definitions are independent of each other and of the addFloor fix; they can be authored in parallel but must be REGISTERED in adminTools.ts only after F3 ships the actor-threaded admin.ts signatures (hard ordering gate). Coordinate the adminTools.ts edit with the AI stream (S?) to avoid collision since they own that file.

**Risks:**

- adminTools.ts is owned by the AI stream — registering tools here is a cross-stream edit; coordinate so both streams don't define overlapping tools. Treat the three definitions as a contract handed to the AI stream rather than a unilateral edit if ownership is strict.
- set_shapes is high blast-radius (full reconcile deletes orphans) — the AI could wipe a floor's features if it mis-models the desired array. Mandatory confirm + delete-count in the summary + manager+ RBAC mitigate; consider type-to-confirm (roadmap §10.4) for this one.
- Hard dependency on F3: calling saveLayout/setShapes/etc. with an actor arg before F3 extends their signatures is a type error — gate registration on F3.
- deserialize of the action response in addFloor: SvelteKit form actions returned via fetch need $app/forms deserialize; if the response shape differs, fall back to re-reading floors after reseed and matching the max-created floor by id presence.

---

### Stream S5 — CRM, Guest Profiles, GDPR & Reporting

Turns the AI-only customer data into a staff-facing CRM: per-brand customer scoping + dedupe, a guest profile page with history/no-show-risk/structured dietary+VIP+tags, marketing-consent provenance, GDPR export/erasure, and covers/no-show reporting. Owns the customers + reports routes and a new reporting query module.

- **Depends on:** `F1`, `F2`
- **Owns files:** `src/routes/admin/customers/+page.svelte`, `src/routes/admin/customers/+page.server.ts`, `src/routes/admin/customers/[id]/+page.svelte`, `src/routes/admin/customers/[id]/+page.server.ts`, `src/routes/admin/reports/+page.svelte`, `src/lib/server/booking/reporting.ts`, `src/lib/server/booking/crm.ts`, `src/lib/server/booking/queries.ts (upsertCustomer scoping)`

Turns today's AI-only, email-keyed `geisha_customers` table into a real staff-facing CRM and reporting surface. Six self-contained work-packages: (1) per-brand customer scoping with phone-OR-email dedupe on upsert; (2) a rich guest-profile page (aggregated history, no-show/cancel risk, structured dietary/allergy/VIP/tags replacing the free-text notes blob); (3) marketing-consent provenance + opt-in segmentation CSV export; (4) GDPR data export (per-subject JSON) and right-to-erasure (soft-delete + PII scrub) with full audit; (5) covers/occupancy reporting over a date range; (6) no-show-rate + channel-breakdown reporting with CSV/print export. All six own the `admin/customers/*` and `admin/reports` routes plus two new server modules `src/lib/server/booking/crm.ts` (CRM mutations) and `src/lib/server/booking/reporting.ts` (pure-ish aggregation queries), and refactor `upsertCustomer` in `queries.ts`. The stream registers four new AI tools into `adminTools.ts` (3 read: get_customer_profile, get_covers_report, get_noshow_report; 1 write confirm-gated: set_customer_vip) so the unified admin assistant from the AI stream can answer CRM/reporting questions and flag VIPs. DEPENDS ON F1 (requireRole + event.locals.staff for actor identity and page/tool gating) and F2 (all new customer fields + geisha_messages/geisha_ai_insights already added in batched migration 1772700600 — this stream adds NO new migration). Brand is carried via `?brand=` exactly as every other admin loader does (`url.searchParams.get('brand') as 'asia' | 'fusion'`). PocketBase is the reused 'pmm' instance, geisha_ prefixed; datetime filters MUST go through `toPbDateFilter()` (space not 'T') and the q() quoter from admin.ts/queries.ts. Reporting must NOT load all bookings into memory unbounded on the 1GB droplet — it pages and aggregates server-side.

#### WP-CRM-1 — Per-brand customer scoping + phone-or-email dedupe on upsert  `M`

**Goal:** Scope every customer to its brand's restaurant and make upsertCustomer dedupe by phone OR email within that brand, so the two brands never share or duplicate guest rows.

**Depends on:** `F1`, `F2`

**Schema:** No new migration — relies on F2's 1772700600 (geisha_customers gains restaurant, tags[], vip, dietary, allergies, no_show_count, cancel_count, marketing_consent_source, deleted_at). This WP only mirrors those fields into the Customer TS interface and rewrites query logic.

**Server functions:**

- queries.ts: upsertCustomer(input:{restaurantId:string;name:string;email:string;phone?:string;marketingConsent?:boolean;marketingConsentSource?:string}):Promise<Customer> — REPLACES current email-only version
- crm.ts: normalizePhone(raw:string):string — strip non-digits/+, GB 0-prefix -> +44
- crm.ts: backfillCustomerRestaurants():Promise<{updated:number;orphaned:string[]}>
- admin.ts: listCustomers(brand:BrandId,search?:string,opts?:{includeDeleted?:boolean}):Promise<Customer[]> — REPLACES current global version

**API / actions:**

- POST /admin/customers?/backfill (form action, requireRole('owner','manager')) — runs backfillCustomerRestaurants, returns {updated,orphaned}

**Implementation steps:**

1. F2 has already added `restaurant` (rel -> geisha_restaurants), `tags` (json string[]), `vip` (bool), `dietary` (json), `allergies` (text), `no_show_count`/`cancel_count` (number), `marketing_consent_source` (text), `marketing_consent_at` is folded into provenance via WP-CRM-3, and `deleted_at` (text/datetime) to geisha_customers. Reflect these in the `Customer` interface in src/lib/server/db/types.ts (add: restaurant: string; tags: string[]; vip: boolean; dietary: unknown; allergies: string; no_show_count: number; cancel_count: number; marketing_consent_source: string; deleted_at: string).
2. Rewrite `upsertCustomer` in src/lib/server/booking/queries.ts to take `restaurantId: string` (callers must pass it). New signature: `upsertCustomer(input:{ restaurantId:string; name:string; email:string; phone?:string; marketingConsent?:boolean; marketingConsentSource?:string }): Promise<Customer>`. Dedupe logic: build a filter `restaurant=${q(restaurantId)} && (email!='' && email=${q(email)})` first; if no match AND a phone is supplied, try `restaurant=${q(restaurantId)} && phone!='' && phone=${q(normalizePhone(phone))}`. Normalise phone (strip spaces, leading 0 -> +44 for GB) via a small `normalizePhone()` helper exported from crm.ts. On match -> update name/phone/email (fill blanks only, never overwrite a non-empty stored value with a blank), preserving marketing_consent unless explicitly changed. On no match -> create with restaurant, deleted_at:'' , no_show_count:0, cancel_count:0, tags:[], vip:false. Always exclude soft-deleted rows from the match (`deleted_at=''`).
3. Update the ONLY caller, createBooking in src/lib/server/booking/create.ts:164, to pass `restaurantId: restaurant.id` (the restaurant is already loaded at create.ts:93). The customer input already has name/email/phone/marketingConsent; thread through marketingConsentSource (default 'online_booking' for online, 'staff_entry' for staff bookings) — this also satisfies WP-CRM-3 provenance.
4. Refactor `listCustomers(search)` in admin.ts to `listCustomers(brand: BrandId, search = '', opts?:{ includeDeleted?:boolean })`: resolve restaurant via getRestaurant(brand), prepend `restaurant=${q(restaurant.id)}` to every filter, and append `&& deleted_at=''` unless includeDeleted. Keep the existing name/email/phone `~` search but wrap it in parens so it ANDs with the brand+deleted clauses.
5. Update the only caller chain: src/routes/admin/customers/+page.server.ts load() to pass `brand` into listCustomers (it already derives brand).
6. Add a one-off backfill helper `backfillCustomerRestaurants()` in crm.ts that, for any customer with empty `restaurant`, looks at their most recent booking's restaurant and stamps it; customers with no bookings are left for manual assignment (logged). This is a callable maintenance fn (wired to a tiny `?/backfill` form action on the customers page, owner-only) — NOT a migration, so it stays off the droplet's migration path.
7. Add unit tests in queries.test.ts (already exists) covering: email-match within brand, phone-fallback match, no cross-brand match, soft-deleted row ignored, blank-field non-overwrite.

**Files:** `src/lib/server/db/types.ts`, `src/lib/server/booking/queries.ts`, `src/lib/server/booking/create.ts`, `src/lib/server/booking/admin.ts`, `src/lib/server/booking/crm.ts`, `src/routes/admin/customers/+page.server.ts`, `src/lib/server/booking/queries.test.ts`

**Acceptance criteria:**

- Creating an online booking for asia and a separate online booking for fusion with the SAME email produces TWO customer rows (one per restaurant).
- A second booking with the same email (same brand) updates the existing row, not a new one; covers/history aggregate onto one profile.
- A booking that supplies a matching phone but a new email links to the existing brand-scoped customer (phone fallback).
- listCustomers('asia') never returns a fusion-only customer, and never returns a soft-deleted (deleted_at!='') customer unless includeDeleted is passed.
- upsertCustomer never blanks a stored non-empty name/phone when the new input omits them.
- queries.test.ts passes the 5 new cases; existing availability/policy tests still green.

**Parallelizable:** The TS-interface mirror, the upsertCustomer rewrite, and the listCustomers scoping can be done concurrently by one engineer; the backfill helper + its form action are independent and can land last. Tests can be written in parallel against the agreed upsertCustomer signature.

**Risks:**

- Existing production customer rows have empty `restaurant` until backfill runs — every brand-scoped read must tolerate that during the window (mitigate: run backfill immediately after deploy; orphaned rows surfaced to owner).
- Phone normalisation false-positives could merge two different guests sharing a household landline — keep email as the primary key and treat phone-only matches as a soft suggestion (still create-or-update, but the dedupe rule errs toward email; document for staff).
- Changing upsertCustomer's signature is a breaking change to create.ts — must land atomically in the same commit to avoid a broken build.

---

#### WP-CRM-2 — Guest profile page: aggregated history, no-show/cancel risk, structured dietary/allergy/VIP/tags  `L`

**Goal:** Give staff a dedicated /admin/customers/[id] profile showing the guest's full booking history, computed lifetime stats and risk counters, plus editable structured dietary, allergy, VIP and tags fields that replace the free-text notes blob as the AI's primary signal.

**Depends on:** `F1`, `F2`, `WP-CRM-1`

**Schema:** No new migration — uses F2's customer fields (vip, tags, dietary json, allergies, no_show_count, cancel_count). dietary json holds the DietaryFlags object.

**Server functions:**

- crm.ts: getCustomerProfile(brand:BrandId,customerId:string):Promise<CustomerProfile>
- crm.ts: updateCustomerProfile(brand:BrandId,id:string,patch:CustomerPatch,actor?:AuditActor,onBehalfOf?:string):Promise<Customer>
- crm.ts: recomputeCustomerCounters(customerId:string):Promise<void>
- crm.ts: type CustomerProfile, type DietaryFlags, type CustomerPatch (exported)

**API / actions:**

- POST /admin/customers/[id]?/save — body: name,email,phone,vip,tags(json),dietary(json),allergies,notes -> {ok,customer}
- POST /admin/customers/[id]?/toggleVip -> {ok,vip}
- POST /admin/customers/[id]?/addTag (tag) / ?/removeTag (tag) -> {ok,tags}

**Components:**

- src/routes/admin/customers/[id]/+page.svelte — full guest profile (header+VIP+tags, allergy banner, dietary grid, notes, stats strip, history table); responsibility: the single staff view of one guest
- src/routes/admin/customers/+page.svelte (edit) — becomes a linked directory: each card links to the profile, shows read-only VIP/risk/tags

**AI tools:**

- get_customer_profile (READ, auto-run): args {customerId:string} OR {email?:string;phone?:string;name?:string} (resolve to a brand-scoped customer; if multiple match, return the list for disambiguation). Returns the CustomerProfile minus raw notes html stripped to text — stats, risk.level, vip, tags, dietary, allergies, last/first visit, recent bookings. Lets the assistant answer 'tell me about this guest' and flag allergies/VIP before service.

**Implementation steps:**

1. Add `getCustomerProfile(brand:BrandId, customerId:string):Promise<CustomerProfile>` to crm.ts. It loads the customer (404 if deleted_at!=''), all their bookings via the existing `getCustomerHistory` pattern (filter customer=id, sort -starts_at), and computes a `CustomerProfile` aggregate: { customer:Customer; bookings:BookingWithRefs[]; stats:{ totalBookings:number; completed:number; cancelled:number; noShows:number; upcoming:number; totalCovers:number; firstVisit?:string; lastVisit?:string; favouriteOccasion?:string; avgPartySize:number }; risk:{ noShowRate:number; cancelRate:number; level:'low'|'watch'|'high' } }. risk.level: high if noShows>=2 OR noShowRate>0.25 (min 4 bookings); watch if noShows===1 OR cancelRate>0.3; else low.
2. Add `updateCustomerProfile(brand:BrandId, id:string, patch:{ name?:string; email?:string; phone?:string; vip?:boolean; tags?:string[]; dietary?:DietaryFlags; allergies?:string; notes?:string }, actor:AuditActor='staff', onBehalfOf?:string):Promise<Customer>` to crm.ts. It writes via PB and calls writeAudit(actor,'update_customer','geisha_customers',id,before,after) (uses F3's audit-actor threading + on_behalf_of). Define `DietaryFlags` as a typed object { vegetarian?:boolean; vegan?:boolean; pescatarian?:boolean; glutenFree?:boolean; dairyFree?:boolean; nutAllergy?:boolean; halal?:boolean; other?:string } stored in the `dietary` json field; `allergies` stays a free-text safety-critical line shown prominently.
3. Add `recomputeCustomerCounters(customerId:string):Promise<void>` to crm.ts that recounts no_show_count and cancel_count from bookings and writes them back (denormalised for fast list rendering + AI). Hook this into mutate.ts markNoShow and cancel (call it after the status write) so counters stay live — coordinate with the booking-core owner via F3 since mutate.ts is shared; this WP only adds the call lines, not the mutate logic.
4. Create src/routes/admin/customers/[id]/+page.server.ts: load() calls requireRole(locals,'host','server','manager','owner') (F1), resolves brand from url, calls getCustomerProfile(brand,params.id). Actions: `?/save` (updateCustomerProfile from the structured form), `?/toggleVip` (flip vip), `?/addTag` / `?/removeTag` (mutate tags[]). All actions pass actor='staff' + on_behalf_of=locals.staff.id.
5. Create src/routes/admin/customers/[id]/+page.svelte: Svelte 5 runes. Sections — header (name, VIP star toggle, tags as removable chips + add-chip input), a prominent red ALLERGIES banner if allergies non-empty, a structured Dietary checkbox grid bound to DietaryFlags, a Notes rich-textarea (kept for context the AI reads), a stats strip (lifetime covers, completed/cancelled/no-show counts, risk badge low/watch/high coloured), and a chronological booking-history table (date, party, tables, status, occasion) linking each row to the diary. Uses use:enhance for inline saves. All hardcoded palette replaced by F3's --admin-* tokens.
6. Make the customer cards in src/routes/admin/customers/+page.svelte link to /admin/customers/{id}?brand={brand}; remove the inline notes textarea there (notes editing moves to the profile page) and instead show VIP badge + risk badge + tag chips read-only, so the list becomes a directory. Keep the `?/notes` action removed (superseded by profile ?/save).
7. Register a new AI READ tool get_customer_profile in adminTools.ts (see aiTools).
8. Tests: add crm.test.ts covering getCustomerProfile stats math (avgPartySize, rates) and risk.level thresholds with fixture bookings.

**Files:** `src/lib/server/booking/crm.ts`, `src/routes/admin/customers/[id]/+page.server.ts`, `src/routes/admin/customers/[id]/+page.svelte`, `src/routes/admin/customers/+page.svelte`, `src/routes/admin/customers/+page.server.ts`, `src/lib/server/booking/mutate.ts`, `src/lib/server/ai/adminTools.ts`, `src/lib/server/booking/crm.test.ts`

**Acceptance criteria:**

- Visiting /admin/customers/{id}?brand=asia shows the guest's lifetime covers, completed/cancelled/no-show counts and a risk badge that matches the documented thresholds.
- Toggling VIP, adding/removing a tag, ticking a dietary flag, and editing allergies all persist and write a geisha_audit_log row with actor='staff', action='update_customer', on_behalf_of set to the logged-in staff id.
- A guest with allergies set shows a prominent allergy banner; an empty allergies field shows no banner.
- After markNoShow on a booking, the guest's no_show_count increments and the profile risk badge updates without a manual recompute.
- The customers list links each card to its profile and no longer renders an inline notes textarea.
- get_customer_profile, asked by the admin assistant for a known guest, returns risk.level, vip, allergies and recent bookings (verified via /api/admin-chat).

**Parallelizable:** Server module (getCustomerProfile/updateCustomerProfile/recompute) and the Svelte profile page can be built in parallel against the agreed CustomerProfile type. The AI tool registration and the list-page rework are independent follow-ons. The mutate.ts counter-hook is a 2-line change coordinated with the booking-core owner and can land separately.

**Risks:**

- recomputeCustomerCounters touches shared mutate.ts — merge collision risk with the booking stream; mitigate by keeping it a single appended call line and coordinating through F3.
- Risk thresholds are judgement calls; expose them as named constants in crm.ts so they're tunable without hunting through logic.
- Stripping notes html for the AI tool must sanitise (the field is editor/html) to avoid feeding markup/script into the model — reuse any existing sanitiser or strip tags.

---

#### WP-CRM-3 — Marketing-consent toggle + provenance and opt-in segmentation export  `M`

**Goal:** Capture WHERE and WHEN each guest's marketing consent was given (provenance), let staff toggle it with an audit trail, and export the opted-in segment as a CSV for email campaigns — filterable by brand, VIP and tags.

**Depends on:** `F1`, `F2`, `WP-CRM-1`

**Schema:** No new migration — uses F2's marketing_consent (existing bool) + marketing_consent_source + marketing_consent_at. If F2 omitted marketing_consent_at, raise a one-line addition to the 1772700600 migration with the F2 owner BEFORE coding (this stream adds no migration of its own).

**Server functions:**

- crm.ts: setMarketingConsent(brand:BrandId,customerId:string,consent:boolean,source:string,actor?:AuditActor,onBehalfOf?:string):Promise<Customer>
- crm.ts: exportMarketingSegment(brand:BrandId,filter?:{vipOnly?:boolean;tags?:string[]}):Promise<{rows:...[];csv:string}>
- reporting.ts: toCsv(headers:string[],rows:(string|number)[][]):string — shared CSV serialiser with BOM + RFC4180 escaping

**API / actions:**

- GET /admin/customers/export?brand=&vipOnly=&tags=a,b -> text/csv attachment (requireRole manager/owner), audited as export_marketing
- POST /admin/customers/[id]?/consent (consent:bool) -> {ok,customer} via setMarketingConsent

**Components:**

- customers/[id]/+page.svelte (edit) — adds the consent switch + provenance line
- customers/+page.svelte (edit) — adds Export CSV button + VIP/tags filter controls

**Implementation steps:**

1. F2's marketing_consent_source field stores provenance (e.g. 'online_booking','staff_entry','import','manual_toggle'); store the timestamp of the last consent change in a `marketing_consent_at` value — if F2 did not add a dedicated field, persist {source,at} as a small json under the existing settings-free approach by adding the timestamp into the dietary-sibling. PREFERRED: confirm with F2 owner that geisha_customers has marketing_consent_source (text) AND that we may stamp marketing_consent_at; if only source exists, encode the ISO timestamp as a prefix 'manual_toggle@2026-06-26T..' is NOT acceptable — instead request F2 add marketing_consent_at (text/datetime). This WP assumes both fields exist (source + at).
2. Add `setMarketingConsent(brand:BrandId, customerId:string, consent:boolean, source:string, actor:AuditActor='staff', onBehalfOf?:string):Promise<Customer>` to crm.ts: writes marketing_consent, marketing_consent_source, marketing_consent_at=nowISO, and writeAudit(actor,'marketing_consent','geisha_customers',id,{consent:before},{consent,source}).
3. Wire the consent toggle into the profile page (WP-CRM-2's +page.svelte) as a labelled switch that shows the current source + date underneath ('Opted in via online booking on 12 Jun 2026'); action `?/consent` in [id]/+page.server.ts calls setMarketingConsent with source='manual_toggle'.
4. Ensure createBooking provenance: WP-CRM-1 already threads marketingConsentSource into upsertCustomer; when an online guest ticks the consent box, source='online_booking' and marketing_consent_at = booking creation time. When unticked, do not stamp a consent timestamp.
5. Add `exportMarketingSegment(brand:BrandId, filter?:{ vipOnly?:boolean; tags?:string[] }):Promise<{ rows:Array<{name:string;email:string;tags:string[];vip:boolean;consentSource:string;consentAt:string}>; csv:string }>` to crm.ts. Selects customers where marketing_consent=true && deleted_at='' && restaurant=brand's id, applies optional VIP/tag filters in-query where possible (tags is json — filter post-fetch), and serialises CSV with a shared `toCsv(headers,rows)` helper in reporting.ts (escapes quotes/commas/newlines, UTF-8 BOM for Excel).
6. Add a GET endpoint for the download: src/routes/admin/customers/export/+server.ts — GET ?brand=&vipOnly=&tags=a,b, requireRole('manager','owner'), returns the CSV with Content-Type text/csv and Content-Disposition attachment filename `geisha-{brand}-marketing-{date}.csv`. Writes writeAudit('staff','export_marketing','geisha_customers','', null, {count, filter}) for GDPR traceability.
7. Add an 'Export opted-in (CSV)' button + VIP/tag filter controls to the customers list header (+page.svelte) that links to the export endpoint with the chosen query params.

**Files:** `src/lib/server/booking/crm.ts`, `src/lib/server/booking/reporting.ts`, `src/routes/admin/customers/[id]/+page.server.ts`, `src/routes/admin/customers/[id]/+page.svelte`, `src/routes/admin/customers/+page.svelte`, `src/routes/admin/customers/export/+server.ts`

**Acceptance criteria:**

- Toggling consent on the profile records marketing_consent_source='manual_toggle', a fresh marketing_consent_at, and an audit row action='marketing_consent'.
- An online booking with the consent box ticked stores source='online_booking' and a consent timestamp equal to booking creation; unticked stores no consent timestamp.
- GET /admin/customers/export?brand=asia returns a CSV containing only marketing_consent=true, non-deleted, asia-scoped customers; opening it in Excel shows correct columns (BOM present), and a field containing a comma is quoted.
- vipOnly=true and tags=anniversary narrow the export correctly.
- Each export writes an export_marketing audit row capturing the count + filter.
- A server/server staff role is blocked from the export endpoint (403/redirect via requireRole).

**Parallelizable:** setMarketingConsent + the profile switch are independent of exportMarketingSegment + the export endpoint; the shared toCsv helper (in reporting.ts) is needed by both WP-CRM-3 and WP-CRM-6 so build it first and let both consume it.

**Risks:**

- GDPR: exporting PII must be role-gated and audited — server/host roles must not export; verified in acceptance.
- If F2 lacks marketing_consent_at the provenance date is lost — must confirm field exists before build (hard dependency on F2).
- tags is a json field; PocketBase can't filter json array membership reliably, so tag filtering happens post-fetch — fine at two-restaurant scale but document the full-list fetch.

---

#### WP-CRM-4 — GDPR data export + right-to-erasure (soft-delete + PII scrub) with audit  `L`

**Goal:** Let staff fulfil a subject-access request by exporting everything held about a guest, and fulfil an erasure request by soft-deleting + scrubbing their PII while preserving anonymised booking facts for reporting, all fully audited.

**Depends on:** `F1`, `F2`, `WP-CRM-1`, `WP-CRM-2`

**Schema:** No new migration — uses F2's geisha_customers.deleted_at + geisha_messages + geisha_audit_log.on_behalf_of. Payments read via geisha_payments by booking id.

**Server functions:**

- crm.ts: exportCustomerData(brand:BrandId,customerId:string):Promise<GdprExport> (+ exported type GdprExport)
- crm.ts: eraseCustomer(brand:BrandId,customerId:string,actor?:AuditActor,onBehalfOf?:string):Promise<{erased:true;retainedBookings:number}>

**API / actions:**

- GET /admin/customers/[id]/gdpr-export?brand= -> application/json attachment (requireRole manager/owner), audited gdpr_export
- POST /admin/customers/[id]?/erase -> redirect to list (requireRole manager/owner), audited gdpr_erasure

**Components:**

- customers/[id]/+page.svelte (edit) — adds a GDPR section: 'Download data (JSON)' link + destructive 'Erase guest' confirm button; tombstone view when already erased

**Implementation steps:**

1. Add `exportCustomerData(brand:BrandId, customerId:string):Promise<GdprExport>` to crm.ts. Assembles a single JSON object: { customer:Customer; bookings:Booking[]; payments:Payment[] (via booking ids, kind/amount/status only — no card data exists locally, Dojo holds it); messages:GeishaMessage[] (F2's geisha_messages, channel/template/status/sent_at); auditEvents:AuditLog[] where entity_id=customerId OR entity_id in their booking ids; consent:{value,source,at} }. Returns the object plus a pretty-printed JSON string.
2. Add a GET endpoint src/routes/admin/customers/[id]/gdpr-export/+server.ts: requireRole('manager','owner'), returns the JSON as an attachment `geisha-gdpr-{customerId}-{date}.json`, and writeAudit('staff','gdpr_export','geisha_customers',customerId,null,{count of records},on_behalf_of=staff.id).
3. Add `eraseCustomer(brand:BrandId, customerId:string, actor:AuditActor='staff', onBehalfOf?:string):Promise<{erased:true; retainedBookings:number}>` to crm.ts implementing soft-delete + PII scrub: set deleted_at=nowISO; overwrite name='Erased guest', email='', phone='', notes='', allergies='', dietary={}, tags=[], vip=false, marketing_consent=false, marketing_consent_source='erased'. Do NOT delete bookings/payments (legal+accounting retention) — they keep pointing at the now-anonymised customer so covers/no-show reporting stays correct. Capture a redacted before snapshot (hash or omit raw PII) and writeAudit(actor,'gdpr_erasure','geisha_customers',customerId,{redacted:true},{deleted_at,retainedBookings}). Erasure is idempotent (re-erasing a deleted row is a no-op returning erased:true).
4. Guard reads: getCustomerProfile / listCustomers already exclude deleted_at!='' (WP-CRM-1/2). Add an explicit 404 in the profile loader if the customer is erased, with a small 'This guest's data was erased on {date}' tombstone view (so staff see the record existed but holds no PII).
5. Add to customers/[id]/+page.server.ts an action `?/erase` (requireRole('manager','owner')) calling eraseCustomer, then redirect to the customers list with a flash. Put the trigger behind a confirm dialog in +page.svelte labelled 'Erase guest (GDPR)' in a clearly destructive style; show the GDPR-export download link right next to it (download first, then erase).
6. Ensure the AI surface cannot leak erased data: the get_customer_profile tool (WP-CRM-2) resolves only non-deleted customers; add a guard test.
7. Tests: crm.test.ts — eraseCustomer scrubs all PII fields, keeps booking count, is idempotent; exportCustomerData includes bookings+payments+audit for the subject only.

**Files:** `src/lib/server/booking/crm.ts`, `src/routes/admin/customers/[id]/gdpr-export/+server.ts`, `src/routes/admin/customers/[id]/+page.server.ts`, `src/routes/admin/customers/[id]/+page.svelte`, `src/lib/server/booking/crm.test.ts`

**Acceptance criteria:**

- GET .../gdpr-export downloads a JSON containing the guest's customer record, all their bookings, related payments (no card PANs — none stored), messages and audit events, and nothing belonging to another guest; an audit row gdpr_export is written.
- Erasing a guest sets deleted_at, blanks name/email/phone/notes/allergies/dietary/tags, sets marketing_consent=false, and writes a gdpr_erasure audit row with on_behalf_of = the manager's staff id; the audit row's before snapshot contains NO raw PII.
- After erasure the guest's bookings still exist and still count in covers/no-show reports (retainedBookings matches), proving anonymised-retention.
- Re-erasing an already-erased guest returns erased:true and does not write a second destructive change (idempotent).
- The erased guest's profile URL shows a tombstone, not PII; listCustomers omits them; get_customer_profile cannot resolve them.
- A host/server role cannot reach the erase action or the export endpoint.

**Parallelizable:** exportCustomerData (+ endpoint) and eraseCustomer (+ action) are independent and can be built concurrently; the tombstone UI and AI guard test are small follow-ons. Both reuse the WP-CRM-3 audit pattern.

**Risks:**

- Hard-delete vs soft-delete tension: full deletion would break booking/payment FKs and accounting retention — soft-delete + scrub is the correct GDPR-compliant choice but MUST be documented so an auditor understands anonymised retention is deliberate.
- The before snapshot in the erasure audit must not itself store the PII being erased (defeats the purpose) — redact it; verified in acceptance.
- Payments live partly at Dojo; the export notes that card data is held by the processor, not Geisha, to set correct SAR expectations.
- Erasure is irreversible — gate behind manager/owner + confirm dialog + download-first UX.

---

#### WP-CRM-5 — Reporting: covers/occupancy over a date range (get_covers_report) + UI  `L`

**Goal:** Provide a covers-and-occupancy report over an arbitrary date range — total covers, bookings, average party size and table occupancy per day and per service period — surfaced on a new /admin/reports page and as an AI tool, computed efficiently server-side.

**Depends on:** `F1`, `F2`

**Schema:** No new migration — reads geisha_bookings, geisha_tables, geisha_service_periods only.

**Server functions:**

- reporting.ts: getCoversReport(brand:BrandId,fromDate:string,toDate:string):Promise<CoversReport> (+ exported type CoversReport)
- reporting.ts: toCsv(...) — shared (also used by WP-CRM-3/6)
- reporting.ts: internal pageBookings(restaurantId,fromISO,toISO):Asyncgenerator/array helper to bound memory

**API / actions:**

- GET /admin/reports?brand=&from=&to= (page load, requireRole manager/owner) — returns CoversReport + NoShowReport for the tabs

**Components:**

- src/routes/admin/reports/+page.svelte — date-range picker + tabs; Covers tab: KPI cards, per-day SVG bars, per-period + occupancy tables
- src/routes/admin/+layout.svelte (edit) — add role-gated Reports nav link

**AI tools:**

- get_covers_report (READ, auto-run): args {from:string;to:string} ('YYYY-MM-DD', resolve relative phrases like 'last week' first). Returns CoversReport.totals + byDay + byPeriod (occupancy summarised). Lets the assistant answer 'how many covers did we do last weekend / which service is busiest'.

**Implementation steps:**

1. Create src/lib/server/booking/reporting.ts (also home of the WP-CRM-3 toCsv helper). Add `getCoversReport(brand:BrandId, fromDate:string, toDate:string):Promise<CoversReport>`. It resolves the restaurant, then pages geisha_bookings with filter `restaurant=${q(id)} && starts_at>=${q(toPbDateFilter(from))} && starts_at<=${q(toPbDateFilter(to))}` using PB getList pagination (perPage 200, loop pages) to avoid loading everything at once on the 1GB droplet. Only OCCUPYING_STATUSES + completed count toward covers; cancelled/no_show are tracked separately. Buckets each booking into its local date (use restaurant.timezone, Intl.DateTimeFormat) and into its service_period id.
2. CoversReport shape: { brand; from; to; totals:{ bookings:number; covers:number; avgPartySize:number; cancelled:number; noShows:number }; byDay:Array<{ date:string; bookings:number; covers:number; cancelled:number; noShows:number }>; byPeriod:Array<{ periodId:string; periodName:string; bookings:number; covers:number }>; occupancy:Array<{ date:string; periodId:string; coversSeated:number; capacity:number; utilisation:number }> }. capacity = sum of seats_max over bookable tables (from getTables) — a simple seat-capacity proxy; utilisation = coversSeated/capacity clamped 0..1. Period names resolved via listPeriods(brand).
3. Guard the range: reject >366 days (returns a 400-style error) to bound work; default the UI to the last 30 days.
4. Create src/routes/admin/reports/+page.server.ts: load() requireRole('manager','owner'), reads brand + from/to query params (defaults last 30 days), calls getCoversReport AND getNoShowReport (WP-CRM-6) so the page shows both report families in tabs. Returns both report objects.
5. Create src/routes/admin/reports/+page.svelte (Svelte 5 runes): a date-range picker (from/to inputs + quick presets: 7d/30d/quarter), a tab switcher (Covers | No-shows — the no-show tab is WP-CRM-6). Covers tab renders: KPI cards (total covers, bookings, avg party), a per-day bar/sparkline (pure CSS/SVG, no chart lib to keep the bundle lean), a per-period table, and an occupancy table with a utilisation % bar. Uses F3's --admin-* tokens. Changing the range navigates with new query params (server-rendered, no client fetch needed).
6. Register AI READ tool get_covers_report in adminTools.ts (see aiTools).
7. Add a 'Reports' link to the admin sidebar (src/routes/admin/+layout.svelte) gated so only manager/owner see it (using locals.staff.role from F1).
8. Tests: reporting.test.ts — getCoversReport bucketing across a DST boundary (Europe/London) and across the date range edges; covers exclude cancelled/no_show; pagination loop covers >200 rows (fixture).

**Files:** `src/lib/server/booking/reporting.ts`, `src/routes/admin/reports/+page.server.ts`, `src/routes/admin/reports/+page.svelte`, `src/routes/admin/+layout.svelte`, `src/lib/server/ai/adminTools.ts`, `src/lib/server/booking/reporting.test.ts`

**Acceptance criteria:**

- GET /admin/reports?brand=asia&from=2026-06-01&to=2026-06-30 renders KPI cards whose total covers equals the sum of party_size over non-cancelled/non-no_show bookings in range (verified against a hand counted fixture).
- Per-period breakdown sums to the per-day total; occupancy utilisation is between 0 and 1.
- A booking that crosses a DST boundary is bucketed into the correct local date (Europe/London).
- Requesting a range >366 days returns a clear error, not a hang.
- A range with >200 matching bookings is fully aggregated (pagination loop works) without an out-of-memory on the droplet.
- get_covers_report returns matching totals when asked via /api/admin-chat; the Reports nav link is hidden for host/server roles.

**Parallelizable:** The reporting.ts aggregation engine, the +page.svelte UI, and the AI tool are three independent tracks once the CoversReport type is agreed. The sidebar link is a trivial edit. The date-range picker component can be built against mock data before the engine is done.

**Risks:**

- Capacity-as-seat-sum is a crude occupancy proxy (ignores turns/time-of-day); label it 'seat utilisation' not 'true occupancy' to avoid over-promising, and leave a note that a turn-aware version is a later enhancement.
- Unbounded date ranges could fetch thousands of rows on a 1GB no-swap droplet — the 366-day cap + paginated fetch are the mitigation; keep perPage modest.
- Timezone bucketing is the classic bug source — must reuse the restaurant.timezone + Intl approach already proven in availability/create, never the server's local zone.

---

#### WP-CRM-6 — Reporting: no-show rate + channel breakdown (get_noshow_report) with CSV/print export  `M`

**Goal:** Report the no-show and cancellation rates over a date range, broken down by booking source/channel (online | phone | walkin | ai) and by service period, exportable as CSV and print-friendly, on the same /admin/reports page.

**Depends on:** `F1`, `F2`, `WP-CRM-5`

**Schema:** No new migration — reads geisha_bookings (status + source) and geisha_service_periods. Relies on F2's booking source 'ai' value being valid.

**Server functions:**

- reporting.ts: getNoShowReport(brand:BrandId,fromDate:string,toDate:string):Promise<NoShowReport> (+ exported type)
- reporting.ts: noShowReportCsv(report:NoShowReport):string
- reporting.ts: coversReportCsv(report:CoversReport):string (for the shared export endpoint report=covers)

**API / actions:**

- GET /admin/reports/export?brand=&from=&to=&report=noshow|covers -> text/csv attachment (requireRole manager/owner), audited export_report

**Components:**

- src/routes/admin/reports/+page.svelte (edit) — No-shows tab: rate KPIs, by-channel + by-period tables, by-day chart, Export CSV + Print buttons, @media print stylesheet

**AI tools:**

- get_noshow_report (READ, auto-run): args {from:string;to:string}. Returns NoShowReport.totals + byChannel + byPeriod. Lets the assistant answer 'what's our no-show rate this month and which channel is worst' — feeds the MOONSHOT goal of the AI flagging risky booking patterns.

**Implementation steps:**

1. Add `getNoShowReport(brand:BrandId, fromDate:string, toDate:string):Promise<NoShowReport>` to reporting.ts, reusing the same paginated booking fetch + timezone bucketing as getCoversReport (factor the fetch+bucket into a shared internal helper so both reports share one PB pass when called from the same loader). Shape: { brand; from; to; totals:{ bookings:number; noShows:number; cancelled:number; lateCancels:number; noShowRate:number; cancelRate:number }; byChannel:Array<{ source:'online'|'phone'|'walkin'|'ai'|''; bookings:number; noShows:number; cancelled:number; noShowRate:number }>; byPeriod:Array<{ periodId:string; periodName:string; bookings:number; noShows:number; noShowRate:number }>; byDay:Array<{ date:string; noShows:number; cancelled:number }> }. noShowRate = noShows / (bookings that reached the table window i.e. not cancelled-in-advance) — document the denominator precisely. 'ai' source is supported because F2 adds source 'ai'.
2. Add `noShowReportCsv(report:NoShowReport):string` to reporting.ts using the shared toCsv — one section per breakdown (channel rows then period rows) with a header row each.
3. Add GET endpoint src/routes/admin/reports/export/+server.ts: GET ?brand=&from=&to=&report=noshow|covers, requireRole('manager','owner'), returns text/csv attachment `geisha-{brand}-{report}-{from}_{to}.csv`; supports report=covers too (serialise CoversReport byDay+byPeriod) so the single endpoint serves both report families. Audited writeAudit('staff','export_report',...).
4. Extend src/routes/admin/reports/+page.svelte No-shows tab: KPI cards (no-show rate %, cancel rate %, late-cancel count), a by-channel table with per-channel rate bars, a by-period table, and a by-day mini chart. Add an 'Export CSV' button (links to the export endpoint with current params) and a 'Print' button (window.print()) — include a print-only @media print stylesheet that strips the sidebar/nav and lays the report out cleanly on A4.
5. Register AI READ tool get_noshow_report in adminTools.ts (see aiTools).
6. Tests: reporting.test.ts — getNoShowReport rate math (denominator excludes advance cancellations), channel bucketing including the 'ai' source and the '' (unset) source, CSV round-trips through toCsv with escaping.

**Files:** `src/lib/server/booking/reporting.ts`, `src/routes/admin/reports/export/+server.ts`, `src/routes/admin/reports/+page.svelte`, `src/lib/server/ai/adminTools.ts`, `src/lib/server/booking/reporting.test.ts`

**Acceptance criteria:**

- The No-shows tab shows a no-show rate equal to no_show bookings / eligible bookings over the range (matches a hand-counted fixture), with the documented denominator.
- By-channel rows include online/phone/walkin and, when present, ai and unset('') sources; each channel's rate is computed on that channel's own counts.
- Export CSV downloads a well-formed file with channel and period sections; a field containing a comma is quoted (RFC4180); opening in Excel shows correct columns (BOM).
- Print produces a clean one-/two-page layout with the sidebar removed (verified via print preview).
- report=covers on the same export endpoint returns the covers CSV.
- get_noshow_report returns matching totals via /api/admin-chat; the export endpoint is blocked for host/server roles.

**Parallelizable:** getNoShowReport reuses WP-CRM-5's fetch/bucket helper so it must land after that helper exists; the CSV export endpoint, the No-shows UI tab, the print stylesheet, and the AI tool are then four independent tracks. coversReportCsv can be written alongside noShowReportCsv.

**Risks:**

- No-show rate denominator is ambiguous (all bookings vs only those that reached service time) — pick 'bookings not cancelled in advance' and document it on the UI so the number is interpretable and stable.
- Sharing one PB fetch between covers + no-show reports when both load on the same page is an optimisation that must not break either when called standalone (e.g. by the AI tool) — keep the standalone functions self-sufficient and only share inside the page loader.
- Print CSS in a shared admin layout can clash with the floor-editor/diary print needs — scope @media print rules to the reports route only.

---

### Stream S6 — Unified AI Management Agent, Dashboard Dock & Voice

Retires the legacy Claude concierge stack and unifies on geminiAgent.ts + adminTools.ts grown to the full 'manage anything' catalogue, surfaced front-and-centre as a persistent dock + Cmd/Ctrl-K command bar with a shared rune store, plus Web Speech voice V1. Owns the AI surface and the new domain tool-registry files; coordinates the adminTools.ts merge point.

- **Depends on:** `F1`, `F2`, `F3`
- **Owns files:** `src/lib/server/ai/adminTools.ts`, `src/lib/server/ai/tools/ (new per-domain registry dir)`, `src/routes/api/admin-chat/+server.ts (systemFor only)`, `src/routes/admin/assistant/+page.svelte`, `src/lib/admin/assistant.svelte.ts`, `src/lib/admin/voice.ts`, `src/lib/components/AIAssistantChat.svelte`, `src/routes/admin/+layout.svelte (dock mount)`

S6 turns the admin AI from a sidebar curiosity into the primary way staff operate Geisha. It retires the legacy Claude concierge stack (ai/agent.ts, ai/tools.ts, /api/ai, /admin/concierge) and unifies everything on the existing transport-agnostic loop in src/lib/server/ai/geminiAgent.ts (runAgent + confirmTool) driven by a grown adminTools.ts catalogue. The single 312-line adminTools.ts (currently 5 read + 1 ui + 3 write tools) is first split into per-domain registry modules under src/lib/server/ai/tools/ (toolsBookings/toolsFloor/toolsCustomers/toolsPayments/toolsSettings/toolsReports) joined by a composer adminTools() — this is the clean merge point every other stream registers tools through. The catalogue then grows to the full "manage anything" set: booking lifecycle (get_booking_detail, get_bookings_range, create_booking, amend_booking, cancel_booking, mark_no_show, seat_booking, clear_table, seat_walkin), floor/seating persistence (unjoin_tables, create/update/delete_table, save_layout, manage_floor, set_shapes, list_floors, get_floor_plan by floorId), plus the ported concierge-unique tools (search_customers, get_customer_history, get_dashboard). The AI surface itself is rebuilt around a shared rune store (src/lib/admin/assistant.svelte.ts) feeding a persistent collapsible dock mounted in admin/+layout.svelte that survives navigation, plus a Cmd/Ctrl-K command bar. Every new write tool gets a precise summarise() line and SETTING_META coverage; destructive tools (delete_table, manage_floor delete, refund) gain type-to-confirm; confirmed writes call invalidateAll() so open pages refresh. Voice V1 (src/lib/admin/voice.ts) adds feature-detected Web Speech press-and-hold STT + TTS readback while preserving every confirm gate. Hard dependencies: F1 (event.locals.staff + requireRole for tool RBAC and on_behalf_of), F2 (schema for amend_booking's booking.amended_from, source 'ai', deposit/closures/pacing collections the report+settings tools read), F3 (geminiAgent loop bug-fixes, audit-actor threading, multi-instance lock, and src/lib/theme/admin.css tokens the dock and command bar are styled with). Within the stream, WP-S6-1 (the split) gates the catalogue WPs (WP-S6-2/3/4) which can then be built in parallel; the UI WPs (WP-S6-5/6/7) depend only on the store + tool shapes and run concurrently with the catalogue work.

#### WP-S6-1 — Split adminTools.ts into per-domain tool-registry modules + composer (the clean merge point)  `M`

**Goal:** Decompose the monolithic adminTools.ts into src/lib/server/ai/tools/ per-domain factories joined by a thin composer so every stream registers AI tools without colliding, with zero behaviour change.

**Depends on:** `F3`

**Server functions:**

- src/lib/server/ai/tools/types.ts — re-export GeminiTool, ToolKind, UiDirective from ../geminiAgent.js; export interface ToolContext { brand: BrandId; nowISO: string; actor: AuditActor; onBehalfOf?: string; role: StaffRole } (actor/onBehalfOf/role sourced from F1 event.locals.staff; default actor='ai').
- src/lib/server/ai/tools/toolsBookings.ts — export function bookingTools(ctx: ToolContext): GeminiTool[] (initially holds check_availability, get_bookings_for_day moved verbatim from adminTools.ts).
- src/lib/server/ai/tools/toolsFloor.ts — export function floorTools(ctx: ToolContext): GeminiTool[] (get_floor_plan, list_tables, join_tables, move_booking moved verbatim).
- src/lib/server/ai/tools/toolsCustomers.ts — export function customerTools(ctx: ToolContext): GeminiTool[] (empty array initially; placeholder for WP-S6-4 ports).
- src/lib/server/ai/tools/toolsPayments.ts — export function paymentTools(ctx: ToolContext): GeminiTool[] (empty initially; WP-S6-6 fills).
- src/lib/server/ai/tools/toolsSettings.ts — export function settingTools(ctx: ToolContext): GeminiTool[] (open_settings, update_setting moved); also move SETTING_META, SettingWidget interface, settingsCatalogue() here and re-export from a barrel.
- src/lib/server/ai/tools/toolsReports.ts — export function reportTools(ctx: ToolContext): GeminiTool[] (empty initially; WP-S6-4 adds get_dashboard).
- src/lib/server/ai/tools/index.ts — barrel: export function adminTools(ctx: ToolContext): GeminiTool[] { return [...bookingTools(ctx), ...floorTools(ctx), ...customerTools(ctx), ...paymentTools(ctx), ...settingTools(ctx), ...reportTools(ctx)] } ; re-export SETTING_META, settingsCatalogue, SettingWidget.
- src/lib/server/ai/adminTools.ts — becomes a 4-line back-compat shim: re-export { adminTools, SETTING_META, settingsCatalogue } from './tools/index.js' and a thin adminTools(brand, nowISO) overload that builds a default ToolContext (actor='ai') so /api/admin-chat keeps compiling until WP-S6-5 threads the real ctx.

**API / actions:**

- No new routes. /api/admin-chat/+server.ts keeps importing { adminTools, settingsCatalogue } — now via the shim, so it is untouched in this WP.

**AI tools:**

- No new tools — all 9 existing tools (check_availability[read], get_bookings_for_day[read], get_floor_plan[read], list_tables[read], list_settings[read], open_settings[ui], move_booking[write,confirm], join_tables[write,confirm], update_setting[write,confirm]) move byte-identical into their domain modules; list_settings moves to toolsSettings.ts.

**Implementation steps:**

1. Create src/lib/server/ai/tools/ directory and types.ts with ToolContext (brand, nowISO, actor, onBehalfOf, role).
2. Cut check_availability + get_bookings_for_day from adminTools.ts into toolsBookings.ts, wrapping the existing closure bodies in bookingTools(ctx) and replacing the captured `brand`/`nowISO` with ctx.brand/ctx.nowISO.
3. Repeat for floorTools (get_floor_plan, list_tables, join_tables, move_booking — keep moveBooking(... ctx.actor) call), settingTools (list_settings, open_settings, update_setting + SETTING_META + settingsCatalogue + SettingWidget interface).
4. Create empty customerTools/paymentTools/reportTools factories returning [].
5. Write tools/index.ts composer concatenating all six factories; re-export SETTING_META/settingsCatalogue/SettingWidget.
6. Replace adminTools.ts body with the shim that builds a default ctx ({brand, nowISO, actor:'ai'}) and delegates.
7. Run tsc + the existing admin assistant manually to confirm identical behaviour.

**Files:** `src/lib/server/ai/tools/types.ts (new)`, `src/lib/server/ai/tools/toolsBookings.ts (new)`, `src/lib/server/ai/tools/toolsFloor.ts (new)`, `src/lib/server/ai/tools/toolsCustomers.ts (new)`, `src/lib/server/ai/tools/toolsPayments.ts (new)`, `src/lib/server/ai/tools/toolsSettings.ts (new)`, `src/lib/server/ai/tools/toolsReports.ts (new)`, `src/lib/server/ai/tools/index.ts (new)`, `src/lib/server/ai/adminTools.ts (gutted to shim)`

**Acceptance criteria:**

- tsc --noEmit passes with no new errors.
- Loading /admin/assistant and asking 'where can I fit a party of 8 tonight' returns the same answer and same proposedAction shape as before the split.
- open_settings still spawns SettingWidget instances; update_setting still halts the loop for confirmation.
- grep shows no remaining tool `run` bodies in adminTools.ts (it is a pure re-export shim).
- A second engineer can add a tool by editing exactly one domain module + nothing in the composer ordering changing existing tool indexes.

**Parallelizable:** The six domain modules can be cut out concurrently (one engineer per file) once types.ts exists; the composer + shim is the single serialization point at the end. This WP must merge before WP-S6-2/3/4 start to avoid re-collision.

**Risks:**

- ToolContext default actor must stay 'ai' for /api/admin-chat so existing audit rows keep actor='ai' until WP-S6-5 supplies the real staff actor — getting this wrong silently mislabels audit history.
- settingsCatalogue() is imported by /api/admin-chat systemFor(); keep the named export reachable from both the shim and the barrel or the chat route 500s.

---

#### WP-S6-2 — Grow booking-lifecycle tool catalogue (detail, range, create, amend, cancel, no-show, seat, clear, walk-in)  `L`

**Goal:** Give the agent the full booking lifecycle as confirm-gated tools wrapping the exact server functions the admin UI uses, so staff can run an entire service from the dock.

**Depends on:** `WP-S6-1`, `F1`, `F2`, `F3`

**Schema:** Uses F2 fields only: geisha_bookings.amended_from (rel, set by amend_booking), source enum gains 'ai', geisha_audit_log.on_behalf_of. No new migration in this WP.

**Server functions:**

- Add to src/lib/server/booking/admin.ts: export async function getBookingsRange(brand: BrandId, fromDate: string, toDate: string): Promise<BookingWithRefs[]> — same query as getBookingsForDay but [fromDate T00:00, toDate T23:59] window, capped sort 'starts_at' (used by get_bookings_range + WP-S6-4 reports).
- Add to src/lib/server/booking/mutate.ts: export async function amendBooking(id: string, patch: { startsAtISO?: string; partySize?: number; tableIds?: string[]; specialRequests?: string; occasion?: string }, nowISO: string, actor: AuditActor='staff', onBehalfOf?: string): Promise<Booking> — re-runs availability/allocation via allocateTables when time/size/tables change, writes geisha_bookings with amended_from set to the prior snapshot id (clone-or-mutate per F2), recreates floor_state if seated (reuse moveBooking's logic), writeAudit(actor,'amend_booking',...,before,after) with on_behalf_of. Throws BookingError('no_availability') if the new slot doesn't fit.
- No change to createBooking/cancelBooking/markNoShow/seatBooking/clearBooking signatures — all already accept actor:AuditActor (F3 adds on_behalf_of threading).

**API / actions:**

- None new — all run through /api/admin-chat ask/confirm. confirm path calls confirmTool(tools,name,input).

**AI tools:**

- get_booking_detail [read] — params {bookingId:string}; run: getBookingDetail(bookingId); returns name, party_size, starts/ends, status, tableLabels, special_requests, occasion, payment summary.
- get_bookings_range [read] — params {fromDate, toDate}; run: getBookingsRange(ctx.brand,...); returns per-day grouped covers + bookings (used for 'how busy is next week').
- create_booking [write, confirm-gated] — params {date,time,partySize,customer{name,email,phone?},specialRequests?,occasion?}; run: createBooking({brand:ctx.brand, ...input, source:'ai', staff:true}); staff:true skips online cap + payment, availability still enforced.
- amend_booking [write, confirm-gated] — params {bookingId, startsAt?(YYYY-MM-DD HH:mm), partySize?, tableIds?, specialRequests?, occasion?}; run: amendBooking(bookingId, patch, ctx.nowISO, ctx.actor, ctx.onBehalfOf).
- cancel_booking [write, confirm-gated] — params {bookingId}; run: cancelBooking(bookingId, ctx.actor) (late-cancel payment handling already inside).
- mark_no_show [write, confirm-gated] — params {bookingId}; run: markNoShow(bookingId, ctx.actor).
- seat_booking [write, confirm-gated] — params {bookingId}; run: seatBooking(bookingId, ctx.nowISO, ctx.actor).
- clear_table [write, confirm-gated] — params {bookingId}; run: clearBooking(bookingId, ctx.nowISO, ctx.actor) (clears floor_state, status=completed).
- seat_walkin [write, confirm-gated] — params {partySize, tableIds:string[], customerName?, time?}; run: createBooking({brand:ctx.brand, date:today(ctx.nowISO), time: time??nowHHmm, partySize, tableIds, customer:{name:customerName??'Walk-in', email:''}, source:'walkin', staff:true}) then seatBooking on the returned booking.id — composed in the tool so the dock seats immediately.

**Implementation steps:**

1. Implement getBookingsRange + amendBooking in the booking layer with audit + availability re-check.
2. In toolsBookings.ts add the 9 tools above, each wrapping its server fn and reading ctx.brand/nowISO/actor/onBehalfOf.
3. For seat_walkin, compose createBooking(staff:true,tableIds) then seatBooking inside one run() so a single confirm produces a seated booking; surface NO_AVAILABILITY as a friendly tool error.
4. Resolve relative dates in the run() defensively (assume the model passed YYYY-MM-DD per system prompt; coerce time HH:mm).
5. Add date-range param schema (fromDate/toDate as dateStr).
6. Register nothing in the composer (bookingTools already wired) — tools appear automatically.

**Files:** `src/lib/server/ai/tools/toolsBookings.ts`, `src/lib/server/booking/admin.ts (add getBookingsRange)`, `src/lib/server/booking/mutate.ts (add amendBooking)`

**Acceptance criteria:**

- Asking 'cancel booking <id>' returns a proposedAction(cancel_booking); confirming flips status to cancelled and writes an audit row actor='ai' (or staff with on_behalf_of once F1 wired).
- create_booking via the dock makes a confirmed booking with source='ai', visible in /admin/diary, with availability respected (overlapping double-book is refused with NO_AVAILABILITY).
- amend_booking changing party 4→7 reallocates tables and sets amended_from; if no fit it returns a clear 'no tables' message and writes nothing.
- seat_walkin with a free table id produces a seated booking that shows on /admin/floor as 'seated' on next poll.
- Every write tool HALTS the loop (geminiAgent kind:'write') and only mutates after the confirm round-trip.
- get_bookings_range over a 7-day window returns per-day covers totals matching the diary.

**Parallelizable:** getBookingsRange and amendBooking are independent server fns (two engineers). The 9 tool wrappers are independent of each other once toolsBookings.ts exists; create/cancel/seat/no-show/clear are trivial wrappers and can land first while amend/walk-in (the composed ones) follow.

**Risks:**

- amendBooking re-allocation must exclude the booking being amended from getOccupyingBookings or it self-conflicts — filter out its own id.
- seat_walkin email: createBooking(staff:true) fires a confirmation email via sendBookingConfirmation with empty customer email — guard against empty email so Resend isn't called with a blank to-address.
- Confirm round-trip re-resolves tools from a fresh ToolContext (nowISO differs); ensure amend/seat use the confirm-time nowISO, not the original ask-time one, or seated_at drifts.

---

#### WP-S6-3 — Floor/seating + persistence write tools (unjoin, table CRUD, save_layout, manage_floor, set_shapes, list_floors, get_floor_plan by floor)  `L`

**Goal:** Expose the floor-editor's persistence layer as confirm-gated AI tools so staff can reshape the room by voice/text, with destructive ones type-to-confirm.

**Depends on:** `WP-S6-1`, `F1`, `F2`, `F3`

**Schema:** Uses F2 FloorShape.points (polyline) for set_shapes; no new migration here.

**Server functions:**

- Reuse existing admin.ts fns verbatim: createTable/updateTable/deleteTable (F3 makes them accept actor+onBehalfOf), saveLayout(TableGeometry[]), listFloors, createFloor/updateFloor/deleteFloor, listShapes(floorId), setShapes(floorId, desired), setJoins(brand, desired), listJoins.
- Add to admin.ts: export async function unjoinTables(brand, tableIdA, tableIdB): Promise<void> — load listJoins, drop the matching unordered pair, call setJoins with the remainder (mirrors the join_tables tool's add logic, inverted).
- Add to admin.ts: export async function getFloorPlanForFloor(brand, date, nowISO, floorId?): Promise<{tables}> — wraps getFloorPlan and filters tables by floor===floorId when provided (fixes the 'returns ALL tables, no floor filter' gap).

**API / actions:**

- None new — via /api/admin-chat.

**AI tools:**

- list_floors [read] — params {}; run: listFloors(ctx.brand); returns id,name,sort_order,width_cm,height_cm.
- get_floor_plan (extended) [read] — add optional {floorId} param; run: getFloorPlanForFloor(ctx.brand,date,ctx.nowISO,floorId). (extends the existing tool, not a new name).
- unjoin_tables [write, confirm-gated] — params {tableIdA, tableIdB}; run: unjoinTables(ctx.brand, a, b).
- create_table [write, confirm-gated] — params {label?,seatsMin?,seatsMax?,section?,floorId?,bookable?}; run: createTable(ctx.brand, {...}, ctx.actor, ctx.onBehalfOf).
- update_table [write, confirm-gated] — params {tableId, patch:{label?,seats_min?,seats_max?,section?,bookable?,floor?}}; run: updateTable(tableId, patch, ctx.actor, ctx.onBehalfOf).
- delete_table [write, confirm-gated, TYPE-TO-CONFIRM] — params {tableId}; run: deleteTable(tableId, ctx.actor, ctx.onBehalfOf).
- save_layout [write, confirm-gated] — params {positions:[{id,x,y,width_cm?,height_cm?,rotation?,floor?}]}; run: saveLayout(positions). (Primarily for the editor; exposed so the agent can nudge geometry.)
- manage_floor [write, confirm-gated; delete variant TYPE-TO-CONFIRM] — params {op:'create'|'update'|'delete', floorId?, name?, width_cm?, height_cm?, px_per_cm?, sort_order?}; run: dispatch to createFloor/updateFloor/deleteFloor (delete refuses if tables remain, surfacing the existing error).
- set_shapes [write, confirm-gated] — params {floorId, shapes:[{id?,kind,x,y,width,height,rotation?,label?,color?,points?}]}; run: setShapes(floorId, shapes) (reconciles walls/zones/labels; points enables polyline walls).

**Implementation steps:**

1. Add unjoinTables + getFloorPlanForFloor to admin.ts.
2. In toolsFloor.ts add list_floors, unjoin_tables, create/update/delete_table, save_layout, manage_floor, set_shapes; extend get_floor_plan with the floorId param.
3. Tag delete_table and manage_floor(op:'delete') so WP-S6-6's summarise()/UI marks them type-to-confirm (carry a confirmStrength:'type' hint in the proposedAction description prefix the UI can detect, e.g. description starting 'DESTRUCTIVE:').
4. Ensure all CRUD tools pass ctx.actor + ctx.onBehalfOf (depends on F3 having widened the signatures).
5. Map setShapes points through unchanged so polyline shapes round-trip.

**Files:** `src/lib/server/ai/tools/toolsFloor.ts`, `src/lib/server/booking/admin.ts (add unjoinTables, getFloorPlanForFloor)`

**Acceptance criteria:**

- list_floors returns both floors for a brand; get_floor_plan with floorId returns only that floor's tables (no cross-floor leakage).
- unjoin_tables on a joined pair removes exactly that join and leaves others intact (verified via list_tables canJoinWith).
- create_table via dock adds a row visible in /admin/tables; update_table changes capacity; both audit with the staff actor + on_behalf_of.
- delete_table proposes a DESTRUCTIVE action that the UI gates behind typing the table label/confirm word before the confirm button enables.
- manage_floor delete on a floor that still has tables returns the existing 'Cannot delete floor: N tables' error as a friendly tool message and writes nothing.
- set_shapes with a polyline (points) persists and re-reads identically via listShapes.

**Parallelizable:** unjoinTables and getFloorPlanForFloor are independent server fns. The 9 tool wrappers are mutually independent; CRUD trio, floor trio, and shapes/layout can each be done by separate engineers once toolsFloor.ts skeleton exists.

**Risks:**

- save_layout/set_shapes accept large arrays — cap array length in the JSON-schema (e.g. maxItems) so the model can't propose a 500-row write; the geminiAgent max_tokens=1024 already bounds output but validate server-side.
- manage_floor delete depends on F3 widening deleteFloor's signature to actor/onBehalfOf; if F3 hasn't landed, deleteFloor still hardcodes writeAudit('staff') — coordinate the merge order.
- Type-to-confirm strength is signalled via a description convention ('DESTRUCTIVE:'); this couples WP-S6-3 and WP-S6-6 — document the contract in tools/types.ts as a const PREFIX so it isn't a magic string.

---

#### WP-S6-4 — Retire the legacy Claude concierge stack; port its unique tools into the registry  `M`

**Goal:** Delete ai/agent.ts, ai/tools.ts, /api/ai and the Concierge nav item, porting search_customers, get_customer_history and get_dashboard into the unified Gemini registry so nothing is lost.

**Depends on:** `WP-S6-1`

**Server functions:**

- Reuse existing admin.ts: listCustomers(search), getCustomerHistory(customerId), getDashboard(brand,date). No new server fns.

**API / actions:**

- DELETE src/routes/api/ai/+server.ts (the whole route directory).
- /api/admin-chat unchanged (already the single endpoint).

**Components:**

- DELETE src/routes/admin/concierge/+page.svelte (and its directory).
- Edit src/routes/admin/+layout.svelte nav array: remove { href:'/admin/concierge', label:'Concierge' }.

**AI tools:**

- search_customers [read] — params {query:string}; run: listCustomers(query); returns id,name,email,phone,vip,tags (vip/tags from F2 fields). Lives in toolsCustomers.ts.
- get_customer_history [read] — params {customerId:string}; run: getCustomerHistory(customerId); returns past bookings most-recent-first. toolsCustomers.ts.
- get_dashboard [read] — params {date:dateStr}; run: getDashboard(ctx.brand,date); returns totalBookings, totalCovers, seated, pendingPayment, upcoming[]. Lives in toolsReports.ts.

**Implementation steps:**

1. Add search_customers + get_customer_history to toolsCustomers.ts and get_dashboard to toolsReports.ts (these were the Claude-only tools; create_booking/cancel_booking/seat_booking are already covered by WP-S6-2).
2. Delete src/lib/server/ai/agent.ts and src/lib/server/ai/tools.ts.
3. Delete src/routes/api/ai/ and src/routes/admin/concierge/.
4. Remove the Concierge nav entry from admin/+layout.svelte.
5. grep the repo for imports of '$lib/server/ai/agent', '$lib/server/ai/tools', '/api/ai', '/admin/concierge' and remove/redirect any stragglers (e.g. README/ADMIN_ROADMAP references — leave docs, fix code).
6. Confirm ANTHROPIC_API_KEY is no longer read by any server code (it can stay set in env harmlessly).

**Files:** `src/lib/server/ai/tools/toolsCustomers.ts`, `src/lib/server/ai/tools/toolsReports.ts`, `src/lib/server/ai/agent.ts (delete)`, `src/lib/server/ai/tools.ts (delete)`, `src/routes/api/ai/+server.ts (delete)`, `src/routes/admin/concierge/+page.svelte (delete)`, `src/routes/admin/+layout.svelte (nav edit)`

**Acceptance criteria:**

- tsc passes after deletion — no dangling imports of agent.ts/tools.ts.
- Navigating to /admin/concierge 404s; the nav no longer shows the Concierge link.
- @anthropic-ai/sdk has no remaining server import (grep clean); the package can be removed from deps in a follow-up.
- search_customers, get_customer_history, get_dashboard answer correctly in the unified dock with grounded data.
- No feature regression: every capability the Claude concierge had is reachable from the Gemini dock.

**Parallelizable:** Porting the 3 read tools (independent) can happen before/parallel to the deletions. Deletions are one atomic commit. Can run fully in parallel with WP-S6-2/WP-S6-3 since it only touches toolsCustomers/toolsReports + dead files.

**Risks:**

- The @anthropic-ai/sdk uninstall is intentionally NOT done here (other code or CLAUDE.md tooling may reference it) — only the server agent.ts/tools.ts usage is removed.
- ADMIN_ROADMAP.md and CLAUDE-style docs reference the concierge; do not edit docs in this WP (out of scope), only code — flag the doc drift to the owner.

---

#### WP-S6-5 — Shared assistant rune store + persistent collapsible dock + Cmd/Ctrl-K command bar  `XL`

**Goal:** Make the AI the always-available operating surface: one rune store survives navigation, a collapsible dock lives in the admin shell, and Cmd/Ctrl-K opens a focused command bar from anywhere.

**Depends on:** `WP-S6-1`, `F1`, `F3`

**Server functions:**

- Edit /api/admin-chat/+server.ts systemFor() ONLY — extend the system prompt to enumerate the full grown tool catalogue (booking lifecycle, floor CRUD, customers, dashboard) and the dock/command-bar context. Thread ctx from F1 event.locals.staff into adminTools(ctx) (replacing the brand,nowISO shim call) so writes carry the real actor + on_behalf_of.

**API / actions:**

- /api/admin-chat POST unchanged in shape ({brand,message,history} | {brand,confirm}); add optional {voice?:boolean} echo-through so the store knows to TTS the reply (WP-S6-7).

**Components:**

- src/lib/admin/assistant.svelte.ts (new) — a .svelte.ts rune module exporting a singleton store: state messages:Msg[], draft, loading, configured, proposed:Proposed|null, widgets:Widget[], dockOpen:boolean, commandBarOpen:boolean; derived brand (read from page.url ?brand). Methods: send(text, opts?), confirm(), dismissProposed(), applyDirectives(), closeWidget(key), toggleDock(), openCommandBar()/closeCommandBar(). All fetch logic moved here from assistant/+page.svelte so the dock, the command bar AND the full-page assistant share ONE conversation + ONE proposed-action state.
- src/lib/components/AdminAssistantDock.svelte (new) — a fixed bottom-right collapsible panel themed with admin.css tokens (F3). Collapsed = pill button; expanded = compact chat (log + composer + confirm card + setting widgets). Binds entirely to the assistant store, so opening it on /admin/floor then navigating to /admin/diary keeps the conversation.
- src/lib/components/AdminCommandBar.svelte (new) — a centered modal palette opened by Cmd/Ctrl-K: single input that send()s to the same store; shows the latest assistant reply + any proposed-action confirm inline; Esc closes. Quick-action chips ('Tonight on the floor', 'Add a booking', 'Who hasn't booked lately').
- src/routes/admin/assistant/+page.svelte (rewrite) — becomes a thin full-screen view that binds to the shared store (chat left, widgets right) instead of owning its own state; reuses summarise() now centralized in the store.
- src/routes/admin/+layout.svelte (edit) — mount <AdminAssistantDock/> + <AdminCommandBar/> once at shell level; add a global keydown listener (Cmd/Ctrl+K → store.openCommandBar(), preventDefault) inside an $effect with cleanup.

**AI tools:**

- None — this WP is the surface; it consumes the catalogue from WP-S6-1..4.

**Implementation steps:**

1. Create assistant.svelte.ts: lift Msg/Proposed types and the send/confirm/applyDirectives/closeWidget logic out of assistant/+page.svelte into exported rune state + methods; keep the fetch contract identical to today.
2. Centralize summarise(p:Proposed) in the store and EXPAND it to every new tool name (create_booking, amend_booking, cancel_booking, mark_no_show, seat_booking, clear_table, seat_walkin, unjoin_tables, create/update/delete_table, save_layout, manage_floor, set_shapes) — coordinated with WP-S6-6.
3. Build AdminAssistantDock.svelte binding to the store; collapsed pill + expanded chat; mount confirm card + SettingWidget reuse.
4. Build AdminCommandBar.svelte modal; wire Cmd/Ctrl-K in +layout.svelte with a feature-safe keydown ($effect, navigator-agnostic metaKey||ctrlKey).
5. Rewrite assistant/+page.svelte as a store-bound view.
6. Update systemFor() to describe the full catalogue + that the assistant is a persistent dock; thread real ctx (F1) into adminTools().
7. Verify state survives client-side navigation (SvelteKit keeps the layout mounted, so the store singleton persists).

**Files:** `src/lib/admin/assistant.svelte.ts (new)`, `src/lib/components/AdminAssistantDock.svelte (new)`, `src/lib/components/AdminCommandBar.svelte (new)`, `src/routes/admin/assistant/+page.svelte (rewrite)`, `src/routes/admin/+layout.svelte (mount + Cmd/Ctrl-K)`, `src/routes/api/admin-chat/+server.ts (systemFor + ctx threading)`, `src/routes/admin/assistant/SettingWidget.svelte (reused by dock; possibly retheme to admin.css)`

**Acceptance criteria:**

- Opening the dock on /admin/floor, sending a message, then navigating to /admin/diary shows the same conversation still in the dock (store survived nav).
- Cmd+K (mac) / Ctrl+K (win) opens the command bar from any /admin page; Esc closes; Enter sends; metaKey OR ctrlKey both work.
- A proposed write started in the command bar can be confirmed in the dock (shared proposed state) — they are one conversation.
- The full-page /admin/assistant view and the dock show identical messages because they bind the same store.
- Dock and command bar are styled only via --admin-* tokens from F3's admin.css (no new hardcoded hex).
- invalidateAll() (WP-S6-6) after a confirmed write refreshes whichever admin page is mounted.

**Parallelizable:** assistant.svelte.ts (store) is the prerequisite; once its API is stubbed, AdminAssistantDock, AdminCommandBar, and the assistant/+page rewrite are three independent component tasks. systemFor() prompt copy is independent of the components.

**Risks:**

- A module-level rune singleton in .svelte.ts is shared across all SSR requests on the server — guard against importing it in any +server.ts; it must be client-only state (only referenced from .svelte components). Document this clearly.
- Global Cmd/Ctrl-K must not fire when focus is in an input/textarea elsewhere unless intended; scope the handler to ignore when a modifier-less key, and always preventDefault only for the K+meta combo to avoid stealing browser shortcuts.
- ctx threading depends on F1 event.locals.staff being populated; until F1 lands, fall back to actor='ai' (the WP-S6-1 shim default) so the dock still works in dev.

---

#### WP-S6-6 — Expand SETTING_META + summarise(); type-to-confirm for destructive tools; invalidateAll() after confirmed writes  `M`

**Goal:** Make every new write safe and legible: a precise human summary for each tool, a typed-confirmation gate on destructive ones, full SETTING_META coverage for the new config keys, and automatic page refresh after a confirmed write.

**Depends on:** `WP-S6-1`, `WP-S6-3`, `WP-S6-5`, `F2`

**Schema:** Reads F2 config collections (geisha_deposit_rules, geisha_closures, geisha_pacing_rules) only to add their keys to SETTING_META where surfaced as settings; no migration.

**Server functions:**

- No server fns. systemFor() copy already enumerates tools (WP-S6-5).

**API / actions:**

- /api/admin-chat confirm path returns the existing { ok, result }; the store reacts.

**Components:**

- Edit assistant.svelte.ts summarise(): add a branch per new tool returning a one-line human description (e.g. create_booking → 'Book {partySize} for {date} {time} under {customer.name}', delete_table → 'DELETE table {tableId} — permanent', manage_floor delete → 'DELETE floor {floorId} and its walls/zones').
- Edit AdminAssistantDock.svelte + AdminCommandBar.svelte confirm card: when proposed.description (or a confirmStrength flag carried on the proposed action) begins with the DESTRUCTIVE prefix const from tools/types.ts, render a type-to-confirm input ('type DELETE to enable') that gates the Confirm button.
- Add confirmStrength to the assistant store's Proposed type ('normal'|'type') derived from the tool description prefix so the UI doesn't string-sniff in multiple places.

**AI tools:**

- Adds the SETTING_META entries (not tools) for new config-as-setting keys exposed via open_settings: deposit rules summary keys, pacing keys (max_covers_per_slot, lead_time_minutes, booking_window_days already present), closures note. Each entry: {label, type:'number'|'text', hint}.

**Implementation steps:**

1. In toolsSettings.ts SETTING_META, add friendly labels+hints for every new configurable key the settings/deposit/pacing streams expose, so open_settings can render widgets for them (kept in sync with /admin/settings labels).
2. In assistant.svelte.ts, extend summarise() with a case for each of the ~17 write tools; default falls back to proposed.description.
3. Define const DESTRUCTIVE_PREFIX = 'DESTRUCTIVE:' in tools/types.ts; tag delete_table, manage_floor(op:'delete'), and refund (WP-S6-6 payments tool from the payments stream / S6 paymentTools) descriptions with it.
4. Parse the prefix in the store into proposed.confirmStrength; strip it from the displayed text.
5. In the dock + command bar confirm card, render the typed-confirmation input when confirmStrength==='type'.
6. After a successful confirm() (data.ok), call invalidateAll() from $app/navigation in the store so the mounted page loader re-runs (floor, diary, tables refresh).
7. Show the result summary in chat ('✓ Booking created', '✓ Table deleted').

**Files:** `src/lib/admin/assistant.svelte.ts (summarise + confirmStrength + invalidateAll)`, `src/lib/server/ai/tools/types.ts (DESTRUCTIVE_PREFIX const)`, `src/lib/server/ai/tools/toolsSettings.ts (SETTING_META expansion)`, `src/lib/server/ai/tools/toolsFloor.ts (tag destructive descriptions)`, `src/lib/components/AdminAssistantDock.svelte (typed-confirm UI)`, `src/lib/components/AdminCommandBar.svelte (typed-confirm UI)`

**Acceptance criteria:**

- Every write tool produces a readable confirm line (no raw JSON-only cards); the JSON detail remains available but secondary.
- delete_table and manage_floor(delete) require typing the confirm word before the Confirm button enables; cancel resets it.
- Confirming any write triggers invalidateAll() and the currently-open admin page reflects the change without a manual refresh (e.g. /admin/floor shows the newly-seated walk-in).
- open_settings on a new deposit/pacing key renders a labelled widget with the correct type+hint from SETTING_META.
- The DESTRUCTIVE prefix never leaks into the displayed summary text.

**Parallelizable:** SETTING_META expansion (toolsSettings) is independent of the summarise()/UI work. The typed-confirm UI in dock vs command bar are two independent edits sharing the store's confirmStrength flag.

**Risks:**

- summarise() must stay in lockstep with tool param names; a renamed param silently shows 'undefined' in the confirm card — add a unit-style assertion or keep the param keys centralized.
- invalidateAll() re-runs every loader on the mounted layout — on heavy pages this is a brief flash; acceptable, but avoid calling it on read-only tool runs (only after confirmed writes).

---

#### WP-S6-7 — Voice V1 — Web Speech press-and-hold STT + TTS readback, confirm-gating preserved, feature-detected  `M`

**Goal:** Let staff talk to the assistant hands-free during service: press-and-hold to dictate, the dock answers and reads back, and every write still requires an explicit confirm tap.

**Depends on:** `WP-S6-5`

**Server functions:**

- None — voice is fully client-side (Web Speech API). /api/admin-chat is unchanged; the store may pass {voice:true} so the reply path knows to speak.

**API / actions:**

- None new.

**Components:**

- src/lib/admin/voice.ts (new) — feature-detected wrapper: export function isVoiceSupported(): boolean (checks window.SpeechRecognition||webkitSpeechRecognition + window.speechSynthesis); export function startDictation(onInterim, onFinal): () => void (returns a stop fn; press-and-hold pattern — start on pointerdown, stop on pointerup); export function speak(text: string, opts?): void (TTS readback via SpeechSynthesisUtterance, cancels prior); export function cancelSpeech(). All no-ops when unsupported.
- Edit AdminAssistantDock.svelte + AdminCommandBar.svelte composer: add a mic button (only rendered when isVoiceSupported()) wired press-and-hold to startDictation → feeds interim text into store.draft, on release sends. After an assistant reply arrives (and the message did not produce a proposedAction), call speak(reply).
- Edit assistant.svelte.ts: add voiceEnabled:boolean state + a hook so the store calls speak() on assistant replies when voiceEnabled, and explicitly does NOT auto-confirm — a proposed write is spoken as 'I'd like to … please confirm' and waits for the tap.

**AI tools:**

- None.

**Implementation steps:**

1. Implement voice.ts with strict feature detection and graceful no-op fallbacks (so non-supporting browsers/SSR never throw).
2. Add a mic press-and-hold button to the dock and command bar composers, shown only when supported.
3. Pipe interim transcripts into store.draft live; on pointerup, finalize and send().
4. On assistant reply with no proposedAction, TTS the answer if voiceEnabled; on a proposed write, TTS only the spoken summary and keep the confirm button as the sole way to apply.
5. Add a voice on/off toggle persisted in localStorage so it doesn't surprise staff.
6. Test in Chrome (webkitSpeechRecognition) and confirm the button hides in Firefox where recognition is absent.

**Files:** `src/lib/admin/voice.ts (new)`, `src/lib/admin/assistant.svelte.ts (voiceEnabled + speak hook)`, `src/lib/components/AdminAssistantDock.svelte (mic button + readback)`, `src/lib/components/AdminCommandBar.svelte (mic button + readback)`

**Acceptance criteria:**

- In a supporting browser, press-and-hold the mic, speak 'what's on the floor tonight', release — the transcript sends and the spoken answer is read back.
- A spoken request that yields a write ('cancel booking X') is NEVER auto-applied — the confirm card appears and only a tap (or typed-confirm for destructive) applies it.
- In a non-supporting browser the mic button is absent and text chat is unaffected; no console errors on load (SSR-safe).
- Voice can be toggled off; the preference persists across reloads.
- TTS does not read aloud raw JSON or the DESTRUCTIVE prefix — only the human summary.

**Parallelizable:** voice.ts (the API wrapper) is fully independent and can be built/tested standalone with a tiny harness. Wiring it into the dock vs the command bar are two independent edits once voice.ts exists.

**Risks:**

- Web Speech recognition requires HTTPS + a user gesture and only ships in Chromium reliably — set expectations as V1; feature-detect hard.
- speechSynthesis can queue/overlap; always cancelSpeech() before a new utterance so replies don't stack during a busy service.
- Press-and-hold on touch must not trigger the mobile context menu — set touch-action:none and preventDefault on pointerdown like the existing resize handle in AIAssistantChat.svelte.

---

### Stream S7 — MOONSHOT AI — Predictive Co-Pilot

The beyond-industry-standard differentiator stream: predictive no-show scoring, smart seating optimisation, demand forecasting, autonomous auto-comms, review sentiment, nightly briefings and a supervised autonomous co-pilot. Pure analysis/scoring services + nightly cron jobs writing geisha_ai_insights, exposed to staff as read tools and dashboard cards — never bypasses the confirm-gate for writes.

- **Depends on:** `F1`, `F2`, `F3`, `S6`
- **Owns files:** `src/lib/server/ai/insights/ (noshow.ts, seating.ts, forecast.ts, sentiment.ts, briefing.ts)`, `src/lib/server/ai/tools/toolsInsights.ts`, `src/routes/api/cron/insights/+server.ts`, `src/routes/api/cron/briefing/+server.ts`, `src/lib/server/ai/copilot.ts`, `src/routes/admin/+page.svelte (insight cards)`

> **S7 is the Moonshot AI stream.** Its work-packages are detailed in full in §5 (the moonshot feature catalogue). Per the review, S7 also owns the **regression-test suite** for the foundation lock swap (F3b), the S3 availability-engine edits (pacing/closures/lead-time), and the WP-S1-2 confirm-endpoint re-validation — `availability.test.ts` / `release.test.ts` / `policy.test.ts` / `dojo.test.ts` / `validateToolInput.test.ts` must stay green. See §5 for the feature WPs and §2 Wave 4 for scheduling.

### Stream S8 — Admin Design System & Tablet Responsiveness

Replaces the copy-pasted SaaS-blue palette across 16 admin files with the F3 admin tokens + brand accent, builds shared primitives (Card/DataTable/StatusPill/PrimaryButton/Field) so status semantics can't drift, and fixes the biggest UX gap: the fixed 220px sidebar with no breakpoint becomes a collapsible off-canvas drawer with table overflow and 44px tap targets for floor tablets.

- **Depends on:** `F3`
- **Owns files:** `src/lib/components/admin/Card.svelte`, `src/lib/components/admin/DataTable.svelte`, `src/lib/components/admin/StatusPill.svelte`, `src/lib/components/admin/PrimaryButton.svelte`, `src/lib/components/admin/Field.svelte`, `src/routes/admin/+layout.svelte (grid/drawer)`, `src/routes/admin/diary/+page.svelte`, `src/routes/admin/tables/+page.svelte`, `src/routes/admin/settings/+page.svelte`

Replaces the copy-pasted SaaS-blue palette and re-authored white-card/table/pill/button/field markup spread across 18 admin .svelte files (197 hardcoded-hex occurrences) with one shared primitive library reading the F3 `--admin-*` tokens, and fixes the worst UX gap: the fixed `220px 1fr` sidebar grid in `src/routes/admin/+layout.svelte` (no breakpoint) becomes a collapsible off-canvas drawer with 44px tap targets and table overflow so floor tablets and phones are usable. Hard dependency: F3 ships `src/lib/theme/admin.css` (the `--admin-*` token source plus a per-brand accent derived from the public `--accent`), imported once in `admin/+layout.svelte`; this stream consumes those tokens and MUST NOT re-define them. Scope is presentation only — no schema, no booking-engine logic, no server fns, no API behaviour changes. The single load-bearing design decision is a SINGLE status-colour vocabulary expressed once in `StatusPill.svelte`, covering both booking statuses (`pending_payment|confirmed|seated|completed|cancelled|no_show` from `src/lib/server/db/types.ts:138-143`) and the live floor states (`free|upcoming|seated|finishing|overdue` from `src/routes/admin/floor/+page.svelte` STATE_LABEL), so semantics can never drift between the dashboard, diary, booking detail and live floor again. One small, well-defined AI surface is added: a read-only `ui`-kind tool `set_admin_density` (no confirm) that lets the admin assistant toggle the comfortable/compact table density the primitives respect. Work is highly parallelizable: WP-S8-1 (primitives) is the only thing every other WP imports, so it goes first; WP-S8-2 (token swap), WP-S8-3 (shell drawer) and WP-S8-4 (table overflow) then proceed concurrently across disjoint files, and WP-S8-5 (Card consolidation) sweeps the residual ad-hoc cards. Owns 5 new primitives under src/lib/components/admin/ plus the shell and the three data-dense pages (diary/tables/settings); every other admin page is edited cooperatively under the rule "swap hex for tokens / adopt primitives, change no logic".

#### WP-S8-1 — Shared admin primitives: Card, DataTable, StatusPill, PrimaryButton, Field  `L`

**Goal:** Author five token-driven Svelte 5 primitives under src/lib/components/admin/ that encode the admin design system once, with a single status-colour vocabulary, so every admin page composes them instead of re-authoring white cards, tables, pills, buttons and fields.

**Depends on:** `F3`

**Schema:** None — presentation only.

**Components:**

- src/lib/components/admin/Card.svelte — the white surface primitive. Props: { title?: string; subtle?: boolean; pad?: 'sm'|'md'|'lg' = 'md'; class?: string; header?: Snippet; children: Snippet }. Renders <section class="a-card"> using --admin-surface / --admin-border / --admin-radius / --admin-shadow; optional <header> with <h2> from `title` (or the header snippet). `subtle` swaps to --admin-surface-2 for the table-head / inset look. Replaces the `background:#fff; border:1px solid #e3e7ef; border-radius:10px` block re-authored in 8+ files.
- src/lib/components/admin/DataTable.svelte — generic, typed, responsive table. Props: `{ columns: Column[]; rows: T[]; rowKey: (r:T)=>string; empty?: string; density?: 'comfortable'|'compact'; row?: Snippet<[T]> }` where `type Column = { key: string; label: string; width?: string; align?: 'left'|'right'|'center'; numeric?: boolean; hideBelow?: 'sm'|'md' }`. Default rendering walks columns; when a `row` snippet is supplied the consumer renders cells (used where rows contain forms, e.g. tables page). Emits a semantic <table> with sticky <thead>; below the --admin-bp-table breakpoint each row becomes a stacked card with `data-label` (CSS ::before) pseudo-headers. Tap targets in rows respect 44px min-height. density falls back to the value set by the ui tool (WP-S8-1 reads document data-admin-density).
- src/lib/components/admin/StatusPill.svelte — THE single status vocabulary. Props: `{ status: string; kind?: 'booking'|'floor' = 'booking'; size?: 'sm'|'md' }`. Internal const STATUS_TONE maps every booking status (pending_payment|confirmed|seated|completed|cancelled|no_show) and floor state (free|upcoming|seated|finishing|overdue) to a semantic tone token (positive|info|warn|danger|neutral) -> --admin-tone-*-bg / --admin-tone-*-fg. Renders label via status.replace(/_/g,' ') with text-transform:capitalize. This is the ONLY place pill colours live.
- src/lib/components/admin/PrimaryButton.svelte — button/submit primitive. Props: `{ variant?: 'primary'|'ok'|'warn'|'danger'|'ghost' = 'primary'; size?: 'sm'|'md'|'lg'; type?: 'button'|'submit' = 'submit'; disabled?: boolean; href?: string; children: Snippet }` plus `...rest` forwarded. Renders <button> (or <a> when href) using --admin-accent / --admin-accent-fg for primary and the semantic tone tokens for ok/warn/danger; min-height 44px at size md/lg for tablet tap targets; :disabled => opacity .5. Replaces the `#2f6bd4` button block everywhere.
- src/lib/components/admin/Field.svelte — labelled input wrapper. Props: `{ label?: string; hint?: string; error?: string; for?: string; orientation?: 'stack'|'inline' = 'stack'; children: Snippet }`. Renders <label> + slot for the control + optional hint/error; control styling (border --admin-border, radius, 44px min-height on touch) provided by a :global(.a-field input/select/textarea) rule so existing native inputs inside get themed without rewiring bind: directives. Replaces the input/select/textarea style block duplicated in 6+ files.

**Implementation steps:**

1. Confirm F3's src/lib/theme/admin.css exists and read its exact custom-property names; if any required token is missing (specifically --admin-surface, --admin-surface-2, --admin-border, --admin-radius, --admin-shadow, --admin-ink, --admin-ink-soft, --admin-ink-faint, --admin-accent, --admin-accent-fg, --admin-tone-positive-bg/-fg, --admin-tone-info-bg/-fg, --admin-tone-warn-bg/-fg, --admin-tone-danger-bg/-fg, --admin-tone-neutral-bg/-fg, --admin-bp-table, --admin-bp-shell, --admin-tap), flag to the F3 owner and add a documented :where(:root) fallback block at the top of DataTable/StatusPill so primitives degrade gracefully rather than render unstyled — never redefine tokens that F3 owns.
2. Create src/lib/components/admin/ and author StatusPill.svelte first (defines the tone vocabulary the others reference conceptually). Hardcode the STATUS_TONE map: confirmed->positive, seated->positive, completed->neutral, pending_payment->warn, upcoming->warn, finishing->warn, free->neutral, overdue->danger, cancelled->danger, no_show->danger. Each tone resolves to --admin-tone-{tone}-bg/-fg.
3. Author Card.svelte using --admin-surface/border/radius/shadow; expose `subtle` for the table-head tone and `header` snippet for the title+action pattern (header with an h2 and a right-aligned action is the most common admin layout, e.g. diary/customers headers).
4. Author PrimaryButton.svelte with the five variants mapping to accent + tone tokens; ensure size md/lg => min-height: var(--admin-tap, 44px).
5. Author Field.svelte with the :global control-theming rule scoped under .a-field so wrapping an existing <input> themes it without changing its name/bind.
6. Author DataTable.svelte: render <table> with sticky thead by default; accept a `row` snippet for form-bearing rows; implement the stacked-card fallback below --admin-bp-table using `display:block` rows + cell ::before { content: attr(data-label) }; read density from a top-level `let density = $derived(...)` that prefers the prop then document.documentElement.dataset.adminDensity then 'comfortable'.
7. Add a single self-documenting example/usage comment block at the top of each primitive (no Storybook in this repo).
8. Run `npm run check` (svelte-check) and `npm run lint` to confirm the primitives type-check against Svelte 5 runes ($props/$bindable where needed) with no a11y warnings (label association, button type).

**Files:** `src/lib/components/admin/Card.svelte`, `src/lib/components/admin/DataTable.svelte`, `src/lib/components/admin/StatusPill.svelte`, `src/lib/components/admin/PrimaryButton.svelte`, `src/lib/components/admin/Field.svelte`

**Acceptance criteria:**

- All five files exist under src/lib/components/admin/ and `npm run check` passes with zero new errors/a11y warnings.
- StatusPill renders correct, distinct tones for ALL ten keys (six booking statuses + five floor states, seated shared) and capitalises multi-word keys (pending payment, no show); verified by a throwaway harness route or a Vitest snapshot if a test runner is present.
- No primitive contains a literal hex colour — every colour is var(--admin-*) (grep over src/lib/components/admin returns zero hex matches except inside fallback :where(:root) blocks).
- PrimaryButton at size md/lg and DataTable rows both report >=44px computed min-height in DevTools.
- Card with `subtle` uses --admin-surface-2; default uses --admin-surface — visually distinct.

**Parallelizable:** The five primitives are independent files and can be authored concurrently by up to five people; only DataTable conceptually depends on StatusPill being importable (consumers pass StatusPill in). Within DataTable, the default-render path, the snippet-row path, and the responsive stacked-card CSS are independent sub-tasks.

**Risks:**

- Token name drift vs F3: if F3 names a token differently the primitives silently fall back — mitigated by the explicit fallback block + a one-line contract check listing required token names.
- Svelte scoped-CSS tree-shaking (per asia-home-motion memory): runtime-applied attribute selectors like [data-admin-density] or [data-in] can be dropped — must use :global() for any selector driven by a runtime attribute, especially DataTable density/stacking.
- DataTable's snippet-row escape hatch could be misused to bypass the design system; documented that snippet rows must still use PrimaryButton/Field/StatusPill inside.

---

#### WP-S8-2 — Replace hardcoded hex across all admin pages with --admin-* tokens + per-brand accent  `L`

**Goal:** Eliminate the 197 hardcoded-hex occurrences across the 18 admin .svelte files by swapping every literal colour for the F3 --admin-* tokens (and the brand accent), changing no markup logic, so the whole back-office honours one palette and the per-brand accent already carried by ?brand=.

**Depends on:** `F3`, `WP-S8-1`

**Components:**

- No new components. Edits are confined to <style> blocks (and a handful of inline style/class usages) of every existing admin route file.

**Implementation steps:**

1. Build the canonical hex->token mapping table from the audited literals: #fff -> var(--admin-surface); #f4f5f7 (page bg) -> var(--admin-bg); #f7f8fb (table head/inset) -> var(--admin-surface-2); #1a1f2b (ink/sidebar) -> var(--admin-ink) / sidebar uses --admin-sidebar-bg; #e3e7ef (card border) -> var(--admin-border); #eef1f6 (row divider / neutral pill bg) -> var(--admin-border-soft) or --admin-tone-neutral-bg by context; #cdd3df (input border / free border) -> var(--admin-field-border); #6b7488 + #44506a (muted/label text) -> var(--admin-ink-soft) / var(--admin-ink-faint); #2f6bd4 (primary + links + focus ring) -> var(--admin-accent); status pill literals (#def3e4/#1d6b39, #fdf0d6/#8a6213, #dce8fb/#1d4a8a, #fbe0de/#9c2f28, #eef1f6/#44506a) -> the --admin-tone-* pairs; floor border companions (#e8c98a,#7cc596,#e09a95) -> --admin-tone-*-border.
2. Pass 1 — the three pages this stream OWNS get hex removed as part of WP-S8-4 (do not double-edit): admin/diary, admin/tables, admin/settings. In this WP touch only the non-owned pages.
3. Pass 2 — sweep non-owned route files swapping hex for tokens, logic untouched: src/routes/admin/+page.svelte (dashboard cards + table + pills), src/routes/admin/bookings/[id]/+page.svelte (card, dl, action buttons -> can also adopt PrimaryButton variants), src/routes/admin/floor/+page.svelte (legend/tiles/panel/walkin — keep the .free/.upcoming/.seated/.overdue class names but back them with --admin-tone-* so StatusPill and the tiles agree), src/routes/admin/new-booking/+page.svelte (.card/.done/.err -> tokens + tone), src/routes/admin/customers/+page.svelte (.cust/.tag -> tokens), src/routes/admin/concierge/+page.svelte, src/routes/admin/assistant/+page.svelte, src/routes/admin/assistant/SettingWidget.svelte, src/routes/admin/circle/+page.svelte.
4. Pass 3 — floor-editor cluster (CAD-lite, colour-sensitive): src/routes/admin/floor-editor/+page.svelte, FloorCanvas.svelte, FloorToolbar.svelte, TableTile.svelte, ShapeItem.svelte. Swap chrome/UI hex for tokens but PRESERVE functional canvas colours (grid lines, selection ring, shape fills from geisha_floor_shapes.color) — only the surrounding toolbar/panel chrome is tokenised; document which literals are intentionally kept as functional.
5. Pass 4 — admin/+layout.svelte: this file's palette is replaced wholesale in WP-S8-3; in this WP only confirm the sidebar/switch/nav hex are accounted for in the mapping so WP-S8-3 can apply them.
6. After each file, diff to confirm only colour values changed (no class renames, no structural edits) and run `npm run check` + `npm run lint`.
7. Final sweep: Grep the admin tree for hex literals (#[0-9a-fA-F]{3,6}); the only allowed remaining matches are the documented functional canvas colours in the floor-editor and SVG data-URIs.

**Files:** `src/routes/admin/+page.svelte`, `src/routes/admin/bookings/[id]/+page.svelte`, `src/routes/admin/floor/+page.svelte`, `src/routes/admin/new-booking/+page.svelte`, `src/routes/admin/customers/+page.svelte`, `src/routes/admin/concierge/+page.svelte`, `src/routes/admin/assistant/+page.svelte`, `src/routes/admin/assistant/SettingWidget.svelte`, `src/routes/admin/circle/+page.svelte`, `src/routes/admin/floor-editor/+page.svelte`, `src/routes/admin/floor-editor/FloorCanvas.svelte`, `src/routes/admin/floor-editor/FloorToolbar.svelte`, `src/routes/admin/floor-editor/TableTile.svelte`, `src/routes/admin/floor-editor/ShapeItem.svelte`

**Acceptance criteria:**

- Grep for hex literals across src/routes/admin/**/*.svelte returns only the explicitly documented functional floor-editor canvas colours and SVG data-URIs — zero chrome hex remain.
- Switching ?brand=asia vs ?brand=fusion visibly changes the admin accent (links, primary buttons, active nav, focus ring) because everything now reads --admin-accent which F3 derives from the public --accent (gold vs terracotta).
- Booking-status and floor-state colours are visually identical to before the swap (token values chosen to match the prior literals) — no regression in the live floor legend/tiles.
- `npm run check` and `npm run lint` pass with no new errors; git diff shows only <style> colour-value changes (plus optional PrimaryButton adoption on bookings/[id]) in non-owned files.
- No page references #2f6bd4 / #1a1f2b / #e3e7ef / #6b7488 anywhere.

**Parallelizable:** Each route file is an independent edit — the dashboard, booking-detail, floor, new-booking, customers, concierge, assistant and circle passes can all run concurrently once the mapping table is agreed. The floor-editor cluster is its own sub-stream (colour-sensitive) and should be done by whoever knows the CAD geometry. The mapping table must be finalised before fan-out to avoid inconsistent token choices.

**Risks:**

- Status pill colours live in three duplicated style blocks (dashboard, diary, booking-detail) and the floor file — easy to miss one; mitigated because WP-S8-1 StatusPill + WP-S8-4/WP-S8-5 replace those usages, leaving only the floor tiles to hand-tokenise.
- Floor-editor functional colours: tokenising a grid-line or selection-ring colour by mistake could break the CAD readability — must distinguish chrome from canvas.
- Merge collisions with WP-S8-3 on admin/+layout.svelte and with WP-S8-4 on the three owned pages — resolved by ownership split (this WP excludes those four files' substantive work).

---

#### WP-S8-3 — Tablet/mobile shell: collapsible sidebar + off-canvas burger drawer  `M`

**Goal:** Add a breakpoint to the fixed `220px 1fr` admin grid so on tablet/phone the dark sidebar collapses into an off-canvas drawer opened by a burger in a slim top bar, with the brand switch and full nav preserved, 44px tap targets, scrim, Escape-to-close and body-scroll-lock — making /admin usable on floor tablets and phones.

**Depends on:** `F3`, `WP-S8-1`

**Components:**

- src/routes/admin/+layout.svelte (rewrite shell only) — keeps the existing `brand`, `qp`, `nav` array and `isActive()` logic verbatim. Adds: `let drawerOpen = $state(false)`; a top bar (visible only below --admin-bp-shell) containing a burger <button aria-controls="admin-drawer" aria-expanded={drawerOpen}>, the 'Geisha Admin' wordmark, and the brand label; the <aside class="side"> becomes the drawer; a scrim <button> behind it; an $effect that toggles document.body style overflow when drawerOpen and below breakpoint; a close on navigation via `$effect` watching page.url.pathname; Escape handled by onkeydown on the scrim/drawer. Replaces all sidebar/nav hex with --admin-sidebar-* tokens. The 'No auth yet' warning paragraph is retained (its removal is F1's concern).
- Optional tiny src/lib/components/admin/Drawer.svelte if the open/scrim/lock logic is reused elsewhere; default is to inline it in the layout to keep one source of truth for the shell.

**Implementation steps:**

1. Read the current admin/+layout.svelte; preserve the <script> (brand/qp/nav/isActive) and the 'No auth yet' notice exactly.
2. Restructure the grid: at >= --admin-bp-shell keep `grid-template-columns: var(--admin-sidebar-w,220px) 1fr` with the static sidebar (current behaviour). Below the breakpoint switch to a single column, render the top bar, and position .side as a fixed off-canvas panel (transform: translateX(-100%)) that slides in (translateX(0)) when drawerOpen; use :global() for the runtime [data-open]/class:open driven rule to avoid Svelte scoped-CSS tree-shaking dropping it (asia-home-motion trap).
3. Add the burger button (>=44px), wordmark and brand label to the top bar; wire onclick to toggle drawerOpen.
4. Add a full-viewport scrim button (role/aria-label 'Close menu') shown when drawerOpen; click and Escape set drawerOpen=false.
5. Body-scroll-lock: $effect that sets document.body.style.overflow='hidden' while drawerOpen (and a matchMedia guard so it only locks below the breakpoint), restoring on close/unmount.
6. Auto-close on navigation: $effect tracking page.url.pathname sets drawerOpen=false so tapping a nav item closes the drawer.
7. Tokenise the sidebar/switch/nav colours (#1a1f2b/#252b3a/#2f3850/#cfd6e4/#d4a04c) to --admin-sidebar-bg/-hover/-active/-fg and the active/switch-on state to var(--admin-accent) so the drawer accent follows brand.
8. Bump nav link and switch tap targets to min-height var(--admin-tap,44px) and adequate spacing for touch.
9. Set prefers-reduced-motion: reduce => disable the slide transition.
10. Verify with chrome-devtools MCP emulate at 1024px (tablet, sidebar visible), 834px/768px (drawer), 390px (phone) for true CSS-px (per chrome-devtools-mcp-lock memory) — burger appears, drawer slides, scrim closes, focus returns to burger, body scroll locked while open.

**Files:** `src/routes/admin/+layout.svelte`

**Acceptance criteria:**

- At >= the shell breakpoint the layout is pixel-equivalent to today (220px sidebar + content), with sidebar colours now from tokens and the active item using --admin-accent.
- Below the breakpoint the sidebar is hidden, a top bar with a 44px burger shows; tapping it slides the drawer in over a scrim; tapping the scrim, pressing Escape, or selecting a nav item closes it.
- While the drawer is open below the breakpoint, body scroll is locked; on close or resize above the breakpoint the lock is released and overflow restored.
- Keyboard: Tab order enters the drawer when open, Escape closes and returns focus to the burger; aria-expanded reflects state; scrim has an accessible name.
- prefers-reduced-motion disables the slide animation.
- Brand switch and all 11 nav items remain present and functional inside the drawer; ?brand= still carried via qp.
- Verified visually at 1024 / 834 / 768 / 390 CSS-px via chrome-devtools emulate.

**Parallelizable:** Single file, mostly one author. Internally the drawer-open state machine (toggle/scrim/escape/scroll-lock/auto-close) and the responsive CSS (grid breakpoint + slide transform) are separable sub-tasks. Can run fully concurrently with WP-S8-2 and WP-S8-4 since it touches no other file; only depends on WP-S8-1 for the --admin-tap token convention and optional Drawer extraction.

**Risks:**

- Svelte scoped-CSS tree-shaking dropping the runtime class:open / [data-open] drawer-slide selector (documented asia-home-motion trap) — must use :global().
- Body-scroll-lock leaking if the cleanup doesn't run on resize-above-breakpoint or unmount — guard with matchMedia and an $effect return cleanup.
- Focus management regressions for keyboard/AT users if focus isn't trapped/returned — covered in acceptance.
- Drawer z-index colliding with admin/assistant SettingWidget popovers or floor-editor overlays — pick a documented z-index scale token (--admin-z-drawer) and keep page overlays below it.

---

#### WP-S8-4 — Data-dense table overflow + stacking + 44px tap targets (diary, tables, settings)  `L`

**Goal:** Make the three most data-dense owned pages — diary, tables, settings — usable on tablet/phone by replacing their ad-hoc CSS-grid 'tables' with the WP-S8-1 DataTable (or horizontal-scroll + stacked-card fallback), adopting StatusPill/PrimaryButton/Field, and ensuring every interactive control is a 44px tap target.

**Depends on:** `F3`, `WP-S8-1`

**Components:**

- src/routes/admin/diary/+page.svelte — replace the .grid/.row/.row.head CSS-grid with <DataTable> (columns Time/Guest/Party/Tables/Status/View); status cell renders <StatusPill status={b.status} kind="booking">; the date <input> wrapped in <Field>; 'View' link styled as PrimaryButton variant=ghost href. Preserve the go(date) handler and fmt() exactly.
- src/routes/admin/tables/+page.svelte — the rows contain per-row <form use:enhance> (rowform: display:contents). Use DataTable with the `row` snippet escape hatch so each row's inline edit form + delete form are preserved; wrap inputs/selects in Field, Save/Add/Add-join in PrimaryButton, delete '✕' in PrimaryButton variant=ghost/danger. Keep all form actions (?/update, ?/delete, ?/create, ?/addJoin, ?/removeJoin) and field names verbatim. Below breakpoint the form rows stack vertically (label above control) rather than overflow.
- src/routes/admin/settings/+page.svelte — the booking-policy .setting forms become Field+PrimaryButton; the service-periods read-only .grid becomes a <DataTable> (Name/Days/Open/Last booking/Turn) with hideBelow on Turn/Last-booking on the smallest screens; the assistant-prompt textarea wrapped in Field; preserve LABELS map, DAYS, policySettings/assistant deriveds and all form actions/names.
- (Reuses src/lib/components/admin/DataTable.svelte, StatusPill.svelte, PrimaryButton.svelte, Field.svelte from WP-S8-1.)

**AI tools:**

- set_admin_density — registered here, defined in full in WP-S8-1's overview note and below; consumed by DataTable for comfortable/compact row height. ui-kind, no confirm, no DB write.

**Implementation steps:**

1. diary: import DataTable/StatusPill/PrimaryButton/Field; map data.bookings to DataTable rows; render status via StatusPill; keep fmt()/go()/the date input handler; remove the duplicated .pill.* style block (now in StatusPill); tokenise any remaining hex.
2. tables: import primitives; convert the header+rows into DataTable using the `row` snippet so each row keeps its two <form> elements and contents-display behaviour; wrap each input/select in Field, each button in PrimaryButton; ensure checkbox + buttons are >=44px; below --admin-bp-table the row switches to a stacked label/control layout; keep the Add-table and Table-joins forms, wrapping their controls in Field/PrimaryButton inside a <Card>.
3. settings: import primitives; convert booking-policy forms to Field+PrimaryButton (3-col grid above breakpoint, stacked below); convert the service-periods read-only grid to DataTable; wrap the assistant prompt textarea in Field; keep the hint copy and all hidden inputs (id, type) and actions.
4. Add the AI tool set_admin_density to src/routes/api/admin-chat adminTools.ts registry (cooperative edit; the AI stream owns the file, this WP supplies the exact tool object): { name:'set_admin_density', description:'Switch the admin tables between comfortable and compact row height for the current device.', kind:'ui', parameters:{ type:'object', properties:{ density:{ type:'string', enum:['comfortable','compact'] } }, required:['density'] }, run: async ({density}) => ({ directive:{ type:'set_admin_density', density } }) }. It performs NO DB write and is auto-run (ui kind), so no confirm gate. The admin/assistant client handles the directive by setting document.documentElement.dataset.adminDensity = density (and persisting to localStorage 'admin-density'); DataTable reads document.documentElement.dataset.adminDensity. Density default 'comfortable'.
5. Ensure all native controls in these pages meet 44px min-height via Field/PrimaryButton tokens; verify date pickers and selects too.
6. Run `npm run check`/`npm run lint`; diff to confirm no form action/name/handler logic changed.

**Files:** `src/routes/admin/diary/+page.svelte`, `src/routes/admin/tables/+page.svelte`, `src/routes/admin/settings/+page.svelte`, `src/routes/admin/assistant/adminTools.ts (cooperative: register set_admin_density; AI stream owns the file)`, `src/routes/admin/assistant/+page.svelte (cooperative: handle the set_admin_density directive client-side)`

**Acceptance criteria:**

- Diary, tables and settings render with no horizontal overflow at 768px and 390px CSS-px; data-dense tables either scroll within a contained region or stack into labelled cards below --admin-bp-table.
- Every interactive control (buttons, links-as-buttons, the date input, selects, the delete ✕) reports >=44px computed tap height on all three pages.
- Diary status uses StatusPill (kind=booking) with the single vocabulary; the old per-page .pill.* CSS is deleted from diary.
- All existing form behaviour is preserved: editing+saving a table row, deleting, adding a table, adding/removing a join, saving a setting, and saving the assistant prompt all still POST to the same actions with the same field names and succeed.
- Asking the admin assistant 'make the tables compact' triggers set_admin_density which sets data-admin-density=compact on <html>, persists across reload, and visibly tightens DataTable rows; switching back to comfortable restores them. No confirmation prompt appears (ui kind).
- `npm run check`/`npm run lint` pass with no new errors.

**Parallelizable:** The three pages are independent edits and can be done concurrently once WP-S8-1 ships. The set_admin_density tool registration (adminTools.ts) and its client directive handler (+page.svelte) are a separable two-file sub-task that can be handed to whoever coordinates with the AI stream. Within tables, the inline-edit-row conversion and the joins/add-table cards are independent.

**Risks:**

- tables page uses display:contents on .rowform so each row is a CSS-grid track set — porting to a semantic <table> via DataTable's snippet path must not break the per-row two-form layout; mitigated by the row snippet escape hatch (consumer renders cells), accepting that tables may render as stacked cards on narrow screens rather than a true table.
- set_admin_density relies on a client document attribute, not server state — acceptable for a presentation preference, but must be documented as device-local (localStorage), not per-staff (no schema, consistent with multi-instance serverless note).
- Cooperative edits to adminTools.ts / assistant +page.svelte risk collision with the AI stream — coordinate the exact tool object and directive name ('set_admin_density') up front so both sides agree.
- Stacked-card fallback selectors are runtime-attribute-driven — apply the :global() Svelte tree-shaking guard.

---

#### WP-S8-5 — Consolidate the re-authored white-card primitive into <Card>  `M`

**Goal:** Replace every remaining ad-hoc white-card surface (the `background:#fff; border:1px solid #e3e7ef; border-radius:10px` block re-authored across 6+ files) with the WP-S8-1 <Card>, so there is one card source of truth and the dashboard, booking detail, new-booking, customers, floor panel and assistant widget all share identical surface, border, radius and shadow.

**Depends on:** `WP-S8-1`, `WP-S8-2`

**Components:**

- src/routes/admin/+page.svelte — the four KPI .card tiles and the upcoming <table> wrapper become <Card> instances (KPI tiles use Card pad=sm; the .card.warn 'Awaiting payment' tile uses a tone-warn accented Card variant or a class that reads --admin-tone-warn-bg). The status pills in the table adopt StatusPill.
- src/routes/admin/bookings/[id]/+page.svelte — the single .card detail panel becomes <Card>; the status pill becomes StatusPill; the seat/clear/no-show/cancel buttons become PrimaryButton variants ok/warn/danger; dl styling tokenised.
- src/routes/admin/new-booking/+page.svelte — the two .card step forms become <Card title="1 · Find a time"> / <Card title="2 · Guest details">; .done success and .err error banners become tone-positive / tone-danger callouts (a small inline pattern or a Card variant); Field/PrimaryButton adopted.
- src/routes/admin/customers/+page.svelte — each .cust row becomes a <Card>; the 'opted in' .tag becomes a StatusPill-like neutral/positive chip (or a small Tag use of the tone tokens); notes textarea wrapped in Field, Save in PrimaryButton.
- src/routes/admin/floor/+page.svelte — the .panel side panel and the legend container become <Card> (the .room canvas stays bespoke positioned); the per-state .free/.upcoming/.seated/.overdue tile classes remain but are confirmed to read the same --admin-tone-* tokens StatusPill uses.
- src/routes/admin/assistant/SettingWidget.svelte — the .widget surface becomes <Card pad=sm>; its Save in PrimaryButton, input/textarea in Field; the ok/err inline messages use tone tokens.

**Implementation steps:**

1. Inventory every literal white-card block remaining after WP-S8-2 (these files: dashboard, bookings/[id], new-booking, customers, floor panel, assistant SettingWidget) — confirmed 6+ via the audit.
2. Per file, replace the ad-hoc surface element with <Card> (choosing pad and title/header snippet to match the existing layout), delete the now-dead .card/.panel/.cust/.widget surface CSS, and keep all inner markup and logic.
3. Where a card carried a status or a state accent (dashboard .card.warn, success/error banners), express the accent through tone tokens rather than re-introducing hex.
4. Adopt StatusPill in the dashboard upcoming table and the booking-detail header (removing their duplicated .pill.* blocks), and PrimaryButton for the booking-detail action buttons.
5. Confirm the floor live-state tile classes and StatusPill resolve to the identical tone tokens so the floor board and the rest of admin never diverge.
6. Run `npm run check`/`npm run lint`; visually compare each page before/after to confirm surfaces are unchanged except for now-shared shadow/border.
7. Final grep: the string 'background: #fff' / 'background:#fff' appears in zero admin route files; all surfaces flow through <Card>.

**Files:** `src/routes/admin/+page.svelte`, `src/routes/admin/bookings/[id]/+page.svelte`, `src/routes/admin/new-booking/+page.svelte`, `src/routes/admin/customers/+page.svelte`, `src/routes/admin/floor/+page.svelte`, `src/routes/admin/assistant/SettingWidget.svelte`

**Acceptance criteria:**

- Grep for `background:#fff` / `background: #fff` across src/routes/admin/**/*.svelte returns zero matches — every card surface is <Card>.
- Dashboard KPI tiles, booking-detail panel, new-booking step cards, customer rows, floor side panel and the assistant SettingWidget all render with identical border/radius/shadow sourced from --admin-* tokens.
- The dashboard 'Awaiting payment' tile and the new-booking success/error banners use tone tokens (warn/positive/danger), not reintroduced hex.
- Booking-detail and dashboard status pills now use StatusPill; their old .pill.* CSS blocks are deleted.
- All page logic (date pickers, enhance forms, seat/clear/cancel actions, search, notes save, AI SettingWidget save) is unchanged and still works.
- `npm run check`/`npm run lint` pass; git diff shows surface markup swapped to <Card> with no behavioural change.

**Parallelizable:** All six files are independent and can be converted concurrently once WP-S8-1 (Card/StatusPill/PrimaryButton/Field) and WP-S8-2 (tokens in place) are done. SettingWidget conversion should be coordinated lightly with the AI stream since it lives under admin/assistant, but its surface swap is self-contained.

**Risks:**

- Card's default header/title slot may not match every bespoke header layout (e.g. dashboard date input on the right) — use the header snippet escape hatch rather than forcing the title prop.
- Floor .room canvas must NOT be wrapped in Card (absolute-positioned tiles depend on its positioning context) — only the side panel/legend become cards.
- SettingWidget is mounted dynamically beside the AI chat; wrapping in Card must not change its compact footprint — use pad=sm and verify the assistant layout.
- Removing duplicated .pill.* blocks must happen in lockstep with StatusPill adoption to avoid a frame of unstyled pills.

---

### Stream S9 — Guest-Facing Booking Widget & Self-Service

Completes the public-facing booking journey beyond the engine: a polished embeddable booking widget flow (date/party/slot/details/payment), guest self-service amend/cancel via a signed link, service-period/opening-hours public display, and the booking-amend server function shared with the AI. Owns the public booking components and the self-service route.

- **Depends on:** `F2`
- **Owns files:** `src/lib/components/BookingPanel.svelte (stepper structure)`, `src/routes/book/[token]/+page.svelte`, `src/routes/book/[token]/+page.server.ts`, `src/routes/api/bookings/amend/+server.ts`, `src/lib/server/booking/amend.ts`, `src/lib/server/booking/selfservice.ts`

This stream completes the public booking journey beyond the pure availability engine. Today the guest can search slots (GET /api/availability) and create a booking (POST /api/bookings -> createBooking), but there is NO way to amend a booking, NO guest self-service (the confirmation email literally says "reply to this email or give us a call"), the widget is a 4-phase form with no real payment step, and opening hours are hardcoded marketing copy in src/lib/data/brand.ts rather than the live geisha_service_periods rows the engine actually books against.



S9 delivers five work-packages: (1) WP-S9-1 a shared amend_booking server fn that re-validates a changed date/time/party via allocateTables before the write and sets the new geisha_bookings.amended_from field — this is the missing mutation gap, reused by admin, the AI agent, and guest self-service. (2) WP-S9-2 a public signed-link self-service route /book/[token] where a guest opens a stateless HMAC-signed link from their confirmation email and can amend or cancel without login. (3) WP-S9-3 widget polish: re-architect BookingPanel.svelte into a clean 5-step stepper (date -> party -> slot -> details -> payment) with a Dojo card-collection payment step and a waitlist fallback that hooks the S3 waitlist when a date is full. (4) WP-S9-4 a public opening-hours / service-period display component that reads geisha_service_periods (the real bookable windows) instead of the static brand.hours copy. (5) WP-S9-5 the post-booking confirmation surface that shows the management link and threads it into the confirmation emails (coordinating with S1's templated messaging).



Hard dependencies: F2 (provides geisha_bookings.amended_from, booking source 'ai', waitlist_origin, geisha_waitlist, geisha_messages) is required by every WP that writes those fields. F3 (multi-instance lock in create.ts, audit-actor threading, AuditLog.on_behalf_of, AI-loop hardening) underpins WP-S9-1 (amend re-uses the lock pattern), WP-S9-2/5 (audit actor='customer'), and the AI tool we register. The amend AI tool we define here is registered by the S2 AI stream into adminTools.ts; we own its server fn + tool spec. S3 (pacing/waitlist) owns geisha_waitlist writes — WP-S9-3's waitlist fallback only calls the join function S3 exposes; we define the integration seam, not the waitlist engine. S1 owns the message templates in src/lib/server/email — WP-S9-5 adds the management-link slot and asks S1 to render it.



Design constraints honoured: shared BookingPanel.svelte is used by BOTH brands (asia + fusion bookings pages), so all new markup must stay brand-neutral and theme purely via existing CSS tokens (--accent, --ink, --card, --line, --bg, --font-serif, --font-sans); the self-service route is public (no staff auth) but every write must writeAudit(actor='customer'); booking writes must go through the F3 multi-instance lock, never the dead in-process Map; all times are wall-clock Europe/London via date-fns-tz fromZonedTime exactly as availability.ts/create.ts already do.

#### WP-S9-1 — amend_booking server fn — re-validate via allocateTables, set amended_from, shared with admin + AI + self-service  `M`

**Goal:** A single canonical amendBooking() that safely changes a booking's date/time/party/requests by re-running the availability allocation under the multi-instance lock, recording the original booking id in geisha_bookings.amended_from, so admin, the AI agent, and guest self-service all share one correct write path instead of each hand-rolling an update.

**Depends on:** `F2`, `F3`

**Schema:** No new migration in this WP — depends entirely on F2 having added geisha_bookings.amended_from (relation -> geisha_bookings, optional) and AuditLog.on_behalf_of. This WP only writes those fields.

**Server functions:**

- src/lib/server/booking/amend.ts: export async function amendBooking(input: AmendBookingInput): Promise<{ booking: Booking; payment: PaymentRequirement; paymentChanged: boolean }>
- src/lib/server/booking/amend.ts: export interface AmendBookingInput { bookingId: string; date?: string; time?: string; partySize?: number; specialRequests?: string; occasion?: string; actor?: AuditActor; onBehalfOf?: string }
- Reuses (does not redefine): allocateTables/turnMinutesFor (availability.ts), paymentRequirementFor/exceedsOnlineCap/isLateCancellation (policy.ts), getOccupyingBookings/getActivePeriods/getTables/getJoins/getSettings/getRestaurant (queries.ts), writeAudit (audit.ts, F3-extended), releaseHold (payments.ts), the F3 shared advisory lock

**API / actions:**

- None in this WP — the HTTP surface (POST /api/bookings/amend) is WP-S9-2. amendBooking is a pure server function consumed by admin loaders/actions, the AI run(), and the self-service action.

**AI tools:**

- amend_booking — WRITE, confirm-gated. Server fn run target amendBooking({...,actor:'ai'}). Spec authored here, registered by S2 into src/lib/server/ai/adminTools.ts WRITE section.

**Implementation steps:**

1. Create src/lib/server/booking/amend.ts. Export interface AmendBookingInput { bookingId: string; date?: string; time?: string; partySize?: number; specialRequests?: string; occasion?: string; actor?: AuditActor; onBehalfOf?: string }. Fields left undefined keep the current value (partial amend).
2. Implement export async function amendBooking(input: AmendBookingInput): Promise<{ booking: Booking; payment: PaymentRequirement; paymentChanged: boolean }>. Load the existing booking via pb().collection('geisha_bookings').getOne<Booking>(bookingId); reject (throw BookingError code 'invalid') if status is 'cancelled' | 'no_show' | 'completed' (only pending_payment/confirmed/seated are amendable; seated is admin-only, gated by caller).
3. Resolve the restaurant from booking.restaurant, tz from restaurant.timezone, settings via getSettings(restaurant.id). Compute the NEW startsAt = fromZonedTime(`${newDate}T${newTime}:00`, tz) where newDate/newTime fall back to the current booking's local date/time (derive from booking.starts_at using Intl.DateTimeFormat in tz, mirroring availability.ts formatLocalHHmm).
4. Re-derive the service period exactly as create.ts does (find the active period whose days_of_week includes the new dow AND whose [start_time,last_booking_time] window contains the new start); throw BookingError('No service available at that time.','no_period') if none. Compute turn = turnMinutesFor(newPartySize, period); endsAt = addMinutes(startsAt, turn).
5. Enforce the online cap only when actor==='customer' (self-service): if exceedsOnlineCap(newPartySize, settings) throw BookingError('phone_required'). Admin/AI amends bypass the cap (mirror create.ts input.staff behaviour).
6. Wrap allocation + write in the F3 PocketBase-backed advisory lock (the same withLock replacement F3 puts in create.ts — import the shared lock helper F3 exposes; do NOT reuse create.ts's in-process Map). Inside the lock: load getOccupyingBookings(restaurant.id, fromISO, toISO) with the ±300min margin, but EXCLUDE the booking being amended from the footprint list (filter out its own id) so it doesn't block itself. Call allocateTables(startsAt, turn, newPartySize, tables, joins, existingMinusSelf). If null -> throw BookingError('No tables available for that time.','no_availability').
7. Write the update: tables=newTableIds, party_size, starts_at, ends_at, service_period, special_requests, occasion, and amended_from = the ORIGINAL booking id (per the F2 schema field). Keep status unchanged UNLESS the payment requirement changed (see next step).
8. Recompute payment: const newReq = paymentRequirementFor(newPartySize, startsAt, tz, settings). If the new requirement.kind differs from the existing payment row's kind/amount (look up via the same paymentForBooking pattern in payments.ts), set paymentChanged=true and return newReq so the caller (widget/self-service) can run the payment step. Do NOT auto-capture/auto-refund here — return paymentChanged and let the caller decide (self-service shows 'a deposit is now required' and routes to payment; admin handles manually). Releasing an obsolete hold when party drops below threshold is left to the caller calling releaseHold().
9. writeAudit(input.actor ?? 'staff', 'amend_booking', 'geisha_bookings', bookingId, before, after) including on_behalf_of via the F3-extended writeAudit signature. Best-effort fire-and-forget an amendment-confirmation email (reuse sendBookingConfirmation with a 'Your booking has been updated' note — coordinate exact copy with WP-S9-5/S1).
10. Export amendBooking + AmendBookingInput from src/lib/server/booking/index.ts barrel (alongside the existing createBooking/moveBooking exports) so admin/AI import from $lib/server/booking/index.js.
11. Define the AI tool spec (server fn is the run target; S2 registers it). Tool: { name:'amend_booking', kind:'write', confirm-gated, description:'Change an existing booking''s date, time, party size or requests. Re-checks table availability before applying. WRITE action — must be confirmed before it runs.', parameters:{ type:'object', properties:{ bookingId:{type:'string'}, date:dateStr-optional, time:{type:'string'}, partySize:{type:'integer'}, specialRequests:{type:'string'} }, required:['bookingId'] }, run: (args) => amendBooking({ ...args, actor:'ai' }) }. Provide this spec to S2 to drop into adminTools.ts WRITE section next to move_booking.
12. Add Vitest unit coverage in src/lib/server/booking/amend.test.ts (or alongside existing engine tests): amend that keeps same table; amend that re-allocates to a bigger join when party grows; amend blocked by no_availability; amend excludes self from occupancy (party-size-only change at same time must NOT report its own table as taken); amend that crosses the £10pp-6+ threshold returns paymentChanged=true.

**Files:** `src/lib/server/booking/amend.ts (new)`, `src/lib/server/booking/index.ts (add amendBooking + AmendBookingInput exports)`, `src/lib/server/booking/amend.test.ts (new)`

**Acceptance criteria:**

- amendBooking on a party-size change at the same time returns successfully and the booking keeps OR upgrades its tables without reporting its own current table as occupied (regression guard for the exclude-self logic).
- Growing a party past the largest single table re-allocates to a valid join; shrinking re-allocates to the smallest fitting single.
- Amending into a fully-booked window throws BookingError code 'no_availability' (HTTP 409 when surfaced); amending to a time outside any active period throws 'no_period'.
- After a successful amend, geisha_bookings.amended_from equals the original booking id and a geisha_audit_log row exists with action='amend_booking' and the correct actor (staff|ai|customer) + on_behalf_of.
- An amend that crosses the 6+ deposit threshold returns paymentChanged=true with payment.kind==='deposit'; an amend within the same band returns paymentChanged=false.
- Concurrent amend + create racing for the last table cannot both succeed (covered once F3's PB-backed lock is in place — assert single-winner under the lock).
- Vitest suite for amend.ts passes (npm run test / vitest).

**Parallelizable:** The pure re-validation logic, the index.ts export, and the Vitest tests can be built immediately against the F2 schema and a mocked PB. The ONLY hard serialization point is the F3 advisory-lock helper — until F3 lands, develop against the existing withLock signature behind a thin import so the swap is a one-line change. The AI tool spec is a self-contained artifact handed to S2 and can be written in parallel with the server fn.

**Risks:**

- The exclude-self filter is the classic amend bug: if the booking being amended isn't removed from getOccupyingBookings, a no-op or party-only amend self-blocks. Cover with an explicit test.
- Payment side-effects on amend are intentionally deferred to the caller — if a future caller forgets to releaseHold() when a party drops below the Fri/Sat band, a stale hold lingers. Document the returned paymentChanged contract clearly.
- Re-deriving local date/time from booking.starts_at must use the restaurant tz (Europe/London), not the server tz, or a Vercel UTC node shifts the slot. Reuse availability.ts's Intl pattern verbatim.
- amend_booking via AI must remain confirm-gated; if S2 mis-registers it as kind:'read' it would skip the HALT-for-confirm. The spec explicitly marks kind:'write'.

---

#### WP-S9-2 — Guest self-service amend/cancel via signed-token link (public /book/[token] route + stateless HMAC token verify)  `L`

**Goal:** A logged-out guest can open a signed link from their confirmation email and amend or cancel their own booking from a public, branded page — no account, no staff intervention — with the token cryptographically bound to the booking id and tamper-proof.

**Depends on:** `F2`, `WP-S9-1`

**Schema:** No migration here. Relies on F2's geisha_audit_log.on_behalf_of and amended_from. Reads existing geisha_bookings/geisha_customers/geisha_payments. Env: BOOKING_LINK_SECRET added to .env / Vercel (document in env, coordinate via env-sync skill).

**Server functions:**

- src/lib/server/booking/selfservice.ts: export function signBookingToken(bookingId: string): string
- src/lib/server/booking/selfservice.ts: export function verifyBookingToken(token: string): { bookingId: string } | null
- src/lib/server/booking/selfservice.ts: export async function getSelfServiceView(bookingId: string): Promise<SelfServiceView>
- src/lib/server/booking/selfservice.ts: export async function selfServiceCancel(bookingId: string): Promise<Booking>
- src/lib/server/booking/selfservice.ts: export async function selfServiceAmend(input: Omit<AmendBookingInput,'actor'|'bookingId'> & { bookingId: string }): Promise<{ booking: Booking; payment: PaymentRequirement; paymentChanged: boolean }>
- src/lib/server/booking/selfservice.ts: export function buildManagementUrl(bookingId: string, origin: string): string

**API / actions:**

- src/routes/book/[token]/+page.server.ts load(): -> { invalid:boolean } | { booking, customer(name/email masked as needed), restaurant, brand, payment, canAmend, canCancel, policyNote, availabilityBrand }
- ?/cancel form action: re-derives bookingId from params.token -> { cancelled:true } | fail(409,{message})
- ?/amend form action: body {date,time,partySize,specialRequests} -> { amended:true, booking } | { needsPayment:true, payment } | fail(409,{message})

**Components:**

- src/routes/book/[token]/+page.svelte — public self-service manager: booking summary, amend stepper (reuses BookingPanel stepper in amend mode), cancel-with-consequence confirm, invalid-link fallback. Brand-themed via data-brand + tokens.css.

**Implementation steps:**

1. Create src/lib/server/booking/selfservice.ts as the token authority (no client crypto). Export signBookingToken(bookingId: string): string and verifyBookingToken(token: string): { bookingId: string } | null. Token = base64url(`${bookingId}.${exp}`) + '.' + base64url(HMAC-SHA256(`${bookingId}.${exp}`, secret)) where secret = env.BOOKING_LINK_SECRET (fall back to a derived key off an existing private env if unset, with isConfigured()-style warning, mirroring dojo.ts/send.ts graceful patterns). Use Node's crypto.createHmac (server-only module, same posture as the rest of $lib/server). exp is a far-future or per-booking-end-based expiry (e.g. booking.ends_at + 90 days) so old links die.
2. verifyBookingToken: constant-time compare (crypto.timingSafeEqual) the recomputed HMAC; reject on mismatch or past exp; return null on any parse failure. Never throw raw — callers translate null to a friendly 'this link is no longer valid' screen.
3. Add export async function getSelfServiceView(bookingId): Promise<{ booking, customer, restaurant, payment, canAmend, canCancel, policyNote }>. canAmend/canCancel = status in (pending_payment, confirmed) AND starts_at in the future. policyNote uses isLateCancellation(starts_at, now): when late, surface the §6 forfeit/no-show-fee warning text built from the payment row (deposit forfeited / £Xpp no-show fee) so the guest sees consequences BEFORE cancelling.
4. Add export async function selfServiceCancel(bookingId): Promise<Booking> — thin wrapper that calls cancelBooking(bookingId, 'customer') (mutate.ts already takes actor; F3 threads on_behalf_of). Add export async function selfServiceAmend(input) that calls amendBooking({ ...input, actor:'customer' }) from WP-S9-1, surfacing BookingError to the caller.
5. Create src/routes/book/[token]/+page.server.ts. load(): verifyBookingToken(params.token); on null return { invalid: true } (page shows the expired-link screen). On valid, getSelfServiceView(bookingId) and return the view. This route lives OUTSIDE /admin so F1's hooks.server.ts admin gate does not apply — confirm in hooks that /book/** is unauthenticated.
6. Add form actions to +page.server.ts: actions.cancel (validates token again from the URL — never trust a client-sent bookingId; re-derive from params.token, call selfServiceCancel, return { cancelled:true }) and actions.amend (parse {date,time,partySize,specialRequests} via zod, re-derive bookingId from token, call selfServiceAmend; on BookingError return fail(409,{message}); on paymentChanged return { needsPayment:true, payment } so the page can surface the new deposit step). Use SvelteKit form actions (progressive enhancement) — actions are inherently safe against the multi-instance issue because they hit amend.ts which holds the F3 lock.
7. Create src/routes/book/[token]/+page.svelte. Public, brand-neutral page that themes off the booking's restaurant.brand by setting data-brand and reusing tokens.css (resolve Brand via getBrand(restaurant.brand) passed from the loader). Sections: (a) read-only booking summary (date/time/party, mirroring confirmations.ts detailsBlock styling); (b) an 'Amend' affordance that re-uses the WP-S9-3 stepper in amend-mode (prefilled date/party, fetches /api/availability for the booking's brand, posts to ?/amend); (c) a 'Cancel booking' button with the policyNote consequence text shown inline before a confirm; (d) the invalid-link screen with a CTA to call brand.phone.
8. Wire the management link into emails: export buildManagementUrl(bookingId, originUrl): string in selfservice.ts = `${origin}/book/${signBookingToken(bookingId)}`. WP-S9-5 passes this into the confirmation email template.
9. Rate-limit / abuse guard: verifyBookingToken's HMAC already prevents enumeration; additionally cap amend frequency by checking amended_from chains (reject if the booking has already been amended >N times in the last hour via a quick audit_log count) to stop a leaked link being used to thrash the floor. Keep it lightweight (a single getList count query).
10. Add zod schemas for the amend action body and a server-only guard that the booking's restaurant matches the brand the token implies (defence in depth — though token binds to bookingId only).

**Files:** `src/lib/server/booking/selfservice.ts (new)`, `src/routes/book/[token]/+page.server.ts (new)`, `src/routes/book/[token]/+page.svelte (new)`, `src/lib/server/booking/selfservice.test.ts (new — token round-trip + tamper rejection)`

**Acceptance criteria:**

- signBookingToken -> verifyBookingToken round-trips to the same bookingId; flipping any single character of the token (id, exp, or signature) makes verify return null.
- A token whose exp is in the past returns null; the page renders the invalid-link screen with the brand phone CTA, not a stack trace.
- Opening a valid link shows the correct date/time/party for that booking and nothing about any other booking; the customer cannot reach a different booking by editing the URL.
- Cancelling via the link sets status='cancelled', writes a geisha_audit_log row with actor='customer', and (for a late cancel) the policyNote shown beforehand matched the actual §6 outcome.
- Amending via the link routes through amendBooking with actor='customer', respects the online party cap (party 9+ via the link is rejected with a 'please call' message), and on a deposit-band crossing surfaces needsPayment with the new amount.
- /book/[token] is reachable while logged out (F1 admin gate does not block it); the same route never exposes any admin-only field.
- selfservice.test.ts passes.

**Parallelizable:** Three independent build fronts: (a) selfservice.ts token crypto + tests (zero deps beyond Node crypto, buildable day one); (b) the +page.svelte UI (can mock the loader data while the server fn settles); (c) the form-action wiring. The amend action depends on WP-S9-1's amendBooking; until it lands, stub selfServiceAmend to call the existing createBooking-less path or throw, and swap. The page can be built before WP-S9-3's stepper by inlining a minimal amend form, then refactored to share the stepper.

**Risks:**

- Secret management: if BOOKING_LINK_SECRET differs between Vercel instances or rotates, all outstanding links break. Pin one secret, document rotation = links regenerate on next email. Graceful no-key fallback must NOT silently use a weak constant in production — gate behind a console.error and treat verify as always-null when truly unset to avoid an insecure-but-working state.
- Token in email = bearer credential; anyone with the link can cancel/amend. This matches industry norm (OpenTable/ResDiary do the same) but the cancel-consequence screen + amend rate cap are the mitigations. Do not include the token in any analytics/referrer leak (use rel=noreferrer on outbound links from the page).
- Public form actions are an unauthenticated write surface — must re-derive bookingId from the token server-side every time and never trust a hidden form field, or it becomes an IDOR.
- Self-service amend hitting a full floor returns 409; the UI must degrade to 'this time is no longer available, here are alternatives' rather than a dead-end — reuse the availability fetch.

---

#### WP-S9-3 — Booking widget polish: 5-step stepper (date -> party -> slot -> details -> payment) + Dojo card step + waitlist fallback hook into S3  `XL`

**Goal:** Re-architect the shared BookingPanel.svelte from its current 4-phase ad-hoc form into a polished, brand-themed 5-step stepper with a real Dojo payment-collection step for deposit/no-show bookings and a waitlist-capture fallback when a date is fully booked, so the public booking flow is complete end-to-end on both brands.

**Depends on:** `F2`, `WP-S9-1`

**Schema:** No new migration. Reads geisha_service_periods (period labels), geisha_settings (policy values, booking_window_days), writes geisha_waitlist via S3's joinWaitlist (S3 owns that schema from F2). booking source 'ai'/waitlist_origin fields (F2) are written by S3, not here.

**Server functions:**

- src/lib/server/payments/dojo.ts: export async function createPaymentSession(intentId: string): Promise<{ clientSecret?: string; redirectUrl?: string; configured: boolean }> (wraps existing intent for hosted card collection; stub when !isConfigured())
- Consumes S3 seam: import { joinWaitlist } from '$lib/server/booking/waitlist.js' — S9 does NOT implement joinWaitlist (S3 owns geisha_waitlist write).
- Extend getAvailability return (index.ts) OR the /api/availability handler to include booking_window_days and per-slot period label (additive).

**API / actions:**

- POST /api/bookings/[id]/payment-session -> { clientSecret?|redirectUrl?, configured } (guarded by status nonce from the create response)
- GET /api/bookings/[id]/status?nonce=... -> { status: BookingStatus, paymentStatus: PaymentStatus } (no PII)
- POST /api/bookings/waitlist body { brand, date, partySize, windowFrom, windowTo, customer:{name,email,phone?,marketingConsent?} } -> { waitlistId } (delegates to S3 joinWaitlist)
- GET /api/availability (extended) -> adds bookingWindowDays:number and slots[].period?:string to the existing { brand,date,partySize,requiresPhone,slots } payload (additive, back-compatible)
- POST /api/bookings (extended) -> 201 body adds statusNonce:string for the post-booking status poll

**Components:**

- src/lib/components/BookingPanel.svelte — the canonical 5-step stepper, now with: step indicator, split date/party steps, period-grouped slot grid, details step, Dojo payment step, waitlist empty-state CTA, and a mode:'create'|'amend' prop so WP-S9-2 reuses it.

**Implementation steps:**

1. Refactor src/lib/components/BookingPanel.svelte into an explicit stepper. Replace the current phase state ('search'|'slots'|'details'|'done') with a typed step machine: step = $state<'date'|'party'|'slot'|'details'|'payment'|'done'>('date'). Add a visible step indicator (1–5) using $derived for the active index. Keep ALL markup brand-neutral and themed only via existing tokens (--accent,--ink,--ink-soft,--ink-faint,--card,--line,--bg,--font-serif,--font-sans) — it renders inside both [data-brand='asia'] and [data-brand='fusion'] pages, so no hardcoded hex.
2. Step 1 date + Step 2 party: split the current combined row into two steps for a cleaner mobile flow (the codebase already has mobile-landing concerns per memory). Enforce min=today and max = today + booking_window_days (fetch booking_window_days alongside availability or expose it via /api/availability response — add it to the availability endpoint payload). Party stepper with +/- and the online cap surfaced from the response's requiresPhone rather than a hardcoded >8.
3. Step 3 slot: keep the GET /api/availability fetch (unchanged endpoint), render availableSlots as the existing slotgrid but grouped by service period name (Lunch/Dinner/Sunday) using period info — extend /api/availability to optionally return each slot's period label, OR group client-side by querying WP-S9-4's hours endpoint. Show an empty-state that offers the WAITLIST (see step 6) instead of just 'call us'.
4. Step 4 details: same fields (name/email/phone/occasion/specialRequests/consent) but as its own step; client-validate email/required before enabling Continue.
5. Step 5 payment: NEW. After POST /api/bookings returns { booking, payment, paymentConfigured }, branch: if payment.kind==='none' -> go straight to 'done' (current behaviour). If payment.kind is 'deposit' or 'noshow_hold' AND paymentConfigured -> render a Dojo card-collection step. Integrate Dojo's hosted card flow: add a new endpoint POST /api/bookings/[id]/payment-session that calls the dojo.ts layer to return the client token/redirect for the existing intent (extend src/lib/server/payments/dojo.ts with a getPaymentSession/createCheckoutSession helper if Dojo's API needs it — wraps the already-created intent from startPaymentForBooking). The booking stays pending_payment until the Dojo webhook (existing /api/webhooks/dojo) flips it to confirmed. The widget polls GET /api/bookings/[id]/status (new lightweight read) or shows 'complete payment in the secure window, then this page updates' and reflects confirmed-on-return.
6. Add the payment-status read: src/routes/api/bookings/[id]/status/+server.ts GET returns { status, paymentStatus } for a booking id (public-safe: only status enums, no PII) so the widget can confirm the webhook landed. Guard against enumeration by requiring the same signed token OR a short-lived booking-scoped nonce returned from POST /api/bookings.
7. If paymentConfigured===false (Dojo keys not yet set), keep today's graceful copy: 'A secure payment step will follow' and treat the booking as provisionally placed — do NOT block the flow (matches the existing stub posture in create.ts/dojo.ts).
8. Waitlist fallback (S3 seam): when step 3 shows zero available slots for the chosen date/party, render a 'Join the waitlist' CTA. On submit, POST to a NEW endpoint POST /api/bookings/waitlist with { brand, date, partySize, windowFrom, windowTo, customer } that calls a function S3 owns (e.g. joinWaitlist() writing geisha_waitlist). S9 ONLY defines and calls this seam: import { joinWaitlist } from '$lib/server/booking/waitlist.js' (the file S3 creates). If S3 isn't ready, feature-flag the CTA off behind a settings check. On the created booking later (via S3's pacing release), source/waitlist_origin is set by S3, not S9.
9. Self-service reuse: extract the stepper steps (slot grid, details form, payment) into a mode prop on BookingPanel — mode: 'create' | 'amend'. In 'amend' mode (used by WP-S9-2's /book/[token] page) the details step is skipped (customer already known), the slot step posts to the amend action instead of /api/bookings, and the payment step only appears when paymentChanged. This keeps ONE stepper component shared between fresh bookings and self-service amends.
10. Update the Good-to-know policy aside to read deposit/no-show copy from the live values (online_party_max, deposit_per_person_6plus_pence, noshow_fee_per_person_fri_sat_pence) instead of the hardcoded £5/£10/8 strings — pass them down from the page loader or the availability response so the copy never drifts from the engine.
11. Confirm both mount sites still pass {brand}: src/routes/asia/bookings/+page.svelte and src/routes/fusion/bookings/+page.svelte already render <BookingPanel {brand} /> — verify no prop changes break them; if mode defaults to 'create', they need no edit.

**Files:** `src/lib/components/BookingPanel.svelte (major refactor — stepper, payment step, waitlist CTA, amend mode)`, `src/routes/api/bookings/[id]/payment-session/+server.ts (new — POST, returns Dojo client session for the intent)`, `src/routes/api/bookings/[id]/status/+server.ts (new — GET, token/nonce-guarded status read)`, `src/routes/api/bookings/waitlist/+server.ts (new — POST, calls S3 joinWaitlist seam)`, `src/routes/api/availability/+server.ts (extend response with booking_window_days + per-slot period label)`, `src/lib/server/payments/dojo.ts (add getPaymentSession/checkout-session helper if required by Dojo hosted flow)`, `src/routes/api/bookings/+server.ts (return a short-lived status nonce in the 201 response for the status poll)`

**Acceptance criteria:**

- On both /asia/bookings and /fusion/bookings the stepper advances date->party->slot->details->payment->done, themed correctly per brand with no hardcoded colours (visual check + grep for hex in BookingPanel returns none).
- A party of 2 on a quiet weekday (payment.kind==='none') completes straight to 'done' with no payment step, exactly as today.
- A party of 6 (deposit band) reaches the payment step; with Dojo unconfigured it shows the graceful 'secure payment will follow' copy and still records the pending_payment booking; with Dojo configured it opens the card session and, on webhook confirmation, the status poll flips the page to confirmed.
- A fully-booked date shows the 'Join the waitlist' CTA; submitting it calls POST /api/bookings/waitlist and (when S3 is live) creates a geisha_waitlist row; when S3 is not yet deployed the CTA is hidden behind the feature flag and the old 'call us' copy shows.
- The policy aside reflects the live settings values (change deposit_per_person_6plus_pence in settings -> the displayed £-per-person updates).
- BookingPanel in mode='amend' (driven from /book/[token]) skips the details step and posts to the amend action; mode='create' is the default so the two brand pages need no prop change.
- GET /api/bookings/[id]/status rejects requests without a valid nonce/token (cannot enumerate bookings).

**Parallelizable:** Strongly fan-out-able: (1) the stepper state machine + step UI is pure front-end and can be built against mocked fetch responses immediately; (2) the Dojo payment-session endpoint + dojo.ts helper is back-end-only and independent of the UI; (3) the status-poll endpoint is a tiny independent read; (4) the /api/availability extension is additive and independent; (5) the waitlist endpoint is just the S3 seam wiring. Within the UI, the date/party/slot steps and the details/payment steps can be built by two people. The ONLY ordering constraint is amend-mode depends on WP-S9-1.

**Risks:**

- Dojo hosted card flow: the exact API for turning an existing payment-intent into a collectable session must be confirmed against Dojo docs (docs.dojo.tech) — the codebase only creates intents, never collects a card. If Dojo requires a Setup Intent or a hosted-checkout redirect, the payment-session helper shape changes. Build it behind the configured/stub fallback so the rest ships regardless.
- Multi-instance: the status poll relies on the webhook (existing /api/webhooks/dojo) having flipped status — but verifySignature() ALWAYS returns true today (known security hole, owned by the payments stream). Do not block go-live on that, but note the dependency: the public payment step must not be exposed until the webhook signature is real.
- Refactoring a shared component used by two live brand pages risks regressions; keep the create-mode default behaviour byte-for-byte equivalent and add the stepper around it incrementally. Snapshot-test or screenshot both brands.
- The waitlist seam couples to S3's exact joinWaitlist signature; agree the contract (params + return) with S3 up front so the import doesn't churn.
- Adding statusNonce to POST /api/bookings is a public-API change — keep it additive so any other consumer (the AI 'point them to booking page' flow) is unaffected.

---

#### WP-S9-4 — Public opening-hours / service-period display from geisha_service_periods (live bookable windows, not static brand.hours copy)  `M`

**Goal:** Replace the marketing-copy opening hours (hardcoded in src/lib/data/brand.ts) on the booking and contact surfaces with a component that renders the ACTUAL bookable service periods from geisha_service_periods, so what the public sees matches what the engine will actually book — including last-booking times and per-day periods.

**Depends on:** `F2`

**Schema:** No migration. Reads geisha_service_periods (existing collection) for the active=true rows. No new fields needed (name/days_of_week/start_time/end_time/last_booking_time/default_turn_minutes/active already exist per types.ts).

**Server functions:**

- src/lib/server/booking/hours.ts: export async function getPublicHours(brand: BrandId): Promise<PublicHours>
- export interface PublicHours { byDay: { dow: number; dayName: string; periods: { name: string; open: string; close: string; lastBooking: string }[] }[]; note?: string }
- Reuses getActivePeriods (queries.ts) + getRestaurant (queries.ts).

**API / actions:**

- GET /api/hours?brand=asia|fusion -> PublicHours (Cache-Control public max-age=300). Validates brand via the same z.enum(['asia','fusion']) pattern as /api/availability.

**Components:**

- src/lib/components/ServiceHours.svelte — renders live per-day service periods with last-booking times, collapses identical consecutive days into ranges, falls back to brand.hours when no live periods. Brand-neutral, tokens.css only.

**Implementation steps:**

1. Add a public read endpoint GET /api/hours?brand=asia|fusion that returns the brand's active service periods shaped for display: src/routes/api/hours/+server.ts. It calls a new server fn getPublicHours(brand) that wraps getActivePeriods(restaurant.id) (queries.ts) and maps ServicePeriod rows into a per-day structure: for each day_of_week 0..6 list the periods active that day with name, start_time, end_time, last_booking_time. Public-safe (no internal ids beyond what's needed).
2. Create src/lib/server/booking/hours.ts (or extend index.ts): export async function getPublicHours(brand: BrandId): Promise<PublicHours> where PublicHours = { byDay: { dow:number; dayName:string; periods:{ name:string; open:string; close:string; lastBooking:string }[] }[]; note?:string }. Derive dayName via a fixed Mon..Sun array (display order Mon-first to match brand.ts). note can carry the brand.hoursNote fallback.
3. Create src/lib/components/ServiceHours.svelte (new shared, brand-neutral). Props: { brand: Brand; hours?: PublicHours }. If hours is provided (from a loader) render the live periods grouped by day, collapsing consecutive identical days into ranges (e.g. 'Mon–Thu 12:00–22:00, last booking 21:00'). If hours is absent/empty (pre-migration or fetch fail) FALL BACK to brand.hours from src/lib/data/brand.ts so the page never shows blank — exactly the graceful-degradation posture getFloors() uses.
4. Render the last-booking time prominently (the public currently has no idea bookings close before the kitchen does — this is a real Fusion fact: 'Sunday last bookings 6pm'). Show 'last online booking HH:mm' per period so the widget's empty late slots are explained.
5. Mount ServiceHours.svelte in the BookingPanel policy aside (replacing or augmenting the static 'Good to know') and on the contact page (src/routes/asia/contact, src/routes/fusion/contact — verify the ContactPanel.svelte component and inject there). Provide the data via the existing +page.server.ts loaders (asia/contact, fusion/contact, asia/bookings, fusion/bookings) calling getPublicHours, OR client-fetch /api/hours on mount with the brand.hours fallback while loading.
6. Keep brand.hours / brand.hoursNote in brand.ts as the canonical FALLBACK and for SEO/marketing prose; the live periods are the source of truth for bookable windows. Document in the component which wins (live periods override; brand.hours only when periods absent).
7. Add a small caching consideration: /api/hours can be cached (Cache-Control: public, max-age=300) since periods change rarely — keeps the gentle droplet load down.

**Files:** `src/lib/server/booking/hours.ts (new) OR add getPublicHours to index.ts`, `src/routes/api/hours/+server.ts (new — GET)`, `src/lib/components/ServiceHours.svelte (new — shared, brand-neutral)`, `src/routes/asia/bookings/+page.server.ts (new/extend — load getPublicHours)`, `src/routes/fusion/bookings/+page.server.ts (new/extend — load getPublicHours)`, `src/routes/asia/contact/+page.svelte + fusion equivalent (mount ServiceHours)`, `src/lib/components/BookingPanel.svelte (mount ServiceHours in policy aside — coordinate with WP-S9-3 refactor)`

**Acceptance criteria:**

- GET /api/hours?brand=fusion returns the active geisha_service_periods grouped by day; deactivating a period (active=false) removes it from the response.
- ServiceHours.svelte shows the last-booking time per period (e.g. Fusion Sunday 'last booking 18:00') distinct from the kitchen close time.
- When geisha_service_periods is empty or the fetch fails, the component renders brand.hours from brand.ts with no blank/error state (graceful fallback verified by temporarily pointing at an empty brand).
- The component is mounted on both brands' booking and contact pages and themes correctly under [data-brand='asia'] and [data-brand='fusion'] with no hardcoded colours.
- Consecutive identical days collapse into a range (e.g. 'Mon–Thu' rather than four identical rows).

**Parallelizable:** Fully independent of the other WPs (only needs F2/existing schema). Three parallel pieces: getPublicHours server fn + endpoint (back-end), ServiceHours.svelte (front-end, mockable), and the per-page mount/loader wiring. Can be the first WP delivered in the stream since it has the shallowest dependency graph.

**Risks:**

- day_of_week is 0=Sun..6=Sat in the schema but brand.hours is Mon-first — the dayName mapping and the Mon-first display order must be deliberate or Sunday lands in the wrong place.
- Overlapping periods on the same day (e.g. an all-day Lunch + Dinner) must merge sensibly in the range-collapse logic, not double-render. Test with multi-period days.
- Coordinating the BookingPanel policy-aside mount with WP-S9-3's simultaneous refactor of the same file — sequence so one lands first, or agree the insertion point to avoid a merge collision (this WP and WP-S9-3 both touch BookingPanel.svelte).

---

#### WP-S9-5 — Confirmation/management-link surface in the post-booking screen + emails (coordinate with S1 templates)  `M`

**Goal:** Close the self-service loop end-to-end: the post-booking 'done' screen and the confirmation/amendment/cancellation emails all carry the signed management link from WP-S9-2, so every guest receives a one-click way to amend or cancel — replacing today's 'reply to this email or give us a call' dead-end.

**Depends on:** `WP-S9-2`, `WP-S9-3`

**Schema:** No migration. If S1 routes emails through geisha_messages (F2), S9 only supplies the manageUrl template variable; the geisha_messages write is S1's. Env: PUBLIC_SITE_URL documented for absolute link generation.

**Server functions:**

- src/lib/server/util/origin.ts: export function getPublicOrigin(requestUrl?: URL): string
- Extends src/lib/server/email/confirmations.ts: sendBookingConfirmation(booking, customer, restaurant, paymentNote?, manageUrl?) and sendCancellation(booking, customer, restaurant, manageUrl?)
- Consumes buildManagementUrl from selfservice.ts (WP-S9-2).

**API / actions:**

- POST /api/bookings (extend 201) -> add manageUrl:string (and statusNonce from WP-S9-3) to the existing { booking, payment, paymentConfigured } body.

**Components:**

- src/lib/components/BookingPanel.svelte (done step only) — Manage-booking link + add-to-calendar ICS download. Coordinated with WP-S9-3 which owns the broader refactor.

**Implementation steps:**

1. Thread the management link into emails. In src/lib/server/email/confirmations.ts, extend sendBookingConfirmation to accept an optional manageUrl (built via buildManagementUrl(booking.id, origin) from selfservice.ts) and render a prominent 'Manage your booking' button in the email shell() body — replacing the static 'Need to change or cancel? Just reply to this email or give us a call.' line with a real link plus the call fallback. Do the same for sendCancellation (link can confirm/rebook). Coordinate with S1: if S1 introduces a templated geisha_messages-backed sender, S9 supplies the manageUrl variable and the button partial; S1 owns the template registry.
2. Resolve the origin server-side: callers of sendBookingConfirmation (create.ts, the dojo webhook, amend.ts) must pass the public origin. Add a getPublicOrigin() helper (read from env PUBLIC_SITE_URL or derive from the request URL where available) so the link is absolute and correct per environment. create.ts/webhook run without a request in some paths (cron, webhook) — use the env-configured origin there.
3. Wire the link generation: in create.ts after a booking is confirmed (the input.staff branch, the payment.kind==='none' branch) and in the dojo webhook confirm branch, build manageUrl = buildManagementUrl(booking.id, origin) and pass it to sendBookingConfirmation. In amend.ts pass manageUrl on the amendment-confirmation email.
4. Post-booking 'done' screen (BookingPanel.svelte step 'done', from WP-S9-3): show the management link inline ('Manage your booking' button -> /book/[token]) so the guest can bookmark it immediately without waiting for the email. The POST /api/bookings response must therefore return the management URL (or the token) — extend the 201 payload with manageUrl:string (built server-side; reuse the statusNonce work in WP-S9-3 to keep one response shape). Same for the amend flow's response.
5. Add a 'add to calendar' affordance on the done screen (ICS data URL generated client-side from the booking date/time/restaurant — pure front-end, no server) as a moonshot-aligned polish, brand-neutral.
6. Ensure emails remain client-safe: the button is a plain <a> styled inline (matching the existing shell() inline-style approach in confirmations.ts), no external assets, accent colour from the existing ACCENT map keyed by brand.
7. Privacy: the management URL embeds a bearer token — confirm it is only ever sent to the booking's own customer.email and rendered on the post-booking screen of the session that created it. Never log the full URL in audit/console.
8. Update the policy/confirmation copy to mention the link explicitly ('You can change or cancel your booking any time using the link in your confirmation email').

**Files:** `src/lib/server/email/confirmations.ts (add manageUrl param + Manage-booking button to confirmation & cancellation templates)`, `src/lib/server/booking/create.ts (build + pass manageUrl to sendBookingConfirmation in confirmed branches)`, `src/lib/server/booking/amend.ts (pass manageUrl on amendment email — WP-S9-1 file)`, `src/routes/api/webhooks/dojo/+server.ts (build + pass manageUrl when confirming on payment)`, `src/routes/api/bookings/+server.ts (return manageUrl in the 201 response)`, `src/lib/components/BookingPanel.svelte (done step: show Manage-booking link + add-to-calendar)`, `src/lib/server/util/origin.ts (new — getPublicOrigin helper) `

**Acceptance criteria:**

- A completed booking email contains a working 'Manage your booking' link that opens /book/[token] for that exact booking (token verifies).
- The post-booking 'done' screen shows the same management link immediately, before the email arrives, sourced from the POST /api/bookings manageUrl field.
- Cancellation and amendment emails also carry an appropriate management/rebook link.
- The management URL never appears in console logs or geisha_audit_log before/after snapshots.
- Links are absolute and correct in production (built from PUBLIC_SITE_URL on cron/webhook paths and request origin on request paths).
- Add-to-calendar produces a valid ICS with the right local time (Europe/London) for both brands.
- With email unconfigured (no RESEND_API_KEY) the flow still completes and the done-screen link still works (graceful, matches send.ts isConfigured posture).

**Parallelizable:** The email-template button + getPublicOrigin helper are independent and buildable as soon as buildManagementUrl (WP-S9-2) exists. The done-screen UI piece depends on WP-S9-3's stepper. The 201-response extension is a tiny additive change. Email templating coordinates with S1 but the manageUrl variable can be supplied independently of S1's template registry landing.

**Risks:**

- Origin resolution on serverless: create.ts's confirmed-email path and the webhook have no incoming request to derive origin from — they MUST use env PUBLIC_SITE_URL or links break in production. Make getPublicOrigin fail loud (console.error) when neither source is available rather than emitting a relative/localhost link.
- Coupling to S1: if S1's templated sender lands mid-stream, the manageUrl param plumbing may need to move into S1's template variables. Agree the variable name (manageUrl) early so both streams reference the same key.
- Both this WP and WP-S9-3 edit BookingPanel.svelte 'done' step — sequence WP-S9-3 first (it owns the stepper structure) then add the link here, or do the link as part of WP-S9-3's done step to avoid a second pass.
- Bearer-token-in-email privacy is the same risk as WP-S9-2; the mitigation (send only to the booking's own email, never log) must be enforced at the email layer too.

---

## 5. Moonshot AI features (beyond industry standard)

The differentiator set. Each is honest about its AI approach — an LLM is used only where language/judgement is the right tool; quantitative work (risk scores, seating packing, forecasting, anomaly detection, money) is deterministic, with the LLM as planner/explainer. All writes stay confirm-gated and audited (`actor=ai`, `on_behalf_of=staff`).

**The three foundation bridges** (per the review, these map the moonshot graph onto the plan): `mf-foundation-auth` **= F1**, `mf-foundation-schema` **= F2** (+ the moonshot data-capture fields), `mf-foundation-tools` **= WP-S6-1 + WP-S6-2 + WP-S6-3** (the unified tool catalogue). Every `mf-*` below schedules as a **Wave 4** rider once its bridge nodes land.

### Quick-win vs long-haul

- **Quick wins (M, ride directly on foundation):** Voice Service Co-Pilot for the Floor · VIP & Guest-Memory Recognition (RAG over notes) · Predictive No-Show Risk Scoring · Risk-Driven Dynamic Deposit Suggestions · Allergy & Dietary Intelligence · Natural-Language Reporting · Always-On Nightly AI Manager Briefing · Smart Waitlist & Auto-Notify · Automated No-Show Fee Capture & Fair-Refund · Per-Booking Menu & Upsell Suggestions · Operational Anomaly Alerts
- **Long-haul (L/XL):** Autonomous Evening-Plan Co-Pilot (XL) · AI Seating / Cover-Packing Optimiser (L) · Autonomous Personalised Guest Comms Engine (L) · AI-Assisted Floor-Plan Drawing (L) · Demand Forecasting & Smart Slot Pacing (L) · Review Ingestion, Sentiment & Reply Drafting (L)

### Autonomous Evening-Plan Co-Pilot  `XL` · _industry-first_

**Pitch:** One button: the AI reviews tonight's whole book and proposes a complete plan — seating, pacing, VIP touches, risk holds, comms — for you to approve in seconds.

**How it works:** The capstone that orchestrates the others. A read tool propose_evening_plan(date) runs runAgent with access to mf-seating-optimiser (propose_seating_plan), mf-noshow-risk, mf-demand-forecast, mf-vip-rag, mf-allergy-aware and mf-guest-comms. The agent assembles ONE structured plan: recommended seating diff, which risky bookings to request a hold from, pacing adjustments, VIP/allergy notes for the run-sheet, and draft pre-visit messages. The plan is rendered as a checklist of discrete, individually-confirmable actions — each item maps to an existing confirm-gated write (moveBooking, request_deposit, comms send). Nothing executes until the human ticks and confirms each (or 'approve all' which still fires each write through its own audit).

**Data needed:** Composes existing features + tools; no new schema beyond what they add. Requires the full adminTools.ts catalogue, RBAC, and the confirm-endpoint hardening to be in place before any writes are enabled.

**AI approach:** Hybrid orchestration: the LLM SEQUENCES and NARRATES the plan, but every quantitative sub-decision (seating, risk, pacing) comes from the deterministic engines — the LLM is a planner/explainer, not the calculator. This is the honest division of labour the brief demands.

**Surface:** A prominent 'Plan tonight' button on /admin dashboard + floor, opening a reviewable action-checklist in the assistant dock.

**Depends on:** `mf-foundation-auth`, `mf-foundation-tools`, `mf-seating-optimiser`, `mf-noshow-risk`, `mf-demand-forecast`, `mf-vip-rag`, `mf-guest-comms`

**Guardrails:** STRICTLY proposal-only: every action is a separate confirm-gated write through geminiAgent's existing write-halt invariant; 'approve all' still executes each via its own audited write, never a bulk silent commit. Hard-blocked until Phase A lands (auth on /api/admin-chat, per-tool input re-validation, the exploitable confirm endpoint closed). RBAC: only owner/manager can run/approve. Seated parties pinned; money actions need explicit per-item confirm. Full geisha_audit_log trail (actor='ai', on_behalf_of=staff id).

---

### AI Seating / Cover-Packing Optimiser  `L` · _very-high_

**Pitch:** One click lays out tonight's whole book onto the best tables — packing more covers in, honouring window/VIP preferences, and keeping joins free for the big parties.

**How it works:** A new pure engine src/lib/server/booking/optimise.ts reuses availability.ts primitives (allocateTables, overlap, joins) but solves the WHOLE day at once instead of one slot: given getBookingsForDay + getTables + getJoins, it runs a constraint solver (greedy + local-search / simulated-annealing, all pure & testable) that assigns every booking to tables minimising wasted seats and join fragmentation while honouring soft preferences (section from special_requests/occasion, VIP from notes). It returns a proposed assignment as a diff vs current table allocations. Staff review the diff; applying it calls moveBooking per changed booking (confirm-gated, actor='ai'). Exposed as read tool propose_seating_plan(date) + the resulting moves are individually confirmable writes.

**Data needed:** All exists: geisha_bookings.tables, geisha_tables (seats_min/max, section, bookable), geisha_table_joins. Preference extraction is best from STRUCTURED dietary/section/VIP fields (Phase E CRM gap) but degrades to parsing special_requests/notes text. No new schema strictly required; a structured preferences field improves accuracy.

**AI approach:** Hybrid leaning heuristic: the optimisation is a deterministic combinatorial solver (NOT an LLM — an LLM cannot reliably pack tables). An LLM is used ONLY to translate fuzzy notes/requests ('likes the window', 'wheelchair') into the solver's soft-constraint weights, and to narrate the plan ('moved the Patel 6 to T4+T5 to keep the window pair free for the 8pm anniversary').

**Surface:** /admin/floor + /admin/diary: a 'Optimise tonight' button that opens a before/after overlay on the floor plan; each move is a confirm card. Also via the assistant dock.

**Depends on:** `mf-foundation-schema`

**Guardrails:** Pure-engine output is a PROPOSAL only; each reassignment is a separate confirm-gated moveBooking write (never bulk-applied silently). Seated parties (floor_state without cleared_at) are pinned and never moved. Re-validates table-fit before each write so it can't double-book.

---

### Autonomous Personalised Guest Comms Engine  `L` · _very-high_

**Pitch:** Every confirmation, reminder and win-back is warm, on-brand and personal — drafted by AI, sent automatically, never robotic.

**How it works:** A comms engine src/lib/server/comms/ wraps the existing Resend send.ts. A nightly + hourly CRON_SECRET job (/api/cron/comms) selects bookings needing a touch (T-24h reminder, post-visit thank-you for completed, win-back for lapsed customers, birthday/occasion). For each, runAgent() drafts a personalised message using the guest's history (getCustomerHistory), occasion field, notes, and allergy flags, returning text that's slotted into the existing brand-tinted shell() template. Messages are queued to a new geisha_comms collection with status draft|approved|sent; an owner setting chooses auto-send vs review-first. Reminders directly attack the no-show gap the roadmap flags as a 'core no-show reducer'.

**Data needed:** Resend keys (Phase A). Booking/customer data exists. MUST add: geisha_comms collection (booking, customer, kind, channel, status, subject, body, scheduled_for, sent_at) so sends are idempotent and auditable; an occasion is already on the booking; birthdays would need a new customer field if wanted.

**AI approach:** LLM (runAgent text-only, no tools) for DRAFTING copy — genuinely the right job for an LLM. Selection of WHO to message is a SQL/stats query, not the LLM. Hybrid: query picks recipients, LLM personalises each.

**Surface:** New /admin/comms outbox (queue with approve/edit/send), per-booking 'message guest' action, and the assistant can draft on demand.

**Depends on:** `mf-foundation-schema`

**Guardrails:** Default is review-first (drafts queued, staff approve) until the owner explicitly enables auto-send per comms kind. Marketing-type messages respect customer.marketing_consent (GDPR). Allergy text is drafted as a reminder to confirm, never as medical advice. Every send writes geisha_audit_log (actor='ai'). Idempotency via geisha_comms prevents double-sends across Vercel instances.

---

### Voice Service Co-Pilot for the Floor  `M` · _very-high_

**Pitch:** Hands-free during service: 'Who's finishing soon?' / 'Seat the Khan party of 4 on table 7' — spoken, confirmed, done.

**How it works:** Builds on the roadmap's Voice V1 (Web Speech API, client-only). A floor.ts wrapper does STT into the same draft/send() path that hits /api/admin-chat with the full adminTools.ts catalogue; TTS reads back the answer. Adds a 'finishing soon' read tool get_finishing_tables(date) computed from getFloorPlan states (seated past ~80% of turn) so the co-pilot can proactively announce 'table 7 is finishing, you have a party of 4 waiting'. Writes (seat_walkin, seat_booking, clear_table, move_booking) remain confirm-gated; the co-pilot reads back a summary and waits for a spoken/tapped 'confirm'.

**Data needed:** All exists once adminTools.ts grows to the full catalogue (Phase D). getFloorPlan already computes states; a 'finishing' state is a P2 item to add. No new schema. Needs HTTPS mic (Vercel domain is fine).

**AI approach:** Hybrid: STT/TTS are browser-native (zero-cost, no model). The reasoning is the existing LLM tool-loop (runAgent). The 'finishing' detection is a pure timing calc, not an LLM.

**Surface:** A mic button on /admin/floor and the assistant dock; spoken announcements during service.

**Depends on:** `mf-foundation-tools`, `mf-foundation-auth`

**Guardrails:** MANDATORY confirm-gating preserved — voice NEVER auto-executes a write; TTS reads the proposed action and requires explicit confirm. Mic feature-detected and hidden where unsupported; degrades silently to text. RBAC: only host/manager/owner roles get write tools.

---

### VIP & Guest-Memory Recognition (RAG over notes)  `M` · _very-high_

**Pitch:** The moment a regular books, staff see 'celebrated her 40th here in March, loves the corner banquette, allergic to shellfish' — without anyone remembering manually.

**How it works:** geisha_customers.notes is already 'AI/RAG reads this' per the type. Build a retrieval layer src/lib/server/ai/rag/guestMemory.ts: on booking, gather that customer's notes + past bookings (occasion, special_requests, completed visits, spend from geisha_payments) and produce a concise 'guest card'. For scale, embed notes into a geisha_customer_embeddings store (or a notes_summary cache) so lookups are instant. A read tool recognise_guest(customerId) returns the card; it auto-attaches to booking detail and the run-sheet. Drives VIP weighting in mf-seating-optimiser and personalisation in mf-guest-comms.

**Data needed:** notes + history exist. For true RAG MUST add a geisha_customer_embeddings collection (vector json) OR, simpler at two-restaurant scale, a cached notes_summary field refreshed on note edit. Structured VIP/tag fields (Phase E CRM gap) make the card sharper.

**AI approach:** Hybrid RAG: embeddings + retrieval for scale, LLM to synthesise the guest card from retrieved notes/history. At two-restaurant volume a plain summary-on-write (LLM, no vector store) is often sufficient — be honest: full vector RAG is over-engineering until note volume is large, so ship summary-cache first, embeddings later.

**Surface:** Booking detail header, run-sheet, host stand on arrival, and the seating optimiser/comms engine internally.

**Depends on:** `mf-foundation-schema`, `mf-foundation-tools`

**Guardrails:** Per-brand customer scoping must land first (roadmap flags customers are currently GLOBAL — a privacy leak across the two restaurants). Cards summarise only stored staff notes/history, never speculate. RBAC-gate who can see sensitive notes. GDPR: notes are personal data, included in export/erasure.

---

### AI-Assisted Floor-Plan Drawing  `L` · _very-high_

**Pitch:** Describe your room — '14 tables, a bar along the back wall, two pillars, a window run of four 2-tops' — and watch the floor plan draw itself.

**How it works:** In /admin/floor-editor, a 'Describe my room' prompt sends the text to runAgent with write tools that wrap the existing persistence fns: create_table/update_table, manage_floor (createFloor/updateFloor), set_shapes (the only persistence path for walls/zones/pillars), save_layout, and join_tables. The LLM converts the description into a sequence of geometry writes (x/y/width_cm/height_cm/rotation in the floor's cm scale via px_per_cm). The user reviews the generated layout on the canvas before committing (each batch confirm-gated). Also fixes the roadmap's audit gap by routing these through actor-aware writeAudit.

**Data needed:** All geometry fns exist (createTable, setShapes, saveLayout, createFloor). MUST first wire set_shapes/save_layout/manage_floor as adminTools (roadmap Phase D 'NEW') and add audit to saveLayout/setShapes/setJoins (currently none). BUG-1 (shape deletes only persist on manual Save) should be fixed so AI-drawn shapes round-trip reliably.

**AI approach:** LLM tool-calling to translate NL→geometry (spatial layout from language is a genuine LLM task), but the actual coordinates are computed/clamped by deterministic helpers (geometry.ts normalizeBox/clamp/rotatedBounds) so the model can't place items off-canvas.

**Surface:** /admin/floor-editor — a prompt box + live preview of the generated plan with Apply/Discard.

**Depends on:** `mf-foundation-tools`, `mf-foundation-auth`

**Guardrails:** Generated layout is a PREVIEW; committing is confirm-gated and goes through clamped geometry helpers so nothing lands at negative/off-canvas coords (fixes BUG-5/6/7). delete_table is high-blast-radius — separate confirm + type-to-confirm. All writes audited as actor='ai'. Undo/redo (BUG-4) lets staff revert an AI draw in one step.

---

### Predictive No-Show Risk Scoring  `M` · _high_

**Pitch:** Know which of tonight's tables are likely to ghost you before they do, so you can protect revenue on a packed Saturday.

**How it works:** A new pure scorer src/lib/server/ai/risk/noShowScore.ts takes a booking + that customer's geisha_bookings history (via getCustomerHistory) + signals already on the row: lead-time (now vs created vs starts_at), party_size, source ('online'|'phone'|'walkin'), day-of-week/period, whether a deposit/hold exists (geisha_payments), prior no_show/cancel_late counts (from history statuses + geisha_audit_log actions), and historical attendance for that slot. It outputs a 0-100 score + top contributing factors. Runs two ways: (1) at create time inside createBooking (write the score to the booking — see dataNeeded) and recomputed by the existing CRON_SECRET-protected sweep pattern (new /api/cron/risk) each morning; (2) surfaced live in getBookingsForDay so the diary and getFloorPlan tiles can colour high-risk covers. A read tool get_noshow_risk(date) is added to adminTools.ts so the assistant can answer 'who's risky tonight?'.

**Data needed:** Signals exist (party_size, source, starts_at, created, status history, geisha_payments). MUST capture: a risk_score number + risk_factors json on geisha_bookings (new migration 1772700400) so the score is queryable/sortable without recompute; optionally a denormalised no_show_count/cancel_count on geisha_customers (Phase E CRM gap) to avoid re-aggregating history every score.

**AI approach:** Lightweight stats/heuristic, NOT an LLM. This is a weighted logistic-style score over structured signals — deterministic, explainable, instant, free. An LLM here would be slower, costlier and less accurate. The LLM only ever consumes the finished score (e.g. when drafting a deposit-request message or the nightly briefing).

**Surface:** Diary rows + live floor tiles (a small amber/red dot + tooltip of factors), a 'Risk' column sortable in /admin/diary, and answerable via the assistant dock.

**Depends on:** `mf-foundation-schema`

---

### Risk-Driven Dynamic Deposit Suggestions  `M` · _high_

**Pitch:** Automatically ask for a deposit or card-hold only from the bookings that actually need one — protecting covers without scaring off low-risk regulars.

**How it works:** Builds on the owner's configurable deposit-rules engine (replacing the hardcoded policy.ts £10pp-6+/£5pp-noshow). paymentRequirementFor() gains an optional risk input: when a rule says 'risk-tiered', the requirement is raised (e.g. add a hold) for bookings whose mf-noshow-risk score exceeds a configurable threshold, even if party_size<6. This stays a SUGGESTION surfaced to staff for phone bookings (confirm-gated) and is auto-applied only for online bookings per an explicit setting. A write tool request_deposit(bookingId) lets the assistant propose escalating a specific risky booking to a card-on-file hold via the existing Dojo Setup-Intent path (startPaymentForBooking).

**Data needed:** Needs the deposit-rules engine config (geisha_settings key 'deposit_rules' json — owner decision) and mf-noshow-risk's score. Dojo must be live (Phase A) for real holds; until then it records the requirement and emails the guest a pay link (no-op via isConfigured()).

**AI approach:** Heuristic/rules engine over the risk score — no LLM in the decision path. LLM optional only to draft the guest-facing 'we ask for a card to hold this table' message (reuses mf-guest-comms).

**Surface:** New-booking screen + booking detail (a 'suggested: take a £X hold — guest is high no-show risk' banner with a confirm button), and the assistant dock.

**Depends on:** `mf-foundation-schema`, `mf-noshow-risk`

**Guardrails:** Never auto-charges: holds are confirm-gated for staff bookings and only auto-applied online when an explicit setting is on. Card capture still requires the existing Dojo manual-capture + no-show flow. The risk threshold is owner-configurable so it can't silently over-charge regulars.

---

### Demand Forecasting & Smart Slot Pacing  `L` · _high_

**Pitch:** Stop the kitchen getting hammered by ten 8pm tables — the system predicts demand and paces bookings so service flows.

**How it works:** A pure forecaster src/lib/server/ai/forecast.ts learns per-(brand, day-of-week, period, slot) historical covers from geisha_bookings (excluding cancelled/no_show) and projects expected demand and a recommended covers-cap curve. This feeds the Phase-B 'covers cap / pacing throttle' the roadmap already calls for: checkAvailability gains an optional perSlotCoversCap input, and the forecaster supplies a suggested cap per slot. A nightly /api/cron/forecast (CRON_SECRET pattern) recomputes and stores the curve in geisha_settings (key 'pacing_curve'). Read tool get_demand_forecast(date) lets the assistant answer 'how busy will Friday be?'.

**Data needed:** Historical bookings exist in geisha_bookings (richer once the system has run a few weeks; cold-start falls back to a flat cap from a setting). MUST add: a covers-cap input to the availability engine (Phase B work) and a 'pacing_curve' setting row to store the learned curve.

**AI approach:** Simple stats (moving averages / seasonal-naive per slot), NOT an LLM. Forecasting tabular counts is a job for arithmetic, not a language model. LLM only narrates the forecast in the nightly briefing.

**Surface:** Availability widget (slots silently throttled when at cap), /admin/diary pacing bar per slot, and the manager nightly briefing.

**Depends on:** `mf-foundation-schema`

**Guardrails:** Caps are advisory defaults the owner can override per service; the forecaster never blocks a staff/phone booking (createBooking staff path bypasses online caps as today). Cold-start uses conservative flat caps to avoid choking bookings on thin data.

---

### Allergy & Dietary Intelligence  `M` · _high_

**Pitch:** No allergy ever slips through — the system reads free-text requests, flags them on the run-sheet, and warns the kitchen.

**How it works:** On booking create/amend, an extractor parses special_requests + customer.notes for allergens/dietary needs (nuts, shellfish, gluten, vegan, etc.) and writes a structured dietary_flags json onto the booking. The live floor tile (getFloorPlan) and a new run-sheet view show a clear allergy badge per cover. A read tool get_allergy_summary(date) feeds the kitchen pass and the nightly briefing. Severe allergens trigger an in-app alert on the booking.

**Data needed:** special_requests + notes exist as free text. MUST add: dietary_flags json on geisha_bookings and ideally structured dietary fields on geisha_customers (Phase E CRM gap explicitly lists this). The run-sheet view (Phase B 'run-sheet/allergen summary') is a new page.

**AI approach:** Hybrid: a fast keyword/regex pass catches the obvious 90% deterministically; an LLM extraction pass (runAgent, structured output) handles fuzzy phrasing ('my partner can't have anything with dairy'). Keyword layer means it still works with no AI key.

**Surface:** Run-sheet/kitchen view, live floor tile badges, booking detail, nightly briefing.

**Depends on:** `mf-foundation-schema`

**Guardrails:** Presented as 'flagged for staff to confirm with the guest', never authoritative — the UI states allergies must be verified in person. Extraction errs toward over-flagging (recall over precision). Never auto-suppresses a flag.

---

### Natural-Language Reporting  `M` · _high_

**Pitch:** Ask 'How did Saturdays do last month vs the month before?' in plain English and get the answer with a chart, no spreadsheet.

**How it works:** New read tools in adminTools.ts: get_covers_report(from,to,groupBy), get_noshow_report(from,to), get_revenue_report (from geisha_payments captured amounts). Each is a deterministic aggregation over geisha_bookings/geisha_payments — the roadmap already specs get_covers_report/get_noshow_report. The LLM's job is to map the natural-language question to the right tool+params, then narrate the returned numbers and optionally emit a UI directive to render a small chart in the dock.

**Data needed:** geisha_bookings + geisha_payments + geisha_audit_log exist. No new schema; just the new read tools + a tiny chart component for the dock's UI-directive surface.

**AI approach:** Hybrid: LLM for intent→tool-params + narration (its strength); the actual numbers come from SQL-style PocketBase aggregation (NOT the LLM — never let the model do the arithmetic on raw rows). This honours the brief's 'don't slap an LLM on something a query does better'.

**Surface:** Assistant dock + /admin/assistant expanded view; a 'Reports' quick-chip set.

**Depends on:** `mf-foundation-tools`

**Guardrails:** Numbers are always computed by the tool, never invented; the answer cites the tool result. Reporting tools are READ-only so they're safe to ship even before the confirm-endpoint hardening lands. Date ranges validated server-side.

---

### Review Ingestion, Sentiment & Reply Drafting  `L` · _high_

**Pitch:** Every Google/TripAdvisor review summarised, themed, and given a tailored draft reply you can post in one click.

**How it works:** A new geisha_reviews collection stores ingested reviews (source, rating, text, author, posted_at, linked customer if matchable by name/date). Ingestion is a CRON_SECRET job (/api/cron/reviews) pulling from available review feeds (or manual paste to start). An LLM pass classifies sentiment + extracts themes (service/food/ambience/value) and drafts an on-brand reply via runAgent. A read tool get_review_insights(range) rolls themes up for the nightly briefing; a write tool draft_review_reply(reviewId) is confirm-gated. Recurring negative themes feed mf-anomaly-alerts.

**Data needed:** Nothing today — MUST add geisha_reviews collection and an ingestion path (start with manual paste / CSV; automated feeds depend on each platform's API/availability). Customer linkage reuses geisha_customers.

**AI approach:** LLM for sentiment, theme extraction and reply drafting (clear LLM strength). Trend aggregation across reviews is a stats query. Hybrid.

**Surface:** New /admin/reviews page (inbox + theme dashboard), nightly briefing section, anomaly alerts.

**Depends on:** `mf-foundation-schema`

**Guardrails:** Replies are DRAFTS requiring staff approval before posting (and posting back to a platform is a separate, explicit integration). Never auto-publishes. Sentiment is advisory. Customer-linkage is fuzzy and shown as 'possible match', never auto-merged.

---

### Always-On Nightly AI Manager Briefing  `M` · _high_

**Pitch:** Every morning the manager gets one tight email: tonight's book, the risky covers, VIPs in, allergies, pacing, and what to watch.

**How it works:** A CRON_SECRET job /api/cron/briefing runs each morning per brand. It assembles a structured snapshot from existing fns — getDashboard, getBookingsForDay, mf-noshow-risk scores, mf-allergy-aware flags, mf-vip-rag recognitions, mf-demand-forecast pacing, mf-review-sentiment themes — then runAgent (text-only) writes a crisp brief that's emailed via Resend send.ts using the brand shell(). Also viewable in-app at /admin (a 'Tonight' card) and answerable in the dock.

**Data needed:** Composes data from other features; no new schema beyond a geisha_settings flag for recipients/send-time. Resend keys (Phase A) for email; in-app card works without email.

**AI approach:** Hybrid: every fact is computed by deterministic tools/queries; the LLM only writes the prose around the supplied numbers (summarisation — an LLM strength). Strict 'use only the provided data' system prompt to prevent fabrication.

**Surface:** Daily email to managers + a 'Tonight' briefing card on /admin dashboard.

**Depends on:** `mf-foundation-schema`, `mf-noshow-risk`, `mf-allergy-aware`

**Guardrails:** System prompt forbids inventing numbers (it's handed a structured payload and told to summarise only). Recipient list is an explicit owner setting. Read-only — the briefing proposes, it never acts. Send is idempotent (one per brand per day, recorded).

---

### Smart Waitlist & Auto-Notify  `M` · _high_

**Pitch:** Fully booked? Guests join a waitlist and get auto-pinged the instant a suitable table frees — you recover covers you'd have lost.

**How it works:** New geisha_waitlist collection (brand, customer, date, party_size, desired_time, flexibility_minutes, status). When a booking cancels/no-shows (cancelBooking/markNoShow) or the release sweep frees a table, a matcher re-runs checkAvailability and finds waitlist entries that now fit; it auto-drafts a notify via mf-guest-comms with a time-boxed claim link. The matcher runs in the mutation path AND in the existing release cron. A read tool get_waitlist(date) and write tool offer_waitlist_slot(entryId) (confirm-gated unless auto-notify enabled) expose it to the assistant.

**Data needed:** MUST add geisha_waitlist collection + a public widget entry point ('join the waitlist' when requiresPhone or no slots). Availability engine + cancel/release hooks already exist to trigger matching.

**AI approach:** Heuristic/engine, NOT an LLM: matching is checkAvailability + a fit/priority sort (earliest joined, party fit, flexibility). LLM only personalises the notify copy (via mf-guest-comms).

**Surface:** Public booking widget (join waitlist), /admin waitlist panel, auto-notify emails, assistant dock.

**Depends on:** `mf-foundation-schema`, `mf-guest-comms`

**Guardrails:** Auto-notify is opt-in per setting; otherwise offers are confirm-gated. Offered slots are soft-held with a claim timeout so the table isn't promised to many. Respects marketing_consent only for non-transactional nudges (a waitlist offer is transactional). Idempotent via geisha_waitlist status to avoid duplicate pings across instances.

---

### Automated No-Show Fee Capture & Fair-Refund  `M` · _high_

**Pitch:** No-show fees and late-cancel charges handled correctly and automatically — including refunding guests who cancelled in time, which the system gets wrong today.

**How it works:** Hardens the existing money path: markNoShow/cancelBooking already call chargeNoShow/releaseHold and isLateCancellation. This feature wires the dead refundDeposit path (roadmap: it's dead code), fixes the in-time-cancel refund, and adds an AI layer that explains/justifies each capture in plain English and drafts the guest notification (why they were charged) via mf-guest-comms. A read tool get_payment_status(bookingId) and confirm-gated write tools capture_noshow_fee / refund_deposit / release_hold expose it. The release cron triggers fee capture on auto-no-show.

**Data needed:** geisha_payments + policy.isLateCancellation exist. Needs Dojo LIVE keys (Phase A) and the webhook HMAC fix (Phase A hard blocker — currently verifySignature returns true always). No new schema; refundDeposit just needs implementing.

**AI approach:** NO LLM in the money decision — capture/refund is pure policy logic and Dojo API calls. LLM only drafts the explanatory guest message. This is deliberately the least AI-driven feature: money must be deterministic and auditable.

**Surface:** Booking detail (payment timeline + actions), nightly briefing (fees captured), assistant dock for status questions.

**Depends on:** `mf-foundation-schema`, `mf-guest-comms`

**Guardrails:** All captures/refunds are confirm-gated writes with actor logged in geisha_audit_log; consider type-to-confirm for refunds. Capture only fires after the Dojo webhook is HMAC-verified (close the forgeable-Captured hole first). The in-time refund bug is a correctness fix, not an AI behaviour. Never captures without a verified no_show or late-cancel.

---

### Per-Booking Menu & Upsell Suggestions  `M` · _high_

**Pitch:** For each booking, a quiet nudge: 'Anniversary table — suggest the tasting menu + champagne on arrival', lifting spend without hard-selling.

**How it works:** When viewing a booking (or in the run-sheet), an LLM read tool suggest_upsell(bookingId) combines occasion, party_size, time, guest history (favourite dishes from notes/past visits), and the menu (already in geisha_content / lib/data menus) to propose tasteful add-ons and a pre-arrival offer line. Suggestions can flow into mf-guest-comms (a pre-visit 'would you like to pre-order the set menu?' email) and the run-sheet so floor staff know the play.

**Data needed:** occasion + party_size + history exist; menu content exists in geisha_content/lib/data. No new schema required (a structured 'favourite dishes' field on customer would sharpen it — overlaps Phase E CRM). Pre-order capture would need a new field if you want to record the response.

**AI approach:** LLM (runAgent text) — matching menu + occasion + history to tasteful suggestions is a language/judgement task, suited to an LLM. The menu/history facts are retrieved deterministically and handed in.

**Surface:** Booking detail, run-sheet, and optional pre-visit comms.

**Depends on:** `mf-foundation-tools`, `mf-vip-rag`

**Guardrails:** Suggestions are staff-facing prompts, not auto-sent to guests unless routed through the review-first comms queue. Respects dietary flags (won't upsell shellfish to a shellfish allergy). Tone capped to 'tasteful, never pushy' in the system prompt; honours marketing_consent for any guest-facing send.

---

### Operational Anomaly Alerts  `M` · _high_

**Pitch:** Get pinged the moment something's off — a spike in cancellations, an unusual no-show cluster, a sudden drop in Friday covers — before it costs you a service.

**How it works:** A CRON_SECRET job /api/cron/anomaly compares rolling windows of booking/cancel/no-show counts (from geisha_bookings + geisha_audit_log actions like cancel_late/no_show) against each (brand,day,period) baseline. When a metric deviates beyond a z-score/threshold, it raises a geisha_alerts row and (optionally) emails managers / pushes into the nightly briefing. An LLM turns the raw deviation into a plain-English heads-up with a likely cause hypothesis. Read tool get_alerts() surfaces them in the dock.

**Data needed:** geisha_bookings + geisha_audit_log exist (audit already logs cancel_late/no_show via mutate.ts). MUST add a geisha_alerts collection (kind, metric, severity, window, message, acknowledged). Baselines improve with history; cold-start uses wide thresholds.

**AI approach:** Stats-first: detection is z-score/threshold over counts (NOT an LLM — anomaly detection on counts is arithmetic). LLM only writes the human explanation and hypothesises a cause from context. Hybrid.

**Surface:** Dashboard alert banner, nightly briefing, assistant dock; optional email/push.

**Depends on:** `mf-foundation-schema`

**Guardrails:** Alerts are advisory and acknowledgeable; never trigger automatic action. Thresholds owner-tunable to avoid alert fatigue. The LLM's cause hypothesis is labelled 'possible cause' so staff don't treat it as fact. Read-only.

---

### Moonshot foundation bridges

#### Foundation: AI Data-Capture Schema  `M`

A single migration wave (timestamp 1772700400+, JS in pb_migrations/, scp to the droplet + systemctl restart pocketbase-pmm, gentle on the 1GB no-swap box) that adds the data the moonshots read/write: risk_score + risk_factors + dietary_flags json on geisha_bookings; no_show_count/cancel_count + structured dietary/VIP/tags + per-brand restaurant scoping on geisha_customers; and the new collections geisha_comms, geisha_waitlist, geisha_reviews, geisha_alerts, plus optional geisha_customer_embeddings / notes_summary. Also adds geisha_settings rows: deposit_rules, pacing_curve, risk_threshold, comms_autosend flags, briefing recipients.

**Guardrails:** Migrations are additive/back-compat (existing engine ignores new fields, mirroring how floor-planner cols were added). Test on a copy before the shared droplet. Per-brand customer scoping fixes a real cross-restaurant privacy leak. GDPR fields (consent provenance, erasure) included from the start.

#### Foundation: Unified Full AI Tool Catalogue  `L`

Executes the roadmap's Phase D: grow adminTools.ts to the full catalogue (get_booking_detail, get_bookings_range, create_booking, amend_booking, cancel_booking, mark_no_show, seat_booking, clear_table, seat_walkin, unjoin_tables, create/update/delete_table, save_layout, manage_floor, set_shapes, search_customers, get_customer_history, update_customer_notes, get_payment_status, refund_deposit, list_periods, update_service_period, get_dashboard, plus all the new read tools the moonshots need). Retire the legacy Claude stack (ai/agent.ts, ai/tools.ts, /admin/concierge) and unify on the transport-agnostic geminiAgent.ts loop. Fix the known loop bugs (parallel-write read-drop, tool-call id collision, confirm-result re-feed) and raise the slice(-8)/6-turn caps.

**Guardrails:** All mutations stay kind:'write' (confirm-gated). saveLayout/setShapes/setJoins must gain writeAudit before exposure. delete_table/manage_floor-delete/refund_deposit are high-blast-radius: type-to-confirm + RBAC. confirm() must re-feed results so the agent has memory of success/failure.

#### Foundation: Staff Auth, RBAC & Confirm-Endpoint Hardening  `L`

Implements the owner's RBAC decision + Phase A blockers: a geisha_staff collection (PocketBase users with role owner/manager/host/server) gating /admin/** + /api/admin-chat + /api/ai + cron in hooks.server.ts. Threads real per-actor identity into writeAudit (actor='ai' + on_behalf_of=userId, replacing today's hardcoded 'staff'). RE-VALIDATES the /api/admin-chat confirm input against each tool's schema (today it takes tool+input as z.unknown() with no auth — an exploit). Implements the Dojo webhook HMAC verifySignature (returns true always today). RBAC gates which tools/confirms each role can run.

**Guardrails:** This IS the guardrail layer: closes the exploitable confirm endpoint, the forgeable Dojo webhook, the multi-instance double-book race, and the lying audit log. NOTHING with write tools (mf-autonomous-copilot, mf-nl-floorplan writes, mf-floor-voice-copilot writes) ships before this is complete — per the roadmap, READ tools only to production until then.

---

## 6. Cross-cutting concerns

### Unified AI tool-registry design

`adminTools.ts` is the hottest merge point. **WP-S6-1 splits it first** into per-domain registry modules under `src/lib/server/ai/tools/` (`toolsBookings`, `toolsFloor`, `toolsCustomers`, `toolsPayments`, `toolsSettings`, `toolsReports`, `toolsInsights`) with a thin composer. Thereafter every other stream adds **one** module and registers it via the composer — never edits a shared monolith. De-dup the lifecycle tools: **S6-2 owns** `create_booking`/`cancel_booking`/`seat_booking`; S6-4 ports only the genuinely-unique `get_dashboard`/`search_customers`/`get_customer_history` from the legacy Claude stack, then deletes `ai/agent.ts` + `ai/tools.ts` + `/admin/concierge`.

### Schema-migration batching

**F2 is the only migration in this plan.** No stream adds its own `pb_migrations` file (it would race on the droplet restart). Any unavoidable late additive column appends as `1772700700+`. Migrations are additive/back-compat (the engine ignores unknown fields, mirroring how the floor-planner columns were added). Test on a copy before the shared 1GB droplet; schedule restarts off-peak.

### RBAC matrix (roles: owner / manager / host / server)

| Capability | owner | manager | host | server |
|---|:--:|:--:|:--:|:--:|
| View dashboard / diary / floor | ✓ | ✓ | ✓ | ✓ |
| Seat / clear / move / walk-in (live floor writes) | ✓ | ✓ | ✓ | ✓ |
| Create / amend / cancel booking | ✓ | ✓ | ✓ | – |
| Refund deposit / release hold (money) | ✓ | ✓ | – | – |
| Edit floor plan / tables / joins | ✓ | ✓ | – | – |
| Edit settings / pacing / closures / deposit rules | ✓ | ✓ | – | – |
| CRM edit / GDPR export-erasure | ✓ | ✓ | – | – |
| Manage staff / roles | ✓ | – | – | – |
| AI write tools (confirm) | per the row above | per row | per row | live-floor only |
| Run autonomous co-pilot / approve plan | ✓ | ✓ | – | – |

RBAC is enforced **server-side** in every loader/action/endpoint via F1’s `requireRole()` (never by hiding a button alone). AI write tools inherit the confirming staff member’s role; the confirm endpoint re-checks it (WP-S1-2).

### Audit

Every mutation writes `geisha_audit_log` with `actor` (staff|ai|system|customer) + `on_behalf_of` (the staff id, threaded by F3a). `saveLayout`/`setShapes`/`setJoins` — silent today — gain audit before any AI tool exposes them.

### Data-capture prerequisites for the moonshots

Start logging the right data on day one so the smart features have history to learn from: `risk_score`/`risk_factors`/`dietary_flags` on bookings, `no_show_count`/`cancel_count` + structured dietary/VIP/tags on customers, and the `geisha_comms`/`geisha_waitlist`/`geisha_reviews`/`geisha_alerts`/`geisha_ai_insights` queues — all in F2. The forecaster, risk scorer and anomaly detector improve with weeks of data; all have conservative cold-start fallbacks.

---

## 7. Gaps closed by the review (folded into the plan)

The adversarial review found **0 dependency cycles and 0 dangling deps**, but flagged these gaps — each is now an explicit work item:

- REMINDER EMAIL / pre-service notification has NO work-package. The ROADMAP Phase B lists 'Reminder email before service (new cron job)' as a 'Core no-show reducer' and the parity table marks it P0-adjacent ('Automated reminder before service' = MISSING). S1 only covers confirmation (WP-S1-5) and cancellation emails; release.ts + the single /api/cron/release route are the only cron infra. No WP creates a reminder sweep/cron, the geisha_messages 'reminder' template, or wires it to a secured cron. The moonshot mf-guest-comms touches reminders but that is a separate ambition track, not parity. ADD a WP (S1 or S3): pre-service reminder cron + geisha_messages logging, dependsOn F1 (secured cron) + F2 (geisha_messages) + WP-S1-5 (Resend wiring).
- RUN-SHEET / allergen+occasion service summary has NO work-package. ROADMAP P1 lists 'Run-sheet / allergen+occasion service summary' and 'Walk-in waitlist'. WP-CRM-2 adds structured dietary/allergy fields to the guest profile, but nothing produces the per-service printable run-sheet (today's bookings with allergies/occasions/VIP) the floor team uses. This is the data consumer that justifies the CRM allergy schema. ADD a WP in S2 or S5: run-sheet view + print, dependsOn WP-CRM-2 + WP-LIVE-3.
- CRON / scheduled-job SECURING is implied but never made an explicit WP. F1's 'why' says cron runs on a superuser token and must be gated, and F1.unblocks does not even list the cron. WP-S1-x and WP-AVAIL-6 assume a secured cron exists (notify-when-free sweep, hold-timeout release). The auth WP must explicitly cover /api/cron/* (a CRON_SECRET / header check distinct from staff session, since cron has no logged-in actor). Make this an explicit acceptance criterion of F1.
- CONTENT + LOYALTY admin surfaces are entirely out of scope yet exist and will break under F1. The live admin/+layout.svelte nav includes '/admin/circle' (loyalty — src/lib/server/booking/loyalty.ts exists) and '/admin/content' with gallery/text/menus sub-pages. None of S1-S9 mention them, but F1's hooks gate and F3d's admin.css/token sweep + WP-S8-2 (replace hardcoded hex across ALL admin pages) MUST cover them or they ship unauthenticated / off-brand. Either add them to S8's file inventory and F1's gated routes, or explicitly declare them out of scope and exclude from the guard — silent omission is a go-live hole.
- VOICE coverage stops at V1 only (WP-S6-7 Web Speech STT/TTS). The owner ask is MOONSHOT AI; the ROADMAP §4.3 V2 (streaming SSE + Realtime/barge-in) and the moonshot mf-floor-voice-copilot are not represented by any S6 WP. Acceptable to defer, but the plan should state V2/realtime-voice is explicitly out of this plan's scope so it is not mistaken for covered.
- CONFIGURABLE DEPOSIT RULES schema lands (F2 geisha_deposit_rules) but no work-package CONSUMES it. policy.ts hardcodes £10pp-6+/£5pp-noshow; the owner's decision #4 is a fully configurable per-service/party/date/event deposit-rules ENGINE + admin editor. No WP rewrites paymentRequirementFor()/policy.ts to read geisha_deposit_rules, and none builds the rules editor UI. WP-S1-3 collects the card but still calls the hardcoded policy. ADD: (a) policy-engine WP in S1/S3 (read geisha_deposit_rules, priority-ordered match, dependsOn F2), and (b) a deposit-rules admin editor WP in S3/S8. Without these, F2's geisha_deposit_rules is dead schema.
- MOONSHOT FEATURES are an isolated dependency island. Every mf-* depends only on mf-foundation-{schema,tools,auth}, which map to F2/WP-S6-1+S6-2/F1 respectively, but NO mf-* lists a single WP-* id and no WP lists an mf-* id. The two graphs never touch, so the moonshot work is unschedulable against the streams. Bridge them: declare mf-foundation-auth==F1, mf-foundation-schema==F2 (+ geisha_ai_insights already in F2), mf-foundation-tools==WP-S6-1+WP-S6-2+WP-S6-3, then the moonshots become Wave 4+ riders on those nodes. mf-noshow-risk specifically needs the no_show_count/cancel_count fields from F2 and the get_noshow_report data shape from WP-CRM-6 — wire that dependency in.
- WP-S7-1 is titled only 'Test' with dependsOn [F1] — a one-word placeholder for an entire stream. There is no test/CI work-package covering the engine regression risk introduced by WP-AVAIL-1/2/3 (which all edit the unit-tested availability.ts) or the create.ts lock swap (F3b). availability.test.ts/release.test.ts/policy.test.ts exist and WILL be invalidated by F2 schema + S3 engine changes. Define S7 concretely: regression tests for the lock (F3b), the pacing/closures/lead-time engine changes (S3), and the confirm-endpoint re-validation (WP-S1-2). It should depend on F2/F3 and the S3 WPs, not just F1.
- GUEST-FACING brand scoping for the public booking widget vs S5's per-brand customer scoping (WP-CRM-1) is unsequenced against S9. WP-CRM-1 adds the geisha_customers.restaurant relation + phone/email dedupe; createBooking()'s upsertCustomer (create.ts:164) and the guest widget (S9) both write customers. If S9 ships its 5-step widget (WP-S9-3) before WP-CRM-1, new guest bookings create un-scoped customer rows that the dedupe migration must later reconcile. Add WP-CRM-1 as a soft dependency of WP-S9-3, or make WP-CRM-1 part of F2's data layer so all writers are scoped from day one.

**New WPs to add from the gaps:** (a) **pre-service reminder-email cron** (`/api/cron/reminder` + `geisha_messages` reminder template; in S1/S3, after WP-S1-5); (b) **run-sheet / allergen+occasion service summary** view + print (in S2/S5, after WP-CRM-2 + WP-LIVE-3); (c) **configurable deposit-rules engine** — rewrite `policy.paymentRequirementFor()` to read `geisha_deposit_rules` priority-ordered — plus a **deposit-rules admin editor** (in S3, consumes F2; can land as early as Wave 1); (d) re-scope the placeholder **WP-S7-1** into concrete regression tests. Voice **V2 (streaming/Realtime barge-in)** is explicitly **out of scope** for this plan.

## 8. Merge hotspots & resolutions

| File | Streams touching it | Resolution |
|---|---|---|
| `src/routes/admin/+layout.svelte` | F1 (auth gate / staff-aware shell); F3d (import admin.css); WP-S6-5 (persistent assistant dock rendered outside <main>); WP-S8-3 (collapsible sidebar + off-canvas drawer); WP-S8-2 (replace hardcoded hex with tokens) | This single 132-line file is the #1 collision point — five work items across four streams rewrite its markup AND its <style>. Sequence strictly: F1 lands the auth-aware shell + locals.staff first; F3d adds the admin.css import and swaps the body/grid tokens; THEN treat the shell as frozen-by-owner. S8 (responsive grid + third dock column) and S6-5 (dock slot outside <main>) must be co-authored in ONE PR or hard-serialised S8-3 -> S6-5, because both restructure the .admin grid (220px 1fr -> sidebar \| content \| optional dock, with a tablet breakpoint). Do NOT let S6 and S8 edit the grid in parallel. Also note: nav array includes /admin/circle and /admin/content not in plan scope — decide their fate here. |
| `src/lib/server/ai/adminTools.ts` | F3d/F3c (none — F3 does not touch it, good); WP-S6-1 (split into per-domain registry modules + composer); WP-S6-2 (booking-lifecycle tools); WP-S6-3 (floor/seating tools); WP-S6-4 (port Claude-stack tools); WP-S6-6 (expand SETTING_META + summarise); guest/admin endpoints consuming it | WP-S6-1 is correctly designated 'the clean merge point' and is the ONLY thing in Wave 1 of S6 — it MUST land before S6-2/3/4/6 so they each add a self-contained registry module rather than editing one monolith. After the split, S6-2/3/4 are genuinely parallel (different domain files). Risk: WP-S6-2 (create/cancel/seat) and WP-S6-4 (port the SAME create_booking/cancel_booking/seat_booking from the Claude tools.ts) overlap on identical tools — assign those three tools to ONE of them (recommend S6-2 owns lifecycle; S6-4 only ports the genuinely-unique get_dashboard/search_customers/get_customer_history and then deletes ai/agent.ts+tools.ts+/admin/concierge). Otherwise duplicate tool definitions. |
| `pb_migrations/1772700600_*.js (F2 batched migration)` | F2 (sole author); every stream codes against it | Correctly batched into ONE additive migration to spare the 1GB no-swap droplet — good call. Enforce: F2 is the ONLY migration in this plan; no stream adds its own pb_migrations file (would race on restart). One gap to fold into F2 NOW so no stream needs a follow-up migration: geisha_messages needs a 'reminder' template value and the reminder WP's fields; geisha_deposit_rules must be seeded with the current £10pp-6+/£5pp rows as data (not schema) by the policy-engine WP. Verify F2 includes geisha_locks (or a version column) for F3b's lock — the F3 'why' mentions 'geisha_locks row OR optimistic version' but F2's field list does NOT enumerate geisha_locks; pin this down or F3b has no table. |
| `src/lib/server/booking/availability.ts` | WP-AVAIL-1 (covers cap / pacing throttle in checkAvailability); WP-AVAIL-2 (closures override); WP-AVAIL-3 (booking_window_days + lead-time cutoff); WP-S7-1 (tests over the engine) | Three S3 WPs all edit the same pure checkAvailability/allocateTables core. They are at the same depth (Wave 1) but MUST NOT be three parallel authors of one function. Partition by insertion point: AVAIL-3 (pre-filter: reject dates outside window / inside lead-cutoff BEFORE slot generation) and AVAIL-1 (post-allocation: decrement a per-slot covers counter) touch different phases and can be co-authored; AVAIL-2 (closures) is also a pre-filter alongside AVAIL-3. Recommend serialise as AVAIL-3+AVAIL-2 (both pre-filters, one PR) THEN AVAIL-1 (pacing, separate phase), with the availability.test.ts update bundled into each rather than deferred to the stub WP-S7-1. The engine is the moat — every edit here ships with its regression test. |
| `src/lib/server/booking/audit.ts + admin.ts (writeAudit signature + actor threading)` | F3a (extend writeAudit with on_behalf_of; thread actor through create/update/deleteTable/Floor; add audit to saveLayout/setShapes/setJoins); WP-S6-3 (AI floor write tools call those same admin.ts fns); WP-FLOOR-1/7 (saveLayout/setShapes persistence + addFloor); S2 live mutations | F3a changes the SIGNATURE of writeAudit and of six admin.ts functions — a cross-cutting break that MUST land before any stream calls those functions with an actor. It is correctly in foundation. Ensure F3a lands the FULL new signatures (actor, on_behalf_of) so WP-S6-3 (AI calls save_layout/set_shapes as actor='ai') and WP-FLOOR-1/7 (which add the persistence paths) build on the audited versions. WP-FLOOR-1 (immediate-persist shape delete via setShapes) and F3a (add audit to setShapes) BOTH edit setShapes — sequence F3a first, then WP-FLOOR-1 consumes the audited setShapes. |
| `src/lib/server/booking/create.ts + payments.ts (lock + payment + refund)` | F3b (replace in-process Map lock with PB-backed lock); WP-S1-1 (webhook HMAC — reads payments); WP-S1-3 (live card collection — calls createBooking payment path); WP-S1-4 (pre-start hold timeout in release.ts); WP-S1-6 (make refundDeposit reachable from cancelBooking) | F3b rewrites withLock in create.ts (lines 30-46) — foundation, must precede WP-S1-3 which exercises the payment branch of createBooking under the new lock. WP-S1-6 edits cancelBooking (mutate.ts) + payments.ts refundDeposit; WP-S1-4 edits release.ts shouldRelease/sweep to also release pending_payment holds BEFORE start (today release.ts:54 only matches starts_at<=now). These touch adjacent files but distinct functions — parallelisable AFTER F3b. Keep F3b's lock choice (geisha_locks vs optimistic version) decided in F2 so create.ts and the migration agree. |

---

## 9. Definition of done (go-live checklist)

- [ ] **F1** staff auth + RBAC live; `/admin/**`, `/api/admin-chat`, `/api/ai`, and `/api/cron/*` all gated; audit records a real actor.
- [ ] **F2** single batched migration applied to the droplet; `types.ts` in sync; deposit-rules seeded; `geisha_locks` present.
- [ ] **F3** audit-actor threaded; multi-instance booking lock replaces the in-process `Map`; AI loop bugs fixed; admin tokens shared.
- [ ] **S1** Dojo webhook HMAC verified (forged events rejected); confirm endpoint re-validates per-tool input; real card collection in the widget; deposits captured + refunds working; Resend live with status-guarded emails; unpaid holds auto-expire.
- [ ] **S2** seated parties movable; seat-across-joins; multi-floor live view; drag-to-seat; realtime sync replaces the 20s poll.
- [ ] **S3** covers/pacing caps; closures calendar; lead-time + booking-window enforced; waitlist + notify-when-free; reminder cron.
- [ ] **S4** all 9 floor-editor bugs fixed (shape-delete persists, keyboard delete, undo/redo, clamping, drag-rotate, multi-select, polyline walls).
- [ ] **S5** per-brand customer scoping + dedupe; guest profiles (history, risk, dietary/VIP/tags); marketing-consent provenance; GDPR export/erasure; covers + no-show reporting.
- [ ] **S6** legacy Claude stack retired; unified full tool catalogue; front-and-centre dock + ⌘/Ctrl-K; voice V1; type-to-confirm on high-blast-radius writes.
- [ ] **S7** moonshot features shipped per Wave 4; regression suites green.
- [ ] **S8** admin design tokens + shared primitives; tablet-responsive shell; 44px tap targets.
- [ ] **S9** guest widget stepper + payment; self-service amend/cancel via signed link; public opening hours.
- [ ] Engine unit tests (`availability`/`policy`/`release`/`dojo`/`validateToolInput`) all green; `npm run build` clean; type-check clean.
- [ ] **Production gate:** no AI *write* tool reaches prod until F1 auth + WP-S1-2 confirm re-validation are merged (READ tools only before then).
