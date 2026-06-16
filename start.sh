#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  CRM Platform — Start Script
#  Usage: ./start.sh
#  Stops any old processes first, then starts fresh
# ─────────────────────────────────────────────────────────────

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_LOG="$PROJECT_DIR/logs/api.log"
FRONTEND_LOG="$PROJECT_DIR/logs/frontend.log"

# Colours
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "  🚀  CRM Platform Startup"
echo "  ─────────────────────────"
echo ""

# ── 1. Create logs directory ──────────────────────────────────
mkdir -p "$PROJECT_DIR/logs"

# ── 2. Kill any existing processes ───────────────────────────
echo -e "  ${YELLOW}⏹  Stopping old processes...${NC}"
pkill -f "tsx.*server.ts"      2>/dev/null
pkill -f "vite"                2>/dev/null
sleep 2

# Verify ports are free
for PORT in 3000 5173; do
  if lsof -i :$PORT 2>/dev/null | grep LISTEN > /dev/null; then
    echo -e "  ${RED}✗  Port $PORT still in use — trying to force kill...${NC}"
    lsof -ti :$PORT | xargs kill -9 2>/dev/null
    sleep 1
  fi
done

# ── 3. Check PostgreSQL ───────────────────────────────────────
echo -e "  ${YELLOW}🗄  Checking database...${NC}"
PG_READY=false
for PG in /opt/homebrew/bin/pg_isready /usr/local/bin/pg_isready pg_isready; do
  if command -v $PG &>/dev/null || [ -f "$PG" ]; then
    if $PG -q 2>/dev/null; then PG_READY=true; fi
    break
  fi
done

if [ "$PG_READY" = false ]; then
  # Try to start via brew
  brew services start postgresql@15 2>/dev/null || \
  brew services start postgresql   2>/dev/null || \
  pg_ctl start 2>/dev/null || true
  sleep 3
fi

if /opt/homebrew/bin/pg_isready -q 2>/dev/null || pg_isready -q 2>/dev/null; then
  echo -e "  ${GREEN}✓  PostgreSQL is running${NC}"
else
  echo -e "  ${RED}✗  PostgreSQL not running — please start it manually${NC}"
  echo -e "     Run: brew services start postgresql"
  exit 1
fi

# ── 4. Start API ──────────────────────────────────────────────
echo -e "  ${YELLOW}⚡  Starting API server...${NC}"
cd "$PROJECT_DIR"
nohup npx tsx packages/api/src/server.ts > "$API_LOG" 2>&1 &
API_PID=$!
echo $API_PID > "$PROJECT_DIR/logs/api.pid"

# Wait up to 15s for API to be ready
for i in $(seq 1 15); do
  sleep 1
  if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓  API running on http://localhost:3000 (PID: $API_PID)${NC}"
    break
  fi
  if [ $i -eq 15 ]; then
    echo -e "  ${RED}✗  API failed to start. Check logs/api.log${NC}"
    tail -5 "$API_LOG"
    exit 1
  fi
done

# ── 5. Start Frontend ─────────────────────────────────────────
echo -e "  ${YELLOW}🌐  Starting frontend...${NC}"
cd "$PROJECT_DIR/packages/frontend"
nohup npx vite > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$PROJECT_DIR/logs/frontend.pid"

# Wait up to 15s for frontend
for i in $(seq 1 15); do
  sleep 1
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ 2>/dev/null | grep -q "200"; then
    echo -e "  ${GREEN}✓  Frontend running on http://localhost:5173 (PID: $FRONTEND_PID)${NC}"
    break
  fi
  if [ $i -eq 15 ]; then
    echo -e "  ${RED}✗  Frontend failed to start. Check logs/frontend.log${NC}"
    tail -5 "$FRONTEND_LOG"
    exit 1
  fi
done

# ── 6. Done ───────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────────"
echo -e "  ${GREEN}✅  CRM Platform is running!${NC}"
echo ""
echo "  Frontend  →  http://localhost:5173"
echo "  API       →  http://localhost:3000"
echo "  API Docs  →  http://localhost:3000/docs"
echo ""
echo "  Login credentials:"
echo "    Email:     admin@demo.com"
echo "    Password:  Glx6trh@786"
echo "    Workspace: demo"
echo ""
echo "  Logs:"
echo "    API:       logs/api.log"
echo "    Frontend:  logs/frontend.log"
echo ""
echo "  To stop:   ./stop.sh"
echo "  ─────────────────────────────────────────"
echo ""
