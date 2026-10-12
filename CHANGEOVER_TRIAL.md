# Changeover trial — running the new booking system inside the old website

The client wants to take real bookings through the new system for a few days
**before** the DNS moves, by swapping the ResDiary iframe on
`geisharestaurants.co.uk/fusion/bookings/` for one pointing at this app.

This is the runbook. Code is done; what's left is account configuration and one
WordPress edit.

---

## 1. What was built

| Piece | Where |
| --- | --- |
| Embeddable widget | `/embed/{asia\|fusion}/book` |
| In-frame confirmation | `/embed/{asia\|fusion}/confirmation` |
| Bookable options ("offers") | `src/lib/data/bookingOptions.ts` → `GET /api/booking-options` |
| Stripe REST client | `src/lib/server/payments/stripe.ts` |
| Payments facade (Stripe-only) | `src/lib/server/payments/index.ts` |
| Stripe webhook | `POST /api/webhooks/stripe` |
| Client-side reconcile | `POST /api/bookings/[id]/payment-complete` |
| Brevo transport | `src/lib/server/email/brevo.ts`, wired into `email/send.ts` |

The widget's flow mirrors ResDiary's, deliberately: **date + guests → time →
option → details → card → confirmation redirect**. The redirect carries
ResDiary's own query string (`?bookingReference=…&date=…&time=…&partySize=…`),
so anything already reading those parameters keeps working.

---

## 2. The WordPress edit

On `/fusion/bookings/`, the ResDiary widget is:

```html
<div id="rd-widget-frame" style="max-width: 285px; margin: 200px auto;"></div>
```

…driven by `WidgetV2Loader.js` further up the page. **Delete both**, and put this
in place of the div:

```html
<iframe
  src="https://YOUR-APP-HOST/embed/fusion/book"
  title="Book a table at Geisha Fusion"
  style="width:100%;max-width:440px;height:760px;border:0;display:block;margin:0 auto"
  allow="payment"
  loading="lazy"
></iframe>
```

Asia's page is the same with `/embed/asia/book`.

Three details that matter:

- **`allow="payment"` is required.** Without it the host page's own permissions
  policy blocks the Payment Request API and Apple Pay / Google Pay silently
  vanish from the card form. Cards still work; the fast path doesn't.
- **`height:760px`** — taller than ResDiary's 640 because the card step needs the
  room. There's no postMessage resize protocol, so it's a fixed height; the
  widget scrolls internally rather than clipping.
- **The old `max-width:285px` wrapper must go.** At 285px the card form is
  unusable.

To send guests to the client's existing WordPress thank-you page instead of ours,
append `?redirect=https://geisharestaurants.co.uk/fusion/thank-you/`. Only our own
origin and `geisharestaurants.co.uk` (± `www`) are accepted — anything else falls
back to the built-in confirmation.

---

## 3. Stripe — what you need to do in the dashboard

Nothing below is in code; it all lives in the Stripe account.

**Account setup**

1. Create (or open) the Stripe account. If Asia and Fusion settle to **different
   bank accounts**, you need either two Stripe accounts or two connected accounts
   — the code supports a separate key pair per brand.
2. Complete **business verification / activation** (company details, bank
   account, ID). Until this is done the account is test-mode only, so start it
   now — it is the long pole, not the code.
3. Settings → Payments → **Payment methods**: enable Cards, and Apple Pay and
   Google Pay if you want them (they cost nothing extra and convert better on
   mobile). Leave Link on or off as you prefer.
4. Settings → **Public details**: set the statement descriptor to something a
   guest will recognise on their bank statement (e.g. `GEISHA FUSION`). A deposit
   they don't recognise is a chargeback.

**Apple Pay domain verification** (skip if you didn't enable Apple Pay)

5. Settings → Payments → Payment methods → Apple Pay → **Add a new domain**, and
   register the host serving `/embed/...`. Stripe will ask you to serve a
   verification file — it can do this automatically for domains it can reach.

**Keys**

6. Developers → **API keys**. Copy the **publishable** key (`pk_…`) and the
   **secret** key (`sk_…`).
   - For the trial rehearsal, use **test** keys first (`sk_test_` / `pk_test_`).
   - For the live trial, use live keys **and** set `STRIPE_ALLOW_LIVE=1` on the
     deployment. Without that variable a live key is deliberately inert — the
     system reports "not configured", takes no deposits, and confirms bookings
     normally. This exists because local dev writes to the live database.

**Webhook**

7. Developers → **Webhooks** → Add endpoint:
   - URL: `https://YOUR-APP-HOST/api/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`,
     `payment_intent.canceled`, `setup_intent.succeeded`,
     `setup_intent.setup_failed`, `charge.refunded`
8. Copy the endpoint's **signing secret** (`whsec_…`).

**Enter the three values**

9. Either in Admin → Settings → Integrations → *Stripe payments (website)*, or as
   environment variables (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
   `STRIPE_WEBHOOK_SECRET`). Settings take precedence for the secret key except
   where a brand-specific env var is set.

**Test before the trial**

10. With test keys, book a party of 6 (triggers the £10pp deposit) using card
    `4242 4242 4242 4242`, any future expiry, any CVC. Then `4000 0025 0000 3155`
    to exercise 3-D Secure, and `4000 0000 0000 9995` to see a decline.
11. Check the booking lands in the diary as **confirmed**, and that the Stripe
    dashboard shows the payment with `booking_id` in its metadata.

### API versions — keep all three on one train

Stripe's guidance is that the server API version, the webhook destination's
version and the Stripe.js version should be on the same release train. They now
all sit on **Dahlia**:

| Where | Value |
| --- | --- |
| Server API calls | `2026-07-29.dahlia` — `API_VERSION` in `payments/stripe.ts` |
| Webhook destination | `2026-07-29.dahlia` — set in the Stripe dashboard |
| Stripe.js in the browser | `https://js.stripe.com/dahlia/stripe.js` |

The last one matters more than it looks: a **versioned Stripe.js pins its own API
version and gives you no way to override it**, so loading the old `/v3/` script
while the server talks Dahlia lets the browser and the server disagree about an
object with no way to reconcile. (`/v3/` still works and isn't deprecated — it's
just "no longer recommended".)

If you ever change the version on the webhook destination, change these two with
it. Checked before bumping: none of the ~32 Clover or the Dahlia breaking changes
affect creating or reading PaymentIntents, SetupIntents, Customers or Refunds, and
the `status` field on both intent types is unchanged.

### How the two money shapes work

- **Deposit** (6+ covers, Bottomless Brunch) → a PaymentIntent, charged
  immediately, refundable from the admin.
- **Card guarantee** (Fri/Sat, 3–5 covers) → a **SetupIntent**. Nothing is
  charged; the card is stored against a Stripe Customer and billed only if the
  guest no-shows.

The obvious alternative — an authorisation hold — does **not** work here: an
uncaptured authorisation expires after 7 days and this restaurant takes bookings
months out. It would evaporate on exactly the bookings a guarantee exists to
protect.

One consequence to be aware of: because no money is held, a no-show charge can be
**declined** (expired or blocked card). The charge throws rather than failing
silently, so staff find out.

---

## 4. Brevo — domain and DNS

Brevo will accept the API call and then drop the message if the sending domain
isn't authenticated. That failure is asynchronous — it shows up in Brevo's log,
not in ours — so a run of "sent" confirmations can be delivering nothing. Do the
DNS first.

1. Create the Brevo account, then **Senders, Domains & Dedicated IPs → Domains →
   Add a domain**: `geisharestaurants.co.uk`.
2. Brevo gives you records to add. At the DNS host for `geisharestaurants.co.uk`:

   | Type | Host | Value |
   | --- | --- | --- |
   | TXT | `brevo-code` (or as shown) | the verification string Brevo gives you |
   | TXT | `mail._domainkey` | the DKIM value Brevo gives you |
   | TXT | `@` | add `include:spf.brevo.com` to the **existing** SPF record |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@geisharestaurants.co.uk` |

   **Do not add a second SPF record.** A domain may have only one `v=spf1` TXT
   record; a second one invalidates both. Edit the existing one to include
   `include:spf.brevo.com` before its `~all`.

   ⚠️ **The mail server for this domain is the OLD web server.** Changing MX or
   breaking SPF will break the restaurant's actual email. Only add the records
   above; do not touch MX.

3. Wait for Brevo to show the domain **authenticated** (usually minutes, up to a
   few hours).
4. Brevo → **SMTP & API → API keys** → create a key.
5. Enter it in Admin → Settings → Integrations → *Email* → Brevo API key, or as
   `BREVO_API_KEY`.
6. Set the **From address** to something on the verified domain, e.g.
   `Geisha Restaurants <bookings@geisharestaurants.co.uk>`, and a **Reply-to**
   the restaurant actually reads.
7. Send a test booking to a real inbox and check it isn't in spam.

Rollback: clear the Brevo key and email falls straight back to Resend, no deploy.

---

## 5. Deployment variables

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_live_…` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` |
| `STRIPE_ALLOW_LIVE` | `1` — **production only** |
| `BREVO_API_KEY` | Brevo API key |
| `EMAIL_FROM` | `Geisha Restaurants <bookings@geisharestaurants.co.uk>` |
| `EMAIL_REPLY_TO` | a monitored inbox |
| `PUBLIC_SITE_URL` | the app's own origin (**not** the WordPress site) |

`PUBLIC_SITE_URL` matters more than it looks: the "change or cancel" link in the
confirmation email is built from it when there's no guest request to read an
origin from (the Stripe webhook, the reminder cron). Point it at the WordPress
site and every manage link 404s.

Framing is already allowed for `geisharestaurants.co.uk` and `www.` — no config
needed. For a different staging host, set `FRAME_ANCESTORS` (space-separated);
note it **replaces** the built-in list.

---

## 6. During the trial: Dishcult and ResDiary

**This is the operational risk of the trial, and it is not a code problem.**

For the trial period, bookings arrive through **two systems that cannot see each
other**:

- the new widget, into this database, and
- ResDiary — which is still live, and still fed by **Dishcult**, plus any
  phone/walk-in bookings staff enter there out of habit.

Two systems each believing they own the same tables will double-book. The new
system's availability engine has no idea a Dishcult booking exists, so it will
happily sell a table ResDiary has already given away.

Options, roughly in order of how well they work:

1. **Close ResDiary's online availability for the trial window.** Zero out its
   inventory (or close the dates) so Dishcult and the ResDiary widget can't sell
   anything, while the diary stays readable for existing bookings. This is the
   only option that removes the race rather than managing it.
2. **Trial one brand only** — Fusion, since that's the page being swapped. Half
   the exposure, and Asia stays a clean control.
3. **Manual mirroring** (what you suggested): staff watch ResDiary for Dishcult
   arrivals and re-enter them in the new diary. Workable for a few days, but it's
   a human polling loop during service, and the window between a Dishcult booking
   landing and someone copying it across is exactly when the double-book happens.
   If you go this way, mirror **into** the new system promptly and treat the new
   diary as the truth for seating.
4. **Trial only outside peak** (e.g. weekday lunches) so a collision has slack to
   absorb it.

I'd push for (1) plus (2). Worth checking with ResDiary whether Dishcult
inventory can be switched off independently of the diary — I haven't verified
that from here.

Also: existing ResDiary bookings for trial dates are **not** in the new system.
Whichever route you take, the runsheet needs both until the changeover completes.

---

## 7. Copy that must change on the WordPress page

**The terms text beside the iframe says 8 hours. It has to say 12.**

The two live systems disagreed, and had for years:

| Where | What it says |
| --- | --- |
| WordPress `/fusion/bookings/` page copy | *"late cancellation (less than **8 hours** before booking time)"* |
| ResDiary promotion T&Cs — shown **inside** the booking widget | *"late cancellation (under **12 hours** notice)"* — on all three promotions |

The engine now enforces **12** (`LATE_CANCELLATION_HOURS` in `policy.ts`), because
12 is the *point-of-sale* term: it is what a guest agrees to at the moment they
hand over a card, in ResDiary today and in our widget, which renders the option's
T&Cs verbatim. Marketing copy beside the form doesn't override the terms attached
to the payment.

But that makes the page's own "8 hours" a live contradiction sitting directly
beside our iframe. **Edit both paragraphs on the WordPress page to say 12 hours**
at the same time as swapping the iframe in. Conflicting terms are read against the
business, so leaving 8 there hands any guest who cancels between 8 and 12 hours out
a straightforward argument for their money back.

Every guest-facing sentence about the window is interpolated from that one
constant, so the number and the behaviour can't drift apart again on our side.

**Also worth fixing: the cookie banner.** It still says the booking form "is
provided by ResDiary and loads from their servers". Once bookings come through the
new widget that's untrue, and it's a privacy notice, so it should name what
actually loads (Stripe).
