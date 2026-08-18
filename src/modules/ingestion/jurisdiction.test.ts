import { describe, it, expect } from "vitest";
import { normalizeJurisdiction, inferJurisdictionFromText } from "./jurisdiction.js";

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

describe("inferJurisdictionFromText", () => {
  it("detects federal enactment clause", () => {
    const text = "Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,";
    expect(inferJurisdictionFromText(text)).toBe("us-fed");
  });

  it("detects Virginia enactment clause", () => {
    const text = "Be it enacted by the General Assembly of Virginia:";
    expect(inferJurisdictionFromText(text)).toBe("us-va");
  });

  it("returns null for unrecognized text", () => {
    expect(inferJurisdictionFromText("Section 1. Short title.")).toBeNull();
  });
});
