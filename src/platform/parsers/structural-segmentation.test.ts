import { describe, it, expect } from "vitest";
import {
  buildPath,
  updateSectionStack,
  splitByBlankLines,
  splitByStructure,
  splitOnEmbeddedSections,
  isPageFooter,
  expandSectionRange,
  parseEnactingClause,
  reconcileWithEnactingClause,
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

describe("splitOnEmbeddedSections", () => {
  function makeParagraph(path: string, text: string) {
    return {
      structuralPath: path,
      runs: [{ text, properties: { italic: false as const, strikethrough: false as const } }],
    };
  }

  it("passes through paragraphs with no § section definitions", () => {
    const paragraphs = [makeParagraph("/body/p[0]", "No sections here.")];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(1);
    expect(result[0]!.runs[0]!.text).toBe("No sections here.");
  });

  it("passes through paragraph already at correct section path", () => {
    const paragraphs = [makeParagraph("/body/section[45.2-114]/p[0]", "§ 45.2-114. Virginia Clean Energy Innovation Bank.")];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(1);
    expect(result[0]!.structuralPath).toBe("/body/section[45.2-114]/p[0]");
  });

  it("re-paths paragraph starting with § when section not in path", () => {
    const paragraphs = [makeParagraph("/body/chapter[1126]/article[3]/p[10]", "§ 45.2-115. Definitions. As used in this article.")];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(1);
    expect(result[0]!.structuralPath).toBe("/body/chapter[1126]/article[3]/section[45.2-115]/p[0]");
  });

  it("splits paragraph with two embedded § section definitions", () => {
    const text = "§ 45.2-114. Bank Advisory Board. The Board shall meet quarterly. § 45.2-115. Definitions. As used in this article.";
    const paragraphs = [makeParagraph("/body/chapter[1126]/p[1]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(2);
    expect(result[0]!.runs[0]!.text).toContain("§ 45.2-114");
    expect(result[0]!.runs[0]!.text).toContain("meet quarterly");
    expect(result[0]!.runs[0]!.text).not.toContain("§ 45.2-115");
    expect(result[1]!.runs[0]!.text).toContain("§ 45.2-115");
    expect(result[1]!.runs[0]!.text).toContain("As used in this article");
  });

  it("emits preamble text before first § as a separate paragraph", () => {
    const text = "Be it enacted by the General Assembly: § 45.2-114. Bank. The Board. § 45.2-115. Definitions. Terms.";
    const paragraphs = [makeParagraph("/body/chapter[1126]/p[1]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(3);
    expect(result[0]!.runs[0]!.text).toBe("Be it enacted by the General Assembly:");
    expect(result[0]!.structuralPath).toBe("/body/chapter[1126]/p[0]");
    expect(result[1]!.runs[0]!.text).toContain("§ 45.2-114");
    expect(result[2]!.runs[0]!.text).toContain("§ 45.2-115");
  });

  it("assigns section[X.X-NNN] structural paths", () => {
    const text = "§ 2.2-3704. Records. Content. § 2.2-3705. Exclusions. More content.";
    const paragraphs = [makeParagraph("/body/p[0]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result[0]!.structuralPath).toBe("/body/section[2.2-3704]/p[0]");
    expect(result[1]!.structuralPath).toBe("/body/section[2.2-3705]/p[0]");
  });

  it("does NOT split on cross-references preceded by prepositions", () => {
    const text = "§ 45.2-114. Bank. Meaning as provided in § 56-576. More text here. Under § 10-200. Also provisions of § 99-1. Done. § 45.2-115. Definitions. Terms.";
    const paragraphs = [makeParagraph("/body/p[0]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(2);
    expect(result[0]!.runs[0]!.text).toContain("§ 56-576");
    expect(result[0]!.runs[0]!.text).toContain("§ 10-200");
    expect(result[0]!.runs[0]!.text).toContain("§ 99-1");
  });

  it("does NOT split on cross-references without period like 'pursuant to § 45.2-118 and'", () => {
    const text = "§ 45.2-114. Bank. Pursuant to § 45.2-118 and other rules. § 45.2-115. Definitions. Terms.";
    const paragraphs = [makeParagraph("/body/p[0]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(2);
    expect(result[0]!.runs[0]!.text).toContain("§ 45.2-118 and other rules");
  });

  it("preserves paragraphs that are not split", () => {
    const paragraphs = [
      makeParagraph("/body/p[0]", "Header text"),
      makeParagraph("/body/chapter[1]/p[0]", "§ 1-100. First. Content. § 1-101. Second. More."),
      makeParagraph("/body/p[2]", "Footer text"),
    ];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(4);
    expect(result[0]!.runs[0]!.text).toBe("Header text");
    expect(result[1]!.structuralPath).toContain("section[1-100]");
    expect(result[2]!.structuralPath).toContain("section[1-101]");
    expect(result[3]!.runs[0]!.text).toBe("Footer text");
  });

  it("handles chaptered-act-shaped text with 9 sections", () => {
    const sections = [];
    for (let i = 114; i <= 122; i++) {
      sections.push(`§ 45.2-${i}. Section title ${i}. Body text for section ${i}.`);
    }
    const text = "Be it enacted: " + sections.join(" ");
    const paragraphs = [makeParagraph("/body/chapter[1126]/p[1]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(10);
    expect(result[0]!.runs[0]!.text).toBe("Be it enacted:");
    for (let i = 1; i <= 9; i++) {
      expect(result[i]!.structuralPath).toContain(`section[45.2-${113 + i}]`);
    }
  });

  it("no text is lost in the split", () => {
    const text = "Preamble text. § 45.2-114. Bank. Content here. § 45.2-115. Definitions. More terms.";
    const paragraphs = [makeParagraph("/body/p[0]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    const reconstructed = result.map(p => p.runs[0]!.text).join(" ");
    expect(reconstructed).toContain("Preamble text");
    expect(reconstructed).toContain("Content here");
    expect(reconstructed).toContain("More terms");
  });

  it("splits paragraph with single § section definition preceded by text (threshold=1)", () => {
    const text = "B. The Bank shall require compliance with all laws. § 45.2-118. Strategic plan.";
    const paragraphs = [makeParagraph("/body/chapter[1126]/article[3]/p[30]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(2);
    expect(result[0]!.runs[0]!.text).toBe("B. The Bank shall require compliance with all laws.");
    expect(result[0]!.structuralPath).toBe("/body/chapter[1126]/article[3]/p[0]");
    expect(result[1]!.runs[0]!.text).toBe("§ 45.2-118. Strategic plan.");
    expect(result[1]!.structuralPath).toBe("/body/chapter[1126]/article[3]/section[45.2-118]/p[0]");
  });

  it("splits fused article heading + section definition", () => {
    const text = "Article 3. Virginia Clean Energy Innovation Bank. § 45.2-114. Virginia Clean Energy Innovation Bank; Bank Advisory Board.";
    const paragraphs = [makeParagraph("/body/chapter[1126]/article[3]/p[0]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(2);
    expect(result[0]!.runs[0]!.text).toContain("Article 3");
    expect(result[0]!.runs[0]!.text).not.toContain("§ 45.2-114");
    expect(result[1]!.structuralPath).toContain("section[45.2-114]");
    expect(result[1]!.runs[0]!.text).toContain("§ 45.2-114");
  });

  it("splits section fused at end with cross-references in preamble", () => {
    const text = "4. Expend funds pursuant to § 45.2-118 and pursuant to § 45.2-119. § 45.2-117. Bank lending practices.";
    const paragraphs = [makeParagraph("/body/chapter[1126]/article[3]/p[30]", text)];
    const result = splitOnEmbeddedSections(paragraphs);
    expect(result).toHaveLength(2);
    expect(result[0]!.runs[0]!.text).toContain("pursuant to § 45.2-118");
    expect(result[0]!.runs[0]!.text).toContain("pursuant to § 45.2-119");
    expect(result[1]!.structuralPath).toContain("section[45.2-117]");
  });
});

describe("expandSectionRange", () => {
  it("expands a range with common prefix", () => {
    const result = expandSectionRange("45.2-114", "45.2-122");
    expect(result).toHaveLength(9);
    expect(result![0]).toBe("45.2-114");
    expect(result![8]).toBe("45.2-122");
  });

  it("returns null for different prefixes", () => {
    expect(expandSectionRange("45.2-114", "46.1-122")).toBeNull();
  });

  it("returns null for reversed range", () => {
    expect(expandSectionRange("45.2-122", "45.2-114")).toBeNull();
  });

  it("handles single-section range", () => {
    const result = expandSectionRange("10-100", "10-100");
    expect(result).toEqual(["10-100"]);
  });
});

describe("parseEnactingClause", () => {
  function makeParagraph(path: string, text: string) {
    return {
      structuralPath: path,
      runs: [{ text, properties: { italic: false as const, strikethrough: false as const } }],
    };
  }

  it("parses 'sections numbered X through Y' range", () => {
    const paragraphs = [
      makeParagraph("/body/p[0]", "CHAPTER 1126"),
      makeParagraph("/body/chapter[1126]/p[0]", "An Act adding sections numbered 45.2-114 through 45.2-122, as follows:"),
    ];
    const result = parseEnactingClause(paragraphs);
    expect(result).not.toBeNull();
    expect(result!.declaredSections).toHaveLength(9);
    expect(result!.declaredSections[0]).toBe("45.2-114");
    expect(result!.declaredSections[8]).toBe("45.2-122");
  });

  it("parses single section 'That § X ... is amended'", () => {
    const paragraphs = [
      makeParagraph("/body/p[0]", "1. That § 53.1-39.2 of the Code of Virginia is amended and reenacted as follows:"),
    ];
    const result = parseEnactingClause(paragraphs);
    expect(result).not.toBeNull();
    expect(result!.declaredSections).toEqual(["53.1-39.2"]);
  });

  it("returns null when no enacting clause found", () => {
    const paragraphs = [
      makeParagraph("/body/p[0]", "This is just some text with no enacting clause."),
    ];
    expect(parseEnactingClause(paragraphs)).toBeNull();
  });
});

describe("reconcileWithEnactingClause", () => {
  function makeParagraph(path: string, text: string) {
    return {
      structuralPath: path,
      runs: [{ text, properties: { italic: false as const, strikethrough: false as const } }],
    };
  }

  it("passes through when no enacting clause found", () => {
    const paragraphs = [
      makeParagraph("/body/section[1-100]/p[0]", "§ 1-100. Title. Content."),
    ];
    const result = reconcileWithEnactingClause(paragraphs);
    expect(result.enactingClause).toBeNull();
    expect(result.warnings).toHaveLength(0);
    expect(result.paragraphs).toEqual(paragraphs);
  });

  it("validates sections against declared range — all within range", () => {
    const paragraphs = [
      makeParagraph("/body/chapter[1126]/p[0]", "An Act adding sections numbered 45.2-114 through 45.2-116, as follows:"),
      makeParagraph("/body/chapter[1126]/section[45.2-114]/p[0]", "§ 45.2-114. Bank."),
      makeParagraph("/body/chapter[1126]/section[45.2-115]/p[0]", "§ 45.2-115. Definitions."),
      makeParagraph("/body/chapter[1126]/section[45.2-116]/p[0]", "§ 45.2-116. Duties."),
    ];
    const result = reconcileWithEnactingClause(paragraphs);
    expect(result.warnings).toHaveLength(0);
    expect(result.paragraphs).toHaveLength(4);
  });

  it("reverts section outside declared range to parent path", () => {
    const paragraphs = [
      makeParagraph("/body/p[0]", "1. That § 53.1-39.2 of the Code of Virginia is amended and reenacted as follows:"),
      makeParagraph("/body/section[53.1-39.2]/p[0]", "§ 53.1-39.2. Title."),
      makeParagraph("/body/section[99-999]/p[0]", "§ 99-999. Falsely matched."),
    ];
    const result = reconcileWithEnactingClause(paragraphs);
    expect(result.warnings.some(w => w.includes("99-999"))).toBe(true);
    expect(result.paragraphs[2]!.structuralPath).toBe("/body/p[0]");
  });

  it("warns when declared section not found", () => {
    const paragraphs = [
      makeParagraph("/body/chapter[1126]/p[0]", "An Act adding sections numbered 45.2-114 through 45.2-116, as follows:"),
      makeParagraph("/body/chapter[1126]/section[45.2-114]/p[0]", "§ 45.2-114. Bank."),
      makeParagraph("/body/chapter[1126]/section[45.2-116]/p[0]", "§ 45.2-116. Duties."),
    ];
    const result = reconcileWithEnactingClause(paragraphs);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("45.2-115");
    expect(result.warnings[0]).toContain("not found");
  });

  it("Chapter 1126 real-world: all 9 sections within declared range", () => {
    const paragraphs = [
      makeParagraph("/body/chapter[1126]/p[0]", "An Act consisting of sections numbered 45.2-114 through 45.2-122"),
    ];
    for (let i = 114; i <= 122; i++) {
      paragraphs.push(
        makeParagraph(`/body/chapter[1126]/article[3]/section[45.2-${i}]/p[0]`, `§ 45.2-${i}. Section ${i}.`),
      );
    }
    const result = reconcileWithEnactingClause(paragraphs);
    expect(result.warnings).toHaveLength(0);
    expect(result.enactingClause!.declaredSections).toHaveLength(9);
  });
});
