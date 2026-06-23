#!/bin/bash
# Tenant-isolation security test.
# Tenant B creates records; Tenant A (a DIFFERENT tenant_admin) tries to reach them.
# Any 200 that exposes B's data is a CRITICAL breach.
BASE="http://localhost:3000"; API="$BASE/api/v1"
login() { curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"agent@$1.test\",\"password\":\"IsoAgent1234!\",\"tenantSlug\":\"$1\"}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('data',d)['token'])"; }
A=$(login isotest-a); B=$(login isotest-b)
[ -z "$A" ] || [ -z "$B" ] && { echo "login failed"; exit 1; }
echo "A and B logged in (different tenants, both operational agents)"; echo

PASS=0; FAIL=0; CRIT=""
code() { curl -s -o /dev/null -w '%{http_code}' "${@:2}" -H "Authorization: Bearer $1"; }
jid() { python3 -c "import sys,json;d=json.load(sys.stdin);d=d.get('data',d);print(d.get('id','') if isinstance(d,dict) else '')"; }

# secure = A is blocked (403/404). breach = A sees/edits B's data (200/204).
sec() { # label  code
  local label="$1" c="$2"
  if [[ "$c" =~ ^(401|403|404)$ ]]; then PASS=$((PASS+1)); printf "  SECURE  %-42s %s\n" "$label" "$c"
  else FAIL=$((FAIL+1)); CRIT="$CRIT\n  BREACH: $label -> $c"; printf "  BREACH  %-42s %s\n" "$label" "$c"; fi
}

mkB() { curl -s -X POST "$API/$1" -H "Authorization: Bearer $B" -H 'Content-Type: application/json' -d "$2"; }

echo "=== Tenant B creates records ==="
CID=$(mkB contacts '{"firstName":"BSecret","lastName":"Contact","email":"b@isob.test"}' | jid); echo "  B contact:  $CID"
COID=$(mkB companies '{"name":"B Secret Co"}' | jid); echo "  B company:  $COID"
PIPE=$(curl -s "$API/deals/pipelines" -H "Authorization: Bearer $B")
read PID SID < <(printf '%s' "$PIPE" | python3 -c "import sys,json;d=json.load(sys.stdin);r=d.get('data',d);p=r[0] if r else {};s=p.get('stages') or [];print(p.get('id',''),(s[0].get('id') if s else ''))")
DID=$(mkB deals "{\"name\":\"B Secret Deal\",\"pipelineId\":\"$PID\",\"stageId\":\"$SID\",\"amount\":9999}" | jid); echo "  B deal:     $DID"
TID=$(mkB tickets '{"subject":"B Secret Ticket","ticketType":"complaint"}' | jid); echo "  B ticket:   $TID"
echo

echo "=== Tenant A tries to READ B's records by ID (expect SECURE) ==="
[ -n "$CID" ]  && sec "A GET   B contact"  "$(code $A "$API/contacts/$CID")"
[ -n "$COID" ] && sec "A GET   B company"  "$(code $A "$API/companies/$COID")"
[ -n "$DID" ]  && sec "A GET   B deal"     "$(code $A "$API/deals/$DID")"
[ -n "$TID" ]  && sec "A GET   B ticket"   "$(code $A "$API/tickets/$TID")"

echo "=== Tenant A tries to MODIFY B's records (expect SECURE) ==="
[ -n "$CID" ]  && sec "A PATCH B contact"  "$(code $A "$API/contacts/$CID" -X PATCH -H 'Content-Type: application/json' -d '{"jobTitle":"HACKED"}')"
[ -n "$COID" ] && sec "A PATCH B company"  "$(code $A "$API/companies/$COID" -X PATCH -H 'Content-Type: application/json' -d '{"city":"HACKED"}')"
[ -n "$DID" ]  && sec "A PATCH B deal"     "$(code $A "$API/deals/$DID" -X PATCH -H 'Content-Type: application/json' -d '{"amount":1}')"
[ -n "$TID" ]  && sec "A PATCH B ticket"   "$(code $A "$API/tickets/$TID" -X PATCH -H 'Content-Type: application/json' -d '{"priority":"low"}')"

echo "=== Tenant A tries to DELETE B's records (expect SECURE) ==="
[ -n "$CID" ]  && sec "A DEL   B contact"  "$(code $A "$API/contacts/$CID" -X DELETE)"
[ -n "$COID" ] && sec "A DEL   B company"  "$(code $A "$API/companies/$COID" -X DELETE)"
[ -n "$DID" ]  && sec "A DEL   B deal"     "$(code $A "$API/deals/$DID" -X DELETE)"

echo "=== List-leakage: A's lists must NOT contain B's IDs ==="
for pair in "contacts:$CID" "companies:$COID" "deals:$DID" "tickets:$TID"; do
  ep="${pair%%:*}"; bid="${pair##*:}"; [ -z "$bid" ] && continue
  leak=$(curl -s "$API/$ep?pageSize=200" -H "Authorization: Bearer $A" | python3 -c "import sys,json;d=json.load(sys.stdin);r=d.get('data',[]);r=r if isinstance(r,list) else r.get('items',[]);print('LEAK' if any((x.get('id')=='$bid') for x in r) else 'clean')" 2>/dev/null)
  if [ "$leak" = "clean" ]; then PASS=$((PASS+1)); printf "  SECURE  %-42s %s\n" "A list $ep excludes B" "clean"
  else FAIL=$((FAIL+1)); CRIT="$CRIT\n  BREACH: A list $ep contains B's record"; printf "  BREACH  %-42s %s\n" "A list $ep" "LEAK"; fi
done

echo "=== Cross-tenant login: A's email against B's workspace (expect fail) ==="
xlogin=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d '{"email":"agent@isotest-a.test","password":"IsoAgent1234!","tenantSlug":"isotest-b"}')
sec "A creds + B workspace rejected" "$xlogin"

echo "=== Confirm B can still see its OWN data (control) ==="
own=$(code $B "$API/contacts/$CID"); [ "$own" = "200" ] && echo "  OK      B sees own contact            200" || echo "  WARN    B cannot see own contact ($own)"

echo
echo "================ ISOLATION RESULTS ================"
echo "SECURE=$PASS  BREACHES=$FAIL"
[ "$FAIL" -gt 0 ] && echo -e "CRITICAL:$CRIT" || echo "No cross-tenant access detected."
