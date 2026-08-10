import type { SegmentId, CandidateId, CoverageState, DocumentVersionId } from "../shared/types.js";

export const CandidateKind = {
  date: "date",
  duration: "duration",
  temporal_connector: "temporal_connector",
  modal_verb: "modal_verb",
  citation: "citation",
  enactment_clause: "enactment_clause",
} as const;
export type CandidateKind =
  (typeof CandidateKind)[keyof typeof CandidateKind];

export interface ScanRule {
  readonly ruleId: string;
  readonly kind: CandidateKind;
  readonly pattern: RegExp;
  readonly isSuppression: boolean;
}

export interface CandidateMatch {
  readonly candidateId: CandidateId;
  readonly segmentId: SegmentId;
  readonly kind: CandidateKind;
  readonly ruleId: string;
  readonly matchedText: string;
  readonly matchStart: number;
  readonly matchEnd: number;
  readonly suppressed: boolean;
}

export interface SegmentScanResult {
  readonly segmentId: SegmentId;
  readonly coverageState: CoverageState;
  readonly candidates: readonly CandidateMatch[];
}

export interface DocumentScanResult {
  readonly documentVersionId: DocumentVersionId;
  readonly scannerVersion: string;
  readonly segmentResults: readonly SegmentScanResult[];
  readonly totalCandidates: number;
  readonly totalSuppressed: number;
}
