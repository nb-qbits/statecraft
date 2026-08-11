import { describe, it, expect } from "vitest";
import { resolve, RESOLVER_VERSION } from "./resolve.js";
import type { ParsedAnchoredExpression, ResolutionInput } from "./types.js";
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
    if (!result.resolved) return;
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
    if (!result.resolved) return;
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
    if (!result.resolved) return;
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
    if (!result.resolved) return;
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
        boundKind: "within",
      },
      "within 30 days",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.statutoryDate).toBe("2026-04-01");
    expect(result.adjustedDate).toBe("2026-04-01");
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.citations).toContain("Va. Code § 1-210(A)");
    expect(result.packVersion).toBe("us-va/v1");
    expect(result.inputs).toEqual([trigger]);
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
        boundKind: "within",
      },
      "within 5 days",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
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
        boundKind: "within",
      },
      "within one working day",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
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
  it("recurrence → unresolved (repeating obligation, not single deadline)", () => {
    const expr = makeExpr(
      {
        kind: "recurrence",
        frequency: "every",
        quantity: 2,
        unit: "days",
        dayKind: "business",
      },
      "every two business days",
    );
    const result = resolve(expr, [], testPack);
    expect(result.resolved).toBe(false);
    if (result.resolved) return;
    expect(result.reason).toContain("recurrence");
    expect(result.missingInputs).toContain("periodStart");
    expect(result.missingInputs).toContain("periodEnd");
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
    if (!result.resolved) return;
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
        boundKind: "within",
      },
      "within 30 days",
    );
    const result = resolve(expr, [trigger], testPack);
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
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
    if (!result.resolved) return;
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
        dayKind: null, preposition: null, referenceEvent: null, boundKind: "within",
      }, "within 30 days"),
      makeExpr({
        kind: "relative_duration", quantity: 7, unit: "days",
        dayKind: null, preposition: null, referenceEvent: null, boundKind: "no_longer_than",
      }, "no longer than seven days"),
      makeExpr({
        kind: "relative_duration", quantity: 1, unit: "days",
        dayKind: "working", preposition: null, referenceEvent: null, boundKind: "within",
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
        boundKind: "within",
      },
      "within 30 days",
    );
    const r1 = resolve(expr, [trigger], testPack);
    const r2 = resolve(expr, [trigger], testPack);
    expect(r1).toEqual(r2);
  });
});

describe("resolver version", () => {
  it("exports RESOLVER_VERSION", () => {
    expect(RESOLVER_VERSION).toBe("1.0.0");
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
        boundKind: "within",
      },
      "within 30 days after the effective date",
    );
    const result = resolve(expr, [trigger], pack);
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.statutoryDate).toBe("2026-07-31");
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.packVersion).toBe("us-va/v1");
  });
});
