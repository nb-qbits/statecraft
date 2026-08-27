# Gate 2 — Layout-Aware Extraction

## Criteria

a. Body text for both documents contains no marginal notes, page footers,
   running headers, or back matter.

b. Definitions and enumerated items appear in document order. (PLAW
   definition (4) SECRETARY appears after the legislative history block.)

c. Zero mid-word hyphens from line breaks, by automated check across the
   corpus, not by inspection. ("sub-mitted", "Report- ing", "cal-endar",
   "lowincome")

d. Character-level diff against a hand-corrected reference text for both
   documents, recorded in docs/.

e. Both checks run in CI.

f. Harness re-run: ch1126-01 and ch1126-04 both resolve to 2026-12-15;
   report the parse error count.
