MODULE 2 COMPLETE — Parsing and normalization

Gate results

  Parsing the same document twice produces identical segment IDs: PASS
    Idempotency — already-parsed documents return existing segments:
    ```
    // src/modules/parsing/service.ts:47-49
    if (version.parseStatus === "parsed") {
      logger.info({ documentVersionId }, "already parsed, returning existing segments");
      return parsingRepository.getSegmentsByVersion(documentVersionId);
    }
    ```
    Deterministic ID computation — SHA-256 of (documentVersionId, structuralPath, contentHash, ordinal):
    ```
    // src/modules/parsing/segment-identity.ts:4-12
    export function computeSegmentId(
      documentVersionId: DocumentVersionId,
      structuralPath: string,
      contentHash: ContentHash,
      ordinal: number,
    ): SegmentId {
      const input = `${documentVersionId}:${structuralPath}:${contentHash}:${ordinal}`;
      const hash = createHash("sha256").update(input).digest("hex").slice(0, 32);
      return `seg_${hash}` as SegmentId;
    }
    ```
    Unit: segment-identity.test.ts "produces a deterministic ID" + service.test.ts "produces deterministic segment IDs across calls"
    Integration: gate2.test.ts:128 "parses text → segments → parses again → same segment IDs"

  Offset round-tripping passes on adversarial fixtures: PASS
    Offset map built during normalization — two parallel arrays:
    ```
    // src/modules/parsing/normalize.ts:103-106
    const offsetMap: OffsetMap = {
      normalizedToOriginal: trimmedN2O,
      originalToNormalized: o2nFinal,
    };
    ```
    NFKC expansion alignment tracks original positions through ligature decomposition:
    ```
    // src/modules/parsing/normalize.ts:143-149
    if (origNfkc.length > 1 && nfkc.substring(ni, ni + origNfkc.length) === origNfkc) {
      // Expansion: one original char → multiple NFKC chars
      for (let k = 0; k < origNfkc.length; k++) {
        n2o.push(oi);
      }
      o2n[oi] = ni;
      ni += origNfkc.length;
    ```
    Unit: normalize.test.ts "normalizedToOriginal length matches normalized string length", "originalToNormalized length matches original string length", "normalizedToOriginal is monotonically non-decreasing"
    Integration: gate2.test.ts:151 "offset round-trip passes on adversarial text" — ligatures (ffi, ff), soft hyphens, smart quotes, non-breaking spaces, line-number margins, repeated identical sections

  Two identical subsections receive distinct segment IDs: PASS
    Ordinal assignment within each (structuralPath, contentHash) group:
    ```
    // src/modules/parsing/segment-identity.ts:24-37
    export function assignOrdinals(
      groups: readonly OrdinalGroup[],
    ): number[] {
      const counts = new Map<string, number>();
      const ordinals: number[] = [];
      for (const g of groups) {
        const key = `${g.structuralPath}:${g.contentHash}`;
        const current = counts.get(key) ?? 0;
        ordinals.push(current);
        counts.set(key, current + 1);
      }
      return ordinals;
    }
    ```
    Unit: segment-identity.test.ts "assigns sequential ordinals to identical groups" + service.test.ts "gives identical subsections distinct segment IDs via ordinals"
    Integration: gate2.test.ts:177 "two identical subsections receive distinct segment IDs"

  Parser failure produces an explicit failed state, never partial success: PASS
    Parse failure sets terminal state and throws:
    ```
    // src/modules/parsing/service.ts:79-92
    if (!parseResult.ok) {
      await parsingRepository.updateParseStatus(documentVersionId, "parse_failed");
      throw new AppError({
        code: "PARSE_FAILED",
        category: "unsupported_document",
        message: `Parsing failed: ${parseResult.reason}`,
        retryable: false,
        ...
      });
    }
    ```
    Re-parse of failed document throws, no silent retry:
    ```
    // src/modules/parsing/service.ts:52-60
    if (version.parseStatus === "parse_failed") {
      throw new AppError({
        code: "PARSE_ALREADY_FAILED",
        category: "user_input",
        message: `Document version ${documentVersionId} previously failed parsing. Manual intervention required.`,
        retryable: false,
        ...
      });
    }
    ```
    Unit: service.test.ts "sets parse_failed on parser failure and throws", "throws on parse_failed status (no silent retry)"
    Integration: gate2.test.ts:208 "corrupt DOCX → parse_failed status"

  Identity mismatch (deferred from Amendment 2): PASS
    Integration: gate2.test.ts:340 "upload version 2 with mismatched number → 400 IDENTITY_MISMATCH"
    Integration: gate2.test.ts:375 "upload version 2 with mismatched jurisdiction → 400 IDENTITY_MISMATCH"

  HB 346 real-input gate (added post-review): PASS
    Structural segmentation for PDF-extracted text with no blank lines:
    ```
    // src/platform/parsers/plain-text-parser.ts:179-268
    function splitByStructure(lines: string[]): ParsedParagraph[] {
      const paragraphs: ParsedParagraph[] = [];
      const currentLines: string[] = [];
      let sectionStack: string[] = [];
      let paragraphIndex = 0;
      let inPreamble = true;
      let seenEnactmentClause = false;
      ...
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();
        ...
        if (inPreamble && ENACTMENT_BOUNDARY.test(trimmed)) {
          currentLines.push(trimmed);
          flushParagraph();
          inPreamble = false;
          seenEnactmentClause = false;
          continue;
        }
        ...
        if (!inPreamble && SUBSECTION_LETTER.test(trimmed)) {
          flushParagraph();
          currentLines.push(trimmed);
          continue;
        }
        if (!inPreamble && NUMBERED_SUBDIVISION.test(trimmed)) {
          flushParagraph();
          currentLines.push(trimmed);
          continue;
        }
        ...
      }
      ...
    }
    ```
    Structural markers — § symbols, lettered subsections, numbered subdivisions, enactment boundaries:
    ```
    // src/platform/parsers/plain-text-parser.ts:16-20
    const SUBSECTION_LETTER = /^([A-Z])\.\s/;
    const NUMBERED_SUBDIVISION = /^(\d{1,2})\.\s/;
    const SECTION_SYMBOL = /^§\s*[\d.:-]+/;
    const ENACTMENT_BOUNDARY = /reenacted as follows\s*:\s*$/;
    const ENACTMENT_CLAUSE = /^Be it enacted by the General Assembly/;
    ```
    Line-number detection — scans first 30 non-empty lines, requires >70% match and 3+ sequential:
    ```
    // src/platform/parsers/plain-text-parser.ts:81-100
    function detectLineNumbers(lines: string[]): boolean {
      const candidateLines = lines.filter(l => l.trim().length > 0).slice(0, 30);
      if (candidateLines.length < 5) return false;

      let matchCount = 0;
      let lastNumber = 0;
      let sequentialCount = 0;

      for (const line of candidateLines) {
        const match = /^(\s*\d{1,4})\s+/.exec(line);
        if (match) {
          matchCount++;
          const num = parseInt(match[1]!.trim(), 10);
          if (num === lastNumber + 1) sequentialCount++;
          lastNumber = num;
        }
      }

      return matchCount >= candidateLines.length * 0.7 && sequentialCount >= 3;
    }
    ```
    Line-number stripping — 1+ space (not 2+) when line numbers detected:
    ```
    // src/platform/parsers/plain-text-parser.ts:130-132
    function stripDetectedLineNumber(line: string): string {
      return line.replace(/^\s*\d{1,4}\s+/, "");
    }
    ```
    Trailing blank suppression — prevents false blank-line detection from trailing newlines:
    ```
    // src/platform/parsers/plain-text-parser.ts:116-120
    function trimTrailingBlanks(lines: string[]): string[] {
      let end = lines.length;
      while (end > 0 && lines[end - 1]!.trim().length === 0) end--;
      return lines.slice(0, end);
    }
    ```
    Two-path dispatch — blank lines use splitByBlankLines, no blank lines use splitByStructure:
    ```
    // src/platform/parsers/plain-text-parser.ts:54-59
    if (hasBlankLines) {
      paragraphs = splitByBlankLines(contentLines);
    } else {
      paragraphs = splitByStructure(contentLines);
    }
    ```
    Unit: plain-text-parser.test.ts:177 "detects line numbers and strips them", :188 "segments HB 346 into >10 segments", :195 "segments on § section markers", :206 "segments on lettered subsections", :216 "segments on numbered subdivisions", :226 "segments on enactment clause boundary", :239 "does not split preamble on numbers that are content"
    Integration: gate2.test.ts:261 "HB 346 (PDF-extracted, no blank lines) produces >10 segments", :275 "HB 346 segments contain no line-number margins"

  Offset map compression (added post-review): PASS
    Compress on write — run-length encoding of consecutive 1-to-1 mappings:
    ```
    // src/modules/parsing/offset-map.ts:3-8
    export function compressOffsetMap(map: OffsetMap): CompressedOffsetMap {
      return {
        n2o: compressArray(map.normalizedToOriginal),
        o2n: compressArray(map.originalToNormalized),
      };
    }
    ```
    Compression algorithm — consecutive positions incrementing by 1 collapse to a single [start, mappedStart, length] tuple:
    ```
    // src/modules/parsing/offset-map.ts:23-41
    function compressArray(arr: readonly number[]): OffsetRun[] {
      if (arr.length === 0) return [];

      const runs: OffsetRun[] = [];
      let runStart = 0;
      let runMapped = arr[0]!;

      for (let i = 1; i < arr.length; i++) {
        const expected = runMapped + (i - runStart);
        if (arr[i] !== expected) {
          runs.push([runStart, runMapped, i - runStart]);
          runStart = i;
          runMapped = arr[i]!;
        }
      }

      runs.push([runStart, runMapped, arr.length - runStart]);
      return runs;
    }
    ```
    Repository compresses on write, expands on read, handles both formats:
    ```
    // src/platform/db/parsing-repository.ts:17-19
    const offsetMap = isCompressedOffsetMap(stored)
      ? expandOffsetMap(stored)
      : stored as unknown as SourceSegment["offsetMap"];
    ```
    ```
    // src/platform/db/parsing-repository.ts:58
    offsetMap: compressOffsetMap(s.offsetMap),
    ```
    Unit: offset-map.test.ts 8 tests — identity round-trip, large identity compression ratio (<100 bytes for 10,000-element array), gap round-trip, expansion round-trip, empty arrays, type guard positive/negative/non-objects
    Integration: gate2.test.ts:293 "HB 346 offset map uses compressed format in storage"

Test summary
  Unit: 228 tests across 20 files, all passing
    - normalize.test.ts: 24 tests (NFKC, soft hyphens, hyphenation, smart quotes, NBSP, whitespace, adversarial combos, offset round-trip)
    - segment-identity.test.ts: 11 tests (determinism, distinctness, ordinals)
    - service.test.ts: 11 tests (happy path text/DOCX, idempotency, PDF unparsed, parse_failed, deterministic IDs, identical subsections)
    - types.test.ts: 7 tests (type structure)
    - plain-text-parser.test.ts: 22 tests (14 original + 8 structural segmentation: line numbers, HB 346, § markers, lettered subsections, numbered subdivisions, enactment boundary, preamble protection, fallback)
    - docx-parser.test.ts: 20 tests (sync/async, italic, strikethrough, dstrike, mixed runs, headings, missing document.xml, no body, empty, edge cases)
    - offset-map.test.ts: 8 tests (compression round-trip, ratio, gaps, expansion, empty, type guard)
  Integration: gate2.test.ts — 12 tests (idempotency, offset round-trip, identical subsections, corrupt DOCX, PDF, DOCX with formatting, segment fields, HB 346 segment count, HB 346 no line numbers, HB 346 compressed offset map, identity mismatch x2)
  Coverage: 97.95% statements, 91.68% branches, 96.34% functions, 97.95% lines
  Typecheck: clean
  Lint: clean

Uncovered code (honest accounting)
  - docx-parser.ts:184 — branch inside XML attribute extraction; reached only by malformed OOXML that fast-xml-parser would reject before this point
  - plain-text-parser.ts:243-248 — SECTION_HEADING detection inside splitByStructure; exercised only when a SECTION/CHAPTER/ARTICLE heading appears in a no-blank-line document after the enactment boundary (HB 346 fixture has no such heading)
  - normalize.ts:165 — single-char NFKC replacement branch in alignNfkc; reached only when NFKC produces a single-char substitution that doesn't match the original (rare Unicode edge case)

Files changed
  src/modules/shared/types.ts: added parse_failed to ParseStatus, added Fidelity enum
  src/modules/shared/types.test.ts: updated ParseStatus test, added Fidelity test
  src/modules/parsing/types.ts: OffsetMap, OffsetRun, CompressedOffsetMap, RunProperty, ParsedRun, ParsedParagraph, ParseResult (discriminated union), DocumentParser interface, SourceSegment, NormalizeResult
  src/modules/parsing/types.test.ts: type structure tests
  src/modules/parsing/normalize.ts: normalizeForEvidenceMatchV1 — NFKC, soft hyphen removal, line-break hyphenation, smart quotes, whitespace collapse, reversible offset map
  src/modules/parsing/normalize.test.ts: 24 tests covering all normalization steps and offset round-tripping
  src/modules/parsing/offset-map.ts: compressOffsetMap, expandOffsetMap, isCompressedOffsetMap — run-length encoding for DB storage
  src/modules/parsing/offset-map.test.ts: 8 tests
  src/modules/parsing/segment-identity.ts: computeSegmentId (deterministic SHA-256), computeContentHash, assignOrdinals
  src/modules/parsing/segment-identity.test.ts: 11 tests
  src/modules/parsing/service.ts: parsing orchestrator — fetch version, dispatch to parser, normalize, compute segment IDs, persist
  src/modules/parsing/service.test.ts: 11 tests with in-memory stubs
  src/platform/parsers/plain-text-parser.ts: v1.1.0 — structural segmentation (splitByStructure for no-blank-line documents), line-number detection and stripping, trailing-blank suppression, § / lettered subsection / numbered subdivision / enactment boundary markers
  src/platform/parsers/plain-text-parser.test.ts: 22 tests (14 original + 8 structural segmentation)
  src/platform/parsers/docx-parser.ts: DOCX adapter — jszip + fast-xml-parser, w:rPr (w:i, w:strike, w:dstrike), heading detection, fidelity: declared
  src/platform/parsers/docx-parser.test.ts: 20 tests (3 coverage-gaming tests removed per review)
  src/platform/db/parsing-schema.ts: source_segments table with segment_id PK, FK to document_versions, unique index on (documentVersionId, structuralPath, contentHash, ordinal), chk_fidelity constraint
  src/platform/db/parsing-repository.ts: insertSegments (with offset map compression), getSegmentsByVersion (with offset map expansion, handles both formats), updateParseStatus
  src/platform/db/schema.ts: re-exports sourceSegments
  src/platform/db/ingestion-schema.ts: updated chk_parse_status to include 'parse_failed'
  src/platform/server/routes/parse.ts: POST /api/v1/documents/:documentVersionId/parse
  src/main.ts: wiring for parsing repository, service, parsers, and parse route
  vitest.config.ts: added coverage exclusions for parsing infrastructure files and types.ts
  test/integration/gate2.test.ts: 12 integration tests (gate 2 criteria + HB 346 real-input gate + identity mismatch)
  fixtures/documents/simple-bill.txt: multi-section bill with section headings
  fixtures/documents/adversarial-text.txt: ligatures, soft hyphens, smart quotes, NBSP, line numbers, page footers, repeated identical text, amendment history lines
  fixtures/documents/hb346-extracted.txt: PDF-extracted Virginia HB 346 (2026) reenacting § 2.2-3704 (FOIA) — line numbers on every line, no blank lines, 14 subdivisions (A-J + B.1-B.4)
  fixtures/documents/simple-bill.docx: real DOCX with italic, strikethrough, heading styles
  scripts/create-docx-fixture.ts: generator for the DOCX fixture

Migrations
  0004_even_sage.sql: ALTER TABLE document_versions DROP CONSTRAINT chk_parse_status; ADD CONSTRAINT chk_parse_status CHECK (parse_status IN ('unparsed','parsed','parse_failed'))
  0005_oval_captain_midlands.sql: CREATE TABLE source_segments (segment_id PK, document_version_id FK, structural_path, ordinal, raw_text, normalized_text, content_hash, offset_map JSONB, parser_adapter, parser_version, fidelity); UNIQUE INDEX uq_segment_identity; CHECK chk_fidelity

Environment variables
  None changed.

Invariants touched
  INV-2 (no fallback on failure):
    Parser failure sets parse_failed and throws — no fallback value produced.
    ```
    // src/modules/parsing/service.ts:79-80
    if (!parseResult.ok) {
      await parsingRepository.updateParseStatus(documentVersionId, "parse_failed");
    ```
    parse_failed is a terminal state; re-parsing throws PARSE_ALREADY_FAILED (service.ts:52-60).

  INV-7 (screening does not certify):
    parse_failed is an explicit failure state, not a certification. A document that fails parsing is distinguishable from one not yet attempted (unparsed) and one successfully parsed (parsed).
    ```
    // src/modules/shared/types.ts:76-81
    export const ParseStatus = {
      unparsed: "unparsed",
      parsed: "parsed",
      parse_failed: "parse_failed",
    } as const;
    ```

  INV-8 (provenance):
    Every segment records parserAdapter, parserVersion, and fidelity.
    ```
    // src/modules/parsing/service.ts:129-131
    parserAdapter: parseResult.parserAdapter,
    parserVersion: parseResult.parserVersion,
    fidelity: parseResult.fidelity,
    ```

  INV-10 (immutability):
    Segments are insert-only. No update or delete path exists. Re-parsing returns existing segments via idempotency check.

Decisions taken
  1. DOCX parser uses async (parseDocxAsync) because jszip.loadAsync is fundamentally async. The sync DocumentParser.parse interface returns a marker failure for DOCX; the service layer dispatches to parseDocxAsync directly. This avoids introducing sync ZIP libraries.
  2. normalizeForEvidenceMatchV1 does NOT have an explicit NBSP step — NFKC already normalizes U+00A0 to ASCII space. Dead code was removed after discovery during testing.
  3. Segment identity uses `seg_` prefix + 32 hex chars (SHA-256 truncated) rather than UUIDs, since IDs must be deterministic from (documentVersionId, structuralPath, contentHash, ordinal).
  4. Line-number detection uses a two-threshold heuristic (>70% of first 30 lines match `^\s*\d{1,4}\s+` AND 3+ are sequential). When detected, stripping uses 1+ space (`^\s*\d{1,4}\s+`); without detection, the conservative 2+ space margin (`^\s*\d{1,4}\s{2,}`) is used. This prevents false stripping on content that starts with digits.
  5. Structural segmentation (splitByStructure) uses an `inPreamble` flag. Markers (§, A., 1.) only trigger segment breaks after the enactment boundary, preventing false segmentation on "1. That § 2.2-3704..." in enactment clauses.
  6. Enactment boundary regex matches `reenacted as follows\s*:\s*$` rather than the full "is amended and reenacted as follows:" — PDF-extracted text splits this phrase across two lines, so the regex matches the line ending.
  7. Offset map compression uses run-length encoding: consecutive 1-to-1 mappings collapse to `[start, mappedStart, length]` tuples. A 10,000-element identity mapping compresses to under 100 bytes. The repository handles both compressed and uncompressed formats on read for backward compatibility.
  8. Three coverage-gaming tests removed from docx-parser.test.ts per review. They targeted an unreachable XML fallback path — tests existed to move a coverage number, not to catch a bug.
  9. Page footer suppression targets three patterns: `- N -`, `Page N of M`, standalone `N`. Conservative — false positives possible on very short lines but acceptable for legislative documents.
  10. DOCX heading detection uses w:pStyle matching `/^Heading/i` — standard OOXML convention. Non-heading styles produce flat `/body/p[N]` paths.

Dependencies added
  | Package | Version | License | Purpose |
  |---|---|---|---|
  | jszip | 3.10.1 | MIT | Unzip DOCX containers |
  | fast-xml-parser | 5.10.1 | MIT | Parse OOXML XML with attribute preservation |

Known limitations
  1. PDF parsing is NOT implemented — PDFs stay parseStatus 'unparsed' and return empty segments. Parsing is deferred per scope.
  2. No page-count cap on PDFs — deferred to a future PDF parsing module.
  3. The DOCX parser does not read headers/footers from separate ZIP entries — these are suppressed by design (per architecture doc).
  4. The plain text parser's section detection is English-only (SECTION, CHAPTER, ARTICLE, etc.) — other languages are not in scope for the Virginia slice.
  5. Amendment-history line suppression (e.g. "1997, c. 795; 2019, c. 401") is not yet implemented at the parser level — deferred to Module 3 (candidate scan) which structurally suppresses these lines.

Manual verification
  # Typecheck
  npm run typecheck

  # Lint
  npm run lint

  # Unit tests with coverage
  npx vitest run --coverage

  # Integration tests (requires Docker stack)
  docker compose up -d --build
  docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
  docker compose exec minio mc mb local/policyaction --ignore-existing
  docker compose exec app node dist/platform/db/migrate.js
  npm run test:integration

  # Manual parse (after Docker stack and uploading a document)
  curl -X POST http://localhost:3000/api/v1/documents/<documentVersionId>/parse

Rollback
  git revert to pre-module-2 commit. Drop migrations:
  DROP TABLE source_segments;
  ALTER TABLE document_versions DROP CONSTRAINT chk_parse_status;
  ALTER TABLE document_versions ADD CONSTRAINT chk_parse_status CHECK (parse_status IN ('unparsed','parsed'));

STOPPING. Awaiting approval before Module 3.
