#!/usr/bin/env bash
# Aexyl PostgreSQL backup (spec Phase 6 §10).
#
# Usage:
#   bash scripts/backup-db.sh              # one-off backup to ./backups
#   bash scripts/backup-db.sh /some/dir    # backup to a specific directory
#
# Restore (see docs/backup-dr.md):
#   docker exec -i aexyl-postgres psql -U postgres -d aexyl < backups/<file>.sql
#
# Schedule daily via Task Scheduler (Windows) or cron (Linux):
#   0 2 * * * cd /path/to/aexyl && bash scripts/backup-db.sh >> backups/backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${1:-backups}"
CONTAINER="${AEXYL_PG_CONTAINER:-aexyl-postgres}"
PG_USER="${AEXYL_PG_USER:-postgres}"
DB_NAME="${AEXYL_PG_DB:-aexyl}"
RETENTION_DAYS="${AEXYL_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/aexyl_${STAMP}.sql"

echo "[$(date -Iseconds)] dumping ${DB_NAME} from ${CONTAINER} -> ${OUT}"
docker exec "$CONTAINER" pg_dump -U "$PG_USER" --no-owner "$DB_NAME" > "$OUT"

SIZE=$(wc -c < "$OUT")
if [ "$SIZE" -lt 1000 ]; then
  echo "[$(date -Iseconds)] ERROR: dump suspiciously small (${SIZE} bytes) — verify database state" >&2
  exit 1
fi

echo "[$(date -Iseconds)] dump complete (${SIZE} bytes)"

# Retention: prune dumps older than RETENTION_DAYS.
find "$BACKUP_DIR" -name "aexyl_*.sql" -mtime +"$RETENTION_DAYS" -print -delete |
  sed "s/^/[$(date -Iseconds)] pruned old backup: /"

# Verification: confirm the dump contains the core tables (a 10-second smoke check).
for TABLE in workspaces deals leads agent_runs; do
  if ! grep -q "CREATE TABLE.*${TABLE}\|COPY.*${TABLE}\|Data for Name: ${TABLE}" "$OUT"; then
    echo "[$(date -Iseconds)] WARNING: table ${TABLE} not found in dump — inspect manually" >&2
  fi
done

echo "[$(date -Iseconds)] backup verified"
