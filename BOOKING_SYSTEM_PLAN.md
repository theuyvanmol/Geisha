# Geisha — Bespoke Booking System: Implementation Plan

> A fully custom table-booking + table-management system for **Geisha Asia** and
> **Geisha Fusion**, built into the existing SvelteKit 2 / Svelte 5 site, on the
> owner's own server + database. Replaces **ResDiary only**. The ICRTouch POS and
> Touch Takeaway (collection ordering) are **untouched and separate**. Card
> payments run through **Dojo**. Designed from the ground up to be enriched with
> AI (Claude tool-use) at every layer.
>
> Logins/auth are intentionally **out of scope for this plan** — the admin area is
> built open for now; auth is a later pass (noted in §11).
>
> Status: planning. Author date: 2026-06-01.

---

## 0. Goals & non-goals

**Goals**
1. Customer-facing booking widget per brand (`/asia/bookings`, `/fusion/bookings`), themed to each restaurant, replacing the ResDiary embed.
2. A real **availability engine** (party size → table fit, turn-time windows, service periods, no overbooking).
3. Enforce the booking **policies in `GEISHA_WEBSITE_SPEC.md` §6** (≤8 online, deposit tiers, no-show fees, 20-min release, walk-in tables).
4. **Dojo payments** for deposits / no-show holds (manual capture + reversal).
5. A staff **admin area** including a live **floor plan** ("who's sat where during service"), the diary, customers, and settings.
6. A clean relational schema that doubles as an **AI/RAG data source**.

**Non-goals (this phase)**
- Auth/logins (built open for now — §11).
- Two-way sync into the ICRTouch till (bookings are owned by this system; the floor plan is the source of truth for tables, exactly as ResDiary is today).
- Demand forecasting / ML optimisation (schema leaves room; not built now).
- Migrating gift cards / mailing list / menus (separate workstreams in the site spec).

---

## 1. Architecture at a glance

```
              SvelteKit app (existing repo, Vercel) + owner's DB
 ┌───────────────────────────────────────────────────────────────────────┐
 │ CUSTOMER (per brand, themed)              ADMIN (/admin, open for now)  │
 │  /asia/bookings   /fusion/bookings         /admin/floor   ← live grid   │
 │      │  pick date/party/slot                /admin/diary   ← day list   │
 │      ▼                                       /admin/bookings/[id]        │
 │  POST /api/bookings ──► availability engine  /admin/customers           │
 │      │                  (src/lib/server/      /admin/settings           │
 │      ▼                   booking/)            /admin/floor-editor        │
 │  Dojo payment intent ◄── deposit/no-show     /admin/tables              │
 │  (manual capture / hold)  policy logic              │                   │
 │      │                          │                   ▼                   │
 │      ▼                          ▼            reads/writes same DB tables │
 │  POST /api/webhooks/dojo   DB (PocketBase, geisha_*) ◄──┘               │
 │      │                          │                                       │
 │      ▼                          ▼                                       │
 │  Resend confirmation email   AI tool layer (src/lib/server/ai/)         │
 │                              Claude tool-use over the same functions     │
 └───────────────────────────────────────────────────────────────────────┘

  UNCHANGED & SEPARATE: ICRTouch POS · Touch Takeaway (collection) · Uber Eats (delivery)
```

**Key principle:** the customer widget, the admin floor plan, and the AI agent
all call the **same server-side functions** (`checkAvailability`, `createBooking`,
`seatTable`, …). One core, three front doors. This is what makes the system both
consistent and trivially AI-enrichable.

---

## 2. Tech choices (all free / already paid)

| Concern | Choice | Why |
|---|---|---|
| Framework | **SvelteKit 2 + Svelte 5 runes** (existing) | Already the stack; server routes + form actions = no separate backend. |
| DB | **PocketBase 0.36** — the **reused `pmm` instance** on the shared GTDS droplet (port 8093, `pmm.gtdigital.dev`). See `geisha-server-pocketbase` memory + `/opt/apps/DEPLOYMENT.md`. | Owner's existing infra, zero new cost. SQLite-backed; built-in admin UI, auth, REST/realtime. **All Geisha collections prefixed `geisha_`** so they never collide with pmm's existing `places/notes/tags` (which stay untouched; owner removes them later). |
| DB access | **PocketBase JS SDK** (`pocketbase`) server-side in SvelteKit | Typed-ish CRUD + filter queries over HTTPS. Schema defined via **PB migration files** (not an ORM). |
| Validation | **Zod** | Validate every booking payload + webhook before it hits PB. |
| Dates | **date-fns** + `date-fns-tz` | Slot math, Europe/London timezone, DST-safe. |
| Payments | **Dojo** REST + Card/Wallet JS components | Owner already uses Dojo; manual capture, reversal, card-on-file, webhooks confirmed. |
| Email | **Resend** (`resend`) | Confirmations / cancellations. Cheap/free tier. |
| Floor plan UI | **Svelte Flow** (`@xyflow/svelte`, MIT) | Drag/zoom/pan/select/connect out of the box; tables = nodes, joins = edges. |
| AI | **Anthropic SDK** (`@anthropic-ai/sdk`) | Claude tool-use over the server functions. Added incrementally. |

> Install (later, when building): `npm i pocketbase zod date-fns date-fns-tz resend @xyflow/svelte @anthropic-ai/sdk`.
>
> **Deploy model (from `/opt/apps/DEPLOYMENT.md`):** PB schema lives as migration JS files in `/opt/apps/pmm/pocketbase/pb_migrations/` (tracked in the `GTDS-Server` git repo). To add Geisha collections: write `geisha_*` migration files → commit/push → `ssh root@206.189.150.23`, `cd /opt/apps && git pull` → `systemctl restart pocketbase-pmm`. **Never touch the four other instances or pmm's existing collections.**

---

## 3. Data model (PocketBase collections, all `geisha_` prefixed)

> Defined as **PB 0.36 migration files** in `pb_migrations/` (template:
> existing `…_created_places.js`). PocketBase gives every record a 15-char `id`,
> plus `created`/`updated` automatically. Relations use PB `relation` fields
> (single or multi). Names are deliberately explicit so the AI layer reasons
> over them cleanly. Money fields are integers in **pence**.

```
geisha_restaurants      // brand ('asia'|'fusion'), display_name, timezone='Europe/London'
geisha_service_periods  // restaurant (rel), name ('Lunch'|'Dinner'|'Sunday'),
                        // days_of_week (json int[]), start_time, end_time,
                        // last_booking_time, default_turn_minutes, active (bool)
geisha_settings         // restaurant (rel), key (text), value (json)  — editable in admin
                        // e.g. online_party_max=8, deposit_per_person_6plus=1000 (pence),
                        //      noshow_fee_per_person_fri_sat=500, release_after_minutes=20,
                        //      walkin_buffer_tables=[...], booking_window_days=60

geisha_tables           // restaurant (rel), label ('T12'), seats_min, seats_max,
                        // section ('Main'|'Window'|'VIP'), bookable (bool — false = walk-in only),
                        // x, y, width, height, shape  ← geometry for the floor plan
geisha_table_joins      // restaurant (rel), table_a (rel), table_b (rel) ← combinable pairs

geisha_customers        // name, email, phone, notes (text — AI/RAG reads this),
                        // marketing_consent (bool)
geisha_bookings         // restaurant (rel), customer (rel), party_size,
                        // starts_at (date), ends_at (date),  ← ends_at = starts_at + turn time
                        // tables (multi-rel → geisha_tables), service_period (rel),
                        // status (select), source ('online'|'phone'|'walkin'),
                        // special_requests, occasion
geisha_payments         // booking (rel), dojo_payment_intent_id, kind ('deposit'|'noshow_hold'),
                        // amount (pence), status (select, mirrors Dojo), captured_at, reversed_at
geisha_floor_state      // booking (rel), table (rel), seated_at (date), cleared_at (date)
                        //   ← live "who's sat where"
geisha_audit_log        // actor ('staff'|'ai'|'system'|'customer'), action, entity,
                        // entity_id, before (json), after (json)  ← every write, incl. AI
```

> Note: PocketBase models the party↔tables M:N via a **multi-relation `tables`
> field on `geisha_bookings`** (no separate join table needed, unlike a SQL design).

**Status (geisha_bookings.status select):** `pending_payment → confirmed → seated → completed`,
plus `cancelled` and `no_show`. Booking is only `confirmed` once any required
Dojo auth/payment succeeds (see §6).

**Access rules:** create/update/delete rules on the customer-writable collections
stay locked to server-side (admin/superuser token) — the SvelteKit server holds an
admin token; the browser never writes PB directly. (Auth hardening is §11.)

**Why these specific fields**
- `ends_at` stored (not derived) so availability is a simple overlap filter.
- `bookable=false` tables model the spec's "non-reservable walk-in tables".
- `geisha_floor_state` separate from `geisha_bookings` so a table can be seated/cleared/moved without rewriting the booking — and gives the AI a clean "what's happening right now" view.
- `geisha_audit_log` records **every write including AI actions** — essential once the AI can mutate data (§9, §11).
- All money in **pence (integer)** — never floats.

---

## 4. The availability engine (the core)

> File: `src/lib/server/booking/availability.ts`. Pure functions, no HTTP — so the
> widget, admin, and AI all reuse them and tests are trivial.

**Signature**
```ts
checkAvailability(input: {
  brand: BrandId;
  date: string;          // 'YYYY-MM-DD' in Europe/London
  partySize: number;
}): Promise<{ time: string; available: boolean }[]>   // candidate slots

allocateTables(input: {
  brand: BrandId; startsAt: Date; partySize: number;
}): Promise<{ tableIds: number[] } | null>            // best fit, or null if none
```

**Algorithm (per spec §6 + best practice)**
1. Resolve the **service period** for that brand/date/time (Lunch/Dinner/Sunday); reject past `last_booking_time`.
2. **Turn time** = `service_period.default_turn_minutes` (e.g. 90 for ≤2, 120 for 3+; configurable in settings). `ends_at = startsAt + turn`.
3. Generate candidate slot times across the period (e.g. every 15 min).
4. For each slot, find tables where `seats_min ≤ party ≤ seats_max`, `bookable=true`, **not overlapping** any existing booking's `[starts_at, ends_at)` for that table (`booking_tables` ⋈ `bookings`).
5. **Allocation priority:** smallest fitting single table first; if none, try a valid **join** (`table_joins`) whose combined `seats_max` fits. Keep large tables free for large parties at peak.
6. Respect **walk-in buffer**: never allocate `bookable=false` tables online.
7. **No overbooking:** if no single/joined table is free for the whole window, the slot is simply not offered.
8. Parties **> `online_party_max` (8)** → don't offer online; show "please call" with the brand phone.

> Concurrency (PocketBase has no multi-row transactions): re-check availability
> immediately before the create, and guard against the double-book race by either
> (a) a brief server-side mutex/queue around `allocateTables`+`createBooking` per
> restaurant, or (b) creating the booking then re-querying for overlap on the
> assigned tables and rolling back (delete) if a conflict appears. Low booking
> volume makes a simple in-process lock perfectly adequate for v1.

---

## 5. Policy rules (from `GEISHA_WEBSITE_SPEC.md` §6 — config-driven via `settings`)

| Rule | Implementation |
|---|---|
| Online bookings parties **≤ 8** | `online_party_max` setting; widget hides slots & shows phone for 9+. |
| **Fri/Sat, 3–5 people:** card required, £5pp charged on no-show / late cancel (<8h) | Dojo **auth-only** (`captureMode: 'Manual'`) hold of £5×party at booking; auto-**reverse** on attendance/valid cancel; **capture** on no-show. |
| **6+ any day:** £10pp deposit, deducted from bill, non-refundable on no-show / late cancel (<8h) | Dojo **capture now** £10×party; recorded as `deposit`; refund logic on valid cancel only. |
| Reservation **released 20 min** after start if no contact | `release_after_minutes` setting; a scheduled sweep (§8) flips stale `confirmed`→`no_show`/frees table. |
| **Walk-ins welcome** on non-reservable tables | `bookable=false` tables; usable only from admin floor plan. |
| Fusion lunch/main-menu timing | Encoded as Fusion `service_periods` rows. |

All thresholds live in `settings` so staff change them in `/admin/settings` with **no developer** — and later, by asking the AI.

---

## 6. Dojo payments integration (confirmed capabilities)

> Files: `src/lib/server/payments/dojo.ts` (server), Dojo **Card component** on the
> client checkout step. Docs: https://docs.dojo.tech/payments/api

**Flow (deposit or no-show hold)**
1. Server creates a **payment intent** — `captureMode: 'Manual'` for holds, immediate for deposits — amount in pence from policy (§5). Booking saved as `pending_payment`.
2. Client mounts the **Dojo Card / Wallet component**; card data goes straight to Dojo (keeps PCI scope minimal — card never touches our server).
3. Dojo fires **webhook** `payment_intent.status_updated` → `POST /api/webhooks/dojo` (verify, then): on `Authorized`/`Captured` mark booking `confirmed`, store `dojo_payment_intent_id` + status in `payments`.
4. **No-show:** capture the held auth (`POST /payment-intents/{id}/captures`). **Attended / valid cancel:** **reverse** the auth (`/reversal`) or refund a deposit per policy.

**Statuses mirrored in `payments.status`:** `Created → Authorized → Captured → Reversed/Refunded/Canceled`.
**Auth:** Basic auth, API keys (`sk_sandbox_…` test / `sk_prod_…` live) in env vars. **No official npm SDK** — thin `fetch` wrapper.

> Env: `DOJO_SECRET_KEY`, `DOJO_WEBHOOK_SECRET`, plus public key for the client component.

---

## 7. Routes & file structure (additions to existing repo)

```
src/
├─ lib/
│  ├─ data/brand.ts                      # EXISTS — bookingUrl already points here
│  └─ server/                            # server-only (never shipped to client)
│     ├─ db/
│     │  ├─ pb.ts                         # PocketBase client (server, admin token)
│     │  ├─ types.ts                       # TS types for geisha_* collections (§3)
│     │  └─ seed.ts                        # seed restaurants/tables/periods/settings per brand
│     ├─ booking/
│     │  ├─ availability.ts               # §4 checkAvailability / allocateTables
│     │  ├─ create.ts                     # createBooking (re-check + lock)
│     │  ├─ mutate.ts                     # cancel / seat / move / clear / noShow
│     │  └─ policy.ts                     # §5 deposit/hold rules from settings
│     ├─ payments/dojo.ts                 # §6 intents, capture, reverse, refund
│     ├─ email/confirmations.ts           # Resend templates
│     └─ ai/                              # §9 Claude tool-use (added incrementally)
│        ├─ tools.ts                       # tool schemas → booking/* functions
│        └─ agent.ts
├─ routes/
│  ├─ asia/bookings/+page.svelte          # themed widget (dark)
│  ├─ fusion/bookings/+page.svelte        # themed widget (light)
│  ├─ api/
│  │  ├─ availability/+server.ts          # GET ?brand&date&party → slots
│  │  ├─ bookings/+server.ts              # POST create
│  │  └─ webhooks/dojo/+server.ts         # POST Dojo webhook
│  └─ admin/                              # §8 — OPEN for now (no auth, see §11)
│     ├─ +layout.svelte                    # admin shell / nav / brand switcher
│     ├─ +page.svelte                      # dashboard (today at a glance)
│     ├─ floor/+page.svelte                # LIVE floor plan (Svelte Flow)
│     ├─ floor-editor/+page.svelte         # arrange tables (geometry → dining_tables)
│     ├─ diary/+page.svelte                # day/grid view of bookings
│     ├─ bookings/[id]/+page.svelte        # booking detail / edit / refund
│     ├─ tables/+page.svelte               # table CRUD + joins
│     ├─ customers/+page.svelte            # list/search + history + notes
│     └─ settings/+page.svelte             # editable policies (§5) + periods + hours
```

The customer widget reuses the existing themed components and `brand.ts`; the two
booking pages differ in **vibe only** (Asia dark / Fusion light), same logic.

---

## 8. Admin area (built open for now — no logins)

A single `/admin` section, brand-switchable (Asia / Fusion), styled utilitarian
(not the public art-direction — it's a back-office tool).

**8.1 Dashboard** (`/admin`) — today's covers, upcoming arrivals, no-show holds outstanding, quick "add walk-in".

**8.2 Live Floor Plan** (`/admin/floor`) — **the ResDiary replacement.** Built on **Svelte Flow**:
- Each `geisha_tables` row → a node at its `x/y`, sized/shaped per geometry, labelled (`T12`), coloured by `geisha_floor_state`: free / booked-upcoming / **seated** / finishing-soon / overdue.
- Click a table → see the booking, **Seat** (writes `geisha_floor_state.seated_at`), **Move** (drag booking to another free table), **Clear** (`cleared_at`), **Add walk-in**.
- **Joins** rendered as edges; selecting two tables offers "join for this booking".
- Live updates: PocketBase **realtime subscriptions** on `geisha_floor_state`/`geisha_bookings` (PB has this built in) so all staff devices stay in sync during service — no polling needed.

**8.3 Floor Editor** (`/admin/floor-editor`) — drag tables to arrange the room; saves `x/y/width/height/shape` back to `geisha_tables`. Done once per brand, occasionally tweaked.

**8.4 Diary** (`/admin/diary`) — pick a date → chronological + per-table grid of bookings; filter by status; click through to detail.

**8.5 Booking detail** (`/admin/bookings/[id]`) — edit party/time/table, resend confirmation, **capture / reverse / refund** the Dojo payment, mark no-show, add notes.

**8.6 Tables** (`/admin/tables`) — CRUD tables, set `seats_min/max`, `section`, `bookable`, define `geisha_table_joins`.

**8.7 Customers** (`/admin/customers`) — search, view history, edit `notes` (the field the AI reads for "prep for this guest").

**8.8 Settings** (`/admin/settings`) — edit every policy value from §5, service periods, turn times, opening hours, booking window. No developer needed. (Hours here can later feed the public site's hours block, replacing hard-coded values in `brand.ts`.)

---

## 9. AI enrichment layer (designed-in, added incrementally)

> The architecture exists so this is additive — no rework. File: `src/lib/server/ai/`.

**How:** Claude **tool-use** — the AI calls the *same* `src/lib/server/booking/*`
functions the UI uses. It never invents data; it reads/writes through real tools.

| Surface | Example | Technique |
|---|---|---|
| Customer widget | "Book 4 for Saturday 8pm" in plain English; suggest nearest slots when full | tool-use: `checkAvailability`, `createBooking` |
| Admin floor plan | "Best way to seat a party of 9 right now?"; "summarise how service is going" | tool-use over `floor_state` + `allocateTables` |
| Admin settings | "Change Fusion Sunday last booking to 5:30pm" | tool-use write → **confirm step** |
| Customers | "Which regulars haven't booked in 3 months?"; pre-arrival guest summary | tool-use + RAG over `geisha_customers.notes` |
| Comms | Draft confirmation / no-show follow-up copy | generative |
| Menus/allergens (site-wide) | "What's gluten-free under £15?" | RAG over existing `menus.*.ts` |

**Guardrails (mandatory before any AI write):**
- **Read tools** open; **write tools** (create/cancel/seat/charge/change-setting) return a *proposed action* requiring explicit confirmation in the UI.
- Every AI write goes through the same validation + **`audit_log`** (`actor='ai'`) as staff writes.
- AI never holds Dojo keys directly — it calls the payment functions, which enforce policy.

---

## 10. Build phases — STATUS

| Phase | Deliverable | Status |
|---|---|---|
| **P0** | `geisha_*` PB collections (migrated live) + timestamps migration; `db/pb.ts`, `db/types.ts`, `seed.ts` (placeholder tables) | ✅ done, verified live |
| **P1** | `availability.ts` + `allocateTables` + 12 unit tests | ✅ done |
| **P2** | `createBooking` (lock + period-window validation) + `policy.ts` + audit + `/api/availability`, `/api/bookings` | ✅ done, verified live |
| **P3** | Customer widget on `/asia/bookings` + `/fusion/bookings` (themed BookingPanel) | ✅ done, verified live |
| **P4** | Dojo: `payments/dojo.ts` (intent/capture/reverse/refund), `payments.ts` glue, `/api/webhooks/dojo`, wired into create/no-show/cancel/seat. **Graceful no-key mode.** | ✅ built + no-key verified; **needs DOJO keys to go live** |
| **P5** | Resend `email/send.ts` + `confirmations.ts`; confirmation on confirm, cancellation on cancel. **Graceful no-key mode.** | ✅ built + no-key verified; **needs RESEND_API_KEY** |
| **P6** | Admin shell + brand switcher + dashboard + **Tables** CRUD + **Floor Editor** (Svelte Flow, client-only) | ✅ done, verified live |
| **P7** | **Live Floor Plan** + seat/move/clear + walk-in assign + 20s auto-refresh | ✅ done, seat→clear lifecycle verified live |
| **P8** | Diary + Booking detail (cancel/no-show/seat/clear) + Customers (+ notes) + Settings | ✅ done, verified live |
| **P9** | `release.ts` 20-min auto-release sweep + `/api/cron/release` (secret-protected); audit wired through all writes | ✅ done, verified live (stale booking released; 401/503 guards) |
| **P10** | AI concierge: `ai/tools.ts` (read + confirm-gated write tools), `ai/agent.ts` (Claude tool-use loop + caching), `/api/ai`, `/admin/concierge`. **Graceful no-key mode.** | ✅ built + no-key verified; **needs ANTHROPIC_API_KEY** |
| **P11** | Auth pass — protect `/admin` + `/api` mutations + AI writes (see §11) | ⏳ deferred (next) |

**Tally:** 30 unit tests passing, 0 type errors, production build green. Three modules (Dojo/Resend/AI) are fully wired and run in graceful no-key mode — they go live the moment their keys are added to `.env`. Remaining real-world inputs: real table inventory (§13 Q2), the three API keys, `CRON_SECRET`, and the P11 auth pass before public exposure.

---

## 11. Deferred: authentication (explicitly out of scope here)

The admin area and AI write-tools are built **open** for now so we can move fast.
Before any real deployment, **Phase 11** adds:
- Auth on all `/admin/*` routes and `/api` mutation endpoints (SvelteKit `hooks.server.ts` guard). **PocketBase has built-in `users` auth** — likely reuse it for staff logins rather than adding Lucia.
- Roles (staff vs manager) gating destructive actions (refunds, settings, AI writes).
- The `geisha_audit_log.actor` already distinguishes staff/ai/system, ready for real user IDs.

> Until Phase 11, **do not expose `/admin` or the AI write tools on a public URL.**

---

## 12. Environment variables (server-only)

```
POCKETBASE_URL=https://pmm.gtdigital.dev    # reused pmm instance
POCKETBASE_ADMIN_EMAIL=giles.turnbull2001@gmail.com
POCKETBASE_ADMIN_PASSWORD=…                  # server superuser token for writes
DOJO_SECRET_KEY=sk_prod_…           # sk_sandbox_… in dev
DOJO_PUBLIC_KEY=…                   # for the client Card/Wallet component
DOJO_WEBHOOK_SECRET=…
RESEND_API_KEY=…
ANTHROPIC_API_KEY=…                 # AI phase only
TZ=Europe/London
```

---

## 13. Open questions to confirm before P0

1. ~~DB engine~~ **RESOLVED: PocketBase, reused `pmm` instance, `geisha_` prefixed collections.** See `geisha-server-pocketbase` memory.
2. **Real table inventory** per brand: how many tables, seat ranges, sections (Main/Window/VIP), and which are walk-in-only — needed to seed and to draw the floor plan. **(Still the main blocker for a real seed/floor plan.)**
3. **Turn times** the restaurants actually use (per party size / period).
4. Confirm the exact **deposit/no-show amounts** still match spec §6 (£5pp Fri/Sat 3–5; £10pp 6+).
5. Whether **opening hours** should become DB-driven (admin settings) or stay in `brand.ts` for now.
```

This document is the single source of truth for the booking build; update it as decisions firm up.
