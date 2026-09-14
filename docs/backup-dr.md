# Backup & Disaster Recovery

Aexyl treats the PostgreSQL database as the source of truth. This document is
the runbook for **Backup → Restore → Verify** (Phase 6 §10).

## What we back up

| Artifact | Method | Frequency |
| --- | --- | --- |
| Full database (`aexyl`) | `docker exec aexyl-postgres pg_dump` via `scripts/backup-db.sh` | Daily (02:00 recommended) |
| `.env.local` secrets | Manual copy to the password manager / secure vault | On change |
| Uploaded/external assets | Stored in external providers (Resend, OAuth providers) — no local blobs | n/a |

## Backup

```bash
bash scripts/backup-db.sh                # -> ./backups/aexyl_YYYYMMDD_HHMMSS.sql
bash scripts/backup-db.sh /mnt/backups   # custom location
```

The script:

1. Dumps the database with `pg_dump --no-owner`.
2. Fails loudly if the dump is suspiciously small (<1 KB).
3. Prunes dumps older than `AEXYL_BACKUP_RETENTION_DAYS` (default 14).
4. Smoke-verifies that core tables (`workspaces`, `deals`, `leads`, `agent_runs`)
   appear in the dump.

### Scheduling

**Windows (Task Scheduler):** create a daily task at 02:00 running
`bash scripts/backup-db.sh` with "Start in" set to the repo root; redirect
output to `backups/backup.log`.

**Linux/macOS (cron):**

```
0 2 * * * cd /path/to/aexyl && bash scripts/backup-db.sh >> backups/backup.log 2>&1
```

Keep at least one backup copy **outside the database host** (cloud storage,
external drive) — a local-only backup does not survive disk loss.

## Restore

```bash
# 1. Stop writes (stop the app or the dev server).
# 2. Recreate the database if needed:
docker exec -it aexyl-postgres psql -U postgres -c "drop database aexyl;"
docker exec -it aexyl-postgres psql -U postgres -c "create database aexyl;"
# 3. Apply the dump:
docker exec -i aexyl-postgres psql -U postgres -d aexyl < backups/aexyl_YYYYMMDD_HHMMSS.sql
# 4. Push schema to reconcile any post-backup migrations (safe on restored data):
npx drizzle-kit push
# 5. Restart the app.
```

## Verify (post-restore)

```bash
# Connectivity + row counts for critical tables:
docker exec -it aexyl-postgres psql -U postgres -d aexyl -c \
  "select (select count(*) from workspaces) as workspaces, (select count(*) from deals) as deals, (select count(*) from leads) as leads, (select count(*) from agent_runs) as agent_runs;"

# App-level check:
curl -s http://localhost:3000/api/health   # expect {"status":"ok","db":"reachable"}
```

Then sign in and spot-check: Command Center shows real pipeline numbers, the
Agents command center lists agents, My Day shows tasks.

## Recovery objectives

- **RPO (max data loss):** 24 hours with daily backups; tighten to hourly by
  running `backup-db.sh` on an hourly schedule and increasing retention.
- **RTO (max restore time):** ~15 minutes for a local restore of a
  workspace-sized database (dump is a few MB at current scale).

## Migration safety

- Never edit an applied migration file; always add forward-only changes and
  apply with `npx drizzle-kit push` (dev) or generated SQL migrations (prod).
- Before a risky migration: run `bash scripts/backup-db.sh` immediately prior.
- If a push fails mid-way: restore from the pre-migration dump (steps above),
  fix the schema, re-push.

## Incident response quick reference

1. Contain: engage the agent kill switch (`/agents` → Disable All Agents) if
   agents are implicated.
2. Snapshot: run `scripts/backup-db.sh` **before** any remediation mutation.
3. Investigate: `/agents/observability` (incidents), `audit_logs`,
   `agent_traces` for the tool calls involved.
4. Remediate & document: resolve the incident in the UI with a root-cause note.
