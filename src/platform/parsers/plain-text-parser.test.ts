import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlainTextParser } from "./plain-text-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HB346_TEXT = readFileSync(
  resolve(__dirname, "../../../fixtures/documents/hb346-extracted.txt"),
  "utf-8",
);
const FOIA_RECORDS_TEXT = readFileSync(
  resolve(__dirname, "../../../fixtures/documents/va-foia-records-request.txt"),
  "utf-8",
);

const parser = createPlainTextParser();

describe("plain-text parser", () => {
  it("has correct adapter ID and version", () => {
    expect(parser.adapterId).toBe("plain-text");
    expect(parser.version).toBe("1.3.0");
  });

  it("parses simple single-paragraph text", () => {
    const bytes = Buffer.from("This is a simple bill text.");
    const result = parser.parse(bytes, "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs).toHaveLength(1);
    expect(result.paragraphs[0]!.runs[0]!.text).toBe("This is a simple bill text.");
    expect(result.paragraphs[0]!.structuralPath).toBe("/body/p[0]");
  });

  it("splits on double newlines into multiple paragraphs", () => {
    const bytes = Buffer.from("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
    const result = parser.parse(bytes, "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs).toHaveLength(3);
    expect(result.paragraphs[0]!.runs[0]!.text).toBe("First paragraph.");
    expect(result.paragraphs[1]!.runs[0]!.text).toBe("Second paragraph.");
    expect(result.paragraphs[2]!.runs[0]!.text).toBe("Third paragraph.");
  });

  it("suppresses line-number margins (conservative, 2+ spaces)", () => {
    const bytes = Buffer.from("   1  Be it enacted by the General Assembly\n   2  of Virginia that:");
    const result = parser.parse(bytes, "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.runs[0]!.text).toContain("Be it enacted");
    expect(result.paragraphs[0]!.runs[0]!.text).not.toMatch(/^\s*\d/);
  });

  it("suppresses page footer patterns", () => {
    const text = [
      "Some text here.",
      "",
      "  - 1 -  ",
      "",
      "More text after page break.",
      "",
      "Page 2 of 10",
      "",
      "Final paragraph.",
    ].join("\n");
    const bytes = Buffer.from(text);
    const result = parser.parse(bytes, "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const allText = result.paragraphs.map(p => p.runs[0]!.text).join(" ");
    expect(allText).not.toContain("- 1 -");
    expect(allText).not.toContain("Page 2 of 10");
    expect(allText).toContain("Some text here.");
    expect(allText).toContain("More text after page break.");
    expect(allText).toContain("Final paragraph.");
  });

  it("detects section headings and builds structural paths", () => {
    const text = [
      "SECTION 1. Title.",
      "",
      "First paragraph of section 1.",
      "",
      "SECTION 2. Another.",
      "",
      "First paragraph of section 2.",
    ].join("\n");
    const bytes = Buffer.from(text);
    const result = parser.parse(bytes, "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.structuralPath).toBe("/body/section[1]/p[0]");
    expect(result.paragraphs[1]!.structuralPath).toBe("/body/section[1]/p[1]");
    expect(result.paragraphs[2]!.structuralPath).toBe("/body/section[2]/p[0]");
    expect(result.paragraphs[3]!.structuralPath).toBe("/body/section[2]/p[1]");
  });

  it("fails on empty input", () => {
    const result = parser.parse(Buffer.from(""), "text/plain");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no text content");
  });

  it("fails on whitespace-only input", () => {
    const result = parser.parse(Buffer.from("   \n\n  \t  \n  "), "text/plain");
    expect(result.ok).toBe(false);
  });

  it("fails on wrong mime type", () => {
    const result = parser.parse(Buffer.from("text"), "application/pdf");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("does not handle");
  });

  it("always sets fidelity to none", () => {
    const result = parser.parse(Buffer.from("text"), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fidelity).toBe("none");
  });

  it("runs have no formatting properties", () => {
    const result = parser.parse(Buffer.from("text"), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const run = result.paragraphs[0]!.runs[0]!;
    expect(run.properties.italic).toBe(false);
    expect(run.properties.strikethrough).toBe(false);
  });

  it("handles standalone page number lines", () => {
    const text = "Some text.\n\n42\n\nMore text.";
    const bytes = Buffer.from(text);
    const result = parser.parse(bytes, "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const allText = result.paragraphs.map(p => p.runs[0]!.text).join(" ");
    expect(allText).not.toContain("42");
    expect(allText).toContain("Some text.");
    expect(allText).toContain("More text.");
  });

  it("handles only footers/page numbers (results in no content)", () => {
    const text = "  - 1 -  \n\nPage 2 of 10\n\n42";
    const bytes = Buffer.from(text);
    const result = parser.parse(bytes, "text/plain");
    expect(result.ok).toBe(false);
  });

  it("handles nested chapter and section headings", () => {
    const text = [
      "CHAPTER 1. General Provisions.",
      "",
      "Intro paragraph.",
      "",
      "SECTION 1. Definitions.",
      "",
      "Definition text.",
      "",
      "CHAPTER 2. Obligations.",
      "",
      "Another paragraph.",
    ].join("\n");
    const bytes = Buffer.from(text);
    const result = parser.parse(bytes, "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs[0]!.structuralPath).toBe("/body/chapter[1]/p[0]");
    expect(result.paragraphs[1]!.structuralPath).toBe("/body/chapter[1]/p[1]");
    expect(result.paragraphs[2]!.structuralPath).toBe("/body/chapter[1]/section[1]/p[0]");
    expect(result.paragraphs[3]!.structuralPath).toBe("/body/chapter[1]/section[1]/p[1]");
    expect(result.paragraphs[4]!.structuralPath).toBe("/body/chapter[2]/p[0]");
    expect(result.paragraphs[5]!.structuralPath).toBe("/body/chapter[2]/p[1]");
  });
});

describe("plain-text parser — structural segmentation (no blank lines)", () => {
  it("detects line numbers and strips them", () => {
    const result = parser.parse(Buffer.from(FOIA_RECORDS_TEXT), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const p of result.paragraphs) {
      const text = p.runs[0]!.text;
      expect(text).not.toMatch(/^\d{1,4}\s/);
    }
  });

  it("segments HB 346 into >10 segments", () => {
    const result = parser.parse(Buffer.from(HB346_TEXT), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs.length).toBeGreaterThan(10);
  });

  it("segments on § section markers", () => {
    const result = parser.parse(Buffer.from(HB346_TEXT), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sectionPaths = result.paragraphs
      .map(p => p.structuralPath)
      .filter(p => p.includes("section["));
    expect(sectionPaths.length).toBeGreaterThan(0);
  });

  it("segments on lettered subsections (A., B., C.)", () => {
    const result = parser.parse(Buffer.from(FOIA_RECORDS_TEXT), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const texts = result.paragraphs.map(p => p.runs[0]!.text);
    const startsWithLetter = texts.filter(t => /^[A-Z]\.\s/.test(t));
    expect(startsWithLetter.length).toBeGreaterThanOrEqual(8);
  });

  it("segments on numbered subdivisions (1., 2., 3., 4.)", () => {
    const result = parser.parse(Buffer.from(HB346_TEXT), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const texts = result.paragraphs.map(p => p.runs[0]!.text);
    const startsWithNumber = texts.filter(t => /^\d+\.\s/.test(t));
    expect(startsWithNumber.length).toBeGreaterThanOrEqual(4);
  });

  it("segments on enactment clause boundary", () => {
    const result = parser.parse(Buffer.from(HB346_TEXT), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const texts = result.paragraphs.map(p => p.runs[0]!.text);
    const enactmentClause = texts.find(t => t.startsWith("Be it enacted"));
    expect(enactmentClause).toBeDefined();

    const reenactBoundary = texts.find(t => t.includes("is amended and reenacted as follows"));
    expect(reenactBoundary).toBeDefined();
  });

  it("does not split preamble on numbers that are content", () => {
    const text = [
      "1 HOUSE BILL NO. 100",
      "2 A BILL to amend § 2.2-3704",
      "3 Be it enacted by the General Assembly of Virginia:",
      "4 1. That § 2.2-3704 of the Code is amended",
      "5 and reenacted as follows:",
      "6 § 2.2-3704. Title of section.",
      "7 A. First subsection text here.",
      "8 B. Second subsection text here.",
      "9 1. First numbered subdivision.",
      "10 2. Second numbered subdivision.",
    ].join("\n");

    const result = parser.parse(Buffer.from(text), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const texts = result.paragraphs.map(p => p.runs[0]!.text);
    const aSubsection = texts.find(t => t.startsWith("A."));
    expect(aSubsection).toBeDefined();
    const bSubsection = texts.find(t => t.startsWith("B."));
    expect(bSubsection).toBeDefined();
  });

  it("falls back to single paragraph when no structure found", () => {
    const text = [
      "This is a paragraph of text that has no blank lines",
      "and no legislative structure markers at all. It just",
      "continues as one long block of content without any",
      "section headers or subdivision markers.",
    ].join("\n");

    const result = parser.parse(Buffer.from(text), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paragraphs).toHaveLength(1);
  });

  it("handles SECTION headings inside structural text", () => {
    const text = [
      "1 Be it enacted by the General Assembly:",
      "2 1. That the following is enacted",
      "3 and reenacted as follows:",
      "4 SECTION 1. Short title.",
      "5 This Act may be cited.",
      "6 SECTION 2. Definitions.",
      "7 For purposes of this chapter.",
    ].join("\n");

    const result = parser.parse(Buffer.from(text), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sectionPaths = result.paragraphs
      .map(p => p.structuralPath)
      .filter(p => p.includes("section["));
    expect(sectionPaths.length).toBeGreaterThanOrEqual(2);
    expect(sectionPaths).toContainEqual(expect.stringContaining("section[1]"));
    expect(sectionPaths).toContainEqual(expect.stringContaining("section[2]"));
  });

  it("section identifiers have no trailing period", () => {
    const text = [
      "1 Be it enacted by the General Assembly of Virginia:",
      "2 1. That § 2.2-3705.1 is amended",
      "3 and reenacted as follows:",
      "4 § 2.2-3705.1. Title of this section.",
      "5 A. First subsection.",
    ].join("\n");

    const result = parser.parse(Buffer.from(text), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sectionPaths = result.paragraphs
      .map(p => p.structuralPath)
      .filter(p => p.includes("section["));
    expect(sectionPaths.length).toBeGreaterThan(0);
    for (const path of sectionPaths) {
      expect(path).not.toMatch(/\.\]/);
    }
  });

  it("character accounting balances on HB 346", () => {
    const result = parser.parse(Buffer.from(HB346_TEXT), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.characterAccounting).toBeDefined();

    const a = result.characterAccounting!;
    expect(a.inputChars).toBe(HB346_TEXT.length);
    const newlines = HB346_TEXT.split("\n").length - 1;
    expect(a.strippedChars + a.preprocessedChars + newlines).toBe(a.inputChars);
    expect(a.segmentRawChars).toBeGreaterThan(0);
  });

  it("character accounting balances on simple text", () => {
    const text = "First paragraph.\n\nSecond paragraph.";
    const result = parser.parse(Buffer.from(text), "text/plain");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.characterAccounting).toBeDefined();

    const a = result.characterAccounting!;
    expect(a.inputChars).toBe(text.length);
    const newlines = text.split("\n").length - 1;
    expect(a.strippedChars + a.preprocessedChars + newlines).toBe(a.inputChars);
  });
});
