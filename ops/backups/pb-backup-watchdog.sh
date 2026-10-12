#!/bin/bash
# /usr/local/sbin/pb-backup-watchdog.sh
#
# The backup script emails when a run FAILS. It cannot email when a run never
# HAPPENS - cron removed, script deleted, box wedged, disk full at boot. This
# runs separately each morning and shouts if the heartbeat has gone stale.
#
# Stale = no successful backup in 30h (a 24h cycle plus 6h of slack).
set -uo pipefail

ENV_FILE=/etc/pb-backup.env
HEARTBEAT=/var/backups/pb/LAST_SUCCESS
SENTINEL=/var/backups/pb/LAST_FAILURE
LOG=/var/log/pb-backup.log
MAX_AGE_SECONDS=$((30 * 3600))

[ -r "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

say()  { printf '%s watchdog: %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }

email() {
  local s b
  s=$(printf '%s' "$1" | tr '\n' ' ' | sed 's/["\\]/ /g')
  b=$(printf '%s' "$2" | tr '\n' ' ' | sed 's/["\\]/ /g')
  [ -n "${BREVO_API_KEY:-}" ] || { say "no BREVO_API_KEY, cannot email"; return 1; }
  curl -fsS --max-time 30 -X POST https://api.brevo.com/v3/smtp/email \
    -H "api-key: ${BREVO_API_KEY}" -H "Content-Type: application/json" \
    -d "{\"sender\":{\"email\":\"${ALERT_FROM:-backups@localhost}\",\"name\":\"GTDS Backups\"},\"to\":[{\"email\":\"${ALERT_EMAIL}\"}],\"subject\":\"${s}\",\"textContent\":\"${b}\"}" \
    >/dev/null 2>>"$LOG"
}

HOST=$(hostname)

if [ ! -f "$HEARTBEAT" ]; then
  say "NO HEARTBEAT AT ALL"
  email "PB backups have NEVER succeeded on $HOST" \
        "There is no $HEARTBEAT file, so no nightly PocketBase backup has ever completed. Check: pb-backup.sh --status  and  tail /var/log/pb-backup.log"
  exit 1
fi

AGE=$(( $(date +%s) - $(stat -c %Y "$HEARTBEAT") ))
if [ "$AGE" -gt "$MAX_AGE_SECONDS" ]; then
  say "STALE heartbeat, age ${AGE}s"
  email "PB backups have STOPPED on $HOST" \
        "Last successful backup was $((AGE/3600))h ago ($(cat "$HEARTBEAT")). Expected one every 24h. The nightly job is not running or is failing before it finishes. Check: pb-backup.sh --status  and  tail -50 /var/log/pb-backup.log"
  exit 1
fi

if [ -f "$SENTINEL" ]; then
  say "sentinel present"
  email "PB backup failure outstanding on $HOST" "$(cat "$SENTINEL")"
  exit 1
fi

say "ok (last success $((AGE/3600))h ago)"
exit 0
