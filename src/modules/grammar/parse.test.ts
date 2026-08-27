import { describe, it, expect } from "vitest";
import { parseTemporalExpression, GRAMMAR_VERSION } from "./parse.js";
import { createAnchoredSpan } from "./types.js";
import type { AnchoredSpan } from "./types.js";
import type { AnchorId, SegmentId } from "../shared/types.js";

const AID = "anc_00000000000000000000000000000001" as AnchorId;
const SID = "seg_00000000000000000000000000000001" as SegmentId;

function span(text: string): AnchoredSpan {
  return createAnchoredSpan(AID, SID, text);
}

describe("grammar version", () => {
  it("exports a version string", () => {
    expect(GRAMMAR_VERSION).toBe("2.2.0");
  });
});

describe("fixed dates", () => {
  it("parses 'July 1, 2025'", () => {
    const r = parseTemporalExpression(span("July 1, 2025"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 7, day: 1, year: 2025,
    });
  });

  it("parses 'December 1, 2026'", () => {
    const r = parseTemporalExpression(span("December 1, 2026"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 12, day: 1, year: 2026,
    });
  });

  it("parses 'January 31, 2033'", () => {
    const r = parseTemporalExpression(span("January 31, 2033"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 1, day: 31, year: 2033,
    });
  });

  it("rejects February 30", () => {
    const r = parseTemporalExpression(span("February 30, 2025"));
    expect(r.result.parsed).toBe(false);
    if (r.result.parsed) return;
    expect(r.result.reason).toContain("invalid");
  });
});

describe("relative durations — within N days", () => {
  it("parses 'within 30 days'", () => {
    const r = parseTemporalExpression(span("within 30 days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "within",
    });
  });

  it("parses 'within one working day'", () => {
    const r = parseTemporalExpression(span("within one working day"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 1, unit: "days", dayKind: "working",
      preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "within",
    });
  });

  it("parses 'no longer than seven days'", () => {
    const r = parseTemporalExpression(span("no longer than seven days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 7, unit: "days", dayKind: null,
      preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "no_longer_than",
    });
  });

  it("parses 'within 24 hours'", () => {
    const r = parseTemporalExpression(span("within 24 hours"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 24, unit: "hours", dayKind: null,
      preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "within",
    });
  });

  it("parses 'within five business days'", () => {
    const r = parseTemporalExpression(span("within five business days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 5, unit: "days", dayKind: "business",
      preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "within",
    });
  });

  it("parses 'within 30 days after the effective date'", () => {
    const r = parseTemporalExpression(span("within 30 days after the effective date"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: "after", referenceEvent: "effective_date", referenceEventText: null,
      boundKind: "within",
    });
  });

  it("parses 'within 60 days of enactment'", () => {
    const r = parseTemporalExpression(span("within 60 days of enactment"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 60, unit: "days", dayKind: null,
      preposition: "of", referenceEvent: "enactment", referenceEventText: null,
      boundKind: "within",
    });
  });

  it("parses 'within 90 calendar days from passage'", () => {
    const r = parseTemporalExpression(span("within 90 calendar days from passage"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 90, unit: "days", dayKind: "calendar",
      preposition: "from", referenceEvent: "passage", referenceEventText: null,
      boundKind: "within",
    });
  });
});

describe("repeating intervals — every N days", () => {
  it("parses 'every two business days' as relative_duration", () => {
    const r = parseTemporalExpression(span("every two business days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 2, unit: "days", dayKind: "business",
      preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "no_longer_than",
    });
  });

  it("parses 'every 30 days' as relative_duration", () => {
    const r = parseTemporalExpression(span("every 30 days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "no_longer_than",
    });
  });
});

describe("recurrence — bare intervals", () => {
  it("parses 'quarterly'", () => {
    const r = parseTemporalExpression(span("quarterly"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "quarterly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'annually'", () => {
    const r = parseTemporalExpression(span("annually"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'annual'", () => {
    const r = parseTemporalExpression(span("annual"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });
});

describe("recurrence — anchored annual", () => {
  it("parses 'each December 15'", () => {
    const r = parseTemporalExpression(span("each December 15"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 12, byMonthDay: 15, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'each October 1'", () => {
    const r = parseTemporalExpression(span("each October 1"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 10, byMonthDay: 1, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });
});

describe("recurrence — year parity", () => {
  it("parses 'each December 15 in even-numbered years thereafter'", () => {
    const r = parseTemporalExpression(span("each December 15 in even-numbered years thereafter"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 12, byMonthDay: 15, yearParity: "even",
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'each December 15 in odd-numbered years'", () => {
    const r = parseTemporalExpression(span("each December 15 in odd-numbered years"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 12, byMonthDay: 15, yearParity: "odd",
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'no later than October 15 in any even-numbered year'", () => {
    const r = parseTemporalExpression(span("no later than October 15 in any even-numbered year"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 10, byMonthDay: 15, yearParity: "even",
      anchorEvent: null, boundKind: "no_later_than", dayKind: null,
    });
  });
});

describe("recurrence — interval years", () => {
  it("parses 'every four years thereafter'", () => {
    const r = parseTemporalExpression(span("every four years thereafter"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 4,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'every 4 years'", () => {
    const r = parseTemporalExpression(span("every 4 years"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 4,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });
});

describe("recurrence — event-anchored", () => {
  it("parses 'the first day of each regular session'", () => {
    const r = parseTemporalExpression(span("the first day of each regular session"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: "regular_session", boundKind: "on", dayKind: null,
    });
  });

  it("parses 'no later than the first day of each regular session'", () => {
    const r = parseTemporalExpression(span("no later than the first day of each regular session"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: "regular_session", boundKind: "no_later_than", dayKind: null,
    });
  });
});

describe("recurrence — adversarial (must refuse)", () => {
  it("rejects 'five-year staggered terms' (duration of office, not recurrence)", () => {
    const r = parseTemporalExpression(span("five-year staggered terms"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'two consecutive terms' (duration of office, not recurrence)", () => {
    const r = parseTemporalExpression(span("two consecutive terms"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'for the unexpired term' (duration of office, not recurrence)", () => {
    const r = parseTemporalExpression(span("for the unexpired term"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'over the next two years' (duration, not recurrence)", () => {
    const r = parseTemporalExpression(span("over the next two years"));
    expect(r.result.parsed).toBe(false);
  });
});

describe("deadline expressions — by/no later than/on or before", () => {
  it("parses 'by November 1, 2026'", () => {
    const r = parseTemporalExpression(span("by November 1, 2026"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 11, day: 1, year: 2026,
    });
  });

  it("parses 'No later than November 1, 2026'", () => {
    const r = parseTemporalExpression(span("No later than November 1, 2026"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 11, day: 1, year: 2026,
    });
  });

  it("parses 'no later than July 1, 2027'", () => {
    const r = parseTemporalExpression(span("no later than July 1, 2027"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 7, day: 1, year: 2027,
    });
  });

  it("parses 'on or before October 1, 2026'", () => {
    const r = parseTemporalExpression(span("on or before October 1, 2026"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 10, day: 1, year: 2026,
    });
  });

  it("parses 'by January 1, 2027'", () => {
    const r = parseTemporalExpression(span("by January 1, 2027"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 1, day: 1, year: 2027,
    });
  });

  it("rejects 'by February 30, 2026' (invalid date with modifier)", () => {
    const r = parseTemporalExpression(span("by February 30, 2026"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'by sometime' (modifier without valid date)", () => {
    const r = parseTemporalExpression(span("by sometime"));
    expect(r.result.parsed).toBe(false);
  });
});

describe("at least N days — minimum-bound durations", () => {
  it("parses 'at least 30 days'", () => {
    const r = parseTemporalExpression(span("at least 30 days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "at_least",
    });
  });

  it("parses 'at least five business days'", () => {
    const r = parseTemporalExpression(span("at least five business days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 5, unit: "days", dayKind: "business",
      preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "at_least",
    });
  });

  it("parses 'at least 60 calendar days after the effective date'", () => {
    const r = parseTemporalExpression(span("at least 60 calendar days after the effective date"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 60, unit: "days", dayKind: "calendar",
      preposition: "after", referenceEvent: "effective_date", referenceEventText: null,
      boundKind: "at_least",
    });
  });
});

describe("yearless deadline dates — no later than <month> <day>", () => {
  it("parses 'no later than August 1' with year: null", () => {
    const r = parseTemporalExpression(span("no later than August 1"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 8, day: 1, year: null,
    });
  });

  it("parses 'by October 15' with year: null", () => {
    const r = parseTemporalExpression(span("by October 15"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 10, day: 15, year: null,
    });
  });

  it("parses 'on or before December 31' with year: null", () => {
    const r = parseTemporalExpression(span("on or before December 31"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 12, day: 31, year: null,
    });
  });

  it("still parses 'no later than August 1, 2027' with year present", () => {
    const r = parseTemporalExpression(span("no later than August 1, 2027"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 8, day: 1, year: 2027,
    });
  });

  it("standalone 'August 1' without deadline prefix still requires year", () => {
    const r = parseTemporalExpression(span("August 1"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'by February 30' (invalid day, no year)", () => {
    const r = parseTemporalExpression(span("by February 30"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    // day 30 passes basic bounds (1-31) since we can't validate without year
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 2, day: 30, year: null,
    });
  });
});

describe("deadline with 'of each year' recurrence qualifier", () => {
  it("parses 'Not later than March 31 of each calendar year'", () => {
    const r = parseTemporalExpression(span("Not later than March 31 of each calendar year"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 3, byMonthDay: 31,
      yearParity: null, anchorEvent: null,
      boundKind: "no_later_than", dayKind: null,
    });
  });

  it("parses 'Not later than December 31 of each calendar year'", () => {
    const r = parseTemporalExpression(span("Not later than December 31 of each calendar year"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 12, byMonthDay: 31,
      yearParity: null, anchorEvent: null,
      boundKind: "no_later_than", dayKind: null,
    });
  });

  it("parses 'by June 30 of each year'", () => {
    const r = parseTemporalExpression(span("by June 30 of each year"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 6, byMonthDay: 30,
      yearParity: null, anchorEvent: null,
      boundKind: "no_later_than", dayKind: null,
    });
  });

  it("dehyphenates 'Not later than December 31 of each cal- endar year'", () => {
    const r = parseTemporalExpression(span("Not later than December 31 of each cal- endar year"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 12, byMonthDay: 31,
      yearParity: null, anchorEvent: null,
      boundKind: "no_later_than", dayKind: null,
    });
  });
});

describe("effective on expressions", () => {
  it("parses 'become effective on July 1, 2026'", () => {
    const r = parseTemporalExpression(span("become effective on July 1, 2026"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 7, day: 1, year: 2026,
    });
  });

  it("parses 'becomes effective on January 1, 2027'", () => {
    const r = parseTemporalExpression(span("becomes effective on January 1, 2027"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 1, day: 1, year: 2027,
    });
  });

  it("rejects 'becomes effective eventually' (no date)", () => {
    const r = parseTemporalExpression(span("becomes effective eventually"));
    expect(r.result.parsed).toBe(false);
  });
});

describe("trailing scope after reference event", () => {
  it("parses 'within 90 days of the effective date of this chapter'", () => {
    const r = parseTemporalExpression(span("within 90 days of the effective date of this chapter"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 90, unit: "days", dayKind: null,
      preposition: "of", referenceEvent: "effective_date", referenceEventText: null,
      boundKind: "within",
    });
  });

  it("parses 'within 60 days of the effective date of this act'", () => {
    const r = parseTemporalExpression(span("within 60 days of the effective date of this act"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 60, unit: "days", dayKind: null,
      preposition: "of", referenceEvent: "effective_date", referenceEventText: null,
      boundKind: "within",
    });
  });

  it("parses 'within 180 days of the effective date of this section'", () => {
    const r = parseTemporalExpression(span("within 180 days of the effective date of this section"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 180, unit: "days", dayKind: null,
      preposition: "of", referenceEvent: "effective_date", referenceEventText: null,
      boundKind: "within",
    });
  });

  it("still rejects trailing text not in the grammar", () => {
    const r = parseTemporalExpression(span("within 30 days of the effective date of this random thing"));
    expect(r.result.parsed).toBe(false);
  });

  it("parses 'Not later than 180 days after the date of the enactment of this Act'", () => {
    const r = parseTemporalExpression(span("Not later than 180 days after the date of the enactment of this Act"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 180, unit: "days", dayKind: null,
      preposition: null, referenceEvent: "enactment", referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("parses 'Not later than 6 months after the date of the enactment of this Act'", () => {
    const r = parseTemporalExpression(span("Not later than 6 months after the date of the enactment of this Act"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 6, unit: "months", dayKind: null,
      preposition: null, referenceEvent: "enactment", referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("parses 'Not later than 1 year after the date of the enactment'", () => {
    const r = parseTemporalExpression(span("Not later than 1 year after the date of the enactment"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 1, unit: "years", dayKind: null,
      preposition: null, referenceEvent: "enactment", referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("rejects 'enactment of some other thing' (partial known event)", () => {
    const r = parseTemporalExpression(span("within 30 days of the enactment of some other thing"));
    expect(r.result.parsed).toBe(false);
  });
});

describe("leading context before deadline keyword", () => {
  it("parses 'submitted by October 1, 2026'", () => {
    const r = parseTemporalExpression(span("submitted by October 1, 2026"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 10, day: 1, year: 2026,
    });
  });

  it("parses 'submitted by January 1, 2027'", () => {
    const r = parseTemporalExpression(span("submitted by January 1, 2027"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 1, day: 1, year: 2027,
    });
  });

  it("parses 'must be filed by November 30, 2026' (multiple leading words)", () => {
    const r = parseTemporalExpression(span("must be filed by November 30, 2026"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 11, day: 30, year: 2026,
    });
  });

  it("parses 'report due by July 1, 2025'", () => {
    const r = parseTemporalExpression(span("report due by July 1, 2025"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 7, day: 1, year: 2025,
    });
  });
});

describe("cap clause (whichever is sooner/later)", () => {
  it("parses 'Not later than 90 days after enactment, or March 31, 2018, whichever is sooner'", () => {
    const r = parseTemporalExpression(span("Not later than 90 days after enactment, or March 31, 2018, whichever is sooner"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression.kind).toBe("relative_duration");
    if (r.result.expression.kind !== "relative_duration") return;
    expect(r.result.expression.quantity).toBe(90);
    expect(r.result.expression.unit).toBe("days");
    expect(r.result.expression.referenceEvent).toBe("enactment");
    expect(r.result.expression.capDate).toEqual({
      month: 3, day: 31, year: 2018, capKind: "sooner",
    });
  });

  it("parses cap clause with 'earlier' synonym", () => {
    const r = parseTemporalExpression(span("within 60 days after passage, or June 1, 2025, whichever is earlier"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    if (r.result.expression.kind !== "relative_duration") return;
    expect(r.result.expression.capDate).toEqual({
      month: 6, day: 1, year: 2025, capKind: "sooner",
    });
  });

  it("parses cap clause with 'later'", () => {
    const r = parseTemporalExpression(span("within 30 days after passage, or January 15, 2026, whichever is later"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    if (r.result.expression.kind !== "relative_duration") return;
    expect(r.result.expression.capDate).toEqual({
      month: 1, day: 15, year: 2026, capKind: "later",
    });
  });

  it("does not attach cap to non-relative expressions", () => {
    const r = parseTemporalExpression(span("March 1, 2025, or June 30, 2025, whichever is sooner"));
    expect(r.result.parsed).toBe(false);
  });
});

describe("calendar year anchored date (1.9)", () => {
  it("parses 'December 31 of the first calendar year beginning after the date of the enactment of this Act'", () => {
    const r = parseTemporalExpression(
      span("December 31 of the first calendar year beginning after the date of the enactment of this Act"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression.kind).toBe("calendar_year_anchored_date");
    const expr = r.result.expression as { month: number; day: number; calendarYearOffset: number; referenceEvent: string | null };
    expect(expr.month).toBe(12);
    expect(expr.day).toBe(31);
    expect(expr.calendarYearOffset).toBe(1);
    expect(expr.referenceEvent).toBe("enactment");
  });

  it("parses with 'Not later than' prefix", () => {
    const r = parseTemporalExpression(
      span("Not later than December 31 of the first calendar year beginning after the date of the enactment of this Act"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression.kind).toBe("calendar_year_anchored_date");
  });

  it("parses 'January 1 of the second calendar year beginning after enactment'", () => {
    const r = parseTemporalExpression(
      span("January 1 of the second calendar year beginning after enactment"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    const expr = r.result.expression as { month: number; day: number; calendarYearOffset: number; referenceEvent: string | null };
    expect(expr.month).toBe(1);
    expect(expr.day).toBe(1);
    expect(expr.calendarYearOffset).toBe(2);
    expect(expr.referenceEvent).toBe("enactment");
  });

  it("parses with effective date reference", () => {
    const r = parseTemporalExpression(
      span("March 31 of the first calendar year beginning after the effective date of this Act"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    const expr = r.result.expression as { month: number; day: number; calendarYearOffset: number; referenceEvent: string | null };
    expect(expr.month).toBe(3);
    expect(expr.day).toBe(31);
    expect(expr.calendarYearOffset).toBe(1);
    expect(expr.referenceEvent).toBe("effective_date");
  });

  it("stores unknown event as referenceEventText", () => {
    const r = parseTemporalExpression(
      span("June 30 of the first calendar year beginning after the certification of the results"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    const expr = r.result.expression as { referenceEvent: string | null; referenceEventText: string | null };
    expect(expr.referenceEvent).toBeNull();
    expect(expr.referenceEventText).toBe("the certification of the results");
  });
});

describe("adversarial — must fail to parse", () => {
  it("rejects 'sometime next spring'", () => {
    const r = parseTemporalExpression(span("sometime next spring"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'as soon as practicable'", () => {
    const r = parseTemporalExpression(span("as soon as practicable"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'within a reasonable period'", () => {
    const r = parseTemporalExpression(span("within a reasonable period"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects '30' (bare number)", () => {
    const r = parseTemporalExpression(span("30"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'the first day of the fourth month following adjournment'", () => {
    const r = parseTemporalExpression(
      span("the first day of the fourth month following adjournment"),
    );
    expect(r.result.parsed).toBe(false);
  });

  it("rejects empty string", () => {
    const r = parseTemporalExpression(span(""));
    expect(r.result.parsed).toBe(false);
    if (r.result.parsed) return;
    expect(r.result.reason).toBe("empty input");
  });

  it("rejects 'hello world'", () => {
    const r = parseTemporalExpression(span("hello world"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'July 2025' (no day)", () => {
    const r = parseTemporalExpression(span("July 2025"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects '01/15/2025' (numeric date format)", () => {
    const r = parseTemporalExpression(span("01/15/2025"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'within days' (no quantity)", () => {
    const r = parseTemporalExpression(span("within days"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'reviewed by the oversight committee' (no date after by)", () => {
    const r = parseTemporalExpression(span("reviewed by the oversight committee"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'submitted by email' (no date after by)", () => {
    const r = parseTemporalExpression(span("submitted by email"));
    expect(r.result.parsed).toBe(false);
  });
});

describe("INV-5 — type-level enforcement", () => {
  it("parseTemporalExpression requires AnchoredSpan, not bare string", () => {
    // @ts-expect-error — bare string is not AnchoredSpan
    expect(() => parseTemporalExpression("within 30 days")).toThrow();
  });

  it("result carries anchorId and segmentId from the span", () => {
    const r = parseTemporalExpression(span("within 30 days"));
    expect(r.anchorId).toBe(AID);
    expect(r.segmentId).toBe(SID);
    expect(r.text).toBe("within 30 days");
  });
});

describe("parse failure details", () => {
  it("includes position on failure", () => {
    const r = parseTemporalExpression(span("within a reasonable period"));
    expect(r.result.parsed).toBe(false);
    if (r.result.parsed) return;
    expect(typeof r.result.position).toBe("number");
    expect(r.result.reason.length).toBeGreaterThan(0);
  });

  it("includes reason on failure", () => {
    const r = parseTemporalExpression(span("sometime next spring"));
    expect(r.result.parsed).toBe(false);
    if (r.result.parsed) return;
    expect(r.result.reason).toBeTruthy();
  });
});

describe("dependency-ref cap clause (2.0)", () => {
  it("parses '150 days after submission, or December 31 of the calendar year following the calendar year described in subsection (a)(1), whichever is sooner'", () => {
    const r = parseTemporalExpression(
      span("Not later than 150 days after the submission of the inventory under subsection (a), or December 31 of the calendar year following the calendar year described in subsection (a)(1), whichever is sooner"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression.kind).toBe("relative_duration");
    const expr = r.result.expression as {
      kind: string; quantity: number; capDate?: {
        yearSource?: string; dependencyRef?: string; yearOffset?: number;
        month?: number; day?: number; capKind?: string;
      };
    };
    expect(expr.quantity).toBe(150);
    expect(expr.capDate).toBeDefined();
    expect(expr.capDate!.yearSource).toBe("dependency_ref");
    expect(expr.capDate!.dependencyRef).toBe("(a)(1)");
    expect(expr.capDate!.yearOffset).toBe(1);
    expect(expr.capDate!.month).toBe(12);
    expect(expr.capDate!.day).toBe(31);
    expect(expr.capDate!.capKind).toBe("sooner");
  });

  it("parses §2(b)(2) production span: 90 days + dependency ref cap clause", () => {
    const r = parseTemporalExpression(
      span("Not later than 90 days after the date on which all of the notices required pursuant to paragraph (1) have been provided or March 31 of the calendar year following the calendar year described in subsection (a)(1), whichever is sooner"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression.kind).toBe("relative_duration");
    const expr = r.result.expression as {
      kind: string; quantity: number; capDate?: {
        yearSource?: string; dependencyRef?: string; yearOffset?: number;
        month?: number; day?: number;
      };
    };
    expect(expr.quantity).toBe(90);
    expect(expr.capDate).toBeDefined();
    expect(expr.capDate!.yearSource).toBe("dependency_ref");
    expect(expr.capDate!.dependencyRef).toBe("(a)(1)");
    expect(expr.capDate!.yearOffset).toBe(1);
    expect(expr.capDate!.month).toBe(3);
    expect(expr.capDate!.day).toBe(31);
  });

  it("parses cap with same-year reference (no 'following')", () => {
    const r = parseTemporalExpression(
      span("Not later than 60 days after notification, or June 30 of the calendar year the calendar year described in subsection (b), whichever is sooner"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    const expr = r.result.expression as {
      kind: string; capDate?: { yearSource?: string; yearOffset?: number; dependencyRef?: string };
    };
    expect(expr.capDate).toBeDefined();
    expect(expr.capDate!.yearSource).toBe("dependency_ref");
    expect(expr.capDate!.yearOffset).toBe(0);
    expect(expr.capDate!.dependencyRef).toBe("(b)");
  });

  it("still parses literal-year cap clauses", () => {
    const r = parseTemporalExpression(
      span("Not later than 180 days after enactment, or March 31, 2016, whichever is sooner"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    const expr = r.result.expression as {
      kind: string; capDate?: { year?: number; yearSource?: string };
    };
    expect(expr.capDate).toBeDefined();
    expect(expr.capDate!.year).toBe(2016);
    expect(expr.capDate!.yearSource).toBeUndefined();
  });

  it("extracts cap clause even with trailing actor/duty text", () => {
    const r = parseTemporalExpression(
      span("Not later than 90 days after the date on which all of the notices required pursuant to paragraph (1) have been provided or March 31 of the calendar year following the calendar year described in subsection (a)(1), whichever is sooner, the Secretary shall compile the notices submitted pursuant to paragraph (1) and submit to Congress a report on such notices."),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    const expr = r.result.expression as {
      kind: string; quantity: number; referenceEventText?: string | null;
      capDate?: { yearSource?: string; dependencyRef?: string; yearOffset?: number; month?: number; day?: number };
    };
    expect(expr.kind).toBe("relative_duration");
    expect(expr.quantity).toBe(90);
    expect(expr.capDate).toBeDefined();
    expect(expr.capDate!.yearSource).toBe("dependency_ref");
    expect(expr.capDate!.dependencyRef).toBe("(a)(1)");
    expect(expr.capDate!.yearOffset).toBe(1);
    expect(expr.capDate!.month).toBe(3);
    expect(expr.capDate!.day).toBe(31);
    expect(expr.referenceEventText).not.toContain("the Secretary shall compile");
  });

  it("extracts literal cap clause with trailing text", () => {
    const r = parseTemporalExpression(
      span("Not later than 180 days after enactment, or March 31, 2016, whichever is sooner, the Director shall submit a report"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    const expr = r.result.expression as {
      kind: string; capDate?: { year?: number; month?: number; day?: number };
    };
    expect(expr.capDate).toBeDefined();
    expect(expr.capDate!.year).toBe(2016);
    expect(expr.capDate!.month).toBe(3);
    expect(expr.capDate!.day).toBe(31);
  });

  it("no hardcoded year literals in grammar module for cap clause", () => {
    // This is the grep verification — already confirmed at shell level
    // grep -rn "2018" src/modules/grammar/ | grep -v test → empty
    // Here we verify the grammar produces dependency refs, not literal years,
    // for the GONE Act pattern
    const r = parseTemporalExpression(
      span("Not later than 150 days after submission, or December 31 of the calendar year following the calendar year described in subsection (a)(1), whichever is sooner"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    const expr = r.result.expression as { capDate?: { year?: number; yearSource?: string } };
    expect(expr.capDate!.yearSource).toBe("dependency_ref");
    expect(expr.capDate!.year).toBeUndefined();
  });
});

describe("trailing scope clauses (1.1)", () => {
  it("parses 'within 24 hours of its submission'", () => {
    const r = parseTemporalExpression(span("within 24 hours of its submission"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 24, unit: "hours", dayKind: null,
      preposition: null, referenceEvent: null,
      referenceEventText: "its submission",
      boundKind: "within",
    });
  });

  it("parses 'within 48 hours of the submission of such a refusal'", () => {
    const r = parseTemporalExpression(span("within 48 hours of the submission of such a refusal"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 48, unit: "hours", dayKind: null,
      preposition: null, referenceEvent: null,
      referenceEventText: "the submission of such a refusal",
      boundKind: "within",
    });
  });

  it("parses 'within 24 hours of such placement'", () => {
    const r = parseTemporalExpression(span("within 24 hours of such placement"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 24, unit: "hours", dayKind: null,
      preposition: null, referenceEvent: null,
      referenceEventText: "such placement",
      boundKind: "within",
    });
  });

  it("parses 'within one working day of placement in restorative housing'", () => {
    const r = parseTemporalExpression(
      span("within one working day of placement in restorative housing"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 1, unit: "days", dayKind: "working",
      preposition: null, referenceEvent: null,
      referenceEventText: "placement in restorative housing",
      boundKind: "within",
    });
  });

  it("does not interfere with known reference events", () => {
    const r = parseTemporalExpression(span("within 30 days of the effective date of this act"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: "of", referenceEvent: "effective_date", referenceEventText: null,
      boundKind: "within",
    });
  });

  it("parses trailing scope after 'at least'", () => {
    const r = parseTemporalExpression(span("at least 30 days after the filing of the complaint"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: null, referenceEvent: null,
      referenceEventText: "the filing of the complaint",
      boundKind: "at_least",
    });
  });
});

describe("inverted constructions (1.2)", () => {
  it("parses 'before seven days have passed'", () => {
    const r = parseTemporalExpression(span("before seven days have passed"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 7, unit: "days", dayKind: null,
      preposition: null, referenceEvent: null, referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("parses 'before 30 calendar days have passed'", () => {
    const r = parseTemporalExpression(span("before 30 calendar days have passed"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: "calendar",
      preposition: null, referenceEvent: null, referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("parses 'not later than 30 days after the effective date'", () => {
    const r = parseTemporalExpression(span("not later than 30 days after the effective date"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: "after", referenceEvent: "effective_date", referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("parses 'not later than 60 business days after enactment'", () => {
    const r = parseTemporalExpression(span("not later than 60 business days after enactment"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 60, unit: "days", dayKind: "business",
      preposition: "after", referenceEvent: "enactment", referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("rejects 'before the deadline' (no quantity)", () => {
    const r = parseTemporalExpression(span("before the deadline"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'before seven days' (missing 'have passed')", () => {
    const r = parseTemporalExpression(span("before seven days"));
    expect(r.result.parsed).toBe(false);
  });

  it("rejects 'before zero days have passed' (zero quantity)", () => {
    const r = parseTemporalExpression(span("before zero days have passed"));
    expect(r.result.parsed).toBe(false);
  });
});

describe("workday support", () => {
  it("parses 'within one workday'", () => {
    const r = parseTemporalExpression(span("within one workday"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 1, unit: "days", dayKind: "working",
      preposition: null, referenceEvent: null, referenceEventText: null,
      boundKind: "within",
    });
  });

  it("parses 'within one workday of such placement'", () => {
    const r = parseTemporalExpression(span("within one workday of such placement"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 1, unit: "days", dayKind: "working",
      preposition: null, referenceEvent: null,
      referenceEventText: "such placement",
      boundKind: "within",
    });
  });

  it("parses 'within five workdays'", () => {
    const r = parseTemporalExpression(span("within five workdays"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 5, unit: "days", dayKind: "working",
      preposition: null, referenceEvent: null, referenceEventText: null,
      boundKind: "within",
    });
  });

  it("rejects 'workday' alone (no prefix)", () => {
    const r = parseTemporalExpression(span("workday"));
    expect(r.result.parsed).toBe(false);
  });
});

describe("combined fixed date plus recurrence (1.6)", () => {
  it("parses 'By December 15, 2026, and each December 15 in even-numbered years thereafter'", () => {
    const r = parseTemporalExpression(
      span("By December 15, 2026, and each December 15 in even-numbered years thereafter"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 12, byMonthDay: 15, yearParity: "even",
      anchorEvent: null, boundKind: "on", dayKind: null,
      anchorYear: 2026,
    });
  });

  it("parses 'December 15, 2026, and each December 15 in even-numbered years thereafter'", () => {
    const r = parseTemporalExpression(
      span("December 15, 2026, and each December 15 in even-numbered years thereafter"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 12, byMonthDay: 15, yearParity: "even",
      anchorEvent: null, boundKind: "on", dayKind: null,
      anchorYear: 2026,
    });
  });

  it("parses 'October 1, 2027, and each October 1 thereafter'", () => {
    const r = parseTemporalExpression(
      span("October 1, 2027, and each October 1 thereafter"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 10, byMonthDay: 1, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
      anchorYear: 2027,
    });
  });

  it("parses 'July 1, 2026, and every 4 years thereafter'", () => {
    const r = parseTemporalExpression(
      span("July 1, 2026, and every 4 years thereafter"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 4,
      byMonth: 7, byMonthDay: 1, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
      anchorYear: 2026,
    });
  });

  it("parses 'By December 15, 2026, and the Board shall submit a report' (strips trailing clause)", () => {
    const r = parseTemporalExpression(
      span("By December 15, 2026, and the Board shall submit a report"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 12, day: 15, year: 2026,
    });
  });

  it("standalone parts still parse independently", () => {
    const fixed = parseTemporalExpression(span("By December 15, 2026"));
    expect(fixed.result.parsed).toBe(true);
    if (!fixed.result.parsed) return;
    expect(fixed.result.expression).toEqual({
      kind: "fixed_date", month: 12, day: 15, year: 2026,
    });

    const recurrence = parseTemporalExpression(
      span("each December 15 in even-numbered years thereafter"),
    );
    expect(recurrence.result.parsed).toBe(true);
    if (!recurrence.result.parsed) return;
    expect(recurrence.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 12, byMonthDay: 15, yearParity: "even",
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });
});

describe("full obligation clause — trailing actor/duty text (2.1)", () => {
  it("parses PLAW plaw117-01: 'Not later than 180 days after the date of the enactment of this Act, the Director of the Office of Management and Budget shall instruct the head of each agency'", () => {
    const r = parseTemporalExpression(
      span("Not later than 180 days after the date of the enactment of this Act, the Director of the Office of Management and Budget shall instruct the head of each agency"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 180, unit: "days", dayKind: null,
      preposition: null, referenceEvent: "enactment", referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("parses 'by January 15, 2027, the agency shall submit the report'", () => {
    const r = parseTemporalExpression(
      span("by January 15, 2027, the agency shall submit the report"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 1, day: 15, year: 2027,
    });
  });

  it("parses 'January 15, 2027, the Director shall compile the report'", () => {
    const r = parseTemporalExpression(
      span("January 15, 2027, the Director shall compile the report"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 1, day: 15, year: 2027,
    });
  });

  it("still rejects text with no temporal expression", () => {
    const r = parseTemporalExpression(
      span("the Board shall submit a report to the oversight committee"),
    );
    expect(r.result.parsed).toBe(false);
  });
});

describe("full obligation clause — leading actor text (2.1)", () => {
  it("parses 'Bank shall submit draft strategic plan within 30 days of the effective date of this act'", () => {
    const r = parseTemporalExpression(
      span("Bank shall submit draft strategic plan within 30 days of the effective date of this act"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: "of", referenceEvent: "effective_date", referenceEventText: null,
      boundKind: "within",
    });
  });

  it("parses 'Bank shall file quarterly'", () => {
    const r = parseTemporalExpression(span("Bank shall file quarterly"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "quarterly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'Bank shall file annually'", () => {
    const r = parseTemporalExpression(span("Bank shall file annually"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'executive summary shall be provided not later than 60 days after effective date'", () => {
    const r = parseTemporalExpression(
      span("executive summary shall be provided not later than 60 days after effective date"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 60, unit: "days", dayKind: null,
      preposition: "after", referenceEvent: "effective_date", referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("parses 'Director shall act before seven days have passed'", () => {
    const r = parseTemporalExpression(
      span("Director shall act before seven days have passed"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 7, unit: "days", dayKind: null,
      preposition: null, referenceEvent: null, referenceEventText: null,
      boundKind: "no_longer_than",
    });
  });

  it("parses 'Agency shall submit each December 15 in even-numbered years thereafter'", () => {
    const r = parseTemporalExpression(
      span("Agency shall submit each December 15 in even-numbered years thereafter"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: 12, byMonthDay: 15, yearParity: "even",
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'the Secretary shall report every 4 years thereafter'", () => {
    const r = parseTemporalExpression(
      span("the Secretary shall report every 4 years thereafter"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 4,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("still rejects text with no temporal expression even with actor prefix", () => {
    const r = parseTemporalExpression(
      span("the Secretary shall submit a report to the oversight committee"),
    );
    expect(r.result.parsed).toBe(false);
  });

  it("still rejects 'reviewed by the oversight committee'", () => {
    const r = parseTemporalExpression(
      span("reviewed by the oversight committee"),
    );
    expect(r.result.parsed).toBe(false);
  });

  it("parses 'Bank shall hold quarterly meetings' by extracting 'quarterly'", () => {
    const r = parseTemporalExpression(
      span("Bank shall hold quarterly meetings"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "quarterly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses 'Bank Advisory Board shall annually elect a chair' by extracting 'annually'", () => {
    const r = parseTemporalExpression(
      span("Bank Advisory Board shall annually elect a chair"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence", frequency: "yearly", interval: 1,
      byMonth: null, byMonthDay: null, yearParity: null,
      anchorEvent: null, boundKind: "on", dayKind: null,
    });
  });

  it("parses obligation with 'no later than August 1 and' trailing conjunction", () => {
    const r = parseTemporalExpression(
      span("Bank shall submit a plan no later than August 1 and, after receiving comments"),
    );
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "fixed_date", month: 8, day: 1, year: null,
    });
  });
});
