#!/bin/bash
# ─────────────────────────────────────────────
#  CRM Platform — Status Check
#  Usage: ./status.sh
# ─────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "  📊  CRM Platform Status"
echo "  ─────────────────────────"
echo ""

# API
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
  echo -e "  ${GREEN}✓  API        http://localhost:3000${NC}"
else
  echo -e "  ${RED}✗  API        NOT RUNNING${NC}"
fi

# Frontend
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  echo -e "  ${GREEN}✓  Frontend   http://localhost:5173${NC}"
else
  echo -e "  ${RED}✗  Frontend   NOT RUNNING${NC}"
fi

# PostgreSQL
if /opt/homebrew/bin/pg_isready -q 2>/dev/null || pg_isready -q 2>/dev/null; then
  echo -e "  ${GREEN}✓  PostgreSQL localhost:5432${NC}"
else
  echo -e "  ${RED}✗  PostgreSQL NOT RUNNING${NC}"
fi

echo ""
# Show running node processes related to CRM
echo "  Running processes:"
ps aux | grep -E "tsx.*server|vite" | grep -v grep | awk '{printf "  PID %-8s %s\n", $2, $11}' || echo "  None found"
echo ""
