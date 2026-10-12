#!/usr/bin/env bash
#
# deploy-migration.sh — apply the batched plan migration to the live PocketBase
# (the reused "pmm" instance on the shared GTDS droplet) and restart ONLY that
# service so the migration runs.
#
# WHAT IT DOES
#   1. scp pb_migrations/1772700600_geisha_plan_collections.js to the droplet's
#      pmm pb_migrations/ dir.
#   2. systemctl restart pocketbase-pmm.service (restart applies pending
#      migrations; only the pmm instance is touched — other apps on the box are
#      unaffected).
#
# IMPORTANT
#   - The droplet is a 1GB no-swap box shared with other apps. The restart is
#     brief but real; run it at a quiet time.
#   - This is the ONE manual go-live step the build deliberately left for a human.
#   - Migrations are additive/back-compat; existing data/engine ignore new fields.
#
# USAGE
#   bash scripts/deploy-migration.sh <migration-file> [--yes]
#   bash scripts/deploy-migration.sh            # the plan migration (legacy default)
#   bash scripts/deploy-migration.sh --yes      # skip the confirmation prompt
#
# The file argument may be a bare filename (resolved inside pb_migrations/) or a
# path. It used to be hardcoded to 1772700600_geisha_plan_collections.js, which
# meant every migration after it had to be deployed by hand; that default is kept
# only so an argument-less run behaves as before.
#
# Override the target if your SSH config differs:
#   DROPLET_HOST=root@206.189.150.23 \
#   PB_MIGRATIONS_DIR=/opt/apps/pmm/pocketbase/pb_migrations \
#   PB_SERVICE=pocketbase-pmm.service \
#   bash scripts/deploy-migration.sh

set -euo pipefail

DROPLET_HOST="${DROPLET_HOST:-root@206.189.150.23}"
PB_MIGRATIONS_DIR="${PB_MIGRATIONS_DIR:-/opt/apps/pmm/pocketbase/pb_migrations}"
PB_SERVICE="${PB_SERVICE:-pocketbase-pmm.service}"

# Resolve repo root from this script's location, so it works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# First non-flag argument is the migration to deploy; --yes may come in either
# position. Falls back to the plan migration when none is given.
MIGRATION_ARG=""
ASSUME_YES=""
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES="yes" ;;
    *) [[ -z "$MIGRATION_ARG" ]] && MIGRATION_ARG="$arg" ;;
  esac
done

if [[ -z "$MIGRATION_ARG" ]]; then
  MIGRATION="$REPO_ROOT/pb_migrations/1772700600_geisha_plan_collections.js"
elif [[ -f "$MIGRATION_ARG" ]]; then
  MIGRATION="$MIGRATION_ARG"
else
  MIGRATION="$REPO_ROOT/pb_migrations/$(basename "$MIGRATION_ARG")"
fi

if [[ ! -f "$MIGRATION" ]]; then
  echo "ERROR: migration not found at $MIGRATION" >&2
  exit 1
fi

echo "About to deploy this migration to the LIVE pmm PocketBase:"
echo "  file:    $MIGRATION"
echo "  host:    $DROPLET_HOST"
echo "  dest:    $PB_MIGRATIONS_DIR/"
echo "  restart: $PB_SERVICE (applies pending migrations; pmm only)"
echo

if [[ -z "$ASSUME_YES" ]]; then
  # `|| ...` so a non-interactive run (no stdin) aborts cleanly instead of being
  # killed by `set -e` at the read.
  read -r -p "Proceed? This restarts the shared pmm service. [y/N] " reply || {
    echo "Aborted (no input)."
    exit 0
  }
  case "$reply" in
    [yY] | [yY][eE][sS]) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

echo "==> Copying migration..."
scp "$MIGRATION" "$DROPLET_HOST:$PB_MIGRATIONS_DIR/"

echo "==> Restarting $PB_SERVICE (this applies pending migrations)..."
ssh "$DROPLET_HOST" "systemctl restart $PB_SERVICE && sleep 2 && systemctl is-active $PB_SERVICE"

echo
echo "Done. The pmm instance restarted and applied pending migrations."
echo "Verify: log in at /admin/login and open the surface this migration is for."
echo
echo "(First-ever deploy only: set AUTH_SECRET + CRON_SECRET in Vercel, visit"
echo " /admin/setup to create the first owner, then add Dojo/Resend/AI keys at"
echo " /admin/settings/integrations.)"
