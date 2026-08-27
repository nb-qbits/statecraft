# Gold-Set Evaluation Report

> **ALL METRICS ARE UNGRADED.** One or more label files have `"verified": false`.
> These labels were generated from pipeline output — the system is grading its own homework.
> Numbers below are structurally valid but carry no evaluative weight until labels are hand-verified.

**Date**: 2026-08-24T22:58:27.536Z
**Model**: unknown
**Graded**: NO — unverified labels present

### Engine Versions

- grammar: 2.1.0

---

# Aggregate (UNGRADED)

| Metric | Value |
|--------|-------|
| Total labelled | 18 |
| Total found | 17 |
| Total matched | 17 |
| Recall | ~~94.4%~~ UNGRADED |
| Actor accuracy | ~~88.2%~~ UNGRADED |
| Citation accuracy | ~~35.3%~~ UNGRADED |
| Date accuracy | ~~0.0%~~ UNGRADED |
| Complete records | ~~0.0%~~ UNGRADED |
| Wrong answers | ~~0~~ UNGRADED |
| Refused but shouldn't have | ~~6~~ UNGRADED |
| **Parse errors** | **4** |

---

## chapter-1126 (UNGRADED — labels not verified)

| Metric | Value |
|--------|-------|
| Obligations labelled | 12 |
| Obligations found by pipeline | 11 |
| Matched | 11 |
| Recall | ~~91.7%~~ UNGRADED |
| Actor accuracy (of matched) | ~~90.9%~~ UNGRADED |
| Citation accuracy (of matched) | ~~27.3%~~ UNGRADED |
| Date accuracy (of date/bounded) | ~~0.0%~~ UNGRADED |
| Complete records (actor+date) | ~~0.0%~~ UNGRADED |
| Wrong answers | ~~0~~ UNGRADED |
| Refused but shouldn't have | ~~3~~ UNGRADED |
| **Parse errors** | **3** |

### PARSE ERRORS (system failures, not refusals)

  [ch1126-11] parse_error  actor:✓ citation:✓ date:—
    gold: actor="Bank" citation="§ 45.2-122" outcome=date date=n/a
    found: actor="Bank" citation="§ 45.2-122" outcome=refuse date=n/a
    refusal: grammar: unexpected character 'G'
    detail: Expected date null but grammar parse failed: grammar: unexpected character 'G'

  [ch1126-03] parse_error  actor:✓ citation:✗ date:—
    gold: actor="Bank" citation="§ 45.2-118" outcome=refuse date=n/a
    found: actor="Bank" citation="?" outcome=refuse date=n/a
    refusal: grammar: unexpected character 's'
    detail: Gold expects refusal, but system failed before it could decide: grammar: unexpected character 's'

  [ch1126-12] parse_error  actor:✗ citation:✓ date:—
    gold: actor="Bank" citation="§ 45.2-122" outcome=refuse date=n/a
    found: actor="executive summary" citation="§ 45.2-122" outcome=refuse date=n/a
    refusal: grammar: unexpected character 'e'
    detail: Gold expects refusal, but system failed before it could decide: grammar: unexpected character 'e'

### REFUSED-BUT-SHOULDN'T-HAVE

  [ch1126-01] refused_but_shouldnt_have  actor:✓ citation:✗ date:✗
    gold: actor="Bank" citation="§ 45.2-118" outcome=date date=2026-12-15
    found: actor="Bank" citation="?" outcome=refuse date=n/a
    refusal: recurrence has no date anchor — cannot generate occurrences without a start date
    detail: Expected date 2026-12-15 but system refused: recurrence has no date anchor — cannot generate occurrences without a start date

  [ch1126-04] refused_but_shouldnt_have  actor:✓ citation:✗ date:✗
    gold: actor="Bank" citation="§ 45.2-119" outcome=date date=2026-12-15
    found: actor="Bank" citation="?" outcome=refuse date=n/a
    detail: Expected date 2026-12-15 but system refused: null

  [ch1126-06] refused_but_shouldnt_have  actor:✓ citation:✗ date:—
    gold: actor="Bank" citation="§ 45.2-119" outcome=date date=n/a
    found: actor="Bank" citation="?" outcome=refuse date=n/a
    detail: Expected date null but system refused: null

### UNMATCHED GOLD (missed obligations)

  [ch1126-07] unmatched_gold  actor:✗ citation:✗ date:—
    gold: actor="Bank" citation="§ 45.2-119" outcome=date date=n/a
    found: actor="?" citation="?" outcome=? date=n/a
    detail: Gold obligation "Submit draft strategic plan to General Assembly" not found in pipeline output

---

## plaw-114publ117

| Metric | Value |
|--------|-------|
| Obligations labelled | 6 |
| Obligations found by pipeline | 6 |
| Matched | 6 |
| Recall | 100.0% |
| Actor accuracy (of matched) | 83.3% |
| Citation accuracy (of matched) | 50.0% |
| Date accuracy (of date/bounded) | 0.0% |
| Complete records (actor+date) | 0.0% |
| Wrong answers | 0 |
| Refused but shouldn't have | 3 |
| **Parse errors** | **1** |

### PARSE ERRORS (system failures, not refusals)

  [plaw117-02] parse_error  actor:✗ citation:✗ date:✗
    gold: actor="head of each agency" citation="§ 2(a)(1)" outcome=date date=2017-12-31
    found: actor="head of an agency" citation="?" outcome=refuse date=n/a
    refusal: grammar: unexpected character 'I'
    detail: Expected date 2017-12-31 but grammar parse failed: grammar: unexpected character 'I'

### REFUSED-BUT-SHOULDN'T-HAVE

  [plaw117-01] refused_but_shouldnt_have  actor:✓ citation:✗ date:✗
    gold: actor="Director of the Office of Management and Budget" citation="§ 2(a)(1)" outcome=date date=2016-07-26
    found: actor="Director of the Office of Management and Budget" citation="?" outcome=refuse date=n/a
    refusal: enactment date not available for this document
    detail: Expected date 2016-07-26 but system refused: enactment date not available for this document

  [plaw117-03] refused_but_shouldnt_have  actor:✓ citation:✓ date:✗
    gold: actor="head of such agency" citation="§ 2(b)(1)" outcome=bounded date=2018-12-31
    found: actor="head of such agency" citation="§ (b)(1)" outcome=refuse date=n/a
    refusal: The described trigger references §(a), but the actor or action described does not match that subsection's content. The referenced subsection text: "Not later than 180 days after the date of the enactment of this Act, the Director of the Office of Management and Budget"
    detail: Expected bounded (≤2018-12-31) but system refused: The described trigger references §(a), but the actor or action described does not match that subsection's content. The referenced subsection text: "Not later than 180 days after the date of the enactment of this Act, the Director of the Office of Management and Budget"

  [plaw117-04] refused_but_shouldnt_have  actor:✓ citation:✓ date:✗
    gold: actor="Secretary of Health and Human Services" citation="§ 2(b)(2)" outcome=bounded date=2018-03-31
    found: actor="Secretary" citation="§ (b)(2)" outcome=refuse date=n/a
    refusal: runs from an event this document does not date: the date on which all of the notices required pursuant to paragraph (1) have been provided or March 31 of the calendar year following the calendar year described in subsection (a)(1), whichever is sooner, the Secretary shall compile the notices submitted pursuant to paragraph (1) and submit to Congress a report on such notices.
    detail: Expected bounded (≤2018-03-31) but system refused: runs from an event this document does not date: the date on which all of the notices required pursuant to paragraph (1) have been provided or March 31 of the calendar year following the calendar year described in subsection (a)(1), whichever is sooner, the Secretary shall compile the notices submitted pursuant to paragraph (1) and submit to Congress a report on such notices.

---
