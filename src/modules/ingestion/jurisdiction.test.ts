import { describe, it, expect } from "vitest";
import { normalizeJurisdiction, inferJurisdictionFromText, JURISDICTIONS } from "./jurisdiction.js";

describe("JURISDICTIONS reference table", () => {
  it("contains us-fed, us-va, us-tx, us-fl, us-dc", () => {
    const codes = JURISDICTIONS.map(j => j.code);
    expect(codes).toContain("us-fed");
    expect(codes).toContain("us-va");
    expect(codes).toContain("us-tx");
    expect(codes).toContain("us-fl");
    expect(codes).toContain("us-dc");
  });
});

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

  it("normalizes 'Texas' to 'us-tx'", () => {
    expect(normalizeJurisdiction("Texas")).toBe("us-tx");
  });

  it("normalizes 'TX' to 'us-tx'", () => {
    expect(normalizeJurisdiction("TX")).toBe("us-tx");
  });

  it("normalizes 'Florida' to 'us-fl'", () => {
    expect(normalizeJurisdiction("Florida")).toBe("us-fl");
  });

  it("normalizes 'FL' to 'us-fl'", () => {
    expect(normalizeJurisdiction("FL")).toBe("us-fl");
  });
});

describe("inferJurisdictionFromText", () => {
  it("detects federal enactment clause", () => {
    const text = "Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,";
    expect(inferJurisdictionFromText(text)).toBe("us-fed");
  });

  it("detects Virginia via General Assembly pattern", () => {
    const text = "Be it enacted by the General Assembly of Virginia:";
    expect(inferJurisdictionFromText(text)).toBe("us-va");
  });

  it("detects Texas via Legislature of the State pattern", () => {
    const text = "AN ACT\nBE IT ENACTED BY THE LEGISLATURE OF THE STATE OF TEXAS:";
    expect(inferJurisdictionFromText(text)).toBe("us-tx");
  });

  it("detects Texas via Legislature of the State pattern (mixed case)", () => {
    const text = "Be it enacted by the Legislature of the State of Texas:";
    expect(inferJurisdictionFromText(text)).toBe("us-tx");
  });

  it("detects Florida via Legislature of the State pattern", () => {
    const text = "Be It Enacted by the Legislature of the State of Florida:";
    expect(inferJurisdictionFromText(text)).toBe("us-fl");
  });

  it("detects Florida via letterhead", () => {
    const text = "FLORIDA SENATE\n2023 Regular Session\nSB 6";
    expect(inferJurisdictionFromText(text)).toBe("us-fl");
  });

  it("detects Texas via letterhead", () => {
    const text = "TEXAS HOUSE OF REPRESENTATIVES\n88th Legislature";
    expect(inferJurisdictionFromText(text)).toBe("us-tx");
  });

  it("detects Virginia via ACTS OF ASSEMBLY header", () => {
    const text = "VIRGINIA ACTS OF ASSEMBLY - 2026 RECONVENED SESSION";
    expect(inferJurisdictionFromText(text)).toBe("us-va");
  });

  it("returns null for unrecognized text", () => {
    expect(inferJurisdictionFromText("Section 1. Short title.")).toBeNull();
  });

  it("returns null for unrecognized state in enactment clause", () => {
    const text = "Be it enacted by the Legislature of the State of Narnia:";
    expect(inferJurisdictionFromText(text)).toBeNull();
  });

  it("uses reference table — no per-state code branches", () => {
    // All state detections go through the same general patterns + table lookup.
    // Adding a state to JURISDICTIONS is all that's needed for detection.
    const texts: [string, string][] = [
      ["Be it enacted by the General Assembly of Virginia:", "us-va"],
      ["Be it enacted by the Legislature of the State of Texas:", "us-tx"],
      ["Be it enacted by the Legislature of the State of Florida:", "us-fl"],
    ];
    for (const [text, expected] of texts) {
      expect(inferJurisdictionFromText(text)).toBe(expected);
    }
  });
});
