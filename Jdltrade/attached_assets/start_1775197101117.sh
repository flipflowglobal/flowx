#!/bin/bash
# start.sh — Start NEXUS-ARB in background
set -euo pipefail

PIDFILE=".nexus-arb.pid"
LOGFILE="logs/nexus-arb.log"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "NEXUS-ARB already running (PID $(cat "$PIDFILE")). Use ./stop.sh first."
    exit 1
fi

source .venv/bin/activate
mkdir -p logs

echo "Starting NEXUS-ARB…"
nohup python3 main.py "$@" >> "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"

PORT=$(grep "^API_PORT" .env 2>/dev/null | cut -d= -f2 | tr -d ' ' || echo "8420")
echo "Started: PID $(cat "$PIDFILE")"
echo "Logs:    tail -f $LOGFILE"
echo "Dashboard: http://localhost:${PORT}"
