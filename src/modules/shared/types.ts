declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type DocumentId = Brand<string, "DocumentId">;
export type DocumentVersionId = Brand<string, "DocumentVersionId">;
export type SegmentId = Brand<string, "SegmentId">;
export type ProposalId = Brand<string, "ProposalId">;
export type RecordVersionId = Brand<string, "RecordVersionId">;
export type CorrelationId = Brand<string, "CorrelationId">;
export type ContentHash = Brand<string, "ContentHash">;

export const LegislativeStatus = {
  introduced: "introduced",
  engrossed: "engrossed",
  enrolled: "enrolled",
  enacted: "enacted",
  vetoed: "vetoed",
  failed: "failed",
  unknown: "unknown",
} as const;
export type LegislativeStatus =
  (typeof LegislativeStatus)[keyof typeof LegislativeStatus];

export const StatusProvenance = {
  caller_asserted: "caller_asserted",
  metadata_source: "metadata_source",
  default_unknown: "default_unknown",
} as const;
export type StatusProvenance =
  (typeof StatusProvenance)[keyof typeof StatusProvenance];

export const CoverageState = {
  candidates_found: "candidates_found",
  screened_no_candidate: "screened_no_candidate",
} as const;
export type CoverageState =
  (typeof CoverageState)[keyof typeof CoverageState];

export const AnchorMethod = {
  exact: "exact",
  normalized_exact: "normalized_exact",
  fuzzy: "fuzzy",
} as const;
export type AnchorMethod =
  (typeof AnchorMethod)[keyof typeof AnchorMethod];

export type AnchorResult =
  | {
      anchored: true;
      normalizedStart: number;
      normalizedEnd: number;
      originalStart: number;
      originalEnd: number;
      method: AnchorMethod;
    }
  | {
      anchored: false;
      reason: string;
    };

export const SupportLevel = {
  supported: "supported",
  ambiguous: "ambiguous",
  unsupported: "unsupported",
} as const;
export type SupportLevel =
  (typeof SupportLevel)[keyof typeof SupportLevel];

export const EvaluatorVerdict = {
  ambiguous: "ambiguous",
  unsupported: "unsupported",
} as const;
export type EvaluatorVerdict =
  (typeof EvaluatorVerdict)[keyof typeof EvaluatorVerdict];

export const Lane = {
  straight_through: "straight_through",
  quick_confirmation: "quick_confirmation",
  exception_review: "exception_review",
  blocked: "blocked",
} as const;
export type Lane = (typeof Lane)[keyof typeof Lane];
