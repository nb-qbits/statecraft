import type { ParsedParagraph, ParsedRun } from "../../modules/parsing/types.js";

export const SECTION_HEADING = /^(SECTION|Section|SEC\.|Sec\.|ARTICLE|Article|CHAPTER|Chapter|TITLE|Title|PART|Part)\s+\d+/;
export const SUBSECTION_LETTER = /^([A-Z])\.\s/;
export const PAREN_SUBSECTION = /^\(([a-z])\)\s/;
export const NUMBERED_SUBDIVISION = /^(\d{1,2})\.\s/;
export const SECTION_SYMBOL = /^§\s*[\d.:-]+/;
export const ENACTMENT_BOUNDARY = /reenacted as follows\s*:\s*$/;
export const ENACTMENT_CLAUSE = /^Be it enacted by the (General Assembly|Senate and House)/;

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

    const headingMatch = SECTION_HEADING.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      inPreamble = false;
      seenEnactmentClause = false;
      sectionStack = updateSectionStack(sectionStack, trimmed);
      paragraphIndex = 0;
      currentLines.push(trimmed);
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

    if (!inPreamble && SUBSECTION_LETTER.test(trimmed)) {
      flushParagraph();
      currentLines.push(trimmed);
      continue;
    }

    if (!inPreamble && PAREN_SUBSECTION.test(trimmed)) {
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

const SECTION_DEF_BOUNDARY = /(?<!(?:[Ii]n|[Tt]o|[Oo]f|[Pp]er|[Uu]nder|[Ff]rom|[Bb]y|[Aa]t|[Ii]nto)\s)§\s*(\d[\d.:-]+)\.\s+[A-Z][a-z]/g;

export function splitOnEmbeddedSections(paragraphs: ParsedParagraph[]): ParsedParagraph[] {
  const result: ParsedParagraph[] = [];

  for (const p of paragraphs) {
    const text = p.runs.map(r => r.text).join("");
    const matches = [...text.matchAll(SECTION_DEF_BOUNDARY)];

    if (matches.length === 0) {
      result.push(p);
      continue;
    }

    if (matches.length === 1 && matches[0]!.index === 0) {
      const sectionId = matches[0]![1]!.replace(/[.:]$/, "");
      if (p.structuralPath.includes(`section[${sectionId}]`)) {
        result.push(p);
        continue;
      }
    }

    const parentPath = extractParentPath(p.structuralPath);
    let subIndex = 0;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const start = match.index!;
      const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;

      if (i === 0 && start > 0) {
        const preambleText = text.slice(0, start).trim();
        if (preambleText.length > 0) {
          result.push({
            structuralPath: `${parentPath}/p[${subIndex}]`,
            runs: [{ text: preambleText, properties: { italic: false, strikethrough: false } }],
          });
          subIndex++;
        }
      }

      const sectionId = match[1]!.replace(/[.:]$/, "");
      const sectionText = text.slice(start, end).trim();

      result.push({
        structuralPath: `${parentPath}/section[${sectionId}]/p[0]`,
        runs: [{ text: sectionText, properties: { italic: false, strikethrough: false } }],
      });
    }
  }

  return result;
}

function extractParentPath(structuralPath: string): string {
  const match = structuralPath.match(/^(.*)\/p\[\d+\]$/);
  return match ? match[1]! : structuralPath;
}

export function detectLineNumbers(lines: readonly string[]): boolean {
  const candidateLines = lines.filter(l => l.trim().length > 0).slice(0, 30);
  if (candidateLines.length < 5) return false;

  let matchCount = 0;
  let lastNumber = 0;
  let sequentialCount = 0;

  for (const line of candidateLines) {
    const match = /^(\s*\d{1,4})\s+/.exec(line);
    if (match) {
      matchCount++;
      const num = parseInt(match[1]!.trim(), 10);
      if (num === lastNumber + 1) sequentialCount++;
      lastNumber = num;
    }
  }

  return matchCount >= candidateLines.length * 0.7 && sequentialCount >= 3;
}

export function stripDetectedLineNumber(line: string): string {
  let result = line;
  for (let i = 0; i < 3; i++) {
    const stripped = result.replace(/^\s*\d{1,4}\s+/, "");
    if (stripped === result) break;
    result = stripped;
  }
  return result;
}

export interface EnactingClauseInfo {
  readonly declaredSections: readonly string[];
  readonly source: string;
}

export interface ReconciliationResult {
  readonly paragraphs: readonly ParsedParagraph[];
  readonly warnings: readonly string[];
  readonly enactingClause: EnactingClauseInfo | null;
}

const ENACTED_RANGE = /sections?\s+(?:numbered\s+)?([\d.:-]+)\s+through\s+([\d.:-]+)/i;
const ENACTED_SINGLE = /That\s+§\s*([\d.:-]+)\s+of\s+the\s+Code.*?is\s+amended/i;
const ENACTED_MULTI = /That\s+§§\s*([\d.:-]+(?:\s*,\s*[\d.:-]+)*)\s*(?:,?\s*and\s+([\d.:-]+))?\s+of\s+the\s+Code/i;

export function expandSectionRange(start: string, end: string): string[] | null {
  const startMatch = start.match(/^(.*?)(\d+)$/);
  const endMatch = end.match(/^(.*?)(\d+)$/);
  if (!startMatch || !endMatch) return null;
  if (startMatch[1] !== endMatch[1]) return null;

  const prefix = startMatch[1]!;
  const startNum = parseInt(startMatch[2]!, 10);
  const endNum = parseInt(endMatch[2]!, 10);
  if (startNum > endNum || endNum - startNum > 200) return null;

  return Array.from({ length: endNum - startNum + 1 }, (_, i) => `${prefix}${startNum + i}`);
}

export function parseEnactingClause(paragraphs: readonly ParsedParagraph[]): EnactingClauseInfo | null {
  for (const p of paragraphs) {
    const text = p.runs.map(r => r.text).join("");

    const rangeMatch = ENACTED_RANGE.exec(text);
    if (rangeMatch) {
      const sections = expandSectionRange(rangeMatch[1]!, rangeMatch[2]!);
      if (sections) {
        return { declaredSections: sections, source: rangeMatch[0] };
      }
    }

    const multiMatch = ENACTED_MULTI.exec(text);
    if (multiMatch) {
      const ids = multiMatch[1]!.split(/\s*,\s*/).filter(s => s.length > 0);
      if (multiMatch[2]) ids.push(multiMatch[2]);
      return { declaredSections: ids, source: multiMatch[0] };
    }

    const singleMatch = ENACTED_SINGLE.exec(text);
    if (singleMatch) {
      return { declaredSections: [singleMatch[1]!], source: singleMatch[0] };
    }
  }
  return null;
}

export function reconcileWithEnactingClause(
  paragraphs: readonly ParsedParagraph[],
): ReconciliationResult {
  const enactingClause = parseEnactingClause(paragraphs);
  if (!enactingClause) {
    return { paragraphs, warnings: [], enactingClause: null };
  }

  const declaredSet = new Set(enactingClause.declaredSections);
  const warnings: string[] = [];
  const corrected: ParsedParagraph[] = [];

  const foundSections = new Set<string>();

  for (const p of paragraphs) {
    const sectionMatch = p.structuralPath.match(/\/section\[([\d.:-]+)\]/);
    if (sectionMatch) {
      const sectionId = sectionMatch[1]!;
      if (declaredSet.has(sectionId)) {
        foundSections.add(sectionId);
        corrected.push(p);
      } else {
        warnings.push(
          `Split produced section ${sectionId} outside declared range [${enactingClause.declaredSections[0]}..${enactingClause.declaredSections[enactingClause.declaredSections.length - 1]}]; reverted to parent path`,
        );
        corrected.push({
          structuralPath: p.structuralPath.replace(/\/section\[[\d.:-]+\]/, ""),
          runs: p.runs,
        });
      }
    } else {
      corrected.push(p);
    }
  }

  for (const declared of enactingClause.declaredSections) {
    if (!foundSections.has(declared)) {
      warnings.push(`Declared section ${declared} not found in parsed document`);
    }
  }

  return { paragraphs: corrected, warnings, enactingClause };
}

export function updateSectionStack(current: readonly string[], heading: string): string[] {
  const match = /^(SECTION|Section|SEC\.|Sec\.|ARTICLE|Article|CHAPTER|Chapter|TITLE|Title|PART|Part)\s+(\S+)/i.exec(heading);
  if (!match) return [...current];

  let type = match[1]!.toLowerCase().replace(/\.$/, "");
  if (type === "sec") type = "section";
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
