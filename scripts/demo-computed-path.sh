#!/usr/bin/env bash
set -euo pipefail

BASE="http://localhost:3000/api/v1"
RUN=$(date +%s)

echo "=== Step 1: Upload simple-bill.txt ==="
DV_ID=$(curl -s -X POST "$BASE/documents/upload" \
  -F "file=@fixtures/documents/simple-bill.txt;type=text/plain" \
  -F "legalIdentity={\"jurisdiction\":\"Virginia\",\"session\":\"2025\",\"instrumentType\":\"HB\",\"number\":\"computed-${RUN}\",\"stage\":\"introduced\",\"chapter\":null}" \
  | jq -r '.documentVersionId')
echo "documentVersionId: $DV_ID"

echo ""
echo "=== Step 2: Analyse ==="
curl -s -X POST "$BASE/documents/$DV_ID/analyse" \
  -H "Idempotency-Key: analyse-$RUN" | jq '{status: .analysis.status}'

echo ""
echo "=== Step 3: Find resolved proposal ==="
PROPOSALS=$(curl -s "$BASE/documents/$DV_ID/proposals")
echo "$PROPOSALS" | jq '.proposals[] | select(.resolved == true) | {proposalId, quotedText, resolved, statutoryDate, ruleIds, citations, packVersion}'
PROP_ID=$(echo "$PROPOSALS" | jq -r '.proposals[] | select(.resolved == true) | .proposalId')

echo ""
echo "=== Step 4: Accept (computed path) ==="
REVIEW=$(curl -s -X POST "$BASE/proposals/$PROP_ID/review" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: accept-$RUN" \
  -d '{"action":"accept","reviewerId":"vgrover"}')

echo ""
echo "=== REGISTER ROW ==="
echo "$REVIEW" | jq '.records[0]'

RECORD_ID=$(echo "$REVIEW" | jq -r '.records[0].recordId')

echo ""
echo "=== FULL PROVENANCE SHEET ==="
curl -s "$BASE/register/$RECORD_ID/provenance" | jq '.provenance'
