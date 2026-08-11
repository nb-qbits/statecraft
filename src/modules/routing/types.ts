import type {
  AnchorId,
  SegmentId,
  DocumentVersionId,
  Lane,
} from "../shared/types.js";

export const ROUTER_VERSION = "1.0.0";

export interface LaneReason {
  readonly rule: string;
  readonly detail: string;
}

export interface LaneAssignment {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly lane: Lane;
  readonly reasons: readonly LaneReason[];
}

export const ProcessingCoverageLabel = {
  with_candidates: "with_candidates",
  screened_no_candidate: "screened_no_candidate",
  needs_sweep: "needs_sweep",
} as const;
export type ProcessingCoverageLabel =
  (typeof ProcessingCoverageLabel)[keyof typeof ProcessingCoverageLabel];

export interface SegmentCoverage {
  readonly segmentId: SegmentId;
  readonly label: ProcessingCoverageLabel;
}

export interface ProcessingCoverage {
  readonly totalSegments: number;
  readonly withCandidates: number;
  readonly screenedNoCandidate: number;
  readonly needsSweep: number;
  readonly segments: readonly SegmentCoverage[];
}

export interface LaneSummary {
  readonly straight_through: number;
  readonly quick_confirmation: number;
  readonly exception_review: number;
  readonly blocked: number;
}

export interface DocumentRoutingResult {
  readonly documentVersionId: DocumentVersionId;
  readonly routerVersion: string;
  readonly assignments: readonly LaneAssignment[];
  readonly coverage: ProcessingCoverage;
  readonly laneSummary: LaneSummary;
  readonly totalAssignments: number;
}
