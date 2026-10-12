# Email setup — new domain, Brevo, and getting it connected

The code is done. This is the account and DNS work, in the order it has to happen.

**Budget about 90 minutes, most of it waiting.** Domain registration and DNS
propagation are the slow parts; the rest is minutes.

---

## Why this order matters

Brevo will **accept** your API call and then silently drop the message if the
sending domain isn't authenticated. The failure is asynchronous — it shows up in
Brevo's log, not in ours. So a run of "sent" confirmations can be delivering
absolutely nothing.

That's why DNS comes before the key, and why the last step is a real message
landing in a real inbox.

---

## Step 1 — Buy the domain on Vercel

You don't have access to `geisharestaurants.co.uk`'s DNS, so we use a domain you
control. Vercel is a fine registrar for this and keeps DNS in the same place as
the app.

1. Vercel dashboard → your account → **Domains** → **Buy a domain**.
2. Search for something clearly Geisha-ish. Suggestions, best first:
   - `geisharestaurants.co.uk` — check first, it may be available for transfer later
   - `geishabookings.co.uk`
   - `geisha-newcastle.co.uk`
   - `geishabenton.co.uk`
3. Buy it. `.co.uk` is usually ~£10–20/year.

**Pick one you'd be happy sending from for years.** Changing a sending domain
later means redoing all of this, and you lose the sending reputation you've built
up in the meantime.

A caution on the name: guests will see it in the From address. `geishabookings.co.uk`
reads as legitimate; something that looks nothing like the restaurant reads as
phishing and gets marked as spam by recipients, which actively harms delivery.

Once bought, Vercel manages its DNS automatically — that's where you'll add the
Brevo records.

---

## Step 2 — Create the Brevo account

1. Sign up at **brevo.com**. The free tier allows 300 emails/day, which is well
   above what these restaurants will send.
2. Brevo will ask what you're using it for — **transactional**, not marketing.
   It affects which parts of the dashboard they show you.
3. Verify your own email address when they ask.

---

## Step 3 — Add and authenticate the domain in Brevo

1. Brevo → **Senders, Domains & Dedicated IPs** → **Domains** → **Add a domain**.
2. Enter the domain you just bought.
3. Brevo shows you a set of DNS records. **Leave this tab open** — you need the
   exact values, and they're unique to your account.

You'll get roughly:

| Type | Host / Name | Value |
| --- | --- | --- |
| TXT | `brevo-code` (or `@`) | a verification string |
| TXT | `mail._domainkey` | a long DKIM public key `k=rsa;p=MIGf...` |
| TXT | `@` | `v=spf1 include:spf.brevo.com ~all` |

---

## Step 4 — Add those records in Vercel

1. Vercel → **Domains** → your new domain → **DNS**.
2. **Add** each record from Brevo, matching Type / Name / Value exactly.

Three things that trip people up:

- **The DKIM value is long and must be one unbroken string.** Copy-paste it;
  don't retype it, and don't let it wrap.
- **Only ONE `v=spf1` record per domain.** A second one invalidates both. On a
  fresh domain you won't have one, so just add Brevo's. If Vercel added one
  automatically, *edit* it to include `include:spf.brevo.com` rather than adding
  a second.
- **`@` means the domain itself**, not the literal character. Vercel's UI may
  show this as a blank Name field.

Optionally add a DMARC record — it improves deliverability and costs nothing:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@yourdomain.co.uk` |

`p=none` means "monitor, don't block" — the right setting to start with. Tighten
it later once you can see mail is flowing.

---

## Step 5 — Verify in Brevo

1. Back in Brevo, click **Verify** / **Authenticate**.
2. Vercel's DNS is usually live within a minute or two, but allow up to an hour.
3. You want green ticks on **all** records — DKIM especially. A verified
   `brevo-code` with an unverified DKIM will still deliver badly.

Don't continue until this is green. Everything after it depends on it.

---

## Step 6 — Get the API key

1. Brevo → **SMTP & API** → **API keys** → **Generate a new API key**.
2. Name it `Geisha booking system`.
3. Copy it — Brevo shows it once.

---

## Step 7 — Put it into the booking system

Admin → **Settings → Integrations → Email**:

| Field | Value |
| --- | --- |
| Brevo API key | the key from step 6 |
| From address | `Geisha Restaurants <bookings@yourdomain.co.uk>` |
| Reply-to address | an inbox the restaurant actually reads |

The **From** mailbox doesn't need to exist — nothing is delivered to it. The
**Reply-to** must be real, because guests will reply to confirmations to ask for
changes. Point it at whatever address the restaurant already monitors.

Leave the Resend field empty. Brevo takes precedence whenever its key is set;
clearing the Brevo key is the instant rollback.

---

## Step 8 — Send a test

On the same page there's a **Send a test email** box.

1. Enter your own address, click **Send test**.
2. It uses the same layout, sender and plain-text part as a real guest
   confirmation.

Check all four:

- [ ] It **arrives** (within a minute)
- [ ] It's **not in spam**
- [ ] The **sender name** reads correctly, not a raw address
- [ ] It looks right on your **phone**, not just desktop

If it lands in spam, DNS is the cause 95% of the time — go back to step 5 and
confirm every record is green.

---

## Step 9 — One real booking

Make a real booking through the widget with your own email, then check the
confirmation arrives with the reference and a working **Change or cancel** link.

Then delete the booking from the diary.

---

## What now sends automatically

| Email | When |
| --- | --- |
| **Booking confirmed** | On booking, or once a deposit clears. Carries reference, manage link, and what happened with money. |
| **Booking updated** | Time, party or table changed. Says what it was as well as what it is. |
| **Booking cancelled** | Including whether the deposit was refunded or kept. |
| **Reminder** | Day before service (the no-show reducer). |
| **Refund issued** | A deposit went back to the card. |
| **Missed booking charge** | A no-show fee was taken from the stored card. |

Those last two are new. They matter more than they look:

- A **refund** is invisible on a statement for days, so guests chase it — by
  phone, during service.
- A **no-show charge** lands on a statement with a merchant name and no context.
  Without an email, the guest's first move is their bank, not the restaurant.
  That email is the difference between a fee and a chargeback, and it's also the
  evidence you want on file if they dispute it anyway.

Every message ships an HTML and a plain-text version. That's partly for watches
and screen readers, and partly because a transactional email with no plain-text
part is a spam signal in its own right.

---

## Troubleshooting

**"Sent" but nothing arrives.** Almost always the sending domain. Check Brevo →
**Logs** — it will show the message as blocked or dropped with a reason.

**Lands in spam.** Check DKIM is verified, SPF has exactly one `v=spf1` record,
and DMARC exists. A brand-new domain also has no reputation, so the first few
days are the worst — it improves as real mail flows.

**Nothing sends at all.** Admin → Settings → Integrations. If no Brevo key is
set, the system logs what it *would* have sent and carries on. Bookings still
work; guests just don't hear anything.

**Wrong From address.** `EMAIL_FROM` in Settings overrides the built-in default.
The domain must match the one you verified in Brevo, or Brevo drops it.
