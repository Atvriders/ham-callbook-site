#!/usr/bin/env bash
# Weekly FCC ULS refresh.
#
# Downloads the FCC's weekly amateur-license dump (published Sundays),
# rebuilds data/uls.json (the snapshot the backend serves current-holder
# data from), and restarts the backend so it picks up the new file.
#
# Safe to re-run any time. Skips the backend restart if a DB rebuild
# (build_sqlite.py) is in flight — that pipeline restarts uvicorn itself.
set -euo pipefail

ULS_URL="https://data.fcc.gov/download/pub/uls/complete/l_amat.zip"
ULS_DIR="/home/kasm-user/leehite-callbooks/xref_out/uls"
SITE="/home/kasm-user/ham-callbook-site"
BUILDER="/home/kasm-user/leehite-callbooks/build_uls_json.py"
LOG="/home/kasm-user/leehite-callbooks/uls_refresh.log"

exec >>"$LOG" 2>&1
echo "[$(date)] === ULS refresh start ==="

# 1. Download to a temp file; only replace on success (atomic-ish).
TMP_ZIP=$(mktemp /tmp/l_amat_XXXX.zip)
trap 'rm -f "$TMP_ZIP"' EXIT
echo "[$(date)] downloading $ULS_URL"
curl -fsSL -m 1800 -o "$TMP_ZIP" "$ULS_URL"
SIZE=$(stat -c %s "$TMP_ZIP")
# Sanity: the weekly dump is ~175 MB. Reject obviously-truncated downloads.
if [ "$SIZE" -lt 100000000 ]; then
  echo "[$(date)] ERROR: download too small ($SIZE bytes) — keeping old snapshot"
  exit 1
fi
echo "[$(date)] downloaded $SIZE bytes"

# 2. Extract the two files the builder needs.
# (python zipfile, not unzip — the kasm container image doesn't ship unzip)
mkdir -p "$ULS_DIR"
python3 -c "
import zipfile
with zipfile.ZipFile('$TMP_ZIP') as z:
    z.extract('EN.dat', '$ULS_DIR')
    z.extract('HD.dat', '$ULS_DIR')
"
cp "$TMP_ZIP" "$ULS_DIR/l_amat.zip"
echo "[$(date)] extracted EN.dat + HD.dat"

# 3. Rebuild uls.json (writes site/data/uls.json atomically via .tmp+rename).
python3 "$BUILDER"
echo "[$(date)] uls.json rebuilt"

# 4. Restart backend unless a DB rebuild owns the lifecycle right now.
if pgrep -f 'build_sqlite.py' >/dev/null 2>&1; then
  echo "[$(date)] build_sqlite.py in flight — skipping restart (it will restart uvicorn itself)"
else
  pkill -f 'uvicorn app.main' 2>/dev/null || true
  sleep 2
  cd "$SITE/backend"
  DB_PATH="$SITE/data/USA_Ham_Callbooks.sqlite" \
  ULS_JSON_PATH="$SITE/data/uls.json" \
    nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/be.log 2>&1 &
  disown
  for i in $(seq 1 15); do
    sleep 2
    code=$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://localhost:8000/api/health || true)
    [ "$code" = "200" ] && break
  done
  echo "[$(date)] backend restarted (health=$code)"
fi

# 5. Verify the new snapshot is being served.
STATS=$(curl -s -m 30 http://localhost:8000/api/activity/uls/_stats || true)
echo "[$(date)] uls stats: $STATS"
echo "[$(date)] === ULS refresh done ==="
