MODULE 4 COMPLETE — Model Gateway and Span Proposal

Library decision

  Searched: LangChain.js (MIT, orchestration framework), LiteLLM (MIT, proxy),
  ai (Vercel AI SDK, Apache-2.0), modelfusion (MIT).

  Build, not adopt. The gateway interface is trivially small (one method, two
  types). LangChain and Vercel AI are heavier than the problem requires and
  couple to specific provider APIs. The ModelGateway interface is 27 lines of
  TypeScript and carries no dependencies. FixtureModelGateway replays recorded
  responses for offline testing. No new runtime dependencies added.

Gate results

  All tests run offline against fixtures: PASS
    FixtureModelGateway replays canned responses via substring matching on
    userPrompt, falling back to the last fixture for unmatched segments:
    ```
    // src/modules/extraction/fixture-model-gateway.ts:14-33
    export function createFixtureModelGateway(
      fixtures: readonly FixtureEntry[],
    ): ModelGateway {
      return {
        async call(request: ModelRequest): Promise<ModelResponse> {
          for (const f of fixtures) {
            if (request.userPrompt.includes(f.segmentText)) {
              return makeResponse(request, f);
            }
          }
          const fallback = fixtures.at(-1);
          if (!fallback) {
            throw new Error(
              `FixtureModelGateway: no fixture found for prompt (length=${request.userPrompt.length})`,
            );
          }
          return makeResponse(request, fallback);
        },
      };
    }
    ```
    Unit: fixture-model-gateway.test.ts — 7 tests: substring matching, last-fixture fallback, no-fixture throw, token counts, correlationId, payload serialization
    Integration: gate4.test.ts — 6 tests: simple-bill with verbatim proposals, extract-before-scan error, idempotency, HB 35 duration spans, INV-3 adversarial boundary, schema validation

  INV-1 — Output schema has NO field for a date, normalized value, or computed anything: PASS
    SpanProposal has exactly 3 fields — segmentId, quotedText, kind:
    ```
    // src/modules/extraction/types.ts:12-16
    export interface SpanProposal {
      readonly segmentId: SegmentId;
      readonly quotedText: string;
      readonly kind: SpanProposalKind;
    }
    ```
    EXTRACTION_RESPONSE_SCHEMA uses additionalProperties: false on items:
    ```
    // src/modules/extraction/response-validator.ts:168-179
    items: {
        type: "object",
        properties: {
          segmentId: { type: "string" },
          quotedText: { type: "string" },
          kind: {
            type: "string",
            enum: Object.values(SpanProposalKind),
          },
        },
        required: ["segmentId", "quotedText", "kind"],
        additionalProperties: false,
      },
    ```
    15 forbidden fields rejected at validation:
    ```
    // src/modules/extraction/response-validator.ts:7-23
    const FORBIDDEN_FIELDS = new Set([
      "date",
      "normalizedDate",
      "computedDate",
      "resolvedDate",
      "value",
      "normalizedValue",
      "dateValue",
      "timestamp",
      "isoDate",
      "parsedDate",
      "effectiveDate",
      "deadline",
      "dueDate",
      "startDate",
      "endDate",
    ]);
    ```
    Unit: response-validator.test.ts — 21 tests including exhaustive check of all 15 forbidden fields (lines 143-166)
    Integration: gate4.test.ts line 296-300 asserts `Object.keys(proposal)` equals exactly `["segmentId", "quotedText", "kind"]`

  Fixture containing model-authored date field is rejected by schema: PASS
    ```
    // src/modules/extraction/response-validator.test.ts:61-77
    it("INV-1: drops proposal containing a date field", () => {
      const parsed = {
        proposals: [
          {
            segmentId: SEG_ID,
            quotedText: "July 1, 2025",
            kind: "obligation_deadline",
            date: "2025-07-01",
          },
        ],
      };
      const result = validateAndRepairResponse(parsed, SEG_ID);
      expect(result.valid).toBe(true);
      expect(result.proposals).toHaveLength(0);
      expect(result.droppedCount).toBe(1);
      expect(result.repaired).toBe(true);
    });
    ```

  Repair never adds a value — only nulls, drops, or truncates: PASS
    Null (replace mismatched segmentId with expected):
    ```
    // src/modules/extraction/response-validator.ts:119-126
    let finalSegmentId: SegmentId;
    if (typeof segmentId === "string" && segmentId === expectedSegmentId) {
      finalSegmentId = segmentId as SegmentId;
    } else {
      finalSegmentId = expectedSegmentId;
      nulledCount++;
      repaired = true;
    }
    ```
    Drop (forbidden fields, null items, empty quotedText, invalid kind):
    ```
    // src/modules/extraction/response-validator.ts:88-117
    if (raw === null || raw === undefined || typeof raw !== "object") {
      droppedCount++;
      repaired = true;
      continue;
    }
    ...
    if (hasForbiddenFields(item)) {
      droppedCount++;
      repaired = true;
      continue;
    }
    ```
    Truncate (quotedText > 500 chars):
    ```
    // src/modules/extraction/response-validator.ts:128-133
    let finalQuotedText = quotedText;
    if (finalQuotedText.length > 500) {
      finalQuotedText = finalQuotedText.slice(0, 500);
      truncatedCount++;
      repaired = true;
    }
    ```
    Adversarial test combining all repair types:
    ```
    // src/modules/extraction/response-validator.test.ts:234-263
    it("repair never adds a value — only nulls, drops, or truncates", () => {
      ...
      expect(result.proposals).toHaveLength(1);
      expect(result.droppedCount).toBe(2);
      expect(result.nulledCount).toBe(1);
      expect(result.truncatedCount).toBe(1);

      for (const p of result.proposals) {
        expect(Object.keys(p)).toEqual(["segmentId", "quotedText", "kind"]);
      }
    });
    ```

  Repaired responses flagged in provenance and counted in run metrics: PASS
    Each model call records repaired flag:
    ```
    // src/modules/extraction/service.ts:179
    repaired: validation.repaired,
    ```
    Repaired persisted to model_calls table:
    ```
    // src/platform/db/extraction-schema.ts:22
    repaired: boolean("repaired").notNull().default(false),
    ```
    Run metrics count total repaired:
    ```
    // src/modules/extraction/service.ts:218
    const totalRepaired = segmentResults.filter((s) => s.repaired).length;
    ```
    Unit: service.test.ts lines 279-303 (flags repaired), lines 306-361 (counts in run metrics)

  Prompt hash changes when prompt text changes: PASS
    Content-addressed hash from system + user template:
    ```
    // src/modules/extraction/prompt-registry.ts:11-15
    export function computePromptHash(systemPrompt: string, userTemplate: string): PromptHash {
      const input = `${systemPrompt}\n---\n${userTemplate}`;
      const hash = createHash("sha256").update(input).digest("hex");
      return `ph_${hash}` as PromptHash;
    }
    ```
    Unit: prompt-registry.test.ts lines 13-35 — deterministic, changes with system prompt, changes with user template

  INV-3 boundary — model-authored quote not in segment accepted (anchoring is Module 5): PASS
    Adversarial fixture returns "within five business days of such placement" for
    section E, whose text says "within one workday of such placement". Module 4
    accepts the fabricated quote — it validates schema, not anchoring. Anchoring
    is Module 5's responsibility.
    ```
    // test/integration/gate4.test.ts (INV-3 boundary test)
    it("INV-3 boundary: model-authored quote not in segment is accepted (anchoring is Module 5)", ...
      const medicalSeg = e.body.segments.find((seg) =>
        seg.proposals.some((p) => p.quotedText === "within five business days of such placement"),
      );
      expect(medicalSeg).toBeDefined();
      expect(medicalSeg!.proposals[0]!.quotedText).toBe(
        "within five business days of such placement",
      );
    ```
    This documents the boundary explicitly: Module 4 does not verify that
    quotedText appears in the source segment. That is INV-3 / Module 5.

  Gateway error handling — explicit failure state: PASS
    Per-segment error handling catches gateway failures:
    ```
    // src/modules/extraction/service.ts:132-149
    let response;
    try {
      response = await modelGateway.call({
        ...
      });
    } catch (err) {
      logger.error(
        { segmentId: seg.segmentId, err },
        "model gateway call failed",
      );
      gatewayErrors++;
      continue;
    }
    ```
    All-segments-failed produces extraction_failed status:
    ```
    // src/modules/extraction/service.ts:192-205
    if (gatewayErrors > 0 && segmentResults.length === 0 && processableSegments > 0) {
      await extractionRepository.updateExtractionStatus(
        documentVersionId,
        "extraction_failed",
        EXTRACTOR_VERSION,
      );
      throw new AppError({
        code: "EXTRACTION_FAILED",
        category: "provider_failure",
        message: `All ${gatewayErrors} model gateway calls failed`,
        retryable: true,
        context: { documentVersionId, gatewayErrors },
      });
    }
    ```

  Gate 2 regression fix — segment ordering determinism: PASS
    Root cause: `getSegmentsByVersion` sorted by `ordinal` only. All segments
    with unique structural paths get ordinal 0 (it is a within-group
    disambiguator, not a sequence counter). PostgreSQL returns rows in arbitrary
    order when the sort key is identical. The TXT parse returned
    `section[*]/p[1]` before `p[0]` while the PDF parse returned `p[0]` first.
    Fix: added `structuralPath` as secondary sort key.
    ```
    // src/platform/db/parsing-repository.ts:82
    .orderBy(sourceSegments.ordinal, sourceSegments.structuralPath);
    ```
    This is a Module 2 bug fixed in Module 4 scope because it surfaced as a
    regression. The underlying cause was always present — the old test happened
    to pass due to insertion order coinciding with query return order.

Test summary

  Unit tests: 370 total, all pass
    - extraction/response-validator.test.ts: 21 tests (INV-1, repair semantics)
    - extraction/prompt-registry.test.ts: 12 tests (hash, content-addressing)
    - extraction/fixture-model-gateway.test.ts: 7 tests (matching, fallback)
    - extraction/service.test.ts: 11 tests (flow, skipping, repair, idempotency)
    Total new: 51 tests

  Integration tests: 48 total, all pass
    - gate4.test.ts: 6 tests (simple-bill verbatim proposals, extract-before-scan,
      idempotency, HB 35 duration spans, INV-3 adversarial boundary, schema validation)
    - gate2.test.ts: 15 tests, all pass (including structural shape comparison, fixed)
    - gate3.test.ts: 8 tests, all pass
    - gate1.test.ts: 19 tests, all pass

  Typecheck: clean
  Lint: clean

Files changed

  src/modules/extraction/types.ts — SpanProposal, ModelCallRecord, result types
  src/modules/extraction/model-gateway.ts — ModelGateway interface (ModelRequest, ModelResponse)
  src/modules/extraction/fixture-model-gateway.ts — FixtureModelGateway with substring matching and last-fixture fallback
  src/modules/extraction/prompt-registry.ts — content-addressed prompt storage, SPAN_PROPOSAL_PROMPT
  src/modules/extraction/response-validator.ts — INV-1 enforcement, repair, EXTRACTION_RESPONSE_SCHEMA
  src/modules/extraction/service.ts — extraction orchestration, idempotency, version tracking, gateway error handling
  src/platform/db/extraction-schema.ts — model_calls table (Drizzle)
  src/platform/db/extraction-repository.ts — ExtractionRepository CRUD
  src/platform/db/parsing-repository.ts — added structuralPath secondary sort (gate2 regression fix)
  src/platform/server/routes/extract.ts — POST /api/v1/documents/:documentVersionId/extract
  src/platform/db/schema.ts — re-exports modelCalls
  src/platform/db/migrations/0007_model_calls.sql — model_calls table + extraction_status columns
  src/platform/db/migrations/meta/_journal.json — registered migration 0007
  src/modules/shared/types.ts — PromptHash, ModelCallId branded types, ExtractionStatus const
  src/modules/ingestion/types.ts — extractionStatus, extractorVersion on DocumentVersion
  src/modules/ingestion/service.ts — default extraction_status "unextracted"
  src/platform/db/ingestion-schema.ts — extractionStatus, extractorVersion columns + CHECK constraint
  src/platform/db/ingestion-repository.ts — maps extraction columns in rowToDocumentVersion
  src/platform/config/env.ts — MODEL_ID, MODEL_API_KEY, MODEL_BASE_URL (optional)
  src/main.ts — wires extraction repository, fixture gateway with real HB 35 fixtures, service, routes
  src/modules/extraction/response-validator.test.ts — 21 unit tests
  src/modules/extraction/prompt-registry.test.ts — 12 unit tests
  src/modules/extraction/fixture-model-gateway.test.ts — 7 unit tests
  src/modules/extraction/service.test.ts — 11 unit tests
  src/modules/parsing/service.test.ts — updated makeVersion helper
  src/modules/scanning/service.test.ts — updated makeVersion helper
  test/integration/gate4.test.ts — 6 integration tests

Migrations

  0007_model_calls.sql:
  - CREATE TABLE model_calls (model_call_id PK, document_version_id, segment_id, model_id, prompt_hash, request/response payloads, tokens, latency, correlation_id, repaired, created_at)
  - ALTER document_versions ADD extraction_status DEFAULT 'unextracted', extractor_version
  - CHECK constraint on extraction_status IN ('unextracted', 'extracted', 'extraction_failed')

Environment variables

  MODEL_ID (optional) — model identifier for gateway calls, defaults to "fixture"
  MODEL_API_KEY (optional) — API key for live model provider, not used in default fixture mode
  MODEL_BASE_URL (optional) — base URL for model provider, not used in default fixture mode

Invariants touched

  INV-1 — The model never emits a value.
    Enforced structurally: SpanProposal interface has exactly {segmentId, quotedText, kind}. EXTRACTION_RESPONSE_SCHEMA uses additionalProperties: false. FORBIDDEN_FIELDS set rejects 15 date/value field names. Tested: 21 unit tests in response-validator.test.ts, integration test verifies Object.keys equality.

  INV-3 — Anchoring proves existence, not support.
    Module 4 explicitly does NOT verify that quotedText appears in the source
    segment. This boundary is documented with an adversarial integration test
    that passes a fabricated quote through Module 4 successfully. Anchoring
    verification is Module 5's responsibility.

Decisions taken

  1. FixtureModelGateway uses substring matching (userPrompt.includes(segmentText))
     with last-fixture fallback. Specific fixtures are keyed to distinctive text
     from target segments; unmatched segments receive the empty-proposals fallback.

  2. Repair replaces mismatched segmentId with expected (null semantics) rather
     than dropping the entire proposal. Rationale: a model that quotes the right
     text but echoes the wrong segmentId is producing useful output; dropping it
     would discard correct work. The repair is flagged.

  3. The system prompt instructs "Do NOT return dates, computed values, or
     normalized forms" but does not rely solely on this instruction. The schema
     (additionalProperties: false) and validator (FORBIDDEN_FIELDS) enforce INV-1
     defensively.

  4. Segments with no non-suppressed candidates are skipped (not sent to the
     model). This avoids wasting gateway calls on segments the scanner already
     screened.

  5. Gateway errors are caught per-segment; if all processable segments fail,
     extraction_status is set to "extraction_failed" and an AppError is thrown.
     Partial success is marked "extracted" with partial results.

  6. Gate 2 segment ordering regression fixed by adding structuralPath as
     secondary sort key in getSegmentsByVersion. The ordinal column is a
     within-group disambiguator (always 0 for unique paths), not a sequence
     counter. Without a tiebreaker, PostgreSQL returned segments in arbitrary
     order.

Known limitations

  1. The server runs with FixtureModelGateway only. Real fixtures are provided
     for HB 35 duration segments and simple-bill, but most segments receive
     empty proposals from the default fallback. A live model adapter is needed
     for real extraction.

  2. All fixture-based proposals have `repaired: true` because the fixture
     segmentId ("seg_placeholder") never matches the actual segment ID. This is
     expected — the segmentId is generated dynamically from the document version,
     so static fixtures cannot predict it.

API verification — va-hb35-restorative-housing.pdf

  Upload: 201, documentVersionId assigned
  Parse:  200, 18 segments
  Scan:   200, 50 candidates, 0 suppressed
  Extract: 200

  Results:
    extractorVersion: "1.0.0"
    segmentCount (processed): 18
    segmentsSkipped: 0
    totalProposals: 6
    totalRepaired: 3

  Segments with proposals (3 of 18):

    Duration segment (section D — lockdown restrictions):
      "within 30 days" (kind: duration)
      "no longer than seven days" (kind: duration)
      Both appear verbatim in the segment text.

    Duration segment (section C.1 — placement review):
      "every two business days" (kind: duration)
      "within one working day" (kind: duration)
      "within 24 hours" (kind: duration)
      All three appear verbatim in the segment text.

    Adversarial segment (section E — medical evaluation):
      "within five business days of such placement" (kind: duration)
      Does NOT appear in the segment text (which says "within one workday").
      Module 4 accepts it — anchoring is Module 5's job (INV-3).

  15 segments with empty proposals (unmatched by any fixture).

  Raw model response — duration segment (within 30 days):
    {
      "segmentId": "seg_b670cb1098831ab08138e7110163c874",
      "modelCallId": "mcall_f19e0951838ff4ff40f9a08e09d91d0d",
      "repaired": true,
      "proposals": [
        {
          "segmentId": "seg_b670cb1098831ab08138e7110163c874",
          "quotedText": "within 30 days",
          "kind": "duration"
        },
        {
          "segmentId": "seg_b670cb1098831ab08138e7110163c874",
          "quotedText": "no longer than seven days",
          "kind": "duration"
        }
      ]
    }

  Raw model response — duration segment (working day):
    {
      "segmentId": "seg_877c09795d91f9c437489b6b3c0f3cb9",
      "modelCallId": "mcall_93e921b4706edaac7394a9489e70c55a",
      "repaired": true,
      "proposals": [
        {
          "segmentId": "seg_877c09795d91f9c437489b6b3c0f3cb9",
          "quotedText": "every two business days",
          "kind": "duration"
        },
        {
          "segmentId": "seg_877c09795d91f9c437489b6b3c0f3cb9",
          "quotedText": "within one working day",
          "kind": "duration"
        },
        {
          "segmentId": "seg_877c09795d91f9c437489b6b3c0f3cb9",
          "quotedText": "within 24 hours",
          "kind": "duration"
        }
      ]
    }

  Raw model response — adversarial segment (quote NOT in source):
    {
      "segmentId": "seg_d34a5a0bb669aac08768463c1ad43f8e",
      "modelCallId": "mcall_c65ce9aee9e6ccd0036cda700ab5acde",
      "repaired": true,
      "proposals": [
        {
          "segmentId": "seg_d34a5a0bb669aac08768463c1ad43f8e",
          "quotedText": "within five business days of such placement",
          "kind": "duration"
        }
      ]
    }

Manual verification

  npm run typecheck                          # clean
  npm run lint                               # clean
  npm test                                   # 370 pass
  docker compose build                       # rebuild with migration
  docker compose up -d                       # start stack
  docker compose exec app node dist/platform/db/migrate.js   # apply 0007
  npm run test:integration                   # 48 pass (all gates)

Rollback

  1. DROP TABLE model_calls;
  2. ALTER TABLE document_versions DROP COLUMN extraction_status, DROP COLUMN extractor_version;
  3. Remove extraction imports from src/main.ts
  4. Delete src/modules/extraction/ directory
  5. Delete src/platform/db/extraction-schema.ts, extraction-repository.ts
  6. Delete src/platform/server/routes/extract.ts
  7. Revert shared types (remove PromptHash, ModelCallId, ExtractionStatus)
  8. Revert parsing-repository.ts orderBy change
  9. Remove migration 0007 entry from _journal.json

STOPPING. Awaiting approval for Module 5.
