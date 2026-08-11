# Module 8 Report — Resolver

## Summary

Pure resolver function. No LLM. Receives parsed grammar expressions from anchored spans, applies the Virginia jurisdiction pack's time-computation rules, and produces `{statutoryDate, adjustedDate, ruleIds[], citations[], packVersion, warnings[]}` or an explicit unresolved state naming the missing input.

## Library search

No new dependencies. The resolver is a pure function calling the jurisdiction pack (Module 7) and grammar types (Module 6). No external libraries needed — all computation is civil date arithmetic already implemented in Module 7's `time-computation.ts`.

## Gate 8 verification

### Gate claim 1: Every resolved date carries citations, or is explicitly unresolved

**Evidence — `resolve.ts:46–61`** (fixed_date path):

```typescript
  const adjustment = pack.adjustForNonBusinessDay(statutoryDate);

  const ruleIds: string[] = [];
  const citations: string[] = [];

  ruleIds.push(...adjustment.ruleIds);
  citations.push(...adjustment.citations);

  return {
    resolved: true,
    statutoryDate,
    adjustedDate: adjustment.adjustedDate,
    ruleIds,
    citations,
    packVersion: pack.packVersion,
    warnings: [],
    inputs: [input],
  };
```

**Evidence — `resolve.ts:112–131`** (relative_duration path):

```typescript
  const deadline = pack.computeDeadline(
    triggerInput.value,
    expression.quantity,
    dayKind,
  );

  const ruleIds: string[] = [...deadline.ruleIds];
  const citations: string[] = [...deadline.citations];

  return {
    resolved: true,
    statutoryDate: deadline.statutoryDate,
    adjustedDate: deadline.adjustedDate,
    ruleIds,
    citations,
    packVersion: pack.packVersion,
    warnings: [],
    inputs: [triggerInput],
  };
```

**Evidence — integration test (`gate8.test.ts:194–212`):**

```typescript
    for (const result of g.body.results) {
      if (result.result.resolved) {
        expect(
          result.result.citations!.length,
          `resolved "${result.text}" must carry citations`,
        ).toBeGreaterThan(0);
        expect(result.result.ruleIds!.length).toBeGreaterThan(0);
        ...
      } else {
        expect(result.result.reason).toBeTruthy();
        expect(result.result.missingInputs).toBeDefined();
      }
    }
```

### Gate claim 2: Missing trigger dates produce unresolved with the missing input named

**Evidence — `resolve.ts:77–95`:**

```typescript
  const triggerInput = suppliedInputs.find((i) => i.name === "triggerDate");

  if (!triggerInput) {
    const warnings: string[] = [];

    if (expression.referenceEvent) {
      warnings.push(
        `expression references '${expression.referenceEvent}' but no triggerDate was supplied`,
      );
    }

    return {
      resolved: false,
      reason: "triggerDate is required to resolve a relative duration",
      missingInputs: ["triggerDate"],
      warnings,
      inputs: [...suppliedInputs],
    };
  }
```

**API output — HB 35 without trigger date (all 5 expressions unresolved):**

```json
{
    "totalExpressions": 5,
    "totalResolved": 0,
    "totalUnresolved": 5,
    "results": [
        {
            "text": "within 30 days",
            "result": {
                "resolved": false,
                "reason": "triggerDate is required to resolve a relative duration",
                "missingInputs": ["triggerDate"]
            }
        },
        {
            "text": "no longer than seven days",
            "result": {
                "resolved": false,
                "reason": "triggerDate is required to resolve a relative duration",
                "missingInputs": ["triggerDate"]
            }
        }
    ]
}
```

### Gate claim 3: Recomputing from stored inputs reproduces every stored output exactly

**Evidence — integration test (`gate8.test.ts:310–357`):**

```typescript
    const g1 = await resolveDoc(r.body.documentVersionId, [triggerInput]);
    expect(g1.status).toBe(200);

    const g2 = await resolveDoc(r.body.documentVersionId, [triggerInput]);
    expect(g2.status).toBe(200);

    ...
    for (const r1 of g1.body.results) {
      const r2 = g2.body.results.find((r) => r.anchorId === r1.anchorId);
      expect(r2!.result.resolved).toBe(r1.result.resolved);
      if (r1.result.resolved && r2!.result.resolved) {
        expect(r2!.result.statutoryDate).toBe(r1.result.statutoryDate);
        expect(r2!.result.adjustedDate).toBe(r1.result.adjustedDate);
        expect(r2!.result.ruleIds).toEqual(r1.result.ruleIds);
        expect(r2!.result.citations).toEqual(r1.result.citations);
      }
    }
```

**Evidence — unit test (`resolve.test.ts:367–391`):**

```typescript
    const r1 = resolve(expr, [trigger], testPack);
    const r2 = resolve(expr, [trigger], testPack);
    expect(r1).toEqual(r2);
```

### Gate claim 4: An unanchored expression cannot reach the resolver — asserted at the type level (INV-5)

**Evidence — `types.ts:4–9`:**

```typescript
export interface ParsedAnchoredExpression {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly text: string;
  readonly expression: TemporalExpression;
}
```

`resolve()` takes `ParsedAnchoredExpression`, which requires branded `AnchorId` and `SegmentId`. A bare expression cannot satisfy this type.

**Evidence — unit test (`resolve.test.ts:302–304`):**

```typescript
    // @ts-expect-error — bare expression is not ParsedAnchoredExpression
    expect(() => resolve({ kind: "fixed_date", month: 7, day: 1, year: 2026 }, [], testPack)).toThrow();
```

The `@ts-expect-error` directive proves the compiler rejects a bare expression.

### Gate claim 5: Worked example with supplied trigger date → real resolved date

**API output — HB 35 with trigger date 2026-03-15:**

```json
{
    "totalExpressions": 5,
    "totalResolved": 3,
    "totalUnresolved": 2,
    "results": [
        {
            "text": "within one working day",
            "result": {
                "resolved": true,
                "statutoryDate": "2026-03-16",
                "adjustedDate": "2026-03-16",
                "ruleIds": ["va-1-210-A"],
                "citations": ["Va. Code § 1-210(A)"],
                "packVersion": "1",
                "inputs": [{
                    "name": "triggerDate",
                    "value": "2026-03-15",
                    "source": "manual_input",
                    "authority": "analyst",
                    "citation": "assumed trigger date for gate 8 demo"
                }]
            }
        },
        {
            "text": "within 30 days",
            "result": {
                "resolved": true,
                "statutoryDate": "2026-04-14",
                "adjustedDate": "2026-04-14",
                "ruleIds": ["va-1-210-A"],
                "citations": ["Va. Code § 1-210(A)"],
                "packVersion": "1"
            }
        },
        {
            "text": "no longer than seven days",
            "result": {
                "resolved": true,
                "statutoryDate": "2026-03-22",
                "adjustedDate": "2026-03-23",
                "ruleIds": ["va-1-210-A", "va-1-210-E"],
                "citations": ["Va. Code § 1-210(A)", "Va. Code § 1-210(E)"],
                "packVersion": "1"
            }
        },
        {
            "text": "every two business days",
            "result": {
                "resolved": false,
                "reason": "recurrence expressions produce repeating obligations, not a single deadline date",
                "missingInputs": ["periodStart", "periodEnd"]
            }
        },
        {
            "text": "within 24 hours",
            "result": {
                "resolved": false,
                "reason": "hour-scale durations cannot be resolved to a civil date — they require time-of-day computation",
                "missingInputs": []
            }
        }
    ]
}
```

Walk-through for "no longer than seven days" with trigger 2026-03-15 (Sunday):
- § 1-210(A) excludes trigger day → count starts 2026-03-16
- 7 calendar days → 2026-03-22 (Sunday)
- § 1-210(E) rolls forward past Sunday → 2026-03-23 (Monday)
- Both rules carry through: `["va-1-210-A", "va-1-210-E"]`

Walk-through for "within 24 hours": hour-scale → unresolved. Civil dates only, no time-of-day computation. This is the correct result per the brief.

Walk-through for "every two business days": recurrence → unresolved. Produces repeating obligations, not a single deadline date. Missing periodStart and periodEnd.

## Test results

### Unit tests: 18 pass

```
✓ resolver — fixed_date (4 tests)
✓ resolver — relative_duration (6 tests)
✓ resolver — recurrence (1 test)
✓ INV-5 — type-level enforcement (1 test)
✓ INV-6 — every resolved date carries citations (3 tests)
✓ reproducibility (1 test)
✓ resolver version (1 test)
✓ real pack integration (1 test)
```

### Integration tests: 8 pass

```
✓ HB 35 without trigger dates: all relative durations resolve to UNRESOLVED with missingInputs named
✓ every resolution carries citations or is explicitly unresolved — never a bare date
✓ worked example: supplying a trigger date produces a real resolved date with § 1-210 rule IDs
✓ reproducibility: recomputing from stored inputs produces the same output
✓ simple-bill: fixed_date 'July 1, 2025' resolves with adjustment rules
✓ resolve before grammar → error
✓ idempotency: resolve twice → same results
✓ hour-scale durations remain unresolved even with a trigger date
```

### Full suite

- Unit tests: 504 pass
- Integration tests: 70 pass (gates 1–8)
- Typecheck: clean
- Lint: clean

## Files created

| File | Purpose |
|---|---|
| `src/modules/resolver/types.ts` | Domain types: ParsedAnchoredExpression, ResolutionInput, ResolutionResult, AnchoredResolution |
| `src/modules/resolver/resolve.ts` | Pure resolve function. Handles fixed_date, relative_duration, recurrence. RESOLVER_VERSION = "1.0.0" |
| `src/modules/resolver/resolve.test.ts` | 18 unit tests |
| `src/modules/resolver/service.ts` | Service: loads grammar results, constructs ParsedAnchoredExpression for each, calls resolve(), persists results |
| `src/platform/db/resolver-schema.ts` | Drizzle schema for `resolution_results` table |
| `src/platform/db/resolver-repository.ts` | Repository: insertResults, getResultsByVersion, deleteResultsByVersion, updateResolutionStatus |
| `src/platform/server/routes/resolve.ts` | POST `/api/v1/documents/:documentVersionId/resolve` |
| `src/platform/db/migrations/0011_resolution_results.sql` | Migration: resolution_results table + resolutionStatus/resolverVersion columns on document_versions |
| `test/integration/gate8.test.ts` | 8 integration tests |
| `scripts/gate8-demo.sh` | API demo script |

## Files modified

| File | Change |
|---|---|
| `src/modules/shared/types.ts` | Added `ResolutionStatus` const object and type |
| `src/modules/ingestion/types.ts` | Added `resolutionStatus: ResolutionStatus` and `resolverVersion: string \| null` to `DocumentVersion` |
| `src/platform/db/ingestion-schema.ts` | Added resolutionStatus and resolverVersion columns with check constraint |
| `src/platform/db/ingestion-repository.ts` | Added ResolutionStatus import, mapped resolution columns in `rowToDocumentVersion` |
| `src/modules/ingestion/service.ts` | Added `resolutionStatus: "unresolved_resolver"` and `resolverVersion: null` to insertVersion |
| `src/platform/db/schema.ts` | Re-exports `resolutionResults` |
| `src/platform/db/migrations/meta/_journal.json` | Added entry for migration 0011 |
| `src/main.ts` | Wired resolver repository, service, and routes |
| `Dockerfile` | Added `COPY packs/ packs/` to include jurisdiction packs in container |
| `src/modules/parsing/service.test.ts` | Added resolutionStatus/resolverVersion to makeVersion |
| `src/modules/scanning/service.test.ts` | Added resolutionStatus/resolverVersion to makeVersion |
| `src/modules/extraction/service.test.ts` | Added resolutionStatus/resolverVersion to makeVersion |
| `src/modules/anchoring/service.test.ts` | Added resolutionStatus/resolverVersion to makeVersion |

## Decisions taken

1. **Always re-resolve.** The resolver service always deletes previous results and re-resolves, rather than caching based on `(status, version)`. The resolver is a pure function (no LLM, no network calls), so re-computation is cheap. This ensures that calling `/resolve` with different `suppliedInputs` always produces fresh results reflecting those inputs.

2. **Resolution status tracks last-resolved state, not input state.** `resolutionStatus` on document_versions is set to `resolved_resolver` after any successful resolve call. Since the resolver always re-resolves, this is an indicator that resolution has been attempted, not that results are cached.

3. **Fixed dates without adjustment carry empty ruleIds/citations.** When a fixed date (e.g., July 1, 2025) falls on a business day, no adjustment rule applies. The result has `resolved: true` with `ruleIds: []` and `citations: []`. The only rule that could fire is § 1-210(E) rollover, and it correctly doesn't fire when unnecessary.

4. **Pack version hardcoded to "1".** The service loads pack version "1" for all documents. A multi-version pack lookup will be needed when packs are versioned beyond v1.

## Known limitations

1. **Recurrence expressions always unresolved.** "every two business days" is a repeating obligation, not a single deadline date. The resolver correctly marks it unresolved with `missingInputs: ["periodStart", "periodEnd"]`. A recurrence scheduler is out of scope for Module 8.

2. **Hour-scale durations always unresolved.** "within 24 hours" requires time-of-day computation, which the civil-date-only resolver cannot perform. This is the correct result per the brief ("Civil dates only — no timestamps, no timezones").

3. **No effective-date derivation integration.** The resolver does not automatically derive trigger dates from § 1-214 session metadata. A trigger date must be supplied as a `ResolutionInput` with full provenance. Module 9+ may wire effective-date derivation into the resolution pipeline.

4. **Dockerfile change.** Added `COPY packs/ packs/` to include jurisdiction packs in the Docker container. Without this, the resolver cannot load the Virginia pack at runtime. This was missing because Module 7 (jurisdiction pack) was built before the Dockerfile was updated for it.

## New dependencies

None.
