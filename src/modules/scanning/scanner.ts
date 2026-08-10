import { createHash } from "node:crypto";
import { CoverageState } from "../shared/types.js";
import type { SegmentId, CandidateId } from "../shared/types.js";
import { SCAN_RULES } from "./rules.js";
import type { CandidateMatch, SegmentScanResult } from "./types.js";

export const SCANNER_VERSION = "1.0.0";

export function computeCandidateId(
  segmentId: SegmentId,
  ruleId: string,
  matchStart: number,
  matchEnd: number,
): CandidateId {
  const input = `${segmentId}|${ruleId}|${matchStart}|${matchEnd}`;
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 32);
  return `cand_${hash}` as CandidateId;
}

export function deriveCoverageState(
  candidates: readonly CandidateMatch[],
): CoverageState {
  const hasNonSuppressed = candidates.some(c => !c.suppressed);
  return hasNonSuppressed
    ? CoverageState.candidates_found
    : CoverageState.screened_no_candidate;
}

export function scanSegment(
  segmentId: SegmentId,
  normalizedText: string,
): SegmentScanResult {
  if (normalizedText.trim().length === 0) {
    return {
      segmentId,
      coverageState: CoverageState.screened_no_candidate,
      candidates: [],
    };
  }

  const suppressionRule = SCAN_RULES.find(r => r.isSuppression);
  const isFullySuppressed =
    suppressionRule !== undefined && suppressionRule.pattern.test(normalizedText);

  const candidates: CandidateMatch[] = [];

  for (const rule of SCAN_RULES) {
    if (rule.isSuppression) continue;

    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(normalizedText)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;

      candidates.push({
        candidateId: computeCandidateId(segmentId, rule.ruleId, matchStart, matchEnd),
        segmentId,
        kind: rule.kind,
        ruleId: rule.ruleId,
        matchedText: match[0],
        matchStart,
        matchEnd,
        suppressed: isFullySuppressed,
      });
    }
  }

  return {
    segmentId,
    coverageState: deriveCoverageState(candidates),
    candidates,
  };
}
