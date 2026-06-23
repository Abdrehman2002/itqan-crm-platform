#!/bin/bash
# Comprehensive read-endpoint smoke test for CRM Platform
BASE="http://localhost:3000"
API="$BASE/api/v1"

TOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.com","password":"Demo1234!","tenantSlug":"demo"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('data',d)['token'])")

if [ -z "$TOKEN" ]; then echo "LOGIN FAILED"; exit 1; fi
echo "Login OK (token len ${#TOKEN})"
echo

PASS=0; FAIL=0; FAILED_LIST=""
H=(-H "Authorization: Bearer $TOKEN")

# $1 method $2 url $3 label  $4 ok-codes(regex)
hit() {
  local m="$1" url="$2" label="$3" ok="${4:-200}"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X "$m" "${H[@]}" "$url")
  if [[ "$code" =~ ^($ok)$ ]]; then
    PASS=$((PASS+1)); printf "  ok   %-3s %-45s %s\n" "$m" "$label" "$code"
  else
    FAIL=$((FAIL+1)); FAILED_LIST="$FAILED_LIST\n  $m $label -> $code"
    printf "  FAIL %-3s %-45s %s\n" "$m" "$label" "$code"
  fi
}

# helper: get first id from a list endpoint
firstid() {
  curl -s "${H[@]}" "$1" | python3 -c "import sys,json
try:
  d=json.load(sys.stdin); r=d.get('data',d)
  r=r if isinstance(r,list) else r.get('items',[]) if isinstance(r,dict) else []
  print(r[0].get('id','') if r else '')
except: print('')" 2>/dev/null
}

echo "=== CORE CRM ==="
hit GET "$API/contacts" "contacts list"
hit GET "$API/companies" "companies list"
hit GET "$API/deals" "deals list"
hit GET "$API/deals/pipelines" "deals pipelines"
hit GET "$API/opportunities" "opportunities list"
hit GET "$API/opportunities/team/summary" "opportunities team summary"
hit GET "$API/activities" "activities list"
hit GET "$API/activities/overdue" "activities overdue"
hit GET "$API/activities/today" "activities today"

echo "=== SECTOR / DEPT / ROLES / MODULES ==="
hit GET "$API/sector" "sector"
hit GET "$API/sector/fields" "sector fields"
hit GET "$API/sector/all" "sector all"
hit GET "$API/departments" "departments"
hit GET "$API/roles" "roles"
hit GET "$API/roles/modules" "roles modules"
hit GET "$API/roles/defaults/tenant_admin" "roles defaults"
hit GET "$API/modules" "modules"

echo "=== ANALYTICS ==="
hit GET "$API/analytics/dashboard" "analytics dashboard"
hit GET "$API/analytics/revenue" "analytics revenue"
hit GET "$API/analytics/leaderboard" "analytics leaderboard"
hit GET "$API/analytics/contact-sources" "analytics contact-sources"
hit GET "$API/analytics/refresh-status" "analytics refresh-status"
hit GET "$API/analytics/overview" "analytics overview" "200|302"
hit GET "$API/analytics/ops-dashboard" "analytics ops-dashboard"
hit GET "$API/analytics/team-summary" "analytics team-summary"
hit GET "$API/analytics/team-reportees" "analytics team-reportees"

echo "=== TICKETING ==="
hit GET "$API/tickets" "tickets list"
hit GET "$API/tickets/stats" "tickets stats"
hit GET "$API/tickets/queues" "tickets queues"
hit GET "$API/tickets/tags" "tickets tags"
hit GET "$API/tickets/sla-policies" "tickets sla-policies"
hit GET "$API/tickets/dashboard/agent" "tickets dashboard agent"
hit GET "$API/tickets/dashboard/team" "tickets dashboard team"
hit GET "$API/tickets/analytics/trends" "ticket-analytics trends"
hit GET "$API/tickets/analytics/heatmap" "ticket-analytics heatmap"
hit GET "$API/tickets/analytics/resolution" "ticket-analytics resolution"
hit GET "$API/tickets/csat" "csat (protected)"
hit GET "$API/tickets/csat/summary" "csat summary"

echo "=== EMAIL / NOTIFICATIONS / MESSAGES ==="
hit GET "$API/emails" "emails list"
hit GET "$API/emails/templates" "email templates"
hit GET "$API/notifications" "notifications"
hit GET "$API/messages/channels" "message channels"
hit GET "$API/messages/team-members" "message team-members"

echo "=== VOICE ==="
hit GET "$API/voice/calls" "voice calls"
hit GET "$API/voice/analytics" "voice analytics"
hit GET "$API/voice/stats" "voice stats (redirect->analytics)" "200|307"
hit GET "$API/voice-bot/webhook-url" "voice-bot webhook-url"
hit GET "$API/voice-bot/config" "voice-bot config"
hit GET "$API/voice-bot/calls" "voice-bot calls"
hit GET "$API/voice-bot/stats" "voice-bot stats"

echo "=== BILLING / SALES ==="
hit GET "$API/billing/pricing" "billing pricing"
hit GET "$API/billing/invoices" "billing invoices"
hit GET "$API/billing/subscription" "billing subscription"
hit GET "$API/billing/usage" "billing usage"
hit GET "$API/billing/payments" "billing payments"
hit GET "$API/sales/invoices" "sales invoices"
hit GET "$API/sales/billing-contacts" "sales billing-contacts"
hit GET "$API/sales/settings" "sales settings"
hit GET "$API/sales/dashboard" "sales dashboard"
hit GET "$API/sales/templates" "sales templates"
hit GET "$API/sales/templates/merge-fields" "sales template merge-fields"

echo "=== SETTINGS ==="
hit GET "$API/settings" "settings"
hit GET "$API/settings/workspace" "settings workspace"
hit GET "$API/settings/routing" "settings routing"
hit GET "$API/settings/team" "settings team"
hit GET "$API/settings/team/reportees" "settings team reportees"
hit GET "$API/settings/team/modules" "settings team modules"
hit GET "$API/settings/workspace/modules" "settings workspace modules"
hit GET "$API/settings/team/department-types" "settings dept-types"
hit GET "$API/settings/milestone-templates" "settings milestone-templates"

echo "=== INTEGRATIONS ==="
hit GET "$API/connectors" "connectors"
hit GET "$API/webhooks" "webhooks"
hit GET "$API/webhooks/dead-letter" "webhooks dead-letter"
hit GET "$API/api-keys" "api-keys"
hit GET "$API/api-keys/scopes" "api-keys scopes"

echo "=== SUPER-ADMIN (tenant_admin may be 403) ==="
hit GET "$BASE/super-admin/tenants" "sa tenants" "200|403"
hit GET "$BASE/super-admin/modules" "sa modules" "200|403"
hit GET "$BASE/super-admin/metrics" "sa metrics" "200|403"
hit GET "$BASE/super-admin/platform-roles" "sa platform-roles" "200|403"

echo "=== PARAMETERIZED (resolve real ids) ==="
CID=$(firstid "$API/contacts"); [ -n "$CID" ] && { hit GET "$API/contacts/$CID" "contact by id"; hit GET "$API/contacts/$CID/timeline" "contact timeline"; }
COID=$(firstid "$API/companies"); [ -n "$COID" ] && hit GET "$API/companies/$COID" "company by id"
DID=$(firstid "$API/deals"); [ -n "$DID" ] && hit GET "$API/deals/$DID" "deal by id"
TID=$(firstid "$API/tickets"); [ -n "$TID" ] && { hit GET "$API/tickets/$TID" "ticket by id"; hit GET "$API/tickets/$TID/comments" "ticket comments"; hit GET "$API/tickets/$TID/audit-log" "ticket audit-log"; }
DEPID=$(firstid "$API/departments"); [ -n "$DEPID" ] && hit GET "$API/departments/$DEPID" "department by id"

echo
echo "================ RESULTS ================"
echo "PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" -gt 0 ] && echo -e "FAILURES:$FAILED_LIST"
