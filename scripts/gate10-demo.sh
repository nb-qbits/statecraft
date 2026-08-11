#!/usr/bin/env bash
set -euo pipefail

# Gate 10 — Lane Router and Coverage Accounting
# Requires: docker compose up -d --build && docker compose exec app node dist/platform/db/migrate.js

BASE="http://localhost:3000/api/v1/documents"

echo "=== Gate 10: Lane Router and Coverage Accounting ==="
echo ""

# 1. Upload HB 35
echo "--- Step 1: Upload HB 35 (PDF, introduced) ---"
UPLOAD=$(curl -s -w "\n%{http_code}" -X POST "$BASE/upload" \
  -F "file=@fixtures/documents/va-hb35-restorative-housing.pdf;type=application/pdf" \
  -F 'legalIdentity={"jurisdiction":"Virginia","session":"2026","instrumentType":"HB","number":"10099","stage":"introduced","chapter":null}')
HTTP_CODE=$(echo "$UPLOAD" | tail -1)
BODY=$(echo "$UPLOAD" | sed '$d')
echo "HTTP $HTTP_CODE"
DV_ID=$(echo "$BODY" | jq -r '.documentVersionId')
echo "documentVersionId: $DV_ID"
echo ""

# 2. Full pipeline
echo "--- Step 2: Run full pipeline (parse → scan → extract → anchor → grammar → resolve → evaluate) ---"
curl -s -X POST "$BASE/$DV_ID/parse" | jq '{parseStatus: .parseStatus, segmentCount: .segmentCount}'
curl -s -X POST "$BASE/$DV_ID/scan" | jq '{totalCandidates: .totalCandidates}'
curl -s -X POST "$BASE/$DV_ID/extract" | jq '{totalProposals: .totalProposals}'
curl -s -X POST "$BASE/$DV_ID/anchor" | jq '{totalAnchored: .totalAnchored}'
curl -s -X POST "$BASE/$DV_ID/parse-temporal" | jq '{totalParsed: .totalParsed}'
curl -s -X POST "$BASE/$DV_ID/resolve" -H "Content-Type: application/json" -d '{"inputs":[]}' | jq '{totalResolved: .totalResolved}'
curl -s -X POST "$BASE/$DV_ID/evaluate" | jq '{totalEvaluated: .totalEvaluated, approved: .approved}'
echo ""

# 3. Route
echo "--- Step 3: Route document ---"
ROUTE_RESULT=$(curl -s -X POST "$BASE/$DV_ID/route")
echo "$ROUTE_RESULT" | jq '.'
echo ""

# 4. Verify INV-8: no straight_through for introduced document
echo "--- INV-8 check: straight_through count for introduced document ---"
ST_COUNT=$(echo "$ROUTE_RESULT" | jq '.laneSummary.straight_through')
echo "straight_through count: $ST_COUNT"
if [ "$ST_COUNT" = "0" ]; then
  echo "PASS: introduced document has zero straight_through assignments"
else
  echo "FAIL: introduced document should have zero straight_through"
  exit 1
fi
echo ""

# 5. Verify coverage reconciliation
echo "--- Coverage reconciliation ---"
TOTAL=$(echo "$ROUTE_RESULT" | jq '.processingCoverage.totalSegments')
WITH=$(echo "$ROUTE_RESULT" | jq '.processingCoverage.withCandidates')
SCREENED=$(echo "$ROUTE_RESULT" | jq '.processingCoverage.screenedNoCandidate')
SWEEP=$(echo "$ROUTE_RESULT" | jq '.processingCoverage.needsSweep')
SUM=$((WITH + SCREENED + SWEEP))
echo "totalSegments: $TOTAL"
echo "withCandidates: $WITH"
echo "screenedNoCandidate: $SCREENED"
echo "needsSweep: $SWEEP"
echo "sum: $SUM"
if [ "$SUM" = "$TOTAL" ]; then
  echo "PASS: coverage counts reconcile"
else
  echo "FAIL: sum ($SUM) != total ($TOTAL)"
  exit 1
fi
echo ""

# 6. Verify reasons stored for every assignment
echo "--- Reasons check ---"
EMPTY_REASONS=$(echo "$ROUTE_RESULT" | jq '[.assignments[] | select(.reasons | length == 0)] | length')
echo "assignments with empty reasons: $EMPTY_REASONS"
if [ "$EMPTY_REASONS" = "0" ]; then
  echo "PASS: every assignment has at least one reason"
else
  echo "FAIL: some assignments have no reasons"
  exit 1
fi
echo ""

# 7. Verify determinism — route again, compare
echo "--- Determinism check ---"
ROUTE_RESULT2=$(curl -s -X POST "$BASE/$DV_ID/route")
LANES1=$(echo "$ROUTE_RESULT" | jq -S '.laneSummary')
LANES2=$(echo "$ROUTE_RESULT2" | jq -S '.laneSummary')
if [ "$LANES1" = "$LANES2" ]; then
  echo "PASS: lane summary identical across runs"
else
  echo "FAIL: lane summary differs"
  echo "Run 1: $LANES1"
  echo "Run 2: $LANES2"
  exit 1
fi
echo ""

# 8. INV-9: auto-publish is unreachable
echo "--- INV-9 check: auto-publish path must not exist as reachable code ---"
echo "Searching production code (excluding tests) for publish/auto-approve functions..."
PUBLISH_HITS=$(grep -rn --include="*.ts" --exclude="*.test.ts" "publish\|autoApprove\|auto_approve\|markAuthoritative" src/modules/routing/ || true)
if [ -z "$PUBLISH_HITS" ]; then
  echo "PASS: no publish/auto-approve/auto-publish code exists in routing module"
else
  echo "FAIL: found publish-related code:"
  echo "$PUBLISH_HITS"
  exit 1
fi
echo ""

echo "=== Gate 10 complete ==="
