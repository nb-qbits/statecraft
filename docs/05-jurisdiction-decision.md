# Jurisdiction Decision

**Date:** August 5, 2026
**Status:** Decided. Governs the Module 2 parser scope.
**Decision:** Virginia is the first jurisdiction. Federal and DC are deferred, not rejected.

---

## 1. The question

The engine is jurisdiction-agnostic by design — parser adapters, jurisdiction packs, and rulesets as versioned data. But the *benchmark* cannot be. Someone has to read real documents and decide what counts as a material deadline, and that work does not generalise across jurisdictions.

Splitting annotation across three jurisdictions produces three mediocre corpora instead of one defensible number. So: build for many, prove on one.

This document records which one, and why.

---

## 2. What was probed

Five format probes were run against live sources on August 4–5, 2026, using `pdfplumber` and `curl` against public APIs. Raw findings below.

### 2.1 Virginia bills — PDF from lis.virginia.gov

Probe document: HB 346, 2026 session (`1083934.pdf`), page 2.

```
FONTS: ['Times-Bold', 'Times-Italic', 'Times-Roman']
LINES: 4   RECTS: 0   CURVES: 0
italic chars on page: 353

Line geometry (all zero-height horizontal rules at mid-glyph height):
  x0=289 x1=303 top=386.5   (14pt wide)
  x0=103 x1=106 top=408.5   ( 3pt wide)
  x0=109 x1=144 top=408.5   (35pt wide)
  x0=148 x1=195 top=408.5   (47pt wide)
```

**Insertions are declared** — `Times-Italic` in the font descriptor. Semantic, reliable, read directly from the file.

**Deletions are inferred** — word-width horizontal rules at mid-glyph height. Locatable by geometry, but a judgment with an error rate. Strikethrough and underline are the same shape at different y-coordinates; a wrong threshold inverts deleted text into new text.

**Text layer is clean.** Not a scan. Doubled glyphs appear in the bold header banner (`HHBB334466` for "HB346" — fake bold drawn twice with offset) but a scan of body text for triple-repeated characters returned only `(iii)`, a genuine roman numeral. Doubling does not reach body text.

**Known noise to suppress:** numbered line margins (real text with real bounding boxes, strip by x-coordinate).

### 2.2 Federal bills — USLM XML from govinfo.gov

Probe documents: `BILLS-119hr3481rh` (small, amendatory) and `BILLS-119hr9519ih` (222 KB).

Tag frequency, HR 9519:

```
 723 <enum          215 <subparagraph     43 <quoted-block
 637 <text          173 <clause           43 <after-quoted-block
 349 <quote         155 <paragraph        30 <toc-entry
 242 <header         99 <subsection       29 <row
                     80 <external-xref    28 <section
```

**Best format of anything probed.** Full structural nesting gives segment paths directly from the document. Every changed string is inside a `<quote>` element. Citations to other statutes are pre-tagged as `<external-xref>` — cross-reference detection done by the publisher.

**Caveat:** `<action-instruction>` appeared in HR 3481 but zero times in HR 9519. The amendment *operation* (strike vs. insert) is not consistently tagged; only the changed string is.

Freely available in bulk from the 103rd Congress forward. No API key.

### 2.3 Federal bills — PDF

Probe document: `BILLS-119hr3481rh.pdf`, page 2.

```
FONTS: ['Cheltenham-Bold', 'DeVinne', 'Helvetica', 'NewCenturySchlbk-Bold', 'Symbol']
LINES: 0   RECTS: 0
```

**No typographic amendment markup at all.** No italics, no strikethrough. Congress amends by prose instruction — *"is amended by striking 'November 30, 2031' and inserting 'January 31, 2033'"* — not by marking up text.

Structurally simpler than Virginia PDF (no geometry needed), semantically harder (the instruction must be parsed).

**Known noise:** rotated margin stamp (`BOJ_$$`, `htiw`, `nosnhojk` — reversed "with DISTILLER"), and a `VerDate ... Jkt 059200` footer on every page.

### 2.4 Federal Register — API metadata

Public API, no key required. 10,000 documents available per type.

```json
{ "title": "Improving Emergency Medical Kit Efficacy ...",
  "comments_close_on": "2026-10-05",
  "publication_date": "2026-08-05" }
```

Final rules carry `effective_on` populated (`2027-01-15`, `2026-10-29`, `2026-08-08`).

**The headline deadlines are already structured metadata.** Comment close dates and effective dates require no extraction — they are API fields.

### 2.5 Federal Register — document body

Probe documents: `2026-15929` (proposed rule, 150 KB) and `2026-15920` (final rule).

```
Proposed rule (150 KB):  "shall [verb]" x1     "within N days" x0
Final rule:              "shall [verb]" x3

Structure: 393 <ENT>, 196 <P>, 94 <ROW>, 70 <CHED>, 52 <FTNT>, 10 <GPOTABLE>
           vs. 3 <SECTION>, 8 <AMDPAR>
```

**Obligation density is near zero.** The documents are dominated by tables, footnotes, preamble, and cost-benefit discussion. Operative regulatory text is a thin slice.

### 2.6 DC — not probed directly

Research only. The D.C. Law Library publishes codes and laws in the public domain and explicitly requests bulk HTML or XML download rather than scraping. The Council maintains public GitHub repositories (`DCCouncil/law-xml`, `DCCouncil/dc-law-html`) publishing DC law in both formats.

That covers *codified law*. Pending legislation lives in LIMS and appears less structured. Not verified.

**Additional complication:** DC acts are subject to congressional review before taking effect, so the DC effective-date rule depends on the *federal* legislative calendar. A genuine jurisdiction-specific rule, and a non-trivial one.

---

## 3. The finding

Format quality and product fit run in **opposite directions**.

| | Where the deadline lives | Format difficulty | Verdict |
|---|---|---|---|
| Federal Register | Already in API metadata | None | No extraction problem to solve |
| Federal bills | In statutes not in the document | Easy (XML) | Easy to parse, impossible to resolve |
| Virginia bills | In the document text | Hardest (PDF geometry) | Hard to parse, resolvable |

**Federal Register.** The valuable dates need no AI. A customer tracking comment deadlines needs an API sync and a calendar, not an extraction engine. The document bodies do not carry enough obligation language to justify a pipeline.

**Federal bills.** Amendment by instruction means the deadline being changed sits in the U.S. Code, not the bill. The engine could extract the instruction faithfully — *"this bill changes a date in 38 U.S.C. 5503 from X to Y"* — accurate, cited, provable, and not a calendar entry. Producing one requires resolving into the U.S. Code: a second corpus, a second parser, and a versioning problem.

**Virginia bills.** Amendment by reprint means the entire amended section appears in the document, with the deadline physically present. This is the only probed jurisdiction where a self-contained extraction engine can produce a resolvable deadline from the document alone.

---

## 4. Decision

**Virginia is the first jurisdiction.**

It is the only jurisdiction probed where the deadline is in the document you were handed. That property is what makes the entire architecture — anchoring, deterministic resolution, provenance to a quoted span — possible at all.

The format is the hardest of the three. That is an acceptable trade, because format difficulty is an engineering problem with a known solution, while the cross-reference problem is a scope expansion.

**Federal is deferred, not rejected.** Revisit when cross-reference resolution into the U.S. Code exists. The `<external-xref>` tags mean the groundwork is already laid by the publisher — when that capability arrives, federal becomes the *easiest* jurisdiction to support rather than the hardest.

**DC is deferred.** The codified-law publishing is excellent, but pending legislation is unverified and the congressional review dependency is a real modelling problem.

**Federal Register is deferred and reframed.** If it returns, it is likely as an API-sync product rather than an extraction product. Worth remembering as a possible adjacent offering; not a fit for this engine.

---

## 5. What this changes downstream

**Module 2 — parser scope.**
- `text/plain` and DOCX adapters only. PDF is deferred to a later tier.
- DOCX: read `w:rPr` directly for italic and strikethrough. No markdown as an intermediate format anywhere.
- Suppress numbered line margins by x-coordinate.
- When PDF arrives: italic from font descriptor (declared), strikethrough from geometry (inferred). Anything overlapping an inferred struck region can never route straight-through.

**Jurisdiction packs need a fifth dimension.** The probes surfaced that amendment convention varies structurally, not just in detail:

- `declared_markup` — federal XML, tagged elements
- `typographic` — Virginia, italic and strikethrough
- `prose_instruction` — federal PDF and text, "strike X insert Y"

This belongs on the pack, not the parser. A pack now carries: parser strategy, effective-date derivation, calendars, citation patterns, **amendment convention**, entity aliases, and extraction prompts.

**Cross-reference handling is confirmed as permanently unresolved in v1**, and the reason is now documented rather than assumed. This is a coverage limit to state plainly in the UI, not a temporary state.

**A cross-check opportunity, for later.** Where both declared and inferred amendment status are available for the same document, compute both. Declared is authoritative. Record agreement per span; disagreement flags for review and increments a metric. That metric becomes the *measured* accuracy of geometric inference — which is the evidence that would let inferred-only documents use the quick-confirmation lane.

---

## 6. What is still unknown

The probes settled format. They did not settle value.

**The manual baseline has not been run.** Three real Virginia bills, deadline register built by hand, timed, producing the same artefact the product would. This is outstanding since before Module 0 and remains the only open question that building cannot answer:

- Does structured extraction save a professional meaningful time?
- What is the Gate 4 baseline measured against?
- What does the first draft of the materiality rules look like?

If the answer is that it takes forty minutes and the reviewer enjoys it, the product thesis changes. Better to learn that for the cost of a day than four months of corpus work.

---

## 7. Post-implementation finding: segmentation generalises

The jurisdiction decision assumed segmentation conventions would be
jurisdiction-specific. Module 2 verification contradicts that.

The plain-text/PDF segmentation rules were written for Virginia legislative
structure (§ section headings, numbered subdivisions, enactment clauses).
Applied unmodified to a federal bill (H.R. 3481, 119th Congress, reported),
they produced correct structural segmentation:

    segmentCount: 5
    /body/p[0]                    preamble
    /body/section[1]/p[0]         SECTION 1. SHORT TITLE
    /body/section[6320(b)]/p[0]   Section 6320(b) of title 38 ... is amended
    /body/section[3680]/p[0]      Section 3680 of title 38 ... is amended
    /body/section[5503(d)(7)]/p[0] Section 5503(d)(7) ... amended by striking

Virginia HB 346 for comparison: 17 segments, all 14 numbered subdivisions
isolated, no line-number residue, fidelity "inferred".

Implications:

1. Segmentation may be jurisdiction-agnostic and belongs in the shared parser
   rather than the jurisdiction pack. Revisit if a third jurisdiction breaks it.

2. Federal segments are coarser — subparagraphs (a), (b), (1), (2) collapse
   into the parent section rather than splitting. Acceptable for small bills;
   may be too coarse for Module 4's per-segment LLM calls on large bills.
   Flag for re-evaluation at Module 4.

3. Federal structural paths name the TARGET statute being amended
   (section[5503(d)(7)] is in title 38, not in H.R. 3481). Structurally
   reasonable, semantically imprecise. Matters when cross-references are
   modelled.

4. Geometric line-number stripping (x-coordinate, pre-assembly) worked on both
   despite different margin conventions, and produced cleaner text than the
   regex approach on the text path. The text-path fixture is now the weaker
   test — build corpus text by extracting through the sidecar, not by hand.
