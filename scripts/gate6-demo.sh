#!/usr/bin/env bash
# Gate 6 — Legal Date Grammar end-to-end verification.
#
# Uploads a fixture document, runs the full pipeline
# (parse → scan → extract → anchor → parse-temporal),
# and prints the grammar output showing every anchored span
# with its parse result.
#
# Usage:
#   ./scripts/gate6-demo.sh <fixture-path> <jurisdiction> <instrument> <number>
#
# Examples:
#   ./scripts/gate6-demo.sh fixtures/documents/va-hb35-restorative-housing.pdf Virginia HB 35-demo
#   ./scripts/gate6-demo.sh fixtures/documents/adversarial-temporal.txt Virginia HB 999-demo
set -euo pipefail

FIXTURE="${1:?Usage: gate6-demo.sh <fixture-path> <jurisdiction> <instrument> <number>}"
JURISDICTION="${2:?Missing jurisdiction}"
INSTRUMENT="${3:?Missing instrument type}"
NUMBER="${4:?Missing bill number}"

BASE_URL="${API_BASE_URL:-http://localhost:3000}"

# Detect content type from extension
case "$FIXTURE" in
  *.pdf) CONTENT_TYPE="application/pdf" ;;
  *.txt) CONTENT_TYPE="text/plain" ;;
  *.docx) CONTENT_TYPE="application/vnd.openxmlformats-officedocument.wordprocessingml.document" ;;
  *) echo "Unsupported file type: $FIXTURE" >&2; exit 1 ;;
esac

IDENTITY="{\"jurisdiction\":\"$JURISDICTION\",\"session\":\"2026\",\"instrumentType\":\"$INSTRUMENT\",\"number\":\"$NUMBER\",\"stage\":\"introduced\",\"chapter\":null}"

echo "=== Upload ==="
UPLOAD=$(curl -s -X POST "$BASE_URL/api/v1/documents/upload" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@$FIXTURE;type=$CONTENT_TYPE" \
  -F "legalIdentity=$IDENTITY")
DV_ID=$(echo "$UPLOAD" | jq -r '.documentVersionId')
echo "documentVersionId: $DV_ID"

echo ""
echo "=== Parse ==="
curl -s -X POST "$BASE_URL/api/v1/documents/$DV_ID/parse" | jq '{segmentCount, parserVersion}'

echo ""
echo "=== Scan ==="
curl -s -X POST "$BASE_URL/api/v1/documents/$DV_ID/scan" | jq '{totalCandidates, totalSuppressed}'

echo ""
echo "=== Extract ==="
curl -s -X POST "$BASE_URL/api/v1/documents/$DV_ID/extract" | jq '{totalProposals, totalSegmentsProcessed, totalSegmentsSkipped}'

echo ""
echo "=== Anchor ==="
curl -s -X POST "$BASE_URL/api/v1/documents/$DV_ID/anchor" | jq '{totalProposals, totalAnchored, totalFailed}'

echo ""
echo "=== Grammar (parse-temporal) ==="
curl -s -X POST "$BASE_URL/api/v1/documents/$DV_ID/parse-temporal" | jq '.'
