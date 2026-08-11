import type { CoverageState } from "../shared/types.js";
import type { SegmentScanResult } from "../scanning/types.js";
import type { ProcessingCoverage, SegmentCoverage, ProcessingCoverageLabel } from "./types.js";

export function computeProcessingCoverage(
  scanResults: readonly SegmentScanResult[],
): ProcessingCoverage {
  const segments: SegmentCoverage[] = [];
  let withCandidates = 0;
  let screenedNoCandidate = 0;
  let needsSweep = 0;

  for (const sr of scanResults) {
    const label = coverageLabel(sr.coverageState);
    segments.push({ segmentId: sr.segmentId, label });

    switch (label) {
      case "with_candidates":
        withCandidates++;
        break;
      case "screened_no_candidate":
        screenedNoCandidate++;
        break;
      case "needs_sweep":
        needsSweep++;
        break;
    }
  }

  return {
    totalSegments: scanResults.length,
    withCandidates,
    screenedNoCandidate,
    needsSweep,
    segments,
  };
}

function coverageLabel(state: CoverageState): ProcessingCoverageLabel {
  switch (state) {
    case "candidates_found":
      return "with_candidates";
    case "screened_no_candidate":
      return "screened_no_candidate";
  }
}
