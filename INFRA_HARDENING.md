# Infrastructure hardening — Geisha

Baseline audited **2026-07-31** by SSH + Vercel CLI against the live estate.
Everything in §1 is already done in code. §2 and §3 are console/SSH work only you can do.

The honest goal: ResDiary runs multi-region with a team on call. A single 1 GB droplet
cannot match that, and no amount of configuration will make it. What the steps below
*can* do is remove every single-point failure that is currently avoidable, and make the
ones that remain recoverable in minutes rather than never. That is the difference
between "it went down for 20 minutes on Tuesday" and "we lost the customer database".

---

## 1. Done in code (this branch)

| Area | Change |
|---|---|
| Booking spam | Per-IP sliding-window limit on `POST /api/bookings` (5/hr), `/api/waitlist` (5/hr), `/api/availability` (60/min) — `src/lib/server/util/rateLimit.ts` |
| Booking spam | Exact per-guest velocity guard from the DB: max 6 live forward bookings, max 2 per date — `src/lib/server/booking/velocity.ts`. Fails **open** so it can never cause an outage |
| Staff login | Brute-force limit, per IP (10/15 min) **and** per account (20/15 min) — `src/routes/admin/login/+page.server.ts` |
| Session forgery | `AUTH_SECRET` now **throws in production** instead of silently signing with the committed dev key — `src/lib/server/auth/staff.ts` |
| Headers | `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, HSTS on https, `no-store` + `noindex` on all `/admin` — `src/hooks.server.ts` |
| Outage: shell | Service worker precaches the app shell; network-first everywhere else so nobody is ever pinned to a stale build — `src/service-worker.ts` |
| Outage: data | Diary day cache mirrored to IndexedDB, 24 h cap — `src/lib/service/dayStore.ts` |
| Outage: usable | `/admin/offline` read-only run sheet (time, guest, pax, table, phone, allergies), printable, timestamped — `src/routes/admin/offline/` |
| Outage: honesty | Red "no connection" banner driven by a real reachability probe, not `navigator.onLine` — `src/lib/admin/connection.svelte.ts` + `/api/health` |
| Privacy | Sign-out purges the IndexedDB board **and** the service worker's runtime cache |

Verified: 901 tests pass, `svelte-check` 0 errors, production build succeeds, and the
rate limits were confirmed firing against a real preview build (6th booking → 429,
11th login → 429).

**Deliberately NOT built: an offline write queue.** Queued mutations need idempotency
keys, replay-time revalidation and a conflict review queue. A half-built version puts
two tills confidently seating the same table, which is worse than being read-only. The
design is in the "Tier 2" notes — it should be its own project, not a bolt-on.

---

## 2. DigitalOcean — do these in order

### 2.1 🔴 Close the SSH door (10 min)

6,166 failed root password attempts in 24 h. Root login with passwords is enabled
because a stale cloud-init file overrides the main config (sshd is first-match-wins).

**Keep your current SSH session open until you have verified a second one works.**

```bash
rm /etc/ssh/sshd_config.d/50-cloud-init.conf
# confirm the main config has:  PermitRootLogin prohibit-password
sed -i 's/^PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sshd -t && systemctl restart ssh
sshd -T | grep -E 'permitrootlogin|passwordauthentication'   # expect: prohibit-password / no
```

Then, from a **new terminal**, confirm you can still get in. Only then continue.

```bash
apt update && apt install -y fail2ban
systemctl enable --now fail2ban
fail2ban-client status sshd
```

Finally, a **DigitalOcean Cloud Firewall** (Networking → Firewalls) — outside the box,
so a compromised host cannot switch it off:
- SSH 22 — your IP only
- HTTP 80, HTTPS 443 — all IPv4/IPv6
- everything else — denied

### 2.2 🔴 Backups (30 min, including the restore test)

There are none. Newest Geisha copy is a hand-made file from 22 July. 238 bookings,
870 customers.

**a) PocketBase → Cloudflare R2** (you already have R2 credentials for media; make a
*separate* bucket and a *separate* scoped key — the media key must not be able to read
your database backups).

`https://pmm.gtdigital.dev/_/` → Settings → Backups:
- Auto backup cron: `0 4 * * *`
- Max keep: `14`
- S3 storage: **enabled**, pointed at the new R2 bucket
  (endpoint `https://<account>.r2.cloudflarestorage.com`, region `auto`, force path style **on**)

**b) DigitalOcean snapshots** — Droplet → Backups → enable weekly (~20% of droplet cost).
Covers the whole machine, not just the database.

**c) Test the restore. This is the step people skip and it is the step that matters.**
```bash
# on the droplet, into a scratch copy — NOT over the live pb_data
mkdir -p /tmp/restore && cd /tmp/restore
# download the backup zip from R2, unzip, then:
/opt/apps/pmm/pocketbase/pocketbase serve --dir=/tmp/restore/pb_data --http=127.0.0.1:8099
sqlite3 /tmp/restore/pb_data/data.db "select count(*) from geisha_bookings;"
```
An untested backup is a rumour. Do this once now, and again after any schema change.

### 2.3 🔴 Lock down PocketBase (15 min)

The database's own admin panel is on the public internet with brute-force protection
switched off, and one password is the key to everything.

1. **Turn the rate limiter on** — `/_/` → Settings → Application → Rate limiting →
   **Enable**. The rules are already defined; they are just inert.
2. **Enable OTP/MFA** on the superuser account (Settings → Auth).
3. **Rotate `POCKETBASE_ADMIN_PASSWORD`** and update it in Vercel (§3.1).
4. **IP-restrict the admin UI** in `/etc/caddy/Caddyfile`:
   ```
   pmm.gtdigital.dev {
       @adminui path /_/*
       @notmine not remote_ip <YOUR.IP.HERE>
       handle @adminui {
           respond @notmine "Not found" 404
       }
       reverse_proxy localhost:8093
   }
   ```
   Then `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`.
5. **Trim the logs.** `auxiliary.db` is 141 MB of request logs on a 24 GB disk, and
   `logIP: true` means it is a store of customer IP addresses. Settings → Logs → drop
   retention to 3 days.

### 2.4 🟠 Stop the box falling over (10 min)

961 MB RAM, no swap, four PocketBase instances + two Bun services + Caddy.

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -m
```

Then cap the neighbours so another client's runaway process cannot starve the
restaurant. For each *non-Geisha* unit (`pocketbase-blc`, `pocketbase-baseball`,
`pocketbase-wire`, `wire-functions`, `baseball-functions`):

```bash
systemctl edit pocketbase-blc      # etc.
# [Service]
# MemoryMax=200M
```

### 2.5 🟠 Patch and reboot (5 min, scheduled)

195 days uptime, `/var/run/reboot-required` set since 28 July — unpatched kernel CVEs.
All four clients go down together, so pick a Monday morning.

```bash
apt update && apt upgrade -y && reboot
```

### 2.6 🟠 Alerts you would actually notice (15 min)

Right now, if PocketBase dies at 6pm you find out when a host phones you.

- DigitalOcean → Monitoring → Alert Policies: droplet down, memory > 85%, disk > 80%,
  CPU > 80% for 5 min → email **and** SMS/Slack.
- An external uptime check (UptimeRobot free tier, Better Stack): every minute against
  `https://pmm.gtdigital.dev/api/health` **and** the live booking page. External is the
  point — a check running on the droplet cannot tell you the droplet is gone.

### 2.7 🟡 Give Geisha its own droplet (the biggest structural win)

A paying restaurant currently shares 1 GB with three other projects. A $18–24/mo 2 GB
droplet with its own PocketBase, its own backups and its own blast radius removes an
entire class of "someone else's project took the restaurant down". Do it once §2.1–2.4
are in place — those are urgent, this is important.

---

## 3. Vercel

### 3.1 🔴 Split Preview from Production credentials

`POCKETBASE_URL`, `POCKETBASE_ADMIN_EMAIL` and `POCKETBASE_ADMIN_PASSWORD` are set for
**both** Preview and Production. Every preview build of every branch reads and writes
the live restaurant database — a half-finished migration on a feature branch can delete
real bookings.

```bash
vercel env rm POCKETBASE_ADMIN_PASSWORD preview
vercel env rm POCKETBASE_ADMIN_EMAIL preview
vercel env rm POCKETBASE_URL preview
# then add preview-only values pointing at a scratch PocketBase instance
```

### 3.2 🔴 Confirm `AUTH_SECRET` before you deploy this branch

The code now **refuses to start** rather than sign sessions with the committed dev key.
It is set on Production today — but not on Preview, so preview deploys will fail loudly
until you add one. That is intended. Any long random string:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
vercel env add AUTH_SECRET preview
```

### 3.3 🟠 Attach a real custom domain

Production is `geisha-black.vercel.app`. A restaurant's booking link should be on the
restaurant's domain — for trust, for email deliverability, and so you are not tied to a
hostname Vercel owns. Note that deployment protection is `all_except_custom_domains`, so
adding the domain is also what makes the site publicly reachable under it.

### 3.4 🟠 Put a WAF in front of the booking form

The in-app rate limiter is per warm serverless instance, so a distributed flood still
gets more than its share (the DB velocity guard catches the rest, but only after the
request has cost you a function invocation and a PocketBase round-trip).

- Vercel → Firewall → enable Attack Challenge Mode availability, and add a rule:
  `POST /api/bookings` → rate limit 10/min per IP.
- Or add **Cloudflare Turnstile** to the guest booking widget. Free, invisible to real
  guests, and it ends scripted booking outright.

### 3.5 🟡 Verify the service worker on a preview URL first

A service worker persists in visitors' browsers, so it is the one change here that is
awkward to walk back. This one is network-first for everything except content-hashed
assets and deletes old caches on activate, which is about as safe as the pattern gets —
but check it on a preview deploy before promoting: load the site, go offline in
DevTools, confirm you get `/offline.html` and that `/admin/offline` shows the board.

---

## Order of work

1. §2.1 SSH — highest risk, 10 minutes
2. §2.2 Backups **with the restore test** — highest consequence
3. §2.3 PocketBase rate limiter + admin UI lockdown
4. §3.1 / §3.2 Vercel credential split
5. §2.4 Swap, §2.5 reboot, §2.6 alerts
6. §3.4 WAF, §3.3 domain
7. §2.7 Dedicated droplet

Steps 1–4 are roughly a morning's work and remove every finding that could plausibly
cost the client their business.

---

## Cron scheduling: why only DAILY crons live in vercel.json

**Vercel Hobby permits cron jobs that run at most once per day, and it enforces that
at DEPLOY time, not at run time.**

That is a sharper edge than it sounds. Adding the 15-minute release sweep to
`vercel.json` did not simply fail to schedule it — it made the entire project
**undeployable**:

```
Error: Hobby accounts are limited to daily cron jobs.
This cron expression (*/15 * * * *) would run more than once per day.
```

Every `vercel --prod` failed for two hours before anyone noticed, because nothing
happened to need deploying in between. If a deploy ever fails with that message,
this is why — the fix is not to retry, it is to take the sub-daily cron out.

### What runs where

| Job | Schedule | Runs from |
| --- | --- | --- |
| `/api/cron/reminder` | `0 10 * * *` | `vercel.json` — daily, so Hobby allows it |
| `/api/cron/feedback` | `0 10 * * *` | `vercel.json` — the morning-after 0–5 feedback email; daily by design |
| `/api/cron/release` | every 15 min | **the GTDS droplet's crontab** (below) |

The release sweep frees a table 20 minutes after a no-show (§6). Running it daily
would be worse than not running it at all — it would clear tables a day late — so it
cannot live on Hobby whatever we do.

### The droplet crontab line

`hooks.server.ts` already accepts an external scheduler via the `x-cron-secret`
header, for exactly this case. `CRON_SECRET` is already set in Vercel Production;
use the same value on the droplet.

```bash
# on the GTDS droplet, as root:  crontab -e
*/15 * * * * curl -fsS -X POST -H "x-cron-secret: PASTE_CRON_SECRET_HERE" https://geisha-black.vercel.app/api/cron/release >/dev/null 2>&1
```

Verify it authenticates before trusting it — a wrong secret returns 401 and the
sweep silently never runs, which is the exact failure this section exists to stop:

```bash
curl -si -X POST -H "x-cron-secret: PASTE_CRON_SECRET_HERE" \
  https://geisha-black.vercel.app/api/cron/release | head -1
# want: HTTP/2 200   (401 = wrong secret, 503 = CRON_SECRET unset on Vercel)
```

### If the project moves to Vercel Pro

Move the sweep back into `vercel.json` as
`{ "path": "/api/cron/release", "schedule": "*/15 * * * *" }` **and remove the
crontab line in the same change**, or it runs twice every 15 minutes.
