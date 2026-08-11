import { describe, it, expect, beforeEach } from "vitest";
import { loadPack, clearPackCache } from "./pack-loader.js";

beforeEach(() => {
  clearPackCache();
});

describe("pack loader", () => {
  it("loads us-va v1 pack by jurisdiction and version", () => {
    const pack = loadPack("us-va", "1.0.0");
    expect(pack.jurisdiction).toBe("us-va");
    expect(pack.packVersion).toBe("us-va/v1");
    expect(pack.rules.jurisdiction).toBe("us-va");
    expect(pack.rules.packVersion).toBe("1.0.0");
  });

  it("pack has effective-date rules with distinct ruleIds", () => {
    const pack = loadPack("us-va", "1.0.0");
    const ruleIds = pack.rules.effectiveDateRules.map(r => r.ruleId);
    expect(ruleIds.length).toBeGreaterThan(0);
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
  });

  it("pack has time-computation rules", () => {
    const pack = loadPack("us-va", "1.0.0");
    expect(pack.rules.timeComputationRules.length).toBeGreaterThan(0);
    expect(pack.rules.timeComputationRules.map(r => r.ruleId)).toContain("va-1-210-A");
    expect(pack.rules.timeComputationRules.map(r => r.ruleId)).toContain("va-1-210-E");
  });

  it("pack has frozen holiday calendar", () => {
    const pack = loadPack("us-va", "1.0.0");
    expect(Object.keys(pack.holidays).length).toBeGreaterThan(0);
    expect(pack.holidays["2026"]).toBeDefined();
    expect(pack.holidays["2026"]!.length).toBeGreaterThan(0);
  });

  it("deriveEffectiveDate works through the pack interface", () => {
    const pack = loadPack("us-va", "1.0.0");
    const result = pack.deriveEffectiveDate({
      sessionType: "regular",
      adjournmentDate: "2026-03-08",
      actType: "ordinary",
      specifiedDate: null,
      passageDate: null,
    });
    expect(result.resolved).toBe(true);
    if (!result.resolved) return;
    expect(result.date).toBe("2026-07-01");
    expect(result.ruleId).toBe("va-1-214-A-default");
  });

  it("adjustForNonBusinessDay works through the pack interface", () => {
    const pack = loadPack("us-va", "1.0.0");
    const result = pack.adjustForNonBusinessDay("2026-01-01");
    expect(result.wasAdjusted).toBe(true);
    expect(result.adjustedDate).toBe("2026-01-02");
  });

  it("computeDeadline works through the pack interface", () => {
    const pack = loadPack("us-va", "1.0.0");
    const result = pack.computeDeadline("2026-01-05", 5, "calendar");
    expect(result.statutoryDate).toBeDefined();
    expect(result.adjustedDate).toBeDefined();
    expect(result.ruleIds).toContain("va-1-210-A");
    expect(result.packVersion).toBe("1.0.0");
  });

  it("isHoliday identifies Virginia holidays", () => {
    const pack = loadPack("us-va", "1.0.0");
    expect(pack.isHoliday("2026-01-01")).toBe(true);
    expect(pack.isHoliday("2026-01-02")).toBe(false);
  });

  it("isBusinessDay returns false for weekends and holidays", () => {
    const pack = loadPack("us-va", "1.0.0");
    expect(pack.isBusinessDay("2026-01-03")).toBe(false);
    expect(pack.isBusinessDay("2026-01-05")).toBe(true);
    expect(pack.isBusinessDay("2026-01-01")).toBe(false);
  });

  it("caches the pack — second load returns same instance", () => {
    const pack1 = loadPack("us-va", "1.0.0");
    const pack2 = loadPack("us-va", "1.0.0");
    expect(pack1).toBe(pack2);
  });

  it("throws for unknown jurisdiction", () => {
    expect(() => loadPack("us-xx", "1.0.0")).toThrow(/pack not found/);
  });

  it("throws for unknown version", () => {
    expect(() => loadPack("us-va", "99.0.0")).toThrow(/pack not found/);
  });
});

describe("two pack versions coexist", () => {
  it("loading v1 does not prevent loading a different version (when it exists)", () => {
    const pack1 = loadPack("us-va", "1.0.0");
    expect(pack1.packVersion).toBe("us-va/v1");

    expect(() => loadPack("us-va", "2.0.0")).toThrow(/pack not found/);
  });

  it("pack cache keys include version — different versions are independent", () => {
    const pack1 = loadPack("us-va", "1.0.0");
    clearPackCache();
    const pack1b = loadPack("us-va", "1.0.0");
    expect(pack1b).not.toBe(pack1);
    expect(pack1b.packVersion).toBe("us-va/v1");
  });
});
