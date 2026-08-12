# Claude Code — Evaluation UI Implementation Prompt

Paste this as the standing brief for the UI work. It governs all four modules below.

## 0. Operating mode

You are building an evaluation-facing web UI on top of the completed Statecraft engine (Modules 0–12, gates 00–12 all passed).

Work module by module. Within a module, proceed without asking permission — implement, test, verify, iterate. At each module boundary, run the gate checks, produce a short report, and STOP.

Where anything is ambiguous, choose the option that is more honest about system limits, implement it, and record the choice under "Decisions taken". Do not stall.

Read first: docs/statecraft-ui-spec.md, CLAUDE.md, and docs/11-module-11-report.md (for the provenance sheet contract).

## 1. Who this is for, and why it changes the design

The audience is a policy professional evaluating whether this works on real legislation — not a prospect watching a scripted demo.

They will upload a bill they already know, look for the deadlines they know are in it, and check whether we found them. If we missed one, that is the finding. If we invented one, that is fatal.

Four consequences that govern every design decision:

They bring the document. Upload is the first thing on the page. Sample bills are secondary.
Coverage beats accuracy. Their first question is "what did you miss?" Show what was examined before showing what was found.
Refusals must read as rigour, not failure. Most Virginia relative deadlines resolve to unresolved because they run from events the bill does not date. That is the correct answer and the differentiator — present it that way.
Never overstate. This audience will find every gap. Stating limits before they discover them earns credibility; hiding them loses it permanently.

## 2. Hard constraints

- The UI computes nothing. It reads results the engine produced and formats them. It must have no ability to derive, infer, or default a date. If a value is not in the API response, it is not displayed.
- Never paraphrase a finding. Quoted source text is rendered verbatim.
- Never display a date without its provenance and citation. If citations are empty, that is a bug in the engine, not something the UI papers over — surface it.
- Escape all document text. Parsed content is untrusted input rendered in a browser. No dangerouslySetInnerHTML on document content, ever.
- The UI must not orchestrate the pipeline from the browser. See Module U1.
- No new domain logic. Anything that looks like business rules belongs in the engine, behind the existing module boundaries and the no-framework-in-modules lint rule.

## 3. BLOCKING PREREQUISITE — do this first and report

Our best fixture (HB 35) produces zero resolvable dates — every duration runs from an event the bill does not date. The only resolvable date in the corpus is July 1, 2025 from simple-bill, and it is verbatim, not computed.

A UI built against this shows almost nothing but "unresolved".

Before writing UI code: search lis.virginia.gov (2026 session) for bills whose titles contain "report", "work group", "study", or "pilot program", and identify 2–3 containing at least one of:

- within N days of the effective date — exercises § 1-214 derivation
- an explicit reporting date (no later than December 1, 2026)
- a business-day duration landing on a weekend — exercises § 1-210(E) rollover

Report the bill numbers and the specific deadline language found. If you cannot access LIS, say so and I will source them manually — but do not proceed to U1 without fixtures that produce resolved dates.

## Module U1 — Orchestration and read models

Backend only. No UI yet. This module removes the need for the browser to know pipeline structure.

### U1.1 — Analysis orchestration endpoint

`POST /api/v1/documents/:documentVersionId/analyze`

Runs parse → scan → extract → anchor → parse-temporal → resolve → route server-side, in order, and streams stage completion events (Server-Sent Events).

Each event carries: stage name, status, and the real counts for that stage (provisions parsed, candidates found, spans proposed, spans anchored, spans rejected, expressions parsed, dates resolved, dates unresolved, lane assignments).

Idempotent on `(documentVersionId, configHash)` — re-running returns cached results rather than re-executing.

If a stage fails, the stream reports the failure with its reason and stops. Never a silent partial success.

### U1.2 — Findings read model

`GET /api/v1/documents/:documentVersionId/findings`

One call returning everything a finding card needs, joined server-side:

```json
{
  "findings": [{
    "anchorId", "segmentId", "structuralPath", "provisionLabel",
    "quotedText", "kind",
    "anchored", "anchorMethod", "anchorFailureReason",
    "grammarParsed", "grammarFailureReason",
    "resolved", "statutoryDate", "adjustedDate", "ruleIds", "citations",
    "packVersion", "unresolvedReason", "missingInputs",
    "lane", "laneReasons",
    "supportLevel", "deterministicChecks"
  }],
  "coverage": { "totalSegments", "withCandidates", "screenedNoCandidate", "needsSweep" },
  "laneSummary": { "straight_through", "quick_confirmation", "exception_review", "blocked" },
  "rejectedSpans": [{ "quotedText", "reason" }]
}
```

`provisionLabel` is a human-readable rendering of `structuralPath` — "§ 53.1-39.2(D)", not "/body/section[53.1-39.2]/p[4]". Derive it in the engine, not the UI.

`rejectedSpans` are proposals that failed anchoring. These must be surfaced, not hidden — a span the system rejected is the most persuasive evidence available to this audience.

### Gate U1:

- `analyze` runs the full chain and streams stages with real counts, verified via curl on a real bill.
- Re-running returns cached results without re-executing.
- A forced stage failure reports the reason and stops.
- `findings` returns one complete payload; the UI would need no other call to render the findings screen.
- `provisionLabel` renders human-readably for both Virginia and federal structural paths.
- Paste actual curl output for both endpoints.

STOP.

## Module U2 — Upload, analysis, findings

Next.js app in the existing repo. Server components where possible. Only Tailwind core utilities.

### Screen 1 — Upload

- Large drop zone, first thing on the page. PDF, DOCX, or text.
- One line: "Extracts deadlines from legislation. Every date traces to quoted source text and cites the statute that computed it."
- Legal identity fields prefilled by best-effort detection from the filename and first page, editable.
- Sample bills below the fold, clearly labelled as samples.

### Screen 2 — Analysis

Consume the SSE stream. Show each stage as it completes with its real number:

```
✓ Parsed          18 provisions
✓ Scanned         50 candidate expressions
✓ Proposed        6 spans identified
✓ Verified        5 anchored to source · 1 rejected — quote not found in document
✓ Parsed dates    5 expressions understood
✓ Resolved        2 dates computed · 3 need a trigger date
✓ Routed          2 ready to confirm · 3 need review
```

The rejected-span line is the most persuasive element on this screen. Give it visual weight.

Do not hide the pipeline behind a spinner. The visible reasoning is the product.

### Screen 3 — Findings

Grouped by lane, not document order. Each finding as a card showing: the verbatim quote, the provision label, and either the resolved date with its citations or a plain-English reason it could not be resolved.

Plain English, always. "It runs from an event this bill does not date" — never `missingInputs: [triggerDate]`.

Refusals get the same visual weight as successes. Not warning colours, not smaller cards. They are findings.

Where a date is `reviewer_asserted`, label it unmistakably as supplied by a person, not computed.

### Gate U2:

- Upload a real bill through the browser and complete analysis end to end.
- Stage counts match the API response exactly — screenshot or paste both.
- A rejected span appears in the analysis stream and is visible in the findings.
- An unresolved finding reads as a considered answer, not an error.
- All document text is escaped; verify with a fixture containing HTML-like characters.

STOP.

## Module U3 — Source view and proof sheet

### Screen 4 — Source view

Clicking a finding opens the document with the exact span highlighted, using the reversible offset map from Module 2. Show generous surrounding context.

This is where an evaluator satisfies themselves the quotes are real. The highlight must be unmistakable.

### Screen 5 — Proof sheet

The provenance sheet, formatted as a page a lawyer would read. Not a JSON dump. Follow the layout in docs/statecraft-ui-spec.md §2 Screen 6.

Must include: document identity and content hash, provision, verbatim quoted text, anchoring method and offsets, every rule ID with its statutory citation, statutory and adjusted dates, pack version, date provenance, reviewer identity, timestamp, and any reviewer changes.

Downloadable as PDF.

The test for this screen: could a lawyer defend the date from this page alone, with no access to the system? If you find yourself needing to explain something the page does not show, it is not finished.

### Screen 6 — Coverage

```
COVERAGE

18 of 18 provisions examined

  14  contained date or obligation language → analysed
   4  contained none → screened, no candidate
   0  could not be processed

This is processing coverage: what we looked at.
It is not a claim about how many deadlines exist in this document.
```

That caveat is mandatory. Coverage must never read as a recall claim (INV-7).

### Gate U3:

- Source view highlights the correct span on a real PDF-derived bill — verify by eye against the source document.
- Proof sheet contains every field listed. Paste one in full.
- Proof sheet PDF downloads and is legible.
- Coverage counts reconcile with the API and carry the caveat.

STOP.

## Module U4 — Honesty panel, register, deploy

### Honesty panel — persistent, dismissible, not buried:

```
This is an engine under evaluation. Current limits:

· Virginia legislation only. Federal and DC are not supported.
· Extraction runs on recorded model responses, not a live model.
  Real extraction quality is not yet measured.
· Deadlines relative to an unstated effective date cannot be
  computed automatically.
· Amendatory bills — struck and inserted text — are not
  distinguished.
· Accuracy has not been measured against an annotated corpus.
```

Keep this list current with docs/module-reports/ known limitations. If a limitation is fixed, remove it; if a new one is found, add it.

### Register — confirmed deadlines as a table: date, obligation, actor, provision, source, provenance. Export CSV and ICS.

### Deploy

- App and Python sidecar to a container host (Railway, Render, or Fly).
- Managed Postgres, S3-compatible object storage.
- Shared-link token or basic auth. No user model exists yet.
- Rate limit uploads. Cap file size and page count. This is a public link.
- All configuration via environment variables — the existing schema already enforces this.

### Gate U4:

- Honesty panel visible on first load, dismissible, and its content matches current known limitations.
- Register exports valid CSV and ICS.
- Deployed URL works end to end from a machine that has never run the project.
- Upload limits enforced — demonstrate with an oversized file.
- No secrets in the repository or client bundle.

STOP.

## 4. What success looks like

A policy professional uploads a bill they know, and:

- Finds the deadlines they expected
- Sees nothing invented
- Can click any date and see the exact source text
- Understands why unresolved items are unresolved, and does not read it as failure
- Believes the proof sheet would survive scrutiny

If they say "but it missed X" — that is the most valuable outcome available. It is the first real recall data anyone has, and worth more than a demo that impresses.

Design for that outcome, not against it.
