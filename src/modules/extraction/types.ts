import type { SegmentId, DocumentVersionId, PromptHash, ModelCallId } from "../shared/types.js";

export const SpanProposalKind = {
  obligation_deadline: "obligation_deadline",
  effective_date: "effective_date",
  duration: "duration",
  temporal_constraint: "temporal_constraint",
} as const;
export type SpanProposalKind =
  (typeof SpanProposalKind)[keyof typeof SpanProposalKind];

export interface SpanProposal {
  readonly segmentId: SegmentId;
  readonly quotedText: string;
  readonly kind: SpanProposalKind;
  readonly obligationTitle: string | null;
  readonly sectionCitation: string | null;
  readonly actor: string | null;
  readonly actorQuotedText: string | null;
  readonly dependsOnQuotedText: string | null;
  readonly dependsOnDescription: string | null;
}

export interface ModelCallRecord {
  readonly modelCallId: ModelCallId;
  readonly documentVersionId: DocumentVersionId;
  readonly segmentId: SegmentId;
  readonly modelId: string;
  readonly promptHash: PromptHash;
  readonly requestPayload: string;
  readonly responsePayload: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly correlationId: string;
  readonly repaired: boolean;
  readonly createdAt: string;
}

export interface SegmentExtractionResult {
  readonly segmentId: SegmentId;
  readonly proposals: readonly SpanProposal[];
  readonly modelCallId: ModelCallId;
  readonly repaired: boolean;
}

export interface DocumentExtractionResult {
  readonly documentVersionId: DocumentVersionId;
  readonly extractorVersion: string;
  readonly segmentResults: readonly SegmentExtractionResult[];
  readonly totalProposals: number;
  readonly totalRepaired: number;
  readonly totalSegmentsProcessed: number;
  readonly totalSegmentsSkipped: number;
}
