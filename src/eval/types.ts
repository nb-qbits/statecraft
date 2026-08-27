export interface GoldObligation {
  readonly id: string;
  readonly actor: string;
  readonly duty: string;
  readonly citation: string;
  readonly expected_outcome: "date" | "bounded" | "refuse";
  readonly expected_date: string | null;
  readonly refusal_reason: string | null;
  readonly notes: string | null;
}

export interface GoldDocument {
  readonly document: {
    readonly filename: string;
    readonly jurisdiction: string;
    readonly session: string;
    readonly instrumentType: string;
    readonly number: string;
    readonly stage: string;
    readonly chapter: string | null;
  };
  readonly documentVersionId?: string;
  readonly verified: boolean;
  readonly obligations: readonly GoldObligation[];
}

export interface PipelineFinding {
  readonly anchorId: string;
  readonly proposalId: string;
  readonly quotedText: string;
  readonly kind: string;
  readonly obligationTitle: string | null;
  readonly sectionCitation: string | null;
  readonly actor: string | null;
  readonly resolved: boolean;
  readonly statutoryDate: string | null;
  readonly adjustedDate: string | null;
  readonly rrule: string | null;
  readonly occurrences: ReadonlyArray<{ occurrenceDate: string; adjustedDate: string }>;
  readonly bounded: boolean;
  readonly upperBound: string | null;
  readonly refusalKind: string | null;
  readonly unresolvedReason: string | null;
  readonly grammarParsed: boolean;
  readonly grammarFailureReason: string | null;
  readonly lane: string;
  readonly supportLevel: string;
}

export type MatchVerdict =
  | "correct_date"
  | "correct_bounded"
  | "correct_refuse"
  | "wrong_date"
  | "wrong_actor"
  | "wrong_citation"
  | "parse_error"
  | "refused_but_shouldnt_have"
  | "unmatched_gold"
  | "unmatched_finding";

export interface MatchedPair {
  readonly goldId: string;
  readonly findingAnchorId: string | null;
  readonly verdict: MatchVerdict;
  readonly goldActor: string;
  readonly foundActor: string | null;
  readonly actorCorrect: boolean;
  readonly goldDate: string | null;
  readonly foundDate: string | null;
  readonly dateCorrect: boolean | null;
  readonly goldCitation: string;
  readonly foundCitation: string | null;
  readonly citationCorrect: boolean;
  readonly goldOutcome: string;
  readonly foundOutcome: string | null;
  readonly refusalReason: string | null;
  readonly detail: string;
}

export interface DocumentReport {
  readonly documentName: string;
  readonly verified: boolean;
  readonly labelled: number;
  readonly found: number;
  readonly matched: number;
  readonly recall: number;
  readonly actorAccuracy: number;
  readonly citationAccuracy: number;
  readonly dateAccuracy: number;
  readonly completeRecords: number;
  readonly wrongAnswers: readonly MatchedPair[];
  readonly refusedButShouldntHave: readonly MatchedPair[];
  readonly parseErrors: readonly MatchedPair[];
  readonly unmatchedGold: readonly MatchedPair[];
  readonly unmatchedFindings: readonly string[];
  readonly pairs: readonly MatchedPair[];
}

export interface AggregateReport {
  readonly timestamp: string;
  readonly engineVersions: Record<string, string>;
  readonly modelId: string | null;
  readonly graded: boolean;
  readonly documents: readonly DocumentReport[];
  readonly aggregate: {
    readonly totalLabelled: number;
    readonly totalFound: number;
    readonly totalMatched: number;
    readonly recall: number;
    readonly actorAccuracy: number;
    readonly citationAccuracy: number;
    readonly dateAccuracy: number;
    readonly completeRecords: number;
    readonly wrongAnswerCount: number;
    readonly refusedButShouldntHaveCount: number;
    readonly parseErrorCount: number;
  };
}
