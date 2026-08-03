#!/usr/bin/env bash
# A++ — start backend + frontend together.
#
#   ./run.sh          start both (backend :8000, frontend :3000)
#   ./run.sh api      backend only
#   ./run.sh web      frontend only
#   ./run.sh stop     kill both
#
# Ctrl-C stops everything.

set -euo pipefail
cd "$(dirname "$0")"

PY=.venv/bin/python
API_PORT=8000
WEB_PORT=3000

stop() {
  pkill -f "uvicorn app.main" 2>/dev/null || true
  pkill -f "next start" 2>/dev/null || true
  pkill -f "next dev" 2>/dev/null || true
  lsof -ti:$API_PORT,$WEB_PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
}

case "${1:-all}" in
  stop)
    stop; echo "stopped."; exit 0 ;;
  api)
    stop; exec $PY -m uvicorn app.main:app --reload --port $API_PORT ;;
  web)
    cd frontend; exec npx next dev -p $WEB_PORT ;;
esac

stop
trap stop EXIT INT TERM

echo "→ backend  http://localhost:$API_PORT   (docs: /docs)"
$PY -m uvicorn app.main:app --port $API_PORT --log-level warning &

sleep 4
echo "→ frontend http://localhost:$WEB_PORT"
(cd frontend && npx next dev -p $WEB_PORT) &

sleep 6
echo
echo "─────────────────────────────────────────────"
curl -s localhost:$API_PORT/health | $PY -c "
import sys, json
d = json.load(sys.stdin)
for k, v in d['config'].items():
    print(f'  {k:18} {v}')
print()
for p in d['providers']:
    print(f\"  {'OK ' if p['status']=='ready' else 'DOWN'}  {p['provider']:<20} {p['status']}\")
print()
for j in d['vision_judges']:
    print(f\"  {'OK ' if j['status']=='active' else 'DOWN'}  judge {j['backend']:<12} {j['status']}\")
" 2>/dev/null || echo "  (backend still starting)"
echo "─────────────────────────────────────────────"
echo
echo "Open  http://localhost:$WEB_PORT"
wait
