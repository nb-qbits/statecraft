import type { ParsedParagraph, ParsedRun } from "../../modules/parsing/types.js";

export const SECTION_HEADING = /^(SECTION|Section|ARTICLE|Article|CHAPTER|Chapter|TITLE|Title|PART|Part)\s+\d+/;
export const SUBSECTION_LETTER = /^([A-Z])\.\s/;
export const NUMBERED_SUBDIVISION = /^(\d{1,2})\.\s/;
export const SECTION_SYMBOL = /^§\s*[\d.:-]+/;
export const ENACTMENT_BOUNDARY = /reenacted as follows\s*:\s*$/;
export const ENACTMENT_CLAUSE = /^Be it enacted by the General Assembly/;

export const PAGE_FOOTER_PATTERNS = [
  /^\s*-\s*\d+\s*-\s*$/,
  /^\s*Page\s+\d+\s*(of\s+\d+)?\s*$/i,
  /^\s*\d+\s*$/,
];

export interface SplitResult {
  paragraphs: ParsedParagraph[];
  consumedCount: number;
}

export function isPageFooter(line: string): boolean {
  return PAGE_FOOTER_PATTERNS.some(p => p.test(line));
}

export function splitByBlankLines(lines: readonly string[]): SplitResult {
  const paragraphs: ParsedParagraph[] = [];
  const currentLines: string[] = [];
  let sectionStack: string[] = [];
  let paragraphIndex = 0;
  let consumedCount = 0;

  function flushParagraph(): void {
    const text = currentLines.join("\n").trim();
    if (text.length === 0) {
      currentLines.length = 0;
      return;
    }

    const structuralPath = buildPath(sectionStack, paragraphIndex);
    const run: ParsedRun = {
      text,
      properties: { italic: false, strikethrough: false },
    };

    paragraphs.push({ structuralPath, runs: [run] });
    paragraphIndex++;
    currentLines.length = 0;
  }

  for (const line of lines) {
    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    consumedCount++;
    const headingMatch = SECTION_HEADING.exec(line.trim());
    if (headingMatch) {
      flushParagraph();
      sectionStack = updateSectionStack(sectionStack, line.trim());
      paragraphIndex = 0;
    }

    currentLines.push(line);
  }

  flushParagraph();

  return { paragraphs, consumedCount };
}

export function splitByStructure(lines: readonly string[]): SplitResult {
  const paragraphs: ParsedParagraph[] = [];
  const currentLines: string[] = [];
  let sectionStack: string[] = [];
  let paragraphIndex = 0;
  let inPreamble = true;
  let seenEnactmentClause = false;
  let consumedCount = 0;

  function flushParagraph(): void {
    const text = currentLines.join(" ").replace(/\s+/g, " ").trim();
    if (text.length === 0) {
      currentLines.length = 0;
      return;
    }

    const structuralPath = buildPath(sectionStack, paragraphIndex);
    const run: ParsedRun = {
      text,
      properties: { italic: false, strikethrough: false },
    };

    paragraphs.push({ structuralPath, runs: [run] });
    paragraphIndex++;
    currentLines.length = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.length === 0) continue;

    consumedCount++;

    if (inPreamble && ENACTMENT_BOUNDARY.test(trimmed)) {
      currentLines.push(trimmed);
      flushParagraph();
      inPreamble = false;
      seenEnactmentClause = false;
      continue;
    }

    if (inPreamble && ENACTMENT_CLAUSE.test(trimmed)) {
      flushParagraph();
      currentLines.push(trimmed);
      seenEnactmentClause = true;
      continue;
    }

    if (inPreamble && seenEnactmentClause) {
      currentLines.push(trimmed);
      continue;
    }

    const sectionSymbolMatch = SECTION_SYMBOL.exec(trimmed);
    if (sectionSymbolMatch && !inPreamble && currentLines.length === 0) {
      flushParagraph();
      const sectionId = trimmed.match(/^§\s*([\d.:-]+)/)?.[1]?.replace(/[.:]$/, "") ?? "0";
      sectionStack = [`section[${sectionId}]`];
      paragraphIndex = 0;
      currentLines.push(trimmed);
      continue;
    }

    const headingMatch = SECTION_HEADING.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      sectionStack = updateSectionStack(sectionStack, trimmed);
      paragraphIndex = 0;
      currentLines.push(trimmed);
      continue;
    }

    if (!inPreamble && SUBSECTION_LETTER.test(trimmed)) {
      flushParagraph();
      currentLines.push(trimmed);
      continue;
    }

    if (!inPreamble && NUMBERED_SUBDIVISION.test(trimmed)) {
      flushParagraph();
      currentLines.push(trimmed);
      continue;
    }

    currentLines.push(trimmed);
  }

  flushParagraph();

  return { paragraphs, consumedCount };
}

export function buildPath(sectionStack: readonly string[], paragraphIndex: number): string {
  if (sectionStack.length === 0) {
    return `/body/p[${paragraphIndex}]`;
  }
  const sections = sectionStack.map(s => `/${s}`).join("");
  return `/body${sections}/p[${paragraphIndex}]`;
}

export function updateSectionStack(current: readonly string[], heading: string): string[] {
  const match = /^(SECTION|Section|ARTICLE|Article|CHAPTER|Chapter|TITLE|Title|PART|Part)\s+(\S+)/i.exec(heading);
  if (!match) return [...current];

  const type = match[1]!.toLowerCase();
  const number = match[2]!.replace(/[.:]$/, "");
  const entry = `${type}[${number}]`;

  const hierarchy = ["part", "title", "chapter", "article", "section"];
  const typeIndex = hierarchy.indexOf(type);

  if (typeIndex === -1) return [...current, entry];

  const cutIndex = current.findIndex(s => {
    const existingType = s.split("[")[0]!;
    const existingIndex = hierarchy.indexOf(existingType);
    return existingIndex >= typeIndex;
  });

  if (cutIndex === -1) return [...current, entry];
  return [...current.slice(0, cutIndex), entry];
}
