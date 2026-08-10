import { describe, it, expect } from "vitest";
import {
  buildPath,
  updateSectionStack,
  splitByBlankLines,
  splitByStructure,
  isPageFooter,
} from "./structural-segmentation.js";

describe("buildPath", () => {
  it("returns /body/p[n] with empty stack", () => {
    expect(buildPath([], 0)).toBe("/body/p[0]");
    expect(buildPath([], 3)).toBe("/body/p[3]");
  });

  it("includes section stack", () => {
    expect(buildPath(["section[1]"], 0)).toBe("/body/section[1]/p[0]");
    expect(buildPath(["chapter[1]", "section[2]"], 1)).toBe("/body/chapter[1]/section[2]/p[1]");
  });
});

describe("updateSectionStack", () => {
  it("adds section to empty stack", () => {
    expect(updateSectionStack([], "SECTION 1. Title")).toEqual(["section[1]"]);
  });

  it("replaces same-level entry", () => {
    expect(updateSectionStack(["section[1]"], "SECTION 2. Title")).toEqual(["section[2]"]);
  });

  it("keeps parent when adding child", () => {
    expect(updateSectionStack(["chapter[1]"], "SECTION 1. Title")).toEqual(["chapter[1]", "section[1]"]);
  });

  it("replaces parent and descendants", () => {
    expect(updateSectionStack(["chapter[1]", "section[2]"], "CHAPTER 2. Title")).toEqual(["chapter[2]"]);
  });

  it("returns copy on non-matching heading", () => {
    const result = updateSectionStack(["section[1]"], "Not a heading");
    expect(result).toEqual(["section[1]"]);
  });

  it("handles ARTICLE headings", () => {
    expect(updateSectionStack(["chapter[1]"], "ARTICLE 3. Title")).toEqual(["chapter[1]", "article[3]"]);
  });

  it("handles PART headings at top of hierarchy", () => {
    expect(updateSectionStack(["chapter[1]", "section[2]"], "PART 2. Title")).toEqual(["part[2]"]);
  });

  it("handles TITLE headings", () => {
    expect(updateSectionStack([], "TITLE 1. Title")).toEqual(["title[1]"]);
  });
});

describe("isPageFooter", () => {
  it("detects dash-number-dash pattern", () => {
    expect(isPageFooter("  - 1 -  ")).toBe(true);
  });

  it("detects Page N of M pattern", () => {
    expect(isPageFooter("Page 2 of 10")).toBe(true);
  });

  it("detects bare page number", () => {
    expect(isPageFooter("  42  ")).toBe(true);
  });

  it("rejects normal text", () => {
    expect(isPageFooter("This is content.")).toBe(false);
  });
});

describe("splitByBlankLines", () => {
  it("splits on double newlines", () => {
    const result = splitByBlankLines(["First.", "", "Second."]);
    expect(result.paragraphs).toHaveLength(2);
    expect(result.consumedCount).toBe(2);
  });

  it("detects section headings", () => {
    const result = splitByBlankLines([
      "SECTION 1. Title.",
      "",
      "Body text.",
      "",
      "SECTION 2. Another.",
      "",
      "More body.",
    ]);
    expect(result.paragraphs).toHaveLength(4);
    expect(result.paragraphs[0]!.structuralPath).toContain("section[1]");
    expect(result.paragraphs[2]!.structuralPath).toContain("section[2]");
  });
});

describe("splitByStructure", () => {
  it("segments on enactment boundary", () => {
    const lines = [
      "Be it enacted by the General Assembly of Virginia:",
      "1. That § 2.2-3705.1 is amended and reenacted as follows:",
      "§ 2.2-3705.1. Title.",
      "A. First subsection.",
      "B. Second subsection.",
    ];
    const result = splitByStructure(lines);
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(result.consumedCount).toBe(5);
  });

  it("segments on numbered subdivisions", () => {
    const lines = [
      "Be it enacted by the General Assembly:",
      "1. That the following is amended and reenacted as follows:",
      "§ 1. Title.",
      "1. First item.",
      "2. Second item.",
    ];
    const result = splitByStructure(lines);
    const texts = result.paragraphs.map(p => p.runs[0]!.text);
    expect(texts.some(t => t.startsWith("1. First"))).toBe(true);
    expect(texts.some(t => t.startsWith("2. Second"))).toBe(true);
  });

  it("does not split on § cross-references mid-paragraph", () => {
    const lines = [
      "Be it enacted by the General Assembly:",
      "1. That § 2.2-3704 is amended and reenacted as follows:",
      "§ 2.2-3704. Title of section.",
      "A. Reference to § 2.2-3705.1; (ii) records.",
    ];
    const result = splitByStructure(lines);
    const texts = result.paragraphs.map(p => p.runs[0]!.text);
    const refText = texts.find(t => t.includes("§ 2.2-3705.1"));
    expect(refText).toBeDefined();
    expect(refText).toContain("records");
  });

  it("handles SECTION headings inside structural text", () => {
    const lines = [
      "Be it enacted by the General Assembly:",
      "1. That the following is enacted and reenacted as follows:",
      "SECTION 1. Short title.",
      "Content.",
      "SECTION 2. Definitions.",
      "More content.",
    ];
    const result = splitByStructure(lines);
    const paths = result.paragraphs.map(p => p.structuralPath);
    expect(paths.some(p => p.includes("section[1]"))).toBe(true);
    expect(paths.some(p => p.includes("section[2]"))).toBe(true);
  });

  it("skips empty lines in structural mode", () => {
    const lines = [
      "Be it enacted by the General Assembly:",
      "1. That the following is amended and reenacted as follows:",
      "",
      "§ 1. Title.",
      "",
      "A. Content.",
    ];
    const result = splitByStructure(lines);
    expect(result.paragraphs.length).toBeGreaterThanOrEqual(2);
  });

  it("returns single paragraph for unstructured text", () => {
    const lines = [
      "This is plain text with no structure.",
      "It continues without any markers.",
    ];
    const result = splitByStructure(lines);
    expect(result.paragraphs).toHaveLength(1);
    expect(result.consumedCount).toBe(2);
  });
});
