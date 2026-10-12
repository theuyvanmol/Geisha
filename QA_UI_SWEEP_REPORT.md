# Geisha — full UI test sweep

**Date:** 31 July 2026
**Target:** local dev server (`localhost:5173`) against the **live production PocketBase**
**Method:** 13 independent testers, each driving its own browser, none told how the system works
**Volume:** 261 raw findings · 559 screenshots · ~1,900 browser actions

---

## 1. Verdict in one paragraph

The engine underneath this product is sound. A dedicated integration tester filled every
8-cover table and join at a single time and could not produce a double-booking; every field
of every online booking arrived on the floor intact, to the minute, with no timezone drift;
the console was **completely clean across all 13 sessions** — not one JavaScript exception
in the entire sweep. What is broken is the layer the customer and the staff actually touch.
**Every Friday and Saturday booking on both brands is currently written to the database
unconfirmed and can never advance**, the guest is given no reference, no email and no way to
retrieve or cancel it, the booking form runs off the side of every phone at the final step,
and on the diary the irreversible "Cancel booking" button is painted on top of the "Seat"
button that staff press a hundred times a night. None of these are exotic edge cases. They
sit on the shortest path through the product.

---

## 2. How the sweep was run

### The fleet

Thirteen testers, each with a persona placed on a **friendly → aggressive** scale, as
requested. Friendly testers tolerate ugliness and give the benefit of the doubt; aggressive
ones are hostile to anything that looks wrong and actively try to break things.

| # | Tester | Role | Temperament | Scope |
|---|---|---|---|---|
| G1 | Easily-pleased regular | Guest, browsing | ●○○○○ friendly | Public site, both brands, desktop |
| G4 | Well-meaning customer | Guest, booking | ●○○○○ friendly | Asia booking flow, birthday for 4 |
| G5 | Enthusiastic first-timer | Guest, booking | ●●○○○ | Fusion rotary dial flow |
| G7 | Booking from the pub | Guest, booking | ●●●○○ careless | Both brands, phone only |
| G3 | Phone-only, impatient | Guest, browsing | ●●●●○ hostile | Public site, phone + landscape |
| G2 | Design critic having a bad day | Guest, browsing | ●●●●● hostile | Public site, odd viewports, keyboard |
| G6 | The customer from hell | Guest, booking | ●●●●● hostile | Junk input, edges, double-submit, Back |
| A1 | New host, second week | Admin, service | ●○○○○ friendly | Diary: a full shift's jobs |
| A3 | Section waiter with an iPad | Admin, service | ●●○○○ | Floor plan + run-sheet |
| A4 | Owner on a Sunday night | Admin, back office | ●●●○○ | Reports, CMS, settings (**read-only**) |
| A5 | Manager running the door off an iPad | Admin, service | ●●●●○ | Whole admin on tablet + phone |
| A2 | Manager who has broken every system | Admin, service | ●●●●● hostile | Diary: drags, races, contradictions |
| X1 | Consultant hired to find lost bookings | Both | methodical | Website ↔ floor, field by field |

Each was given a URL, a login, safety rules, and a persona — and **no explanation of how
any screen works**. Everything they learned, they learned by looking. Where a tester
couldn't work out how to do something, that is recorded as a finding rather than a failure.

### The harness

Claude Code's subagents share a single MCP browser, so parallel testers would have stolen
each other's tab (I verified this with a two-agent probe before building anything). Instead
each tester got its **own headless Chrome** on a dedicated debug port and profile, driven by
a small purpose-built CLI (`qa-drive.mjs`) offering `snap` / `click` / `type` / `drag` /
`shot` / `log`, with page-side capture of console output, failed network requests and native
dialogs that survives navigation. Testers took screenshots constantly and *read them back as
images*, so visual findings are based on what the page actually looked like.

### Data safety

The local dev server writes to the **live droplet PocketBase holding real customer
bookings**, so the sweep was fenced before it started:

- Full snapshot of 16 collections taken first (230 bookings, 865 customers).
- Test dates 5–16 Oct 2026, each verified to hold **zero** existing bookings and no
  closures, and confirmed bookable (37 Asia / 39 Fusion slots) — so any "no availability"
  finding is a real bug and not an artefact of the dates I chose.
- One date per tester, a `ZZQA-xx` name tag each, and a standing rule never to touch a
  record they did not create.
- The back-office tester (A4) was **forbidden from saving anything at all**, and its report
  ends with a list of 20 controls it deliberately left untested so the gap is visible.

**Result — proven, not asserted.** Final diff against the pre-test snapshot:

```
added: {}      deleted: {}      bookings modified: none
```

57 test bookings, 32 customers, 25 payments and 5 floor-state rows were created and all
removed in dependency order. **Zero pre-existing records were deleted, and not one real
booking was modified.**

One residue, disclosed: `geisha_settings/j1ogcyt98c8kkhe` — the row
`staff_ui:erje1p52n86lnvq`, which is the *owner account's own* UI preference
(`{"brand":"asia","diaryChromeCollapsed":true}`). Testers logging into that shared account
and switching brands rewrote it. Its previous value wasn't captured, so I have not guessed
at a restore; it is a two-field display preference that will be overwritten the next time
you use the admin.

---

## 3. The blockers

261 raw findings deduplicate to **7 distinct blockers**. The corroboration column shows how
many independent testers hit each one without knowledge of the others.

### B1 — Every Friday and Saturday booking is stuck unconfirmed, on both brands
**Found by:** G4, G5, G6, G7, X1 (5 testers) · **Verified in code + live config**

The guest reaches a step headed "Confirm your card" or "Secure your table", is told a
deposit or card is required, and is given **no card field, no button and no redirect** —
followed immediately by the words "Your table is reserved." The API says
`status: pending_payment, confirmed: false, mode: "manual_fallback"`.

Root cause is in `src/lib/server/booking/payments.ts:84-89`: with no Dojo credentials
`session.configured` is false, so the mode is always `manual_fallback` — and both guest
widgets only render a payment control on the `hosted` branch
(`BookingPanel.svelte:614`, and the equivalent in `FusionBookingDial.svelte`). Everything
else falls through to reassuring prose.

I checked all three places a key could come from: `.env` (empty), **Vercel production (no
`DOJO_*` variable exists at all)**, and `geisha_settings` on the live droplet (no row). So
this is production behaviour, not a dev artefact.

**The scope is far wider than "large parties."** The live rule table:

| brand | kind | party range | days | amount |
|---|---|---|---|---|
| asia / fusion | deposit | 6 – ∞ | any day | £10.00 pp |
| asia / fusion | noshow_hold | **1 – ∞** | **Fri, Sat** | £5.00 pp |

`party_min` is 1 and `party_max` is 0 (unbounded), so the Friday/Saturday hold fires for
**every booking at every party size** — G6 proved it by booking a party of one on a Friday.
The website publishes "Fri & Sat, 3–5 guests." So: the two busiest trading nights of every
week, at any size, on both restaurants, plus every party of 6+ on any day.

> The fix worth shipping today is not Dojo. It is that `manual_fallback` must say
> *"please call us to secure this table — we can't take payment online"* instead of
> *"your table is reserved."*

### B2 — A booked guest is left with no evidence the booking exists
**Found by:** G4, G6, X1, G7 (4 testers) · **Verified in code + live config**

No booking reference is ever displayed (the id exists, it is simply never shown). No email
arrives — `RESEND_API_KEY` is absent from `.env`, **absent from Vercel production**, and
absent from `geisha_settings`, so `send.ts` takes its documented "log instead of dispatch"
path in production. There is no lookup page, and no cancellation route
(`DELETE`/`PATCH`/`POST /cancel` all 404). One press of the browser Back button destroys the
confirmation permanently; nothing is stored locally.

The self-service page `/book/[token]` **is fully built** — but `buildManagementUrl` is
referenced only by its own test file, so nothing ever links to it. Meanwhile the restaurant
charges £5/head for late cancellation the guest has no online way to make.

### B3 — The last step of the booking form runs off the side of every phone
**Found by:** G3, G4, G7 (3 testers, independently reaching the same CSS line)

`BookingPanel.svelte:759` sets `.row { grid-template-columns: 1fr 1fr }` with no
`min-width: 0` on the inputs and no mobile media query — so the inputs' intrinsic minimum
gives the card a hard **465px** at *every* phone width, including a 430px iPhone Pro Max.
Measured 490/365 at 375px. The PHONE and EMAIL fields, the step-5 chip and the **Confirm
Booking button all sit off the right edge**, and the page slides sideways whenever a field
is focused, slicing labels off the left. Steps 1–3 fit fine — it breaks only at the last
step, after the customer has done all the work. Both brands, no phone size where it fits.

### B4 — On the diary, "Cancel booking" is painted on top of "Seat"
**Found by:** A2, A5 (2 testers) · **Independently verified by measurement**

I re-opened a booking card on test data, touched nothing, and measured:

| control | x | y | w | h | occupies |
|---|---|---|---|---|---|
| `Seat` | 877 | 805 | 56 | 25 | y **805–830** |
| `Cancel booking` | 877 | 819 | 323 | 29 | y **819–848** |

Same left edge, **overlapping by 11px**, with the full-width destructive control painted
last. Hit-testing at Seat's *exact centre* returns the dead container — so **Seat is not
clickable at all** — while two pixels lower returns `BUTTON.btn.danger`. The same is true of
In bar, Table ready and Finished.

The failure mode requires no mistake: you attempt the correct action, nothing happens, you
click again, and you cancel a real guest's table — with "email the guest a cancellation"
pre-ticked. A5 found the iPad has the same collision by a *different* mechanism
(`.pop-actions` is `position:sticky; bottom:0`, hiding all five status buttons beneath the
red bar). Seating is the most repeated act of a service; cancelling is irreversible.

### B5 — A repeat email silently renames every earlier booking by that guest
**Found by:** A3, A2, X1 (3 testers) · **Verified in code**

`geisha_bookings` has **no name field** — the name is read through a customer record keyed
on email, and `upsertCustomer` (`queries.ts:350`) unconditionally overwrites it:

```ts
const existing = await coll.getFirstListItem<Customer>(match);
return await coll.update<Customer>(existing.id, {
    name: input.name,                          // <-- clobbers history
    phone: input.phone ?? existing.phone,
```

A3 made five bookings under five names on one email; all five became the last name entered,
across diary, run-sheet and floor plan at once. A2 confirmed the old name then becomes
**unsearchable** — the guest arrives and the diary says they don't exist.

There is a second defect in the same three lines: `??` does not fall back on an empty
string, so a later booking submitted without a phone number **erases the stored phone** on
every earlier booking by that guest. That's the run-sheet's Phone column — the one used to
ring a late table — going blank.

The trigger is *a repeat email*, which is the normal case: a regular typing "Dave" instead
of "David", a couple sharing an address, a PA, a concierge desk.

### B6 — One click on Settings can destroy the deposit and table-allocation config
**Found by:** A4 · **Verified in code — deliberately not executed**

The generic Save action (`admin/settings/+page.server.ts:102-106`) is
`String(f.get('value'))`, with a comment admitting *"settings are numbers in this build"* —
no longer true. The page renders every row in `geisha_settings`, several of which now hold
JSON, so the field displays `[object Object]` and Save writes that literal string over
`deposit_rules`, `table_chains` or `table_ranks` — the rules that take guests' money and the
config that drives automatic table allocation. No confirmation, no type check, nothing
distinguishing these rows from the safe numeric ones.

Recoverable only from `geisha_audit_log` (which does record the previous value), never from
the UI. **Neither A4 nor I pressed the button** — the verification is by code reading,
because the target is live production configuration.

Related, same screen: two `staff_ui:<staffId>` rows — **other staff members' private UI
preferences** — are rendered as editable settings to anyone who opens the page. Both are
visible in the live collection.

### B7 — The admin is unusable on a phone
**Found by:** A5

`.admin` is `grid-template-columns: 1fr` (so the track takes min-content) plus
`overflow:hidden`, and the topbar's `.service-bar` won't shrink below 374px, so the column
resolves to **500px clipped inside a 375px screen with `scrollLeft` immovable by touch**.
Measured `scrollWidth 500 / clientWidth 375`. **Book (x=434), Walk-in (417), Search (417),
the Asia/Fusion switch (419) and the zoom controls are permanently unreachable by a finger.**
A host holding an iPhone cannot take a booking. A5 suggests the one-line class of fix:
`minmax(0, 1fr)` plus a wrapping or scrolling topbar.

---

## 4. Recurring themes across the 93 major findings

Rather than list all 93, these are the patterns. Full detail is in the per-tester files.

**Published rules contradict configured rules — everywhere.** The maximum online party size
has *five* different values: copy says 8 (Asia) and 30 (Fusion), the Fusion picker stops at
12, the Asia input allows 31, the live setting is 30, and the API accepts 50. G6 completed a
12-cover booking against a stated limit of 8. The card rule says 3–5 guests and applies to
1+. The website says the kitchen closes at 11pm; the guest AI chatbot's hand-typed prompt
says 10pm. Deposits are configured in two places in two different units — pence on one
screen, pounds on another.

**Two brands, one stylesheet, and it leaks.** G2 found five of ten Fusion pages set their
`h1` in Asia's Cormorant Garamond instead of Fusion's Libre Baskerville, and six of ten do
it for body copy. Fusion's "Discover our menu" medallion is filled with an Asia photograph
of a Japanese izakaya, ringed by the word "BURGERS".

**The Fusion header is broken on the most common laptops.** Four testers independently hit
"Contact" overprinting the BOOK A TABLE button between ~1250px and ~1650px — including
1366×768 and 1440×900. The rendered text literally reads `BOOKCOntaCtABLE`. It is sticky, so
it defaces the primary CTA on every Fusion page for the entire visit, and it swallows the
Contact link's clicks.

**Floating furniture eats the interface.** The Uber Eats ribbon (240×240, fixed) renders
*above* modal scrims including the gallery lightbox close button. The Ask Geisha bubble is
drawn inside the Fusion phone input and over Asia's Confirm button. On mobile, six prime
evening slots (19:00–20:15) sit under the fixed nav bar — tapping 20:00 opens the burger
menu. The admin's Assistant dock covers the floor plan's table panel.

**The screens disagree with each other.** Reports gives three different booking counts for
the same brand and range (97 / 123 / 113) with nothing to reconcile them. The Floor Plan
shows every table free on a date whose own header says 37–45 covers — it only ever paints
*this instant*, but has date arrows and no explanation. Saving a diary edit doesn't refresh
the diary, though inbound bookings from other devices sync live in ~10s. Two dinner totals
appear side by side in one header.

**Silent state loss.** Switching the booking form to Dinner leaves `12:00` selected — a time
no longer offered anywhere in the control — and it saves; a host takes an evening booking and
creates a lunch one (confirmed in source: the chips write `bkPeriodId` and nothing
reconciles `bookM.time`). Rapid clicks on the covers stepper are silently lost — screen said
17, database saved 12. An entirely empty New Booking form creates an anonymous reservation.
One click outside the form discards everything typed.

**The 404 page.** Found by five testers. `#000000` text on `#0E0C0A` — contrast 1.05:1 — with
no branding, no links, and an empty `<title>`. Any stale link, old QR code or typo lands the
visitor on what looks like a crashed tab.

**Time handling.** Between midnight and 1am during BST — seven months a year — the diary and
floor loaders open on *yesterday*, because "today" is `new Date().toISOString().slice(0,10)`
in UTC (`diary/+page.server.ts:79`, `floor/+page.server.ts` ×6). For a restaurant serving to
23:45, that's exactly when staff are closing down the night. The correct pattern already
exists in this codebase at `assistant.svelte.ts:435`.

**Accessibility and touch.** Tap targets consistently below the 44px minimum across both the
public site and the admin. Fusion dial numerals render at 9px. Keyboard focus walks into a
closed dropdown. No `autocomplete` attributes on name/phone/email. The Fusion nav drawer
can't be dismissed by tap-outside or Escape and doesn't block the page behind it.

---

## 5. What is genuinely good

Worth stating plainly, because it is a lot:

- **Zero JavaScript exceptions in 13 sessions and ~1,900 actions.** Not one. Every finding
  in this report is design, layout or logic — nothing is crashing.
- **The allocation engine is trustworthy.** X1 filled every 8-cover table and join at 20:00
  across seven parties of eight and produced seven distinct table sets and **zero
  double-bookings**. The site correctly withdrew the whole overlapping 17:45–21:15 window,
  and restored 20:00 the moment a booking was cancelled.
- **Data survives the trip.** Every field of every online booking arrived on the floor
  intact, including the time to the minute — no timezone drift anywhere in the guest path.
- **Persistence is solid.** A1 refreshed after all 11 state changes (create, seat, finish,
  retime, re-pax, add-table, drag, no-show); nothing reverted or came back wrong.
- **XSS is escaped everywhere it was tried**, on both the guest and admin sides.
- **Double-clicking Create produces exactly one booking.**
- **Drag-to-move works with a real finger** on both tablet and phone, and survives a reload.
- **A 12-top auto-joined tables 35+36+37 unprompted** — the chain logic works.
- **The run-sheet is the standout screen in the product**: printable, allergy-flagged,
  correct totals, with a print stylesheet that survives a mono printer.
- Close-outs are date-scoped with clear save/revert feedback; the sold-out state ("That's us
  for today", with a phone number) is excellent; the capacity error copy, drag-retime
  confirmation and no-show confirmation are all well written; typing a date into the Fusion
  box spins the dial to match perfectly.
- The admin AI assistant **respected "don't change anything"** and asked permission before
  proposing any action.

---

## 6. Reliability of this report

Things I checked rather than passed on:

- **One finding is withdrawn.** G1 reported an 81.6-second image load. Re-fetching the same
  R2 objects serially after the fleet quietened returned every one in **0.14–0.26s**. That
  number was my test rig — eight headless browsers sharing one connection — not the CDN.
  **Treat every timing-based finding in these reports as unreliable and re-measure
  single-user before acting.** The residue that is real: the Asia homepage references 39
  distinct media URLs in its initial HTML, worth reviewing for lazy-loading and `srcset`
  breakpoints, but that is a suggestion, not a measured defect.
- **A2 retracted its own claim** that horizontal drag-to-retime was dead, after discovering
  its later actions were dismissing the confirmation modal. It re-tested, confirmed the move
  persists, and removed the finding rather than filing it.
- **B4 and B6 were verified by me independently** of the testers who reported them — B4 by
  geometric measurement rather than clicking, B6 by code reading rather than pressing Save.
- Every root cause quoted above was read in the source, not inferred from behaviour.

**Known gaps — what this sweep did *not* cover:**

- **Saving anything in the back office.** A4 was read-only by design, and its report lists
  20 controls it deliberately left alone: every Save/Delete/toggle on Settings, Tables,
  Closures, Pacing, all Content tabs, Team, guest records, and "Plan tonight". B6 suggests
  that area deserves a dedicated pass against a database copy.
- **Real payment.** No card details were entered anywhere, so nothing past the payment wall
  has been exercised — and given B1, nothing *can* be until Dojo is configured.
- **Real email delivery**, for the same reason.
- **Concurrency between staff** — two hosts editing the same booking simultaneously.
- **Genuine devices.** Touch was emulated, not physical; and every tester ran headless
  Chrome, so Safari/iOS-specific behaviour is untested.
- The working tree had **uncommitted changes to the booking engine and both guest booking
  widgets** during the sweep (`availability.ts`, `create.ts`, `queries.ts`,
  `BookingPanel.svelte`, `FusionBookingDial.svelte`), so some guest-flow findings may relate
  to work in progress rather than shipped code.

---

## 7. Suggested order of work

1. **Make `manual_fallback` tell the truth** (B1). A copy change and a visible phone-us
   route. This stops the bleeding on every Fri/Sat booking today, without waiting for Dojo.
2. **Fix the Seat/Cancel overlap** (B4). Staff are one mis-click from cancelling real guests
   right now, on both desktop and iPad.
3. **Show a booking reference on the confirmation** (B2). One line of markup; it gives the
   guest something to quote on the phone even with email unconfigured.
4. **Stop `upsertCustomer` overwriting the name and phone** (B5) — snapshot the guest name
   onto the booking row. This is corrupting data on every repeat email.
5. **Add the mobile media query to `BookingPanel`** (B3) and `minmax(0, 1fr)` to `.admin`
   (B7). Two small CSS fixes that restore the phone experience for guests and staff.
6. **Make object-valued settings read-only** (B6) and hide `staff_ui:*` from that list.
7. Configure `RESEND_API_KEY` and the `DOJO_*` keys in Vercel, then re-test the whole
   payment and email path — none of it has ever run.
8. Reconcile the published rules against the configured ones (party size, card rule, opening
   hours) and fix the UTC "today" in the service loaders.

---

## 8. Where everything is

| Path | What |
|---|---|
| `.qa/findings/Z-coordinator-verified.md` | Root causes I verified in code + live config |
| `.qa/findings/G1…G7-*.md` | Seven guest testers, friendly → hostile |
| `.qa/findings/A1…A5-*.md` | Five admin testers |
| `.qa/findings/X1-cross-channel.md` | Website ↔ floor integration, field by field |
| `.qa/shots/` | 559 screenshots, prefixed by tester code |
| `.qa/QA_BRIEF.md` | The brief every tester was given |
| `qa-snapshot-before.json` | Pre-test database snapshot |
| `qa-snapshot.mjs` / `qa-verify.mjs` / `qa-cleanup.mjs` | Snapshot, diff and cleanup harness |

Each per-tester file opens with a short narrative in that persona's voice — how the product
*felt* to that kind of person — followed by its findings in full, a "what worked well"
section, and a coverage list of every URL visited.
