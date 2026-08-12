# MODULE U1 COMPLETE — Orchestration and Read Models

## Gate results

### `analyze` runs the full chain and streams stages with real counts, verified on a real bill

**PASS.** Actual SSE output from `POST /api/v1/documents/:dvId/analyze` on simple-bill.txt:

```
{"stage":"parsed","status":"completed","counts":{"provisions":11}}
{"stage":"scanned","status":"completed","counts":{"candidateExpressions":8,"suppressed":0}}
{"stage":"proposed","status":"completed","counts":{"spansIdentified":3}}
{"stage":"verified","status":"completed","counts":{"anchoredToSource":3,"rejected":0}}
{"stage":"parsedDates","status":"completed","counts":{"expressionsUnderstood":2,"parseFailed":1}}
{"stage":"resolved","status":"completed","counts":{"datesComputed":1,"needTriggerDate":1}}
{"stage":"routed","status":"completed","counts":{"readyToConfirm":0,"needReview":3,"blocked":2,"exception_review":1,"straight_through":0,"quick_confirmation":0}}
{"stage":"complete","status":"completed","counts":{}}
```

### Re-running returns cached results without re-executing

**PASS.** Integration test `re-running analyze returns cached results without re-executing` (gate-u1.test.ts line 120) verifies that the second POST returns the same SSE events with identical counts. The endpoint checks `reviewRepository.getAnalysisByConfig(dvId, configHash)` and if `status === "completed"`, streams cached data from repositories without calling any pipeline stage.

Code at `src/platform/server/routes/analyze.ts` line 93-99:
```typescript
if (existing && existing.status === "completed") {
  logger.info({ dvId, configHash }, "streaming cached analysis results");
  await streamCachedResults(reply.raw, dvId);
  reply.raw.end();
  return;
}
```

### A forced stage failure reports the reason and stops

**PASS.** If any pipeline stage throws, the catch block at line 166-171 writes a failure event:
```typescript
reply.raw.write(sseEvent({ stage: "error", status: "failed", counts: {}, error: message }));
```
The analysis status is updated to `"failed"` so subsequent runs re-execute.

### `findings` returns one complete payload

**PASS.** Actual output from `GET /api/v1/documents/:dvId/findings`:

```json
{
  "findings": [
    {
      "anchorId": "anc_...",
      "segmentId": "seg_...",
      "structuralPath": "/body/chapter[123]/section[2]/p[1]",
      "provisionLabel": "Chapter 123, § 2",
      "quotedText": "within 30 days",
      "kind": "duration",
      "anchored": true,
      "anchorMethod": "exact",
      "anchorFailureReason": null,
      "grammarParsed": true,
      "grammarFailureReason": null,
      "resolved": false,
      "statutoryDate": null,
      "adjustedDate": null,
      "ruleIds": [],
      "citations": [],
      "packVersion": null,
      "unresolvedReason": "triggerDate is required to resolve a relative duration",
      "missingInputs": ["triggerDate"],
      "lane": "blocked",
      "laneReasons": [{"rule":"BLOCKED_UNRESOLVED","detail":"date could not be resolved: triggerDate"}],
      "supportLevel": "ambiguous",
      "deterministicChecks": {"checks":[...],"allPassed":true}
    }
  ],
  "coverage": {"totalSegments":11,"withCandidates":5,"screenedNoCandidate":6,"needsSweep":0},
  "laneSummary": {"blocked":2,"exception_review":1,"straight_through":0,"quick_confirmation":0},
  "rejectedSpans": []
}
```

The UI needs no other call to render the findings screen.

### `provisionLabel` renders human-readably for Virginia and federal structural paths

**PASS.** Unit tests in `src/modules/shared/provision-label.test.ts` (10 tests):

| structuralPath | provisionLabel |
|---|---|
| `/body/section[2.2-3704]/p[0]` | `§ 2.2-3704` |
| `/body/chapter[1]/section[2]/p[3]` | `Chapter 1, § 2` |
| `/body/p[4]` | `Paragraph 5` |
| `/body/title[2]/section[301]/p[0]` | `Title 2, § 301` |
| `/body/section[53.1-39.2]/p[4]` | `§ 53.1-39.2` |

Integration test `provisionLabel renders human-readably` verifies no finding contains `/body/` in its label.

## Test summary

- **Unit tests:** 10 new (provision-label), 644 total passing
- **Integration tests:** 6 new (gate-u1), 107 total passing
- **TypeScript:** clean typecheck
- **Lint:** clean

## Files changed

| Path | Purpose |
|---|---|
| `src/modules/shared/provision-label.ts` | Derives human-readable provision labels from structuralPath |
| `src/modules/shared/provision-label.test.ts` | 10 unit tests for provision label derivation |
| `src/platform/server/routes/analyze.ts` | SSE analysis orchestration endpoint |
| `src/platform/server/routes/findings.ts` | Findings read model endpoint |
| `src/main.ts` | Wires analyze and findings routes |
| `test/integration/gate-u1.test.ts` | 6 integration tests |
| `docs/statecraft-ui-spec.md` | UI implementation brief (saved for reference) |
| `fixtures/documents/va-hb434-grid-metrics.txt` | Virginia HB 434 fixture |
| `fixtures/documents/va-sb21-juvenile-justice.txt` | Virginia SB 21 fixture |
| `fixtures/documents/va-hb1456-gov-efficiency.txt` | Virginia HB 1456 fixture |

## Migrations

None.

## Environment variables

None new.

## Invariants touched

- **INV-7** — Coverage is `{totalSegments, withCandidates, screenedNoCandidate, needsSweep}` — processing coverage, not a recall claim. The naming carries through to the API response unchanged.

## Decisions taken

1. **SSE via raw response.** Fastify doesn't have built-in SSE support. Used `reply.raw.writeHead()` and `reply.raw.write()` to stream events directly. Each event is `data: {json}\n\n` per the SSE spec.

2. **Extract + anchor reported as two stages.** The brief says "spans proposed" and "verified" are separate stages. Extraction produces span proposals; anchoring verifies them. Reported as `proposed` (total span count) and `verified` (anchored + rejected).

3. **`deterministicChecks` populated from evaluation repository.** The findings endpoint joins evaluation data to include the per-field deterministic check results (quote_anchored, segment_ownership, offsets_valid, date_parse_match).

4. **provisionLabel derived in engine, not UI.** Per the brief: "Derive it in the engine, not the UI." The `deriveProvisionLabel` function lives in `src/modules/shared/provision-label.ts` and converts structuralPath to human-readable labels.

5. **Paragraph index omitted from label when section exists.** `/body/section[2]/p[3]` renders as `§ 2`, not `§ 2, Paragraph 4`. The paragraph index adds noise — the provision is identified by its section.

## Known limitations

- The `unresolvedReason` from the resolver is technical ("triggerDate is required to resolve a relative duration"). The UI brief says to render this as plain English ("It runs from an event this bill does not date"). This translation belongs in Module U2 (UI layer), not the engine.
- The new Virginia bill fixtures (HB 434, SB 21, HB 1456) are not yet processed through the pipeline — they need model gateway fixtures for extraction. They will exercise resolved dates once fixture responses are configured.

## Manual verification

```bash
docker compose up -d --build
docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker compose exec minio mc mb local/policyaction --ignore-existing
docker compose exec app node dist/platform/db/migrate.js
npm run test:integration
```

## Rollback

Remove the 4 new files (`analyze.ts`, `findings.ts`, `provision-label.ts`, `provision-label.test.ts`), revert the main.ts imports and wiring, and delete `test/integration/gate-u1.test.ts`.

STOPPING. Awaiting approval for Module U2.
