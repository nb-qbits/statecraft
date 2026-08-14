import type { AnchorId, SegmentId, DocumentVersionId } from "../shared/types.js";
import type { ProposalAnchorResult } from "../anchoring/types.js";
import type { SourceSegment } from "../parsing/types.js";
import type { SpanParseResult } from "../grammar/types.js";
import type { AnchoredResolution } from "../resolver/types.js";
import type { CheckResult, DeterministicCheckSummary } from "./types.js";

export interface DeterministicCheckInput {
  readonly anchorId: AnchorId;
  readonly segmentId: SegmentId;
  readonly documentVersionId: DocumentVersionId;
  readonly anchorResult: ProposalAnchorResult | undefined;
  readonly segment: SourceSegment | undefined;
  readonly grammarResult: SpanParseResult | undefined;
  readonly resolutionResult: AnchoredResolution | undefined;
}

export function checkQuoteAnchored(
  input: DeterministicCheckInput,
): CheckResult {
  if (!input.anchorResult) {
    return {
      check: "quote_anchored",
      status: "failed",
      reason: "no anchor result found for this anchorId",
    };
  }
  if (!input.anchorResult.result.anchored) {
    return {
      check: "quote_anchored",
      status: "failed",
      reason: `anchoring failed: ${input.anchorResult.result.reason}`,
    };
  }
  return { check: "quote_anchored", status: "passed", reason: null };
}

export function checkSegmentOwnership(
  input: DeterministicCheckInput,
): CheckResult {
  if (!input.segment) {
    return {
      check: "segment_ownership",
      status: "failed",
      reason: `segment ${input.segmentId} not found in this document version`,
    };
  }
  if (input.segment.documentVersionId !== input.documentVersionId) {
    return {
      check: "segment_ownership",
      status: "failed",
      reason: `segment belongs to ${input.segment.documentVersionId}, not ${input.documentVersionId}`,
    };
  }
  return { check: "segment_ownership", status: "passed", reason: null };
}

export function checkOffsetsValid(
  input: DeterministicCheckInput,
): CheckResult {
  if (!input.anchorResult || !input.anchorResult.result.anchored) {
    return {
      check: "offsets_valid",
      status: "failed",
      reason: "cannot validate offsets — anchor result missing or not anchored",
    };
  }
  if (!input.segment) {
    return {
      check: "offsets_valid",
      status: "failed",
      reason: "cannot validate offsets — segment not found",
    };
  }

  const { normalizedStart, normalizedEnd } = input.anchorResult.result;
  const textLength = input.segment.normalizedText.length;

  if (normalizedStart < 0 || normalizedEnd < 0) {
    return {
      check: "offsets_valid",
      status: "failed",
      reason: `negative offsets: start=${normalizedStart}, end=${normalizedEnd}`,
    };
  }
  if (normalizedStart >= normalizedEnd) {
    return {
      check: "offsets_valid",
      status: "failed",
      reason: `start (${normalizedStart}) >= end (${normalizedEnd})`,
    };
  }
  if (normalizedEnd > textLength) {
    return {
      check: "offsets_valid",
      status: "failed",
      reason: `end offset ${normalizedEnd} exceeds segment text length ${textLength}`,
    };
  }

  return { check: "offsets_valid", status: "passed", reason: null };
}

export function checkDateParseMatch(
  input: DeterministicCheckInput,
): CheckResult {
  if (!input.grammarResult) {
    return {
      check: "date_parse_match",
      status: "failed",
      reason: "no grammar parse result for this anchor",
    };
  }
  if (!input.grammarResult.result.parsed) {
    return {
      check: "date_parse_match",
      status: "failed",
      reason: `grammar parse failed: ${input.grammarResult.result.reason}`,
    };
  }
  if (!input.resolutionResult) {
    return { check: "date_parse_match", status: "passed", reason: null };
  }

  const expr = input.grammarResult.result.expression;
  const res = input.resolutionResult.result;

  if (expr.kind === "fixed_date" && res.resolved && "statutoryDate" in res) {
    const mm = String(expr.month).padStart(2, "0");
    const dd = String(expr.day).padStart(2, "0");
    const expectedStatutory = `${expr.year}-${mm}-${dd}`;
    if (res.statutoryDate !== expectedStatutory) {
      return {
        check: "date_parse_match",
        status: "failed",
        reason: `parsed date ${expectedStatutory} does not match statutory date ${res.statutoryDate}`,
      };
    }
  }

  return { check: "date_parse_match", status: "passed", reason: null };
}

export function runDeterministicChecks(
  input: DeterministicCheckInput,
): DeterministicCheckSummary {
  const checks: CheckResult[] = [
    checkQuoteAnchored(input),
    checkSegmentOwnership(input),
    checkOffsetsValid(input),
    checkDateParseMatch(input),
  ];

  return {
    allPassed: checks.every((c) => c.status === "passed"),
    checks,
  };
}
