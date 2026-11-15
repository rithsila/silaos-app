#!/bin/sh
set -e

# Ensure data directory exists
mkdir -p /app/data

echo "→ Applying SQLite schema..."
DBFILE="${DATABASE_URL#file:}"
DBFILE="${DBFILE:-/app/data/prod.db}"
if [ ! -s "$DBFILE" ] || [ "$(sqlite3 "$DBFILE" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='Task';")" = "0" ]; then
  for f in /app/prisma/migrations/*/migration.sql; do
    echo "  $f"
    sqlite3 "$DBFILE" < "$f"
  done
else
  echo "  schema already present"
fi

echo "→ Starting Life OS backend on port 8080..."
PORT=8080 DATABASE_URL="${DATABASE_URL:-file:/app/data/prod.db}" \
    /usr/local/bin/lifeos-backend &
BACKEND_PID=$!

# Wait for the backend health endpoint instead of a fixed sleep
echo "→ Waiting for backend to become ready..."
TRIES=0
MAX_TRIES=30
until wget -qO- http://localhost:8080/health > /dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge "$MAX_TRIES" ]; then
        echo "✗ Backend failed to start after ${MAX_TRIES}s" >&2
        # Try to show some logs from the backend before exiting
        kill "$BACKEND_PID" 2>/dev/null || true
        exit 1
    fi
    sleep 1
done
echo "✓ Backend ready (${TRIES}s)"

echo "→ Starting Life OS Norma agent on port 8081..."
AGENT_PORT=8081 BACKEND_URL="http://localhost:8080" AGENT_DATA_DIR="/app/data/agent" \
    /usr/local/bin/lifeos-agent &
AGENT_PID=$!

TRIES=0
until wget -qO- http://localhost:8081/health > /dev/null 2>&1; do
    TRIES=$((TRIES + 1))
    if [ "$TRIES" -ge "$MAX_TRIES" ]; then
        echo "✗ Agent failed to start after ${MAX_TRIES}s" >&2
        kill "$AGENT_PID" "$BACKEND_PID" 2>/dev/null || true
        exit 1
    fi
    sleep 1
done
echo "✓ Agent ready (${TRIES}s)"

echo "→ Starting Life OS frontend on port ${PORT:-3000}..."
# The Next.js standalone server is in the current directory
exec node server.js
