import type {
  AnchorId,
  SegmentId,
  DocumentVersionId,
  ProposalId,
  Lane,
  SupportLevel,
} from "../shared/types.js";

export const HARNESS_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Gold annotation schema
// ---------------------------------------------------------------------------

export interface GoldItem {
  readonly goldItemId: string;
  readonly documentFixture: string;
  readonly segmentId: SegmentId;
  readonly anchorId: AnchorId | null;
  readonly quotedText: string;
  readonly kind: string;
  readonly deadlineDate: string | null;
  readonly adjustedDate: string | null;
  readonly actor: string | null;
  readonly deliverable: string | null;
  readonly conditions: string | null;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly packVersion: string | null;
  readonly patternClass: PatternClass;
  readonly expectedLane: Lane | null;
  readonly isFabricated: boolean;
  readonly isNegative: boolean;
  readonly notes: string | null;
}

export const PatternClass = {
  fixed_date: "fixed_date",
  relative_duration: "relative_duration",
  effective_date_ref: "effective_date_ref",
  negative: "negative",
} as const;
export type PatternClass = (typeof PatternClass)[keyof typeof PatternClass];

export interface GoldSet {
  readonly schemaVersion: string;
  readonly createdAt: string;
  readonly items: readonly GoldItem[];
}

// ---------------------------------------------------------------------------
// Match results
// ---------------------------------------------------------------------------

export const MatchOutcome = {
  matched_correct: "matched_correct",
  matched_wrong_value: "matched_wrong_value",
  missed: "missed",
  false_positive: "false_positive",
  split: "split",
  merged: "merged",
} as const;
export type MatchOutcome = (typeof MatchOutcome)[keyof typeof MatchOutcome];

export interface MatchPair {
  readonly goldItemId: string;
  readonly proposalId: ProposalId | null;
  readonly outcome: MatchOutcome;
  readonly spanOverlap: number;
  readonly fieldSimilarity: number;
  readonly wrongFields: readonly string[];
}

export interface MatchResult {
  readonly pairs: readonly MatchPair[];
  readonly unmatchedGold: readonly string[];
  readonly unmatchedProposals: readonly ProposalId[];
}

// ---------------------------------------------------------------------------
// Adjudication cache
// ---------------------------------------------------------------------------

export interface AdjudicationEntry {
  readonly goldItemId: string;
  readonly proposalContentHash: string;
  readonly isMatch: boolean;
  readonly adjudicatorId: string;
  readonly adjudicatedAt: string;
}

export interface AdjudicationCache {
  readonly entries: readonly AdjudicationEntry[];
}

// ---------------------------------------------------------------------------
// Confusion structure
// ---------------------------------------------------------------------------

export interface ConfusionCounts {
  readonly matchedCorrect: number;
  readonly matchedWrongValue: number;
  readonly missed: number;
  readonly falsePositive: number;
  readonly split: number;
  readonly merged: number;
}

export interface LaneConfusion {
  readonly lane: Lane;
  readonly counts: ConfusionCounts;
  readonly total: number;
}

export interface PatternClassConfusion {
  readonly patternClass: PatternClass;
  readonly counts: ConfusionCounts;
  readonly total: number;
}

export interface FabricationReport {
  readonly totalFabricated: number;
  readonly denominator: number;
  readonly detected: number;
  readonly missed: number;
}

export interface ScorerResult {
  readonly aggregate: ConfusionCounts;
  readonly byLane: readonly LaneConfusion[];
  readonly byPatternClass: readonly PatternClassConfusion[];
  readonly fabrication: FabricationReport;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

// ---------------------------------------------------------------------------
// Run recording
// ---------------------------------------------------------------------------

export interface WilsonInterval {
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
  readonly n: number;
}

export interface RunConfig {
  readonly scannerVersion: string;
  readonly extractorVersion: string;
  readonly anchorerVersion: string;
  readonly grammarVersion: string;
  readonly resolverVersion: string;
  readonly evaluatorVersion: string;
  readonly routerVersion: string;
  readonly reviewVersion: string;
  readonly configHash: string;
  readonly modelId: string | null;
  readonly promptHash: string | null;
  readonly goldSchemaVersion: string;
  readonly packVersion: string;
}

export interface RunMetrics {
  readonly totalGoldItems: number;
  readonly totalProposals: number;
  readonly scorer: ScorerResult;
  readonly precisionInterval: WilsonInterval;
  readonly recallInterval: WilsonInterval;
  readonly latencyMs: number;
  readonly errors: readonly string[];
}

export interface HarnessRun {
  readonly runId: string;
  readonly config: RunConfig;
  readonly metrics: RunMetrics;
  readonly timestamp: string;
}

export interface VarianceReport {
  readonly runs: readonly HarnessRun[];
  readonly precisionVariance: number;
  readonly recallVariance: number;
  readonly f1Variance: number;
  readonly deterministic: boolean;
}

// ---------------------------------------------------------------------------
// Proposal snapshot for matching
// ---------------------------------------------------------------------------

export interface ProposalSnapshot {
  readonly proposalId: ProposalId;
  readonly documentVersionId: DocumentVersionId;
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly quotedText: string;
  readonly kind: string;
  readonly normalizedStart: number;
  readonly normalizedEnd: number;
  readonly resolved: boolean;
  readonly statutoryDate: string | null;
  readonly adjustedDate: string | null;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly packVersion: string | null;
  readonly supportLevel: SupportLevel;
  readonly lane: Lane;
  readonly deliverable: string | null;
  readonly actor: string | null;
  readonly conditions: string | null;
}
