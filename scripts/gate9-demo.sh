#!/usr/bin/env bash
# Gate 9 — Support Evaluation API demo on HB 35
set -euo pipefail

BASE="http://localhost:3000/api/v1/documents"

echo "=== Gate 9: Support Evaluation ==="
echo ""

# Upload HB 35
echo "--- Step 1: Upload HB 35 ---"
UPLOAD=$(curl -s -w "\n%{http_code}" \
  -F "file=@fixtures/documents/va-hb35-restorative-housing.pdf;type=application/pdf" \
  -F 'legalIdentity={"jurisdiction":"Virginia","session":"2026","instrumentType":"HB","number":"35","stage":"introduced","chapter":null}' \
  "$BASE/upload")
HTTP_CODE=$(echo "$UPLOAD" | tail -1)
BODY=$(echo "$UPLOAD" | sed '$d')
echo "HTTP $HTTP_CODE"
DVID=$(echo "$BODY" | jq -r '.documentVersionId')
echo "documentVersionId: $DVID"
echo ""

# Run full pipeline
echo "--- Step 2: Run pipeline (parse → scan → extract → anchor → grammar → resolve) ---"
curl -s -X POST "$BASE/$DVID/parse" | jq '{parseStatus: .parseStatus, segmentCount: .segmentCount}'
curl -s -X POST "$BASE/$DVID/scan" | jq '{scannerVersion: .scannerVersion, totalCandidates: .totalCandidates}'
curl -s -X POST "$BASE/$DVID/extract" | jq '{extractorVersion: .extractorVersion, totalProposals: .totalProposals}'
curl -s -X POST "$BASE/$DVID/anchor" | jq '{anchorerVersion: .anchorerVersion, totalAnchored: .totalAnchored, totalFailed: .totalFailed}'
curl -s -X POST "$BASE/$DVID/parse-temporal" | jq '{grammarVersion: .grammarVersion, totalParsed: .totalParsed, totalFailed: .totalFailed}'
curl -s -X POST "$BASE/$DVID/resolve" \
  -H "Content-Type: application/json" \
  -d '{"inputs":[]}' | jq '{resolverVersion: .resolverVersion, totalResolved: .totalResolved, totalUnresolved: .totalUnresolved}'
echo ""

# Evaluate
echo "--- Step 3: Evaluate ---"
EVAL=$(curl -s -X POST "$BASE/$DVID/evaluate")
echo "$EVAL" | jq '{
  evaluatorVersion: .evaluatorVersion,
  promptHash: .promptHash,
  approved: .approved,
  totalEvaluated: .totalEvaluated,
  totalSupported: .totalSupported,
  totalAmbiguous: .totalAmbiguous,
  totalUnsupported: .totalUnsupported
}'
echo ""

echo "--- Evaluation details (first 5) ---"
echo "$EVAL" | jq '.evaluations[:5][] | {
  anchorId: .anchorId,
  quotedText: .quotedText,
  deterministicPassed: .deterministicResult.allPassed,
  evaluatorVerdict: .evaluatorVerdict,
  supportLevel: .supportLevel,
  checks: [.deterministicResult.checks[] | {check: .check, status: .status}]
}'
echo ""

echo "--- INV-4 check: no evaluation has verdict='supported' ---"
SUPPORTED_COUNT=$(echo "$EVAL" | jq '[.evaluations[] | select(.evaluatorVerdict == "supported")] | length')
echo "Evaluations with verdict 'supported': $SUPPORTED_COUNT (must be 0)"
echo ""

echo "=== Gate 9 demo complete ==="
