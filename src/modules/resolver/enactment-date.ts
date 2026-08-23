import type { ResolutionInput } from "./types.js";

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const APPROVED_RE = /\bApproved\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i;

export type EnactmentDateResult = {
  readonly found: true;
  readonly date: string;
  readonly citation: string;
} | {
  readonly found: false;
}

export function extractEnactmentDate(segmentTexts: readonly string[]): EnactmentDateResult {
  for (let i = segmentTexts.length - 1; i >= 0; i--) {
    const m = APPROVED_RE.exec(segmentTexts[i]!);
    if (m) {
      const month = MONTH_MAP[m[1]!.toLowerCase()]!;
      const day = parseInt(m[2]!, 10);
      const year = parseInt(m[3]!, 10);
      const mm = String(month).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      return {
        found: true,
        date: `${year}-${mm}-${dd}`,
        citation: `Approved ${m[1]} ${m[2]}, ${m[3]} (enactment date from public law text)`,
      };
    }
  }
  return { found: false };
}

export function enactmentDateToInput(result: Extract<EnactmentDateResult, { found: true }>): ResolutionInput {
  return {
    name: "enactmentDate",
    value: result.date,
    source: "document_text",
    authority: "act_text",
    citation: result.citation,
  };
}
