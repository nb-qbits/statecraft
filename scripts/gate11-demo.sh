#!/usr/bin/env bash
set -euo pipefail

# Gate 11 — Review Workflow and Register Demo
# Prerequisite: docker compose up -d --build && npm run db:migrate

BASE="http://localhost:3000/api/v1"
RUN=$(date +%s)
echo "=== Gate 11: Review Workflow & Register ==="

echo ""
echo "--- 1. Upload simple-bill.txt ---"
UPLOAD=$(curl -s -X POST "${BASE%/api/v1}/api/v1/documents/upload" \
  -F "file=@fixtures/documents/simple-bill.txt;type=text/plain" \
  -F "legalIdentity={\"jurisdiction\":\"Virginia\",\"session\":\"2025\",\"instrumentType\":\"HB\",\"number\":\"11demo-${RUN}\",\"stage\":\"introduced\",\"chapter\":null}")

DV_ID=$(echo "$UPLOAD" | jq -r '.documentVersionId')
echo "documentVersionId: $DV_ID"

echo ""
echo "--- 2. Start analysis (full pipeline) ---"
ANALYSIS=$(curl -s -X POST "${BASE}/documents/${DV_ID}/analyse" \
  -H "Idempotency-Key: analyse-demo-${RUN}")
echo "$ANALYSIS" | jq '{status: .analysis.status, analysisId: .analysis.analysisId}'

echo ""
echo "--- 3. Poll status ---"
STATUS=$(curl -s "${BASE}/documents/${DV_ID}/analysis/status")
echo "$STATUS" | jq '.analysis.status'

echo ""
echo "--- 4. Fetch proposals ---"
PROPOSALS=$(curl -s "${BASE}/documents/${DV_ID}/proposals")
echo "$PROPOSALS" | jq '{totalProposals: .totalProposals, proposals: [.proposals[] | {proposalId, kind, supportLevel, lane, resolved, status}]}'

echo ""
echo "--- 5. Review: edit-and-accept first proposal ---"
PROP_ID=$(echo "$PROPOSALS" | jq -r '.proposals[0].proposalId')
RESOLVED=$(echo "$PROPOSALS" | jq -r '.proposals[0].resolved')

if [ "$RESOLVED" = "true" ]; then
  ACTION="accept"
  BODY="{\"action\":\"accept\",\"reviewerId\":\"demo-reviewer\"}"
else
  ACTION="edit_and_accept"
  BODY="{\"action\":\"edit_and_accept\",\"reviewerId\":\"demo-reviewer\",\"edits\":{\"deadlineDate\":\"2025-09-15\",\"adjustedDate\":\"2025-09-15\",\"deliverable\":\"compliance report\"}}"
fi

echo "Action: $ACTION for proposal $PROP_ID"
REVIEW=$(curl -s -X POST "${BASE}/proposals/${PROP_ID}/review" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: review-demo-${RUN}" \
  -d "$BODY")
echo "$REVIEW" | jq '{action: .event.action, reviewerId: .event.reviewerId, recordCount: (.records | length), recordId: .records[0].recordId}'

echo ""
echo "--- 6. Fetch register ---"
REGISTER=$(curl -s "${BASE}/register")
echo "$REGISTER" | jq '{totalRecords: .totalRecords}'

echo ""
echo "--- 7. Fetch provenance sheet ---"
RECORD_ID=$(echo "$REVIEW" | jq -r '.records[0].recordId')
PROVENANCE=$(curl -s "${BASE}/register/${RECORD_ID}/provenance")
echo "=== PROVENANCE SHEET ==="
echo "$PROVENANCE" | jq '.provenance'

echo ""
echo "--- 8. INV-9 check: all records have reviewEventId ---"
echo "$REGISTER" | jq '[.records[] | {recordId, hasReviewEvent: (.reviewEventId != null)}]'

echo ""
echo "=== Gate 11 Demo Complete ==="
