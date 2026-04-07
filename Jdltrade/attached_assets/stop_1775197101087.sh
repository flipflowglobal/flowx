#!/bin/bash
# stop.sh — Gracefully stop NEXUS-ARB
PIDFILE=".nexus-arb.pid"

if [ ! -f "$PIDFILE" ]; then
    echo "NEXUS-ARB is not running (no PID file)."
    exit 0
fi

PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping NEXUS-ARB (PID $PID)…"
    kill -SIGTERM "$PID"
    timeout 15 bash -c "while kill -0 $PID 2>/dev/null; do sleep 1; done" || kill -9 "$PID" 2>/dev/null || true
    echo "Stopped."
else
    echo "PID $PID not found. Cleaning up."
fi
rm -f "$PIDFILE"
