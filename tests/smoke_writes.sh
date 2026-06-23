#!/bin/bash
# Write-path smoke test: create -> update -> delete (with cleanup) for core CRM features.
# Safe to re-run; every record it creates it also removes (or closes) at the end.
BASE="http://localhost:3000"; API="$BASE/api/v1"

TOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.com","password":"Demo1234!","tenantSlug":"demo"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('data',d)['token'])")
[ -z "$TOKEN" ] && { echo "LOGIN FAILED"; exit 1; }
echo "Login OK"; echo
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
PASS=0; FAIL=0; FAILED=""
CODEF=$(mktemp); BODYF=$(mktemp)
trap 'rm -f "$CODEF" "$BODYF"' EXIT

# req METHOD URL JSON  -> echoes body; writes status code to $CODEF (survives subshells)
req() {
  local m="$1" url="$2" data="$3"
  RESP=$(curl -s -w $'\n%{http_code}' -X "$m" "${H[@]}" ${data:+-d "$data"} "$url")
  local code="${RESP##*$'\n'}"; RESP="${RESP%$'\n'*}"
  printf '%s' "$code" > "$CODEF"; printf '%s' "$RESP" > "$BODYF"
  printf '%s' "$RESP"
}
check() { # label  okcodes
  local label="$1" ok="${2:-200|201}"
  local code; code=$(cat "$CODEF")
  if [[ "$code" =~ ^($ok)$ ]]; then PASS=$((PASS+1)); printf "  ok   %-40s %s\n" "$label" "$code"
  else FAIL=$((FAIL+1)); FAILED="$FAILED\n  $label -> $code :: $(head -c 160 "$BODYF")"; printf "  FAIL %-40s %s\n" "$label" "$code"; fi
}
jid() { printf '%s' "$1" | python3 -c "import sys,json
try:
  d=json.load(sys.stdin); d=d.get('data',d)
  print(d.get('id','') if isinstance(d,dict) else '')
except: print('')"; }

echo "=== CONTACTS (create/update/delete) ==="
B=$(req POST "$API/contacts" '{"firstName":"SmokeTest","lastName":"User","email":"smoke+ct@test.local","status":"lead"}'); check "contact create"
CID=$(jid "$B")
[ -n "$CID" ] && { req PATCH "$API/contacts/$CID" '{"jobTitle":"QA"}' >/dev/null; check "contact update";
  req DELETE "$API/contacts/$CID" >/dev/null; check "contact delete" "200|204"; }

echo "=== COMPANIES ==="
B=$(req POST "$API/companies" '{"name":"SmokeTest Co","industry":"Testing","size":"11-50"}'); check "company create"
COID=$(jid "$B")
[ -n "$COID" ] && { req PATCH "$API/companies/$COID" '{"city":"QA City"}' >/dev/null; check "company update";
  req DELETE "$API/companies/$COID" >/dev/null; check "company delete" "200|204"; }

echo "=== DEALS (needs pipeline+stage) ==="
PIPE=$(req GET "$API/deals/pipelines" "")
read PID SID < <(printf '%s' "$PIPE" | python3 -c "import sys,json
d=json.load(sys.stdin); rows=d.get('data',d); p=rows[0] if rows else {}
st=p.get('stages') or []
sid=(st[0].get('id') if st else '')
print(p.get('id',''), sid)")
if [ -n "$PID" ] && [ -n "$SID" ]; then
  B=$(req POST "$API/deals" "{\"name\":\"SmokeTest Deal\",\"pipelineId\":\"$PID\",\"stageId\":\"$SID\",\"amount\":1000}"); check "deal create"
  DID=$(jid "$B")
  [ -n "$DID" ] && { req PATCH "$API/deals/$DID" '{"amount":2000}' >/dev/null; check "deal update";
    req DELETE "$API/deals/$DID" >/dev/null; check "deal delete" "200|204"; }
else echo "  SKIP deals (no pipeline/stage found: pid=$PID sid=$SID)"; fi

echo "=== ACTIVITIES ==="
B=$(req POST "$API/activities" '{"type":"task","subject":"SmokeTest Activity","priority":"normal"}'); check "activity create"
AID=$(jid "$B")
[ -n "$AID" ] && { req PATCH "$API/activities/$AID" '{"outcome":"done"}' >/dev/null; check "activity update";
  req POST "$API/activities/$AID/complete" '{}' >/dev/null; check "activity complete";
  req DELETE "$API/activities/$AID" >/dev/null; check "activity delete" "200|204"; }

echo "=== OPPORTUNITIES ==="
B=$(req POST "$API/opportunities" '{"title":"SmokeTest Opp","value":500}'); check "opportunity create"
OID=$(jid "$B")
[ -n "$OID" ] && { req PATCH "$API/opportunities/$OID" '{"value":750}' >/dev/null; check "opportunity update";
  req POST "$API/opportunities/$OID/stage" '{"stage":"accepted"}' >/dev/null; check "opportunity stage";
  req DELETE "$API/opportunities/$OID" >/dev/null; check "opportunity delete" "200|204"; }

echo "=== DEPARTMENTS ==="
B=$(req POST "$API/departments" '{"name":"SmokeTest Dept","department_type":"sales"}'); check "department create"
DEPID=$(jid "$B")
[ -n "$DEPID" ] && { req PATCH "$API/departments/$DEPID" '{"description":"qa"}' >/dev/null; check "department update";
  req DELETE "$API/departments/$DEPID" >/dev/null; check "department delete" "200|204"; }

echo "=== EMAIL TEMPLATES (settings:write) ==="
B=$(req POST "$API/emails/templates" '{"name":"SmokeTest Tpl","subject":"Hi","bodyHtml":"<p>Test body</p>"}'); check "email template create"
TPID=$(jid "$B")
[ -n "$TPID" ] && { req PUT "$API/emails/templates/$TPID" '{"name":"SmokeTest Tpl2","subject":"Hi2","bodyHtml":"<p>Test body 2</p>"}' >/dev/null; check "email template update";
  req DELETE "$API/emails/templates/$TPID" >/dev/null; check "email template delete" "200|204"; }

echo "=== ROLES (custom role create/update/delete) ==="
B=$(req POST "$API/roles" '{"name":"SmokeTest Role","base_role":"agent","permissions":{"contacts:read":true}}'); check "role create"
RID=$(jid "$B")
[ -n "$RID" ] && { req PATCH "$API/roles/$RID" '{"description":"qa role"}' >/dev/null; check "role update";
  req DELETE "$API/roles/$RID" >/dev/null; check "role delete" "200|204"; }

echo "=== TICKETS (create/update/lifecycle; no hard delete by design) ==="
B=$(req POST "$API/tickets" '{"subject":"SmokeTest Ticket","ticketType":"complaint","priority":"low","channel":"manual"}'); check "ticket create"
TID=$(jid "$B")
[ -n "$TID" ] && { req PATCH "$API/tickets/$TID" '{"priority":"medium"}' >/dev/null; check "ticket update";
  req POST "$API/tickets/$TID/comments" '{"body":"qa note","isInternal":true,"commentType":"note"}' >/dev/null; check "ticket add comment";
  req POST "$API/tickets/$TID/resolve" '{"resolution":"qa resolved"}' >/dev/null; check "ticket resolve" "200|201|400|409"; }

echo
echo "================ WRITE RESULTS ================"
echo "PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" -gt 0 ] && echo -e "FAILURES:$FAILED"
echo "(SmokeTest Ticket $TID left in system — tickets have no hard-delete endpoint)"
