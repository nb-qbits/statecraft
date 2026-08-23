import type {
  Lane,
  LegislativeStatus,
  Fidelity,
} from "../shared/types.js";
import type { SpanEvaluation } from "../evaluation/types.js";
import type { AnchoredResolution } from "../resolver/types.js";
import type { SpanParseResult } from "../grammar/types.js";
import type { LaneAssignment, LaneReason } from "./types.js";

export interface LaneInput {
  readonly evaluation: SpanEvaluation;
  readonly grammarResult: SpanParseResult | undefined;
  readonly resolutionResult: AnchoredResolution | undefined;
  readonly segmentFidelity: Fidelity;
  readonly legislativeStatus: LegislativeStatus;
}

export function assignLane(input: LaneInput): LaneAssignment {
  const { evaluation, grammarResult, resolutionResult, segmentFidelity, legislativeStatus } = input;
  const reasons: LaneReason[] = [];

  if (evaluation.supportLevel === "unsupported") {
    reasons.push({ rule: "BLOCKED_UNSUPPORTED", detail: "support level is unsupported" });
    return result(evaluation, "blocked", reasons);
  }

  if (!grammarResult || !grammarResult.result.parsed) {
    reasons.push({ rule: "BLOCKED_GRAMMAR_FAILED", detail: "temporal expression could not be parsed" });
    return result(evaluation, "blocked", reasons);
  }

  if (!resolutionResult || !resolutionResult.result.resolved) {
    const missing = resolutionResult && !resolutionResult.result.resolved
      ? resolutionResult.result.missingInputs.join(", ")
      : "no resolution result";
    reasons.push({ rule: "BLOCKED_UNRESOLVED", detail: `date could not be resolved: ${missing}` });
    return result(evaluation, "blocked", reasons);
  }

  if (!evaluation.deterministicResult.allPassed) {
    reasons.push({ rule: "BLOCKED_DETERMINISTIC_FAILED", detail: "deterministic checks did not all pass" });
    return result(evaluation, "blocked", reasons);
  }

  if (evaluation.supportLevel === "ambiguous") {
    reasons.push({ rule: "EXCEPTION_AMBIGUOUS", detail: "support level is ambiguous — requires human review" });
    return result(evaluation, "exception_review", reasons);
  }

  const expression = grammarResult.result.expression;

  if (expression.kind === "relative_duration") {
    reasons.push({ rule: "EXCEPTION_RELATIVE_DATE", detail: `relative duration: ${expression.quantity} ${expression.unit}` });
    if (!expression.referenceEvent) {
      reasons.push({ rule: "EXCEPTION_MISSING_TRIGGER", detail: "no reference event identified for relative duration" });
    }
    return result(evaluation, "exception_review", reasons);
  }

  if (expression.kind === "recurrence") {
    reasons.push({ rule: "EXCEPTION_RECURRENCE", detail: `recurrence: ${expression.frequency} interval=${expression.interval}` });
    return result(evaluation, "exception_review", reasons);
  }

  if (expression.kind === "calendar_year_anchored_date") {
    reasons.push({ rule: "EXCEPTION_CALENDAR_YEAR_OFFSET", detail: `calendar year offset: ${expression.calendarYearOffset} from ${expression.referenceEvent ?? "unknown event"}` });
    return result(evaluation, "exception_review", reasons);
  }

  // At this point: fixed_date, supported, deterministic passed, resolved
  // Check straight_through criteria
  const straightThroughReasons: LaneReason[] = [];
  let meetsAllCriteria = true;

  straightThroughReasons.push({ rule: "ST_FIXED_DATE", detail: "expression is a fixed date" });
  straightThroughReasons.push({ rule: "ST_SUPPORTED", detail: "support level is supported" });
  straightThroughReasons.push({ rule: "ST_DETERMINISTIC_PASSED", detail: "all deterministic checks passed" });
  straightThroughReasons.push({ rule: "ST_RESOLVED", detail: "date resolved successfully" });

  if (segmentFidelity !== "declared") {
    straightThroughReasons.push({
      rule: "ST_FIDELITY_BLOCKED",
      detail: `fidelity is "${segmentFidelity}", not "declared" — straight_through requires declared fidelity`,
    });
    meetsAllCriteria = false;
  } else {
    straightThroughReasons.push({ rule: "ST_FIDELITY_OK", detail: "fidelity is declared" });
  }

  if (legislativeStatus !== "enacted") {
    straightThroughReasons.push({
      rule: "ST_STATUS_BLOCKED",
      detail: `legislativeStatus is "${legislativeStatus}", not "enacted" — straight_through requires enacted status (INV-8)`,
    });
    meetsAllCriteria = false;
  } else {
    straightThroughReasons.push({ rule: "ST_STATUS_OK", detail: "legislativeStatus is enacted" });
  }

  if (meetsAllCriteria) {
    return result(evaluation, "straight_through", straightThroughReasons);
  }

  // Falls to quick_confirmation: fixed date, supported, resolved, but
  // doesn't meet strict straight_through criteria (fidelity or status)
  reasons.push(...straightThroughReasons);
  reasons.push({ rule: "QUICK_CONFIRMATION", detail: "meets basic criteria but not strict straight_through requirements" });
  return result(evaluation, "quick_confirmation", reasons);
}

function result(
  evaluation: SpanEvaluation,
  lane: Lane,
  reasons: readonly LaneReason[],
): LaneAssignment {
  return {
    anchorId: evaluation.anchorId,
    segmentId: evaluation.segmentId,
    lane,
    reasons,
  };
}
