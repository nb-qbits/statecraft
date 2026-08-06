import { describe, it, expect } from "vitest";
import { normalizeJurisdiction } from "./jurisdiction.js";

describe("normalizeJurisdiction", () => {
  it("normalizes 'Virginia' to 'us-va'", () => {
    expect(normalizeJurisdiction("Virginia")).toBe("us-va");
  });

  it("normalizes 'VA' to 'us-va' (case-insensitive)", () => {
    expect(normalizeJurisdiction("VA")).toBe("us-va");
  });

  it("normalizes 'us-va' to 'us-va' (already canonical)", () => {
    expect(normalizeJurisdiction("us-va")).toBe("us-va");
  });

  it("normalizes 'US-VA' to 'us-va' (uppercase canonical)", () => {
    expect(normalizeJurisdiction("US-VA")).toBe("us-va");
  });

  it("normalizes 'District of Columbia' to 'us-dc'", () => {
    expect(normalizeJurisdiction("District of Columbia")).toBe("us-dc");
  });

  it("normalizes unknown jurisdictions to lowercase", () => {
    expect(normalizeJurisdiction("California")).toBe("california");
  });

  it("trims whitespace", () => {
    expect(normalizeJurisdiction("  Virginia  ")).toBe("us-va");
  });
});
