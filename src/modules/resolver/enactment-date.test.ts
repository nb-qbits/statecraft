import { describe, it, expect } from "vitest";
import { extractEnactmentDate, enactmentDateToInput } from "./enactment-date.js";

describe("extractEnactmentDate", () => {
  it("extracts 'Approved January 28, 2016'", () => {
    const result = extractEnactmentDate([
      "Some preamble text.",
      "Section 2. Requirements.",
      "Approved January 28, 2016.",
    ]);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.date).toBe("2016-01-28");
    expect(result.citation).toContain("Approved January 28, 2016");
  });

  it("extracts 'Approved March 7, 2024' without trailing period", () => {
    const result = extractEnactmentDate([
      "Approved March 7, 2024",
    ]);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.date).toBe("2024-03-07");
  });

  it("scans from the end of segments (last match wins)", () => {
    const result = extractEnactmentDate([
      "Approved June 1, 2010.",
      "Middle content.",
      "Approved December 19, 2014.",
    ]);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.date).toBe("2014-12-19");
  });

  it("returns found: false when no Approved line exists", () => {
    const result = extractEnactmentDate([
      "Be it enacted by the Senate and House of Representatives.",
      "Section 1. Short Title.",
      "Section 2. Definitions.",
    ]);
    expect(result.found).toBe(false);
  });

  it("returns found: false for empty segments", () => {
    expect(extractEnactmentDate([]).found).toBe(false);
  });

  it("is case-insensitive", () => {
    const result = extractEnactmentDate(["APPROVED JULY 4, 2023."]);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.date).toBe("2023-07-04");
  });
});

describe("enactmentDateToInput", () => {
  it("produces a ResolutionInput with name 'enactmentDate'", () => {
    const input = enactmentDateToInput({
      found: true,
      date: "2016-01-28",
      citation: "Approved January 28, 2016 (enactment date from public law text)",
    });
    expect(input.name).toBe("enactmentDate");
    expect(input.value).toBe("2016-01-28");
    expect(input.source).toBe("document_text");
    expect(input.authority).toBe("act_text");
  });
});
