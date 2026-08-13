# Module 13 — Recurrence and Occurrences (H-9)

Paste as the module brief. Same gate discipline as Modules 0–12.

---

## Why this module exists

CHAPTER 1126 (Virginia Clean Energy Innovation Bank) contains 8 real deadlines. The system resolves 2. Four are recurrence and cannot be represented at all:

```
"each December 15 in even-numbered years thereafter"    § 45.2-118(A)
"no later than October 15 in any even-numbered year"    § 45.2-118(E)
"every four years thereafter"                            § 45.2-119(A)
"no later than the first day of each regular session"    § 45.2-122
```

Plus three recurring obligations with no anchor date at all:

```
"quarterly"                  § 45.2-120
"annual audit"               § 45.2-121(B)
"annual executive summary"   § 45.2-122
```

Recurring reporting duties are the most common obligation type in legislation. A register that cannot represent them is not a compliance calendar.

This is **H-9** from `docs/00-review-v1.md`, flagged before any code existed: *"no occurrence model for recurring deadlines."* It is now the largest category of real deadlines the system cannot handle.

---

## Adopt, do not build: RFC 5545 via `rrule`

**`rrule` (npm, BSD-3-Clause)** — a port of python-dateutil's rrule module, implementing recurrence rules as defined in the iCalendar RFC (RFC 5545).

This is the correct dependency because:

- **It is a standard, not a library convention.** RFC 5545 is what every calendar system speaks. Our register already needs ICS export; recurrence rules serialise natively.
- **Occurrence generation is deterministic.** Same rule, same window, same occurrences — which the brief requires and a hand-rolled expander would have to prove.
- **It handles the hard cases.** Year parity (`INTERVAL=2`), end-of-month clamping, nth-weekday-of-month, count vs. until. Every one of these is a bug we would otherwise write ourselves.

**Do NOT adopt `recurrent` or any natural-language-to-RRULE library.** They are built for consumer calendars ("every tuesday at 3:15") and are permissive by design — they guess. That is the same reason `chrono` was rejected in `docs/03-reuse-analysis.md`. Refusal is the feature.

**The split is the same as everywhere else in this system:**

| Concern | Approach |
|---|---|
| Recognising recurrence in legal text | **Our grammar.** Parse-or-fail. |
| Representing a recurrence rule | **`rrule` / RFC 5545.** Adopted. |
| Expanding to occurrences | **`rrule`.** Adopted. |
| Applying § 1-210(E) to each occurrence | **Our jurisdiction pack.** |

---

## Scope

### 13.1 — Grammar: recognise recurrence

Extend the grammar (version 1.4.0) to parse these classes. Each must produce a typed recurrence expression, never a guess.

| Construction | Example | Shape |
|---|---|---|
| Bare interval | `quarterly`, `annually`, `annual` | frequency, no anchor |
| Anchored annual | `each December 15` | frequency + month + day |
| Year parity | `in even-numbered years`, `in odd-numbered years` | + parity qualifier |
| Interval years | `every four years` | + interval |
| Combined | `each December 15 in even-numbered years thereafter` | all of the above |
| Event-anchored | `the first day of each regular session` | frequency + legislative event |

**Constraints:**

- `annual audit` and `annual executive summary` are recurrence with an obligation attached — the noun is not part of the temporal expression. Parse the temporal part; the obligation is Module 4's concern.
- `five-year staggered terms`, `two consecutive terms`, `for the unexpired term`, `over the next two years` must **still refuse**. These are durations of office, not recurrence. Add each as an adversarial case.
- Every grammar addition needs a matching adversarial case that must still be refused. Non-negotiable.

### 13.2 — Recurrence model

A parsed recurrence produces:

```
RecurrenceExpression {
  frequency:  "yearly" | "quarterly" | "monthly" | "weekly" | "daily"
  interval:   number              // every N periods
  byMonth:    number | null
  byMonthDay: number | null
  yearParity: "even" | "odd" | null
  anchorEvent: string | null      // "regular_session" etc.
  boundKind:  "on" | "no_later_than"
}
```

Convert to an RFC 5545 RRULE string via `rrule`. Store **both** the typed expression and the RRULE — the typed form is our domain model, the RRULE is the interchange format.

**Year parity has no direct RFC 5545 expression.** `FREQ=YEARLY;INTERVAL=2` starting from an even year gives even years, but that is a convention encoded in `DTSTART`, not in the rule. Handle it explicitly and document the choice. Do not let the parity requirement become implicit in a start date nobody can see.

### 13.3 — Occurrences

New table `deadline_occurrences`:

```
occurrenceId       (recordVersionId + occurrenceDate, deterministic)
recordVersionId
occurrenceDate     statutory date for this occurrence
adjustedDate       after § 1-210(E)
ruleIds, citations per occurrence
sequenceNumber
```

**Requirements:**

- **Occurrence IDs must be stable and idempotent.** `recordVersionId + occurrenceDate`. Regenerating must produce identical IDs — calendar sync depends on this.
- **§ 1-210(E) applies per occurrence.** December 15, 2026 is a Tuesday; December 15, 2030 is a Sunday. Each occurrence carries its own rule IDs and citations. A recurrence rule does not have one adjustment; it has one per occurrence.
- **Materialise to a horizon**, not to infinity. Default 5 years, configurable. State the choice.
- A recurrence with no resolvable anchor (`quarterly` with no start) generates **no occurrences** and remains unresolved with the missing input named. It is still a valid finding — a real obligation whose schedule cannot yet be computed.

### 13.4 — Register and export

- The register shows a recurring deadline once, with its schedule and next occurrence — not fifty rows.
- ICS export emits the RRULE, so a calendar client expands it natively. This is the payoff for adopting the standard.
- CSV export emits occurrences within the horizon, since CSV has no recurrence concept.

---

## Gate

Run on `1225747.pdf` (CHAPTER 1126) through the live model and paste actual output:

- `each December 15 in even-numbered years thereafter` parses, produces an RRULE, generates occurrences on 2026, 2028, 2030 — and **December 15, 2030 is a Sunday, so that occurrence must carry § 1-210(E) with an adjusted date of December 16**.
- `every four years thereafter` parses with `INTERVAL=4`.
- `quarterly` parses as a recurrence and remains unresolved for want of an anchor, with the missing input named.
- `five-year staggered terms` and `two consecutive terms` still refuse.
- Occurrence IDs are identical across two generation runs.
- ICS export opens in a calendar client and shows the recurrence.

**Live-model verification is required** per the module report format — fixtures cannot produce the extraction behaviour this depends on.

Expected outcome on CHAPTER 1126: from 2 resolved of 20 findings to **2 fixed dates plus 5 recurring schedules with computed occurrences**. That is the difference between a demo and a register.

---

## Do not

- Adopt a natural-language recurrence parser. Our grammar recognises; `rrule` represents.
- Expand occurrences in the UI. The engine computes; the UI displays.
- Generate occurrences for a recurrence with no anchor. Unresolved is the correct answer.
- Let year parity live implicitly in a `DTSTART` nobody can inspect.
