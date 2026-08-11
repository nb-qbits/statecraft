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
    expect(GRAMMAR_VERSION).toBe("1.0.0");
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

describe("recurrence", () => {
  it("parses 'every two business days'", () => {
    const r = parseTemporalExpression(span("every two business days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence",
      frequency: "every",
      quantity: 2, unit: "days", dayKind: "business",
    });
  });

  it("parses 'every 30 days'", () => {
    const r = parseTemporalExpression(span("every 30 days"));
    expect(r.result.parsed).toBe(true);
    if (!r.result.parsed) return;
    expect(r.result.expression).toEqual({
      kind: "recurrence",
      frequency: "every",
      quantity: 30, unit: "days", dayKind: null,
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
