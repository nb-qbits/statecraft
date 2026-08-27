# Part 3 — Enacted-Section Index

Build the enacted-section index.

This is the blocker on four defect classes: false predicate citations (§551
cited as a dependency), citations rendering as "Paragraph 2" / "Chapter 1126,
Article 3" / "?" / "A", dependency matching by raw text search, and §3(...)
citations on a document whose sections are 1 and 2.

## 3.1  Deterministic ladder parse at the jurisdiction's own granularity

Federal: SEC. n → (a) → (1) → (A) → (i)
Virginia: § N.N-NNN → A → 1 → a

A numbering convention, not a language problem. No LLM on the primary path.

## 3.2  Structural validation

Siblings in sequence, no skips, no duplicates within a parent, no orphans.
A validation failure means the parse failed: refuse rather than emit a
citation you cannot stand behind.

## 3.3  Enacting-clause reconciliation

Each document declares its own scope ("adding ... sections numbered 45.2-114
through 45.2-122"). Reconcile parsed units against the declared range. A unit
outside the range, or a declared unit not found, is a parse failure and must
be reported.

This reconciliation replaces the corroboration lost by lowering
splitOnEmbeddedSections() from 2+ matches to 1+. Do not lower that threshold
without it.

## 3.4  The index

Collect every numbered unit the instrument creates. Normalize citation formats
for lookup: § prefix variants, subsection markers, ranges, whitespace.

## 3.5  One resolution function

Given a citation string, return the enacted unit it refers to, or null if it
resolves outside this instrument. Citation rendering, dependency validation,
and dependency resolution all call it. No component performs its own citation
text matching — delete every path that does.

It must return null for external references with no external marker (§ 56-576)
and for references whose text appears in the document ("section 551 of title 5,
United States Code" is in the GONE Act's definitions and currently anchors
successfully).

## 3.6  Fallback

Where the ladder does not validate, an LLM may PROPOSE a hierarchy. The
proposal is subject to the same structural validation and enacting-clause
reconciliation. A failing proposal is rejected, not accepted at lower
confidence.

---

## GATE 3

Report each individually, PASS or FAIL, with evidence:

a. Every section declared in each document's enacting clause is found;
   nothing outside the declared range is emitted. Report as a list, per
   document.

b. Every obligation carries a citation to the smallest enclosing numbered
   unit — §2(a)(1), §45.2-118(E) — never a chapter, article, "Paragraph N",
   "?", or "A".

c. resolveCitation() returns null for every external reference in both
   documents.

d. A deliberately corrupted fixture fails validation and refuses rather than
   emitting a wrong citation.

e. No component outside the index module performs citation text matching.
   Verify by grep and record the result.

f. Re-run the harness. Report citation accuracy — expected to move from
   35.3% toward 100%.

---

Test documents: PLAW-114publ117 and Virginia Chapter 1126. Every rule must
hold on both. No rule keyed to a specific chapter, section numbering, or
phrasing.
