# Aexyl scheduled automation — Railway cron service (docs.railway.com/cron-jobs).
#
# Railway cron model: a dedicated service whose start command runs on the
# crontab expression configured on that service (see the deployment notes
# below), executes, and must TERMINATE cleanly — Railway skips the
# next run while a previous one is still active, so this script exits as soon
# as the tick answers and closes nothing else (stateless curl; no DB pools
# here — the web service owns the database connections).
#
# Deploy via a Railway service whose Root Directory is `cron` (it picks up
# cron/railway.json: no build, start command `bash tick.sh`). Attach it to the
# SAME environment as the web service, set CRON_SECRET (same value), and point
# AEXYL_WEB_URL at the web service's public or internal URL. Set the schedule
# in Settings → "Cron Schedule" → `*/15 * * * *`.
#
# Keep the schedule at Railway's minimum granularity and lower: every 5–15
# minutes is plenty — the endpoint is idempotent and the bus applies its own
# cooldowns, so a missed or skipped tick self-heals on the next one.

set -euo pipefail

# Fail loudly but terminally on misconfiguration — a cron service that hangs
# would suppress every subsequent scheduled run.
: "${AEXYL_WEB_URL:?AEXYL_WEB_URL is required (e.g. https://aexyl-web.up.railway.app)}"
: "${CRON_SECRET:?CRON_SECRET is required (same value as the web service's)}"

status="$(curl -sS -o /tmp/tick-body.json -w '%{http_code}' --max-time 120 \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${AEXYL_WEB_URL%/}/api/cron/tick" || echo 000)"

echo "cron tick HTTP ${status}: $(cat /tmp/tick-body.json || true)"

# 200 = tick completed (per-workspace errors, if any, are inside the body).
# Anything else (401/500/network) is a real failure — exit non-zero so the
# failure is visible in Railway's deploy logs and metrics.
if [ "${status}" != "200" ]; then
  exit 1
fi
