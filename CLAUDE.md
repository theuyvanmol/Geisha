# Geisha_2

## The dev server is not yours to start

**The owner runs `npm run dev` themselves. It lives at `http://localhost:5188`.**

Do **not** run `npm run dev`, `vite dev`, `npx vite`, or any variant — not in the
foreground, not in the background, not "just to check". One server serves everyone.

To use it:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5188/asia
```

- **200 (or any HTTP response)** — it's up. Use `http://localhost:5188`. That's all you need.
- **Connection refused** — it's down. **Ask the owner to start it.** Do not start it yourself,
  and do not treat this as a blocker for work that doesn't need a browser: finish everything
  else first, then say plainly that you need the dev server up to verify the rest.

`port: 5188, strictPort: true` in [vite.config.ts](vite.config.ts) enforces this — a second
start now fails with `Port 5188 is already in use` instead of quietly spawning a parallel
server on 5189. If you see that error, it is telling you the server you wanted is **already
running**. Use it. Do not "fix" it by picking another port or by killing the process — that
process is very likely the owner's, with their browser session and warmed module cache in it.

### Things that look like a broken server but aren't

- **The first `/admin/diary` request takes 30–60s.** It's a ~9k-line page compiled on demand.
  A 5s curl timeout is not evidence the server is down; raise the timeout and wait.
- **A slow or blank first paint on Service pages** is the same cold transform. Retry once
  before concluding anything.
- **`npm run dev` appearing to hang** is correct behaviour — it's a long-running server that
  never exits. This is exactly why you must not run it: in the foreground it will burn the
  full Bash timeout and then look like a failure.

## Browser work

Chrome comes from the chrome-devtools MCP, which claims its own profile slot per session —
you don't need to launch or configure anything. Point it at `http://localhost:5188`.

The admin is auth-gated; the persistent Chrome profile usually holds a signed-in session
already. If it doesn't, sign in at `/admin/login` with `ADMIN_BOOTSTRAP_EMAIL` /
`ADMIN_BOOTSTRAP_PASSWORD` from `.env` (**not** `POCKETBASE_ADMIN_PASSWORD` — that's the
PocketBase superuser and the staff login rejects it).

Use `localhost`, never `127.0.0.1` — the session cookie is set per-host on `localhost`.

## Local dev writes to the live database

`POCKETBASE_URL` points at the production droplet. Anything you create locally is **real
client data**. Test on past dates and clean up after yourself.

## Backups and how to restore one

The droplet (`ssh GTDS`) hosts **four clients'** PocketBase instances — `pmm` (this app),
`blc`, `wire`, `baseball` — all running as **root**, all PocketBase 0.36.0. There are two
independent layers:

- **DigitalOcean droplet backups** — daily, 7-day retention, whole machine. Control panel only.
- **Nightly per-instance dumps** — [ops/backups/pb-backup.sh](ops/backups/pb-backup.sh),
  installed at `/usr/local/sbin/pb-backup.sh`, cron `17 3 * * *`. Writes
  `/var/backups/pb/<instance>/<UTC-date>.db.gz` (7 days) and uploads to the private R2
  bucket `gtds-pb-backups` under `<instance>/` (30 days). A watchdog at `20 9 * * *`
  emails the owner if the heartbeat goes >30h stale.

```bash
/usr/local/sbin/pb-backup.sh --status      # heartbeat, outstanding failure, local sizes
/usr/local/sbin/pb-backup.sh --selftest    # R2 upload→download→byte-compare round-trip
/usr/local/sbin/pb-backup.sh --local-only  # manual snapshot before a risky migration
```

Credentials are in `/etc/pb-backup.env` (chmod 600, root-only). Never echo them, never put
them in a crontab line, never copy them into the repo.

### Inspecting a backup (no downtime, do this first — always)

Never restore blind. Verifying a dump touches nothing live and takes seconds:

```bash
SCRATCH=$(mktemp -d)
gunzip -c /var/backups/pb/pmm/2026-08-07.db.gz > "$SCRATCH/check.db"
sqlite3 "$SCRATCH/check.db" "PRAGMA integrity_check;"                    # must print: ok
sqlite3 "$SCRATCH/check.db" "SELECT count(*) FROM geisha_bookings;"      # sane number?
rm -rf "$SCRATCH"
```

To pull from R2 instead of local disk, source the env file and use the `R2_BACKUP_*` vars
(see the `--selftest` block in the script for the exact rclone env setup), then
`rclone copyto R2:gtds-pb-backups/pmm/<date>.db.gz …`.

### Restoring over a live instance

**This is the one and only exception to "never stop the PocketBase units".** You cannot
restore a running instance, and you must get the owner's explicit go-ahead first — these
units serve four different clients, and only ever touch the one you were asked to.

```bash
INST=pmm; DATE=2026-08-07                       # change both, deliberately
PB=/opt/apps/$INST/pocketbase/pb_data

systemctl stop pocketbase-$INST                 # 1. stop ONLY this instance

mv $PB/data.db $PB/data.db.pre-restore-$(date -u +%Y%m%d-%H%M%S)   # 2. keep the current one
rm -f $PB/data.db-wal $PB/data.db-shm           # 3. SEE THE TRAP BELOW

gunzip -c /var/backups/pb/$INST/$DATE.db.gz > $PB/data.db          # 4. restore
chown root:root $PB/data.db && chmod 644 $PB/data.db               # 5. match the others

systemctl start pocketbase-$INST                # 6. back up
systemctl is-active pocketbase-$INST
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8093/api/health   # pmm; blc=8092, wire=8091, baseball=8090
```

**THE TRAP: delete `data.db-wal` and `data.db-shm` at step 3.** These databases are in WAL
mode. If you drop a restored `data.db` next to the *old* WAL sidecar, SQLite replays that
stale WAL over your restored file on first open — you silently get a corrupted hybrid, or
your restore reverted, and the service starts cleanly either way so nothing looks wrong.

Uploaded files live in `pb_data/storage` and are backed up separately as
`<date>.storage.tar.gz`. Restore with `tar xzf <file> -C /opt/apps/$INST/pocketbase/pb_data`
only if files are also missing — a database-only restore usually doesn't need it.

### Taking a fresh backup by hand

Never `cp`, `rsync` or `tar` a live `data.db` — WAL mode means a plain copy can be torn but
still look like a valid file. Use the online backup API, which is safe against a live writer:

```bash
sqlite3 /opt/apps/pmm/pocketbase/pb_data/data.db ".timeout 30000" ".backup '/tmp/snap.db'"
```

Or just run `pb-backup.sh --local-only`, which does exactly this for all four instances and
integrity-checks each result.
