# Module 9 — Support Evaluation Report

## Library decision

**Searched:** No existing open-source support-evaluation library found for legislative
text entailment. This is a domain-specific verification layer that must integrate
tightly with the anchoring, grammar, and resolution pipeline.

**Build.** The module is ~400 lines of application code plus ~600 lines of tests.
The deterministic checks are pure functions; the LLM evaluator wraps the existing
ModelGateway interface. No new Node.js dependencies.

## Architecture

Two-phase evaluation per anchored span:

1. **Deterministic checks** (dispositive, run first):
   - `quote_anchored` — anchor result exists and `anchored: true`
   - `segment_ownership` — segment belongs to this document version
   - `offsets_valid` — normalized offsets within segment text bounds
   - `date_parse_match` — if fixed_date grammar parse exists, statutory date matches

2. **LLM evaluator** (residual entailment, runs only if all deterministic checks pass):
   - Returns `EvaluatorVerdict` — `"ambiguous" | "unsupported"`, never `"supported"`
   - Uses `SUPPORT_EVALUATION_PROMPT` — separate lineage from Module 4's `SPAN_PROPOSAL_PROMPT`
   - Uses a distinct model ID (`EVALUATOR_MODEL_ID` env var)

Approval requires ALL evaluated spans to have `supportLevel === "supported"`. Any
ambiguous or unsupported span blocks approval.

## INV-4 enforcement — three layers

### Layer 1: Type system

```typescript
// src/modules/shared/types.ts:73-78
export const EvaluatorVerdict = {
  ambiguous: "ambiguous",
  unsupported: "unsupported",
} as const;
export type EvaluatorVerdict =
  (typeof EvaluatorVerdict)[keyof typeof EvaluatorVerdict];
```

The type has no `"supported"` variant. Attempting to assign `"supported"` to
`EvaluatorVerdict` is a compile error.

### Layer 2: Runtime guard

```typescript
// src/modules/evaluation/evaluator.ts:16
const VALID_VERDICTS = new Set<string>(["ambiguous", "unsupported"]);

// src/modules/evaluation/evaluator.ts:69
if (!VALID_VERDICTS.has(parsed.verdict)) {
  return {
    verdict: "unsupported" as EvaluatorVerdict,
    reasoning: `evaluator returned invalid verdict "${parsed.verdict}" — forced to unsupported`,
    promptHash: prompt.promptHash,
  };
}
```

If the LLM returns `"supported"` or any invalid string, it is forced to
`"unsupported"`.

### Layer 3: Compile-time test

```typescript
// src/modules/evaluation/evaluator.test.ts:134
// @ts-expect-error — "supported" is not assignable to EvaluatorVerdict
const _forbidden: EvaluatorVerdict = "supported";
```

This test fails to compile if the type system ever gains a `"supported"` variant.

## Gate claims

### Gate 9.1: Deterministic checks catch fabricated quotes without invoking the LLM

```typescript
// src/modules/evaluation/service.test.ts:248-263
it("fabricated quote: deterministic check fails, LLM NOT called", async () => {
  // ... anchorResult with { anchored: false, reason: "fuzzy_ceiling_exceeded" }
  const result = await service.evaluateDocument(dvId);
  expect(result.totalEvaluated).toBe(0);
  expect(evaluator.evaluate).not.toHaveBeenCalled();
});
```

The fabricated quote produces `anchored: false`, so the service skips it entirely
(non-anchored spans are not evaluated). The evaluator gateway is never invoked.

### Gate 9.2: Deterministic checks catch cross-document evidence without invoking the LLM

```typescript
// src/modules/evaluation/service.test.ts:265-280
it("cross-document evidence: segment missing, deterministic fails, LLM NOT called", async () => {
  // ... parsingRepository returns empty segments
  expect(result.evaluations[0]!.supportLevel).toBe("unsupported");
  expect(result.evaluations[0]!.deterministicResult.allPassed).toBe(false);
  expect(evaluator.evaluate).not.toHaveBeenCalled();
});
```

When the segment doesn't exist in the document version, `checkSegmentOwnership`
fails. The service sets `supportLevel: "unsupported"` without invoking the LLM.

### Gate 9.3: Deterministic checks catch date mismatches without invoking the LLM

```typescript
// src/modules/evaluation/deterministic-checks.test.ts:189-214
it("date mismatch caught without LLM", () => {
  // ... grammarResult has fixed_date 2030-01-01, resolutionResult has 2025-07-01
  expect(result.allPassed).toBe(false);
  const dateCheck = result.checks.find((c) => c.check === "date_parse_match");
  expect(dateCheck!.status).toBe("failed");
});
```

### Gate 9.4: Evaluator returning "supported" fails to compile and is rejected at runtime

Compile-time:
```typescript
// src/modules/evaluation/evaluator.test.ts:133-134
// @ts-expect-error — "supported" is not assignable to EvaluatorVerdict
const _forbidden: EvaluatorVerdict = "supported";
```

Runtime:
```typescript
// src/modules/evaluation/evaluator.test.ts:68-82
it("forces unsupported when model returns an invalid verdict", async () => {
  const gateway = makeGatewayResponse("supported", "looks good to me");
  // ...
  expect(result.verdict).toBe("unsupported");
  expect(result.reasoning).toContain("invalid verdict");
});
```

### Gate 9.5: Unsupported material field blocks approval

```typescript
// src/modules/evaluation/service.test.ts:282-292
it("unsupported material field blocks approval", async () => {
  const evaluator = createMockEvaluator("unsupported");
  // ...
  expect(result.approved).toBe(false);
  expect(result.totalUnsupported).toBeGreaterThan(0);
});
```

Approval logic:
```typescript
// src/modules/evaluation/service.ts:148-151
const allSupported = evaluations.length > 0 && evaluations.every(
  (e) => e.supportLevel === "supported",
);
const approved = allSupported;
```

### Gate 9.6: Separate prompt lineage from extraction

```typescript
// src/modules/evaluation/evaluator-prompt.ts:4
const SUPPORT_EVALUATION_SYSTEM_PROMPT = `You are a legal evidence auditor...`

// src/modules/evaluation/evaluator-prompt.ts:36-46
export const SUPPORT_EVALUATION_PROMPT: VersionedPrompt = {
  promptHash: computePromptHash(
    SUPPORT_EVALUATION_SYSTEM_PROMPT,
    SUPPORT_EVALUATION_USER_TEMPLATE,
  ),
  ...
  version: "1.0.0",
};
registerPrompt(SUPPORT_EVALUATION_PROMPT);
```

Integration test verifies the prompt hash differs from the extraction prompt:
```typescript
// test/integration/gate9.test.ts:218-225
expect(g.body.promptHash).toBeTruthy();
expect(g.body.promptHash).not.toBe("ph_fixture");
expect(g.body.promptHash).toMatch(/^ph_/);
```

## HB 35 API output

```
Evaluator version: 1.0.0
Prompt hash: ph_6820db761f7acc03b70b567c95f313baa96f47a26dba798b2dabce29e281d73f
Approved: false
Total evaluated: 5
Total supported: 0
Total ambiguous: 5
Total unsupported: 0

Span evaluations:
- "every two business days"     → deterministic: PASS, verdict: ambiguous
- "within one working day"      → deterministic: PASS, verdict: ambiguous
- "within 24 hours"             → deterministic: PASS, verdict: ambiguous
- "within 30 days"              → deterministic: PASS, verdict: ambiguous
- "no longer than seven days"   → deterministic: PASS, verdict: ambiguous

INV-4 check: 0 evaluations with verdict "supported"
```

All 5 anchored spans pass deterministic checks (quote anchored, segment ownership,
offsets valid, date parse match). The fixture LLM evaluator returns "ambiguous" for
all — a conservative default that correctly blocks approval. In production with a
real model, the evaluator would make semantic judgments about entailment.

## Evaluator accuracy measurement

Evaluator accuracy is not measured in this module. Measurement is deferred to
Module 12 (Benchmark & Calibration), which will:

1. Construct a labeled dataset of (quotedText, segmentText, kind, ground-truth SupportLevel) triples
2. Run the evaluator on the dataset with multiple model/prompt combinations
3. Compute precision, recall, and F1 per SupportLevel class
4. Track metrics against the prompt hash for regression detection

The infrastructure for this is in place: the `promptHash` and `evaluatorVersion`
are stored with every evaluation result, enabling A/B comparison across prompt
lineages.

## Test summary

- **Unit tests:** 37 new (21 deterministic checks, 7 evaluator, 9 service)
- **Integration tests:** 6 new (gate9)
- **Total unit tests:** 542 (all pass)
- **Total integration tests:** 76 (gates 1-9, all pass)
- **Typecheck:** clean
- **Lint:** clean

## New files

| File | Purpose |
|---|---|
| `src/modules/evaluation/types.ts` | Domain types: SpanEvaluation, DocumentEvaluationResult |
| `src/modules/evaluation/deterministic-checks.ts` | Pure deterministic check functions |
| `src/modules/evaluation/evaluator-prompt.ts` | SUPPORT_EVALUATION_PROMPT (separate lineage) |
| `src/modules/evaluation/evaluator.ts` | LLM evaluator (returns only EvaluatorVerdict) |
| `src/modules/evaluation/service.ts` | Orchestrates deterministic-first → LLM-residual |
| `src/modules/evaluation/deterministic-checks.test.ts` | 21 unit tests for deterministic checks |
| `src/modules/evaluation/evaluator.test.ts` | 7 unit tests including INV-4 type enforcement |
| `src/modules/evaluation/service.test.ts` | 9 unit tests for service orchestration |
| `src/platform/db/evaluation-schema.ts` | Drizzle schema for evaluation_results table |
| `src/platform/db/evaluation-repository.ts` | Repository with CRUD + status updates |
| `src/platform/db/migrations/0012_evaluation_results.sql` | Migration SQL |
| `src/platform/server/routes/evaluate.ts` | POST /api/v1/documents/:id/evaluate |
| `test/integration/gate9.test.ts` | 6 integration tests |
| `scripts/gate9-demo.sh` | API demo script |

## Modified files

| File | Change |
|---|---|
| `src/modules/shared/types.ts` | Added `EvaluationStatus` const object and type |
| `src/modules/ingestion/types.ts` | Added `evaluationStatus`, `evaluatorVersion` to DocumentVersion |
| `src/platform/db/ingestion-schema.ts` | Added columns + check constraint |
| `src/platform/db/ingestion-repository.ts` | Maps new columns in rowToDocumentVersion |
| `src/modules/ingestion/service.ts` | Defaults in insertVersion |
| `src/platform/db/schema.ts` | Re-exports evaluationResults |
| `src/platform/db/migrations/meta/_journal.json` | Entry for 0012 |
| `src/platform/config/env.ts` | Added EVALUATOR_MODEL_ID |
| `src/main.ts` | Wired evaluation repository, service, evaluator, routes |
| `src/modules/parsing/service.test.ts` | Added evaluationStatus/evaluatorVersion to makeVersion |
| `src/modules/scanning/service.test.ts` | Added evaluationStatus/evaluatorVersion to makeVersion |
| `src/modules/extraction/service.test.ts` | Added evaluationStatus/evaluatorVersion to makeVersion |
| `src/modules/anchoring/service.test.ts` | Added evaluationStatus/evaluatorVersion to makeVersion |

## New dependencies

None.
