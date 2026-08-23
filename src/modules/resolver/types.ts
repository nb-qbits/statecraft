import type { AnchorId, SegmentId } from "../shared/types.js";
import type { TemporalExpression } from "../grammar/types.js";

export interface ParsedAnchoredExpression {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly text: string;
  readonly expression: TemporalExpression;
}

export interface ResolutionInput {
  readonly name: string;
  readonly value: string;
  readonly source: string;
  readonly authority: string;
  readonly citation: string;
}

export interface ResolvedDate {
  readonly resolved: true;
  readonly recurrence?: false;
  readonly statutoryDate: string;
  readonly adjustedDate: string;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly packVersion: string;
  readonly warnings: readonly string[];
  readonly inputs: readonly ResolutionInput[];
}

export interface Occurrence {
  readonly occurrenceDate: string;
  readonly adjustedDate: string;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly sequenceNumber: number;
}

export interface ResolvedRecurrence {
  readonly resolved: true;
  readonly recurrence: true;
  readonly rrule: string;
  readonly occurrences: readonly Occurrence[];
  readonly horizon: string;
  readonly yearParityNote: string | null;
  readonly ruleIds: readonly string[];
  readonly citations: readonly string[];
  readonly packVersion: string;
  readonly warnings: readonly string[];
  readonly inputs: readonly ResolutionInput[];
}

export const RefusalKind = {
  undated_event: "undated_event",
  missing_trigger: "missing_trigger",
  missing_year: "missing_year",
  hour_scale: "hour_scale",
  missing_anchor: "missing_anchor",
  cycle_detected: "cycle_detected",
  unresolved_dependency: "unresolved_dependency",
  broken_cross_reference: "broken_cross_reference",
  nonexistent_trigger: "nonexistent_trigger",
} as const;
export type RefusalKind = (typeof RefusalKind)[keyof typeof RefusalKind];

export interface BoundedUnresolvedDate {
  readonly resolved: false;
  readonly bounded: true;
  readonly upperBound: string;
  readonly reason: string;
  readonly contingency?: string;
  readonly derivationDepth?: number;
  readonly missingInputs: readonly string[];
  readonly warnings: readonly string[];
  readonly inputs: readonly ResolutionInput[];
}

export interface UnresolvedDate {
  readonly resolved: false;
  readonly bounded?: false;
  readonly refusalKind: RefusalKind;
  readonly reason: string;
  readonly missingInputs: readonly string[];
  readonly warnings: readonly string[];
  readonly inputs: readonly ResolutionInput[];
}

export type ResolutionResult = ResolvedDate | ResolvedRecurrence | BoundedUnresolvedDate | UnresolvedDate;

export function isResolvedDate(r: ResolutionResult): r is ResolvedDate {
  return r.resolved === true && !("recurrence" in r && r.recurrence === true);
}

export function isResolvedRecurrence(r: ResolutionResult): r is ResolvedRecurrence {
  return r.resolved === true && "recurrence" in r && r.recurrence === true;
}

export interface DerivedEffectiveDate {
  readonly date: string;
  readonly ruleId: string;
  readonly citation: string;
  readonly sessionSource: string;
}

export interface AnchoredResolution {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly text: string;
  readonly expression: TemporalExpression;
  readonly result: ResolutionResult;
}

export const ResolutionStatus = {
  unresolved_resolver: "unresolved_resolver",
  resolved_resolver: "resolved_resolver",
} as const;
export type ResolutionStatus =
  (typeof ResolutionStatus)[keyof typeof ResolutionStatus];
