# ResDiary Gap Analysis & Closure

Benchmarked the system against an exhaustive, source-checked catalogue of ResDiary's real feature set (from resdiary.com, their KB, and Capterra/GetApp reviews). Result: the system already matches the **vast majority** of ResDiary — including its cited differentiators — and we closed the genuine, in-scope gaps.

## Already covered (matches ResDiary, incl. its differentiators)
- **Yield/pacing** (covers caps per slot/service) — ResDiary's #1 differentiator ✅ (`pacing.ts`, /admin/pacing)
- Online booking widget + live availability + multi-channel diary ✅
- Table plan editor + joins (permanent via floor editor) + close-outs + turn times + average-time rules ✅
- Diary timeline/statuses/walk-ins + **waitlist** ✅
- Full **CRM**: profiles, history, notes, dietary, VIP, tags, no-show tracking, CSV export, group/per-brand DB ✅
- **Configurable deposits & card capture** (per cover/date/service/promotion) ✅ (deposit-rules engine)
- Automated **confirmation/reminder/cancellation emails** + GDPR consent + comms campaigns/segmentation ✅
- **Reports**: covers, no-shows, source/channel, spend, seat utilisation ✅
- **Review** collection + management ✅; **offers/promotions** ✅
- **User roles & permissions** (owner/manager/host/server, server-enforced, audited) ✅ — matches ResDiary's 4-tier model
- **Open API / custom build** ✅ (the whole thing is first-party)
- **Loyalty** (The Circle) ✅; gift-vouchers page ✅; self-service amend/cancel ✅
- **AI** far beyond ResDiary's thin "Copilot": risk scoring, seating optimiser, demand forecast, nightly briefing, anomaly alerts, NL floor-plan, and an autonomous evening-plan co-pilot ✅
- Responsive web admin (serves tablets — covers ResDiary Plus's core use) ✅

## Gaps found → CLOSED this round (built + MCP-tested)
1. **SMS sending** — `geisha_messages` had a `channel:'sms'` enum but nothing sent SMS. Built `src/lib/server/sms/send.ts` (provider-agnostic, keys via Integrations screen, graceful no-op when unconfigured, logs every attempt) + an optional SMS reminder path (`sms_reminders_enabled` setting). **MCP-tested:** Integrations page shows the new "SMS provider API key" + "SMS sender" rows with masked inputs + configured badges. Unit-tested send path (+11 tests).
2. **Table fill-ranking** — ResDiary "table rankings" (fill window tables last). Added `ranking.ts` (ranks in a `table_ranks` setting, no migration), wired into `allocateTables` (lower rank first; absent = identical to before — all existing availability tests still pass), + a "Fill order" admin section on /admin/tables. **MCP-tested:** the section renders with guidance.
3. **Set menu / pre-order at booking** — ResDiary common feature; these restaurants run set menus. Added an admin "Set Menus" editor (`/admin/settings/menus-preorder`), `/api/setmenus`, an optional pre-order selector on the public widget's details step, run-sheet + booking-detail surfacing, and migration `1772700700` for the optional `preorder` column (degrades gracefully until applied). **MCP-tested end-to-end:** created "Tasting Menu £55pp · 6 courses" in admin → it appeared in the public booking widget as "Tasting Menu — £55.00 pp · 6 courses, paired".

Final: `check` 0 errors (1078 files) · `test` **359/359** (+18) · `build` clean.

## Deliberately NOT built (out of scope or not locally implementable) — documented as future/external
- **Reserve with Google** — requires a Google partnership + verified-business feed; can't honestly build+test locally. *Future external integration.*
- **Multi-language widget** — ~14 langs in ResDiary; low value for two Newcastle venues. *Defer.*
- **Native iOS/Android staff app (ResDiary Plus)** — the responsive web admin already serves floor tablets; a native app + offline mode is a separate project. *Defer.*
- **POS/EPOS bill-sync** (for auto spend tracking) — the business keeps ICRTouch separate by design (per project decision); spend tracking stays manual unless a POS integration is later commissioned.
- **TheFork/aggregator marketplace** — ResDiary itself is deliberately direct-first (Dish Cult is modest); not a parity requirement.
- **Pre-auth card holds** — ResDiary doesn't truly support these either (tokenise-and-charge); our Dojo flow matches.

## Two manual go-live steps (unchanged + one new)
- Apply migration **1772700600** (collections) — via `scripts/deploy-migration.sh` (already done in this session's testing).
- Apply migration **1772700700** (booking `preorder` column) — scp + restart pmm, same as the deploy script. Until then, set-menu *selection* is captured client-side and the write degrades gracefully (no crash); applying the migration persists it to the booking.
- To enable SMS: add an SMS provider key at /admin/settings/integrations and flip `sms_reminders_enabled`.
