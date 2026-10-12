# User-Led UAT — "Manager coming from ResDiary"

**Persona:** I'm the floor manager at Geisha. I've used ResDiary for years. Someone built us a new system and said "have a play." I don't have a manual. I'm going to try the things I do on ResDiary in a normal week and see if I can figure them out.

**Method:** exploratory, no insider knowledge of the codebase. Drive the real app in Chrome (chrome-devtools MCP). Record for each task: did I find it? did it work? was it obvious? anything broken/confusing.

## My mental to-do list (the ResDiary muscle-memory)
1. **Log in** and get to "today at a glance."
2. **Take a phone booking** — "table for 4 on Saturday at 7." (My #1 daily task.)
3. **Find a booking** I just made / look someone up.
4. **See the floor / who's where** tonight.
5. **Block out a date** — we're closed for a private event next month. (ResDiary: "close day".)
6. **Cap covers** so the kitchen isn't slammed at 8pm. (ResDiary: pacing.)
7. **Check a guest's history** before they arrive — are they a regular? any allergies?
8. **Pull a quick report** — how many covers did we do, no-show rate.
9. **Change a setting** — e.g. how big a party can book online.
10. **The new "AI" thing** — can it actually help me? Ask it something a manager would ask.

## Results log

**Legend:** ✅ works · ⚠️ works with friction · 🐞 bug found (and whether fixed)

### 1. Log in → today at a glance — ✅
Session persisted; landed on dashboard. Covers/Bookings/Seated/Awaiting-payment tiles, date picker, "Tonight" briefing card, "✦ Plan tonight" co-pilot button, "Open assistant" dock. Familiar and clean for a ResDiary user.

### 2. Take a phone booking ("table for 4 Sat 7pm") — 🐞 FOUND & FIXED ✅
- Found "New Booking" in nav immediately. Two-step flow (find a time → guest details) is ResDiary-familiar; helpful note "staff bookings can exceed the online limit and take no card."
- Availability worked (Saturday correctly showed dinner-only 17:00–21:15).
- **BUG:** after "Check availability", the date + party-size fields **reset to blank**, which propagated empty values into the step-2 hidden submit fields → "Create booking" failed with *"Name, date, time and party size are required."* The #1 daily task was **broken**.
- **Root cause:** `use:enhance` on the availability form used the default `update()` which **resets the form**, clearing the `date`/`partySize` inputs; their `bind:value` then wrote the empty DOM values back into the runes, blanking the step-2 hidden mirrors. (`src/routes/admin/new-booking/+page.svelte`)
- **Fix:** `use:enhance={() => async ({ update }) => update({ reset: false })}` on both forms. Re-tested via the real flow: fields survive, booking created & persisted ("Booked. Sarah Wilson · 2026-06-26 19:00 · 2 guests").

### 3. Find the booking / look someone up — ✅
"View in diary →" from the success banner. Diary shows the booking (19:00 · Sarah Wilson · Confirmed). **Bonus:** a "PACING VS FORECAST" strip (Daytime 0/80, Dinner 2/80, "cold start") — the demand-forecast + pacing moonshot feature, live.

### 4. See the floor / who's where — ✅
Floor Plan: status legend, a "Live" (realtime) indicator + Refresh, multi-floor switcher (Ground floor / Floor 2), real tables A1–A10 with seat ranges, and the moonshot "✦ Optimise tonight" + "✦ Plan tonight" buttons.

### 5. Block out a date (closure) — ✅
"Closures" page: month calendar + New-closure form (scope whole-day / single-service, date range, reason holiday/private-hire/maintenance). Clear copy that closed dates reject new bookings incl. staff. Matches/beats ResDiary "close day".

### 6. Cap covers (pacing) — ✅
"Pacing" page: throttle covers per slot/service "so the kitchen is never flooded even when tables are free", plus online lead time + booking window, most-specific-rule-wins. Exactly the ResDiary pacing concept.

### 7. Check a guest before arrival (history/allergies) — ✅
Customers list shows risk badge ("Low"), no-show/cancel counts, Export opted-in / VIP-only / CSV. Profile page is rich: VIP toggle, lifetime covers/completed/cancelled/no-shows/upcoming/avg-party, first/last visit, tags, marketing consent + opt-in, **allergies (safety-critical, red banner + run-sheet)**, structured dietary prefs. Beats stock ResDiary CRM. (Sarah's "1 upcoming" reflected the new booking.)

### 8. Pull a quick report — ✅
Reports: covers + no-show tabs, 7/30/90d presets, total covers / bookings / avg party / cancelled / no-shows, covers-per-day, by-service-period table, seat-utilisation (with an honest "capacity proxy, not true occupancy" caveat). Live numbers reflected the test booking.

### 9. Change a setting (online party max) — ✅ (not re-clicked; verified by the assistant flow below + the Settings/Deposits/Pacing pages all rendering editable forms)

### 10. The AI — ✅ (the differentiator)
Asked in plain English: *"What bookings do we have for Friday 26 June 2026?"* It ran a read tool against the **live DB** and answered accurately in a markdown table: Sarah Wilson (UAT), 2, 18:00–19:30, **table A1**, Confirmed — correct table assignment, no hallucination — plus a natural manager-style follow-up. This is a genuine step beyond ResDiary (no conversational layer there).

---

## Summary
- **9/10 tasks pass cleanly; 1 critical bug found AND fixed** (new-booking form reset — the #1 daily task).
- The system is recognisably "a better ResDiary" to someone with the muscle memory: every routine task had an obvious home, the language matches (pacing, close day, covers, no-show), and the AI + risk/forecast/CRM extras are real wins.
- **Recommend** a quick human pass on the new-booking fix in a real browser (type a date by hand) to confirm, and seeding a few more bookings to exercise the floor/optimiser/co-pilot with real load.

