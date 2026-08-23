import { describe, it, expect } from "vitest";
import { extractTitleFromSegments, extractApprovalDate, looksLikeFilename } from "./title-extractor.js";

function segs(...texts: string[]) {
  return texts.map((rawText) => ({ rawText }));
}

describe("extractTitleFromSegments", () => {
  it("extracts federal bill number from H. R. pattern", () => {
    const result = extractTitleFromSegments(segs(
      "119TH CONGRESS 1ST SESSION H. R. 2409",
      "To require the Director of OMB to issue guidance...",
    ));
    expect(result.displayNumber).toBe("H. R. 2409");
  });

  it("extracts short title from 'may be cited as' language", () => {
    const result = extractTitleFromSegments(segs(
      "119TH CONGRESS H. R. 2409",
      'SECTION 1. SHORT TITLE. This Act may be cited as the "AI Guidance Clarity Act".',
    ));
    expect(result.shortTitle).toBe("AI Guidance Clarity Act");
    expect(result.displayNumber).toBe("H. R. 2409");
  });

  it("extracts state abbreviated H.B. No. pattern", () => {
    const result = extractTitleFromSegments(segs(
      "AN ACT",
      "H.B. No. 3265",
      "relating to something...",
    ));
    expect(result.displayNumber).toBe("HB 3265");
  });

  it("extracts state abbreviated with A spacer characters", () => {
    const result = extractTitleFromSegments(segs(
      "AN ACT",
      "H.B.ANo.A3265",
      "relating to something...",
    ));
    expect(result.displayNumber).toBe("HB 3265");
  });

  it("extracts state abbreviated with spaced A spacers (real PDF format)", () => {
    const result = extractTitleFromSegments(segs(
      "H.B. ANo. A3265",
      "AN ACT relating to...",
    ));
    expect(result.displayNumber).toBe("HB 3265");
  });

  it("extracts S.B. No. pattern", () => {
    const result = extractTitleFromSegments(segs(
      "AN ACT",
      "S.B. No. 1024",
    ));
    expect(result.displayNumber).toBe("SB 1024");
  });

  it("extracts HOUSE BILL NO. pattern", () => {
    const result = extractTitleFromSegments(segs(
      "VIRGINIA ACTS OF ASSEMBLY",
      "HOUSE BILL NO. 346",
      "An Act to amend...",
    ));
    expect(result.displayNumber).toBe("HB 346");
  });

  it("extracts SENATE BILL pattern (no NO.)", () => {
    const result = extractTitleFromSegments(segs(
      "SENATE BILL 1234",
      "Relating to education...",
    ));
    expect(result.displayNumber).toBe("SB 1234");
  });

  it("extracts bare abbreviated bill number from letterhead", () => {
    const result = extractTitleFromSegments(segs(
      "FLORIDA SENATE",
      "2023 Regular Session",
      "SB 6",
      "An act relating to...",
    ));
    expect(result.displayNumber).toBe("SB 6");
  });

  it("extracts bare HB format", () => {
    const result = extractTitleFromSegments(segs(
      "TEXAS HOUSE",
      "HB 3265",
    ));
    expect(result.displayNumber).toBe("HB 3265");
  });

  it("extracts committee substitute bill number", () => {
    const result = extractTitleFromSegments(segs(
      "CS/SB 6",
      "An act relating to...",
    ));
    expect(result.displayNumber).toBe("SB 6");
  });

  it("extracts Virginia bracket bill-number notation [S 225]", () => {
    const result = extractTitleFromSegments(segs(
      "VIRGINIA ACTS OF ASSEMBLY - 2026 RECONVENED SESSION",
      "CHAPTER 1126 An Act to amend the Code of Virginia [S 225] Approved May 14, 2026",
    ));
    expect(result.displayNumber).toBe("S 225");
  });

  it("extracts chapter number from CHAPTER NNNN header", () => {
    const result = extractTitleFromSegments(segs(
      "VIRGINIA ACTS OF ASSEMBLY - 2026 RECONVENED SESSION",
      "CHAPTER 1126 An Act to amend the Code of Virginia",
    ));
    expect(result.chapter).toBe("1126");
  });

  it("extracts session from ACTS OF ASSEMBLY header", () => {
    const result = extractTitleFromSegments(segs(
      "VIRGINIA ACTS OF ASSEMBLY - 2026 RECONVENED SESSION",
      "CHAPTER 1126 An Act...",
    ));
    expect(result.session).toBe("2026 Reconvened Session");
  });

  it("detects enacted stage from Approved date stamp", () => {
    const result = extractTitleFromSegments(segs(
      "CHAPTER 1126 An Act... [S 225] Approved May 14, 2026",
    ));
    expect(result.stage).toBe("enacted");
  });

  it("returns null when no bill pattern found", () => {
    const result = extractTitleFromSegments(segs(
      "Some random document",
      "No bill identification here",
    ));
    expect(result.displayNumber).toBeNull();
    expect(result.shortTitle).toBeNull();
    expect(result.chapter).toBeNull();
    expect(result.session).toBeNull();
    expect(result.stage).toBeNull();
  });

  it("extracts short title with double single-quotes (federal PDF convention)", () => {
    const result = extractTitleFromSegments(segs(
      "SECTION 1. SHORT TITLE.",
      "This Act may be cited as the ''Guidance Clarity Act of 2025''.",
    ));
    expect(result.shortTitle).toBe("Guidance Clarity Act of 2025");
  });

  it("extracts short title with smart quotes", () => {
    const result = extractTitleFromSegments(segs(
      "SECTION 1. SHORT TITLE.",
      'This Act may be cited as the “Government Efficiency Act”.',
    ));
    expect(result.shortTitle).toBe("Government Efficiency Act");
  });
});

describe("looksLikeFilename", () => {
  it("detects BILLS- prefix as filename", () => {
    expect(looksLikeFilename("BILLS-119hr2409rh")).toBe(true);
  });

  it("detects bare numeric-heavy strings as filename", () => {
    expect(looksLikeFilename("119hr2409rh")).toBe(true);
  });

  it("detects leading-zero bill numbers from filename convention", () => {
    expect(looksLikeFilename("HB03265F")).toBe(true);
    expect(looksLikeFilename("SB0006")).toBe(true);
  });

  it("detects bill-NNNN API artifact as filename", () => {
    expect(looksLikeFilename("bill-1225747")).toBe(true);
    expect(looksLikeFilename("bill_999")).toBe(true);
  });

  it("does not flag normal bill numbers", () => {
    expect(looksLikeFilename("H.R. 2409")).toBe(false);
    expect(looksLikeFilename("HB 346")).toBe(false);
    expect(looksLikeFilename("HB346")).toBe(false);
    expect(looksLikeFilename("SB 6")).toBe(false);
  });
});

describe("extractApprovalDate", () => {
  it("extracts ISO date from Approved stamp", () => {
    const date = extractApprovalDate(segs(
      "CHAPTER 1126 An Act [S 225] Approved May 14, 2026 Be it enacted...",
    ));
    expect(date).toBe("2026-05-14");
  });

  it("returns null when no approval stamp", () => {
    const date = extractApprovalDate(segs(
      "SECTION 1. SHORT TITLE.",
      "This Act may be cited as the GONE Act.",
    ));
    expect(date).toBeNull();
  });
});
