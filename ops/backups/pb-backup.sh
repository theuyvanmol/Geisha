#!/bin/bash
# /usr/local/sbin/pb-backup.sh
#
# Nightly PocketBase backup for every instance on this box.
#   - consistent hot copy via sqlite3 ".backup" (safe against a live WAL writer)
#   - gzip -> /var/backups/pb/<instance>/<UTC-date>.db.gz
#   - upload to Cloudflare R2 under <instance>/
#   - retention: 7 days local, 30 days R2
#
# Credentials live in /etc/pb-backup.env (root-only, chmod 600). Never inline them here.
#
# Usage:
#   pb-backup.sh              normal nightly run
#   pb-backup.sh --selftest   verify R2 upload+download round-trip, then exit
#   pb-backup.sh --status     print heartbeat / last failure, then exit
#
set -uo pipefail

ENV_FILE=/etc/pb-backup.env
BACKUP_ROOT=/var/backups/pb
LOG=/var/log/pb-backup.log
SENTINEL="$BACKUP_ROOT/LAST_FAILURE"
HEARTBEAT="$BACKUP_ROOT/LAST_SUCCESS"
LOCK=/var/lock/pb-backup.lock
MIN_FREE_MB=2048          # abort if less than ~2GB free. This box has NO swap.
KEEP_LOCAL_DAYS=7
KEEP_R2_DAYS=30
APPS_GLOB="/opt/apps/*/pocketbase/pb_data/data.db"

DATE_UTC="$(date -u +%F)"
STARTED="$(date -u +%FT%TZ)"

# These files are whole customer databases. Root-only, always.
umask 077

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }

# ---- loud failure -----------------------------------------------------------
# Writes the log, drops a sentinel file, and emails via Brevo (no MTA on this box).
alert() {
  local subject="$1" body="$2"
  log "ALERT: $subject :: $body"
  mkdir -p "$BACKUP_ROOT"
  printf '%s\n%s\n%s\n' "$(date -u +%FT%TZ)" "$subject" "$body" > "$SENTINEL"
  if [ -n "${BREVO_API_KEY:-}" ] && [ -n "${ALERT_EMAIL:-}" ]; then
    # Brevo's JSON is fussy: flatten newlines and strip quotes/backslashes.
    local s b
    s=$(printf '%s' "$subject" | tr '\n' ' ' | sed 's/["\\]/ /g')
    b=$(printf '%s' "$body"    | tr '\n' ' ' | sed 's/["\\]/ /g')
    curl -fsS --max-time 30 -X POST https://api.brevo.com/v3/smtp/email \
      -H "api-key: ${BREVO_API_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"sender\":{\"email\":\"${ALERT_FROM:-backups@localhost}\",\"name\":\"GTDS Backups\"},\"to\":[{\"email\":\"${ALERT_EMAIL}\"}],\"subject\":\"${s}\",\"textContent\":\"${b}\"}" \
      >/dev/null 2>>"$LOG" || log "WARN: Brevo alert send failed (sentinel still written)"
  fi
}

die() { alert "PB backup FAILED on $(hostname)" "$*"; exit 1; }

# ---- env --------------------------------------------------------------------
[ -r "$ENV_FILE" ] || { log "FATAL: $ENV_FILE missing"; exit 1; }
set -a; . "$ENV_FILE"; set +a

# Test hook: let a caller aim at a different bucket without editing the env file.
R2_BACKUP_BUCKET="${PB_BUCKET_OVERRIDE:-$R2_BACKUP_BUCKET}"

for v in R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY R2_BACKUP_ENDPOINT R2_BACKUP_BUCKET; do
  [ -n "${!v:-}" ] || die "$ENV_FILE is missing $v"
done

# rclone remote defined entirely by env — no rclone.conf, no secrets on disk elsewhere.
# R2 needs: provider=Cloudflare, region=auto, and the ACCOUNT-SPECIFIC endpoint.
# NOTE: the endpoint is jurisdiction-specific. The media bucket (geisha-media) is
# EU and uses <account>.eu.r2.cloudflarestorage.com; THIS bucket is default
# jurisdiction and uses <account>.r2.cloudflarestorage.com. They are not
# interchangeable - the wrong one returns a bare 403, identical to a bad token.
# These credentials are scoped to the backup bucket only, and are deliberately
# NOT the media credentials.
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_REGION=auto
# Do NOT set ACL: R2 does not implement S3 object ACLs and returns
# "501 NotImplemented" on the PUT. rclone papers over it with a retry, which
# hides a real misconfiguration. R2 objects are private by default anyway.
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_BACKUP_ENDPOINT"
RC=(rclone --low-level-retries 3 --retries 2 --stats 0 --log-level ERROR)
DEST="R2:${R2_BACKUP_BUCKET}"

# ---- subcommands ------------------------------------------------------------
if [ "${1:-}" = "--status" ]; then
  echo "heartbeat : $([ -f "$HEARTBEAT" ] && cat "$HEARTBEAT" || echo 'NONE - has never succeeded')"
  if [ -f "$SENTINEL" ]; then echo "FAILURE   :"; sed 's/^/            /' "$SENTINEL";
  else echo "FAILURE   : none outstanding"; fi
  echo "local     :"; du -sh "$BACKUP_ROOT"/*/ 2>/dev/null | sed 's/^/            /' || true
  exit 0
fi

if [ "${1:-}" = "--selftest" ]; then
  # Proves the R2 config end-to-end: PUT, GET, byte-compare, DELETE.
  # Exiting 0 from an upload command is NOT proof; only a matching download is.
  t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
  echo "pb-backup selftest $(date -u +%FT%TZ) $(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$t/canary.txt"
  echo "-> uploading canary to ${DEST}/_selftest/"
  "${RC[@]}" copyto "$t/canary.txt" "${DEST}/_selftest/canary.txt" || { echo "UPLOAD FAILED"; exit 1; }
  echo "-> downloading it back"
  "${RC[@]}" copyto "${DEST}/_selftest/canary.txt" "$t/roundtrip.txt" || { echo "DOWNLOAD FAILED"; exit 1; }
  if cmp -s "$t/canary.txt" "$t/roundtrip.txt"; then
    echo "-> BYTES MATCH: $(cat "$t/roundtrip.txt")"
  else
    echo "ROUND-TRIP MISMATCH — uploaded and downloaded bytes differ"; exit 1
  fi
  "${RC[@]}" deletefile "${DEST}/_selftest/canary.txt" >/dev/null 2>&1
  echo "-> cleaned up. R2 config OK (bucket=${R2_BACKUP_BUCKET})"
  exit 0
fi

# --local-only: take + verify local backups, skip R2. For manual pre-change
# snapshots, and for running when the offsite leg is knowingly unavailable.
LOCAL_ONLY=0
[ "${1:-}" = "--local-only" ] && LOCAL_ONLY=1

# ---- one run at a time ------------------------------------------------------
exec 9>"$LOCK"
flock -n 9 || { log "another run in progress; exiting"; exit 0; }

log "=== run start $STARTED (date=$DATE_UTC) ==="
mkdir -p "$BACKUP_ROOT"

# ---- 4. disk guard: check BEFORE writing anything ---------------------------
FREE_MB=$(df -Pm "$BACKUP_ROOT" | awk 'NR==2{print $4}')
if [ -z "$FREE_MB" ] || [ "$FREE_MB" -lt "$MIN_FREE_MB" ]; then
  die "Refusing to back up: only ${FREE_MB}MB free on $(df -P "$BACKUP_ROOT" | awk 'NR==2{print $6}'), need ${MIN_FREE_MB}MB. No backup was written. This box has no swap - a full disk takes the databases down."
fi
log "disk ok: ${FREE_MB}MB free (floor ${MIN_FREE_MB}MB)"

FAILED=""
SUMMARY=""

shopt -s nullglob
DBS=($APPS_GLOB)
[ "${#DBS[@]}" -gt 0 ] || die "No PocketBase databases matched $APPS_GLOB - has the layout changed?"
log "found ${#DBS[@]} instance(s)"

for db in "${DBS[@]}"; do
  inst=$(basename "$(dirname "$(dirname "$(dirname "$db")")")")   # /opt/apps/<inst>/pocketbase/pb_data/data.db
  outdir="$BACKUP_ROOT/$inst"
  mkdir -p "$outdir"
  tmp="$outdir/.tmp-$DATE_UTC.db"
  final="$outdir/$DATE_UTC.db.gz"
  rm -f "$tmp"

  # THE important bit. Never cp/rsync/tar a live SQLite file - these are in WAL
  # mode and a plain copy can be torn but still look like a valid file.
  # sqlite3 ".backup" uses SQLite's online backup API: it is safe against a
  # concurrent writer and restarts itself if pages change mid-copy.
  if ! sqlite3 "$db" ".timeout 30000" ".backup '$tmp'" 2>>"$LOG"; then
    FAILED="$FAILED $inst(backup)"; log "ERROR: .backup failed for $inst"; rm -f "$tmp"; continue
  fi

  # A backup that won't open is not a backup. Check the COPY, not the original.
  chk=$(sqlite3 "$tmp" "PRAGMA integrity_check;" 2>>"$LOG" | head -1)
  if [ "$chk" != "ok" ]; then
    FAILED="$FAILED $inst(integrity:$chk)"; log "ERROR: integrity_check on $inst copy = $chk"; rm -f "$tmp"; continue
  fi

  tables=$(sqlite3 "$tmp" "SELECT count(*) FROM sqlite_master WHERE type='table';" 2>/dev/null)
  rawsz=$(stat -c%s "$tmp")

  gzip -6 -c "$tmp" > "$final.part" 2>>"$LOG" && mv -f "$final.part" "$final" || {
    FAILED="$FAILED $inst(gzip)"; log "ERROR: gzip failed for $inst"; rm -f "$tmp" "$final.part"; continue; }
  rm -f "$tmp"

  gzsz=$(stat -c%s "$final")
  log "$inst: ok raw=${rawsz}B gz=${gzsz}B tables=${tables} -> $final"
  SUMMARY="$SUMMARY $inst=$((gzsz/1024))KB"

  # pb_data/storage holds PocketBase's uploaded files. Tiny here (<1MB total) and
  # plain static files, so no torn-copy risk - included so a restore is usable.
  sdir="$(dirname "$db")/storage"
  if [ -d "$sdir" ]; then
    tar czf "$outdir/$DATE_UTC.storage.tar.gz.part" -C "$(dirname "$db")" storage 2>>"$LOG" \
      && mv -f "$outdir/$DATE_UTC.storage.tar.gz.part" "$outdir/$DATE_UTC.storage.tar.gz" \
      || { log "WARN: storage tar failed for $inst"; rm -f "$outdir/$DATE_UTC.storage.tar.gz.part"; }
  fi

  [ "$LOCAL_ONLY" = "1" ] && { log "$inst: --local-only, skipping R2"; continue; }

  # ---- 2. upload this instance's files under a per-instance prefix ----------
  if ! "${RC[@]}" copy "$outdir" "${DEST}/${inst}" --include "$DATE_UTC.*" 2>>"$LOG"; then
    FAILED="$FAILED $inst(upload)"; log "ERROR: R2 upload failed for $inst"; continue
  fi

  # Exit 0 from a copy is not proof the object is there. Confirm it lists.
  if ! "${RC[@]}" lsf "${DEST}/${inst}/$DATE_UTC.db.gz" 2>>"$LOG" | grep -q .; then
    FAILED="$FAILED $inst(verify)"; log "ERROR: uploaded object for $inst not found on R2"; continue
  fi
  log "$inst: uploaded + verified on R2"
done

# ---- 3. retention -----------------------------------------------------------
find "$BACKUP_ROOT" -type f \( -name '*.db.gz' -o -name '*.storage.tar.gz' \) \
  -mtime +$KEEP_LOCAL_DAYS -print -delete >> "$LOG" 2>&1
find "$BACKUP_ROOT" -type f -name '*.part' -mtime +1 -delete 2>/dev/null

if [ "$LOCAL_ONLY" = "0" ]; then
  if ! "${RC[@]}" delete "$DEST" --min-age "${KEEP_R2_DAYS}d" 2>>"$LOG"; then
    FAILED="$FAILED r2-prune"; log "ERROR: R2 prune failed"
  fi
fi

# ---- 5. heartbeat / sentinel ------------------------------------------------
if [ -n "$FAILED" ]; then
  die "Instances with problems:$FAILED (run at $STARTED). Backups for other instances may still have succeeded. Check $LOG on $(hostname)."
fi

if [ "$LOCAL_ONLY" = "1" ]; then
  # Deliberately does NOT touch the heartbeat: a local-only run has no offsite
  # copy, and must not silence the watchdog into thinking all is well.
  log "=== run ok (LOCAL ONLY - nothing sent offsite, heartbeat not updated) ===$SUMMARY"
  exit 0
fi

printf '%s ok%s\n' "$(date -u +%FT%TZ)" "$SUMMARY" > "$HEARTBEAT"
rm -f "$SENTINEL"
# Heartbeat also goes offsite, so a dead box is still detectable from R2.
"${RC[@]}" copyto "$HEARTBEAT" "${DEST}/_status/LAST_SUCCESS" 2>>"$LOG" || log "WARN: heartbeat upload failed"
log "=== run ok ===$SUMMARY"
exit 0
