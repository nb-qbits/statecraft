import type {
  AnchorId,
  SegmentId,
  DocumentVersionId,
  EvaluatorVerdict,
  SupportLevel,
  PromptHash,
} from "../shared/types.js";

export const EVALUATOR_VERSION = "1.0.0";

export const CheckStatus = {
  passed: "passed",
  failed: "failed",
} as const;
export type CheckStatus = (typeof CheckStatus)[keyof typeof CheckStatus];

export interface CheckResult {
  readonly check: string;
  readonly status: CheckStatus;
  readonly reason: string | null;
}

export interface DeterministicCheckSummary {
  readonly allPassed: boolean;
  readonly checks: readonly CheckResult[];
}

export interface SpanEvaluation {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly quotedText: string;
  readonly deterministicResult: DeterministicCheckSummary;
  readonly evaluatorVerdict: EvaluatorVerdict | null;
  readonly supportLevel: SupportLevel;
}

export interface DocumentEvaluationResult {
  readonly documentVersionId: DocumentVersionId;
  readonly evaluatorVersion: string;
  readonly promptHash: PromptHash;
  readonly evaluations: readonly SpanEvaluation[];
  readonly approved: boolean;
  readonly totalEvaluated: number;
  readonly totalSupported: number;
  readonly totalAmbiguous: number;
  readonly totalUnsupported: number;
}
