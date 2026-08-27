import type {
  SegmentId,
  DocumentVersionId,
  AnchorId,
  AnchorResult,
} from "../shared/types.js";
import type { SpanProposalKind } from "../extraction/types.js";

export const MaterialField = {
  deliverable: "deliverable",
  actor: "actor",
  recipient: "recipient",
  deadlineKind: "deadlineKind",
  sourceExpression: "sourceExpression",
  trigger: "trigger",
  eventType: "eventType",
  dependency: "dependency",
  conditions: "conditions",
  exceptions: "exceptions",
} as const;
export type MaterialField =
  (typeof MaterialField)[keyof typeof MaterialField];

export type AnchoredResult = Extract<AnchorResult, { anchored: true }>;

export interface EvidenceReference {
  readonly segmentId: SegmentId;
  readonly quotedText: string;
  readonly kind: SpanProposalKind;
  readonly anchor: AnchoredResult;
}

export type FieldEvidence = Record<MaterialField, EvidenceReference[]>;

export interface ProposalAnchorResult {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly quotedText: string;
  readonly kind: SpanProposalKind;
  readonly obligationTitle: string | null;
  readonly sectionCitation: string | null;
  readonly result: AnchorResult;
  readonly actor: string | null;
  readonly actorQuotedText: string | null;
  readonly actorAnchored: boolean | null;
  readonly dependsOnQuotedText: string | null;
  readonly dependsOnDescription: string | null;
  readonly dependsOnAnchored: boolean | null;
}

export interface DocumentAnchoringResult {
  readonly documentVersionId: DocumentVersionId;
  readonly anchorerVersion: string;
  readonly proposalResults: readonly ProposalAnchorResult[];
  readonly totalProposals: number;
  readonly totalAnchored: number;
  readonly totalFailed: number;
}
