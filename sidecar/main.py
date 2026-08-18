"""Parser sidecar — PDF text extraction with geometric line-number stripping."""

from collections import Counter
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
import pdfplumber
import io
import re

app = FastAPI(title="policyaction-sidecar", version="1.0.0")

CONTRACT_VERSION = "1.1.0"
MIN_BODY_FONT_SIZE = 9.0

PAGE_FOOTER_RE = re.compile(
    r"^\s*(?:"
    r"-\s*\d+\s*-"
    r"|Page\s+\d+(?:\s+of\s+\d+)?"
    r"|(?:H{1,2}B{1,2}\d+.*\d+\s+of\s+\d+)"
    r")\s*$",
    re.IGNORECASE,
)


def _find_body_left_margin(chars: list[dict]) -> float:
    """Histogram x0 values of body-sized alphabetic chars; dominant cluster is body margin."""
    alpha_x0s = [
        round(c["x0"], 0)
        for c in chars
        if c["text"].strip().isalpha() and c.get("size", 0) >= MIN_BODY_FONT_SIZE
    ]
    if not alpha_x0s:
        return 0.0
    counts = Counter(alpha_x0s)
    return min(counts.most_common(3), key=lambda kv: kv[0])[0]


def _is_line_number_row(row_chars: list[dict], body_margin: float) -> bool:
    """A row is a line-number row if ALL its content chars are digits left of body margin."""
    content = [c for c in row_chars if c["text"].strip()]
    if not content:
        return False
    if any(c["x0"] >= body_margin - 5 for c in content):
        return False
    return all(c["text"].strip().isdigit() for c in content)


def _build_line_with_gaps(chars: list[dict]) -> str:
    """Concatenate characters, inserting a space when the x0 gap between
    consecutive non-space characters exceeds 30% of the font size.
    Handles small-caps headings where inter-word spacing is positional,
    not an explicit space character."""
    if not chars:
        return ""
    parts: list[str] = []
    prev_x1: float | None = None
    for c in chars:
        if prev_x1 is not None and c["text"].strip():
            gap = c["x0"] - prev_x1
            threshold = c.get("size", 12.0) * 0.3
            if gap > threshold:
                parts.append(" ")
        parts.append(c["text"])
        prev_x1 = c["x0"] + c.get("width", 0)
    return "".join(parts)


def _extract_page(page) -> dict:
    """Extract text from a single page with geometric line-number stripping."""
    raw_chars = page.chars
    if not raw_chars:
        return {
            "pageNumber": page.page_number,
            "text": "",
            "hasTextLayer": False,
            "charCount": 0,
        }

    # Filter out sub-body-size artifacts (border marks, watermarks, doubled banner glyphs)
    chars = [c for c in raw_chars if c.get("size", 0) >= MIN_BODY_FONT_SIZE]
    if not chars:
        return {
            "pageNumber": page.page_number,
            "text": "",
            "hasTextLayer": True,
            "charCount": len([c for c in raw_chars if c["text"].strip()]),
        }

    page_width = page.width
    body_margin = _find_body_left_margin(chars)

    # Group chars by top coordinate (3pt tolerance catches small-caps
    # heading fragments rendered at a slightly different baseline)
    rows: dict[float, list[dict]] = {}
    for c in chars:
        top = round(c["top"], 0)
        matched = False
        for existing_top in list(rows.keys()):
            if abs(existing_top - top) <= 3:
                rows[existing_top].append(c)
                matched = True
                break
        if not matched:
            rows[top] = [c]

    text_lines: list[str] = []
    sorted_tops = sorted(rows.keys())

    for top in sorted_tops:
        row_chars = sorted(rows[top], key=lambda c: c["x0"])

        if _is_line_number_row(row_chars, body_margin):
            continue

        # Filter out watermark characters (Courier-Bold at far right)
        filtered = [
            c for c in row_chars
            if not (c["x0"] > page_width - 60 and c["fontname"] == "Courier-Bold")
        ]
        if not filtered:
            continue

        # Filter out stray line-number digits at far left of a content row
        content = []
        for c in filtered:
            if c["x0"] < body_margin - 10 and c["text"].strip().isdigit():
                continue
            content.append(c)

        if not content:
            continue

        line = _build_line_with_gaps(content).rstrip()
        if not line.strip():
            continue
        text_lines.append(line)

    # Strip page footers
    final_lines: list[str] = []
    for line in text_lines:
        if PAGE_FOOTER_RE.match(line):
            continue
        final_lines.append(line)

    text = "\n".join(final_lines)
    return {
        "pageNumber": page.page_number,
        "text": text,
        "hasTextLayer": True,
        "charCount": len([c for c in raw_chars if c["text"].strip()]),
    }


@app.get("/health")
async def health():
    return {"status": "ok", "contractVersion": CONTRACT_VERSION}


@app.post("/v1/parse")
async def parse(file: UploadFile = File(...)):
    content = await file.read()

    if not content.startswith(b"%PDF"):
        return JSONResponse(
            status_code=422,
            content={"error": "Not a valid PDF file (missing %PDF header)"},
        )

    try:
        pdf = pdfplumber.open(io.BytesIO(content))
    except Exception as e:
        return JSONResponse(
            status_code=422,
            content={"error": f"Failed to open PDF: {str(e)}"},
        )

    all_fonts: set[str] = set()
    pages_result = []
    has_any_text = False

    try:
        for page in pdf.pages:
            page_data = _extract_page(page)
            pages_result.append(page_data)
            if page_data["hasTextLayer"]:
                has_any_text = True
            for c in page.chars:
                all_fonts.add(c["fontname"])
    finally:
        pdf.close()

    return {
        "version": CONTRACT_VERSION,
        "pages": pages_result,
        "metadata": {
            "fonts": sorted(all_fonts),
            "pageCount": len(pages_result),
            "hasTextLayer": has_any_text,
        },
    }
