"""Parser sidecar — PDF text extraction with layout-aware classification."""

from collections import Counter
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
import pdfplumber
import io
import re

app = FastAPI(title="policyaction-sidecar", version="1.0.0")

CONTRACT_VERSION = "1.5.0"

RUNNING_HEADER_RE = re.compile(
    r"(?:PUBLIC\s+LAW|STAT\.\s*\d|ACTS\s+OF\s+ASSEMBLY)",
    re.IGNORECASE,
)

PAGE_FOOTER_RE = re.compile(
    r"^\s*(?:"
    r"-\s*\d+\s*-"
    r"|Page\s+\d+(?:\s+of\s+\d+)?"
    r"|\d+\s+of\s+\d+"
    r"|(?:H{1,2}B{1,2}\d+.*\d+\s+of\s+\d+)"
    r")\s*$",
    re.IGNORECASE,
)

BACK_MATTER_RE = re.compile(
    r"^\s*(?:"
    r"LEGISLATIVE\s*HISTORY"
    r"|Legislative\s*History"
    r"|Æ"
    r")",
    re.IGNORECASE,
)

VERDATE_RE = re.compile(r"VerDate\s+", re.IGNORECASE)
GPO_SYSTEM_RE = re.compile(r"(?:Jkt|Frm|Fmt|Sfmt)\s+\d+", re.IGNORECASE)


def _detect_body_font_size(chars: list[dict]) -> float:
    """Find the dominant font size among alphabetic characters."""
    alpha_sizes = [
        round(c.get("size", 0), 1)
        for c in chars
        if c["text"].strip().isalpha()
    ]
    if not alpha_sizes:
        return 10.0
    counts = Counter(alpha_sizes)
    return counts.most_common(1)[0][0]


def _is_line_number_row(row_chars: list[dict], body_left: float) -> bool:
    """A row is a line-number row if ALL its content chars are digits left of body margin."""
    content = [c for c in row_chars if c["text"].strip()]
    if not content:
        return False
    if any(c["x0"] >= body_left - 5 for c in content):
        return False
    return all(c["text"].strip().isdigit() for c in content)


def _build_line_with_gaps(chars: list[dict]) -> str:
    """Concatenate characters, inserting a space when the x0 gap between
    consecutive non-space characters exceeds 25% of the smaller adjacent font size."""
    if not chars:
        return ""
    parts: list[str] = []
    prev_x1: float | None = None
    prev_size: float = 12.0
    for c in chars:
        if prev_x1 is not None and c["text"].strip():
            gap = c["x0"] - prev_x1
            min_size = min(prev_size, c.get("size", 12.0))
            threshold = min_size * 0.25
            if gap > threshold:
                parts.append(" ")
        parts.append(c["text"])
        prev_x1 = c["x0"] + c.get("width", 0)
        if c["text"].strip():
            prev_size = c.get("size", 12.0)
    return "".join(parts)


def _repair_line_break_hyphens(lines: list[str]) -> list[str]:
    """Rejoin words split across lines by line-ending hyphens.
    Only joins when continuation starts with lowercase (line-break signal).
    Preserves genuine hyphens."""
    if len(lines) < 2:
        return lines
    result: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.rstrip()
        if (
            i + 1 < len(lines)
            and len(stripped) >= 2
            and stripped[-1] == "-"
            and stripped[-2].isalpha()
        ):
            next_line = lines[i + 1].lstrip()
            if next_line and next_line[0].islower():
                m = re.match(r"([a-z]+)(.*)", next_line)
                if m:
                    repaired = stripped[:-1] + m.group(1)
                    rest = m.group(2).strip()
                    if rest:
                        result.append(repaired)
                        lines[i + 1] = rest
                    else:
                        result.append(repaired)
                        i += 2
                        continue
                    i += 1
                    continue
        result.append(line)
        i += 1
    return result


def _group_chars_by_row(chars: list[dict]) -> dict[float, list[dict]]:
    """Group characters by top coordinate with 3pt tolerance."""
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
    return rows


def _extract_page(page, body_font_size: float) -> dict:
    """Extract text from a single page with layout-aware classification.
    Uses row-level body/marginal separation based on body-font char extent."""
    raw_chars = page.chars
    if not raw_chars:
        return {
            "pageNumber": page.page_number,
            "text": "",
            "hasTextLayer": False,
            "charCount": 0,
        }

    min_font_size = max(body_font_size * 0.6, 5.0)
    chars = [c for c in raw_chars if c.get("size", 0) >= min_font_size]
    if not chars:
        return {
            "pageNumber": page.page_number,
            "text": "",
            "hasTextLayer": True,
            "charCount": len([c for c in raw_chars if c["text"].strip()]),
        }

    page_width = page.width
    size_tol = min(body_font_size * 0.10, 0.8)

    # Per-page body left boundary for line-number detection
    body_alpha = [
        c for c in chars
        if c["text"].strip().isalpha()
        and abs(c.get("size", 0) - body_font_size) <= size_tol
    ]
    body_left = min(c["x0"] for c in body_alpha) if body_alpha else 0.0

    rows = _group_chars_by_row(chars)

    body_lines: list[str] = []
    marginal_notes: list[str] = []
    running_headers: list[str] = []
    page_footers: list[str] = []
    is_first_content_row = True

    for top in sorted(rows.keys()):
        row_chars = sorted(rows[top], key=lambda c: c["x0"])

        if _is_line_number_row(row_chars, body_left):
            continue

        # Filter out watermark characters (Courier-Bold at far right)
        filtered = [
            c for c in row_chars
            if not (c["x0"] > page_width - 60 and c.get("fontname") == "Courier-Bold")
        ]
        if not filtered:
            continue

        # Identify body-font-sized chars for row-level classification
        body_sized = [
            c for c in filtered
            if abs(c.get("size", 0) - body_font_size) <= size_tol
        ]

        if body_sized:
            body_x0 = min(c["x0"] for c in body_sized)
            body_x1 = max(c["x0"] + c.get("width", 0) for c in body_sized)

            # Filter stray line-number digits left of body extent
            content = [
                c for c in filtered
                if not (c["x0"] < body_x0 - 10 and c["text"].strip().isdigit())
            ]

            row_body: list[dict] = []
            row_marginal: list[dict] = []
            for c in content:
                if body_x0 - 5 <= c["x0"] <= body_x1 + 5:
                    row_body.append(c)
                else:
                    row_marginal.append(c)

            if row_marginal:
                note = _build_line_with_gaps(row_marginal).strip()
                if note:
                    marginal_notes.append(note)

            if row_body:
                line = _build_line_with_gaps(row_body).rstrip()
                if line.strip():
                    if is_first_content_row and RUNNING_HEADER_RE.search(line):
                        is_first_content_row = False
                        running_headers.append(line.strip())
                        continue
                    is_first_content_row = False

                    if PAGE_FOOTER_RE.match(line):
                        page_footers.append(line.strip())
                        continue
                    if VERDATE_RE.search(line) or GPO_SYSTEM_RE.search(line):
                        page_footers.append(line.strip())
                        continue

                    body_lines.append(line)
        else:
            # No body-font chars — treat all as body (no stray digit filter)
            line = _build_line_with_gaps(filtered).rstrip()
            if line.strip():
                if is_first_content_row and RUNNING_HEADER_RE.search(line):
                    is_first_content_row = False
                    running_headers.append(line.strip())
                    continue
                is_first_content_row = False

                if PAGE_FOOTER_RE.match(line):
                    page_footers.append(line.strip())
                    continue
                if VERDATE_RE.search(line) or GPO_SYSTEM_RE.search(line):
                    page_footers.append(line.strip())
                    continue

                body_lines.append(line)

    # Detect back matter — only near end of page (not approval stamps at top)
    back_matter: list[str] = []
    for i, line in enumerate(body_lines):
        if BACK_MATTER_RE.search(line):
            remaining = len(body_lines) - i - 1
            if remaining < 15:
                back_matter = body_lines[i:]
                body_lines = body_lines[:i]
                break

    text = "\n".join(body_lines)
    result: dict = {
        "pageNumber": page.page_number,
        "text": text,
        "hasTextLayer": True,
        "charCount": len([c for c in raw_chars if c["text"].strip()]),
    }
    if marginal_notes:
        result["marginalNotes"] = marginal_notes
    if running_headers:
        result["runningHeaders"] = running_headers
    if page_footers:
        result["pageFooters"] = page_footers
    if back_matter:
        result["backMatter"] = "\n".join(back_matter)
    return result


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

    # Detect body font size globally across all pages
    all_chars: list[dict] = []
    for page in pdf.pages:
        all_chars.extend(page.chars)
    body_font_size = _detect_body_font_size(all_chars)

    all_fonts: set[str] = set()
    pages_result = []
    has_any_text = False

    try:
        for page in pdf.pages:
            page_data = _extract_page(page, body_font_size)
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
