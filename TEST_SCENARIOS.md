# Geisha Booking & Admin — User Test Scenarios

End-to-end scenarios covering every major surface built across Foundation + Waves 1–3 + the Moonshot AI layer. Each scenario lists the **role**, **steps**, and **expected result**. Use these for manual QA and as the script the automated (chrome-devtools MCP) pass follows.

**Prerequisites for a live run:**
1. Migration `pb_migrations/1772700600_geisha_plan_collections.js` applied to the PocketBase instance (adds `geisha_staff`, `geisha_closures`, `geisha_pacing_rules`, `geisha_deposit_rules`, `geisha_waitlist`, `geisha_messages`, `geisha_ai_insights`, `geisha_alerts`, `geisha_reviews`, `geisha_locks` + new fields). **Manual step — restart `pocketbase-pmm` on the droplet, or run against a local PB.**
2. `.env`: `AUTH_SECRET` (any random string), `CRON_SECRET`, `POCKETBASE_URL` + admin creds. Optional first-run: `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` to seed the first owner.
3. Integration keys (Dojo/Resend/AI) are **entered in-app** at `/admin/settings/integrations` (manager+), or left blank to exercise the graceful no-op fallbacks.

Legend: 🟢 core path · 🔒 RBAC-gated · 🤖 AI · 💳 payments · 📧 comms.

---

## A. Authentication & RBAC (Foundation F1)

### A1 — First-run owner bootstrap 🔒
- **Steps:** visit `/admin` with an empty `geisha_staff` collection → redirected to `/admin/setup` → create the first owner (email + password).
- **Expected:** owner created (scrypt `password_hash` stored), session cookie set, land on `/admin` dashboard. Setup route refuses once any staff exists.

### A2 — Login / logout 🟢🔒
- **Steps:** `/admin/login` with valid creds → dashboard; click logout.
- **Expected:** valid login sets the `geisha_staff_session` HMAC cookie (12h, httpOnly); bad creds show an error and no cookie; logout clears the cookie and redirects to `/admin/login`.

### A3 — Route guard 🔒
- **Steps:** while logged out, hit `/admin/floor`, `/api/admin-chat` (POST), `/api/cron/release` (no `x-cron-secret`).
- **Expected:** `/admin/**` → redirect to `/admin/login`; `/api/admin-chat` → 401; cron route → 401 without the `x-cron-secret` header, 200 with it.

### A4 — Role matrix 🔒
- **Steps:** log in as each role (owner/manager/host/server) and check nav + actions.
- **Expected:** server sees live-floor only; host can create/amend/cancel bookings but not money/settings/floor-edit; manager can do money/settings/floor/CRM; owner can manage staff. Server-side `requireRole` blocks a direct POST to a gated action even if the button is hidden.

---

## B. Public booking journey (Engine + S1 + S9)

### B1 — Online booking, no deposit 🟢
- **Steps:** on `/asia/bookings` (or `/fusion/bookings`) pick date → party 2 → a slot → details → submit.
- **Expected:** stepper advances date→party→slot→details→(no payment)→done; booking created `confirmed`; confirmation email attempted (logged to `geisha_messages`, or console fallback if Resend unconfigured).

### B2 — Deposit booking with card step 💳
- **Steps:** book a party of 6+ (triggers the deposit rule) → reach the payment phase.
- **Expected:** with Dojo configured, a hosted-payment link / card step renders; booking stays `pending_payment` until the webhook confirms. With Dojo unconfigured, a graceful "we'll confirm shortly" message — never a broken card form. The literal "A secure payment step will follow" placeholder is gone.

### B3 — Over-cap party → phone required 🟢
- **Steps:** request a party above `online_party_max`.
- **Expected:** rejected with a "please book by phone" message (online cap enforced; staff path can exceed it).

### B4 — Waitlist when full 🟢
- **Steps:** request a slot with no availability.
- **Expected:** offered a "join the waitlist" path that writes a `geisha_waitlist` row.

### B5 — Closure blocks a date (S3)
- **Steps:** with a `geisha_closures` row covering a date, request availability for it.
- **Expected:** no slots offered for the closed date/period.

### B6 — Lead-time / booking-window enforcement (S3)
- **Steps:** request a time inside the same-day cutoff, and a date beyond `booking_window_days`.
- **Expected:** both rejected as out-of-window.

### B7 — Guest self-service amend/cancel 🟢 (S9)
- **Steps:** open the signed `/book/[token]` link from a confirmation.
- **Expected:** token verifies against the booking; guest can cancel, or amend time/party (re-validated via `amendBooking`, sets `amended_from`); a tampered token is rejected.

---

## C. Live service floor (S2)

### C1 — Seat a booking 🟢
- **Steps:** `/admin/floor`, click an upcoming table → "Seat now".
- **Expected:** tile turns "seated"; `geisha_floor_state` row created.

### C2 — Move a SEATED party (was missing) 🟢
- **Steps:** select a seated table → move the party to another free table.
- **Expected:** `moveBooking` succeeds for an occupied table (not just free); tiles update.

### C3 — Seat across joined tables 🟢
- **Steps:** seat a large party that needs two joined tables.
- **Expected:** both tables go seated under one booking (multiple tableIds submitted).

### C4 — Multi-floor view 🟢
- **Steps:** switch floors in the live view.
- **Expected:** only the active floor's tables render (no overlap); `getFloorPlan(floorId)` scopes correctly.

### C5 — Walk-in 🟢
- **Steps:** click a free table → seat a walk-in (party size + optional name).
- **Expected:** walk-in booking created `seated`.

### C6 — Realtime sync (S2)
- **Steps:** open the floor in two tabs; seat/clear in one.
- **Expected:** the other tab reflects the change via PocketBase subscription (no 20s wait); falls back to polling if realtime unavailable.

### C7 — Run-sheet 🟢 (Wave 3)
- **Steps:** `/admin/runsheet` for today.
- **Expected:** every booking with allergies/dietary flags, occasion, VIP; print stylesheet renders cleanly.

---

## D. Booking management & CRM (S5)

### D1 — Manual/phone booking 🟢🔒
- **Steps:** `/admin/new-booking` as host+.
- **Expected:** staff booking created `confirmed`, bypasses the online cap, still table-fit validated.

### D2 — Amend a booking (was missing) 🟢
- **Steps:** open a booking, change time/party.
- **Expected:** `amendBooking` re-allocates tables, sets `amended_from`, audits; an impossible change is rejected.

### D3 — Cancel + refund 💳🔒
- **Steps:** cancel a confirmed deposit booking in-time vs late.
- **Expected:** in-time → deposit refunded (`refundDepositManual`, `Refunded` pill); late → forfeited. Cancellation email only fires for a previously-confirmed booking.

### D4 — Guest profile 🟢
- **Steps:** `/admin/customers/[id]`.
- **Expected:** aggregated history, no-show/cancel counters, structured dietary/allergy/VIP fields, tags; per-brand scoped (no cross-restaurant leak).

### D5 — Marketing consent + GDPR 🔒
- **Steps:** toggle consent (provenance recorded); run export + erasure.
- **Expected:** consent source/timestamp stored; export returns the customer's JSON; erasure soft-deletes (`deleted_at`) + scrubs PII, audited.

### D6 — Reporting 🔒
- **Steps:** `/admin/reports`.
- **Expected:** covers/occupancy over a range; no-show rate + channel breakdown; CSV export downloads.

---

## E. Floor editor (S4)

### E1 — Delete a shape persists (THE reported bug) 🟢
- **Steps:** draw a wall, select it, delete; reload the page.
- **Expected:** the wall stays deleted (immediate persist) — does **not** reappear. Unsaved-edits `beforeunload` guard warns on navigation.

### E2 — Keyboard delete + undo/redo 🟢
- **Steps:** select a table, press Delete; press Ctrl+Z then Ctrl+Shift+Z.
- **Expected:** Delete removes the selection; undo restores it; redo re-removes.

### E3 — Angled / polyline walls (was rectangles-only) 🟢
- **Steps:** add a wall, use the rotate handle for an arbitrary angle; draw an L-shape.
- **Expected:** shapes rotate to any angle and persist; polyline/L-shape renders via `points[]`.

### E4 — Clamping 🟢
- **Steps:** drag a shape/table toward the edge; resize the room smaller.
- **Expected:** items clamp inside the room (rotated bounds respected); room-resize re-clamps existing items; nothing saves off-canvas.

### E5 — Zone/label kinds + multi-select 🟢
- **Steps:** use the Draw tool's zone/label kinds; marquee-select several shapes.
- **Expected:** zone/label are now in the Draw dropdown; multi-select drags/deletes as a group.

### E6 — AI "describe my room" 🤖 (Moonshot)
- **Steps:** type "14 tables, a bar along the back wall, two pillars".
- **Expected:** the AI proposes a layout via the floor write tools; preview shown; apply is confirm-gated; coordinates clamped on-canvas.

---

## F. AI assistant (S6 + foundation hardening)

### F1 — Front-and-centre dock 🤖
- **Steps:** anywhere in `/admin`, open the dock; press ⌘/Ctrl-K.
- **Expected:** a persistent collapsible dock (survives route changes via the shared rune store); ⌘-K focuses it; open/closed persists in localStorage.

### F2 — Read tool (auto-run) 🤖
- **Steps:** ask "what's on the floor tonight?" / "who's booked Saturday?"
- **Expected:** read tools run automatically and the answer cites real data (no fabrication).

### F3 — Write tool (confirm-gated) 🤖🔒
- **Steps:** ask "move the Patel booking to table 7".
- **Expected:** a confirm card with a human summary + raw input; nothing executes until Confirm; after confirm, `invalidateAll()` refreshes the view; audited `actor='ai'` + `on_behalf_of`.

### F4 — Type-to-confirm on dangerous writes 🤖🔒
- **Steps:** ask to delete a table / refund a deposit.
- **Expected:** the confirm card requires typing a word before Confirm enables.

### F5 — Confirm-endpoint hardening (security) 🔒
- **Steps:** POST a malformed/forged confirm payload to `/api/admin-chat`.
- **Expected:** per-tool input re-validation rejects it (400); unauthenticated → 401/403. The `z.unknown()` passthrough hole is closed.

### F6 — Voice 🤖
- **Steps:** press-and-hold the mic, speak a query (supported browser).
- **Expected:** STT fills the draft and sends; TTS reads the answer back; mic hidden where unsupported; voice never auto-executes a write (still confirm-gated).

---

## G. Moonshot AI (S7)

### G1 — No-show risk 🤖
- **Steps:** view the diary / floor; ask "who's risky tonight?"
- **Expected:** a risk badge (amber/red + factor tooltip) on rows/tiles; `get_noshow_risk(date)` returns deterministic scores + factors.

### G2 — Seating optimiser 🤖
- **Steps:** "Optimise tonight" on the floor.
- **Expected:** a before/after plan; each move is an individual confirm; seated parties pinned; re-validates fit before each write.

### G3 — Demand forecast & pacing 🤖
- **Steps:** ask "how busy will Friday be?"; check the diary pacing bar.
- **Expected:** `get_demand_forecast` returns expected covers per slot; slots throttle at the cap; cold-start uses a conservative flat cap.

### G4 — Allergy intelligence 🤖
- **Steps:** book with "my partner can't have dairy" in the requests.
- **Expected:** `dietary_flags` extracted (keyword layer works with no AI key); allergy badge on floor tile + run-sheet.

### G5 — Autonomous guest comms 📧🤖
- **Steps:** run the comms cron; open `/admin/comms`.
- **Expected:** AI-drafted reminders/thank-you/win-back queued (default review-first); respects `marketing_consent`; idempotent; approve/edit/send works.

### G6 — Review sentiment 🤖
- **Steps:** paste a review into `/admin/reviews`.
- **Expected:** sentiment + themes extracted; an on-brand reply drafted (confirm-gated, never auto-posted).

### G7 — Nightly briefing 🤖📧
- **Steps:** run the briefing cron; check the dashboard "Tonight" card.
- **Expected:** a crisp brief from real data (covers, VIPs, allergies, risks, pacing); idempotent (one per brand/day); the prompt forbids inventing numbers.

### G8 — Anomaly alerts 🤖
- **Steps:** run the anomaly cron with a cancellation spike in the data.
- **Expected:** a `geisha_alerts` row + dashboard banner; the LLM writes only the plain-English "possible cause"; detection itself is statistical.

### G9 — Autonomous co-pilot 🤖🔒
- **Steps:** "Plan tonight" (owner/manager).
- **Expected:** one structured plan (seating diff, holds to request, pacing, VIP/allergy notes, draft messages) as a checklist of **individually confirm-gated** actions; "Approve all" still fires each through its own audited write — never a bulk silent commit.

---

## H. Settings & integrations

### H1 — Integration keys (owner-requested) 🔒
- **Steps:** `/admin/settings/integrations` (manager+) → paste Dojo/Resend/AI keys → save.
- **Expected:** keys stored in `geisha_settings` (masked, last-4 shown); a "configured/not configured" badge per integration; server reads them via `getIntegrationKey` with env fallback.

### H2 — Deposit-rules engine 🔒
- **Steps:** `/admin/settings/deposits` → add/edit/reorder rules.
- **Expected:** `paymentRequirementFor` reads `geisha_deposit_rules` priority-ordered; the seeded current policy (£10pp 6+, £5pp Fri/Sat hold) is the fallback; new rules take effect on the next booking.

### H3 — Pacing rules 🔒
- **Steps:** `/admin/pacing` → set per-service covers caps.
- **Expected:** caps stored in `geisha_pacing_rules` and applied by availability.

### H4 — Policy settings via AI 🤖
- **Steps:** ask the assistant to "raise the max online party size".
- **Expected:** `open_settings` spawns an editable widget; or `update_setting` proposes a confirm-gated change.

---

## I. Webhooks & crons (security)

### I1 — Dojo webhook HMAC 💳🔒
- **Steps:** POST a signed vs forged event to `/api/webhooks/dojo`.
- **Expected:** valid signature → processed; tampered body / stale timestamp / missing header → 401, no mutation; replays are idempotent.

### I2 — Cron auth 🔒
- **Steps:** call each `/api/cron/*` (release, reminder, risk, forecast, comms, briefing, anomaly) with/without `x-cron-secret`.
- **Expected:** 401 without the secret; 200 and the sweep runs with it.

---

## How the automated MCP pass uses this

The chrome-devtools MCP run drives the highest-value, UI-observable scenarios against a running dev server: A1–A4 (auth/RBAC), B1/B3 (public booking happy + cap), E1/E2 (the floor-editor delete + undo bug fixes), F1–F3 (assistant dock + a read query + a confirm-gated write), H1 (integration keys). Server-only paths (webhook HMAC, crons, scorers) are covered by the 341 unit tests rather than the browser.
