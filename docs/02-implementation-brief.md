# PolicyAction — Claude Code Implementation Prompt

## Vertical slice: document upload to verified deadline register

Paste this document into Claude Code as the standing brief. It governs every module. Re-read it at the start of each module.

---

## 0. Operating mode

You are implementing a production-grade vertical slice. You have auto-approval for actions **within** the current module. You do not have approval to cross a module boundary.

**How you work:**

- Implement one module at a time, in the numbered order in §6.
- Within a module, proceed without asking permission. Write code, write tests, run them, fix failures, iterate.
- At the end of each module, run the gate checks, produce the module report (§7), and **STOP**. Do not begin the next module.
- If a gate fails and you cannot fix it, stop and report the failure. Do not proceed to the next module with a failing gate.

**Hard prohibitions. These are not style preferences — violating any of them invalidates the work:**

1. **Never weaken a test, delete an assertion, mark a test skipped, or loosen a threshold to obtain green output.** If a test fails and the code is right, the test may be wrong — say so explicitly in the report and explain the reasoning. Never make the change silently.
2. **Never implement anything listed in §5 (out of scope).** If a module seems to require it, stop and report the conflict.
3. **Never write a fallback path that produces a value when verification fails.** Failure produces an explicit failure state, never a guess. This is the core safety property of the system.
4. **Never introduce a dependency on a specific cloud provider's SDK.** See §3.
5. **Never store secrets, credentials, or connection strings in the repository.**
6. **Never let an LLM produce a date, a computed value, or an approval.** See §4.

**When you encounter ambiguity:** choose the more conservative option (the one that produces fewer authoritative outputs), implement it, and flag the decision in the module report under "Decisions taken." Do not stall waiting for input.

---

## 1. What this system does

A user uploads a legislative document. The system extracts obligations with deadlines, proves each one against quoted source text, computes dates using cited legal rules, and presents them for human review. Approved records form a deadline register where every field traces to immutable evidence, a deterministic calculation, and a human decision.

The product claim is: **every date can be traced to a quoted span of source text and a cited rule of law, and the system refuses to produce a date it cannot prove.**

The first slice handles Virginia legislative documents, explicit fixed dates, and dates relative to the act's effective date. Narrow scope, full depth — build all layers for this narrow case rather than building the early layers broadly.

---

## 2. Non-negotiable domain invariants

These are enforced in code and asserted in tests. Every module that touches them must have tests proving them.

**INV-1 — The model never emits a value.**
The LLM returns `{segmentId, quotedText, kind}`. It does not return dates, normalized values, or computed anything. The extraction output schema must make values structurally unrepresentable — there is no field for them.

**INV-2 — Anchoring is deterministic and fails closed.**
Deterministic code locates `quotedText` within the referenced segment. Normalize both sides, attempt exact match, then bounded fuzzy match (flagged). If anchoring fails, the field is `unsupported`. There is no fallback that accepts unanchored text.

**INV-3 — Anchoring proves existence, not support.**
A successfully anchored quote proves the text exists and was quoted accurately. It does **not** prove the text supports the claim. Wrong-span selection is a real failure mode. Never name a variable, function, comment, or log message in a way that implies anchoring establishes semantic support.

**INV-4 — The support evaluator may reject, never approve.**
Deterministic checks are the only path to `supported`. The LLM support evaluator may downgrade a field to `ambiguous` or `unsupported`. It can never upgrade any field to `supported`. Enforce this in the type system if possible; assert it in tests regardless.

**INV-5 — Dates come only from anchored spans.**
The resolver's input is a substring extracted from a verified anchor, parsed by the date grammar. No model-authored string reaches the resolver. Assert this at the resolver boundary.

**INV-6 — Every resolved date carries its legal basis.**
The resolver returns `{statutoryDate, adjustedDate, ruleIds[], citations[], packVersion}`. Never a bare date. A resolution without citations is a bug.

**INV-7 — Screening does not certify.**
A deterministic rule that finds no candidate in a segment produces `screened_no_candidate`. It never produces "certified no obligation." Coverage displayed to users is **processing coverage** and must be labeled distinctly from measured recall.

**INV-8 — Hypothetical dates cannot be published.**
A document with `legislativeStatus` other than `enacted` produces deadlines marked hypothetical. These are structurally blocked from the authoritative register. Enforce at the type level and at the persistence boundary.

**INV-9 — Nothing becomes authoritative without a human decision.**
Straight-through processing is implemented but disabled. Every record requires a reviewer event in this slice.

**INV-10 — Immutability.**
Proposals, reviews, resolutions, and approved record versions are never updated in place. New versions only.

---

## 3. Container and portability requirements

The system must run identically on a laptop, a single VM, ECS, GKE, or bare-metal Kubernetes. No managed-service lock-in.

**Required from module 0:**

- Multi-stage `Dockerfile` producing a minimal runtime image. Non-root user. No build tooling in the final layer.
- `docker-compose.yml` bringing up the full local stack: app, Postgres, MinIO (S3-compatible), and the Python parser sidecar. `docker compose up` must produce a working system with no host dependencies beyond Docker.
- **All configuration via environment variables.** Validate the entire environment at startup with a schema; fail fast and loudly on missing or malformed config. No config files baked into images.
- **Object storage through an S3-compatible API only** (`@aws-sdk/client-s3` pointed at a configurable endpoint is acceptable; MinIO locally, any provider in production). No provider-specific services.
- **No local filesystem state.** Containers are ephemeral. Temp files are permitted within a request lifecycle only.
- **Structured JSON logs to stdout.** No log files, no log shipping agents.
- `/health` (process alive) and `/ready` (dependencies reachable) endpoints, separate and distinct.
- **Database migrations run as a separate command**, not on application boot. Kubernetes runs them as an init job.
- Graceful shutdown on `SIGTERM`: stop accepting work, drain in-flight jobs, exit.
- Pin the Node version in `.nvmrc` and the Dockerfile. Pin the Python version in the sidecar.
- The Python sidecar communicates over HTTP with a versioned contract. It is independently deployable and independently scalable.

**Background jobs:** implement behind an interface with a Postgres-backed durable queue as the default implementation. Do not adopt a hosted orchestration vendor in this slice — that is a later bake-off decision, and a Postgres queue is sufficient for a single-user slice and is portable everywhere.

---

## 4. Where the LLM is and is not

The LLM appears in exactly two places in this slice:

**Span proposal.** Input: a segment and its deterministic candidates. Output: `{segmentId, quotedText, kind}[]`. Nothing else.

**Support evaluation.** Input: a claim and its anchored evidence. Output: a rejection or a downgrade. Never an approval (INV-4).

Everything else is deterministic code: candidate scanning, anchoring, date parsing, effective-date derivation, date arithmetic, lane routing, coverage accounting, deduplication.

**Model gateway.** All LLM calls go through a `ModelGateway` interface. Provider selection is configuration. The gateway records model identifier, prompt hash, full request and response, token counts, latency, and a correlation ID for every call. Build a `FixtureModelGateway` that replays recorded responses — all tests except a small marked set of live-provider contract tests must run without network access.

---

## 5. Out of scope for this slice

Do not build these. If a module appears to require one, stop and report.

- Amendatory diff handling (struck and inserted text detection). Parse it, store the raw formatting signal if available, but do not act on it.
- PDF ingestion. Text and DOCX only in this slice.
- Recurrence, windows, conditional activation, cross-references.
- Business-day arithmetic beyond the § 1-210(E) rollover rule.
- Multiple documents per project; supersession; monitoring.
- Calendar sync, exports, external API, billing, organizations, seats.
- Straight-through auto-approval enabled. The lane router is built; the automatic path is disabled by configuration.
- Merge operation in review. Accept, edit, reject, split, and manual-add only.
- Entity resolution and canonical entity IDs. Actor and recipient are normalized text in this slice.
- Confidence scores. Do not add a confidence field.

---

## 6. Modules

Implement in this order. Each has a gate. Stop after each.

### Module 0 — Foundation

TypeScript monorepo-ready structure. `src/modules/` for domain, `src/platform/` for adapters. Lint rule forbidding framework imports inside `src/modules/`.

Dockerfile, docker-compose (app, Postgres, MinIO, Python sidecar stub), environment schema validation, structured logging, correlation ID propagation, health and readiness endpoints, graceful shutdown.

Postgres with a migration tool. Migration command separate from boot.

Domain types and a typed error taxonomy. Every error carries a stable code, a category (`user_input`, `unsupported_document`, `provider_failure`, `verification_failure`, `internal`), and whether it is retryable.

Vitest, coverage reporting, CI running lint, typecheck, unit tests, and a Docker build.

**Gate 0:** `docker compose up` produces a running system. Health and readiness respond correctly. Migrations run as a separate command. CI is green. An intentional environment-validation failure produces a clear startup error rather than a runtime crash.

---

### Module 1 — Ingestion and document identity

Upload endpoint. Store immutable original bytes in object storage keyed by SHA-256. Reject unsupported types, oversized files, and corrupt input with explicit typed errors.

`source_documents` and `document_versions`. Document version carries:

```
documentVersionId, contentHash, mimeType, byteSize,
legalIdentity: { jurisdiction, session, instrumentType, number, stage, chapter },
legislativeStatus: "introduced" | "engrossed" | "enrolled" | "enacted" | "vetoed" | "failed" | "unknown",
authoritativeSource, asOfDate, retrievedAt
```

`legislativeStatus` defaults to `unknown` and must be explicitly set. Nothing may treat `unknown` as `enacted`.

**Gate 1:** identical bytes uploaded twice produce one version. Different bytes produce two. Corrupt and unsupported files fail with typed errors and are never marked successful. A document with `legislativeStatus: "unknown"` is queryable and clearly distinguishable from enacted. Tests cover every error path.

---

### Module 2 — Parsing and normalization

`DocumentParser` interface. Two adapters: plain text, and DOCX reading OOXML directly (`w:p`, `w:r`, `w:rPr`). Do not use a DOCX-to-markdown converter — run properties matter. Markdown must not appear as an intermediate format anywhere.

Produce `source_segments`:

```
segmentId, documentVersionId, structuralPath, ordinal,
rawText, normalizedText, contentHash,
offsetMap: reversible normalized <-> original mapping,
parserAdapter, parserVersion, fidelity: "declared" | "inferred" | "none"
```

**Segment identity is `(structuralPath, contentHash, ordinal)`.** Content hash alone is insufficient — two identical subsections hash identically.

**The offset map is required and must be reversible.** Every normalized offset maps back to an original offset. Without this the review UI cannot highlight source passages. Test round-tripping explicitly.

`normalizeForEvidenceMatch@v1` is a single named, versioned, pure function handling ligatures, soft hyphens, line-break hyphenation, smart quotes, `§` variants, non-breaking spaces, and whitespace collapse. Its version is recorded on every use.

**Gate 2:** parsing the same document twice produces identical segment IDs. Offset round-tripping passes on adversarial fixtures (ligatures, hyphenation, repeated identical text). Two identical subsections receive distinct segment IDs. Parser failure produces an explicit failed state, never partial success presented as complete.

---

### Module 3 — Candidate scan

Deterministic lexical scan over segments. Detect dates, durations, temporal connectors, modal verbs (`shall`, `may`, `is authorized to`, `shall endeavor`), `§` citations, and enactment-clause structure.

Structurally suppress amendment-history lines (`1997, c. 795; 2019, c. 401`) — the highest-volume false-positive source.

Every segment receives a coverage state: `candidates_found` or `screened_no_candidate`. **Never `certified_no_obligation`** (INV-7).

Store why each candidate was selected — the matching rule ID and the matched span.

**Gate 3:** positive and negative pattern fixtures pass, including history lines, dates inside citations, and dates in enactment clauses. Every segment has a coverage state. No code path produces a certification of absence.

---

### Module 4 — Model gateway and span proposal

`ModelGateway` interface. One real adapter plus `FixtureModelGateway`. Record model ID, prompt hash, full payloads, tokens, latency, correlation ID.

Extraction output schema: `{segmentId, quotedText, kind}[]`. **The schema has no field for a date, a normalized value, or a computed anything** (INV-1). Use structured output constraints where the provider supports them.

Schema-invalid responses are rejected. Repair may only null, drop, or truncate — never add, coerce, or infer. Repaired responses are flagged in provenance and counted in run metrics.

Versioned prompts stored content-addressed (hash plus full text), not by label.

**Gate 4:** all tests run offline against fixtures. A fixture containing a model-authored date field is rejected by the schema. Repair never adds a value — test this adversarially. Prompt hash changes when prompt text changes.

---

### Module 5 — Anchoring and verification

The highest-value component in the system. Pure TypeScript, no dependencies.

Given `{segmentId, quotedText}`: normalize both sides, attempt exact match, then bounded fuzzy match with an explicit distance ceiling and a flag. Return `{anchored: true, normalizedStart, normalizedEnd, originalStart, originalEnd, method}` or `{anchored: false, reason}`.

**Anchoring failure means the field is unsupported. No fallback** (INV-2).

Name everything to reflect INV-3: this proves the quote exists and is accurate. It does not prove support. Do not call it `verifySupport` or similar.

Material fields requiring anchored evidence:

```
deliverable, actor, recipient, deadlineKind, sourceExpression,
trigger, eventType, dependency, conditions[], exceptions[]
```

**Evidence is per-field, not per-record.** `fieldEvidence: Record<MaterialField, EvidenceReference[]>`. A record-level evidence array is not acceptable — a reviewer must be able to ask why a specific field says what it says.

**Gate 5:** anchoring succeeds on clean quotes and on quotes differing only by normalization. It fails closed on fabricated quotes, quotes from other documents, and quotes exceeding the fuzzy ceiling. No code path returns a value when anchoring fails. Every material field can be traced to its own evidence.

---

### Module 6 — Date grammar

A real grammar (Chevrotain) over legal temporal expressions. Parse-or-fail. Do not use a general-purpose date parser — they are too permissive and will parse something wrong rather than refuse.

Slice coverage: explicit fixed dates, and `within N days (after|of) [the effective date | enactment | passage]`.

Input is a substring from an anchored span (INV-5). Output is a typed expression or a parse failure with the position and reason.

**Gate 6:** the grammar parses every in-scope fixture and **refuses** every out-of-scope one rather than guessing. Adversarial fixtures — ambiguous formats, partial dates, dates in prose — produce explicit failures. Assert at the type level that grammar input originates from an anchor result.

---

### Module 7 — Virginia jurisdiction pack

Versioned data plus pure functions. Directory `packs/us-va/v1/` containing rules as JSON and a strategy implementation.

**Effective-date derivation** per Va. Code § 1-214 and Va. Const. art. IV, § 13, modeling explicitly:

- regular session: July 1 following adjournment, unless a later date is specified
- special session: first day of the fourth month following the month of adjournment
- emergency act: from passage
- general appropriation act: carve-out
- decennial reapportionment act: carve-out
- specified later date in the act: overrides the default

Each branch returns its own `ruleId` and citation. Do not collapse these into one rule.

**Time computation** per § 1-210: subsection (A) excludes the day of the triggering event; subsection (E) rolls a deadline falling on a Saturday, Sunday, legal holiday, or government-closure day forward to the next business day — **and (E) applies to specified dates, not only computed periods.**

Virginia holiday and closure calendar as versioned JSON data.

Verify these statutory readings against the current text at `law.lis.virginia.gov` before encoding. If any differs, implement what the statute says and flag the divergence in the report.

Pack version is recorded on every use. A record resolved today must be reproducible in three years under today's pack.

**Gate 7:** every § 1-214 branch has a test with a worked example and asserts its distinct rule ID. § 1-210(A) day-exclusion and (E) rollover are tested, including a specified date falling on a holiday. Missing session metadata produces unresolved, never a default. The pack loads by version and two versions can coexist.

---

### Module 8 — Resolver

Pure function. Input: a parsed grammar expression plus resolution inputs. Output:

```
{ statutoryDate, adjustedDate, ruleIds[], citations[], packVersion, warnings[] }
```

or an explicit unresolved state naming the missing input.

Never a bare date (INV-6). Civil dates only — `Temporal.PlainDate` or equivalent. **No timestamps, no timezones.**

`resolution_inputs` records the provenance of each input: value, source, authority, and citation. An input without provenance is a bug.

Both `statutoryDate` and `adjustedDate` are stored. Display choice is deferred.

**Gate 8:** every resolved date is reproducible from stored inputs alone. Zero resolutions occur without citations. Missing trigger dates produce unresolved with the missing input named. An unanchored expression cannot reach the resolver — assert this. Recomputing the full corpus from stored inputs reproduces every stored output exactly.

---

### Module 9 — Support evaluation

Deterministic checks first and dispositive: quote anchored, segment belongs to this document version, offsets valid, deterministic date parse matches, actor string within the same provision as the duty.

LLM evaluator runs only on the residual entailment question and **may only reject or downgrade** (INV-4). Enforce in the type system: the evaluator's return type has no `supported` variant. Assert it in tests.

Use a different model or prompt lineage than extraction — correlated failure modes mean the model that selected a wrong span is disproportionately likely to endorse it.

Any material field that is `unsupported` blocks approval.

**Gate 9:** deterministic checks catch fabricated quotes, cross-document evidence, and date mismatches without invoking the LLM. A fixture where the evaluator attempts to return `supported` fails to compile or is rejected at runtime — test this explicitly. Unsupported material fields block approval in an integration test.

---

### Module 10 — Lane router and coverage

Deterministic policy. Assign each proposal a lane and store the reasons:

- `straight_through` — explicit date, all material fields anchored and supported, deterministic validation passed, `fidelity: declared`, `legislativeStatus: enacted`
- `quick_confirmation`
- `exception_review` — relative dates, missing triggers, conflicts, ambiguity
- `blocked` — unsupported or insufficient evidence

**`straight_through` is disabled by configuration in this slice.** Items route there, the lane is displayed as a recommendation, and every item still requires a human decision (INV-9). The auto-publish path must not exist as reachable code.

Coverage accounting reports **processing coverage**: segments with candidates, segments `screened_no_candidate`, segments flagged for sweep. The UI label must distinguish this from measured recall (INV-7).

**Gate 10:** lane assignment is deterministic — the same input yields the same lane. Reasons are stored and inspectable. A hypothetical-status document never routes to `straight_through`. Auto-publish is unreachable. Coverage counts reconcile: every segment appears in exactly one state.

---

### Module 11 — Review workflow and register

API: create project, upload document, start analysis, poll status, fetch proposals, submit review decision, add manual record, fetch register, fetch evidence and provenance.

Idempotency keys on all mutating POSTs. Analysis idempotent on `(documentVersionId, configHash)`.

Review operations: accept, edit-and-accept, reject, split, manual-add. **No merge, no accept-all.**

Every decision is an immutable event with before and after values, reviewer identity, and timestamp. Approved records are immutable versions.

Provenance sheet endpoint returning, for any approved record: document hash, legal identity, legislative status, segment ID, quoted span with offsets, anchoring method, deterministic parse result, pack version, rule IDs with statutory citations, model and prompt hashes, reviewer identity, timestamp, and the diff of what the reviewer changed.

Minimal review UI: proposal list, source pane with the anchored span highlighted using the reversible offset map, per-field evidence display, decision controls, keyboard-first.

**Gate 11:** end-to-end test — upload, analyze, review, approve, fetch provenance sheet. No record becomes authoritative without a reviewer event. Unsupported material fields cannot be approved. Retrying an analysis does not duplicate proposals. Split produces linked records with intact provenance. The provenance sheet contains every field listed above.

---

### Module 12 — Evaluation harness

Gold annotation JSON schema covering all material fields plus negative examples.

**Match function:** stage one pairs by evidence-span overlap; stage two confirms by actor, deadline kind, and deliverable similarity. Ambiguous pairs are adjudicated by a human once and **cached keyed by `(goldItemId, proposalContentHash)`**, so re-runs are deterministic and cheap.

Scorer reporting a confusion structure — matched-correct, matched-wrong-value, missed, false-positive, split, merged — decomposed per pattern class and per lane. **Fabricated dates have their own denominator and zero tolerance.**

Every run records parser version, model, prompt hash, schema version, pack version, cost, latency, and errors. Multiple runs of the same configuration report variance.

Ship with a small synthetic gold set proving the harness works. Real gold data arrives separately.

**Gate 12:** the scorer runs deterministically against synthetic gold. The match function handles one-to-many and many-to-one. Cached adjudications are reused. Running the same configuration three times reports variance. Fabricated dates are counted separately and never averaged into aggregate accuracy.

---

## 7. Module report format

At the end of each module, produce exactly this and then stop:

```
MODULE N COMPLETE — <name>

Gate results
  <each gate criterion: PASS / FAIL with evidence>

Test summary
  <counts by type, coverage, notable adversarial cases added>

Files changed
  <path: one-line purpose>

Migrations
  <new migrations, or none>

Environment variables
  <new or changed, with purpose and whether required>

Invariants touched
  <which of INV-1..INV-10, and how each is enforced and tested>

Decisions taken
  <ambiguities resolved, the conservative choice made, and why>

Known limitations
  <what is deliberately incomplete and which module addresses it>

Manual verification
  <exact commands the reviewer runs to confirm>

Rollback
  <how to revert this module cleanly>

STOPPING. Awaiting approval for Module N+1.
```

---

## 8. Testing requirements

Every module ships tests with the code. Not after.

**Unit:** pure functions exhaustively — normalization, anchoring, grammar, date arithmetic, effective-date branches, lane assignment, match function.

**Contract:** every adapter against fixtures. Parser adapters against the same document. Model gateway against recorded responses. Storage against MinIO.

**Integration:** upload to segments, analysis to proposals, anchoring to resolution, review to approved version, retry idempotency.

**Adversarial — required, not optional.** Every module that touches the invariants needs tests that actively attack them: fabricated quotes, quotes from other documents, model output containing a date field, dates in history lines, dates in citations, a support evaluator attempting to approve, a hypothetical-status document attempting to publish, an unanchored expression reaching the resolver, ambiguous date formats, repeated identical segment text.

**End-to-end:** fixed-date happy path, relative date resolved from a derived effective date, relative date unresolved for want of a trigger, date that is not a deadline, unsupported evidence blocking approval, failed parse never appearing successful, hypothetical document blocked from the register.

All tests run offline. Live-provider tests are separately marked and excluded from the default run.

---

## 9. Start

Read this document fully. Then implement **Module 0 only**. Produce the module report. Stop.
