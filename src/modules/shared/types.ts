declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type DocumentId = Brand<string, "DocumentId">;
export type DocumentVersionId = Brand<string, "DocumentVersionId">;
export type SegmentId = Brand<string, "SegmentId">;
export type ProposalId = Brand<string, "ProposalId">;
export type RecordVersionId = Brand<string, "RecordVersionId">;
export type CorrelationId = Brand<string, "CorrelationId">;
export type ContentHash = Brand<string, "ContentHash">;
export type CandidateId = Brand<string, "CandidateId">;
export type PromptHash = Brand<string, "PromptHash">;
export type ModelCallId = Brand<string, "ModelCallId">;
export type AnchorId = Brand<string, "AnchorId">;

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

export const ParseStatus = {
  unparsed: "unparsed",
  parsed: "parsed",
  parse_failed: "parse_failed",
} as const;
export type ParseStatus = (typeof ParseStatus)[keyof typeof ParseStatus];

export const Fidelity = {
  declared: "declared",
  inferred: "inferred",
  none: "none",
} as const;
export type Fidelity = (typeof Fidelity)[keyof typeof Fidelity];

export const ScanStatus = {
  unscanned: "unscanned",
  scanned: "scanned",
} as const;
export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

export const Lane = {
  straight_through: "straight_through",
  quick_confirmation: "quick_confirmation",
  exception_review: "exception_review",
  blocked: "blocked",
} as const;
export type Lane = (typeof Lane)[keyof typeof Lane];

export const AnchoringStatus = {
  unanchored: "unanchored",
  anchored: "anchored",
  anchoring_failed: "anchoring_failed",
} as const;
export type AnchoringStatus =
  (typeof AnchoringStatus)[keyof typeof AnchoringStatus];

export const ExtractionStatus = {
  unextracted: "unextracted",
  extracted: "extracted",
  extraction_failed: "extraction_failed",
} as const;
export type ExtractionStatus =
  (typeof ExtractionStatus)[keyof typeof ExtractionStatus];

export const ResolutionStatus = {
  unresolved_resolver: "unresolved_resolver",
  resolved_resolver: "resolved_resolver",
} as const;
export type ResolutionStatus =
  (typeof ResolutionStatus)[keyof typeof ResolutionStatus];

export const GrammarStatus = {
  unparsed_grammar: "unparsed_grammar",
  parsed_grammar: "parsed_grammar",
} as const;
export type GrammarStatus =
  (typeof GrammarStatus)[keyof typeof GrammarStatus];

export const EvaluationStatus = {
  unevaluated: "unevaluated",
  evaluated: "evaluated",
} as const;
export type EvaluationStatus =
  (typeof EvaluationStatus)[keyof typeof EvaluationStatus];

export const RoutingStatus = {
  unrouted: "unrouted",
  routed: "routed",
} as const;
export type RoutingStatus =
  (typeof RoutingStatus)[keyof typeof RoutingStatus];
