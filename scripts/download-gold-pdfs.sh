#!/usr/bin/env bash
set -euo pipefail

GOLD_DIR="$(cd "$(dirname "$0")/../fixtures/gold" && pwd)"

download() {
  local slug="$1" url="$2" filename="$3"
  local dir="$GOLD_DIR/$slug"
  mkdir -p "$dir"
  if [ -f "$dir/$filename" ]; then
    echo "SKIP: $slug/$filename already exists"
    return
  fi
  echo "Downloading $slug/$filename ..."
  curl -sSfL -o "$dir/$filename" "$url" || {
    echo "FAILED: $slug ($url)"
    rm -f "$dir/$filename"
    return 1
  }
  echo "  OK: $(wc -c < "$dir/$filename") bytes"
}

echo "=== Downloading gold-set PDFs ==="
echo ""

# --- Freestanding federal public laws ---

download "plaw-113publ101" \
  "https://www.govinfo.gov/content/pkg/PLAW-113publ101/pdf/PLAW-113publ101.pdf" \
  "PLAW-113publ101.pdf"

download "plaw-114publ195" \
  "https://www.govinfo.gov/content/pkg/PLAW-114publ195/pdf/PLAW-114publ195.pdf" \
  "PLAW-114publ195.pdf"

download "plaw-115publ435" \
  "https://www.govinfo.gov/content/pkg/PLAW-115publ435/pdf/PLAW-115publ435.pdf" \
  "PLAW-115publ435.pdf"

download "plaw-116publ283" \
  "https://www.govinfo.gov/content/pkg/PLAW-116publ283/pdf/PLAW-116publ283.pdf" \
  "PLAW-116publ283.pdf"

download "plaw-117publ263" \
  "https://www.govinfo.gov/content/pkg/PLAW-117publ263/pdf/PLAW-117publ263.pdf" \
  "PLAW-117publ263.pdf"

download "plaw-117publ103" \
  "https://www.govinfo.gov/content/pkg/PLAW-117publ103/pdf/PLAW-117publ103.pdf" \
  "PLAW-117publ103.pdf"

download "plaw-118publ31" \
  "https://www.govinfo.gov/content/pkg/PLAW-118publ31/pdf/PLAW-118publ31.pdf" \
  "PLAW-118publ31.pdf"

# --- Virginia acts of assembly ---

download "va-ch0001-2024" \
  "https://lis.virginia.gov/static/pdf/2024/chapters/chapters_1.pdf" \
  "va-ch0001-2024.pdf"

download "va-ch0002-2024" \
  "https://lis.virginia.gov/static/pdf/2024/chapters/chapters_2.pdf" \
  "va-ch0002-2024.pdf"

download "va-ch0750-2024" \
  "https://lis.virginia.gov/static/pdf/2024/chapters/chapters_750.pdf" \
  "va-ch0750-2024.pdf"

download "va-ch0771-2024" \
  "https://lis.virginia.gov/static/pdf/2024/chapters/chapters_771.pdf" \
  "va-ch0771-2024.pdf"

download "va-ch0817-2024" \
  "https://lis.virginia.gov/static/pdf/2024/chapters/chapters_817.pdf" \
  "va-ch0817-2024.pdf"

# --- Amendment-by-instruction federal bills (correct output = nothing) ---

download "plaw-117publ347" \
  "https://www.govinfo.gov/content/pkg/PLAW-117publ347/pdf/PLAW-117publ347.pdf" \
  "PLAW-117publ347.pdf"

download "plaw-117publ81" \
  "https://www.govinfo.gov/content/pkg/PLAW-117publ81/pdf/PLAW-117publ81.pdf" \
  "PLAW-117publ81.pdf"

download "plaw-118publ9" \
  "https://www.govinfo.gov/content/pkg/PLAW-118publ9/pdf/PLAW-118publ9.pdf" \
  "PLAW-118publ9.pdf"

# --- Documents with known drafting defects ---
# plaw-114publ117 already in gold set (existing, has 2 defects)
# These are additional short PLAWs likely to contain cross-reference or dating issues

download "plaw-115publ141" \
  "https://www.govinfo.gov/content/pkg/PLAW-115publ141/pdf/PLAW-115publ141.pdf" \
  "PLAW-115publ141.pdf"

download "plaw-116publ87" \
  "https://www.govinfo.gov/content/pkg/PLAW-116publ87/pdf/PLAW-116publ87.pdf" \
  "PLAW-116publ87.pdf"

echo ""
echo "=== Download complete ==="
echo "Directories created:"
ls -1d "$GOLD_DIR"/*/
