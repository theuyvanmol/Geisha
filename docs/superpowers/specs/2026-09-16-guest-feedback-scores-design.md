# Guest feedback scores (ResDiary parity) — design

Approved with the owner on 2026-09-16.

## What it does

The morning after a visit, every guest who **booked online** gets an email asking
"How was your visit?" with a row of **0 1 2 3 4 5** buttons. They tap one, add an
optional comment, press Send. The scores show on **Reports → Feedback**.

Staff are not emailed about any score, low ones included (changed on the owner's
call after launch; see "Low-score alert — removed"). A 4 or 5 is offered a
"Leave us a Google review" button once the restaurant has pasted its link in.

## Who gets it

A booking qualifies when all of these hold:

- `source === 'online'` (only `POST /api/bookings` writes that).
- `status` is `completed` or `seated`. Seated counts because nothing auto-finishes a
  table staff forgot to clear. Cancelled and no-show never qualify.
- It started on an earlier London day than today, and no more than 48 hours ago.
  So a run the next morning covers yesterday, and a missed run catches up once.
- The guest has an email, is not erased (`deleted_at`), is not blocked, and has not
  opted out (`feedback_opt_out`).
- No `geisha_messages` row with template `feedback_request` for this booking, other
  than a `failed` one. A failed send retries on the next run.
- The brand's `guest_feedback.enabled` setting is on (the default).

The comms engine's unscheduled `thank_you` skips online bookings for any brand that
has feedback emails on, so no guest gets both.

## When

`/api/cron/feedback` runs daily at `0 10 * * *` from `vercel.json`, which is 11:00
BST / 10:00 GMT. That's within Hobby's once-a-day limit.
`?dry=1` lists who would be emailed and sends nothing.

## The link and the page

- `/feedback/[token]`, a bare page (no cookie banner or analytics) themed per brand
  like `/book/[token]`.
- The token is the same stateless HMAC scheme as booking links, but the MAC covers
  `feedback:${id}.${exp}`. A feedback token can't open `/book/[token]`, and a booking
  token can't open the feedback page. It lives 30 days from sending.
- **A GET never saves.** Mail scanners (Outlook Safe Links, Mimecast) fetch every
  link in a message. The score buttons open the page with that number preselected,
  and the guest presses Send, which is a POST.
- The guest can change their answer until the link expires; the last answer wins.
- `?stop=1` shows a "Stop feedback emails" confirm (also a POST). It sets
  `geisha_customers.feedback_opt_out = true`.

## Storage — `geisha_feedback` (new collection)

| field | type | notes |
|---|---|---|
| restaurant | relation → geisha_restaurants, required, cascade | |
| booking | relation → geisha_bookings, required, cascade | unique index |
| score | number, int, 0–5, **not required** | PB treats `0` as blank on a required number |
| comment | text | capped at 2000 chars server-side |
| visit_at | date | copy of booking.starts_at — report filter without a join |
| submitted_at | date | last submit |
| alerted_at | date | unused since the alert was removed; column left in place |
| source | text | `'email'` |
| created / updated | autodate | must be declared explicitly (see enquiries migration) |

All API rules are null (server-only; guest data). Also `geisha_customers +=
feedback_opt_out (bool)`.

## Settings — `guest_feedback` (per-brand json row)

`{ enabled: boolean, googleReviewUrl: string }`. The defaults are
`enabled: true` and a Google URL of `''` (no button). It's edited in a "Guest
feedback emails" section on /admin/settings and registered in `MANAGED_ELSEWHERE`.
A leftover `alertEmail` key from before the alert was removed is ignored.

## Low-score alert — removed

It shipped emailing the restaurant on a score of 0–2, and was taken out the same
day on the owner's call: no emails to staff about bad scores. Low scores are read
in the report (a "Low scores (0–2)" KPI, and each reply shows a call-back number).
The guest's thank-you page no longer says the manager has been told.

## Report — Reports → Feedback

A source switch: **Guest scores** (default) | **Imported reviews** (the existing view).

- KPIs: emails sent, replies (and reply rate), average score, low scores (0–2).
- Summary, by visit date (London): a count and % for each score 0–5, the average
  and the total, plus a totals row.
- Details: visit date, guest, party, ref, score, comment, submitted, booking link.
- CSV: `guest-scores-summary`, `guest-scores-details`.

## Going live

1. Deploy `pb_migrations/1786200000_geisha_guest_feedback.js` with
   `scripts/deploy-migration.sh`, which restarts pocketbase-pmm. **Ask the owner first.**
2. Merge the PR, which adds the Vercel cron.
3. The cron checks the collection exists and skips the send if it doesn't, so merging
   before the migration can't email guests a link that can't save.

## Testing

Unit tests (vitest), all pure:

- the candidate predicate;
- the scoped token (round-trip, cross-scope rejection, expiry, tamper);
- the 0–5 summary, including that 0 counts;
- config normalisation;
- the alert rule.

After that: svelte-check, build, an email preview rendered to a file, and a dry run
of the cron against the live data.
