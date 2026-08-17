# Demo Build — Timeline, Accountable Parties, Dependencies

**Goal:** a working end-to-end demo. Upload a Virginia bill, see a compliance plan — what is due when, who owes it, and what depends on what.

**Audience:** policy professionals who will upload a bill they already know and check whether we found the deadlines they know are in it.

**Scope:** Virginia only. Federal is out — federal bills amend by instruction and the deadline lives in the U.S. Code, so an upload produces amendment instructions rather than obligations. Say so plainly in the UI rather than letting someone discover it.

Work module by module. Stop at each gate. Live-model verification required throughout — fixtures cannot produce the extraction behaviour this depends on.

---

## Part 1 — Grammar coverage (do this first)

HB 35 currently resolves 1 of 22 findings. Several of those refusals are grammar gaps, not genuine ambiguity, and a timeline built on one obligation will not demo.

### 1.1 Trailing scope clauses

`"within 24 hours of its submission"` fails; `"within 24 hours"` parses. The temporal expression is recognised — the trailing clause is not consumed. Same cause as `"annual audit"` and `"the first day of each regular session of the General Assembly"`.

Allow an optional trailing scope clause after a complete temporal expression, and **capture it as `referenceEvent` text rather than discarding it**. "of its submission" tells us what starts the clock, which the reviewer needs even when we cannot date it.

The refusal message then becomes accurate: *"runs from an event this bill does not date: its submission"* rather than a parse failure.

### 1.2 Inverted constructions

`"before seven days have passed"` means the same as `"no longer than seven days"` and is unrecognised. Add:

- `before N <unit> have passed`
- `within N <unit> of X`
- `not later than N <unit> after X`

Keep parse-or-fail. Every addition needs an adversarial case that must still refuse.

### 1.3 Distinguish the two failure messages

Currently both show *"does not match a recognized date or duration pattern."* That is accurate for an unknown construction and misleading when the pattern was recognised and only the span boundary was wrong.

- Unknown form → *"This expression does not match a recognized pattern."*
- Recognised, missing input → *"Runs from an event this bill does not date: {referenceEvent}."*

**Gate 1:** re-run HB 35 and CHAPTER 1126 live. Paste before/after counts. HB 35 is currently 22 findings / 1 resolved.

**Gate 1 result (grammar 1.5.0):**

| Document | Before | After |
|---|---|---|
| HB 35 | 23 findings / 5 parsed / 0 resolved | 23 findings / 10 parsed / 0 resolved |
| CHAPTER 1126 | 18 findings / 8 parsed / 4 resolved | 19 findings / 8 parsed / 4 resolved |

HB 35 resolves 0 and always will — every deadline runs from an event the bill
does not date. Its role is Part 6: identified obligations with named trigger
events awaiting input. CHAPTER 1126 is the timeline document (4 resolved,
2 recurring) — plan views are built and verified against it.

**STOP.**

---

## Part 2 — Accountable parties

`actor` is extracted but is not a first-class field. Promote it.

- Store normalised actor text on `register_records`, indexed.
- Normalise obvious variants: "the Department", "the Department of Energy", "such Department" within one document should group together. Use the document's own definitions where present; do not guess across documents.
- Where no actor is stated, group as **"Owner not specified in document"** — an honest gap, not a blank row.
- Actor must carry its own evidence. It is a material field: it needs an anchored span, same as the deadline.

**Gate 2:** on CHAPTER 1126, show the distinct actors found, how many obligations each owns, and the anchored evidence for each actor assignment.

**Gate 2 result (extractor 1.1.0, anchorer 1.3.0):**

| Actor | Obligations | Evidence (sample) |
|---|---|---|
| Bank Advisory Board | 16 | "nonlegislative citizen members of the Bank Advisory Board", "Each ex officio member of the Bank Advisory Board", "The Bank Advisory Board", "the Bank", "The Bank" |
| Owner not specified in document | 2 | (no actor stated: "for the unexpired term", "more than two consecutive terms") |
| Auditor of Public Accounts | 1 | "Auditor of Public Accounts" |

Normalization: model extracted "Bank", "The Bank", "Bank Advisory Board" —
`normalizeActors` strips noise prefixes ("the") and groups by substring
containment, selecting the longest form ("Bank Advisory Board") as canonical.
All 18 non-null actor evidence spans anchored (`actor_anchored = true`).

**STOP.**

---

## Part 3 — Dependencies: measure before building

The original spec had `dependency_edges`; `docs/00-review-v1.md` recommended deferring it, because legislative obligations are mostly **parallel duties with independent deadlines**, not chains.

Observed so far: CHAPTER 1126 has one real sequence (draft plan to the Advisory Board by August 1 → final plan adopted by December 15). HB 35 appears to have none.

**Before implementing anything:**

1. Across CHAPTER 1126, HB 35, HB 1456, HB 434, and SB 21, count obligations that are genuinely sequenced versus concurrent. Report the number.
2. A dependency exists only when one obligation's timing or existence depends on another's completion — signalled by language like "following adoption of", "after submission of", "prior to". Textual proximity is not dependency.
3. Every dependency must be **evidence-backed**: an anchored span stating the relationship. No inferred edges.

**Then:**

- If sequencing is rare (under roughly 20% of obligations), render it as a **"depends on: {obligation}"** line on the timeline row. No graph. Disconnected nodes look broken.
- If it is common, a graph view is justified — build it then.

Report the count before writing code.

**STOP.**

---

## Part 4 — The plan views

Four tabs over the same accepted register. All read `register_records` and `deadline_occurrences`.

### 4.1 Timeline (default)

```
OVERDUE          none
NEXT 30 DAYS     2 obligations
NEXT 90 DAYS     1
THIS YEAR        3
LATER            4
```

Each row: date, obligation, owner, provision, provenance link, and a "depends on" line where one exists.

Recurring obligations show their **next occurrence only**, with the schedule beside it. One row per obligation, never fifty.

### 4.2 By owner

Grouped by actor. Answers *"what does the Department of Energy owe?"* — the question a compliance officer opens with.

### 4.3 Calendar

Month grid. Recurring obligations render on **every** occurrence in the visible window — this is the one view where expansion is correct.

Where statutory and adjusted dates differ, plot the **adjusted** date and mark it. That is the date the duty can actually be performed.

### 4.4 Summary — one printable page

```
CHAPTER 1126 — Virginia Clean Energy Innovation Bank
2026 Regular Session · Enacted · Effective July 1, 2026

8 obligations identified
  4 with computed dates
  2 recurring schedules
  2 require a trigger date this document does not provide

NEXT ACTION   August 1, 2026 — submit draft strategic plan
              to the Advisory Board (§ 45.2-118(E))

Rules applied: Va. Code § 1-214(A), § 1-210(A), § 1-210(E)
Every date traceable to quoted source text.
```

This is the page someone forwards to their general counsel. Forwarding is how this spreads — make it good.

**STOP.**

---

## Part 5 — Getting findings into the plan

The brief forbids accept-all (FR-7, INV-9). `docs/00-review-v1.md` H-1 flagged that as a contradiction: per-record clicking defeats the throughput claim.

Resolve it, do not remove it:

- Accept-all applies **only** to findings that are resolved AND have all material fields supported. Everything else needs an individual decision.
- Recorded as **one review event naming the reviewer**, with the count and record IDs. Provenance must show a human authorised the batch.
- The button states its scope: *"Accept 4 resolved findings"* — never *"Accept all."*
- Accepted records remain individually editable.

Record as an amendment to FR-7 with the H-1 reasoning.

---

## Part 6 — Unresolved obligations

Separate section below the plan, headed **"Identified but not yet dated"**:

```
IDENTIFIED BUT NOT YET DATED                    3 obligations

  within one working day of placement in restorative housing
  § 53.1-39.2 · runs from an event this bill does not date:
  placement in restorative housing
                                          [ Supply date ]
```

Framing: *"These obligations exist and are cited, but their timing depends on information this document does not contain."*

**These are findings, not failures.** Supplying the missing input promotes the obligation into the plan, recorded as `reviewer_asserted` with the reviewer and reason — exactly as Module 11 already does.

---

## Part 7 — Copy fixes

- Document heading: use the legal identity — **"Chapter 1126 — Virginia Clean Energy Innovation Bank"**, not `Document a14a8d31...`.
- Internal vocabulary out of the UI: `temporal constraint` → `recurring obligation`; `obligation deadline` → `deadline`.
- Jurisdiction notice where a non-Virginia document is uploaded: *"Virginia legislation only. Federal bills amend the U.S. Code, so deadlines are stated in statutes not contained in the bill — federal support requires U.S. Code integration."*

---

## Final gate

Run CHAPTER 1126 and HB 35 live through the browser:

- Grammar fixes verified: paste HB 35's before/after resolved count.
- Dependency count reported across all five documents before any dependency code was written.
- Accept-all accepts only resolved-and-supported findings and records one named review event.
- All four views render from the accepted register.
- The recurring December 15 obligation appears **once** in the timeline, on **every** occurrence in the calendar, and the 2030 occurrence plots on December 16 with its § 1-210(E) note.
- Owner grouping shows distinct actors with anchored evidence.
- Unresolved obligations show specific reasons and supply-date actions that work.
- The summary prints legibly on one page.
- ICS export works from the accepted register.

**Paste actual screen contents, not descriptions.**

---

## Do not

- Claim errorless. HB 35's unresolved obligations are unresolvable — the bill never states when the clock starts. Explaining that honestly is stronger than hiding it, and this audience will find it either way.
- Build a dependency graph before reporting the count.
- Show federal bills as working.
- Let the model produce a date. It points; code computes. That is why a date here can be checked and a model's cannot.
