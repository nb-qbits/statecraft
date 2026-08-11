#!/bin/bash
# Gate 8 API demo — HB 35 resolution
# Run with: bash scripts/gate8-demo.sh
set -euo pipefail

BASE_URL="http://localhost:3000/api/v1/documents"
UPLOAD_URL="$BASE_URL/upload"
FIXTURE="fixtures/documents/va-hb35-restorative-housing.pdf"
RUN_ID=$(date +%s)

echo "=== Gate 8 Demo: HB 35 Resolution ==="
echo ""

# Step 1: Upload
echo "--- Step 1: Upload HB 35 ---"
UPLOAD_RESPONSE=$(curl -s -X POST "$UPLOAD_URL" \
  -F "file=@$FIXTURE;type=application/pdf" \
  -F "legalIdentity={\"jurisdiction\":\"Virginia\",\"session\":\"2026\",\"instrumentType\":\"HB\",\"number\":\"gate8-demo-$RUN_ID\",\"stage\":\"introduced\",\"chapter\":null}")

DV_ID=$(echo "$UPLOAD_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['documentVersionId'])")
echo "documentVersionId: $DV_ID"
echo ""

# Step 2: Pipeline through grammar
echo "--- Step 2: Parse → Scan → Extract → Anchor → Grammar ---"
curl -s -X POST "$BASE_URL/$DV_ID/parse" > /dev/null
curl -s -X POST "$BASE_URL/$DV_ID/scan" > /dev/null
curl -s -X POST "$BASE_URL/$DV_ID/extract" > /dev/null
curl -s -X POST "$BASE_URL/$DV_ID/anchor" > /dev/null
curl -s -X POST "$BASE_URL/$DV_ID/parse-temporal" > /dev/null
echo "Pipeline complete."
echo ""

# Step 3: Resolve WITHOUT trigger date
echo "--- Step 3: Resolve WITHOUT trigger date ---"
RESOLVE_NO_TRIGGER=$(curl -s -X POST "$BASE_URL/$DV_ID/resolve" \
  -H "Content-Type: application/json" \
  -d '{"inputs":[]}')
echo "$RESOLVE_NO_TRIGGER" | python3 -m json.tool
echo ""

# Step 4: Resolve WITH trigger date
echo "--- Step 4: Resolve WITH trigger date (2026-03-15) ---"
RESOLVE_WITH_TRIGGER=$(curl -s -X POST "$BASE_URL/$DV_ID/resolve" \
  -H "Content-Type: application/json" \
  -d '{"inputs":[{"name":"triggerDate","value":"2026-03-15","source":"manual_input","authority":"analyst","citation":"assumed trigger date for gate 8 demo"}]}')
echo "$RESOLVE_WITH_TRIGGER" | python3 -m json.tool
echo ""

echo "=== Gate 8 Demo Complete ==="
