# Fusion iframe swap — runbook

Swap the ResDiary widget on `geisharestaurants.co.uk/fusion/bookings/` for the new
booking system for a few days, then put it back exactly as it was.

**Asia is untouched throughout.** It is a separate WordPress install and none of
this goes near it.

---

## What I found on their site (verified, not assumed)

This is why the swap is a small, safe edit rather than a scary one.

**The widget lives on exactly ONE page.** I checked `/fusion/`, `/menus/`,
`/contact/`, `/offers/`, `/parties/` and `/bookings/`. Only `/fusion/bookings/`
contains the widget `<div>`.

**The loader script is site-wide but self-disabling.** In the theme footer, on
every page, there is:

```js
setTimeout(function () {
  if (document.getElementById('rd-widget-frame')) {
    jQuery('#rd-widget-frame').load(jQuery('#rdwidgeturl').val());
  }
}, 500);
```

It is **guarded**. With no element of that id on the page, it does nothing. So we
never touch the theme, never need FTP, and never risk another page.

**The container divs are unstyled.** `.booking_booking`, `.book_left` and
`.book_right` appear in no stylesheet on the site — I downloaded and searched all
of them. They're plain blocks; the `max-width:285px; margin:200px auto` is
inline on the widget div itself. So our iframe can be sized properly and the
200px gap goes away.

**No page cache.** Plain nginx, no WP Rocket / LiteSpeed / Cloudflare cache
plugin. Edits appear immediately.

---

## Before you touch WordPress

Do these first. Steps 2 and 3 are the ones that cause real damage if skipped.

**1. Arm Stripe.** Tell me and I set `STRIPE_ALLOW_LIVE=1` on production. Until
then the widget takes bookings but no deposits.

**2. Close ResDiary's ONLINE availability for Fusion.** Not the diary — just the
online inventory. Otherwise ResDiary and Dishcult keep selling the same tables
with no visibility of the new system, and you will double-book. This is the
single biggest risk of the trial and it is not a code problem.

**3. Deal with existing ResDiary bookings.** Anything already booked into
ResDiary for the trial dates is NOT in the new diary. Staff working from the new
system will see an empty floor that isn't empty. Either print them, or enter them
into the new diary as walk-in-style bookings before you start.

**4. Tell the floor team.** New bookings arrive in the new diary, not ResDiary.
Both screens matter until the changeover completes.

**5. Do one real end-to-end booking yourself** on production once armed — pay a
deposit with a real card, check it lands in the diary and the confirmation email
arrives. Then cancel it and confirm the refund. Nobody has tapped through the card
form by hand yet; this is that test.

---

## The WordPress edit

### Step 1 — Back up

Pages → **Bookings** → edit. Switch to the **Text** tab (Classic editor) or the
**Custom HTML** block (Gutenberg).

Select all the HTML, copy it, paste into a text file, save it somewhere you'll
find it. WordPress keeps revisions too, but a file you control is faster to
restore under pressure.

Also copy this exact line somewhere obvious — it's what you paste back on the way
out:

```html
<div id="rd-widget-frame" style="max-width: 285px; margin: 200px auto;"></div>
```

### Step 2 — Swap the widget

Find that line (it sits inside `<div class="book_right">`). Replace it with:

```html
<div id="rd-widget-frame-PAUSED" style="display:none"></div>
<iframe
  src="https://geisha-black.vercel.app/embed/fusion/book"
  title="Book a table at Geisha Fusion"
  style="width:100%;max-width:440px;height:820px;border:0;display:block;margin:0 auto"
  allow="payment"
  loading="lazy"
></iframe>
```

**Why rename rather than delete.** The loader looks for the exact id
`rd-widget-frame`. Renaming it to `rd-widget-frame-PAUSED` makes the guard fail,
so ResDiary stays dormant — and rolling back is deleting seven characters. It also
leaves a visible marker in the page so nobody wonders later what happened.

**Why `allow="payment"`.** Without it the host page's permissions policy blocks
the Payment Request API and Apple Pay / Google Pay silently disappear from the
card form. Cards still work; the fast path doesn't.

**Why 820px.** Tall enough for the card step, which is the tallest. There is no
resize protocol between the frame and the page, so it's fixed — the widget
scrolls internally rather than clipping if anything overflows. If it looks wrong
on the day, tell me the number you want and I'll adjust, or I can add a
postMessage auto-resize (more moving parts, so not by default for a short trial).

### Step 3 — Fix the terms text: 8 hours becomes 12

The code now enforces a **12-hour** late-cancellation window, because that is what
ResDiary's own promotion T&Cs say and it is what a guest agrees to at the point of
payment. The page currently says 8. Leaving them contradictory hands anyone
cancelling in that window a clean argument for their money back.

Two paragraphs, both in `<div class="book_left">`:

> "...**A fee of £5 per person will be charged in case of a no-show or late
> cancellation (less than ~~8~~ **12** hours before booking time).**"

> "...**Deposits are not refundable in case of a no-show or late cancellation
> (less than ~~8~~ **12** hours before booking time).**"

**Careful — there is a third "8" on that page and it must NOT change:**

> "When booking a table for more than **8**, please give the restaurant a call"

That one is party size.

### Step 4 — Update, then verify

Hit Update, then hard-reload `/fusion/bookings/` in a **private window**.

---

## Verification checklist

Do all of these before you walk away.

- [ ] The new widget renders, and the ResDiary one is gone
- [ ] No 200px gap where the old widget was
- [ ] Works on a **phone** — this is where most bookings come from
- [ ] Page does not scroll sideways
- [ ] Pick a date → times appear
- [ ] Pick a Saturday lunchtime → **two** options appear (Standard + Bottomless Brunch)
- [ ] Pick a Wednesday → **one** option (Standard only)
- [ ] Book a party of 6 → asks for a **£60 deposit** and the card form loads
- [ ] Complete it with a real card → lands in the new diary as **confirmed**
- [ ] Confirmation email arrives with a working **Change or cancel** link
- [ ] Cancel via that link → refund confirmed
- [ ] Terms now say **12 hours** in both places, and "more than 8" is unchanged

---

## Rolling back

Two routes. Both take under a minute.

**Fast — WordPress revisions.** Edit the page → Revisions (Screen Options if you
can't see it) → pick the version from before your edit → Restore. Everything comes
back, including the terms text.

**Manual — reverse the two edits.**

1. Delete the whole `<iframe ...></iframe>` block.
2. Replace `<div id="rd-widget-frame-PAUSED" style="display:none"></div>` with the
   original line you saved:
   ```html
   <div id="rd-widget-frame" style="max-width: 285px; margin: 200px auto;"></div>
   ```
3. Change the two "12 hours" back to "8 hours" — **only if you are also reverting
   the new system.** If you keep taking bookings on the new system afterwards,
   leave them at 12.
4. Update, hard-reload, confirm the ResDiary widget loads.

Then **re-open ResDiary's online availability**, or the site will show a working
widget with nothing bookable — which is worse than the swap ever was.

### Roll back immediately if you see any of these

- Bookings not appearing in the new diary
- Deposits failing or double-charging
- Confirmation emails not arriving
- The widget not loading on mobile
- Any guest reporting they couldn't book

None of these need a discussion. Restore the revision, reopen ResDiary, tell me
what happened.

---

## Daily checks during the trial

**Morning:**
- New diary matches what you expect; nothing stuck in `pending_payment`
- Stripe dashboard: deposits are landing, no unexpected declines
- Brevo → Logs: confirmations delivered, not bouncing or dropping

**Watch for:**
- **Emails in spam.** `geisha.marketing` is a brand-new sending domain with no
  reputation. Some of the first will land in spam; it improves over days. Warn
  the team so they're not blindsided when a guest says they got nothing.
- **Dishcult bookings appearing in ResDiary.** If any get through despite step 2,
  copy them into the new diary immediately — that's the double-book scenario.

**Evening:** any guest who phoned because they couldn't book. That's the signal
that matters most, and it won't show up in any dashboard.
