import { describe, it, expect } from "vitest";
import { resolve, RESOLVER_VERSION } from "./resolve.js";
import type { ParsedAnchoredExpression, ResolutionInput, DerivedEffectiveDate } from "./types.js";
import { isResolvedDate, isResolvedRecurrence } from "./types.js";
import type { AnchorId, SegmentId } from "../shared/types.js";
import type { TemporalExpression } from "../grammar/types.js";
import { loadPack, clearPackCache } from "../jurisdiction/pack-loader.js";
import type { JurisdictionPack } from "../jurisdiction/types.js";
import { buildDateSet } from "../jurisdiction/holidays.js";
import { adjustForNonBusinessDay, computeDeadline } from "../jurisdiction/time-computation.js";
import {
  isBusinessDay as isBusinessDayFn,
  isHoliday as isHolidayFn,
} from "../jurisdiction/holidays.js";

const AID = "anc_test123" as AnchorId;
const SID = "seg_test456" as SegmentId;

function makeExpr(
  expression: TemporalExpression,
  text?: string,
): ParsedAnchoredExpression {
  return {
    anchorId: AID,
    segmentId: SID,
    text: text ?? "test expression",
    expression,
  };
}

const testHolidays = {
  "2026": [
    { date: "2026-01-01", name: "New Year's Day", type: "legal_holiday" as const, source: "test", enabled: true },
    { date: "2026-01-19", name: "MLK Day", type: "legal_holiday" as const, source: "test", enabled: true },
    { date: "2026-07-03", name: "Independence Day (observed)", type: "legal_holiday" as const, source: "test", enabled: true },
    { date: "2026-07-04", name: "Independence Day", type: "legal_holiday" as const, source: "test", enabled: true },
    { date: "2026-11-26", name: "Thanksgiving", type: "legal_holiday" as const, source: "test", enabled: true },
    { date: "2026-11-27", name: "Day after Thanksgiving", type: "legal_holiday" as const, source: "test", enabled: true },
    { date: "2026-12-25", name: "Christmas", type: "legal_holiday" as const, source: "test", enabled: true },
  ],
  "2025": [
    { date: "2025-07-04", name: "Independence Day", type: "legal_holiday" as const, source: "test", enabled: true },
  ],
};

const holidaySet = buildDateSet(testHolidays);

const testPack: JurisdictionPack = {
  jurisdiction: "us-va",
  packVersion: "us-va/v1",
  rules: {
    jurisdiction: "us-va",
    packVersion: "1.0.0",
    effectiveDateRules: [],
    timeComputationRules: [],
  },
  holidays: testHolidays,
  getSessionMetadata: () => null,
  deriveEffectiveDate: () => ({ resolved: false, reason: "not implemented in test", missingInputs: [] }),
  adjustForNonBusinessDay: (date: string) => adjustForNonBusinessDay(date, holidaySet),
  computeDeadline: (triggerDate: string, days: number, dayKind: "calendar" | "business" | "working") =>
    computeDeadline(triggerDate, days, dayKind, holidaySet),
  isHoliday: (date: string) => isHolidayFn(date, holidaySet),
  isBusinessDay: (date: string) => isBusinessDayFn(date, holidaySet),
};

describe("resolver — fixed_date", () => {
  it("resolves July 4, 2025 (Friday holiday) → statutory stays, adjusted to Monday July 7", () => {
    const expr = makeExpr(
      { kind: "fixed_date", month: 7, day: 4, year: 2025 },
      "July 4, 2025",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2025-07-04");
    expect(result.adjustedDate).toBe("2025-07-07");
    expect(result.packVersion).toBe("us-va/v1");
  });

  it("July 1, 2026 (Wednesday, not a holiday) — no adjustment but still carries baseline rules", () => {
    const expr = makeExpr(
      { kind: "fixed_date", month: 7, day: 1, year: 2026 },
      "July 1, 2026",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2026-07-01");
    expect(result.adjustedDate).toBe("2026-07-01");
    expect(result.ruleIds).toContain("verbatim-date");
    expect(result.ruleIds).toContain("va-1-210-E-evaluated-no-adjustment");
    expect(result.citations.length).toBeGreaterThan(0);
  });

  it("carries input provenance from the anchored span", () => {
    const expr = makeExpr(
      { kind: "fixed_date", month: 12, day: 1, year: 2026 },
      "December 1, 2026",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.inputs.length).toBe(1);
    expect(result.inputs[0]!.name).toBe("specifiedDate");
    expect(result.inputs[0]!.value).toBe("2026-12-01");
    expect(result.inputs[0]!.source).toBe("anchored_span");
    expect(result.inputs[0]!.citation).toBe("quoted text: 'December 1, 2026'");
  });

  it("fixed date on holiday applies § 1-210(E) rollover with ruleId", () => {
    const expr = makeExpr(
      { kind: "fixed_date", month: 12, day: 25, year: 2026 },
      "December 25, 2026",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2026-12-25");
    expect(result.adjustedDate).toBe("2026-12-28");
    expect(result.ruleIds).toContain("verbatim-date");
    expect(result.ruleIds).toContain("va-1-210-E");
    expect(result.citations).toContain("Va. Code § 1-210(E)");
  });
});

describe("resolver — relative_duration", () => {
  it("missing triggerDate → unresolved with missingInputs", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.missingInputs).toContain("triggerDate");
    expect(result.reason).toContain("triggerDate");
  });

  it("with triggerDate → resolves with § 1-210(A) day exclusion", () => {
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-03-02",
      source: "derived_from_session",
      authority: "Va. Code § 1-214(A)",
      citation: "Va. Code § 1-214(A)",
    };
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2026-04-01");
    expect(result.adjustedDate).toBe("2026-04-01");
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.citations).toContain("Va. Code § 1-210(A)");
    expect(result.packVersion).toBe("us-va/v1");
    expect(result.inputs).toEqual([trigger]);
    expect(result.dateRole).toBe("deadline");
  });

  it("at_least boundKind → dateRole is floor, not deadline", () => {
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-03-02",
      source: "derived_from_session",
      authority: "Va. Code § 1-214(A)",
      citation: "Va. Code § 1-214(A)",
    };
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "at_least",
      },
      "at least 30 days",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.dateRole).toBe("floor");
    expect(result.statutoryDate).toBe("2026-04-01");
  });

  it("within 5 calendar days from Monday June 1 → Sat June 6 → adjusted Mon June 8", () => {
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-06-01",
      source: "user_supplied",
      authority: "user",
      citation: "user-supplied trigger date",
    };
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 5,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
      "within 5 days",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2026-06-06");
    expect(result.adjustedDate).toBe("2026-06-08");
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.ruleIds).toContain("va-1-210-E");
  });

  it("HB 35: 'within one working day' from Friday before MLK", () => {
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-01-16",
      source: "user_supplied",
      authority: "user",
      citation: "user-supplied trigger date",
    };
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 1,
        unit: "days",
        dayKind: "working",
        preposition: null,
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
      "within one working day",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2026-01-20");
    expect(result.adjustedDate).toBe("2026-01-20");
  });

  it("hour-scale durations → unresolved (civil dates only)", () => {
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-03-02",
      source: "user_supplied",
      authority: "user",
      citation: "user-supplied trigger date",
    };
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 24,
        unit: "hours",
        dayKind: null,
        preposition: null,
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
      "within 24 hours",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.reason).toContain("hour-scale");
    expect(result.reason).toContain("civil date");
  });

  it("references effective_date but no triggerDate → warning in unresolved", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: "after",
        referenceEvent: "effective_date",
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days after the effective date",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.missingInputs).toContain("triggerDate");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("effective_date");
  });
});

describe("resolver — recurrence", () => {
  it("bare recurrence without anchor → unresolved with missingInputs anchorDate", () => {
    const expr = makeExpr(
      {
        kind: "recurrence",
        frequency: "quarterly",
        interval: 1,
        byMonth: null,
        byMonthDay: null,
        yearParity: null,
        anchorEvent: null,
        boundKind: "on",
        dayKind: null,
      },
      "quarterly",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.reason).toContain("recurrence");
    expect(result.missingInputs).toContain("anchorDate");
  });

  it("event-anchored recurrence → unresolved with missingInputs sessionDate", () => {
    const expr = makeExpr(
      {
        kind: "recurrence",
        frequency: "yearly",
        interval: 1,
        byMonth: null,
        byMonthDay: null,
        yearParity: null,
        anchorEvent: "regular_session",
        boundKind: "on",
        dayKind: null,
      },
      "the first day of each regular session",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.reason).toContain("session");
    expect(result.missingInputs).toContain("sessionDate");
  });

  it("anchored annual with even-year parity → resolved with occurrences", () => {
    const expr = makeExpr(
      {
        kind: "recurrence",
        frequency: "yearly",
        interval: 1,
        byMonth: 12,
        byMonthDay: 15,
        yearParity: "even",
        anchorEvent: null,
        boundKind: "on",
        dayKind: null,
      },
      "each December 15 in even-numbered years thereafter",
    );
    const result = resolve(expr, [], testPack);
    expect(isResolvedRecurrence(result)).toBe(true);
    if (!isResolvedRecurrence(result)) return;
    expect(result.rrule).toContain("FREQ=YEARLY");
    expect(result.rrule).toContain("INTERVAL=2");
    expect(result.rrule).toContain("BYMONTH=12");
    expect(result.rrule).toContain("BYMONTHDAY=15");
    expect(result.occurrences.length).toBeGreaterThanOrEqual(3);
    const dates = result.occurrences.map((o) => o.occurrenceDate);
    expect(dates).toContain("2026-12-15");
    expect(dates).toContain("2028-12-15");
    expect(dates).toContain("2030-12-15");
    expect(result.yearParityNote).toContain("even");
    expect(result.ruleIds).toContain("recurrence-schedule");
    expect(result.ruleIds).toContain("year-parity-filter");
  });

  it("December 15, 2030 (Sunday) gets § 1-210(E) adjustment to Dec 16", () => {
    const expr = makeExpr(
      {
        kind: "recurrence",
        frequency: "yearly",
        interval: 1,
        byMonth: 12,
        byMonthDay: 15,
        yearParity: "even",
        anchorEvent: null,
        boundKind: "on",
        dayKind: null,
      },
      "each December 15 in even-numbered years thereafter",
    );
    const result = resolve(expr, [], testPack);
    if (!isResolvedRecurrence(result)) return;
    const occ2030 = result.occurrences.find((o) => o.occurrenceDate === "2030-12-15");
    expect(occ2030).toBeDefined();
    expect(occ2030!.adjustedDate).toBe("2030-12-16");
    expect(occ2030!.ruleIds).toContain("va-1-210-E");
  });

  it("combined fixed+recurrence: anchorYear pins dtstart", () => {
    const expr = makeExpr(
      {
        kind: "recurrence",
        frequency: "yearly",
        interval: 1,
        byMonth: 12,
        byMonthDay: 15,
        yearParity: "even",
        anchorEvent: null,
        boundKind: "on",
        dayKind: null,
        anchorYear: 2026,
      },
      "By December 15, 2026, and each December 15 in even-numbered years thereafter",
    );
    const result = resolve(expr, [], testPack);
    expect(isResolvedRecurrence(result)).toBe(true);
    if (!isResolvedRecurrence(result)) return;
    expect(result.rrule).toContain("FREQ=YEARLY");
    expect(result.rrule).toContain("INTERVAL=2");
    const dates = result.occurrences.map((o) => o.occurrenceDate);
    expect(dates).toContain("2026-12-15");
    expect(dates).toContain("2028-12-15");
    expect(dates).toContain("2030-12-15");
  });

  it("every four years without anchor → unresolved with anchorDate missing", () => {
    const expr = makeExpr(
      {
        kind: "recurrence",
        frequency: "yearly",
        interval: 4,
        byMonth: null,
        byMonthDay: null,
        yearParity: null,
        anchorEvent: null,
        boundKind: "on",
        dayKind: null,
      },
      "every four years thereafter",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.missingInputs).toContain("anchorDate");
  });

  it("occurrence IDs are deterministic across two runs", () => {
    const expr = makeExpr(
      {
        kind: "recurrence",
        frequency: "yearly",
        interval: 1,
        byMonth: 12,
        byMonthDay: 15,
        yearParity: "even",
        anchorEvent: null,
        boundKind: "on",
        dayKind: null,
      },
      "each December 15 in even-numbered years thereafter",
    );
    const r1 = resolve(expr, [], testPack);
    const r2 = resolve(expr, [], testPack);
    expect(isResolvedRecurrence(r1)).toBe(true);
    expect(isResolvedRecurrence(r2)).toBe(true);
    if (!isResolvedRecurrence(r1) || !isResolvedRecurrence(r2)) return;
    expect(r1.occurrences).toEqual(r2.occurrences);
  });

  it("each occurrence carries sequenceNumber; adjusted ones carry ruleIds", () => {
    const expr = makeExpr(
      {
        kind: "recurrence",
        frequency: "yearly",
        interval: 1,
        byMonth: 12,
        byMonthDay: 15,
        yearParity: "even",
        anchorEvent: null,
        boundKind: "on",
        dayKind: null,
      },
      "each December 15 in even-numbered years thereafter",
    );
    const result = resolve(expr, [], testPack);
    if (!isResolvedRecurrence(result)) return;
    for (const occ of result.occurrences) {
      expect(occ.sequenceNumber).toBeGreaterThan(0);
      if (occ.adjustedDate !== occ.occurrenceDate) {
        expect(occ.ruleIds).toContain("va-1-210-E");
        expect(occ.citations).toContain("Va. Code § 1-210(E)");
      }
    }
  });
});

describe("INV-5 — type-level enforcement", () => {
  it("resolve requires ParsedAnchoredExpression, not a bare expression", () => {
    // @ts-expect-error — bare expression is not ParsedAnchoredExpression
    expect(() => resolve({ kind: "fixed_date", month: 7, day: 1, year: 2026 }, [], testPack)).toThrow();
  });
});

describe("INV-6 — every resolved date carries citations", () => {
  it("fixed_date with adjustment carries § 1-210(E) citation", () => {
    const expr = makeExpr(
      { kind: "fixed_date", month: 12, day: 25, year: 2026 },
      "December 25, 2026",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.ruleIds.length).toBeGreaterThan(0);
    expect(result.packVersion).toBeTruthy();
  });

  it("relative_duration with trigger carries § 1-210(A) citation", () => {
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-03-02",
      source: "user_supplied",
      authority: "user",
      citation: "test",
    };
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.citations).toContain("Va. Code § 1-210(A)");
  });

  it("input provenance is never empty on resolved results", () => {
    const expr = makeExpr(
      { kind: "fixed_date", month: 7, day: 1, year: 2026 },
      "July 1, 2026",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.inputs.length).toBeGreaterThan(0);
    const input = result.inputs[0]!;
    expect(input.name).toBeTruthy();
    expect(input.value).toBeTruthy();
    expect(input.source).toBeTruthy();
    expect(input.authority).toBeTruthy();
    expect(input.citation).toBeTruthy();
  });

  it("zero resolved results may have empty citations — every kind carries a legal basis", () => {
    const allExprs: ParsedAnchoredExpression[] = [
      makeExpr({ kind: "fixed_date", month: 7, day: 1, year: 2026 }, "July 1, 2026"),
      makeExpr({ kind: "fixed_date", month: 12, day: 25, year: 2026 }, "December 25, 2026"),
      makeExpr({ kind: "fixed_date", month: 1, day: 1, year: 2026 }, "January 1, 2026"),
    ];
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-03-02",
      source: "user_supplied",
      authority: "user",
      citation: "test",
    };
    const durationExprs: ParsedAnchoredExpression[] = [
      makeExpr({
        kind: "relative_duration", quantity: 30, unit: "days",
        dayKind: null, preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "within",
      }, "within 30 days"),
      makeExpr({
        kind: "relative_duration", quantity: 7, unit: "days",
        dayKind: null, preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "no_longer_than",
      }, "no longer than seven days"),
      makeExpr({
        kind: "relative_duration", quantity: 1, unit: "days",
        dayKind: "working", preposition: null, referenceEvent: null, referenceEventText: null, boundKind: "within",
      }, "within one working day"),
    ];

    for (const expr of allExprs) {
      const result = resolve(expr, [], testPack);
      if (result.resolved) {
        expect(result.citations.length, `"${expr.text}" must have citations`).toBeGreaterThan(0);
        expect(result.ruleIds.length, `"${expr.text}" must have ruleIds`).toBeGreaterThan(0);
      }
    }
    for (const expr of durationExprs) {
      const result = resolve(expr, [trigger], testPack);
      if (result.resolved) {
        expect(result.citations.length, `"${expr.text}" must have citations`).toBeGreaterThan(0);
        expect(result.ruleIds.length, `"${expr.text}" must have ruleIds`).toBeGreaterThan(0);
      }
    }
  });
});

describe("reproducibility — same inputs produce same output", () => {
  it("identical inputs and pack produce identical result", () => {
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-03-02",
      source: "derived_from_session",
      authority: "Va. Code § 1-214(A)",
      citation: "Va. Code § 1-214(A)",
    };
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days",
    );
    const r1 = resolve(expr, [trigger], testPack);
    const r2 = resolve(expr, [trigger], testPack);
    expect(r1).toEqual(r2);
  });
});

describe("resolver — calendar_year_anchored_date", () => {
  it("resolves 'December 31 of the first calendar year' after Jan 28, 2016 → Dec 31, 2017", () => {
    const expr = makeExpr({
      kind: "calendar_year_anchored_date",
      month: 12,
      day: 31,
      calendarYearOffset: 1,
      referenceEvent: "enactment",
      referenceEventText: null,
    });
    const enactment: ResolutionInput = {
      name: "enactmentDate",
      value: "2016-01-28",
      source: "document_text",
      authority: "act_text",
      citation: "Approved January 28, 2016",
    };
    const r = resolve(expr, [enactment], testPack);
    expect(r.resolved).toBe(true);
    if (!r.resolved || !("statutoryDate" in r)) return;
    expect(r.statutoryDate).toBe("2017-12-31");
    expect(r.ruleIds).toContain("calendar-year-offset");
  });

  it("resolves second calendar year after 2016 → 2018", () => {
    const expr = makeExpr({
      kind: "calendar_year_anchored_date",
      month: 3,
      day: 31,
      calendarYearOffset: 2,
      referenceEvent: "enactment",
      referenceEventText: null,
    });
    const enactment: ResolutionInput = {
      name: "enactmentDate",
      value: "2016-01-28",
      source: "document_text",
      authority: "act_text",
      citation: "Approved January 28, 2016",
    };
    const r = resolve(expr, [enactment], testPack);
    expect(r.resolved).toBe(true);
    if (!r.resolved || !("statutoryDate" in r)) return;
    expect(r.statutoryDate).toBe("2018-03-31");
  });

  it("refuses when enactment date is unavailable", () => {
    const expr = makeExpr({
      kind: "calendar_year_anchored_date",
      month: 12,
      day: 31,
      calendarYearOffset: 1,
      referenceEvent: "enactment",
      referenceEventText: null,
    });
    const r = resolve(expr, [], testPack);
    expect(r.resolved).toBe(false);
    if (r.resolved) return;
    if ("bounded" in r && r.bounded) throw new Error("expected non-bounded");
    expect(r.refusalKind).toBe("undated_event");
    expect(r.missingInputs).toContain("enactmentDate");
  });

  it("refuses with referenceEventText for unknown events", () => {
    const expr = makeExpr({
      kind: "calendar_year_anchored_date",
      month: 6,
      day: 30,
      calendarYearOffset: 1,
      referenceEvent: null,
      referenceEventText: "the certification of results",
    });
    const r = resolve(expr, [], testPack);
    expect(r.resolved).toBe(false);
    if (r.resolved) return;
    if ("bounded" in r && r.bounded) throw new Error("expected non-bounded");
    expect(r.refusalKind).toBe("undated_event");
    expect(r.reason).toContain("certification of results");
  });
});

describe("resolver version", () => {
  it("exports RESOLVER_VERSION", () => {
    expect(RESOLVER_VERSION).toBe("1.10.0");
  });
});

describe("derived effective date — auto-trigger for effective_date references", () => {
  const derivedED: DerivedEffectiveDate = {
    date: "2026-07-01",
    ruleId: "va-1-214-A-default",
    citation: "Va. Code § 1-214(A)",
    sessionSource: "test fixture — sine die 2026-03-14",
  };

  it("resolves 'within 90 days of the effective date' using derived effective date", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 90,
        unit: "days",
        dayKind: null,
        preposition: "of",
        referenceEvent: "effective_date",
        referenceEventText: null,
        boundKind: "within",
      },
      "within 90 days of the effective date of this chapter",
    );
    const result = resolve(expr, [], testPack, derivedED);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2026-09-29");
    expect(result.ruleIds).toContain("va-1-214-A-default");
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.citations).toContain("Va. Code § 1-214(A)");
    expect(result.citations).toContain("Va. Code § 1-210(A)");
  });

  it("resolves 'within 60 days of the effective date' using derived effective date", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 60,
        unit: "days",
        dayKind: null,
        preposition: "of",
        referenceEvent: "effective_date",
        referenceEventText: null,
        boundKind: "within",
      },
      "within 60 days of the effective date of this act",
    );
    const result = resolve(expr, [], testPack, derivedED);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2026-08-30");
    expect(result.ruleIds).toContain("va-1-214-A-default");
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.citations).toContain("Va. Code § 1-214(A)");
    expect(result.citations).toContain("Va. Code § 1-210(A)");
  });

  it("includes derived effectiveDate input with provenance, not user-supplied", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: "of",
        referenceEvent: "effective_date",
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days of the effective date",
    );
    const result = resolve(expr, [], testPack, derivedED);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.inputs.length).toBe(1);
    const input = result.inputs[0]!;
    expect(input.name).toBe("effectiveDate");
    expect(input.value).toBe("2026-07-01");
    expect(input.source).toBe("derived: Va. Code § 1-214(A) (adjournment: test fixture — sine die 2026-03-14)");
    expect(input.authority).toBe("jurisdiction_pack");
    expect(input.citation).toBe("Va. Code § 1-214(A)");
  });

  it("explicit triggerDate takes precedence over derived effective date", () => {
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-01-01",
      source: "user_supplied",
      authority: "user",
      citation: "user-supplied trigger date",
    };
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: "of",
        referenceEvent: "effective_date",
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days of the effective date",
    );
    const result = resolve(expr, [trigger], testPack, derivedED);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2026-01-31");
    expect(result.inputs).toEqual([trigger]);
    expect(result.ruleIds).not.toContain("va-1-214-A-default");
  });

  it("does NOT apply derived effective date to expressions without referenceEvent", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: null,
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days",
    );
    const result = resolve(expr, [], testPack, derivedED);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.missingInputs).toContain("triggerDate");
  });

  it("does NOT apply derived effective date to non-effective_date references", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: "after",
        referenceEvent: "enactment",
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days after enactment",
    );
    const result = resolve(expr, [], testPack, derivedED);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.missingInputs).toContain("enactmentDate");
  });

  it("remains unresolved when derivedEffectiveDate not provided", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 90,
        unit: "days",
        dayKind: null,
        preposition: "of",
        referenceEvent: "effective_date",
        referenceEventText: null,
        boundKind: "within",
      },
      "within 90 days of the effective date",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.missingInputs).toContain("triggerDate");
  });
});

describe("enactment date resolution", () => {
  it("resolves 180 days after enactment when enactmentDate is supplied", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 180,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: "enactment",
        referenceEventText: null,
        boundKind: "no_longer_than",
      },
      "Not later than 180 days after the date of the enactment of this Act",
    );
    const enactmentInput: ResolutionInput = {
      name: "enactmentDate",
      value: "2016-01-28",
      source: "document_text",
      authority: "act_text",
      citation: "Approved January 28, 2016",
    };
    const result = resolve(expr, [enactmentInput], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2016-07-26");
  });

  it("resolves 6 months after enactment", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 6,
        unit: "months",
        dayKind: null,
        preposition: null,
        referenceEvent: "enactment",
        referenceEventText: null,
        boundKind: "no_longer_than",
      },
      "6 months after the date of the enactment of this Act",
    );
    const enactmentInput: ResolutionInput = {
      name: "enactmentDate",
      value: "2016-01-28",
      source: "document_text",
      authority: "act_text",
      citation: "Approved January 28, 2016",
    };
    const result = resolve(expr, [enactmentInput], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2016-07-28");
  });

  it("resolves 1 year after enactment", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 1,
        unit: "years",
        dayKind: null,
        preposition: null,
        referenceEvent: "enactment",
        referenceEventText: null,
        boundKind: "no_longer_than",
      },
      "1 year after the date of the enactment of this Act",
    );
    const enactmentInput: ResolutionInput = {
      name: "enactmentDate",
      value: "2016-01-28",
      source: "document_text",
      authority: "act_text",
      citation: "Approved January 28, 2016",
    };
    const result = resolve(expr, [enactmentInput], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2017-01-28");
  });

  it("fails with undated_event when no enactmentDate supplied", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 180,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: "enactment",
        referenceEventText: null,
        boundKind: "no_longer_than",
      },
      "Not later than 180 days after enactment",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    if ("bounded" in result && result.bounded) throw new Error("expected non-bounded");
    expect(result.refusalKind).toBe("undated_event");
    expect(result.reason).toContain("enactment date not available");
    expect(result.missingInputs).toContain("enactmentDate");
  });
});

describe("bounded dates (cap clause)", () => {
  it("produces bounded unresolved when trigger is missing but cap exists", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 90,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: null,
        referenceEventText: "the date on which all notices have been submitted",
        boundKind: "no_longer_than",
        capDate: { month: 3, day: 31, year: 2018, capKind: "sooner" },
      },
      "90 days after notices, or March 31, 2018, whichever is sooner",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect("bounded" in result && result.bounded).toBe(true);
    if (!("bounded" in result) || !result.bounded) return;
    expect(result.upperBound).toBe("2018-03-31");
    expect(result.reason).toContain("on or before");
  });

  it("applies cap when resolved date exceeds cap (sooner)", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 180,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: "enactment",
        referenceEventText: null,
        boundKind: "no_longer_than",
        capDate: { month: 3, day: 31, year: 2016, capKind: "sooner" },
      },
      "180 days after enactment or March 31, 2016, whichever is sooner",
    );
    const enactmentInput: ResolutionInput = {
      name: "enactmentDate",
      value: "2016-01-28",
      source: "document_text",
      authority: "act_text",
      citation: "Approved January 28, 2016",
    };
    const result = resolve(expr, [enactmentInput], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2016-03-31");
    expect(result.ruleIds).toContain("cap-date-applied");
  });

  it("does not apply cap when resolved date is before cap (sooner)", () => {
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: "enactment",
        referenceEventText: null,
        boundKind: "no_longer_than",
        capDate: { month: 12, day: 31, year: 2016, capKind: "sooner" },
      },
      "30 days after enactment or December 31, 2016, whichever is sooner",
    );
    const enactmentInput: ResolutionInput = {
      name: "enactmentDate",
      value: "2016-01-28",
      source: "document_text",
      authority: "act_text",
      citation: "Approved January 28, 2016",
    };
    const result = resolve(expr, [enactmentInput], testPack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2016-02-27");
    expect(result.ruleIds).not.toContain("cap-date-applied");
  });
});

describe("real pack integration", () => {
  it("resolves through the actual us-va pack", () => {
    clearPackCache();
    const pack = loadPack("us-va", "1.0.0");
    const trigger: ResolutionInput = {
      name: "triggerDate",
      value: "2026-07-01",
      source: "derived_from_session",
      authority: "Va. Code § 1-214(A)",
      citation: "Va. Code § 1-214(A)",
    };
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 30,
        unit: "days",
        dayKind: null,
        preposition: null,
        referenceEvent: "effective_date",
        referenceEventText: null,
        boundKind: "within",
      },
      "within 30 days after the effective date",
    );
    const result = resolve(expr, [trigger], pack);
    expect(result.resolved).toBe(true);
    if (!isResolvedDate(result)) return;
    expect(result.statutoryDate).toBe("2026-07-31");
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.packVersion).toBe("us-va/v1");
  });

  it("session 2026 metadata loads from pack and produces resolved effective date", () => {
    clearPackCache();
    const pack = loadPack("us-va", "1.0.0");
    const sessionRecord = pack.getSessionMetadata("2026");
    expect(sessionRecord).not.toBeNull();
    expect(sessionRecord!.sessionType).toBe("regular");
    expect(sessionRecord!.adjournmentDate).toBe("2026-03-14");
    expect(sessionRecord!.adjournmentKind).toBe("sine_die");
    expect(sessionRecord!.source).toBeTruthy();
    expect(sessionRecord!.retrievedAt).toBeTruthy();

    const edResult = pack.deriveEffectiveDate({
      sessionType: sessionRecord!.sessionType,
      adjournmentDate: sessionRecord!.adjournmentDate,
      actType: "ordinary",
      specifiedDate: null,
      passageDate: null,
    });
    expect(edResult.resolved).toBe(true);
    if (!edResult.resolved) return;
    expect(edResult.date).toBe("2026-07-01");
    expect(edResult.ruleId).toBe("va-1-214-A-default");
  });

  it("session with no entry produces null — never a default", () => {
    clearPackCache();
    const pack = loadPack("us-va", "1.0.0");
    const noEntry = pack.getSessionMetadata("2099");
    expect(noEntry).toBeNull();
  });

  it("missing session entry leaves effective_date durations unresolved", () => {
    clearPackCache();
    const pack = loadPack("us-va", "1.0.0");
    const expr = makeExpr(
      {
        kind: "relative_duration",
        quantity: 90,
        unit: "days",
        dayKind: null,
        preposition: "of",
        referenceEvent: "effective_date",
        referenceEventText: null,
        boundKind: "within",
      },
      "within 90 days of the effective date of this chapter",
    );
    // No derivedEffectiveDate — simulating missing session entry
    const result = resolve(expr, [], pack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.missingInputs).toContain("triggerDate");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("effective_date");
  });
});

describe("PLAW-114publ117 (GONE Act) — 6 findings from production spans: 2 computed, 1 bounded, 3 refused", () => {
  const enactmentInput: ResolutionInput = {
    name: "enactmentDate",
    value: "2016-01-28",
    source: "document_text",
    authority: "act_text",
    citation: "Approved January 28, 2016",
  };

  const defaultPack: JurisdictionPack = {
    jurisdiction: "default",
    packVersion: "default/v1",
    rules: {
      jurisdiction: "default",
      packVersion: "default/v1",
      effectiveDateRules: [],
      timeComputationRules: [],
    },
    holidays: {},
    getSessionMetadata: () => null,
    deriveEffectiveDate: () => ({ resolved: false, reason: "no default", missingInputs: [] }),
    adjustForNonBusinessDay: (date: string) => ({
      statutoryDate: date,
      adjustedDate: date,
      wasAdjusted: false,
      ruleIds: [],
      citations: [],
      packVersion: "default/v1",
    }),
    computeDeadline: (triggerDate: string, days: number) => {
      const d = new Date(triggerDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      const iso = d.toISOString().slice(0, 10);
      return { statutoryDate: iso, adjustedDate: iso, wasAdjusted: false, ruleIds: [], citations: [], packVersion: "default/v1" };
    },
    isHoliday: () => false,
    isBusinessDay: () => true,
  };

  it("§2(a)(1) COMPUTED: Dec 31 of the first calendar year after enactment → 2017-12-31", () => {
    const expr = makeExpr({
      kind: "calendar_year_anchored_date",
      month: 12,
      day: 31,
      calendarYearOffset: 1,
      referenceEvent: "enactment",
      referenceEventText: null,
    }, "not later than December 31 of the first calendar year beginning after the date of the enactment of this Act");
    const r = resolve(expr, [enactmentInput], defaultPack);
    expect(r.resolved).toBe(true);
    if (!isResolvedDate(r)) return;
    expect(r.statutoryDate).toBe("2017-12-31");
    expect(r.adjustedDate).toBe("2017-12-31");
    expect(r.ruleIds).toContain("calendar-year-offset");
  });

  it("§2(a) COMPUTED: 180 days after enactment → 2016-07-26", () => {
    const expr = makeExpr({
      kind: "relative_duration",
      quantity: 180,
      unit: "days",
      dayKind: null,
      preposition: null,
      referenceEvent: "enactment",
      referenceEventText: null,
      boundKind: "no_longer_than",
    }, "Not later than 180 days after the date of the enactment of this Act");
    const r = resolve(expr, [enactmentInput], defaultPack);
    expect(r.resolved).toBe(true);
    if (!isResolvedDate(r)) return;
    expect(r.statutoryDate).toBe("2016-07-26");
  });

  it("§2(b)(1) REFUSED: 1 year after report submission → undated_event (no cap clause in extracted span)", () => {
    const expr = makeExpr({
      kind: "relative_duration",
      quantity: 1,
      unit: "years",
      dayKind: null,
      preposition: null,
      referenceEvent: null,
      referenceEventText: "the date on which the head of an agency submits the report required under subsection (a)",
      boundKind: "no_longer_than",
    }, "Not later than 1 year after the date on which the head of an agency submits the report required under subsection (a)");
    const r = resolve(expr, [enactmentInput], defaultPack);
    expect(r.resolved).toBe(false);
    if (r.resolved) return;
    expect("bounded" in r && r.bounded).toBeFalsy();
    if ("bounded" in r && r.bounded) return;
    expect(r.refusalKind).toBe("undated_event");
    expect(r.reason).toContain("head of an agency submits the report");
  });

  it("§2(b)(2) BOUNDED: 90 days after notices, cap Mar 31 2018 (service-resolved CapDateRef) → bounded at 2018-03-31", () => {
    const expr = makeExpr({
      kind: "relative_duration",
      quantity: 90,
      unit: "days",
      dayKind: null,
      preposition: null,
      referenceEvent: null,
      referenceEventText: "the date on which all of the notices required pursuant to paragraph (1) have been provided",
      boundKind: "no_longer_than",
      capDate: { month: 3, day: 31, year: 2018, capKind: "sooner" as const },
    }, "Not later than 90 days after the date on which all of the notices required pursuant to paragraph (1) have been provided or March 31 of the calendar year following the calendar year described in subsection (a)(1), whichever is sooner");
    const r = resolve(expr, [enactmentInput], defaultPack);
    expect(r.resolved).toBe(false);
    if (r.resolved) return;
    expect("bounded" in r && r.bounded).toBe(true);
    if (!("bounded" in r) || !r.bounded) return;
    expect(r.upperBound).toBe("2018-03-31");
    expect(r.reason).toContain("on or before");
    expect(r.reason).toContain("2018-03-31");
  });

  it("§2(c) REFUSED: 1 year after notice to Congress → undated_event", () => {
    const expr = makeExpr({
      kind: "relative_duration",
      quantity: 1,
      unit: "years",
      dayKind: null,
      preposition: null,
      referenceEvent: null,
      referenceEventText: "the date on which the head of an agency provides notice to Congress under subsection (b)(2)",
      boundKind: "no_longer_than",
    }, "Not later than 1 year after the date on which the head of an agency provides notice to Congress under subsection (b)(2)");
    const r = resolve(expr, [enactmentInput], defaultPack);
    expect(r.resolved).toBe(false);
    if (r.resolved) return;
    expect("bounded" in r && r.bounded).toBeFalsy();
    if ("bounded" in r && r.bounded) return;
    expect(r.refusalKind).toBe("undated_event");
    expect(r.reason).toContain("notice to Congress");
  });

  it("§2(d) REFUSED: 6 months after second report → undated_event", () => {
    const expr = makeExpr({
      kind: "relative_duration",
      quantity: 6,
      unit: "months",
      dayKind: null,
      preposition: null,
      referenceEvent: null,
      referenceEventText: "the date on which the second report is submitted pursuant to subsection (b)(2)",
      boundKind: "no_longer_than",
    }, "Not later than 6 months after the date on which the second report is sub- mitted pursuant to subsection (b)(2)");
    const r = resolve(expr, [enactmentInput], defaultPack);
    expect(r.resolved).toBe(false);
    if (r.resolved) return;
    expect("bounded" in r && r.bounded).toBeFalsy();
    if ("bounded" in r && r.bounded) return;
    expect(r.refusalKind).toBe("undated_event");
    expect(r.reason).toContain("second report is submitted");
  });
});

describe("CapDateRef — dependency reference cap clause", () => {
  it("CapDateRef without resolved dependency → unresolved_dependency refusal", () => {
    const expr = makeExpr({
      kind: "relative_duration",
      quantity: 150,
      unit: "days",
      dayKind: null,
      preposition: null,
      referenceEvent: null,
      referenceEventText: "submission of inventory",
      boundKind: "no_longer_than",
      capDate: {
        month: 12,
        day: 31,
        yearSource: "dependency_ref" as const,
        dependencyRef: "(a)(1)",
        yearOffset: 1,
        capKind: "sooner" as const,
      },
    }, "150 days after submission, or December 31 of the calendar year following subsection (a)(1)");
    const r = resolve(expr, [], testPack);
    expect(r.resolved).toBe(false);
    if (r.resolved) return;
    if ("bounded" in r && r.bounded) throw new Error("expected non-bounded");
    expect(r.refusalKind).toBe("unresolved_dependency");
    expect(r.reason).toContain("(a)(1)");
  });
});

describe("resolution invariant: resolved ↔ date/rrule consistency", () => {
  const trigger: ResolutionInput = {
    name: "triggerDate", value: "2026-06-01",
    source: "test", authority: "test", citation: "test",
  };

  const cases: Array<{ label: string; expr: ParsedAnchoredExpression; inputs: ResolutionInput[] }> = [
    {
      label: "fixed date with year",
      expr: makeExpr({ kind: "fixed_date", month: 12, day: 15, year: 2026 }),
      inputs: [],
    },
    {
      label: "fixed date without year",
      expr: makeExpr({ kind: "fixed_date", month: 8, day: 1, year: null }),
      inputs: [],
    },
    {
      label: "relative duration with trigger",
      expr: makeExpr({
        kind: "relative_duration", quantity: 30, unit: "days",
        preposition: "within", dayKind: null, referenceEvent: null,
        referenceEventText: null, boundKind: "within",
      }),
      inputs: [trigger],
    },
    {
      label: "relative duration without trigger",
      expr: makeExpr({
        kind: "relative_duration", quantity: 30, unit: "days",
        preposition: "within", dayKind: null, referenceEvent: null,
        referenceEventText: null, boundKind: "within",
      }),
      inputs: [],
    },
    {
      label: "recurrence with anchor year",
      expr: makeExpr({
        kind: "recurrence", frequency: "yearly", interval: 2,
        byMonth: 12, byMonthDay: 15, yearParity: "even",
        anchorEvent: null, boundKind: "on", dayKind: null, anchorYear: 2026,
      }),
      inputs: [],
    },
    {
      label: "recurrence without anchor",
      expr: makeExpr({
        kind: "recurrence", frequency: "yearly", interval: 1,
        byMonth: null, byMonthDay: null, yearParity: null,
        anchorEvent: null, boundKind: "on", dayKind: null,
      }),
      inputs: [],
    },
  ];

  for (const { label, expr, inputs } of cases) {
    it(`${label}: resolved=false implies no statutoryDate and no rrule`, () => {
      const result = resolve(expr, inputs, testPack);
      if (!result.resolved) {
        expect("statutoryDate" in result).toBe(false);
        expect("rrule" in result).toBe(false);
      }
    });

    it(`${label}: statutoryDate or rrule present implies resolved=true`, () => {
      const result = resolve(expr, inputs, testPack);
      if ("statutoryDate" in result || "rrule" in result) {
        expect(result.resolved).toBe(true);
      }
    });
  }
});
