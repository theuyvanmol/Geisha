# Floor Plan ↔ Diary parity plan

**Goal.** Bring the **Floor Plan** service view (`/admin/floor`, the "table view")
up to the **Diary** (`/admin/diary`) in reactiveness and feature coverage, and do
it by **extracting shared modules** so the two views can never drift apart again.

The two views are sibling tabs of the `(service)` shell (Diary · Floor Plan ·
Run-sheet) and already share the same server layer (`$lib/server/booking/*`) plus
two client stores (`$lib/admin/realtime`, `$lib/admin/assistant`). The floor is
1.5k lines last touched 26 Jun; the diary is 9.5k lines with ~48 features and was
worked through 3 Jul. The gap is the **client interaction layer** the diary grew
inline and the floor never received.

Decisions locked with the owner:
- **Scope: full parity** — all ~30 gaps.
- **Approach: extract shared modules** used by BOTH diary and floor.

---

## STATUS (living)

- **Phase 0 — DONE.** Shared scaffold under `$lib/service/`: `bookingView.ts`
  (BookingView + fromDiaryBooking/fromFloorBooking adapters), `postAction.ts`
  (postServiceAction — robust fetch/deserialize/classify), `useMagicSearch.svelte.ts`,
  `DateNav.svelte`. Diary refactored onto `DateNav`. svelte-check + build clean.
- **Phase 1 — DONE (code).** Shared `BookingCard.svelte`, `CancelModal.svelte`,
  `CommentsModal.svelte`, `printSlip.ts`. Floor server got confirm/partialSeat/
  floorStatus/resetArrival/noShow/cancel/comments/resend/covers/reallocate/ackNew.
  Floor page wired: DateNav + magic search in the header, full BookingCard on tile-
  select (with turn-prediction block + Move-party retained), cancel/comments modals.
  svelte-check 0 errors, production build clean, no SSR/console errors on load.
  **Runtime interaction NOT yet verified** — the floor is auth-gated and the local
  browser session wasn't signed in; needs a manual click-through (tile → card →
  confirm/no-show/cancel/±covers/comments) OR credentials to script it.
- **Decision:** BookingCard was built as a clean shared component (BookingView +
  `dispatch`) and adopted on the FLOOR now; the diary keeps its battle-tested inline
  popover until a dedicated, separately-verified swap (protects the top risk). Same
  for magic search — the hook is proven against the real endpoint and used on the
  floor; the diary's bespoke scroll-to-bar search is left intact.
- **Phase 2 (closures half) — DONE (code).** Shared `closures.ts` (ServiceClosure +
  closureBanner/periodIdForTime/closureBlockReason) + `ClosureBanner.svelte`. Floor
  loader now assembles `closure`; floor server got addClosure/removeClosure; floor
  renders the banner + blocks the walk-in form when the current service is closed.
  Added `$lib/service/index.ts` barrel. svelte-check 0 errors.
- **Phase 2 (creation half) — DONE.** Shared `BookingModal.svelte` (party pills →
  availability search via `?/slots` → slot grid → optional table pins + diner details
  + duration → `?/create`). Floor server got `create` + `slots`. Floor header "+ Book".
- **Phase 3 — DONE.** Floor loader now returns `allBookings`, `waitlist`, `pacing`.
  Floor server got wlAdd/wlSend/wlSeat/wlConvert/wlCancel. Floor renders the booked-
  per-service meta strip + four toggle panels (Arrivals / Waitlist / Cancellations /
  Promotions) with working waitlist actions, all in the legend row.
- **Phase 4 — DONE.** Floor loader computes per-tile colour-scheme inputs + glance
  flags. Floor got the scheme picker (arrival/confirmation/preorder/channel/important/
  large-party — payment omitted, no payments join), tiles repaint via shared
  `barColour`, ResDiary tile flags (🔗/💬/🏷/⏱/🔔), a legend popup, and the keyboard
  cascade (`/` search, `L` legend, `Esc` closes most-specific overlay).
- **Phase 5 — DONE (targeted).** Optimistic tile-state patch: seat→seated / clear→free
  recolour the tile INSTANTLY, revert on failure, and clear when fresh loader data
  arrives. The deeper wholesale replacement of the floor's `conflictIfStale` safety
  guard was deliberately NOT done — it's a core-path change that most needs runtime
  verification (which the auth wall blocks), and the guard is a real anti-clobber
  safeguard. The floor already fires writes non-blocking (`liveAction` does
  `void update()`), so the acting device already felt responsive; this adds the
  instant recolour on top.

**All six phases: svelte-check 0 errors + production build clean.**

**Runtime verification note (unchanged):** interactive behaviour is UNVERIFIED — the
floor is auth-gated and the local dev browser session wasn't signed in. Needs a manual
click-through (or credentials to script one) to confirm the card actions, search,
date-nav, closures, creation modal, panels, colour schemes and optimistic recolour
behave at runtime. This is the one remaining gate before shipping.

---

## Already shared / reusable as-is (no work)

- `$lib/diary/magicSearch.ts` — pure ranking; floor can use verbatim.
- `$lib/diary/colourScheme.ts` — pure scheme→colour; verbatim.
- `$lib/data/promotions.ts` — `PROMOTIONS`, `daysLabel`; verbatim.
- `$lib/components/admin/DiaryIcon.svelte` — icon set; verbatim.
- `$lib/admin/realtime.svelte.ts` — `floorRealtime` store; both already use it.
- `$lib/admin/assistant.svelte.ts` — assistant dock; both already use it.
- `/api/admin/search?brand=&q=` — standalone search endpoint; floor calls directly.
- Server booking core — `amendBooking`, `seatBooking`, `clearBooking`,
  `createBooking`, `confirmBooking`, `markNoShow`, `cancelBooking`, `resetArrival`,
  `setFloorStatus`, waitlist family, `listClosures`/`getCloseouts`, etc.

**Naming note:** `magicSearch`/`colourScheme` live under `$lib/diary/`. Rather than
move them (churns diary imports for no behaviour gain), leave them and add new
shared code under **`$lib/service/`**. Optionally re-export them from
`$lib/service/index.ts` so the floor imports read `$lib/service/*` consistently.

---

## Shared modules to CREATE (`$lib/service/`)

Extracted from the diary's inline code, then the diary is refactored to import them
(proves the extraction + removes duplication). Each is view-agnostic: it takes a
booking-ish object + callbacks, not diary-specific timeline state.

1. **`DateNav.svelte`** — ‹ / › day steppers + centred weekday label + hidden
   native date picker. Props: `date`, `onChange(date)`. (~60 lines lifted from
   diary `stepDay`/`openDatePicker`/`.date-nav`.)

2. **`useMagicSearch.svelte.ts`** — debounced fetch of `/api/admin/search` +
   `rankResults`, exposes `{ query, results, loading, open, pick }`. Caller supplies
   `onPickBooking(id)` / `onPickCustomer(id)`. Wraps the existing pure module.

3. **`BookingCard.svelte`** — the ResDiary detail popover/card: action toolbar,
   left status menu, 2-col detail grid, allergy/notes/history, covers stepper,
   confirm/reallocate row, bottom actions (cancel/customer/history/view/resend/print).
   Props: a normalized `BookingView` + a `dispatch(action, payload)` callback so each
   host wires the action to its OWN form endpoint. This is the biggest extraction
   (~800 lines of markup+CSS) and the highest-value shared component.

4. **`statusActions.svelte.ts`** — the optimistic status-action helpers:
   `confirm / seat / partialSeat / clear / waitingBar / tableReady / resetArrival /
   noShow / reallocate / changeCovers / cancel / comments / resend / ackNew`.
   Each does: optimistic local patch → POST to the host's action → revert on failure.
   Parameterized by a `patch`/`revert` pair the host provides (diary patches a bar,
   floor patches a tile). Mirrors the diary's `runStatusAction`/`queueStatusWrite`.

5. **`CancelModal.svelte`** — reason picker + notify checkbox + live deposit-outcome
   preview (no-show/late/in-time/none). Props: `booking`, `onConfirm`.

6. **`CommentsModal.svelte`** — booking-comments + note-to-restaurant textareas.

7. **`BookingModal.svelte` + `WalkinModal.svelte`** — the two-pane new-booking modal
   and the simple walk-in modal (availability grid, period toggle, join suggestion,
   diner details, duration, overbook). Post to a host `?/create` / `?/walkin`.

8. **`ClosureBanner.svelte`** — closed-day/period banner + add/remove closure form.

9. **`printSlip.ts`** — `printBooking(booking)` window-print helper (pure).

10. **`normalizeBooking.ts`** — map either a diary `DiaryBar` OR a floor
    `FloorTable.booking` into the common `BookingView` the card/modals consume. This
    is the seam that lets one card serve two very different data shapes.

---

## Floor server actions to ADD (`floor/+page.server.ts`)

The floor server currently has: `seat, clear, move, seatOn, walkin, optimise,
applyMove`. Add (lift the diary's implementations, which already exist and are
tested in `diary/+page.server.ts`):

- `create` (future reservation, staff), richer `walkin` (diner details/overbook/
  duration), `slots` (availability grid), `confirm`, `partialSeat`, `floorStatus`,
  `resetArrival`, `noShow`, `cancel`, `comments`, `resend`, `ackNew`, `covers`,
  `reallocate`, `resize`(n/a on floor — skip), waitlist family (`wlAdd/wlSend/
  wlSeat/wlConvert/wlCancel`), `bookArea`, closures (`addClosure/removeClosure/
  saveCloseouts/addCloseout/removeCloseout`).

The floor **loader** must also start returning what these features need — most is
already loaded by the diary loader, so lift it: `waitlist`, `areas`, `closeouts`,
`tableCloseouts`, `pacing`, `closure`, and the per-booking fields the card shows
(promotion, menu, note flags, confirm attempts). Consider a shared
`loadServiceContext(brand, date, floorId)` in `$lib/server/booking/` so both
loaders assemble the same context (keeps the parallel-wave perf work in one place).

---

## Phased delivery (each phase = shippable + verified)

**Phase 0 — Extraction scaffold.** Create `$lib/service/` with `DateNav`,
`useMagicSearch`, `normalizeBooking`, `printSlip`, `statusActions`. Refactor the
DIARY to use `DateNav` + `useMagicSearch` first (smallest, safest swaps) to prove
the seam. Verify diary unchanged.

**Phase 1 — Floor Tier-1 essentials.**
- Add `DateNav` to the floor header (fixes the #1 gap: no date navigation).
- Add `useMagicSearch` to the floor header.
- Extract `BookingCard` from the diary; refactor diary to use it; then render it on
  the floor tile-select (replacing the bare side panel). Wire floor status actions.
- Add the Tier-1 floor server actions (confirm/noShow/cancel/reallocate/covers/
  comments/resend/partialSeat/floorStatus/resetArrival).
- Verify: on the floor, change date, search a guest, open a tile → full card →
  confirm / no-show / cancel / ±covers / comments / resend / print all work.

**Phase 2 — Creation + closures.**
- `BookingModal` + `WalkinModal` on the floor ("+ Book" / "+ Walk-in").
- Floor `create`/`slots`/rich-`walkin`/`bookArea` actions.
- `ClosureBanner` on the floor + closure/close-out awareness (block seating on a
  closed table; hatched-tile treatment).
- Verify: create a future booking + a walk-in from the floor; a closed service shows
  the banner and blocks the create.

**Phase 3 — Panels + meta.**
- Side panels (Arrivals / Waitlist / Cancellations / Promotions) as shared
  components; wire waitlist actions on the floor.
- Pacing/covers meta-strip.
- Verify each panel populates + acts.

**Phase 4 — Visual parity + polish.**
- Colour-scheme picker + legend on the floor (tiles paint via `barColour`).
- Tile flags: bell(+ack)/first-visit/note/promotion/leave-confirmed/joined.
- Shortcuts helper + keyboard cascade (`/` search, `Esc`, `L` legend).

**Phase 5 — Reactiveness.**
- Replace the floor's blocking `conflictIfStale` re-read with the diary's
  optimistic-patch + background-reconcile pattern (`scheduleReconcile`,
  echo-guarded reload). Makes the floor feel as instant as the diary.
- Final cross-device + verify pass.

---

## Risks / watch-items

- **Don't destabilize the diary.** It's battle-tested and huge. Each extraction is
  "lift into shared, then diary imports it, verify diary identical" — not a rewrite.
- **`BookingView` normalization is the crux.** The diary bar and floor tile carry
  different fields; get the mapping right or the shared card shows blanks. Write it
  first, unit-test it.
- **Loader perf.** The diary loader is carefully parallelised (region-pinned London
  PB, one wave). The floor must not regress to serial round-trips — reuse the same
  assembly.
- **Role gates.** Diary actions are `server+`/`manager+` per action; keep the same
  gates on the floor copies (the server fns re-assert anyway).
- **Scale.** This is genuinely large. Realistic as 6 sequenced PRs (one per phase),
  each independently verifiable, rather than one mega-change.
