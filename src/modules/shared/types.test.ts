import { describe, it, expect } from "vitest";
import {
  LegislativeStatus,
  CoverageState,
  AnchorMethod,
  SupportLevel,
  EvaluatorVerdict,
  Lane,
} from "./types.js";

describe("domain type enums", () => {
  it("LegislativeStatus has all expected values", () => {
    expect(Object.values(LegislativeStatus)).toEqual([
      "introduced",
      "engrossed",
      "enrolled",
      "enacted",
      "vetoed",
      "failed",
      "unknown",
    ]);
  });

  it("CoverageState has exactly two values", () => {
    expect(Object.values(CoverageState)).toEqual([
      "candidates_found",
      "screened_no_candidate",
    ]);
  });

  it("CoverageState never includes a certification of absence", () => {
    const values = Object.values(CoverageState);
    expect(values).not.toContain("certified_no_obligation");
    expect(values).not.toContain("no_obligation");
  });

  it("AnchorMethod has expected values", () => {
    expect(Object.values(AnchorMethod)).toEqual([
      "exact",
      "normalized_exact",
      "fuzzy",
    ]);
  });

  it("SupportLevel has expected values", () => {
    expect(Object.values(SupportLevel)).toEqual([
      "supported",
      "ambiguous",
      "unsupported",
    ]);
  });

  it("EvaluatorVerdict cannot approve (no supported variant)", () => {
    const values = Object.values(EvaluatorVerdict);
    expect(values).not.toContain("supported");
    expect(values).toEqual(["ambiguous", "unsupported"]);
  });

  it("Lane has expected values", () => {
    expect(Object.values(Lane)).toEqual([
      "straight_through",
      "quick_confirmation",
      "exception_review",
      "blocked",
    ]);
  });
});
