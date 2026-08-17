import type {
  AnchorId,
  SegmentId,
  DocumentVersionId,
  ContentHash,
  ProposalId,
  RecordVersionId,
  ProjectId,
  AnalysisId,
  ReviewEventId,
  RegisterRecordId,
  LegislativeStatus,
  SupportLevel,
  Lane,
} from "../shared/types.js";
import type { LegalIdentity } from "../ingestion/types.js";
import type { LaneReason } from "../routing/types.js";

export const REVIEW_VERSION = "1.0.0";

export const AnalysisStatus = {
  pending: "pending",
  running: "running",
  completed: "completed",
  failed: "failed",
} as const;
export type AnalysisStatus =
  (typeof AnalysisStatus)[keyof typeof AnalysisStatus];

export const ProposalStatus = {
  pending_review: "pending_review",
  accepted: "accepted",
  rejected: "rejected",
  split: "split",
} as const;
export type ProposalStatus =
  (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const ReviewAction = {
  accept: "accept",
  edit_and_accept: "edit_and_accept",
  reject: "reject",
  split: "split",
  manual_add: "manual_add",
} as const;
export type ReviewAction =
  (typeof ReviewAction)[keyof typeof ReviewAction];

export const DateProvenance = {
  computed: "computed",
  generic_default: "generic_default",
  reviewer_asserted: "reviewer_asserted",
  verbatim_from_instrument: "verbatim_from_instrument",
} as const;
export type DateProvenance =
  (typeof DateProvenance)[keyof typeof DateProvenance];

export const RecordStatus = {
  active: "active",
  superseded: "superseded",
} as const;
export type RecordStatus =
  (typeof RecordStatus)[keyof typeof RecordStatus];

export interface Project {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
}

export interface Analysis {
  readonly analysisId: AnalysisId;
  readonly documentVersionId: DocumentVersionId;
  readonly configHash: string;
  readonly stageVersions: Record<string, string> | null;
  readonly status: AnalysisStatus;
  readonly error: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface ReviewProposal {
  readonly proposalId: ProposalId;
  readonly analysisId: AnalysisId;
  readonly documentVersionId: DocumentVersionId;
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly quotedText: string;
  readonly kind: string;
  readonly normalizedStart: number;
  readonly normalizedEnd: number;
  readonly originalStart: number;
  readonly originalEnd: number;
  readonly anchoringMethod: string;
  readonly parsedExpression: Record<string, unknown> | null;
  readonly resolved: boolean;
  readonly statutoryDate: string | null;
  readonly adjustedDate: string | null;
  readonly rrule: string | null;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly packVersion: string | null;
  readonly actor: string | null;
  readonly actorQuotedText: string | null;
  readonly dependsOnDescription: string | null;
  readonly supportLevel: SupportLevel;
  readonly lane: Lane;
  readonly laneReasons: readonly LaneReason[];
  readonly status: ProposalStatus;
  readonly createdAt: string;
}

export interface ReviewDiff {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface ReviewEvent {
  readonly eventId: ReviewEventId;
  readonly proposalId: ProposalId | null;
  readonly action: ReviewAction;
  readonly reviewerId: string;
  readonly beforeValues: Record<string, unknown> | null;
  readonly afterValues: Record<string, unknown>;
  readonly diff: readonly ReviewDiff[];
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface RegisterRecord {
  readonly recordId: RegisterRecordId;
  readonly recordVersionId: RecordVersionId;
  readonly proposalId: ProposalId | null;
  readonly reviewEventId: ReviewEventId;
  readonly documentVersionId: DocumentVersionId;
  readonly anchorId: AnchorId | null;
  readonly segmentId: SegmentId | null;
  readonly quotedText: string | null;
  readonly kind: string;
  readonly deadlineDate: string;
  readonly adjustedDate: string;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly packVersion: string | null;
  readonly deliverable: string | null;
  readonly actor: string | null;
  readonly conditions: string | null;
  readonly rrule: string | null;
  readonly dateProvenance: DateProvenance;
  readonly status: RecordStatus;
  readonly splitFromRecordId: RegisterRecordId | null;
  readonly createdAt: string;
}

export interface ProvenanceSheet {
  readonly recordId: RegisterRecordId;
  readonly recordVersionId: RecordVersionId;
  readonly documentHash: ContentHash;
  readonly legalIdentity: LegalIdentity;
  readonly legislativeStatus: LegislativeStatus;
  readonly segmentId: SegmentId | null;
  readonly quotedSpan: {
    readonly text: string;
    readonly normalizedStart: number;
    readonly normalizedEnd: number;
    readonly originalStart: number;
    readonly originalEnd: number;
  } | null;
  readonly anchoringMethod: string | null;
  readonly deterministicParseResult: {
    readonly expression: Record<string, unknown>;
    readonly kind: string;
  } | null;
  readonly packVersion: string | null;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly modelHash: string | null;
  readonly promptHash: string | null;
  readonly evaluatorPromptHash: string | null;
  readonly dateProvenance: DateProvenance;
  readonly reviewerId: string;
  readonly reviewTimestamp: string;
  readonly reviewAction: ReviewAction;
  readonly reviewDiff: readonly ReviewDiff[];
}

export interface ReviewDecisionInput {
  readonly action: ReviewAction;
  readonly reviewerId: string;
  readonly idempotencyKey: string;
  readonly edits?: Record<string, unknown>;
  readonly splitRecords?: readonly SplitRecordInput[];
}

export interface SplitRecordInput {
  readonly deadlineDate: string;
  readonly adjustedDate: string;
  readonly kind: string;
  readonly deliverable?: string;
  readonly actor?: string;
  readonly conditions?: string;
  readonly ruleIds?: readonly string[];
  readonly citations?: readonly string[];
}

export interface ManualRecordInput {
  readonly reviewerId: string;
  readonly idempotencyKey: string;
  readonly deadlineDate: string;
  readonly adjustedDate: string;
  readonly kind: string;
  readonly deliverable?: string;
  readonly actor?: string;
  readonly conditions?: string;
  readonly ruleIds?: readonly string[];
  readonly citations?: readonly string[];
  readonly packVersion?: string;
}
