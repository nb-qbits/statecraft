# MODULE 12 COMPLETE — Evaluation Harness

## Gate results

### 1. Scorer runs deterministically against synthetic gold — PASS

The scorer is a pure function of its inputs. Running `scoreRun()` twice against the same gold set and proposals produces identical results:

```typescript
// test/integration/gate12.test.ts:192-210
const result1 = matchGoldToProposals(SYNTHETIC_GOLD.items, proposals, []);
const score1 = scoreRun(SYNTHETIC_GOLD.items, proposals, result1);

const result2 = matchGoldToProposals(SYNTHETIC_GOLD.items, proposals, []);
const score2 = scoreRun(SYNTHETIC_GOLD.items, proposals, result2);

expect(score1.precision).toBe(score2.precision);
expect(score1.recall).toBe(score2.recall);
expect(score1.f1).toBe(score2.f1);
expect(score1.aggregate).toEqual(score2.aggregate);
expect(score1.fabrication).toEqual(score2.fabrication);
```

Integration test confirms: 6/6 gate12 tests pass.

### 1a. matchedCorrect is reachable — PASS

Initial synthetic gold used grammar-layer kinds (`"fixed_date"`, `"relative_duration"`)
while proposals carry extraction-layer kinds (`"effective_date"`, `"obligation_deadline"`).
The `kind` mismatch made `matchedCorrect` structurally unreachable — a scorer that
cannot report success would show 0% accuracy on a perfect system.

Fixed by correcting the gold schema to use extraction kinds. Proved with a test that
mirrors a real proposal exactly:

```typescript
// test/integration/gate12.test.ts:176-213
const target = proposals.find((p) => p.resolved && p.statutoryDate) ?? proposals[0]!;
const exactGold: GoldItem[] = [{
  goldItemId: "g-exact-match",
  // ... all fields copied from target ...
  kind: target.kind,
  deadlineDate: target.statutoryDate,
}];

const result = matchGoldToProposals(exactGold, [target], []);
expect(result.pairs[0]!.outcome).toBe("matched_correct");
expect(result.pairs[0]!.wrongFields).toHaveLength(0);

const score = scoreRun(exactGold, [target], result);
expect(score.precision).toBe(1.0);
expect(score.recall).toBe(1.0);
expect(score.f1).toBe(1.0);
```

Actual output: `Gold kind: effective_date`, `Proposal kind: effective_date`,
`Outcome: matched_correct`, `Precision: 1, Recall: 1`.

### 2. Match function handles one-to-many and many-to-one — PASS

Stage 1 (span overlap) and stage 2 (field similarity) produce a scored candidate list. Greedy matching assigns each gold item to at most one proposal, with leftover proposals or gold items reported as false positives or misses:

```typescript
// src/modules/harness/match.ts:141
export function matchGoldToProposals(
  goldItems: readonly GoldItem[],
  proposals: readonly ProposalSnapshot[],
  adjudicationCache: readonly AdjudicationEntry[],
): MatchResult {
```

1:N test (one gold, multiple proposals):
```typescript
// test/integration/gate12.test.ts:214-218
const result1toN = matchGoldToProposals(oneToManyGold, proposals, []);
expect(result1toN.pairs.length).toBeLessThanOrEqual(proposals.length);
expect(result1toN.pairs.length).toBeGreaterThanOrEqual(1);
```

N:1 test (multiple gold items, one matched proposal):
```typescript
// test/integration/gate12.test.ts:223-230
const resultNto1 = matchGoldToProposals(manyToOneGold, proposals, []);
expect(resultNto1.pairs.length + resultNto1.unmatchedGold.length).toBe(2);
```

Unit tests cover both directions: `src/modules/harness/match.test.ts` — 11 tests.

### 3. Cached adjudications are reused — PASS

Adjudication cache keyed by `(goldItemId, proposalContentHash)`:

```typescript
// src/modules/harness/match.ts:148-150
const cacheMap = new Map<string, boolean>();
for (const entry of adjudicationCache) {
  const key = `${entry.goldItemId}|${entry.proposalContentHash}`;
  cacheMap.set(key, entry.isMatch);
}
```

Cached `isMatch: true` forces pairing even with zero span overlap:
```typescript
// test/integration/gate12.test.ts:276-286
const cache: AdjudicationEntry[] = [{
  goldItemId: "g-cache-test",
  proposalContentHash: contentHash,
  isMatch: true,
  adjudicatorId: "human-tester",
  adjudicatedAt: "2026-08-11T00:00:00Z",
}];

const resultWith = matchGoldToProposals(gold, proposals, cache);
expect(resultWith.pairs.length).toBe(1);
```

Cached `isMatch: false` prevents pairing even with perfect overlap — unit test in `match.test.ts`.

### 4. Same configuration three times reports variance — PASS

```typescript
// src/modules/harness/runner.ts:71-97
export function computeVariance(runs: readonly HarnessRun[]): VarianceReport {
  // ...
  const precisionVariance = variance(precisions);
  const recallVariance = variance(recalls);
  const f1Variance = variance(f1s);

  const deterministic = precisionVariance === 0 && recallVariance === 0 && f1Variance === 0;

  return {
    runs,
    precisionVariance,
    recallVariance,
    f1Variance,
    deterministic,
  };
}
```

Integration test runs harness 3 times with identical config:
```typescript
// test/integration/gate12.test.ts:303-322
const run1 = await runHarness(deps);
const run2 = await runHarness(deps);
const run3 = await runHarness(deps);

const variance = computeVariance([run1, run2, run3]);
expect(variance.runs).toHaveLength(3);
expect(variance.precisionVariance).toBe(0);
expect(variance.recallVariance).toBe(0);
expect(variance.f1Variance).toBe(0);
expect(variance.deterministic).toBe(true);
```

### 5. Fabricated dates counted separately, never averaged into aggregate — PASS

Fabrication has its own denominator and report structure:

```typescript
// src/modules/harness/scorer.ts:224-253
function buildFabricationReport(
  goldItems: readonly GoldItem[],
  _proposals: readonly ProposalSnapshot[],
  matchResult: MatchResult,
): FabricationReport {
  const fabricatedGold = goldItems.filter((g) => g.isFabricated);
  const totalFabricated = fabricatedGold.length;
  // ...
  return {
    totalFabricated,
    denominator: totalFabricated,
    detected,
    missed,
  };
}
```

Aggregate excludes fabricated items from the missed count:

```typescript
// src/modules/harness/scorer.ts:107-111
const nonFabricatedMissed = matchResult.unmatchedGold.filter((gid) => {
  const gold = goldItems.find((g) => g.goldItemId === gid);
  return gold && !gold.isFabricated;
});
counts = addToConfusion(counts, "missed", nonFabricatedMissed.length);
```

Integration test:
```typescript
// test/integration/gate12.test.ts:347-350
expect(score.fabrication.missed).toBe(0);
expect(score.fabrication.detected).toBe(fabricatedItems.length);
```

## Actual harness output (from gate12 integration test)

```json
{
  "totalGoldItems": 5,
  "totalProposals": 3,
  "aggregate": {
    "matchedCorrect": 1,
    "matchedWrongValue": 1,
    "missed": 0,
    "falsePositive": 1,
    "split": 0,
    "merged": 0
  },
  "precision": 0.5,
  "recall": 1.0,
  "f1": 0.667,
  "byPatternClass": [
    { "patternClass": "fixed_date", "counts": { "matchedCorrect": 1 }, "total": 1 },
    { "patternClass": "relative_duration", "counts": { "matchedWrongValue": 1 }, "total": 1 }
  ],
  "byLane": [
    { "lane": "exception_review", "counts": { "matchedCorrect": 1 }, "total": 1 },
    { "lane": "blocked", "counts": { "matchedWrongValue": 1, "falsePositive": 1 }, "total": 2 }
  ],
  "fabrication": {
    "totalFabricated": 2,
    "denominator": 2,
    "detected": 2,
    "missed": 0
  },
  "precisionInterval": { "point": 0.5, "lower": 0.095, "upper": 0.905, "n": 2 },
  "recallInterval": { "point": 1.0, "lower": 0.207, "upper": 1.0, "n": 1 }
}
```

The effective date gold item (`kind: "effective_date"`, `deadlineDate: "2025-07-01"`)
produces `matchedCorrect`. The reporting deadline gold item remains `matchedWrongValue`
because its placeholder `deadlineDate` does not match the system's computed statutory date.
The harness correctly distinguishes "matched the right span but wrong field values" from
"matched correctly."

## Defect found and fixed

The initial synthetic gold used grammar-layer kind values (`"fixed_date"`,
`"relative_duration"`) while proposals carry extraction-layer kind values
(`"effective_date"`, `"obligation_deadline"` — from `SpanProposalKind` in
`src/modules/extraction/types.ts`). The `kind` field in `computeFieldSimilarity`
always mismatched, making `matchedCorrect` unreachable against real system output.
A scorer that cannot report success would show 0% accuracy on a perfect system.

**Fix:** Corrected the gold schema to use extraction kinds. Added an integration
test that mirrors a real proposal exactly and asserts `matchedCorrect` with
precision and recall of 1.0.

## Test summary

- **Unit tests:** 634 total (31 new in harness module)
  - `match.test.ts`: 11 tests — span overlap, field similarity, 1:N, N:1, adjudication cache, negative items, content hashing
  - `scorer.test.ts`: 12 tests — perfect run, misses, false positives, pattern class decomposition, lane decomposition, fabrication isolation, Wilson intervals
  - `runner.test.ts`: 8 tests — harness execution, error recording, Wilson intervals, variance computation, config hashing
- **Integration tests:** 101 total (6 new in gate12)
- All tests pass offline (no network access required)

## Files changed

- `src/modules/harness/types.ts` — Gold annotation schema, match types, confusion structure, run recording, Wilson intervals
- `src/modules/harness/match.ts` — Two-stage match function with adjudication cache
- `src/modules/harness/scorer.ts` — Confusion structure scorer with per-lane/per-pattern-class decomposition, fabrication report, Wilson intervals
- `src/modules/harness/runner.ts` — Harness runner with variance computation
- `src/modules/harness/match.test.ts` — Unit tests for match function
- `src/modules/harness/scorer.test.ts` — Unit tests for scorer and Wilson intervals
- `src/modules/harness/runner.test.ts` — Unit tests for runner and variance
- `fixtures/gold/synthetic-gold.json` — Synthetic gold set (2 real, 1 negative, 2 fabricated)
- `test/integration/gate12.test.ts` — Gate 12 integration tests

## Migrations

None.

## Environment variables

None.

## Invariants touched

- **INV-7 (screening does not certify):** Gold schema includes `isNegative` for segments where no obligation exists. The scorer does not count negative gold items as misses — they validate that the system correctly produced no output for that segment.

## Decisions taken

1. **Match function uses greedy assignment, not optimal bipartite matching.** Conservative choice: greedy is simpler, deterministic, and produces the same results as Hungarian algorithm for the small gold sets in this slice. Optimal matching would improve accuracy for large gold sets with many overlapping spans. Noted as a future improvement.

2. **Span overlap uses substring containment and longest-common-substring, not positional offset comparison.** The gold items have placeholder segment IDs (not real ones from the system), so positional offset-based matching would require resolving gold items to real segments first. Substring matching works for the current synthetic gold; positional matching would be more accurate for production gold sets with resolved offsets.

3. **Field similarity treats actor and deliverable as substring match.** Conservative choice: partial overlap (e.g., "Each agency" vs. "each agency") counts as a match. Exact string equality would be too strict for minor normalization differences.

4. **Wilson intervals use z=1.96 (95% confidence).** Standard choice. An alternative would be z=1.645 (90%) for smaller gold sets.

5. **Fabricated items excluded from aggregate precision/recall denominators.** The brief says "fabricated dates have their own denominator and zero tolerance." We implement this literally: fabricated items appear only in `FabricationReport` with `denominator = totalFabricated`, never in the aggregate `missed` or `falsePositive` counts.

## Support-evaluator accuracy measurement (Module 9) — not implemented

The brief notes that the support evaluator (Module 9) is currently unmeasured and has no gate of its own. Measuring its accuracy would require:

1. **Gold support labels:** Each gold item would need a `goldSupportLevel: "supported" | "ambiguous" | "unsupported"` field, annotated by a human who reads the quoted span and the claim it supports.

2. **Deterministic vs. LLM decomposition:** Measurement must separate deterministic-check accuracy from LLM-evaluator accuracy. A gold item that fails a deterministic check never reaches the LLM, so measuring the LLM evaluator requires gold items that pass all deterministic checks.

3. **Adversarial gold items:** The gold set would need cases where the LLM should downgrade (wrong-span selection, out-of-scope claims, speculative obligations) and cases where it should pass through. INV-4 means the evaluator can only reject or downgrade, never approve — so the metric is "of the items that should be downgraded, how many does the evaluator actually downgrade?" (sensitivity) and "of the items that should not be downgraded, how many does it leave alone?" (specificity).

4. **Prompt lineage tracking:** Since the evaluator uses a different model/prompt from extraction (to avoid correlated failure), measuring accuracy across prompt versions requires the harness to record which prompt hash was used for each evaluation.

5. **Integration into the harness:** Extend `GoldItem` with `goldSupportLevel`, add a new confusion structure for evaluator accuracy decomposed by deterministic-check vs. LLM-evaluator, and report separate precision/recall for the evaluator's downgrade decisions.

## Known limitations

1. **Synthetic gold set is placeholder data.** The gold items have approximate rule IDs and citations that do not exactly match system output. This produces `matched_wrong_value` instead of `matched_correct`. Real gold data with exact expected values will produce more meaningful accuracy metrics.

2. **No persistent adjudication store.** Adjudication entries are passed in-memory. Production use requires a persistent store (database table) so human adjudications accumulate across runs.

3. **No cost or token tracking.** The `RunConfig` includes fields for cost and latency but these are not populated from actual LLM calls in the current integration — the harness measures the scorer, not the full extraction pipeline.

## Manual verification

```bash
# Unit tests
npx vitest run src/modules/harness/

# Integration tests (requires running stack)
docker compose up -d --build
docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker compose exec minio mc mb local/policyaction --ignore-existing
docker compose exec app node dist/platform/db/migrate.js
npx vitest run --config vitest.integration.config.ts test/integration/gate12.test.ts

# Full suite
npx vitest run --exclude '**/integration/**'
npx vitest run --config vitest.integration.config.ts
```

## Rollback

Remove `src/modules/harness/`, `fixtures/gold/synthetic-gold.json`, and `test/integration/gate12.test.ts`. No migrations, no schema changes, no wiring into main.ts — the harness is a standalone module with no runtime dependencies.

STOPPING. Awaiting approval for Module 13.
