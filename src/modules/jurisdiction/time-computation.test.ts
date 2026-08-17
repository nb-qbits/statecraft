import { describe, it, expect } from "vitest";
import { adjustForNonBusinessDay, computeDeadline } from "./time-computation.js";
import { buildDateSet } from "./holidays.js";
import type { HolidayCalendar } from "./types.js";

const H = "legal_holiday" as const;
const S = "va-code-2.2-3300";

const TEST_HOLIDAYS: HolidayCalendar = {
  "2026": [
    { date: "2026-01-01", name: "New Year's Day", type: H, source: S, enabled: true },
    { date: "2026-01-19", name: "Martin Luther King Jr. Day", type: H, source: S, enabled: true },
    { date: "2026-07-03", name: "Independence Day (observed)", type: H, source: S, enabled: true },
    { date: "2026-07-04", name: "Independence Day", type: H, source: S, enabled: true },
    { date: "2026-11-26", name: "Thanksgiving Day", type: H, source: S, enabled: true },
    { date: "2026-11-27", name: "Friday after Thanksgiving", type: H, source: S, enabled: true },
    { date: "2026-12-25", name: "Christmas Day", type: H, source: S, enabled: true },
  ],
  "2027": [
    { date: "2027-01-01", name: "New Year's Day", type: H, source: S, enabled: true },
  ],
};

const holidaySet = buildDateSet(TEST_HOLIDAYS);

describe("§ 1-210(A) — day-of-event exclusion", () => {
  it("within 30 calendar days from Monday 2026-01-05: starts counting from Jan 6", () => {
    const result = computeDeadline("2026-01-05", 30, "calendar", holidaySet);
    expect(result.statutoryDate).toBe("2026-02-04");
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.citations).toContain("Va. Code § 1-210(A)");
  });

  it("within 1 calendar day from 2026-03-10 → 2026-03-11", () => {
    const result = computeDeadline("2026-03-10", 1, "calendar", holidaySet);
    expect(result.statutoryDate).toBe("2026-03-11");
  });

  it("trigger event day is excluded — not counted as day zero", () => {
    const result = computeDeadline("2026-06-01", 5, "calendar", holidaySet);
    expect(result.statutoryDate).toBe("2026-06-06");
    expect(result.adjustedDate).toBe("2026-06-08");
    expect(result.wasAdjusted).toBe(true);
  });
});

describe("§ 1-210(E) — rollover to next business day", () => {
  describe("specified dates falling on non-business days", () => {
    it("Saturday 2026-01-03 → rolls to Monday 2026-01-05", () => {
      const result = adjustForNonBusinessDay("2026-01-03", holidaySet);
      expect(result.statutoryDate).toBe("2026-01-03");
      expect(result.adjustedDate).toBe("2026-01-05");
      expect(result.wasAdjusted).toBe(true);
      expect(result.ruleIds).toContain("va-1-210-E");
      expect(result.citations).toContain("Va. Code § 1-210(E)");
    });

    it("Sunday 2026-01-04 → rolls to Monday 2026-01-05", () => {
      const result = adjustForNonBusinessDay("2026-01-04", holidaySet);
      expect(result.adjustedDate).toBe("2026-01-05");
      expect(result.wasAdjusted).toBe(true);
    });

    it("holiday 2026-01-01 (Thursday) → rolls to Friday 2026-01-02", () => {
      const result = adjustForNonBusinessDay("2026-01-01", holidaySet);
      expect(result.statutoryDate).toBe("2026-01-01");
      expect(result.adjustedDate).toBe("2026-01-02");
      expect(result.wasAdjusted).toBe(true);
    });

    it("holiday on Friday + weekend → rolls to Monday", () => {
      const result = adjustForNonBusinessDay("2026-07-03", holidaySet);
      expect(result.statutoryDate).toBe("2026-07-03");
      expect(result.adjustedDate).toBe("2026-07-06");
      expect(result.wasAdjusted).toBe(true);
    });

    it("Thanksgiving Thursday + Friday after → rolls to Monday", () => {
      const result = adjustForNonBusinessDay("2026-11-26", holidaySet);
      expect(result.adjustedDate).toBe("2026-11-30");
      expect(result.wasAdjusted).toBe(true);
    });

    it("business day remains unchanged", () => {
      const result = adjustForNonBusinessDay("2026-01-05", holidaySet);
      expect(result.adjustedDate).toBe("2026-01-05");
      expect(result.wasAdjusted).toBe(false);
      expect(result.ruleIds).toEqual(["va-1-210-E-evaluated-no-adjustment"]);
      expect(result.citations).toEqual([
        "Va. Code § 1-210(E) evaluated — date falls on a business day, no adjustment required",
      ]);
    });
  });

  describe("computed periods landing on non-business days", () => {
    it("30 calendar days from 2026-06-01 → June 6 (Sat) → adjusted to Mon June 8", () => {
      const result = computeDeadline("2026-06-01", 5, "calendar", holidaySet);
      expect(result.statutoryDate).toBe("2026-06-06");
      expect(result.adjustedDate).toBe("2026-06-08");
      expect(result.wasAdjusted).toBe(true);
      expect(result.ruleIds).toContain("va-1-210-A");
      expect(result.ruleIds).toContain("va-1-210-E");
    });

    it("computed deadline on holiday: 19 days from Jan 1 → Jan 20 is MLK Monday → rolls to Jan 20 is holiday → Jan 21", () => {
      const result = computeDeadline("2026-01-01", 19, "calendar", holidaySet);
      expect(result.statutoryDate).toBe("2026-01-20");
    });
  });

  describe("INV-6: packVersion present on every result", () => {
    it("adjustForNonBusinessDay carries packVersion", () => {
      const result = adjustForNonBusinessDay("2026-01-05", holidaySet);
      expect(result.packVersion).toBe("1.0.0");
    });

    it("computeDeadline carries packVersion", () => {
      const result = computeDeadline("2026-01-05", 5, "calendar", holidaySet);
      expect(result.packVersion).toBe("1.0.0");
    });
  });
});

describe("business/working day counting", () => {
  it("within 1 business day from Friday → next Monday (no holiday)", () => {
    const result = computeDeadline("2026-01-09", 1, "business", holidaySet);
    expect(result.adjustedDate).toBe("2026-01-12");
  });

  it("within 5 business days from Monday 2026-01-05 → Monday 2026-01-12", () => {
    const result = computeDeadline("2026-01-05", 5, "business", holidaySet);
    expect(result.adjustedDate).toBe("2026-01-12");
  });

  it("within 1 working day skips weekend: trigger Friday 2026-01-16 → Tue Jan 20 (MLK Mon is holiday)", () => {
    const result = computeDeadline("2026-01-16", 1, "working", holidaySet);
    expect(result.adjustedDate).toBe("2026-01-20");
  });

  it("HB 35 scenario: 'within one working day' from Friday before MLK → skips Sat, Sun, MLK Monday", () => {
    const result = computeDeadline("2026-01-16", 1, "working", holidaySet);
    expect(result.statutoryDate).toBe("2026-01-20");
  });

  it("HB 35 scenario: 'every two business days' — counts only business days", () => {
    const result = computeDeadline("2026-01-05", 2, "business", holidaySet);
    expect(result.adjustedDate).toBe("2026-01-07");
  });
});

describe("enabled field — disabled entries are not holidays", () => {
  it("a disabled holiday is treated as a business day", () => {
    const calWithDisabled: HolidayCalendar = {
      "2026": [
        { date: "2026-01-01", name: "New Year's Day", type: H, source: S, enabled: false },
      ],
    };
    const disabledSet = buildDateSet(calWithDisabled);
    const result = adjustForNonBusinessDay("2026-01-01", disabledSet);
    expect(result.wasAdjusted).toBe(false);
    expect(result.adjustedDate).toBe("2026-01-01");
  });
});

describe("§ 1-210(E) applies to SPECIFIED dates, not only computed periods", () => {
  it("July 1, 2026 is a Wednesday → no adjustment needed", () => {
    const result = adjustForNonBusinessDay("2026-07-01", holidaySet);
    expect(result.wasAdjusted).toBe(false);
    expect(result.adjustedDate).toBe("2026-07-01");
  });

  it("a specified effective date of January 1, 2027 (Friday holiday) → rolls past weekend to Monday Jan 4", () => {
    const result = adjustForNonBusinessDay("2027-01-01", holidaySet);
    expect(result.wasAdjusted).toBe(true);
    expect(result.adjustedDate).toBe("2027-01-04");
    expect(result.ruleIds).toContain("va-1-210-E");
  });

  it("a specified date of December 25, 2026 (holiday, Friday) → rolls to Monday Dec 28", () => {
    const result = adjustForNonBusinessDay("2026-12-25", holidaySet);
    expect(result.wasAdjusted).toBe(true);
    expect(result.adjustedDate).toBe("2026-12-28");
  });
});
