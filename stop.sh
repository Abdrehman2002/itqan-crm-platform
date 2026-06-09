#!/bin/bash
# ─────────────────────────────────────────────
#  CRM Platform — Stop Script
#  Usage: ./stop.sh
# ─────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "  ⏹  Stopping CRM Platform..."
echo ""

pkill -f "tsx.*server.ts" 2>/dev/null && echo -e "  ${GREEN}✓  API stopped${NC}"      || echo -e "  ${YELLOW}–  API was not running${NC}"
pkill -f "vite"           2>/dev/null && echo -e "  ${GREEN}✓  Frontend stopped${NC}"  || echo -e "  ${YELLOW}–  Frontend was not running${NC}"

rm -f "$PROJECT_DIR/logs/api.pid" "$PROJECT_DIR/logs/frontend.pid" 2>/dev/null

echo ""
echo "  ✅  All services stopped."
echo ""
