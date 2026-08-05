# PolicyAction — Revised Architecture and Build Plan

> **Status note.** This document records the rationale for the design. On specific
> requirements it is **superseded by `02-implementation-brief.md`**, which incorporates
> external review feedback (quote-anchoring instead of character offsets, `screened_no_candidate`
> instead of certification, legislative status modelling, and the expanded material-field set).
> Read this document for *why*; read the brief for *what to build*.


## Document for adversarial review

**Version:** 2.0 (supersedes the v1.0 engine specification)
**Date:** August 3, 2026
**Status:** Pre-implementation. No code written.

---

## 0. What this document is, and what the reviewer is being asked to do

This is a revision of an earlier specification for a policy-deadline extraction engine. That specification was reviewed and found structurally sound but defective in four areas: pipeline ordering that defeated its own safety guarantee, undefined load-bearing terminology, insufficient modeling of jurisdiction-specific legal mechanics, and an evaluation design that could not support the accuracy claims it asserted.

This document records the resulting decisions. It is deliberately opinionated and deliberately narrow.

**The reviewer is asked to attack it.** Specifically:

1. Where is a claimed guarantee not actually guaranteed by the mechanism described?
2. Where does the design assume a legal fact that may be wrong, jurisdiction-dependent, or unstable over time?
3. Where does the build sequence assume something is easy that is not?
4. What failure mode does this document not have a name for?
5. Which decisions below are premature — committed to before the evidence exists to support them?

Please argue against the recommendations rather than summarizing them. Where you disagree, state the specific consequence you expect and what evidence would settle it.

---

## 1. Product in one paragraph

PolicyAction converts policy, legislative, and regulatory documents into deadline records that a professional can verify and defend. Each record states what must happen, who is responsible, when it is due, what event starts the clock, and — critically — points at the exact source language and the exact legal rule that produced every date. The target user is a policy professional, general counsel, or think-tank analyst who currently reads bills manually and builds calendars by hand. The initial jurisdiction is Virginia, with federal and District of Columbia to follow.

The product's claim is not "AI reads your bills." It is: **every date on this calendar can be traced to a quoted span of source text and a cited rule of law, and the system refuses to produce a date it cannot prove.**

---

## 2. The four defects being corrected

### 2.1 Resolution ran before verification

The original pipeline was `extract → resolve → verify`. The model produced a date expression as a free-text string; deterministic code then resolved it and stored full provenance.

This inverts the safety property. The dominant failure mode is not bad arithmetic — it is the model transcribing "November 1, 2027" as "November 1, 2026," after which the resolver faithfully, reproducibly, auditably computes a hallucinated date. Every provenance field looks correct. The record is wrong.

**Decision.** The order becomes `extract → anchor → verify → resolve`. The model never emits a value, only a pointer. See §4.

### 2.2 "Material" was undefined while carrying four distinct meanings

The term governed the recall denominator, the approval-blocking rule, the display rule, and the pilot acceptance gate — with no definition anywhere.

**Decision.** Three separate concepts, three separate definitions:

- **Material duty** — whether an obligation belongs on a calendar. Defined by a written annotation checklist, not prose. Measured for inter-annotator agreement before any prompt is written.
- **Material field** — a hardcoded enum in code: `deliverable`, `actor`, `deadlineKind`, `sourceExpression`, plus any populated `conditions[]` or `exceptions[]`. Lack of support on any of these blocks approval.
- **Material correction** — a typed taxonomy of edit classes, each pre-labeled material or cosmetic, fixed before the pilot begins rather than after results are seen.

### 2.3 Jurisdiction mechanics were under-modeled

The original treated deadline extraction as a document-understanding problem. It is roughly 60% a document problem and 40% a jurisdiction problem, and the 40% is not in the document.

Three concrete examples of identical text meaning different things:

- *"Within 30 days after the effective date."* In a Virginia bill, the effective date is July 1 following adjournment (Va. Code § 1-214; Va. Const. art. IV, § 13). In a federal act, it is the date of enactment. In a DC act, it follows the congressional review period. The document states none of this.
- *"10 business days."* Which calendar — state closure, federal holiday, DC government closure, congressional legislative day?
- **Amendment convention.** Virginia marks insertions and deletions typographically. Congress writes them as instructions ("strike X, insert Y"). Entirely different parsing strategies.

Additionally, Va. Code § 1-210 governs computation of time: subsection (A) excludes the day of the triggering event; subsection (E) rolls a deadline falling on a Saturday, Sunday, legal holiday, or government-closure day forward to the next business day — **and (E) applies to specified dates, not only to computed periods.** The original spec deferred holiday calendars as an advanced feature. They are a prerequisite for correctness on the simplest case.

*Reviewer note: these statutory readings should be independently verified. If any is wrong, the resolver design changes.*

**Decision.** Jurisdiction packs. See §6.

### 2.4 The benchmark could not support the gates

15–20 documents split into development and holdout leaves roughly 5–7 holdout documents. A 90% recall threshold measured on that cannot distinguish a real regression from noise. Only the first five documents were to be double-annotated, with no guarantee those were the holdout, and no inter-annotator agreement threshold. The gold-to-proposal match function — without which no metric is computable — was never defined.

**Decision.** See §8.

---

## 3. The revised product thesis

The original design required a human to review every field of every proposal, permanently. That makes the product a nicer reading interface, not a transformative one — it relocates manual work rather than removing it.

**Revised goal: automate what can be proven; route only uncertainty to humans.**

Each extracted deadline is assigned to a processing lane:

| Lane | Criteria | Human involvement |
|---|---|---|
| Straight-through | Explicit date, anchored evidence, deterministic validation passed, declared-fidelity source | None (once earned) |
| Quick confirmation | Reliable extraction, one-click approval | One click |
| Exception review | Relative dates, missing triggers, amendments, conflicts, ambiguity | Full review |
| Blocked | Unsupported or insufficient evidence | Never reaches the calendar |

The user sees: *14 deadlines found · 9 auto-verified · 3 confirm · 2 interpret.*

Human involvement is expected to decline across four stages: full review during benchmark and pilot (which generates the correction data), bulk approval of clear cases in early production, automatic publication of low-risk deadlines at maturity, and eventual straight-through calendar sync.

### 3.1 Three constraints on this thesis

**The lane assignment is itself a prediction and needs its own gate.** Misrouting is asymmetric: exception→straight-through is a silent wrong date; straight-through→exception is a minor efficiency loss. The two directions are measured separately and never share a denominator.

**Lanes triage precision. The real risk is recall.** A missed deadline appears in no lane — it is invisible to the entire triage model. The failure compounds, because an interface signaling confident automation reduces the chance the user reads the document, which is exactly when a miss becomes consequential.

Therefore straight-through processing is only defensible **on top of coverage accounting**: every segment must be accounted for — it produced a candidate, or a deterministic rule certifies it contains no obligation-bearing language, or it is flagged for human sweep. The honest display carries a fifth line:

> 14 deadlines found · 9 auto-verified · 3 confirm · 2 interpret
> **Coverage: 96% of provisions accounted for — 4 sections need review**

**The statistics are harsher than they look.** Claiming straight-through error below 0.1% requires roughly 3,000 clean observations; below 1%, roughly 300. The pilot corpus will not produce 3,000 straight-through items. Consequences:

- The initial straight-through lane is very narrow — explicit fixed dates with anchored spans, nothing else — and widens only as evidence accumulates.
- **Permanent sampling.** Even at maturity, a percentage of straight-through items routes to blind human review. This is how manufacturing QA works and it is the only way to detect drift after a model or parser change. Build the sampling infrastructure early; it is cheap now and awkward to retrofit.
- **Widening a lane is a gated decision** backed by a benchmark run and a documented confidence interval — not a configuration change.

**Launch posture:** straight-through is implemented and disabled. The router runs and displays its recommendation from day one; every item still receives a human click during pilot. This collects the data needed to prove the lane is safe, on the real architecture, without betting the first customer on it.

---

## 4. The central mechanism: the model emits pointers, never values

This is the single most important decision in the document. It fixes §2.1 and it commoditizes the model choice.

**The LLM's only output is a span reference:** `{segmentId, startOffset, endOffset, kind}`. The output schema makes values structurally unrepresentable — there is no field for a date string, no field for a normalized value. The model's job is *pointing*, which is the task it is most reliable at.

The pipeline then:

1. **Anchors** the span deterministically. Normalize both sides (ligatures, soft hyphens, line-break hyphenation, smart quotes, `§` variants, non-breaking spaces) via a single named, versioned function. Exact match, then bounded fuzzy with a flag, then fail. **Anchoring failure means the field is unsupported. No exceptions, no fallback.**
2. **Parses** the anchored substring with a strict grammar (§5). Parse-or-fail.
3. **Compares**, if the model volunteered any value at all. Mismatch is a hard error, never a warning.

Because no model-authored string ever reaches the resolver, fabrication becomes structurally impossible rather than statistically unlikely.

**Consequence for model selection:** the model performs an easy task, so provider choice is a cost and confidentiality decision rather than a quality decision. A self-hosted open-weight model on vLLM (documents never leave your infrastructure — a real selling point for law firms) becomes viable, as does any frontier model with constrained decoding. This is settled by bake-off against the benchmark, not by preference.

**Separate model for the support evaluator.** The component judging whether evidence supports a claim must not be the same model family as the extractor — correlated failure modes mean the model that hallucinated a quote is disproportionately likely to judge that quote supported. Deterministic checks run first and are dispositive; the LLM judges only the residual entailment question; and the evaluator gets its own benchmark and its own gate, which the original spec lacked entirely.

---

## 5. The proof core

Four components, all deterministic, all pure functions. This is what a lawyer is actually trusting.

**Anchoring and verification.** Roughly 300 lines of TypeScript, zero dependencies. Described in §4. Highest-value code in the system.

**Date grammar.** A real grammar (Chevrotain or Ohm) over legal temporal expressions: `within N (calendar|business) days (after|before) X`, `no later than DATE`, `on or before the Nth day of each month`. Parse-or-fail. General-purpose date parsers are rejected because they are too permissive — they will parse something wrong rather than refuse, which is the exact behavior that cannot be tolerated. Grammar coverage becomes a measurable, growing asset.

**Jurisdiction pack.** Versioned data plus a strategy interface. See §6.

**Resolver.** Pure function returning `{statutoryDate, adjustedDate, ruleIds[], citations[]}` — never a bare date. This lets the register render *"July 1, 2026 — Va. Code § 1-214(A)"* instead of a number the user must take on faith. Both the statutory computed date and the § 1-210(E) rolled-forward date are stored; whether to display one or both is a product decision with liability implications and is recorded explicitly.

Date arithmetic uses `Temporal` or civil-date primitives. **Never timestamps.** Statutory deadlines are civil dates, not instants; storing them with timezones produces off-by-one-day errors the first time a user in another zone opens the register.

---

## 6. Jurisdiction packs, not agents

Virginia, federal, and DC share ingestion, parsing, anchoring, the date grammar, review UI, scorer, and provenance. They differ in four pluggable things.

A **pack** is a versioned folder containing: parser strategy selection, effective-date derivation, holiday and session calendars, amendment convention, citation patterns, entity aliases, materiality notes, and jurisdiction-specific extraction prompts and few-shot examples.

**Packs are data and pure functions — not LLM agents.** This is a deliberate rejection of a tempting alternative. The reason a lawyer can trust the output is that dates come from code that cites a statute and returns the same answer every time. An agent applying guidelines reintroduces non-determinism precisely where reproducibility matters most, and destroys the provenance sheet.

The legitimate place for a model inside a pack is extraction prompts and examples — federal amendatory instructions read differently from Virginia typographic markup, so guidance varies. The model is still only pointing at spans.

**Jurisdiction is detected and confirmed before resolution, never assumed from the project.** Detect from citation patterns, XML namespace, or document number; display it; allow override; log the choice. A think tank's project will contain a Virginia bill, a federal NPRM, and a DC act simultaneously. Wrong pack means confidently wrong dates.

**Every resolution stores its pack version.** A record resolved in 2026 must remain reproducible in 2029 after the pack has changed — statutes governing computation of time themselves change.

**Corrections do not automatically promote into packs.** Customer corrections are often local — a client's interpretation, a specific agency's practice. Promoting one into a pack is a deliberate, reviewed, versioned act with a benchmark run behind it. Otherwise one customer's edge case silently changes every other customer's dates and nobody can explain why.

### 6.1 Jurisdiction sequencing — an open strategic question

Virginia is where the answer key can be built cheapest (domain familiarity, annotation speed). Federal is where the market is — think tanks track the Federal Register daily, the source is structured XML with no geometry problem, and comment deadlines have a cleaner materiality boundary than legislative duties. DC is hardest: less consistent structured output, and congressional review means its default effective date depends on the *federal* legislative calendar.

**A benchmark cannot be built for three jurisdictions in parallel.** The corpus is the bottleneck; splitting it three ways yields three mediocre answer keys instead of one defensible one.

*This decision is not yet made and is flagged for the reviewer.* The engine supports all three from day one; the benchmark targets one.

---

## 7. Parser layer

Three adapters behind one interface, differing on the axis that matters: **where amendment status comes from.**

| Adapter | Technology | Amendment status | Fidelity |
|---|---|---|---|
| LIS structured source | `cheerio` / `unified` over XML or HTML | Declared in markup | `declared` |
| DOCX | OOXML read directly (`w:p`, `w:r`, `w:rPr`, `w:ins`/`w:del`) | Attribute — read, not inferred | `declared` |
| PDF | `pdfplumber` in a Python sidecar | Geometrically inferred | `inferred` or `none` |

**DOCX→markdown converters are explicitly rejected.** Tools built to produce readable output normalize formatting away, and run properties are exactly what is needed. Markdown is banned as an intermediate format anywhere in the system — it has no character offsets, so routing through it destroys evidence anchoring.

**Why PDF is degraded, not equivalent.** In DOCX, "struck" is a semantic attribute you read. In PDF it is a horizontal line that happens to overlap some glyphs; the meaning exists only in the reader's eye. Export from DOCX to PDF is lossy in one direction — the exporter renders the attribute into drawing instructions and discards the attribute.

Recovery is possible geometrically: strikethrough is a horizontal line near a character box's vertical midpoint; underline is the same test near the bottom; italic comes from the font descriptor. Italic detection is reliable and semantic. **Strikethrough detection is inferred and is the risky half.** Getting the y-threshold wrong inverts deleted text into new text.

PDF-specific hazards: line-numbered margins pollute segments unless stripped by x-coordinate; reading order is reconstructed rather than given; segment IDs must derive from content hash, never page-and-position.

Expected accuracy is roughly 95–99% per span. **That is not good enough on a legally dispositive signal** — a 1% error rate means occasionally presenting a repealed deadline as active, which is the failure that ends a pilot.

**Therefore fidelity is load-bearing, not metadata.** The lane router reads it: a deadline whose evidence overlaps an `inferred` amendment span can never route straight-through regardless of how clean the extraction looked. Tier C (scanned, or geometry fails) refuses amendatory analysis entirely and reports plainly what was not analyzed.

Ingest **probes the file** rather than trusting the extension: extractable characters with bounding boxes, font descriptors present, vector line or rect objects present. A DOCX-exported PDF passes all three; a scanned page passes none.

**Contract test:** one bill in all three formats, assert segment text matches after normalization and amendment spans agree. Where declared and inferred disagree, that is the real PDF degradation number — a measurement rather than an estimate, and a permanent regression fixture.

---

## 8. Evaluation

**Denominated in gold items, not documents.** Minimum ~300–500 adjudicated deadline items corpus-wide, ≥150 in holdout, with minimum cell counts per pattern class. Report Wilson intervals, not point estimates. If 15–20 Virginia documents cannot produce that count, the corpus grows before Gate 0.

**The holdout is fully double-annotated and adjudicated**; the development set may be single-annotated. The original had this backwards.

**Inter-annotator agreement gates the corpus.** If two policy professionals agree on materiality below roughly κ 0.75, the annotation guide is broken and must be fixed before any prompt is written. Agreement is measured on: is-this-material, deadline kind, and actor.

**The match function is built in Phase 0**, before extraction exists. Two-stage: pair by evidence-span overlap, confirm by actor plus deadline kind plus deliverable similarity. Ambiguous pairs go to a human once, and the adjudication is **cached keyed by `(goldItemId, proposalContentHash)`** so re-runs reuse it. The scorer becomes deterministic and cheap. Without this, recall and precision are opinions.

**Leakage vectors explicitly controlled:**

- *Template leakage.* Virginia bills reuse boilerplate heavily; a random document-level split puts near-identical enactment clauses in both sets and inflates holdout scores. Split by document *and* template cluster, preferably across legislative sessions.
- *Annotator-as-prompt-author.* Separate the roles, or have the adjudicator annotate before ever seeing system output.
- *Annotation-by-correction.* Holdout gold is annotated blind.
- *Holdout burn.* Explicit run budget, each logged with config hash. A second sealed set is reserved for the pilot decision.

**Reported as a confusion structure, not a score:** matched-correct, matched-wrong-value, missed, false-positive, split, merged. Fabricated dates get their own denominator and zero tolerance. Metrics decompose per pattern class and per lane.

**Regression tolerance requires a noise estimate.** LLM outputs are non-deterministic even at temperature 0 across provider infrastructure. Run each benchmark configuration at least three times, report variance, set the blocking threshold above measured noise.

**The manual baseline is measured at Gate 0**, before any prompt is written: same documents, same professional, timed, producing the same artifact, with counterbalanced ordering to control for the learning effect of having already read the document. The original asserted a gate against a baseline that had never been measured.

### 8.1 The uncomfortable part

The engineering above is roughly 8–10 weeks. **The corpus is 4–6 months of a domain expert reading bills.** Everything else in this document a competent team could rebuild from the specification. The adjudicated benchmark and the annotation guide are the only assets a competitor cannot copy — and the only basis on which a number can be quoted to a lawyer and meant.

---

## 9. Vertical slice — what gets built first

One document type. One pattern family. **All twelve components end to end.**

- **Document:** a Virginia bill containing an enactment clause.
- **Patterns:** explicit fixed dates, and relative-to-effective-date.
- **Components:** ingest and identity → parse to segments → candidate scan → span proposal → anchor and verify → date grammar + jurisdiction pack → resolver → lane router and coverage → review workspace → register and provenance → eval harness.

**Deliberately excluded from the slice:** amendatory diff (pending the LIS format probe), recurrence, cross-references, business-day rules beyond § 1-210(E) rollover, multi-document, auto-approval enabled.

**Rationale for narrow-and-deep.** The temptation is to build components 1–4 broadly and stub 5–12. That inverts the risk: components 5–8 are where the unknowns live. Narrow scope, full depth.

### 9.1 Technology

TypeScript modular monolith on Next.js. Postgres (with `pg_trgm` for fuzzy matching; no vector store). S3 or R2 for immutable bytes. Inngest or Trigger.dev for durable, replayable, idempotent job state. LiteLLM or OpenRouter as model gateway. Python sidecar only for `pdfplumber`. Vitest and Playwright. Langfuse for LLM traces, Sentry for errors.

Cross-cutting decisions taken early because they are cheap now and expensive later: `organization_id` on every tenant-scoped table from day one; authorization behind a `can(subject, action, resource)` policy service rather than inline checks; an append-only `domain_events` outbox for future calendar sync, monitoring, and webhooks; idempotency keys on all mutating POSTs; jurisdiction on the document, not the project; a lint rule forbidding Next.js imports inside domain modules.

### 9.2 Sequence

1. **Probe LIS.** Fetch three target bills and determine what format is actually served. If structured XML with amendment markup is available, the parser collapses to a normalizer and the hardest correctness problem disappears. This reshapes the estimate more than any other decision and takes an afternoon.
2. **Manual baseline.** Build the deadline register for three real bills by hand, timed. Produces the baseline, the first draft of materiality rules, and — most importantly — evidence about whether the product is valuable at all.
3. **Annotation guide, written by hand**, every rule traceable to a specific bill where a judgment call was required. Second annotator does two of the same bills blind; disagreements indicate the guide is wrong.
4. **Phase 0:** repository, gold schema, match function, scorer, eval harness. No extraction.
5. **Then** the slice.

---

## 10. Open questions the reviewer should press on

1. **Jurisdiction sequencing** (§6.1). Virginia is cheapest to annotate; federal is where the market is. Which gets the benchmark?
2. **Positioning.** Is v1 "trustworthy calendar" (requiring ~97%+ material recall) or "assisted first pass" (90% acceptable, smaller time-savings claim)? This determines whether the accuracy targets are a floor or a ceiling.
3. **Is amendatory diff in scope for v1?** If yes, the parser selection must be scored on formatting fidelity. If no, amendatory bills leave the corpus — and most of Virginia legislation with them.
4. **Corpus feasibility.** Can 15–20 Virginia documents actually yield ≥150 adjudicated holdout items?
5. **Do the statutory readings in §2.3 hold** under scrutiny by someone qualified?
6. **Is permanent sampling of straight-through items commercially acceptable**, or does it undercut the automation claim?
7. **Is the pointer-only output schema actually achievable** with current constrained-decoding support, or does it degrade extraction quality enough to matter?
8. **What is missing from this document entirely?**

---

## 11. Summary of what changed from v1.0

| Area | v1.0 | v2.0 |
|---|---|---|
| Pipeline order | extract → resolve → verify | extract → anchor → verify → resolve |
| Model output | Free-text values | Span pointers only |
| "Material" | Undefined, four uses | Three defined concepts |
| Jurisdiction | Project attribute | Versioned packs, detected per document |
| Time computation | Calendar days; holidays deferred | § 1-210 rules and holiday calendar in v1 |
| Effective dates | Externally supplied, mostly unresolved | Derived from § 1-214 with citation |
| Human review | Every field, permanently | Four lanes; automation earned by evidence |
| Recall risk | Unaddressed | Coverage accounting |
| Benchmark | 15–20 docs, first 5 adjudicated | Item-denominated; holdout fully adjudicated |
| Match function | Undefined | Built in Phase 0, human adjudications cached |
| Manual baseline | Asserted in a gate | Measured before any prompt is written |
| PDF handling | Equivalent to DOCX | Fidelity-tiered; gates the lane router |
