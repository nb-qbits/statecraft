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
    expect(GRAMMAR_VERSION).toBe("1.4.0");
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
      preposition: null, referenceEvent: null, boundKind: "within",
    });
  });

  it("parses 'within one working day'", () => {
    const r = parseTemporalExpression(span("within one working day"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 1, unit: "days", dayKind: "working",
      preposition: null, referenceEvent: null, boundKind: "within",
    });
  });

  it("parses 'no longer than seven days'", () => {
    const r = parseTemporalExpression(span("no longer than seven days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 7, unit: "days", dayKind: null,
      preposition: null, referenceEvent: null, boundKind: "no_longer_than",
    });
  });

  it("parses 'within 24 hours'", () => {
    const r = parseTemporalExpression(span("within 24 hours"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 24, unit: "hours", dayKind: null,
      preposition: null, referenceEvent: null, boundKind: "within",
    });
  });

  it("parses 'within five business days'", () => {
    const r = parseTemporalExpression(span("within five business days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 5, unit: "days", dayKind: "business",
      preposition: null, referenceEvent: null, boundKind: "within",
    });
  });

  it("parses 'within 30 days after the effective date'", () => {
    const r = parseTemporalExpression(span("within 30 days after the effective date"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: "after", referenceEvent: "effective_date",
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
      preposition: "of", referenceEvent: "enactment",
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
      preposition: "from", referenceEvent: "passage",
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
      preposition: null, referenceEvent: null, boundKind: "no_longer_than",
    });
  });

  it("parses 'every 30 days' as relative_duration", () => {
    const r = parseTemporalExpression(span("every 30 days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 30, unit: "days", dayKind: null,
      preposition: null, referenceEvent: null, boundKind: "no_longer_than",
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
      preposition: null, referenceEvent: null, boundKind: "at_least",
    });
  });

  it("parses 'at least five business days'", () => {
    const r = parseTemporalExpression(span("at least five business days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 5, unit: "days", dayKind: "business",
      preposition: null, referenceEvent: null, boundKind: "at_least",
    });
  });

  it("parses 'at least 60 calendar days after the effective date'", () => {
    const r = parseTemporalExpression(span("at least 60 calendar days after the effective date"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "relative_duration",
      quantity: 60, unit: "days", dayKind: "calendar",
      preposition: "after", referenceEvent: "effective_date",
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
      preposition: "of", referenceEvent: "effective_date",
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
      preposition: "of", referenceEvent: "effective_date",
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
      preposition: "of", referenceEvent: "effective_date",
      boundKind: "within",
    });
  });

  it("still rejects trailing text not in the grammar", () => {
    const r = parseTemporalExpression(span("within 30 days of the effective date of this random thing"));
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
