#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://localhost:3000/api/v1"

upload() {
  local file="$1" filename="$2" number="$3"
  local identity
  identity=$(cat <<EOF
{"jurisdiction":"Virginia","session":"2026","instrumentType":"HB","number":"${number}","stage":"enrolled","chapter":null}
EOF
)

  local boundary="----VerifyBoundary$(date +%s)"
  local body
  body=$(printf -- "--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\nContent-Type: text/plain\r\n\r\n%s\r\n--%s\r\nContent-Disposition: form-data; name=\"legalIdentity\"\r\n\r\n%s\r\n--%s--\r\n" \
    "$boundary" "$filename" "$(cat "$file")" "$boundary" "$identity" "$boundary")

  curl -s -X POST "$BASE_URL/documents/upload" \
    -H "Content-Type: multipart/form-data; boundary=$boundary" \
    --data-binary "$body"
}

analyze() {
  local dvid="$1"
  echo "--- Analyzing $dvid ---"
  curl -s -X POST "$BASE_URL/documents/$dvid/analyze" -N
  echo ""
}

findings() {
  local dvid="$1"
  echo "--- Findings for $dvid ---"
  curl -s "$BASE_URL/documents/$dvid/findings" | python3 -m json.tool
  echo ""
}

echo "=== UPLOADING HB 434 ==="
R1=$(upload "fixtures/documents/va-hb434-grid-metrics.txt" "va-hb434.txt" "HB434-live")
echo "$R1"
DVID1=$(echo "$R1" | python3 -c "import sys,json; print(json.load(sys.stdin)['documentVersionId'])")
echo "documentVersionId: $DVID1"

echo ""
echo "=== UPLOADING SB 21 ==="
R2=$(upload "fixtures/documents/va-sb21-juvenile-justice.txt" "va-sb21.txt" "SB21-live")
echo "$R2"
DVID2=$(echo "$R2" | python3 -c "import sys,json; print(json.load(sys.stdin)['documentVersionId'])")
echo "documentVersionId: $DVID2"

echo ""
echo "=== UPLOADING HB 1456 ==="
R3=$(upload "fixtures/documents/va-hb1456-gov-efficiency.txt" "va-hb1456.txt" "HB1456-live")
echo "$R3"
DVID3=$(echo "$R3" | python3 -c "import sys,json; print(json.load(sys.stdin)['documentVersionId'])")
echo "documentVersionId: $DVID3"

echo ""
echo "=== ANALYZING HB 434 ==="
analyze "$DVID1"

echo ""
echo "=== ANALYZING SB 21 ==="
analyze "$DVID2"

echo ""
echo "=== ANALYZING HB 1456 ==="
analyze "$DVID3"

echo ""
echo "=== FINDINGS HB 434 ==="
findings "$DVID1"

echo ""
echo "=== FINDINGS SB 21 ==="
findings "$DVID2"

echo ""
echo "=== FINDINGS HB 1456 ==="
findings "$DVID3"
