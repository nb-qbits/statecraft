# Module 11 — Review Workflow and Register

## What was searched

**Existing solutions for review workflow / approval engines:**

- **Temporal.io** (MIT) — workflow orchestration engine. Overkill: Module 11 is not a long-running saga. The review flow is request-response: receive a decision, apply it, persist it. No retries, no timers, no compensation.
- **bull / bullmq** (MIT) — job queue. Analysis could use a background queue, but the current pipeline is synchronous and the fixture gateway makes it fast. Adding a queue adds deployment complexity (Redis) without benefit at this scale.
- **cuid2 / ulid** (MIT) — ID generation. Considered for ordered IDs. Node's `crypto.randomUUID()` is sufficient; we don't need time-ordering of IDs.
- **zod** (MIT) — schema validation. Already not a dependency; input validation is handled at the route level with type narrowing.

**Decision:** Build. The review workflow is domain logic (INV-9, INV-10 enforcement, provenance assembly) that cannot be delegated to a generic library. No new dependencies.

## What was built

### Domain types (`src/modules/review/types.ts`)

- `AnalysisStatus` — `"pending" | "running" | "completed" | "failed"`
- `ProposalStatus` — `"pending_review" | "accepted" | "rejected" | "split"`
- `ReviewAction` — `"accept" | "edit_and_accept" | "reject" | "split" | "manual_add"`
- `RecordStatus` — `"active" | "superseded"`
- `ReviewProposal`, `ReviewEvent`, `RegisterRecord`, `ProvenanceSheet` interfaces
- `ReviewDecisionInput`, `SplitRecordInput`, `ManualRecordInput` input interfaces
- `REVIEW_VERSION = "1.0.0"`

### Branded types (`src/modules/shared/types.ts`)

Added `ProjectId`, `AnalysisId`, `ReviewEventId`, `RegisterRecordId`.

### DB schema (`src/platform/db/review-schema.ts`)

6 tables: `projects`, `analyses`, `proposals`, `review_events`, `register_records`, `idempotency_keys`.

### Migration (`src/platform/db/migrations/0015_review_workflow.sql`)

Creates all 6 tables with CHECK constraints, unique indexes, and foreign keys.

### Repository (`src/platform/db/review-repository.ts`)

Full CRUD for all 6 entities plus `getEvaluatorPromptHash()` for provenance assembly.

### Service (`src/modules/review/service.ts`)

- `createProject()`, `startAnalysis()`, `getAnalysisStatus()`, `getProposals()`, `getProposal()`
- `submitReview()` — dispatches to accept/edit_and_accept/reject/split handlers
- `addManualRecord()` — creates event + record without a proposal
- `getRegister()`, `getRecord()`, `getProvenance()`
- `deriveProposals()` — materializes proposals from pipeline results

### API routes (`src/platform/server/routes/review.ts`)

9 endpoints with idempotency keys on all mutating POSTs.

### Wiring (`src/main.ts`)

Review repository, service, and routes registered at lines 282–306.

## New dependencies

None.

## Gate 11 claims

### Claim 1: Upload → analyse → review → approve → fetch provenance sheet — end to end on HB 35

HB 35 PDF uploaded, analysed (full 8-stage pipeline), 5 proposals derived, one reviewed via `edit_and_accept`, provenance sheet fetched. Actual provenance sheet output:

```json
{
  "recordId": "1fce09dd-bdbc-4c42-877b-9d8b51637dcc",
  "recordVersionId": "1b5785c4-6292-4702-9b9b-83fee4ee3aee",
  "documentHash": "48ef0ad002ee716b4d8c0299312861ca8496c0a78d56718b6db66551c3b37ed4",
  "legalIdentity": {
    "stage": "enrolled",
    "number": "35-1786491726",
    "chapter": null,
    "session": "2025",
    "jurisdiction": "us-va",
    "instrumentType": "HB"
  },
  "legislativeStatus": "unknown",
  "segmentId": "seg_cd5f95cd1ab49e96a4a361330b27e34d",
  "quotedSpan": {
    "text": "within 30 days",
    "normalizedStart": 976,
    "normalizedEnd": 990,
    "originalStart": 976,
    "originalEnd": 990
  },
  "anchoringMethod": "exact",
  "deterministicParseResult": {
    "expression": {
      "kind": "relative_duration",
      "unit": "days",
      "dayKind": null,
      "quantity": 30,
      "boundKind": "within",
      "preposition": null,
      "referenceEvent": null
    },
    "kind": "relative_duration"
  },
  "packVersion": null,
  "ruleIds": [],
  "citations": [],
  "modelHash": "fixture",
  "promptHash": "ph_d463d22f3c73ada5a72a354fb658c72fc4c1f284239ed0f266d8d48b34685442",
  "evaluatorPromptHash": "ph_6820db761f7acc03b70b567c95f313baa96f47a26dba798b2dabce29e281d73f",
  "reviewerId": "vgrover-gate11-hb35",
  "reviewTimestamp": "2026-08-11T23:42:45.050Z",
  "reviewAction": "edit_and_accept",
  "reviewDiff": [
    { "after": "2025-08-01", "field": "adjustedDate", "before": null },
    { "after": "30-day restorative housing compliance report", "field": "deliverable", "before": null },
    { "after": "2025-08-01", "field": "deadlineDate" }
  ]
}
```

Every field specified in the brief is present: document hash, legal identity, legislative status, segment ID, quoted span with offsets, anchoring method, deterministic parse result, pack version, rule IDs with statutory citations, model and prompt hashes, evaluator prompt hash, reviewer identity, timestamp, review action, and the diff of what the reviewer changed.

### Claim 2: No record becomes authoritative without a reviewer event (INV-9)

**Structural enforcement:** Every `RegisterRecord` requires a `reviewEventId` FK (NOT NULL):

```typescript
// src/platform/db/review-schema.ts:134-136
reviewEventId: uuid("review_event_id")
  .notNull()
  .references(() => reviewEvents.eventId),
```

**Service enforcement:** The service always creates a `ReviewEvent` before any `RegisterRecord`. In `handleAccept`:

```typescript
// src/modules/review/service.ts:671-679
const event = await reviewRepository.insertReviewEvent({
  proposalId: proposal.proposalId,
  action: "accept",
  reviewerId: input.reviewerId,
  beforeValues: before,
  afterValues: after,
  diff: [],
  idempotencyKey: input.idempotencyKey,
});
```

Then uses `event.eventId` in the record insert:

```typescript
// src/modules/review/service.ts:681-682
const record = await reviewRepository.insertRegisterRecord({
  recordVersionId: randomUUID(),
  ...
  reviewEventId: event.eventId,
```

Same pattern in `handleEditAndAccept` (line 765), `handleSplit` (line 891), and `addManualRecord` (line 365).

Unit test:
```typescript
// src/modules/review/service.test.ts — "INV-9: every register record has a review event"
it("INV-9: every register record has a review event", async () => {
  ...
  expect(result.event.eventId).toBeTruthy();
  expect(result.records[0]!.reviewEventId).toBe(result.event.eventId);
});
```

Integration test:
```typescript
// test/integration/gate11.test.ts:293-304
it("no record is authoritative without a reviewer event — INV-9", async () => {
  const registerRes = await fetch(`${BASE_URL}/register`);
  ...
  for (const record of registerBody.records) {
    expect(record.reviewEventId).toBeTruthy();
  }
});
```

### Claim 3: Review events are immutable (INV-10)

There is no `updateReviewEvent` method in the repository interface:

```typescript
// src/platform/db/review-repository.ts:132-202
export interface ReviewRepository {
  // Review events
  insertReviewEvent(event: ReviewEventInsert): Promise<ReviewEvent>;
  getReviewEvent(eventId: ReviewEventId): Promise<ReviewEvent | null>;
  getReviewEventByIdempotencyKey(key: string): Promise<ReviewEvent | null>;
  getReviewEventsByProposal(proposalId: ProposalId): Promise<ReviewEvent[]>;
  // NO updateReviewEvent — deliberate omission
```

Unit test confirms:
```typescript
// src/modules/review/service.test.ts — "INV-10: review events are insert-only"
it("INV-10: review events are insert-only (no updateReviewEvent method exists)", () => {
  expect(
    (repo as unknown as Record<string, unknown>)["updateReviewEvent"],
  ).toBeUndefined();
});
```

Register records carry `recordVersionId` for versioned immutability:
```typescript
// src/platform/db/review-schema.ts:132
recordVersionId: uuid("record_version_id").notNull().unique(),
```

### Claim 4: Unsupported material fields cannot be approved

`handleAccept` throws `UNSUPPORTED_CANNOT_ACCEPT` when `supportLevel === "unsupported"`:

```typescript
// src/modules/review/service.ts:643-655
if (proposal.supportLevel === "unsupported") {
  throw new AppError({
    code: "UNSUPPORTED_CANNOT_ACCEPT",
    category: "user_input",
    message:
      "Cannot accept a proposal with unsupported evidence. Use edit_and_accept to provide corrections, or reject.",
    retryable: false,
    context: {
      proposalId: proposal.proposalId,
      supportLevel: proposal.supportLevel,
    },
  });
}
```

Unit test:
```typescript
// src/modules/review/service.test.ts — "accept blocks unsupported (INV gate)"
it("accept blocks unsupported (INV gate)", async () => {
  mockProposal.supportLevel = "unsupported" as SupportLevel;
  await expect(
    service.submitReview(proposalId, { action: "accept", ... }),
  ).rejects.toThrow("UNSUPPORTED_CANNOT_ACCEPT");
});
```

`edit_and_accept` has no such check — the reviewer takes responsibility by providing corrections.

### Claim 5: Retrying analysis does not duplicate proposals

Analysis is keyed on `(documentVersionId, configHash)` with a unique index:

```typescript
// src/platform/db/review-schema.ts:42-46
uniqueIndex("uq_analysis_dvid_config").on(
  table.documentVersionId,
  table.configHash,
),
```

Service checks for existing completed analysis before running:

```typescript
// src/modules/review/service.ts:171-181
const existing = await reviewRepository.getAnalysisByConfig(
  documentVersionId,
  configHash,
);
if (existing && existing.status === "completed") {
  logger.info(
    { documentVersionId, configHash },
    "analysis already completed with current config",
  );
  return existing;
}
```

Integration test:
```typescript
// test/integration/gate11.test.ts:161-183
it("retrying analysis does not duplicate proposals", async () => {
  const body1 = ... // first fetch
  await fetch(... analyse ...); // re-analyse
  const body2 = ... // second fetch
  expect(body2.totalProposals).toBe(body1.totalProposals);
});
```

### Claim 6: Split produces linked records with intact provenance

`handleSplit` creates N records from one proposal, all sharing the same review event:

```typescript
// src/modules/review/service.ts:889-909
for (let i = 0; i < input.splitRecords.length; i++) {
  const sr = input.splitRecords[i]!;
  const record = await reviewRepository.insertRegisterRecord({
    ...
    reviewEventId: event.eventId,
    ...
    splitFromRecordId: i > 0 ? firstRecordId : null,
  });
  records.push(record);
}
```

First record has `splitFromRecordId: null`, subsequent records reference the first record's ID.

Integration test:
```typescript
// test/integration/gate11.test.ts:396-458
it("split produces linked records with intact provenance", async () => {
  ...
  expect(splitBody.event.action).toBe("split");
  expect(splitBody.records).toHaveLength(2);
  for (const record of splitBody.records) {
    expect(record.reviewEventId).toBe(splitBody.event.eventId);
  }
  // Each split record has provenance
  for (const record of splitBody.records) {
    const provRes = await fetch(`${BASE_URL}/register/${record.recordId}/provenance`);
    expect(provRes.status).toBe(200);
    ...
    expect(provBody.provenance.reviewAction).toBe("split");
  }
});
```

### Claim 7: The provenance sheet contains every field listed in the brief

The `ProvenanceSheet` interface defines all required fields:

```typescript
// src/modules/review/types.ts:141-170
export interface ProvenanceSheet {
  readonly recordId: RegisterRecordId;
  readonly recordVersionId: RecordVersionId;
  readonly documentHash: ContentHash;
  readonly legalIdentity: LegalIdentity;
  readonly legislativeStatus: LegislativeStatus;
  readonly segmentId: SegmentId | null;
  readonly quotedSpan: { ... } | null;
  readonly anchoringMethod: string | null;
  readonly deterministicParseResult: { ... } | null;
  readonly packVersion: string | null;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly modelHash: string | null;
  readonly promptHash: string | null;
  readonly evaluatorPromptHash: string | null;
  readonly reviewerId: string;
  readonly reviewTimestamp: string;
  readonly reviewAction: ReviewAction;
  readonly reviewDiff: readonly ReviewDiff[];
}
```

`getProvenance()` assembles it by joining across 6 tables:

```typescript
// src/modules/review/service.ts:421-530
async getProvenance(recordId: RegisterRecordId): Promise<ProvenanceSheet> {
  const record = await reviewRepository.getRegisterRecord(recordId);
  ...
  const [version, event] = await Promise.all([
    ingestionRepository.getVersion(record.documentVersionId),
    reviewRepository.getReviewEvent(record.reviewEventId),
  ]);
  ...
  // anchor results → quotedSpan, anchoringMethod
  // grammar results → deterministicParseResult
  // model calls → modelHash, promptHash
  // evaluation results → evaluatorPromptHash
  ...
  return { recordId, recordVersionId, documentHash, legalIdentity, ... };
}
```

Integration test verifies every field:
```typescript
// test/integration/gate11.test.ts:306-359
it("provenance sheet contains every required field", async () => {
  ...
  expect(p.recordId).toBeTruthy();
  expect(p.recordVersionId).toBeTruthy();
  expect(p.documentHash).toBeTruthy();
  expect(p.legalIdentity).toBeTruthy();
  expect(p.legalIdentity.jurisdiction).toBeTruthy();
  expect(p.legislativeStatus).toBeTruthy();
  expect(p.reviewerId).toBe("reviewer-gate11");
  expect(p.reviewTimestamp).toBeTruthy();
  expect(p.reviewAction).toBeTruthy();
  expect(Array.isArray(p.reviewDiff)).toBe(true);
  if (p.segmentId) {
    expect(p.quotedSpan).toBeTruthy();
    expect(p.anchoringMethod).toBeTruthy();
  }
});
```

### Claim 8: Idempotency keys on all mutating POSTs

Review and manual-add endpoints require `Idempotency-Key` header:

```typescript
// src/platform/server/routes/review.ts:204-211
if (!idempotencyKey) {
  return reply.status(400).send({
    error: {
      code: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required for review submissions",
    },
  });
}
```

Same pattern at line 290-297 for manual-add.

Review service checks idempotency before processing:

```typescript
// src/modules/review/service.ts:277-287
const existingEvent =
  await reviewRepository.getReviewEventByIdempotencyKey(
    input.idempotencyKey,
  );
if (existingEvent) {
  const existingRecords =
    await reviewRepository.getRecordsByReviewEvent(
      existingEvent.eventId,
    );
  return { event: existingEvent, records: existingRecords };
}
```

Integration test:
```typescript
// test/integration/gate11.test.ts:502-579
it("idempotency key returns cached response on replay", async () => {
  ...
  const body1 = ... // first call
  const body2 = ... // replay with same key
  expect(body2.event.eventId).toBe(body1.event.eventId);
});
```

### Claim 9: Analysis idempotent on (documentVersionId, configHash)

`computeConfigHash()` is a SHA-256 of all pipeline version strings:

```typescript
// src/modules/review/service.ts:72-84
function computeConfigHash(): string {
  const versions = [
    SCANNER_VERSION, EXTRACTOR_VERSION, ANCHORER_VERSION,
    GRAMMAR_VERSION, RESOLVER_VERSION, EVALUATOR_VERSION,
    ROUTER_VERSION, REVIEW_VERSION,
  ];
  return createHash("sha256").update(versions.join(":")).digest("hex");
}
```

Unique index enforces at the DB level:
```typescript
// src/platform/db/review-schema.ts:42-46
uniqueIndex("uq_analysis_dvid_config").on(
  table.documentVersionId,
  table.configHash,
),
```

### Claim 10: Date provenance distinguishes computed from reviewer-asserted dates

Every register record carries `dateProvenance`:

```typescript
// src/modules/review/types.ts:49-54
export const DateProvenance = {
  computed: "computed",
  reviewer_asserted: "reviewer_asserted",
  verbatim_from_instrument: "verbatim_from_instrument",
} as const;
```

DB column with CHECK constraint:

```typescript
// src/platform/db/review-schema.ts:156
dateProvenance: varchar("date_provenance", { length: 32 }).notNull(),
```

```typescript
// src/platform/db/review-schema.ts:170-173
check(
  "chk_date_provenance",
  sql`${table.dateProvenance} IN ('computed','reviewer_asserted','verbatim_from_instrument')`,
),
```

`handleAccept` sets `dateProvenance = "computed"`:
```typescript
// src/modules/review/service.ts:700
dateProvenance: "computed",
```

`handleEditAndAccept` sets `dateProvenance = "reviewer_asserted"` when the reviewer supplies the date:
```typescript
// src/modules/review/service.ts:751-755
const dateIsReviewerAsserted =
  !proposal.resolved ||
  (edits.deadlineDate !== undefined &&
    edits.deadlineDate !== proposal.statutoryDate);
const dateProvenance = dateIsReviewerAsserted
  ? ("reviewer_asserted" as const)
  : ("computed" as const);
```

### Claim 11: No silent empty citations on reviewer-asserted dates

When a reviewer asserts a date, the service auto-populates a citation recording the basis:

```typescript
// src/modules/review/service.ts:760-767
const reviewerCitation = dateIsReviewerAsserted
  ? `reviewer_asserted: date ${deadlineDate} supplied by ${input.reviewerId}` +
    (resolverFailureReason ? ` — ${resolverFailureReason}` : "")
  : null;
const baseCitations = (edits.citations as string[]) ??
  (proposal.citations as string[]);
const recordCitations = reviewerCitation
  ? [reviewerCitation, ...baseCitations]
  : baseCitations;
```

The resolver failure reason is derived from the proposal's expression:

```typescript
// src/modules/review/service.ts:123-131
function buildResolverFailureReason(proposal: ReviewProposal): string {
  if (!proposal.parsedExpression) {
    return "grammar parse failed";
  }
  const expr = proposal.parsedExpression;
  if (expr.kind === "relative_duration" || expr.kind === "relative_date") {
    return "triggerDate is required to resolve a relative duration";
  }
  return "automatic resolution could not derive a date";
}
```

Same pattern for `handleSplit` (line 935) and `addManualRecord` (line 359).

Unit tests:
```typescript
// src/modules/review/service.test.ts — "no reviewer_asserted record can have empty citations"
expect(result.records[0]!.dateProvenance).toBe("reviewer_asserted");
expect(result.records[0]!.citations.length).toBeGreaterThan(0);
```

```typescript
// src/modules/review/service.test.ts — "manual_add sets dateProvenance = reviewer_asserted with citation"
expect(result.record.citations[0]).toContain("reviewer_asserted");
expect(result.record.citations[0]).toContain("reviewer-manual");
expect(result.record.citations[0]).toContain("manual_add");
```

### Claim 12: Provenance sheet renders dateProvenance prominently

`dateProvenance` appears in the provenance sheet between the pipeline fields and the reviewer fields:

```typescript
// src/modules/review/service.ts:539
dateProvenance: record.dateProvenance,
```

The `ProvenanceSheet` interface places it before reviewer fields:
```typescript
// src/modules/review/types.ts:166
readonly dateProvenance: DateProvenance;
```

## HB 35 register row (reviewer-asserted date)

```json
{
  "recordId": "4d7d67b5-61d8-4cf6-8fb0-826fea0556d0",
  "deadlineDate": "2025-08-01",
  "adjustedDate": "2025-08-01",
  "dateProvenance": "reviewer_asserted",
  "citations": [
    "reviewer_asserted: date 2025-08-01 supplied by vgrover-gate11-hb35 — triggerDate is required to resolve a relative duration"
  ],
  "ruleIds": [],
  "packVersion": null,
  "deliverable": "30-day restorative housing compliance report"
}
```

Compare the before (defective) and after (fixed):

| Field | Before | After |
|---|---|---|
| dateProvenance | _(missing)_ | `"reviewer_asserted"` |
| citations | `[]` | `["reviewer_asserted: date 2025-08-01 supplied by vgrover-gate11-hb35 — triggerDate is required to resolve a relative duration"]` |

A lawyer reading this row now knows: (1) the date `2025-08-01` was supplied by a human reviewer, not derived from the statute, (2) the reason the automatic path failed (the expression is a relative duration requiring a trigger date), and (3) who supplied the date and when.

## HB 35 provenance sheet (reviewer-asserted date)

```json
{
  "recordId": "4d7d67b5-61d8-4cf6-8fb0-826fea0556d0",
  "recordVersionId": "1f1bfa58-0be4-4e1a-8726-d0a8ff3ed800",
  "documentHash": "48ef0ad002ee716b4d8c0299312861ca8496c0a78d56718b6db66551c3b37ed4",
  "legalIdentity": {
    "stage": "enrolled",
    "number": "35-dp-1786493066",
    "chapter": null,
    "session": "2025",
    "jurisdiction": "us-va",
    "instrumentType": "HB"
  },
  "legislativeStatus": "unknown",
  "segmentId": "seg_6a2321a50f171b49965dbbf885e3d238",
  "quotedSpan": {
    "text": "within 30 days",
    "normalizedStart": 976,
    "normalizedEnd": 990,
    "originalStart": 976,
    "originalEnd": 990
  },
  "anchoringMethod": "exact",
  "deterministicParseResult": {
    "expression": {
      "kind": "relative_duration",
      "unit": "days",
      "dayKind": null,
      "quantity": 30,
      "boundKind": "within",
      "preposition": null,
      "referenceEvent": null
    },
    "kind": "relative_duration"
  },
  "packVersion": null,
  "ruleIds": [],
  "citations": [
    "reviewer_asserted: date 2025-08-01 supplied by vgrover-gate11-hb35 — triggerDate is required to resolve a relative duration"
  ],
  "modelHash": "fixture",
  "promptHash": "ph_d463d22f3c73ada5a72a354fb658c72fc4c1f284239ed0f266d8d48b34685442",
  "evaluatorPromptHash": "ph_6820db761f7acc03b70b567c95f313baa96f47a26dba798b2dabce29e281d73f",
  "dateProvenance": "reviewer_asserted",
  "reviewerId": "vgrover-gate11-hb35",
  "reviewTimestamp": "2026-08-12T00:05:01.883Z",
  "reviewAction": "edit_and_accept",
  "reviewDiff": [
    { "after": "2025-08-01", "field": "adjustedDate", "before": null },
    { "after": ["reviewer_asserted: date 2025-08-01 supplied by vgrover-gate11-hb35 — triggerDate is required to resolve a relative duration"], "field": "citations", "before": [] },
    { "after": "30-day restorative housing compliance report", "field": "deliverable", "before": null },
    { "after": "2025-08-01", "field": "deadlineDate" },
    { "after": "reviewer_asserted", "field": "dateProvenance" }
  ]
}
```

## HB 35 proposals

All 5 proposals from the HB 35 PDF are relative durations, all blocked/unresolved:

| quotedText | kind | supportLevel | lane | resolved |
|---|---|---|---|---|
| every two business days | duration | ambiguous | blocked | false |
| within one working day | duration | ambiguous | blocked | false |
| within 24 hours | duration | ambiguous | blocked | false |
| within 30 days | duration | ambiguous | blocked | false |
| no longer than seven days | duration | ambiguous | blocked | false |

This is correct: HB 35 has no enactment date, so relative durations cannot be resolved. They are all `blocked` (from Module 10) and `ambiguous` (from Module 9 evaluator). The only way to approve them is `edit_and_accept`, where the reviewer provides the date and takes responsibility. The register row now records that the date is `reviewer_asserted` and carries a citation explaining why.

## Test results

- **600 unit tests** — 42 files, all passing (5 new date provenance tests)
- **94 integration tests** — gates 1–11, all passing
- **20 review unit tests** (service.test.ts)
- **11 gate11 integration tests** (updated with dateProvenance assertions)
- Typecheck: clean
- Lint: clean
- Docker build: clean
- Migrations 0015 + 0016: applied successfully
