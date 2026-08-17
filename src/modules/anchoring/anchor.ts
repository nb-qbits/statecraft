import { normalizeForEvidenceMatchV1 } from "../parsing/normalize.js";
import type { AnchorResult, AnchorMethod } from "../shared/types.js";
import type { OffsetMap } from "../parsing/types.js";

export const ANCHORER_VERSION = "1.5.0";

const MIN_FUZZY_LENGTH = 10;
const MAX_DISTANCE_RATIO = 0.1;

export function anchorQuote(
  normalizedSegmentText: string,
  quotedText: string,
  offsetMap: OffsetMap,
): AnchorResult {
  if (!quotedText || quotedText.trim().length === 0) {
    return { anchored: false, reason: "empty_quote" };
  }

  if (!normalizedSegmentText || normalizedSegmentText.length === 0) {
    return { anchored: false, reason: "empty_segment" };
  }

  const exactPos = normalizedSegmentText.indexOf(quotedText);
  if (exactPos >= 0) {
    return toSuccess(
      exactPos,
      exactPos + quotedText.length,
      offsetMap,
      "exact",
    );
  }

  const { normalized: normalizedQuote } =
    normalizeForEvidenceMatchV1(quotedText);

  if (normalizedQuote.length === 0) {
    return { anchored: false, reason: "empty_after_normalization" };
  }

  const normPos = normalizedSegmentText.indexOf(normalizedQuote);
  if (normPos >= 0) {
    return toSuccess(
      normPos,
      normPos + normalizedQuote.length,
      offsetMap,
      "normalized_exact",
    );
  }

  if (normalizedQuote.length < MIN_FUZZY_LENGTH) {
    return { anchored: false, reason: "no_match" };
  }

  const maxErrors = Math.ceil(normalizedQuote.length * MAX_DISTANCE_RATIO);
  const match = fuzzySubstringSearch(
    normalizedSegmentText,
    normalizedQuote,
    maxErrors,
  );

  if (!match) {
    return { anchored: false, reason: "fuzzy_ceiling_exceeded" };
  }

  return toSuccess(match.start, match.end, offsetMap, "fuzzy");
}

function toSuccess(
  normalizedStart: number,
  normalizedEnd: number,
  offsetMap: OffsetMap,
  method: AnchorMethod,
): AnchorResult {
  const originalStart =
    offsetMap.normalizedToOriginal[normalizedStart] ?? normalizedStart;
  const lastNormIdx = normalizedEnd - 1;
  const lastOrigIdx =
    offsetMap.normalizedToOriginal[lastNormIdx] ?? lastNormIdx;
  const originalEnd = lastOrigIdx + 1;

  return {
    anchored: true,
    normalizedStart,
    normalizedEnd,
    originalStart,
    originalEnd,
    method,
  };
}

interface FuzzyMatch {
  readonly start: number;
  readonly end: number;
  readonly distance: number;
}

export function fuzzySubstringSearch(
  text: string,
  pattern: string,
  maxErrors: number,
): FuzzyMatch | null {
  const m = pattern.length;
  const n = text.length;

  if (m === 0 || n === 0) return null;

  let prev = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
    }
    prev = curr;
  }

  let minDist = maxErrors + 1;
  let bestEnd = -1;
  for (let j = 1; j <= n; j++) {
    if (prev[j]! < minDist) {
      minDist = prev[j]!;
      bestEnd = j;
    }
  }

  if (minDist > maxErrors) return null;

  const textSlice = text.slice(0, bestEnd);
  const revText = reverseString(textSlice);
  const revPattern = reverseString(pattern);
  const tn = revText.length;

  let revPrev = new Array<number>(tn + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(tn + 1);
    curr[0] = i;
    for (let j = 1; j <= tn; j++) {
      const cost = revPattern[i - 1] === revText[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,
        revPrev[j]! + 1,
        revPrev[j - 1]! + cost,
      );
    }
    revPrev = curr;
  }

  let revMinDist = m + 1;
  let bestRevEnd = 0;
  for (let j = 1; j <= tn; j++) {
    if (revPrev[j]! < revMinDist) {
      revMinDist = revPrev[j]!;
      bestRevEnd = j;
    }
  }

  const bestStart = bestEnd - bestRevEnd;

  return { start: bestStart, end: bestEnd, distance: minDist };
}

function reverseString(s: string): string {
  const arr = new Array<string>(s.length);
  for (let i = 0; i < s.length; i++) {
    arr[s.length - 1 - i] = s[i]!;
  }
  return arr.join("");
}
