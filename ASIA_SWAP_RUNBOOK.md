# Asia iframe swap — runbook

Swap the ResDiary widget on `geisharestaurants.co.uk/asia/bookings/` for the new
booking system, exactly as [FUSION_SWAP_RUNBOOK.md](FUSION_SWAP_RUNBOOK.md) did
for Fusion.

**Fusion is untouched throughout.** Asia is a separate WordPress install and none
of this goes near Fusion's.

---

## What I found on their Asia site (verified, not assumed)

**The widget div lives on exactly ONE page.** I checked `/asia/`, `/asia/menus/`,
`/asia/contact/`, `/asia/offers/`, `/asia/parties/` and `/asia/bookings/`. Only
`/asia/bookings/` contains `id="rd-widget-frame"`.

**The loader script is site-wide but self-disabling**, same as Fusion's:

```js
if (document.getElementById('rd-widget-frame')) {
  jQuery("#rd-widget-frame").load(jQuery("#rdwidgeturl").val())
}
```

It is **guarded**. With no element of that id, it does nothing. So we never touch
the theme and never risk another page. (The home page matches a grep for
`rd-widget-frame` only because the guard's own source contains the string — there
is no div there.)

**Asia's ResDiary account is `GeishaAsia/41012`**, fed from a hidden
`#rdwidgeturl` input in the footer.

**No page cache.** Plain nginx, no WP Rocket / LiteSpeed / Cloudflare cache
plugin. Edits appear immediately.

**One difference from Fusion:** Asia's widget div is `margin: auto`, not
`margin: 200px auto`. There is no 200px gap to clean up.

---

## The terms on Asia's page are already correct — do not "fix" them

This is the opposite of Fusion, where the page said 8 hours and the code enforced
12. I checked Asia's live rules in `/admin/settings/deposits?brand=asia` against
the page text:

| Asia's page says | Live rule | |
| --- | --- | --- |
| 3, 4 or 5 on Fri/Sat need card details, £5pp no-show | Priority 20 · 3–5 · Fri, Sat · no-show hold · £5.00 · manual capture | ✅ |
| 6 or more need £10pp deposit, off the bill | Priority 10 · 6+ · every day · deposit · £10.00 · auto capture | ✅ |
| More than 8 → phone the restaurant | `online_party_max` = 8; the widget offers 1–8 and shows the "please call" line with **0191 607 1100** | ✅ |
| Cancelled 20 minutes after booking time | `release_after_minutes` = 20 | ✅ |

**The one gap: "late cancellation" is never defined.** The code enforces a
**12-hour** window (`LATE_CANCELLATION_HOURS`), and that is what the guest agrees
to at the point of payment. Leaving it undefined on the page hands anyone
cancelling inside it a clean argument for their money back. Add the window to
both sentences — see Step 3.

---

## Before you touch WordPress

**1. Decide the Stripe question and set the keys.** See
[Asia's own Stripe account](#asias-own-stripe-account) below. Right now both
brands resolve `STRIPE_SECRET_KEY (shared)`, so Asia's deposits would land in the
same account as Fusion's.

**2. Arm Stripe.** `STRIPE_ALLOW_LIVE=1` on production, or the widget takes
bookings but no deposits.

**3. Close ResDiary's ONLINE availability for Asia.** Not the diary — just the
online inventory. Otherwise ResDiary and Dishcult keep selling the same tables
with no visibility of the new system, and you will double-book. This is the
single biggest risk and it is not a code problem.

**4. Deal with existing ResDiary bookings** for the swap dates. They are NOT in
the new diary. Print them or enter them before you start, or staff will work from
a floor that looks empty and isn't.

**5. Tell the Asia floor team.** New bookings arrive in the new diary.

**6. Do one real end-to-end booking yourself** on production once armed — pay a
deposit with a real card, check it lands in the Asia diary and the confirmation
email arrives. Then cancel it and confirm the refund.

---

## The WordPress edit

### Step 1 — Back up

Pages → **Bookings** → edit (it's page id 15). Switch to the **Text** tab
(Classic editor) or the **Custom HTML** block. Select all, copy, paste into a text
file, save it somewhere you'll find it.

Also copy this exact line somewhere obvious — it's what you paste back on the way
out:

```html
<div id="rd-widget-frame" style="max-width: 285px; margin: auto;"></div>
```

### Step 2 — Swap the widget

Find that line (inside `<div class="book_right">`) and replace it with:

```html
<div id="rd-widget-frame-PAUSED" style="display:none"></div>
<iframe
  src="https://geisha-black.vercel.app/embed/asia/book"
  title="Book a table at Geisha Asia"
  style="width:100%;max-width:440px;height:820px;border:0;display:block;margin:0 auto"
  allow="payment"
  loading="lazy"
></iframe>
```

**Leave the commented-out ResDiary `<iframe>` below it alone.** It's already
inert and it documents the old account (`GeishaAsia/41012`) for the rollback.

**Why rename rather than delete.** The loader looks for the exact id
`rd-widget-frame`. Renaming it makes the guard fail, so ResDiary stays dormant —
and rolling back is deleting seven characters. It also leaves a visible marker so
nobody wonders later what happened.

**Why `allow="payment"`.** Without it the host page's permissions policy blocks
the Payment Request API and Apple Pay / Google Pay silently disappear from the
card form. Cards still work; the fast path doesn't.

**Why 820px.** Tall enough for the card step, which is the tallest. Asia's first
step fits comfortably in 900px at 440px wide, and the widget scrolls internally
rather than clipping. Same component and same number as Fusion.

### Step 3 — Define the cancellation window

Two sentences in `<div class="book_left">`, both currently ending at
"late cancellation":

> "**A fee of £5 per person will be charged in case of a no-show or late
> cancellation** *(less than 12 hours before booking time)*."

> "**Deposits are not refundable in case of a no-show or late cancellation**
> *(less than 12 hours before booking time)*."

**Careful — do NOT touch the other numbers on that page:**

- "**20 minutes** after the original booking time" — that's the table release, and
  it is correct.
- "more than **8**, please give the restaurant a call" — that's party size, and it
  matches the live cap of 8 exactly.

### Step 4 — Two small text fixes while you're in there

Neither is required for the swap; both are visible to guests.

- The heading reads **"tBooking Made Easy"** — a stray `t`.
- "You can book your table easily online using **the ResDiary widget**" — it won't
  be ResDiary any more. Suggest: "using the form on this page".

### Step 5 — Update, then verify

Hit Update, then hard-reload `/asia/bookings/` in a **private window**.

---

## Verification checklist

- [ ] The new widget renders, and the ResDiary one is gone (not merely hidden)
- [ ] Works on a **phone** — this is where most bookings come from
- [ ] Page does not scroll sideways
- [ ] Pick a date → times appear
- [ ] The guest picker offers **1–8**, and 8+ shows "call 0191 607 1100"
- [ ] Book a party of 6 → asks for a **£60 deposit** and the card form loads
- [ ] Book 4 on a **Friday** → asks for card details, **charges nothing**
- [ ] Complete one with a real card → lands in the **Asia** diary as confirmed
- [ ] The deposit appears in the **Asia** Stripe account, not Fusion's
- [ ] Confirmation email arrives with a working **Change or cancel** link
- [ ] Cancel via that link → refund confirmed
- [ ] Terms now state **12 hours**; "20 minutes" and "more than 8" unchanged

---

## Rolling back

**Fast — WordPress revisions.** Edit the page → Revisions → pick the version from
before your edit → Restore.

**Manual — reverse the edits.**

1. Delete the whole `<iframe ...></iframe>` block.
2. Replace `<div id="rd-widget-frame-PAUSED" style="display:none"></div>` with the
   original line you saved.
3. Update, hard-reload, confirm the ResDiary widget loads.

Then **re-open ResDiary's online availability for Asia**, or the site will show a
working widget with nothing bookable — which is worse than the swap ever was.

### Roll back immediately if you see any of these

- Bookings not appearing in the Asia diary
- Deposits failing, double-charging, or landing in the wrong account
- Confirmation emails not arriving
- The widget not loading on mobile
- Any guest reporting they couldn't book

---

## Asia's own Stripe account

Everything below is account configuration; the code already supports it.

### If Asia and Fusion share one Stripe account

Nothing to do. The shared `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` /
`STRIPE_WEBHOOK_SECRET` serve both brands. This is a supported, deliberate
configuration, not a fallback.

### If Asia banks separately

Set these on Vercel production (Settings → Environment Variables), alongside — not
instead of — the shared ones:

```
STRIPE_SECRET_KEY_ASIA=sk_live_…
STRIPE_PUBLISHABLE_KEY_ASIA=pk_live_…
STRIPE_WEBHOOK_SECRET_ASIA=whsec_…
```

…and the matching `_FUSION` trio if Fusion also moves to its own account.

**The webhook is the part that's easy to get wrong.** In Asia's Stripe dashboard,
add a webhook endpoint pointing at the **same** URL as Fusion's —
`https://<host>/api/webhooks/stripe` — and send the same events
(`payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.canceled`, `setup_intent.succeeded`, `setup_intent.setup_failed`,
`charge.refunded`). That endpoint signs with its **own** `whsec_`, which is what
`STRIPE_WEBHOOK_SECRET_ASIA` holds.

The endpoint now verifies an inbound event against **every** signing secret it
holds and accepts it if any one matches. Before this change it checked a single
secret, so whichever brand's secret lost the race got a 401 on every event —
Stripe would retry for days while those bookings sat in `pending_payment`,
holding tables, unconfirmed, with no email sent.

**Verify the split** at `/admin/settings/integrations?brand=asia`. The
"Card payments — connection status" panel names the source per brand. It should
read `STRIPE_SECRET_KEY_ASIA` for Asia rather than `STRIPE_SECRET_KEY (shared)`.

Keys can also be entered per brand in that screen instead of as env vars; the
brand-specific **env var wins** over a stored value, deliberately, so a
deployment variable can't be shadowed by a stale row typed in months ago.
