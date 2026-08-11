# Module 10 — Lane Router and Coverage Accounting

## What was searched

**Existing solutions for lane routing / triage engines:**

- **bull / bullmq** (MIT) — job queue with priority lanes. Wrong abstraction: this is a message queue, not a policy engine. Lane assignment here is a pure function mapping evidence state to a recommendation.
- **node-rules** (MIT) — declarative rule engine. Considered, but the rule set is small (< 10 rules) and domain-specific. A rule engine adds indirection without benefit at this scale.
- **json-rules-engine** (ISC) — JSON-based rule engine. Same argument: the rules are a simple cascade, not a dynamic rule set loaded from config.

**Decision:** Build. The lane router is a pure function (~100 lines) with a fixed, ordered cascade. No new dependencies.

## What was built

### Lane router (`src/modules/routing/lane-router.ts`)

Pure deterministic function `assignLane(input: LaneInput): LaneAssignment`. Maps each evaluated span to one of four lanes with stored reasons:

- **blocked** — unsupported evidence, grammar parse failure, unresolved date, or deterministic check failure
- **exception_review** — ambiguous support level, relative durations, missing triggers, recurrence expressions
- **straight_through** — fixed date, supported, deterministic passed, fidelity "declared", legislativeStatus "enacted"
- **quick_confirmation** — meets basic criteria but fails strict straight_through requirements (fidelity or status)

### Coverage accounting (`src/modules/routing/coverage.ts`)

Pure function `computeProcessingCoverage(scanResults)`. Reports processing coverage:
- `with_candidates` — segments where scanning found temporal candidates
- `screened_no_candidate` — segments where scanning found nothing temporal
- `needs_sweep` — segments not accounted for (0 in current pipeline; infrastructure present)

### Service, repository, API route, migration

- `src/modules/routing/service.ts` — orchestrates lane assignment + coverage
- `src/platform/db/routing-schema.ts` — Drizzle schema for `routing_results` table
- `src/platform/db/routing-repository.ts` — repository with CRUD + status update
- `src/platform/db/migrations/0013_routing_results.sql` — CREATE TABLE + ALTER TABLE
- `src/platform/server/routes/route.ts` — POST `/api/v1/documents/:documentVersionId/route`

## New dependencies

None.

## Gate 10 claims

### Claim 1: Lane assignment is deterministic — same input yields same lane

`assignLane` is a pure function with no randomness, no I/O, no mutable state:

```typescript
// src/modules/routing/lane-router.ts:19
export function assignLane(input: LaneInput): LaneAssignment {
```

Unit test:
```typescript
// src/modules/routing/lane-router.test.ts:310-317
it("same input → same lane across multiple calls", () => {
  const input = makeInput();
  const results = Array.from({ length: 10 }, () => assignLane(input));
  const lanes = new Set(results.map((r) => r.lane));
  expect(lanes.size).toBe(1);
});
```

Integration test confirms determinism across API calls:
```typescript
// test/integration/gate10.test.ts:169-175
const lanes1 = g1.body.assignments.map((a) => `${a.anchorId}:${a.lane}`).sort();
const lanes2 = g2.body.assignments.map((a) => `${a.anchorId}:${a.lane}`).sort();
expect(lanes1).toEqual(lanes2);
```

### Claim 2: Reasons are stored and inspectable for every assignment

Every path through `assignLane` pushes at least one reason before returning:

```typescript
// src/modules/routing/lane-router.ts:24-25
reasons.push({ rule: "BLOCKED_UNSUPPORTED", detail: "support level is unsupported" });
return result(evaluation, "blocked", reasons);
```

```typescript
// src/modules/routing/lane-router.ts:47-48
reasons.push({ rule: "EXCEPTION_AMBIGUOUS", detail: "support level is ambiguous — requires human review" });
return result(evaluation, "exception_review", reasons);
```

```typescript
// src/modules/routing/lane-router.ts:103-104
reasons.push({ rule: "QUICK_CONFIRMATION", detail: "meets basic criteria but not strict straight_through requirements" });
return result(evaluation, "quick_confirmation", reasons);
```

Unit test:
```typescript
// src/modules/routing/lane-router.test.ts:323-330
it("every assignment has at least one reason", () => {
  const inputs: LaneInput[] = [ ... ];
  for (const input of inputs) {
    const result = assignLane(input);
    expect(result.reasons.length).toBeGreaterThan(0);
  }
});
```

### Claim 3: A hypothetical-status document never routes to straight_through (INV-8)

```typescript
// src/modules/routing/lane-router.ts:86-93
if (legislativeStatus !== "enacted") {
  straightThroughReasons.push({
    rule: "ST_STATUS_BLOCKED",
    detail: `legislativeStatus is "${legislativeStatus}", not "enacted" — straight_through requires enacted status (INV-8)`,
  });
  meetsAllCriteria = false;
}
```

Unit test covers all non-enacted statuses:
```typescript
// src/modules/routing/lane-router.test.ts:263-272
it("INV-8: every non-enacted status blocks straight_through", () => {
  const nonEnactedStatuses: LegislativeStatus[] = [
    "introduced", "engrossed", "enrolled", "vetoed", "failed", "unknown",
  ];
  for (const status of nonEnactedStatuses) {
    const result = assignLane(makeInput({ legislativeStatus: status }));
    expect(result.lane).not.toBe("straight_through");
    expect(result.reasons.some((r) => r.rule === "ST_STATUS_BLOCKED")).toBe(true);
  }
});
```

Integration test on HB 35 (introduced):
```typescript
// test/integration/gate10.test.ts:225-230
expect(g.body.laneSummary.straight_through).toBe(0);
for (const assignment of g.body.assignments) {
  expect(assignment.lane).not.toBe("straight_through");
}
```

HB 35 actual API output confirms `straight_through: 0` — all 5 assignments are `blocked`.

### Claim 4: Auto-publish is unreachable — demonstrated, not just asserted (INV-9)

The routing module contains no function that publishes, approves, authorizes, or marks a record as authoritative. `assignLane` returns a `LaneAssignment` with `{ anchorId, segmentId, lane, reasons }` — it is a recommendation, not an action.

```
$ grep -rn "publish\|autoApprove\|auto_approve\|markAuthoritative" \
    src/modules/routing/*.ts --exclude="*.test.ts"
(no output — zero matches)
```

The `LaneAssignment` type has exactly four fields:
```typescript
// src/modules/routing/types.ts:13-18
export interface LaneAssignment {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly lane: Lane;
  readonly reasons: readonly LaneReason[];
}
```

There is no `approved` field, no `publish()` method, no `markAuthoritative()` function. The auto-publish path does not exist as reachable code because the code was never written.

Unit test confirms the shape:
```typescript
// src/modules/routing/lane-router.test.ts:340-345
it("assignLane returns a lane recommendation — it never publishes, approves, or marks authoritative", () => {
  const result = assignLane(makeInput());
  expect(result.lane).toBe("straight_through");
  expect(Object.keys(result)).toEqual(["anchorId", "segmentId", "lane", "reasons"]);
});
```

### Claim 5: Coverage counts reconcile — every segment in exactly one state

```typescript
// src/modules/routing/coverage.ts:5-34
export function computeProcessingCoverage(
  scanResults: readonly SegmentScanResult[],
): ProcessingCoverage {
  // ... counts each segment into exactly one of three buckets
  return {
    totalSegments: scanResults.length,
    withCandidates,
    screenedNoCandidate,
    needsSweep,
    segments,
  };
}
```

Unit test:
```typescript
// src/modules/routing/coverage.test.ts:51-58
it("mixed states → counts reconcile", () => {
  // ...
  expect(
    result.withCandidates + result.screenedNoCandidate + result.needsSweep,
  ).toBe(result.totalSegments);
});
```

Integration test on HB 35:
```typescript
// test/integration/gate10.test.ts:255-258
expect(
  cov.withCandidates + cov.screenedNoCandidate + cov.needsSweep,
).toBe(cov.totalSegments);
```

### Claim 6: PDF fidelity "inferred" blocks straight_through

PDFs are parsed with fidelity "inferred" (Module 2). The lane router requires fidelity "declared" for straight_through:

```typescript
// src/modules/routing/lane-router.ts:76-82
if (segmentFidelity !== "declared") {
  straightThroughReasons.push({
    rule: "ST_FIDELITY_BLOCKED",
    detail: `fidelity is "${segmentFidelity}", not "declared" — straight_through requires declared fidelity`,
  });
  meetsAllCriteria = false;
}
```

This means no PDF document can currently route to straight_through, even if enacted. This is the correct consequence of fidelity tiering: inferred text layout from PDF geometry is not declared structure from a native format. The straight_through lane is empty for every fixture we have.

Unit test:
```typescript
// src/modules/routing/lane-router.test.ts:284-291
it("inferred fidelity blocks straight_through — PDF consequence", () => {
  const result = assignLane(makeInput({
    segmentFidelity: "inferred",
  }));
  expect(result.lane).toBe("quick_confirmation");
  expect(result.lane).not.toBe("straight_through");
  expect(result.reasons.some((r) => r.rule === "ST_FIDELITY_BLOCKED")).toBe(true);
});
```

### Claim 7: Coverage labels distinguish processing coverage from measured recall (INV-7)

The API response explicitly labels coverage as processing coverage and includes a disclaimer:

```typescript
// src/platform/server/routes/route.ts:45-46
label: "processing_coverage",
note: "This is processing coverage, not measured recall. It does not certify that no obligation exists in unaccounted segments.",
```

The coverage function never uses the word "certified", "absence", or "recall":
```typescript
// src/modules/routing/coverage.test.ts:95-102
it("INV-7: labels are processing_coverage, not recall — no 'certified' or 'absence' language", () => {
  const scans = [makeScanResult("seg_1", "screened_no_candidate")];
  const result = computeProcessingCoverage(scans);
  const json = JSON.stringify(result);
  expect(json).not.toContain("certified");
  expect(json).not.toContain("absence");
  expect(json).not.toContain("recall");
});
```

## HB 35 actual API output

```json
{
  "documentVersionId": "b5e7caa3-1561-4773-b32a-5b7c1eb5eeb6",
  "routerVersion": "1.0.0",
  "totalAssignments": 5,
  "laneSummary": {
    "blocked": 5,
    "exception_review": 0,
    "straight_through": 0,
    "quick_confirmation": 0
  },
  "processingCoverage": {
    "label": "processing_coverage",
    "note": "This is processing coverage, not measured recall. It does not certify that no obligation exists in unaccounted segments.",
    "totalSegments": 18,
    "withCandidates": 18,
    "screenedNoCandidate": 0,
    "needsSweep": 0
  },
  "assignments": [
    {
      "anchorId": "anc_c948d1a623a701f553d42e0a56a7e6cc",
      "segmentId": "seg_32da6a8cad2d35219033a8dd2c246b09",
      "lane": "blocked",
      "reasons": [{ "rule": "BLOCKED_UNRESOLVED", "detail": "date could not be resolved: periodStart, periodEnd" }]
    },
    {
      "anchorId": "anc_899c5f4862b2e76eeae27d4b3e261ed1",
      "segmentId": "seg_32da6a8cad2d35219033a8dd2c246b09",
      "lane": "blocked",
      "reasons": [{ "rule": "BLOCKED_UNRESOLVED", "detail": "date could not be resolved: triggerDate" }]
    },
    {
      "anchorId": "anc_f560803be065af1b48f1c2c00749d971",
      "segmentId": "seg_32da6a8cad2d35219033a8dd2c246b09",
      "lane": "blocked",
      "reasons": [{ "rule": "BLOCKED_UNRESOLVED", "detail": "date could not be resolved: triggerDate" }]
    },
    {
      "anchorId": "anc_fa46235b3b37cbbe64c4e9b8cc24afb5",
      "segmentId": "seg_3616808417f788d34f059b76670bc473",
      "lane": "blocked",
      "reasons": [{ "rule": "BLOCKED_UNRESOLVED", "detail": "date could not be resolved: triggerDate" }]
    },
    {
      "anchorId": "anc_b5888c37a0e1cb89fd67c93b0791b54a",
      "segmentId": "seg_3616808417f788d34f059b76670bc473",
      "lane": "blocked",
      "reasons": [{ "rule": "BLOCKED_UNRESOLVED", "detail": "date could not be resolved: triggerDate" }]
    }
  ]
}
```

All 5 assignments are **blocked** because:
1. The document is "introduced" (not enacted) — INV-8 blocks straight_through
2. All temporal expressions are relative durations that require trigger dates (e.g., `triggerDate`, `periodStart`, `periodEnd`) which were not supplied — resolution failed
3. Coverage: 18/18 segments accounted for (all have scanning candidates), sum reconciles

## Test results

- **580 unit tests** — 41 files, all passing
- **82 integration tests** — gates 1–10, all passing
- **37 new routing unit tests** (lane-router: 21, coverage: 7, service: 9)
- **6 new gate10 integration tests**
- Typecheck: clean
- Lint: clean
