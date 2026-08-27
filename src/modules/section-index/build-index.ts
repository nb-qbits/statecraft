import type { SourceSegment } from "../parsing/types.js";
import { parseEnactingClause } from "../../platform/parsers/structural-segmentation.js";
import type { Jurisdiction, EnactedUnit, SectionIndex, SubMarker, CitationSegmentRange } from "./types.js";

const SECTION_PATH_RE = /\/section\[([\d.:-]+)\]/;

interface StackEntry {
  level: number;
  label: string;
}

interface SegmentCitationEntry {
  primary: string;
  subMarkers: readonly SubMarker[];
}

function buildCitationString(sectionId: string, stack: readonly StackEntry[]): string {
  const subs = stack.map(s => `(${s.label})`).join("");
  return `§ ${sectionId}${subs}`;
}

// --- Virginia marker detection ---

const VA_LETTER_RE = /^([A-Z])\.\s/;
const VA_COMPOUND_RE = /^([A-Z])\.\s(\d+)\.\s/;
const VA_NUMBER_RE = /^(\d+)\.\s/;
const VA_LOWER_RE = /^([a-z])\.\s/;

function detectVirginiaMarkers(
  text: string,
  currentStack: readonly StackEntry[],
): StackEntry[] {
  const compoundMatch = VA_COMPOUND_RE.exec(text);
  if (compoundMatch) {
    return [
      { level: 1, label: compoundMatch[1]! },
      { level: 2, label: compoundMatch[2]! },
    ];
  }
  const letterMatch = VA_LETTER_RE.exec(text);
  if (letterMatch) {
    return [{ level: 1, label: letterMatch[1]! }];
  }
  const deepest = currentStack.length > 0 ? currentStack[currentStack.length - 1]!.level : 0;
  const numberMatch = VA_NUMBER_RE.exec(text);
  if (numberMatch && deepest >= 1) {
    return [{ level: 2, label: numberMatch[1]! }];
  }
  const lowerMatch = VA_LOWER_RE.exec(text);
  if (lowerMatch && deepest >= 2) {
    return [{ level: 3, label: lowerMatch[1]! }];
  }
  return [];
}

// --- Federal marker detection ---

const FED_LOWER_PAREN_RE = /^\(([a-z])\)\s/;
const FED_NUMBER_PAREN_RE = /^\((\d+)\)\s/;
const FED_UPPER_PAREN_RE = /^\(([A-Z])\)\s/;
const FED_ROMAN_PAREN_RE = /^\(([ivxlcdm]+)\)\s/;

function detectFederalStartMarker(
  text: string,
  currentStack: readonly StackEntry[],
): StackEntry | null {
  const deepest = currentStack.length > 0 ? currentStack[currentStack.length - 1]!.level : 0;

  const romanMatch = FED_ROMAN_PAREN_RE.exec(text);
  if (romanMatch && deepest >= 3) {
    return { level: 4, label: romanMatch[1]! };
  }

  const upperMatch = FED_UPPER_PAREN_RE.exec(text);
  if (upperMatch && deepest >= 2) {
    return { level: 3, label: upperMatch[1]! };
  }

  const numberMatch = FED_NUMBER_PAREN_RE.exec(text);
  if (numberMatch && deepest >= 1) {
    return { level: 2, label: numberMatch[1]! };
  }

  const lowerMatch = FED_LOWER_PAREN_RE.exec(text);
  if (lowerMatch) {
    return { level: 1, label: lowerMatch[1]! };
  }

  if (romanMatch) return { level: 4, label: romanMatch[1]! };
  if (upperMatch) return { level: 3, label: upperMatch[1]! };
  if (numberMatch) return { level: 2, label: numberMatch[1]! };

  return null;
}

const CITATION_PREFIX_RE = /(?:§|section|subsection|sec\.)\s*$/i;
const FED_INNER_MARKER_RE = /(?:^|\s)\(([a-z]|\d+|[A-Z]|[ivxlcdm]+)\)\s/g;

function scanFederalInnerMarkers(
  text: string,
  initialStack: readonly StackEntry[],
  sectionId: string,
): SubMarker[] {
  const markers: SubMarker[] = [];
  const stack = [...initialStack];

  const re = new RegExp(FED_INNER_MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  let firstSkipped = false;

  while ((match = re.exec(text)) !== null) {
    if (!firstSkipped && match.index === 0) {
      firstSkipped = true;
      continue;
    }
    firstSkipped = true;

    const preceding = text.slice(Math.max(0, match.index - 15), match.index);
    if (CITATION_PREFIX_RE.test(preceding)) continue;

    const raw = match[1]!;
    const entry = classifyFederalMarker(raw, stack);
    if (!entry) continue;

    while (stack.length > 0 && stack[stack.length - 1]!.level >= entry.level) {
      stack.pop();
    }
    stack.push(entry);

    const parenStart = text.indexOf("(", match.index + (match[0].startsWith(" ") ? 1 : 0));
    markers.push({
      offset: parenStart >= 0 ? parenStart : match.index,
      citation: buildCitationString(sectionId, stack),
    });
  }

  return markers;
}

function classifyFederalMarker(
  raw: string,
  currentStack: readonly StackEntry[],
): StackEntry | null {
  const deepest = currentStack.length > 0 ? currentStack[currentStack.length - 1]!.level : 0;

  if (/^\d+$/.test(raw)) return { level: 2, label: raw };
  if (/^[A-Z]$/.test(raw)) return { level: 3, label: raw };
  if (/^[ivxlcdm]+$/.test(raw) && deepest >= 2) return { level: 4, label: raw };
  if (/^[a-z]$/.test(raw) && deepest < 2) return { level: 1, label: raw };
  if (/^[a-z]$/.test(raw)) return null;
  return null;
}

// --- Citation parsing for resolution ---

const CITATION_STRIP_RE = /^(?:§§?\s*|[Ss]ection\s+|[Ss]ec\.?\s+)/;
const SUBSECTION_PARTS_RE = /\(([^)]+)\)/g;

export interface ParsedCitation {
  sectionId: string;
  subsectionPath: string[];
}

export function parseCitationString(citation: string): ParsedCitation | null {
  let s = citation.trim();
  s = s.replace(CITATION_STRIP_RE, "");
  s = s.replace(/\.\s*$/, "");

  const parts: string[] = [];
  let base = s;
  const firstParen = s.indexOf("(");
  if (firstParen >= 0) {
    base = s.slice(0, firstParen).trim();
    const subPart = s.slice(firstParen);
    let m: RegExpExecArray | null;
    const re = new RegExp(SUBSECTION_PARTS_RE.source, "g");
    while ((m = re.exec(subPart)) !== null) {
      parts.push(m[1]!);
    }
  }

  base = base.replace(/\.\s*$/, "").trim();
  if (!base) return null;

  return { sectionId: base, subsectionPath: parts };
}

export function normalizeSectionId(raw: string): string {
  let s = raw.trim();
  s = s.replace(CITATION_STRIP_RE, "");
  s = s.replace(/\.\s*$/, "");
  return s.trim();
}

// --- Main build function ---

export function buildSectionIndex(
  segments: readonly SourceSegment[],
  jurisdiction?: Jurisdiction,
): SectionIndex {
  const jur = jurisdiction ?? "us-va";

  const paragraphs = segments.map(s => ({
    structuralPath: s.structuralPath,
    runs: [{ text: s.rawText, properties: { italic: false as const, strikethrough: false as const } }] as const,
  }));
  const enactingClause = parseEnactingClause(paragraphs);

  const sectionSet = new Set<string>();
  const sectionParents = new Map<string, string>();
  for (const seg of segments) {
    const m = SECTION_PATH_RE.exec(seg.structuralPath);
    if (m) {
      const id = m[1]!;
      sectionSet.add(id);
      if (!sectionParents.has(id)) {
        sectionParents.set(id, seg.structuralPath.replace(/\/section\[[\d.:-]+\]\/.*$/, ""));
      }
    }
  }

  const segmentCitations = new Map<string, SegmentCitationEntry>();
  const segmentSections = new Map<string, string>();
  let currentSection: string | null = null;
  let subStack: StackEntry[] = [];

  for (const seg of segments) {
    const sectionMatch = SECTION_PATH_RE.exec(seg.structuralPath);
    const segSection = sectionMatch ? sectionMatch[1]! : null;

    if (segSection && segSection !== currentSection) {
      currentSection = segSection;
      subStack = [];
    }

    if (!currentSection) continue;

    segmentSections.set(seg.segmentId as string, currentSection);

    const text = seg.normalizedText.trimStart();
    let markers: StackEntry[] = [];
    if (jur === "us-va") {
      markers = detectVirginiaMarkers(text, subStack);
    } else {
      const m = detectFederalStartMarker(text, subStack);
      if (m) markers = [m];
    }

    for (const marker of markers) {
      while (subStack.length > 0 && subStack[subStack.length - 1]!.level >= marker.level) {
        subStack.pop();
      }
      subStack.push(marker);
    }

    const primary = buildCitationString(currentSection, subStack);

    let subMarkers: SubMarker[] = [];
    if (jur === "us-fed") {
      subMarkers = scanFederalInnerMarkers(text, subStack, currentSection);
    }

    segmentCitations.set(seg.segmentId, { primary, subMarkers });
  }

  // --- Validation ---
  const errors: string[] = [];
  const declaredSections = enactingClause?.declaredSections ?? null;

  if (declaredSections) {
    const declaredSet = new Set(declaredSections);

    for (const d of declaredSections) {
      if (!sectionSet.has(d)) {
        errors.push(`Declared section ${d} not found in parsed document`);
      }
    }

    for (const id of sectionSet) {
      if (!declaredSet.has(id)) {
        errors.push(`Section ${id} found but not in declared range [${declaredSections[0]}..${declaredSections[declaredSections.length - 1]}]`);
      }
    }

    const byParent = new Map<string, string[]>();
    for (const id of sectionSet) {
      if (!declaredSet.has(id)) continue;
      const parent = sectionParents.get(id) ?? "";
      const existing = byParent.get(parent) ?? [];
      existing.push(id);
      byParent.set(parent, existing);
    }

    for (const [, ids] of byParent) {
      const nums = ids
        .map(id => {
          const m = id.match(/(\d+)$/);
          return m ? parseInt(m[1]!, 10) : null;
        })
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b);

      for (let i = 1; i < nums.length; i++) {
        if (nums[i]! !== nums[i - 1]! + 1) {
          errors.push(`Gap in section sequence: ...${nums[i - 1]} → ${nums[i]}... (expected ${nums[i - 1]! + 1})`);
        }
      }
    }

    const parentPaths = new Set<string>();
    for (const id of sectionSet) {
      if (declaredSet.has(id)) {
        parentPaths.add(sectionParents.get(id) ?? "");
      }
    }
    if (parentPaths.size > 1) {
      errors.push(`Enacted sections span multiple parents: ${[...parentPaths].join(", ")}`);
    }
  }

  // --- Build resolution index ---
  const allUnits = new Map<string, EnactedUnit>();

  for (const sectionId of sectionSet) {
    const citation = `§ ${sectionId}`;
    const key = sectionId.toLowerCase();
    allUnits.set(key, { sectionId, subsectionPath: [], citation });
  }

  for (const [, entry] of segmentCitations) {
    registerUnit(allUnits, entry.primary);
    for (const sm of entry.subMarkers) {
      registerUnit(allUnits, sm.citation);
    }
  }

  const valid = errors.length === 0;

  // --- Build reverse citation map: citation → segment ranges ---
  const citationSegments = new Map<string, CitationSegmentRange[]>();
  for (const [segId, entry] of segmentCitations) {
    if (entry.subMarkers.length === 0) {
      const ranges = citationSegments.get(entry.primary) ?? [];
      ranges.push({ segmentId: segId, startOffset: 0, endOffset: Infinity });
      citationSegments.set(entry.primary, ranges);
    } else {
      const allCitations: Array<{ citation: string; offset: number }> = [
        { citation: entry.primary, offset: 0 },
        ...entry.subMarkers.map(sm => ({ citation: sm.citation, offset: sm.offset })),
      ];
      for (let i = 0; i < allCitations.length; i++) {
        const cur = allCitations[i]!;
        const endOffset = i + 1 < allCitations.length ? allCitations[i + 1]!.offset : Infinity;
        const ranges = citationSegments.get(cur.citation) ?? [];
        ranges.push({ segmentId: segId, startOffset: cur.offset, endOffset });
        citationSegments.set(cur.citation, ranges);
      }
    }
  }

  return {
    valid,
    errors,
    declaredSections,
    sections: allUnits,

    getCitationForSegment(segmentId: string): string | null {
      if (!valid) return null;
      return segmentCitations.get(segmentId)?.primary ?? null;
    },

    getCitationForAnchor(segmentId: string, normalizedStart: number): string | null {
      if (!valid) return null;
      const entry = segmentCitations.get(segmentId);
      if (!entry) return null;

      if (entry.subMarkers.length === 0) return entry.primary;

      let best = entry.primary;
      for (const sm of entry.subMarkers) {
        if (sm.offset <= normalizedStart) {
          best = sm.citation;
        }
      }
      return best;
    },

    getSectionForSegment(segmentId: string): string | null {
      if (!valid) return null;
      return segmentSections.get(segmentId) ?? null;
    },

    getSegmentsForCitation(citation: string): readonly CitationSegmentRange[] {
      if (!valid) return [];
      return citationSegments.get(citation) ?? [];
    },

    resolve(citation: string): EnactedUnit | null {
      if (!valid) return null;
      const parsed = parseCitationString(citation);
      if (!parsed) return null;

      const sectionKey = parsed.sectionId.toLowerCase();
      if (!allUnits.has(sectionKey)) return null;

      if (parsed.subsectionPath.length === 0) {
        return allUnits.get(sectionKey) ?? null;
      }

      const fullKey = `${sectionKey}(${parsed.subsectionPath.join(")(")})`.toLowerCase();
      return allUnits.get(fullKey) ?? allUnits.get(sectionKey) ?? null;
    },
  };
}

function registerUnit(map: Map<string, EnactedUnit>, citation: string): void {
  const parsed = parseCitationString(citation);
  if (!parsed) return;

  const key = parsed.subsectionPath.length > 0
    ? `${parsed.sectionId}(${parsed.subsectionPath.join(")(")})`.toLowerCase()
    : parsed.sectionId.toLowerCase();

  if (!map.has(key)) {
    map.set(key, {
      sectionId: parsed.sectionId,
      subsectionPath: parsed.subsectionPath,
      citation,
    });
  }
}
