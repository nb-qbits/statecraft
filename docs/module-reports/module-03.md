MODULE 3 COMPLETE — Deterministic Candidate Scan

Gate results

  Positive and negative pattern fixtures pass: PASS
    15 scan rules in declarative registry, each with ruleId, kind, pattern, isSuppression:
    ```
    // src/modules/scanning/rules.ts:4-108
    export const SCAN_RULES: readonly ScanRule[] = [
      {
        ruleId: "suppress.history_line",
        kind: CandidateKind.date,
        pattern: /^\d{4},\s+c\.\s+\d+(?:;\s*\d{4},\s+c\.\s+\d+)*\.?\s*$/,
        isSuppression: true,
      },
      ...
      {
        ruleId: "enactment.amendment_instruction",
        kind: CandidateKind.enactment_clause,
        pattern:
          /\bis\s+amended\s*(?:(?:and\s+reenacted\s+)?as\s+follows|by\s+(?:striking|inserting|adding)|--)/gi,
        isSuppression: false,
      },
    ];
    ```
    Scanner applies all rules via matchAll on normalizedText:
    ```
    // src/modules/scanning/scanner.ts:47-68
    for (const rule of SCAN_RULES) {
      if (rule.isSuppression) continue;
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(normalizedText)) !== null) {
        const matchStart = match.index;
        const matchEnd = match.index + match[0].length;
        candidates.push({
          candidateId: computeCandidateId(segmentId, rule.ruleId, matchStart, matchEnd),
          segmentId,
          kind: rule.kind,
          ruleId: rule.ruleId,
          matchedText: match[0],
          matchStart,
          matchEnd,
          suppressed: isFullySuppressed,
        });
      }
    }
    ```
    Unit: scanner.test.ts — 40 tests covering every rule, positive and negative
    Integration: gate3.test.ts — simple-bill.txt (dates, durations, modals, citations, temporal connectors), adversarial-text.txt (suppression, citation-not-date), hb346-extracted.txt (working-day durations, amendments), hr3481-extracted.txt (federal dates, amendment instructions, enactment clause)

  History lines structurally suppressed: PASS
    Full-segment suppression — when the entire normalizedText matches the history-line pattern, all candidates in that segment are marked suppressed:
    ```
    // src/modules/scanning/scanner.ts:41-43
    const suppressionRule = SCAN_RULES.find(r => r.isSuppression);
    const isFullySuppressed =
      suppressionRule !== undefined && suppressionRule.pattern.test(normalizedText);
    ```
    History-line pattern anchored to full segment with ^ and $:
    ```
    // src/modules/scanning/rules.ts:8
    pattern: /^\d{4},\s+c\.\s+\d+(?:;\s*\d{4},\s+c\.\s+\d+)*\.?\s*$/,
    ```
    Design note: The history-line text ("1997, c. 795; 2019, c. 401.") does not match any detection rule (detection rules require month names or slash-separated dates), so the suppression mechanism prevents false positives by construction. When the history line is a standalone segment, it gets `screened_no_candidate`. When embedded in a larger segment, no false-positive dates are generated because the detection patterns don't match the "YYYY, c. NNN" format.
    Unit: scanner.test.ts "suppresses all candidates in a full history-line segment", "suppresses multi-entry history lines", "does not suppress non-history segments"
    Integration: gate3.test.ts "adversarial-text.txt: history lines suppressed" — verifies no date candidate contains "1997" and the history segment gets screened_no_candidate

  Dates inside citations not misidentified: PASS
    Citation pattern uses § prefix — unambiguous:
    ```
    // src/modules/scanning/rules.ts:90
    pattern: /§\s*[\d]+(?:[.\-:][\d\w()]+)*/g,
    ```
    Numeric date pattern uses slash separator only (not dash), avoiding collision with § citations like § 1-210:
    ```
    // src/modules/scanning/rules.ts:22
    pattern: /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
    ```
    Unit: scanner.test.ts "detects § section symbol citations", "does not match § 1-210 as a date"
    Integration: gate3.test.ts "§ 1-210 is citation not date" — adversarial fixture

  Dates in enactment clauses detected correctly: PASS
    API output on HR 3481 SEC. 4:
    ```json
    {
      "segmentId": "seg_c78666842a3b02c32b180dd21a606cb2",
      "coverageState": "candidates_found",
      "candidates": [
        {
          "kind": "date",
          "ruleId": "date.explicit_month_day_year",
          "matchedText": "November 30, 2031"
        },
        {
          "kind": "date",
          "ruleId": "date.explicit_month_day_year",
          "matchedText": "January 31, 2033"
        },
        {
          "kind": "enactment_clause",
          "ruleId": "enactment.amendment_instruction",
          "matchedText": "is amended by striking"
        }
      ]
    }
    ```

  Every segment has a coverage state: PASS
    deriveCoverageState returns exactly one of two CoverageState values:
    ```
    // src/modules/scanning/scanner.ts:20-27
    export function deriveCoverageState(
      candidates: readonly CandidateMatch[],
    ): CoverageState {
      const hasNonSuppressed = candidates.some(c => !c.suppressed);
      return hasNonSuppressed
        ? CoverageState.candidates_found
        : CoverageState.screened_no_candidate;
    }
    ```
    CoverageState type has exactly two values:
    ```
    // src/modules/shared/types.ts:33-38
    export const CoverageState = {
      candidates_found: "candidates_found",
      screened_no_candidate: "screened_no_candidate",
    } as const;
    export type CoverageState =
      (typeof CoverageState)[keyof typeof CoverageState];
    ```
    Unit: scanner.test.ts "returns candidates_found when non-suppressed candidates exist", "returns screened_no_candidate when all candidates suppressed", "returns screened_no_candidate when no candidates", "only returns CoverageState values"
    Integration: gate3.test.ts "INV-7 exhaustiveness: parse segment count == scan segment count, all have coverage state" — verifies every segment from parsing has exactly one of the two coverage states after scanning

  No code path produces a certification of absence (INV-7): PASS
    grep -rn "certified\|no_obligation\|absence\|certain.*no.*exist" src/modules/scanning/ → no results
    The only negative state is `screened_no_candidate`:
    ```
    // src/modules/shared/types.ts:35
    screened_no_candidate: "screened_no_candidate",
    ```
    ScanStatus has no `scan_failed` variant — deterministic regex cannot fail on data:
    ```
    // src/modules/shared/types.ts:91-95
    export const ScanStatus = {
      unscanned: "unscanned",
      scanned: "scanned",
    } as const;
    ```

  Matching rule ID and matched span stored per candidate: PASS
    CandidateMatch carries ruleId, matchedText, matchStart, matchEnd:
    ```
    // src/modules/scanning/types.ts:21-30
    export interface CandidateMatch {
      readonly candidateId: CandidateId;
      readonly segmentId: SegmentId;
      readonly kind: CandidateKind;
      readonly ruleId: string;
      readonly matchedText: string;
      readonly matchStart: number;
      readonly matchEnd: number;
      readonly suppressed: boolean;
    }
    ```
    Persisted to scan_candidates table:
    ```
    // src/platform/db/scanning-schema.ts:17-31
    candidateId: varchar("candidate_id", { length: 128 }).primaryKey(),
    segmentId: varchar("segment_id", { length: 128 }).notNull(),
    ...
    kind: varchar("kind", { length: 64 }).notNull(),
    ruleId: varchar("rule_id", { length: 128 }).notNull(),
    matchedText: text("matched_text").notNull(),
    matchStart: integer("match_start").notNull(),
    matchEnd: integer("match_end").notNull(),
    suppressed: boolean("suppressed").notNull().default(false),
    scannerVersion: varchar("scanner_version", { length: 64 }).notNull(),
    ```

  Idempotency and version tracking: PASS
    Same scanner version → returns existing results:
    ```
    // src/modules/scanning/service.ts:49-83
    if (version.scanStatus === "scanned" && version.scannerVersion === SCANNER_VERSION) {
      const existingCandidates = await scanningRepository.getCandidatesByVersion(documentVersionId);
      ...
      return { ... };
    }
    ```
    Different scanner version → deletes old candidates, re-scans:
    ```
    // src/modules/scanning/service.ts:85-91
    if (version.scanStatus === "scanned" && version.scannerVersion !== SCANNER_VERSION) {
      ...
      await scanningRepository.deleteCandidatesByVersion(documentVersionId);
    }
    ```
    Unit: service.test.ts "is idempotent: returns existing when already scanned with same version", "re-scans when scanner version changes"
    Integration: gate3.test.ts "idempotency: scan twice → same candidate IDs"

  Deterministic candidate IDs: PASS
    SHA-256 hash of (segmentId, ruleId, matchStart, matchEnd):
    ```
    // src/modules/scanning/scanner.ts:9-18
    export function computeCandidateId(
      segmentId: SegmentId,
      ruleId: string,
      matchStart: number,
      matchEnd: number,
    ): CandidateId {
      const input = `${segmentId}|${ruleId}|${matchStart}|${matchEnd}`;
      const hash = createHash("sha256").update(input).digest("hex").slice(0, 32);
      return `cand_${hash}` as CandidateId;
    }
    ```
    Unit: scanner.test.ts "produces deterministic IDs", "different inputs produce different IDs"

API verification — actual output

  VA HB 346 (hb346-extracted.txt — FOIA exclusions bill, § 2.2-3705.1):
    Text fixture rebuilt from PDF via sidecar. Previous fixture was a different bill (§ 2.2-3704).
    Kinds found: date (January 14, 2026; January 12, 2026), modal_verb (shall, may), citation (§ 2.2-3705.1, § 2.2-3704.01, § 2.2-3711, etc.), enactment_clause (Be it enacted by the General Assembly; is amended and reenacted as follows)
    No durations — this is a FOIA exclusions bill with no reporting deadlines.
    All segments have coverage state: candidates_found + screened_no_candidate = total segments.

  Federal HR 3481 (hr3481-extracted.txt):
    20 segments, 10 candidates, 0 suppressed
    Kinds found: date (November 30, 2031; January 31, 2033), modal_verb (shall ×3, may ×2), enactment_clause (Be it enacted by the Senate and House of Representatives; is amended by adding; is amended by striking; is amended--)
    12 segments screened_no_candidate, 8 segments candidates_found
    Coarser federal segmentation handled correctly — multiple candidates per segment where needed

Verification results

  Typecheck: PASS (tsc --noEmit)
  Lint: PASS (eslint src/)
  Unit tests: 319 passed, 0 failed (24 test files)
  Scanning module coverage: 100% statements, 100% branches, 100% functions, 100% lines
  Integration tests: 41 passed, 0 failed (gate1 19, gate2 15, gate3 7)
  Docker build: PASS
  Migration 0006: PASS

Library decision

  Searched: LexNLP (AGPL — licence blocker), chrono (too permissive — parses § 1-210 as date), compromise (NLP toolkit, overkill), natural (NLP toolkit, overkill).
  Decision: Build. Domain-specific patterns are narrow (15 regexes). Custom scanner provides rule-ID traceability per match. No new Node.js dependencies added.

New files

  src/modules/scanning/types.ts — scanning domain types (CandidateKind, ScanRule, CandidateMatch, SegmentScanResult, DocumentScanResult)
  src/modules/scanning/rules.ts — 15 scan rules (1 suppression, 14 detection)
  src/modules/scanning/scanner.ts — pure scanner function, candidateId computation, coverageState derivation
  src/modules/scanning/scanner.test.ts — 40 unit tests
  src/modules/scanning/service.ts — scanning service (idempotency, version tracking, persistence)
  src/modules/scanning/service.test.ts — 8 unit tests
  src/platform/db/scanning-schema.ts — Drizzle schema for scan_candidates table
  src/platform/db/scanning-repository.ts — repository interface and Drizzle implementation
  src/platform/db/migrations/0006_scanning_candidates.sql — migration
  src/platform/server/routes/scan.ts — POST /api/v1/documents/:documentVersionId/scan
  test/integration/gate3.test.ts — 7 integration tests
  fixtures/documents/hr3481-extracted.txt — real federal bill text (H.R. 3481, 119th Congress)

Modified files

  src/modules/shared/types.ts — added CandidateId branded type, ScanStatus const object
  src/modules/ingestion/types.ts — added scanStatus, scannerVersion to DocumentVersion interface
  src/modules/ingestion/service.ts — added scanStatus/scannerVersion to insertVersion call
  src/platform/db/ingestion-schema.ts — added scan_status, scanner_version columns and CHECK constraint
  src/platform/db/ingestion-repository.ts — added ScanStatus mapping in rowToDocumentVersion
  src/platform/db/schema.ts — re-exported scanCandidates
  src/platform/db/migrations/meta/_journal.json — registered migration 0006
  src/main.ts — wired scanning repository, service, and routes
  src/modules/parsing/service.test.ts — added scanStatus/scannerVersion to makeVersion helper
  src/modules/scanning/scanner.test.ts — fixed type casts for deriveCoverageState partial objects
  src/platform/parsers/plain-text-parser.test.ts — line-number and lettered-subsection tests now use va-foia-records-request.txt
  fixtures/documents/hb346-extracted.txt — rebuilt from PDF via sidecar (was previously a different bill)

Renamed files

  fixtures/documents/hb346-extracted.txt (old) → fixtures/documents/va-foia-records-request.txt
    The old fixture was § 2.2-3704 (FOIA records requests, Patron Coyner), not the actual HB 346.
    The PDF fixture (hb346.pdf) is § 2.2-3705.1 (FOIA exclusions, Patron McLaughlin).
    The new hb346-extracted.txt is rebuilt from the PDF via sidecar to match.

New dependencies: none
